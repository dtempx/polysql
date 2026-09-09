import pg from "pg";
import chalk from "chalk";
import { BaseConnector, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError, type Connector } from "./utilities.js";

/** Connection info accepted by `PostgresConnector`: either the driver's own
 * pool config object, or a `postgres://user:pass@host:port/db` connection
 * string (the same form the `POSTGRES_CONNECTION` environment variable uses). */
export type PostgresConfig = pg.PoolConfig | string;

/**
 * A PostgreSQL connector bound to explicit connection info instead of the
 * `POSTGRES_CONNECTION` environment variable. Each instance owns its own connection
 * pool, so an app can talk to several databases at once.
 *
 * `config` is either a `PoolConfig` object or a `postgres://...` connection
 * string. `poolMax` defaults to `POSTGRES_POOL_MAX` (or the pg default).
 */
export class PostgresConnector extends BaseConnector {
    private poolConfig: pg.PoolConfig;
    private pool: pg.Pool | undefined;

    constructor(config: PostgresConfig, opts?: { poolMax?: number }) {
        super();
        this.poolConfig = typeof config === "string" ? { connectionString: config } : { ...config };
        const poolMax = opts?.poolMax ?? (parseInt(process.env.POSTGRES_POOL_MAX!) || undefined);
        if (poolMax !== undefined)
            this.poolConfig.max = poolMax;
    }

    private getPool(): pg.Pool {
        if (!this.pool) {
            this.pool = new pg.Pool(this.poolConfig);
            if (process.env.VERBOSE)
                console.log(chalk.gray(`\nPOSTGRES CONNECTION: ${JSON.stringify({ ...this.poolConfig, password: undefined, connectionString: this.poolConfig.connectionString ? "***" : undefined }, null, 2)}`));
        }
        return this.pool;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const t0 = Date.now();
        logQuery(query, params);

        let rows: T[];
        try {
            const result = await this.getPool().query(query, formatBinds(params));
            rows = result.rows as T[];
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
        const rows = list.map(row => `(${fields.map(field => `$${params.push(encodeValue(row[field]))}`).join(", ")})`);
        const q = `INSERT INTO ${table} (${fields.join(", ")}) VALUES ${rows.join(", ")}`;
        await this.execute(q, params);
    }
}

/**
 * Build a PostgreSQL connector. Retained as a thin wrapper over
 * `new PostgresConnector(...)` so existing callers keep working.
 */
export function createPostgres(config: PostgresConfig, opts?: { poolMax?: number }): PostgresConnector {
    return new PostgresConnector(config, opts);
}

// The default instance: lazily built from `POSTGRES_CONNECTION` on first use,
// preserving the original `import { postgres } from "polysql"` API.
let defaultInstance: PostgresConnector | undefined;
function getDefault(): PostgresConnector {
    if (!defaultInstance) {
        if (!process.env.POSTGRES_CONNECTION)
            throw new Error("Required environment variable POSTGRES_CONNECTION is undefined.");
        defaultInstance = new PostgresConnector(process.env.POSTGRES_CONNECTION);
    }
    return defaultInstance;
}

export const query: PostgresConnector["query"] = (...args) => getDefault().query(...args);
export const execute: NonNullable<PostgresConnector["execute"]> = (...args) => getDefault().execute!(...args);
export const insert: PostgresConnector["insert"] = (...args) => getDefault().insert(...args);

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

// Normalize values that node-postgres does not bind directly: JSON-encode plain
// objects/arrays so they land in json/jsonb columns instead of erroring.
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

// node-postgres already lowercases unquoted column names and returns JS
// primitives, so this is a light passthrough — kept to match the shared
// connector shape and to provide a hook for future normalization.
function formatRow(obj: any): any {
    return obj;
}
