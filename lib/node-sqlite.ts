import type { DatabaseSync } from "node:sqlite";
import chalk from "chalk";
import { BaseConnector, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError, type Connector } from "./utilities.js";

/**
 * `node:sqlite` is built into Node itself, so there is nothing to install — but
 * it only exists on Node 22.5.0 and later, and on Node 22.x before 22.13 it is
 * gated behind `--experimental-sqlite`. It is therefore loaded on first use (as
 * the npm-backed drivers are) so that importing polysql on an older runtime
 * succeeds, and only *using* this connector reports the problem.
 *
 * `loadDriver` is deliberately not used here: its message tells the caller to
 * `npm install` the package, which is the wrong advice for a builtin.
 */
type Driver = typeof import("node:sqlite");
let driver: Promise<Driver> | undefined;
function loadNodeSqlite(): Promise<Driver> {
    return driver ??= import("node:sqlite").catch(err => {
        const code = (err as { code?: unknown } | undefined)?.code;
        if (code === "ERR_UNKNOWN_BUILTIN_MODULE" || code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND")
            throw new Error(`The NodeSqlite connector requires Node's built-in "node:sqlite" module, which this runtime (${process.version}) does not provide. It requires Node 22.5.0 or later, and on Node 22.x before 22.13.0 it must be enabled with --experimental-sqlite. Use the "sqlite" connector (better-sqlite3) on older runtimes.`);
        throw err;
    });
}

/**
 * Where a local database's file lives on disk. Accept either a bare path string
 * or a `{ file }` object so callers can use the terse form or the same object
 * shape the server backends take. Omit it (or pass `":memory:"`) for an
 * ephemeral in-memory database.
 */
export type NodeSqliteConfig = string | { file?: string };

// Resolve the accepted config shapes down to a single file path.
function resolveFile(config: NodeSqliteConfig = ":memory:"): string {
    if (typeof config === "string")
        return config;
    return config.file ?? ":memory:";
}

/**
 * A SQLite connector backed by Node's built-in `node:sqlite` module rather than
 * the `better-sqlite3` native addon — the same database engine with nothing to
 * install and no compile step, at the cost of requiring a recent Node.
 *
 * `node:sqlite`'s `DatabaseSync` API is **fully synchronous**: `prepare().all()`
 * returns rows directly rather than a promise. This class adapts it to polysql's
 * async connector surface so that `query`/`execute`/`insert` are awaitable and
 * interchangeable with every other backend. The work still happens synchronously
 * on the main thread and blocks the event loop for its duration — the `async` is
 * interface compatibility, not concurrency. (`better-sqlite3`, behind the
 * `sqlite` connector, is synchronous in exactly the same way.)
 *
 * Takes an explicit database file (or ":memory:") instead of reading
 * `NODE_SQLITE_CONNECTION` from the environment. Each instance owns its own
 * connection, so an app can open several databases at once. Omit `config` to
 * default to an in-memory database.
 *
 * The database handle (and the `node:sqlite` module itself) is opened lazily on
 * the first `query`/`execute`/`insert`, so constructing a connector never
 * touches the driver.
 */
export class NodeSqliteConnector extends BaseConnector {
    private file: string;
    private db: Promise<DatabaseSync> | undefined;

    constructor(config: NodeSqliteConfig = ":memory:") {
        super();
        this.file = resolveFile(config);
    }

    private getDatabase(): Promise<DatabaseSync> {
        if (!this.db) {
            this.db = loadNodeSqlite().then(({ DatabaseSync }) => {
                const db = new DatabaseSync(this.file);
                if (process.env.VERBOSE)
                    console.log(chalk.gray(`\nNODE SQLITE DATABASE: ${this.file}`));
                return db;
            });
        }
        return this.db;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const db = await this.getDatabase();
        const t0 = Date.now();
        logQuery(query, params);

        let rows: T[];
        try {
            const binds = formatBinds(params);
            rows = db.prepare(query).all(...binds) as T[];
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logQueryResult(rows.length, t0);

        return rows.map(row => formatRow(row));
    }

    async execute(query: string, params?: Record<string, any> | any[]): Promise<void> {
        const db = await this.getDatabase();
        const t0 = Date.now();
        logExecute(query, params);

        try {
            const binds = formatBinds(params);
            db.prepare(query).run(...binds);
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logExecuteResult(t0);
    }

    /**
     * Close the underlying database handle. Provided for parity with the shared
     * connector surface; SQLite's handle is synchronous and does not keep the
     * process alive, but closing it releases the file lock. Safe to call when no
     * database was ever opened (or the module failed to load).
     */
    async close(): Promise<void> {
        if (this.db) {
            const db = await this.db.catch(() => undefined);
            db?.close();
            this.db = undefined;
        }
    }

    async insert(table: string, data: Record<string, any> | Array<Record<string, any>>): Promise<void> {
        const list = Array.isArray(data) ? data : [data];
        if (list.length == 0)
            return;
        if (!/^[A-Za-z_][A-Za-z0-9._]*$/.test(table))
            throw `Unsafe table name for query: "${table}"`;

        const [obj] = list;
        const fields = Object.keys(obj);
        const placeholders = fields.map(() => "?").join(", ");
        const q = `INSERT INTO ${table} (${fields.join(", ")}) VALUES (${placeholders})`;

        const db = await this.getDatabase();
        const statement = db.prepare(q);
        // `DatabaseSync` has no `transaction()` helper of its own (better-sqlite3
        // does), so drive the transaction with explicit statements to keep a
        // multi-row insert all-or-nothing.
        db.exec("BEGIN");
        try {
            for (const row of list)
                statement.run(...fields.map(field => encodeValue(row[field])));
            db.exec("COMMIT");
        }
        catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
    }
}

/**
 * Build a connector backed by Node's built-in `node:sqlite` module.
 */
export function createNodeSqlite(config: NodeSqliteConfig = ":memory:"): Connector {
    return new NodeSqliteConnector(config);
}

// The default instance: lazily built from `NODE_SQLITE_CONNECTION` (or
// ":memory:") on first use.
let defaultInstance: Connector | undefined;
function getDefault(): Connector {
    return defaultInstance ??= new NodeSqliteConnector(process.env.NODE_SQLITE_CONNECTION || ":memory:");
}

export const query: Connector["query"] = (...args) => getDefault().query(...args);
export const execute: NonNullable<Connector["execute"]> = (...args) => getDefault().execute!(...args);
export const insert: Connector["insert"] = (...args) => getDefault().insert(...args);

/**
 * Close the default instance's database handle (if one was opened) so the file
 * lock is released. A no-op when the default instance was never used.
 */
export async function close(): Promise<void> {
    if (defaultInstance) {
        await defaultInstance.close!();
        defaultInstance = undefined;
    }
}

export { safeValue };

// SQLite has no native boolean/object/array/date types, so normalize values that
// `node:sqlite` will not bind directly into a form it accepts. It binds only
// null, number, bigint, string and Uint8Array; anything else either throws or —
// in the case of a Date — binds as NULL, so dates are encoded explicitly rather
// than left to silently lose their value.
function encodeValue(value: unknown): any {
    if (value === undefined)
        return null;
    if (typeof value === "boolean")
        return value ? 1 : 0;
    if (value instanceof Date)
        return value.toISOString();
    if (value !== null && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array))
        return JSON.stringify(value);
    return value;
}

function formatBinds(params?: Record<string, any> | any[]): any[] {
    if (Array.isArray(params))
        return params;
    else if (typeof params === "object" && params !== null)
        return [params];
    else
        return [];
}

// `node:sqlite` returns plain objects keyed by column name, but hands back BLOBs
// as bare `Uint8Array`s where better-sqlite3 returns `Buffer`s. Normalize them so
// a row looks the same whichever SQLite connector produced it.
function formatRow(obj: any): any {
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value instanceof Uint8Array && !Buffer.isBuffer(value))
            obj[key] = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return obj;
}
