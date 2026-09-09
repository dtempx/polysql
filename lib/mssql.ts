import mssql from "mssql";
import chalk from "chalk";
import { BaseConnector, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError, type Connector } from "./utilities.js";

/** Connection info accepted by `MssqlConnector`: either the driver's own pool
 * config object, or a connection string (the same form the `MSSQL_CONNECTION`
 * environment variable uses, e.g. "Server=host,1433;Database=db;User Id=sa;
 * Password=pw;Encrypt=true" or "mssql://user:pass@host:1433/db"). */
export type MssqlConfig = mssql.config | string;

/**
 * A Microsoft SQL Server connector bound to explicit connection info instead of
 * the `MSSQL_CONNECTION` environment variable. Each instance owns its own connection
 * pool, so an app can talk to several databases at once.
 *
 * `config` is either an mssql `config` object or a connection string. `poolMax`
 * defaults to `MSSQL_POOL_MAX` (or the mssql default).
 */
export class MssqlConnector extends BaseConnector {
    private poolConfig: mssql.config;
    private pool: mssql.ConnectionPool | undefined;
    private connecting: Promise<mssql.ConnectionPool> | undefined;

    constructor(config: MssqlConfig, opts?: { poolMax?: number }) {
        super();
        this.poolConfig = typeof config === "string" ? parseConnectionString(config) : { ...config };
        const poolMax = opts?.poolMax ?? (parseInt(process.env.MSSQL_POOL_MAX!) || undefined);
        if (poolMax !== undefined)
            this.poolConfig.pool = { ...this.poolConfig.pool, max: poolMax };
    }

    private async getPool(): Promise<mssql.ConnectionPool> {
        if (this.pool)
            return this.pool;
        // mssql's connect() is async, so guard against concurrent callers racing
        // to open two pools by memoizing the in-flight connect promise.
        if (!this.connecting) {
            if (process.env.VERBOSE)
                console.log(chalk.gray(`\nMSSQL CONNECTION: ${JSON.stringify({ ...this.poolConfig, password: undefined }, null, 2)}`));
            this.connecting = new mssql.ConnectionPool(this.poolConfig).connect();
        }
        this.pool = await this.connecting;
        return this.pool;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const t0 = Date.now();
        logQuery(query, params);

        let rows: T[];
        try {
            const pool = await this.getPool();
            const { text, request } = bindRequest(pool.request(), query, params);
            const result = await request.query(text);
            rows = result.recordset as T[] ?? [];
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logQueryResult(rows.length, t0);

        return rows.map(row => formatRow(row));
    }

    async execute(query: string, params?: Record<string, any> | any[]): Promise<void> {
        const t0 = Date.now();
        logExecute(query, params);

        try {
            const pool = await this.getPool();
            const { text, request } = bindRequest(pool.request(), query, params);
            await request.query(text);
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logExecuteResult(t0);
    }

    /**
     * Close the connection pool, releasing its open sockets. Call this on
     * shutdown so the process (or a test runner) can exit cleanly instead of
     * hanging on the pool's still-open connections. Safe to call when no pool was
     * ever created.
     */
    async close(): Promise<void> {
        if (this.connecting) {
            const pool = await this.connecting.catch(() => undefined);
            await pool?.close();
            this.pool = undefined;
            this.connecting = undefined;
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
        const params: unknown[] = [];
        const rows = list.map(row => `(${fields.map(field => `@p${params.push(encodeValue(row[field])) - 1}`).join(", ")})`);
        const q = `INSERT INTO ${table} (${fields.join(", ")}) VALUES ${rows.join(", ")}`;
        await this.execute(q, params);
    }
}

/**
 * Build a Microsoft SQL Server connector. Retained as a thin wrapper over
 * `new MssqlConnector(...)` so existing callers keep working.
 */
export function createMssql(config: MssqlConfig, opts?: { poolMax?: number }): MssqlConnector {
    return new MssqlConnector(config, opts);
}

// The default instance: lazily built from `MSSQL_CONNECTION` on first use, preserving
// the `import { mssql } from "polysql"` API used by the other backends.
let defaultInstance: MssqlConnector | undefined;
function getDefault(): MssqlConnector {
    if (!defaultInstance) {
        if (!process.env.MSSQL_CONNECTION)
            throw new Error("Required environment variable MSSQL_CONNECTION is undefined.");
        defaultInstance = new MssqlConnector(process.env.MSSQL_CONNECTION);
    }
    return defaultInstance;
}

export const query: MssqlConnector["query"] = (...args) => getDefault().query(...args);
export const execute: NonNullable<MssqlConnector["execute"]> = (...args) => getDefault().execute!(...args);
export const insert: MssqlConnector["insert"] = (...args) => getDefault().insert(...args);

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

// mssql binds by name, not position. Accept the positional-or-named param shapes
// the other connectors take and register them on the request as @p0, @p1, ...
// Query text uses those same @pN markers, so positional callers can also just
// write @pN directly; a shared @pN namespace keeps both paths consistent.
function bindRequest(request: mssql.Request, query: string, params?: Record<string, any> | any[]): { text: string; request: mssql.Request } {
    const binds = formatBinds(params);
    for (let i = 0; i < binds.length; i++)
        request.input(`p${i}`, binds[i]);
    return { text: query, request };
}

// mssql does not bind plain objects/arrays; JSON-encode them so they land in
// nvarchar/JSON columns instead of erroring. undefined becomes NULL.
function encodeValue(value: unknown): any {
    if (value === undefined)
        return null;
    if (value !== null && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value))
        return JSON.stringify(value);
    return value;
}

function formatBinds(params?: Record<string, any> | any[]): any[] {
    if (Array.isArray(params))
        return params;
    else if (typeof params === "object" && params !== null)
        return Object.values(params);
    else
        return [];
}

// Turn a "Key=value;..." connection string into an mssql config object. mssql
// parses the string natively in the ConnectionPool constructor and exposes the
// result on `.config`, so build a throwaway pool to borrow that parse — this
// gives us a real object to merge poolMax into and to redact for VERBOSE.
function parseConnectionString(value: string): mssql.config {
    // `.config` is populated from the parsed string at runtime but is absent
    // from mssql's type declarations, so reach for it through an any-cast.
    return (new mssql.ConnectionPool(value) as any).config as mssql.config;
}

// mssql returns plain objects with the column-case from the query and JS
// primitives, so this is a light passthrough — kept to match the shared
// connector shape and to provide a hook for future normalization.
function formatRow(obj: any): any {
    return obj;
}
