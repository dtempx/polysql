import type { BigQuery, BigQueryOptions } from "@google-cloud/bigquery";
import { BaseConnector, loadDriver, logQuery, logQueryResult, safeValue, type Connector } from "./utilities.js";

// `@google-cloud/bigquery` is an optional peer dependency, loaded on first use so
// that importing polysql does not require it to be installed. See `loadDriver`.
type Driver = typeof import("@google-cloud/bigquery");
let driver: Promise<Driver> | undefined;
function loadBigQuery(): Promise<Driver> {
    return driver ??= loadDriver("@google-cloud/bigquery", "BigQuery", () => import("@google-cloud/bigquery"));
}

/**
 * A BigQuery connector bound to explicit options instead of the ambient
 * environment. Each instance owns its own client, so an app can hold several
 * (e.g. different projects or credentials) side by side. Pass no options to
 * fall back to Google's application default credentials — the same behavior the
 * module-level `query`/`insert` exports use.
 *
 * The client (and the driver itself) is created lazily on the first
 * `query`/`insert`, so constructing a connector never touches the driver.
 */
export class BigQueryConnector extends BaseConnector {
    private options: BigQueryOptions | undefined;
    private client: Promise<{ bigquery: BigQuery, driver: Driver }> | undefined;

    constructor(options?: BigQueryOptions) {
        super();
        this.options = options;
    }

    private getClient(): Promise<{ bigquery: BigQuery, driver: Driver }> {
        if (!this.client)
            this.client = loadBigQuery().then(driver => ({ driver, bigquery: new driver.BigQuery(this.options) }));
        return this.client;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const { bigquery, driver } = await this.getClient();
        const t0 = Date.now();
        logQuery(query, params);

        const [rows] = await bigquery.query({ query, params });
        logQueryResult(rows.length, t0);

        return rows.map(row => formatRow(row, driver));
    }

    async insert(table: string, data: unknown): Promise<void> {
        const { bigquery } = await this.getClient();
        const [dataset_name, table_name] = table.split(".");
        await bigquery.dataset(dataset_name).table(table_name).insert(data);
    }
}

/**
 * Build a BigQuery connector. Retained as a thin wrapper over
 * `new BigQueryConnector(...)` so existing callers keep working.
 */
export function createBigQuery(options?: BigQueryOptions): Connector {
    return new BigQueryConnector(options);
}

// The default instance: lazily built from application default credentials on
// first use, preserving the original `import { bigquery } from "polysql"` API.
let defaultInstance: Connector | undefined;
function getDefault(): Connector {
    return defaultInstance ??= new BigQueryConnector();
}

export const query: Connector["query"] = (...args) => getDefault().query(...args);
export const insert: Connector["insert"] = (...args) => getDefault().insert(...args);

/**
 * Provided so the single-instance surface is uniformly closeable across
 * backends: callers can `await bigquery.close()` on shutdown like the other
 * connectors. BigQuery keeps no persistent connection, so this only discards
 * the lazily-built default instance (a later `query`/`insert` rebuilds it).
 */
export async function close(): Promise<void> {
    defaultInstance = undefined;
}

export { safeValue };

export function safeUrl(value: unknown): string {
    if (typeof value === "string" && value.length < 500)
        return `'${new URL(value).href.replaceAll("'", "%60")}'`;
    else
        throw `Unsafe value for query: "${value}"`;
}

// BigQuery's date/time wrapper classes come from the driver, which is only
// available once loaded, so the driver module is threaded through for the
// `instanceof` checks.
function formatRow(obj: any, driver: Driver): any {
    if (obj === null || typeof obj !== "object")
        return obj;
    if (Array.isArray(obj))
        return obj.map(item => formatRow(item, driver));
    if (obj instanceof driver.BigQueryDate || obj instanceof driver.BigQueryDatetime || obj instanceof driver.BigQueryTimestamp)
        return new Date(obj.value);
    //if (Object.keys(obj).length === 1 && typeof obj.value === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(obj.value))
        //return new Date(obj.value);
    const result: Record<string, any> = {};
    for (let key of Object.keys(obj))
        result[key] = formatRow(obj[key], driver);
    return result;
}
