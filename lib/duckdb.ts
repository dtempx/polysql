import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import chalk from "chalk";
import { BaseConnector, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError, type Connector } from "./utilities.js";

/**
 * Where a local database's file lives on disk. Accept either a bare path string
 * or a `{ file }` object so callers can use the terse form or the same object
 * shape the server backends take. Omit it (or pass `":memory:"`) for an
 * ephemeral in-memory database.
 */
export type DuckDBConfig = string | { file?: string };

// Resolve the accepted config shapes down to a single file path.
function resolveFile(config: DuckDBConfig = ":memory:"): string {
    if (typeof config === "string")
        return config;
    return config.file ?? ":memory:";
}

/**
 * A DuckDB connector backed by an explicit database file (or ":memory:"),
 * instead of reading `DUCKDB_CONNECTION` from the environment. Each instance owns
 * its own instance/connection, so an app can open several databases at once. Omit
 * `config` to default to an in-memory database.
 *
 * DuckDB's Node bindings are asynchronous and the instance/connection are created
 * lazily on first use, so the (async) handshake happens inside `query`/`execute`
 * rather than in the constructor.
 */
export class DuckDBConnector extends BaseConnector {
    private file: string;
    private connection: Promise<DuckDBConnection> | undefined;

    constructor(config: DuckDBConfig = ":memory:") {
        super();
        this.file = resolveFile(config);
    }

    private getConnection(): Promise<DuckDBConnection> {
        if (!this.connection) {
            if (process.env.VERBOSE)
                console.log(chalk.gray(`\nDUCKDB DATABASE: ${this.file}`));
            this.connection = DuckDBInstance.create(this.file).then(instance => instance.connect());
        }
        return this.connection;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const t0 = Date.now();
        logQuery(query, params);

        let rows: T[];
        try {
            const connection = await this.getConnection();
            const reader = await connection.runAndReadAll(query, formatBinds(params));
            rows = reader.getRowObjectsJS() as T[];
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logQueryResult(rows.length, t0);

        return rows;
    }

    async execute(query: string, params?: Record<string, any> | any[]): Promise<void> {
        const t0 = Date.now();
        logExecute(query, params);

        try {
            const connection = await this.getConnection();
            await connection.run(query, formatBinds(params));
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logExecuteResult(t0);
    }

    /**
     * Close the underlying connection. Provided for parity with the shared
     * connector surface; releases the connection (and file lock, if any). Safe to
     * call when no connection was ever opened.
     */
    async close(): Promise<void> {
        if (this.connection) {
            const connection = await this.connection;
            connection.closeSync();
            this.connection = undefined;
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

        const connection = await this.getConnection();
        await connection.run("BEGIN TRANSACTION");
        try {
            const prepared = await connection.prepare(q);
            for (const row of list) {
                prepared.bind(fields.map(field => encodeValue(row[field])));
                await prepared.run();
            }
            await connection.run("COMMIT");
        }
        catch (err) {
            await connection.run("ROLLBACK");
            throw wrapQueryError(err, q, obj);
        }
    }
}

/**
 * Build a DuckDB connector. Mirrors the other `create*` factories as a thin
 * wrapper over `new DuckDBConnector(...)`.
 */
export function createDuckDB(config: DuckDBConfig = ":memory:"): Connector {
    return new DuckDBConnector(config);
}

// The default instance: lazily built from `DUCKDB_CONNECTION` (or ":memory:") on
// first use, matching the `import { duckdb } from "sqlspy"` API of the other
// backends.
let defaultInstance: Connector | undefined;
function getDefault(): Connector {
    return defaultInstance ??= new DuckDBConnector(process.env.DUCKDB_CONNECTION || ":memory:");
}

export const query: Connector["query"] = (...args) => getDefault().query(...args);
export const execute: NonNullable<Connector["execute"]> = (...args) => getDefault().execute!(...args);
export const insert: Connector["insert"] = (...args) => getDefault().insert(...args);

/**
 * Close the default instance's connection (if one was opened) so the file lock is
 * released. A no-op when the default instance was never used.
 */
export async function close(): Promise<void> {
    if (defaultInstance) {
        await defaultInstance.close!();
        defaultInstance = undefined;
    }
}

export { safeValue };

// DuckDB binds JS primitives directly, but has no native object/array type, so
// normalize values it will not bind into a form it accepts.
function encodeValue(value: unknown): any {
    if (value === undefined)
        return null;
    if (value !== null && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value))
        return JSON.stringify(value);
    return value;
}

// DuckDB's driver accepts a positional array or a named-parameter object directly,
// so pass params through and hand it an empty array when there are none.
function formatBinds(params?: Record<string, any> | any[]): any[] | Record<string, any> {
    if (Array.isArray(params))
        return params;
    else if (typeof params === "object" && params !== null)
        return params;
    else
        return [];
}
