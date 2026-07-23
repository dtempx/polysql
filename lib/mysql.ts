import mysql from "mysql2/promise";
import chalk from "chalk";
import { BaseConnector, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError, type Connector } from "./utilities.js";

/** Connection info accepted by `MysqlConnector`: either the driver's own pool
 * options object, or a `mysql://user:pass@host:port/db` connection string (the
 * same form the `MYSQL_CONNECTION` environment variable uses). */
export type MysqlConfig = mysql.PoolOptions | string;

/**
 * A MySQL connector bound to explicit connection info instead of the
 * `MYSQL_CONNECTION` environment variable. Each instance owns its own connection
 * pool, so an app can talk to several databases at once.
 *
 * `config` is either a `PoolOptions` object or a `mysql://...` connection
 * string. `poolMax` defaults to `MYSQL_POOL_MAX` (or the mysql2 default).
 */
export class MysqlConnector extends BaseConnector {
    private poolConfig: mysql.PoolOptions;
    private pool: mysql.Pool | undefined;

    constructor(config: MysqlConfig, opts?: { poolMax?: number }) {
        super();
        this.poolConfig = typeof config === "string" ? { uri: config } : { ...config };
        const poolMax = opts?.poolMax ?? (parseInt(process.env.MYSQL_POOL_MAX!) || undefined);
        if (poolMax !== undefined)
            this.poolConfig.connectionLimit = poolMax;
    }

    private getPool(): mysql.Pool {
        if (!this.pool) {
            this.pool = mysql.createPool(this.poolConfig);
            if (process.env.VERBOSE)
                console.log(chalk.gray(`\nMYSQL CONNECTION: ${JSON.stringify({ ...this.poolConfig, password: undefined, uri: this.poolConfig.uri ? "***" : undefined }, null, 2)}`));
        }
        return this.pool;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const t0 = Date.now();
        logQuery(query, params);

        let rows: T[];
        try {
            const [result] = await this.getPool().query(query, formatBinds(params));
            rows = Array.isArray(result) ? result as T[] : [];
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
            await this.getPool().query(query, formatBinds(params));
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logExecuteResult(t0);
    }

    /**
     * Drain and close the connection pool, releasing its open sockets. Call this
     * on shutdown so the process (or a test runner) can exit cleanly instead of
     * hanging on the pool's still-open connections. Safe to call when no pool was
     * ever created.
     */
    async close(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
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
        const params: unknown[] = [];
        const rows = list.map(row => `(${fields.map(field => { params.push(encodeValue(row[field])); return "?"; }).join(", ")})`);
        const q = `INSERT INTO ${table} (${fields.join(", ")}) VALUES ${rows.join(", ")}`;
        await this.execute(q, params);
    }
}

/**
 * Build a MySQL connector. Retained as a thin wrapper over
 * `new MysqlConnector(...)` so callers match the other backends' factories.
 */
export function createMysql(config: MysqlConfig, opts?: { poolMax?: number }): MysqlConnector {
    return new MysqlConnector(config, opts);
}

// The default instance: lazily built from `MYSQL_CONNECTION` on first use, preserving
// the `import { mysql } from "sqlspy"` API used by the other backends.
let defaultInstance: MysqlConnector | undefined;
function getDefault(): MysqlConnector {
    if (!defaultInstance) {
        if (!process.env.MYSQL_CONNECTION)
            throw new Error("Required environment variable MYSQL_CONNECTION is undefined.");
        defaultInstance = new MysqlConnector(process.env.MYSQL_CONNECTION);
    }
    return defaultInstance;
}

export const query: MysqlConnector["query"] = (...args) => getDefault().query(...args);
export const execute: NonNullable<MysqlConnector["execute"]> = (...args) => getDefault().execute!(...args);
export const insert: MysqlConnector["insert"] = (...args) => getDefault().insert(...args);

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

// mysql2 does not bind plain objects directly; JSON-encode them so they land in
// JSON/text columns instead of erroring. undefined becomes NULL.
function encodeValue(value: unknown): any {
    if (value === undefined)
        return null;
    if (value !== null && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value) && !Buffer.isBuffer(value))
        return JSON.stringify(value);
    return value;
}

function formatBinds(params?: Record<string, any> | any[]): any[] | undefined {
    if (Array.isArray(params))
        return params;
    else if (typeof params === "object" && params !== null)
        return Object.values(params);
    else
        return undefined;
}

// mysql2 returns plain-object rows keyed by the column case from the query and
// converts DATE/DATETIME to JS Date by default, so this is a light passthrough —
// kept to match the shared connector shape and to provide a hook for future
// normalization.
function formatRow(obj: any): any {
    return obj;
}
