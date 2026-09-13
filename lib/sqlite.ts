import type Database from "better-sqlite3";
import chalk from "chalk";
import { BaseConnector, interopDefault, loadDriver, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError, type Connector } from "./utilities.js";

// `better-sqlite3` is an optional peer dependency, loaded on first use so that
// importing polysql does not require it to be installed. See `loadDriver`.
type Driver = typeof import("better-sqlite3");
let driver: Promise<Driver> | undefined;
function loadSqlite(): Promise<Driver> {
    return driver ??= loadDriver("better-sqlite3", "SQLite", () => import("better-sqlite3").then(module => interopDefault<Driver>(module)));
}

/**
 * Where a local database's file lives on disk. Accept either a bare path string
 * or a `{ file }` object so callers can use the terse form or the same object
 * shape the server backends take. Omit it (or pass `":memory:"`) for an
 * ephemeral in-memory database.
 */
export type SqliteConfig = string | { file?: string };

// Resolve the accepted config shapes down to a single file path.
function resolveFile(config: SqliteConfig = ":memory:"): string {
    if (typeof config === "string")
        return config;
    return config.file ?? ":memory:";
}

/**
 * A SQLite connector backed by an explicit database file (or ":memory:"),
 * instead of reading `SQLITE_CONNECTION` from the environment. Each instance owns
 * its own connection, so an app can open several databases at once. Omit `config`
 * to default to an in-memory database.
 *
 * The database handle (and the `better-sqlite3` driver itself) is opened lazily
 * on the first `query`/`execute`/`insert`, so constructing a connector never
 * touches the driver.
 */
export class SqliteConnector extends BaseConnector {
    private file: string;
    private db: Promise<Database.Database> | undefined;

    constructor(config: SqliteConfig = ":memory:") {
        super();
        this.file = resolveFile(config);
    }

    private getDatabase(): Promise<Database.Database> {
        if (!this.db) {
            this.db = loadSqlite().then(Database => {
                const db = new Database(this.file);
                if (process.env.VERBOSE)
                    console.log(chalk.gray(`\nSQLITE DATABASE: ${this.file}`));
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
     * database was ever opened (or the driver failed to load).
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
        const insertMany = db.transaction((rows: Array<Record<string, any>>) => {
            for (const row of rows)
                statement.run(...fields.map(field => encodeValue(row[field])));
        });
        insertMany(list);
    }
}

/**
 * Build a SQLite connector. Retained as a thin wrapper over
 * `new SqliteConnector(...)` so existing callers keep working.
 */
export function createSqlite(config: SqliteConfig = ":memory:"): Connector {
    return new SqliteConnector(config);
}

// The default instance: lazily built from `SQLITE_CONNECTION` (or ":memory:") on
// first use, preserving the original `import { sqlite } from "polysql"` API.
let defaultInstance: Connector | undefined;
function getDefault(): Connector {
    return defaultInstance ??= new SqliteConnector(process.env.SQLITE_CONNECTION || ":memory:");
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

// SQLite has no native boolean/object/array types, so normalize values that
// better-sqlite3 will not bind directly into a form it accepts.
function encodeValue(value: unknown): any {
    if (value === undefined)
        return null;
    if (typeof value === "boolean")
        return value ? 1 : 0;
    if (value !== null && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value))
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

// SQLite returns plain objects with correct column-case keys and JS primitives,
// so this is a light passthrough — kept to match the shared connector shape and
// to provide a hook for future normalization.
function formatRow(obj: any): any {
    return obj;
}
