import type { ClickHouseClient, ClickHouseClientConfigOptions } from "@clickhouse/client";
import chalk from "chalk";
import { BaseConnector, loadDriver, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError } from "./utilities.js";

// `@clickhouse/client` is an optional peer dependency, loaded on first use so
// that importing polysql does not require it to be installed. See `loadDriver`.
type Driver = typeof import("@clickhouse/client");
let driver: Promise<Driver> | undefined;
function loadClickHouse(): Promise<Driver> {
    return driver ??= loadDriver("@clickhouse/client", "ClickHouse", () => import("@clickhouse/client"));
}

/** Connection info accepted by `ClickHouseConnector`: either the driver's own
 * config object, or a `http://user:pass@host:8123/database` URL (the same form
 * the `CLICKHOUSE_CONNECTION` environment variable uses). */
export type ClickHouseConfig = ClickHouseClientConfigOptions | string;

/**
 * A ClickHouse connector bound to explicit connection info instead of the
 * `CLICKHOUSE_CONNECTION` environment variable. Each instance owns its own
 * client, so an app can talk to several servers at once.
 *
 * `config` is either the driver's config object or a
 * `http://user:pass@host:8123/database` URL — which the driver parses itself,
 * including `?param=value` settings. `poolMax` defaults to
 * `CLICKHOUSE_POOL_MAX` (or the driver default) and caps concurrent sockets.
 *
 * The client (and the driver itself) is created lazily on the first
 * `query`/`execute`/`insert`, so constructing a connector never touches the
 * driver. ClickHouse speaks HTTP, so there is no connection to open until a
 * statement runs.
 */
export class ClickHouseConnector extends BaseConnector {
    private options: ClickHouseClientConfigOptions;
    private client: Promise<ClickHouseClient> | undefined;

    constructor(config: ClickHouseConfig, opts?: { poolMax?: number }) {
        super();
        this.options = typeof config === "string" ? { url: config } : { ...config };
        const poolMax = opts?.poolMax ?? (parseInt(process.env.CLICKHOUSE_POOL_MAX!) || undefined);
        if (poolMax !== undefined)
            this.options.max_open_connections = poolMax;
    }

    private getClient(): Promise<ClickHouseClient> {
        if (!this.client) {
            this.client = loadClickHouse().then(clickhouse => {
                if (process.env.VERBOSE)
                    console.log(chalk.gray(`\nCLICKHOUSE CONNECTION: ${JSON.stringify({ ...this.options, password: undefined, url: redactUrl(this.options.url) }, null, 2)}`));
                return clickhouse.createClient(this.options);
            });
        }
        return this.client;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const client = await this.getClient();
        const t0 = Date.now();
        logQuery(query, params);

        let rows: T[];
        try {
            // The driver appends its own FORMAT clause, so the statement must
            // not carry one — and JSON gives us the `{ data: [...] }` envelope
            // holding plain objects.
            const result = await client.query({ query: stripTerminator(query), query_params: formatBinds(params), format: "JSON" });
            const json = await result.json<T>();
            rows = json.data;
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logQueryResult(rows.length, t0);

        return rows.map(row => formatRow(row));
    }

    async execute(query: string, params?: Record<string, any> | any[]): Promise<void> {
        const client = await this.getClient();
        const t0 = Date.now();
        logExecute(query, params);

        try {
            // `command` is the driver's path for statements with no result set
            // (DDL and the like): it takes the SQL verbatim, appends no FORMAT
            // clause, and discards the response stream.
            await client.command({ query: stripTerminator(query), query_params: formatBinds(params) });
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logExecuteResult(t0);
    }

    /**
     * Close the client, releasing its open sockets. Call this on shutdown so the
     * process (or a test runner) can exit cleanly instead of hanging on the
     * driver's keep-alive sockets. Safe to call when no client was ever created
     * (or the driver failed to load).
     */
    async close(): Promise<void> {
        if (this.client) {
            const client = await this.client.catch(() => undefined);
            await client?.close();
            this.client = undefined;
        }
    }

    async insert(table: string, data: Record<string, any> | Array<Record<string, any>>): Promise<void> {
        const list = Array.isArray(data) ? data : [data];
        if (list.length == 0)
            return;
        if (!/^[A-Za-z_][A-Za-z0-9._]*$/.test(table))
            throw `Unsafe table name for query: "${table}"`;

        const client = await this.getClient();
        const t0 = Date.now();

        // The driver has a first-class bulk insert that streams the rows as
        // JSONEachRow, so this backend builds no INSERT statement of its own.
        // Columns are taken from the first row, matching the other connectors.
        const columns = Object.keys(list[0]) as [string, ...string[]];
        const values = list.map(row => Object.fromEntries(columns.map(column => [column, encodeValue(row[column])])));
        try {
            await client.insert({ table, values, columns, format: "JSONEachRow" });
        }
        catch (err) {
            throw wrapQueryError(err, `INSERT INTO ${table} (${columns.join(", ")})`);
        }

        logExecuteResult(t0);
    }
}

/**
 * Build a ClickHouse connector. Retained as a thin wrapper over
 * `new ClickHouseConnector(...)` so callers match the other backends' factories.
 */
export function createClickHouse(config: ClickHouseConfig, opts?: { poolMax?: number }): ClickHouseConnector {
    return new ClickHouseConnector(config, opts);
}

// The default instance: lazily built from `CLICKHOUSE_CONNECTION` on first use,
// preserving the `import { clickhouse } from "polysql"` API used by the other
// backends. Unlike the other remote backends this one has a usable default —
// the driver falls back to http://localhost:8123 with the `default` user — so an
// unset variable is not an error.
let defaultInstance: ClickHouseConnector | undefined;
function getDefault(): ClickHouseConnector {
    return defaultInstance ??= new ClickHouseConnector(process.env.CLICKHOUSE_CONNECTION ?? {});
}

export const query: ClickHouseConnector["query"] = (...args) => getDefault().query(...args);
export const execute: NonNullable<ClickHouseConnector["execute"]> = (...args) => getDefault().execute!(...args);
export const insert: ClickHouseConnector["insert"] = (...args) => getDefault().insert(...args);

/**
 * Close the default instance's client (if one was created) so the process can
 * exit cleanly. A no-op when the default instance was never used.
 */
export async function close(): Promise<void> {
    if (defaultInstance) {
        await defaultInstance.close();
        defaultInstance = undefined;
    }
}

export { safeValue };

// The driver appends its own FORMAT clause to a query, so a trailing semicolon
// would land in the middle of the statement it builds.
function stripTerminator(query: string): string {
    return query.trim().replace(/;$/, "");
}

// ClickHouse binds by name only — `{name:Type}` in the SQL, values passed as
// query_params. A substitution name must be a valid identifier, so a positional
// array is exposed as `p0`, `p1`, ... (write `{p0:UInt32}`) rather than as bare
// numbers, matching the `@pN` convention the SQL Server connector uses for the
// same reason.
function formatBinds(params?: Record<string, any> | any[]): Record<string, unknown> | undefined {
    if (Array.isArray(params))
        return Object.fromEntries(params.map((value, i) => [`p${i}`, value]));
    else if (typeof params === "object" && params !== null)
        return params;
    else
        return undefined;
}

// Values are serialized as JSONEachRow, so objects and arrays travel natively
// into Nested/Map/Array/JSON columns and need no encoding. Only `undefined` has
// no JSON representation, so it becomes NULL.
function encodeValue(value: unknown): any {
    return value === undefined ? null : value;
}

// The JSON format returns plain objects keyed by the column names from the
// query, so this is a light passthrough — kept to match the shared connector
// shape and to provide a hook for future normalization.
function formatRow(obj: any): any {
    return obj;
}

// Strip credentials from the connection URL before it is logged.
function redactUrl(url: ClickHouseClientConfigOptions["url"]): string | undefined {
    if (!url)
        return undefined;
    try {
        const parsed = new URL(url.toString());
        if (parsed.password)
            parsed.password = "***";
        return parsed.toString();
    }
    catch {
        return "***";
    }
}
