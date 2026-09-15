import type oracledb from "oracledb";
import chalk from "chalk";
import { BaseConnector, interopDefault, loadDriver, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError } from "./utilities.js";

// `oracledb` is an optional peer dependency, loaded on first use so that
// importing polysql does not require it to be installed. See `loadDriver`.
type Driver = typeof import("oracledb");
let driver: Promise<Driver> | undefined;
function loadOracle(): Promise<Driver> {
    return driver ??= loadDriver("oracledb", "Oracle", () => import("oracledb").then(module => interopDefault<Driver>(module)));
}

/** Connection info accepted by `OracleConnector`: either the driver's own pool
 * attributes object, or a `user/password@host:port/service` connection string
 * (the same form the `ORACLE_CONNECTION` environment variable uses). */
export type OracleConfig = oracledb.PoolAttributes | string;

/**
 * An Oracle Database connector bound to explicit connection info instead of the
 * `ORACLE_CONNECTION` environment variable. Each instance owns its own connection
 * pool, so an app can talk to several databases at once.
 *
 * `config` is either a `PoolAttributes` object or a
 * `user/password@host:port/service` connection string. `poolMax` defaults to
 * `ORACLE_POOL_MAX` (or the oracledb default).
 *
 * The pool (and the `oracledb` driver itself) is created lazily on the first
 * `query`/`execute`/`insert`, so constructing a connector never touches the
 * driver.
 *
 * The driver runs in Thin mode by default, which needs no Oracle Client
 * libraries. Thick mode (`oracledb.initOracleClient()`) is the caller's to
 * enable before the first query if they need it.
 */
export class OracleConnector extends BaseConnector {
    private config: OracleConfig;
    private poolMax: number | undefined;
    private pool: Promise<oracledb.Pool> | undefined;

    constructor(config: OracleConfig, opts?: { poolMax?: number }) {
        super();
        this.config = typeof config === "string" ? config : { ...config };
        this.poolMax = opts?.poolMax ?? (parseInt(process.env.ORACLE_POOL_MAX!) || undefined);
    }

    private getPool(): Promise<oracledb.Pool> {
        if (!this.pool) {
            this.pool = loadOracle().then(oracledb => {
                const attributes = typeof this.config === "string" ? parseConnectionString(this.config) : { ...this.config };
                if (this.poolMax !== undefined)
                    attributes.poolMax = this.poolMax;
                if (process.env.VERBOSE)
                    console.log(chalk.gray(`\nORACLE CONNECTION: ${JSON.stringify({ ...attributes, password: undefined }, null, 2)}`));
                return oracledb.createPool(attributes);
            });
        }
        return this.pool;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const [oracledb, pool] = await Promise.all([loadOracle(), this.getPool()]);
        const t0 = Date.now();
        logQuery(query, params);

        let rows: T[];
        const connection = await pool.getConnection();
        try {
            // outFormat OUT_FORMAT_OBJECT gives plain objects keyed by column
            // name, matching every other connector; the driver's default is
            // arrays of column values.
            const result = await connection.execute<T>(stripTerminator(query), formatBinds(params), { outFormat: oracledb.OUT_FORMAT_OBJECT });
            rows = result.rows ?? [];
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }
        finally {
            await connection.close();
        }

        logQueryResult(rows.length, t0);

        return rows.map(row => formatRow(row));
    }

    async execute(query: string, params?: Record<string, any> | any[]): Promise<void> {
        const pool = await this.getPool();
        const t0 = Date.now();
        logExecute(query, params);

        const connection = await pool.getConnection();
        try {
            // Oracle does not autocommit, so DML would roll back when the
            // connection returns to the pool unless it is committed here.
            await connection.execute(stripTerminator(query), formatBinds(params), { autoCommit: true });
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }
        finally {
            await connection.close();
        }

        logExecuteResult(t0);
    }

    /**
     * Drain and close the connection pool, releasing its open connections. Call
     * this on shutdown so the process (or a test runner) can exit cleanly instead
     * of hanging on the pool's still-open connections. Safe to call when no pool
     * was ever created (or the driver failed to load).
     */
    async close(): Promise<void> {
        if (this.pool) {
            const pool = await this.pool.catch(() => undefined);
            // A drain time lets checked-out connections finish instead of
            // failing the close outright, which is what pool.close() with no
            // argument does while any connection is still in use.
            await pool?.close(0);
            this.pool = undefined;
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
        // Oracle's INSERT ... VALUES takes a single row, so a multi-row insert
        // is written as INSERT ALL ... SELECT 1 FROM DUAL.
        const params: unknown[] = [];
        const clauses = list.map(row => `INTO ${table} (${fields.join(", ")}) VALUES (${fields.map(field => `:${params.push(encodeValue(row[field])) - 1}`).join(", ")})`);
        const q = list.length === 1
            ? `INSERT ${clauses[0]}`
            : `INSERT ALL ${clauses.join(" ")} SELECT 1 FROM DUAL`;
        await this.execute(q, params);
    }
}

/**
 * Build an Oracle connector. Retained as a thin wrapper over
 * `new OracleConnector(...)` so callers match the other backends' factories.
 */
export function createOracle(config: OracleConfig, opts?: { poolMax?: number }): OracleConnector {
    return new OracleConnector(config, opts);
}

// The default instance: lazily built from `ORACLE_CONNECTION` on first use,
// preserving the `import { oracle } from "polysql"` API used by the other backends.
let defaultInstance: OracleConnector | undefined;
function getDefault(): OracleConnector {
    if (!defaultInstance) {
        if (!process.env.ORACLE_CONNECTION)
            throw new Error("Required environment variable ORACLE_CONNECTION is undefined.");
        defaultInstance = new OracleConnector(process.env.ORACLE_CONNECTION);
    }
    return defaultInstance;
}

export const query: OracleConnector["query"] = (...args) => getDefault().query(...args);
export const execute: NonNullable<OracleConnector["execute"]> = (...args) => getDefault().execute!(...args);
export const insert: OracleConnector["insert"] = (...args) => getDefault().insert(...args);

/**
 * Close the default instance's connection pool (if one was created) so the
 * process can exit cleanly. A no-op when the default instance was never used.
 */
export async function close(): Promise<void> {
    if (defaultInstance) {
        await defaultInstance.close();
        defaultInstance = undefined;
    }
}

export { safeValue };

// Turn a `user/password@host:port/service` connection string into the pool
// attributes the driver takes. Anything that is not in that shape is passed
// through as `connectString` on its own, which covers an EZConnect string, a
// TNS alias, or a full descriptor with credentials supplied out of band.
function parseConnectionString(value: string): oracledb.PoolAttributes {
    const match = /^([^/@]+)\/([^@]*)@(.+)$/.exec(value);
    if (match) {
        const [, user, password, connectString] = match;
        return { user, password, connectString };
    }
    return { connectString: value };
}

// oracledb rejects a statement with a trailing semicolon (SQL is sent to the
// server as-is, and the terminator is a SQL*Plus convention rather than part of
// the statement). Trim one so the same SQL text works here as elsewhere. A
// PL/SQL block ends in `END;` and must keep its semicolon, so those are left
// alone.
function stripTerminator(query: string): string {
    const text = query.trim();
    if (/\bEND\s*;$/i.test(text))
        return text;
    return text.replace(/;$/, "");
}

// oracledb binds objects by key and arrays by position; positional binds are
// named ":0", ":1", ... to match the markers `insert` generates, since the
// driver has no bare positional marker the way `?` works elsewhere.
function formatBinds(params?: Record<string, any> | any[]): oracledb.BindParameters {
    if (Array.isArray(params))
        return Object.fromEntries(params.map((value, i) => [String(i), value]));
    else if (typeof params === "object" && params !== null)
        return params;
    else
        return [];
}

// oracledb does not bind plain objects/arrays; JSON-encode them so they land in
// CLOB/VARCHAR2/JSON columns instead of erroring. undefined becomes NULL.
function encodeValue(value: unknown): any {
    if (value === undefined)
        return null;
    if (value !== null && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value))
        return JSON.stringify(value);
    return value;
}

// With OUT_FORMAT_OBJECT the driver returns plain objects keyed by the column
// name as Oracle reports it — upper case unless the query quoted it. Lower-case
// the keys so rows read the same as every other backend's, matching what the
// Snowflake connector does for the same reason.
function formatRow(obj: any): any {
    if (obj === null || typeof obj !== "object")
        return obj;
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj))
        result[key.toLowerCase()] = obj[key];
    return result;
}
