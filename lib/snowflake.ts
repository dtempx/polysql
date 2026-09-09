import snowflake from "snowflake-sdk";
import chalk from "chalk";
import { BaseConnector, logExecute, logExecuteResult, logQueryResult, safeValue, sleep, wrapQueryError } from "./utilities.js";

if (process.env.SNOWFLAKE_DISABLE_LOGGING === "1" ||  process.env.SNOWFLAKE_DISABLE_LOGGING == undefined)
    snowflake.configure({ logLevel: "OFF" });

export interface LoadResult {
    file: string;
    status: string;
    rows_parsed: number;
    rows_loaded: number;
    error_limit: number;
    errors_seen: number;
    command: string;
}

export class SafeLiteral {
    text: string;
    constructor(text: string) {
        if (!/^[A-Za-z0-9(),'._-]*$/i.test(text))
            throw `Unsafe literal for query: "${text}"`;
        this.text = text;
    }
}

/** Connection info accepted by `SnowflakeConnector`: either the driver's own
 * options object, or the comma-separated "key:value,key:value" string used by
 * the `SNOWFLAKE_CONNECTION` environment variable. */
export type SnowflakeConfig = snowflake.ConnectionOptions | string;

/**
 * A Snowflake connector bound to explicit connection info instead of the
 * `SNOWFLAKE_CONNECTION` environment variable. Each instance owns its own
 * connection pool, so an app can talk to several accounts/warehouses at once.
 * Adds `stage`, the extra unique to this backend, on top of the shared surface.
 *
 * `config` is either a `ConnectionOptions` object or the same
 * "account:a,username:u,password:p,warehouse:WH,..." string the env var uses.
 * `poolMax` defaults to `SNOWFLAKE_POOL_MAX` (or 1), matching the env path.
 */
export class SnowflakeConnector extends BaseConnector {
    private connectionOptions: snowflake.ConnectionOptions;
    private poolMax: number;
    private pool: snowflake.Pool<snowflake.Connection> | undefined;

    constructor(config: SnowflakeConfig, opts?: { poolMax?: number }) {
        super();
        this.connectionOptions = typeof config === "string" ? parseParams<snowflake.ConnectionOptions>(config) : config;
        this.poolMax = opts?.poolMax ?? (parseInt(process.env.SNOWFLAKE_POOL_MAX!) || 1);
    }

    private getPool(): snowflake.Pool<snowflake.Connection> {
        if (!this.pool) {
            this.pool = snowflake.createPool(this.connectionOptions, { min: 0, max: this.poolMax });
            if (process.env.VERBOSE)
                console.log(chalk.gray(`\nSNOWFLAKE CONNECTION: ${JSON.stringify({ ...this.connectionOptions, password: undefined }, null, 2)}`));
        }
        return this.pool;
    }

    async query<T = any>(query: string, params?: any[]): Promise<T[]> {
        const t0 = Date.now();

        const rows = await this.getPool().use(async connection => {
            let result: snowflake.RowStatement;
            try {
                result = await connection.execute({
                    sqlText: query,
                    binds: formatBinds(params)
                });
            }
            catch (err) {
                throw wrapQueryError(err, query, params);
            }
            const rows: T[] = [];
            await new Promise<void>((resolve, reject) =>
                result.streamRows()
                    .on("data", row => rows.push(row))
                    .on("end", resolve)
                    .on("error", reject));
            return rows;
        });

        logQueryResult(rows.length, t0);

        return rows.map(row => formatRow(row));
    }

    async execute(query: string, params?: any[]): Promise<void> {
        const t0 = Date.now();

        logExecute(query, params);

        await this.getPool().use(async connection => {
            const result = await connection.execute({
                sqlText: query,
                binds: formatBinds(params)
            });

            const t1 = Date.now();
            let status = result.getStatus();
            while (status === "fetching") {
                await sleep(100);
                status = result.getStatus();
            }
            if (process.env.VERBOSE) {
                const obj = {
                    sqlText: result.getSqlText(),
                    status: result.getStatus(),
                    columns: result.getColumns(),
                    numRows: result.getNumRows(),
                    numUpdatedRows: result.getNumUpdatedRows(),
                    sessionState: result.getSessionState(),
                    requestId: result.getRequestId(),
                    statementId: result.getStatementId(),
                    queryId: result.getQueryId(),
                    elapsed: Date.now() - t1
                };
                console.log(chalk.gray(JSON.stringify(obj)));
            }
        });

        logExecuteResult(t0);
    }

    async stage(stage_name: string, file: string): Promise<void> {
        const command = `PUT file://${file} @${stage_name} AUTO_COMPRESS=TRUE`;
        await this.execute(command);
    }

    /**
     * Drain and dispose the connection pool, releasing its open connections. Call
     * this on shutdown so the process (or a test runner) can exit cleanly instead
     * of hanging on the pool's still-open connections. Safe to call when no pool
     * was ever created.
     */
    async close(): Promise<void> {
        if (this.pool) {
            await this.pool.drain();
            await this.pool.clear();
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
        const fields = Object.keys(obj).join(", ");
        const params: unknown[] = [];
        const select = list.map(obj => `SELECT ${encodeParamValues(obj, params)}`);
        const q = `INSERT INTO ${table}\n(${fields})\n${select.join(" UNION ALL\n")}`;
        await this.execute(q, params);
    }
}

/**
 * Build a Snowflake connector. Retained as a thin wrapper over
 * `new SnowflakeConnector(...)` so existing callers keep working.
 */
export function createSnowflake(config: SnowflakeConfig, opts?: { poolMax?: number }): SnowflakeConnector {
    return new SnowflakeConnector(config, opts);
}

// The default instance: lazily built from `SNOWFLAKE_CONNECTION` on first use,
// preserving the original `import { snowflake } from "polysql"` API.
let defaultInstance: SnowflakeConnector | undefined;
function getDefault(): SnowflakeConnector {
    if (!defaultInstance) {
        if (!process.env.SNOWFLAKE_CONNECTION)
            throw new Error("Required environment variable SNOWFLAKE_CONNECTION is undefined.");
        defaultInstance = new SnowflakeConnector(process.env.SNOWFLAKE_CONNECTION);
    }
    return defaultInstance;
}

export const query: SnowflakeConnector["query"] = (...args) => getDefault().query(...args);
export const execute: SnowflakeConnector["execute"] = (...args) => getDefault().execute(...args);
export const stage: SnowflakeConnector["stage"] = (...args) => getDefault().stage(...args);
export const insert: SnowflakeConnector["insert"] = (...args) => getDefault().insert(...args);

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

function encodeParamValues(obj: Record<string, unknown>, params: unknown[]): string {
    const result = [];
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (value === null || value === undefined)
            result.push("NULL");
        else if (value instanceof SafeLiteral)
            result.push(value.text);
        else if (value instanceof Array)
            result.push(`PARSE_JSON(:${params.push(JSON.stringify(value))})::ARRAY`);
        else if (typeof value === "object" && value !== null && !(value instanceof Date))
            result.push(`PARSE_JSON(:${params.push(JSON.stringify(value))})`);
        else if (typeof value === "number")
            result.push(value);
        else if (typeof value === "boolean")
            result.push(value ? "TRUE" : "FALSE");
        else
            result.push(`:${params.push(value)}`);
    }
    return result.join(", ");
}

function formatBinds(params?: any[]) {
    if (Array.isArray(params))
        return params;
    else if (typeof params === "object" && params !== null)
        return Object.values(params);
    else
        return undefined;
}

function formatRow(obj: any): any {
    const result: Record<string, any> = {};
    for (let key of Object.keys(obj))
        result[key.toLowerCase()] = formatObj(obj[key]);
    return result;
}

function formatObj(obj: any): any {
    if (obj === null || typeof obj !== "object")
        return obj;
    if (Array.isArray(obj))
        return obj.map(formatObj);
    return obj;
}

function parseParams<T extends {}>(text: string): T {
    if (!text)
        return {} as T;
    const result = {} as Partial<T>;
    const pairs = text.split(",").map(value => value.trim());
    for (const pair of pairs) {
        const [key, value] = pair.split(":").map(value => value.trim());
        (result as Record<string, string>)[key] = value;
    }
    return result as T;
}
