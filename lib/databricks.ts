import type { DBSQLClient } from "@databricks/sql";
import type { DBSQLParameterValue } from "@databricks/sql/dist/DBSQLParameter";
import type IDBSQLSession from "@databricks/sql/dist/contracts/IDBSQLSession";
import type { ConnectionOptions } from "@databricks/sql/dist/contracts/IDBSQLClient";
import chalk from "chalk";
import { BaseConnector, interopDefault, loadDriver, logExecute, logExecuteResult, logQuery, logQueryResult, safeValue, wrapQueryError } from "./utilities.js";

// `@databricks/sql` is an optional peer dependency, loaded on first use so that
// importing polysql does not require it to be installed. See `loadDriver`.
type Driver = typeof import("@databricks/sql");
let driver: Promise<Driver> | undefined;
function loadDatabricks(): Promise<Driver> {
    return driver ??= loadDriver("@databricks/sql", "Databricks SQL", () => import("@databricks/sql").then(module => interopDefault<Driver>(module)));
}

/** Connection info accepted by `DatabricksConnector`: either the driver's own
 * connection options object, or the comma-separated "key:value,key:value"
 * string used by the `DATABRICKS_CONNECTION` environment variable (`host`,
 * `path`, `token`, and optionally `catalog`/`schema`). */
export type DatabricksConfig = DatabricksConnectionOptions | string;

/** The driver's connection options, plus the initial catalog/schema that
 * polysql passes to `openSession` rather than to `connect`. */
export type DatabricksConnectionOptions = ConnectionOptions & {
    catalog?: string;
    schema?: string;
};

/**
 * A Databricks SQL connector bound to explicit connection info instead of the
 * `DATABRICKS_CONNECTION` environment variable. Each instance owns its own
 * client and session, so an app can talk to several warehouses at once.
 *
 * `config` is either a `ConnectionOptions` object or the same
 * "host:h,path:/sql/1.0/warehouses/w,token:t" string the env var uses.
 *
 * The session (and the `@databricks/sql` driver itself) is opened lazily on the
 * first `query`/`execute`/`insert`, so constructing a connector never touches
 * the driver.
 *
 * Unlike the pooled backends, the driver has no connection pool: a client holds
 * one session that serializes statements, and this connector keeps a single
 * session open for its lifetime rather than paying the round trip to open one
 * per statement. Concurrency comes from the warehouse, not from local sockets,
 * so there is no `poolMax` to set here.
 */
export class DatabricksConnector extends BaseConnector {
    private config: DatabricksConfig;
    private session: Promise<{ client: DBSQLClient; session: IDBSQLSession }> | undefined;

    constructor(config: DatabricksConfig) {
        super();
        this.config = typeof config === "string" ? config : { ...config };
    }

    private getSession(): Promise<{ client: DBSQLClient; session: IDBSQLSession }> {
        if (!this.session) {
            this.session = loadDatabricks().then(async databricks => {
                const { catalog, schema, ...options } = typeof this.config === "string" ? parseParams<DatabricksConnectionOptions>(this.config) : this.config;
                if (!options.host || !options.path || !("token" in options && options.token))
                    throw new Error("Databricks requires host, path, and token. Set DATABRICKS_CONNECTION to \"host:<host>,path:<http-path>,token:<token>\".");
                if (process.env.VERBOSE)
                    console.log(chalk.gray(`\nDATABRICKS CONNECTION: ${JSON.stringify({ ...options, token: undefined, catalog, schema }, null, 2)}`));
                const client = new databricks.DBSQLClient();
                await client.connect(options as ConnectionOptions);
                const session = await client.openSession({ initialCatalog: catalog, initialSchema: schema });
                return { client, session };
            });
            // A failed connect must not be cached as a permanently rejected
            // promise, or every later call reports the first failure instead of
            // retrying. Clearing it here lets the next call reconnect.
            this.session.catch(() => { this.session = undefined; });
        }
        return this.session;
    }

    async query<T = any>(query: string, params?: Record<string, any> | any[]): Promise<T[]> {
        const { session } = await this.getSession();
        const t0 = Date.now();
        logQuery(query, params);

        let rows: T[];
        try {
            const operation = await session.executeStatement(stripTerminator(query), formatBinds(params));
            try {
                rows = await operation.fetchAll() as T[];
            }
            finally {
                // The operation holds a server-side result set until closed,
                // so close it even when the fetch fails.
                await operation.close();
            }
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logQueryResult(rows.length, t0);

        return rows.map(row => formatRow(row));
    }

    async execute(query: string, params?: Record<string, any> | any[]): Promise<void> {
        const { session } = await this.getSession();
        const t0 = Date.now();
        logExecute(query, params);

        try {
            const operation = await session.executeStatement(stripTerminator(query), formatBinds(params));
            try {
                // executeStatement returns once the statement is accepted, so
                // wait for it to finish before reporting success.
                await operation.finished();
            }
            finally {
                await operation.close();
            }
        }
        catch (err) {
            throw wrapQueryError(err, query, params);
        }

        logExecuteResult(t0);
    }

    /**
     * Close the session and its client, releasing the server-side session and
     * the driver's open sockets. Call this on shutdown so the process (or a test
     * runner) can exit cleanly. Safe to call when no session was ever opened (or
     * the driver failed to load).
     */
    async close(): Promise<void> {
        if (this.session) {
            const opened = await this.session.catch(() => undefined);
            this.session = undefined;
            if (opened) {
                await opened.session.close();
                await opened.client.close();
            }
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
        const params: Record<string, unknown> = {};
        const rows = list.map(row => `(${fields.map(field => {
            const name = `p${Object.keys(params).length}`;
            params[name] = encodeValue(row[field]);
            return `:${name}`;
        }).join(", ")})`);
        const q = `INSERT INTO ${table} (${fields.join(", ")}) VALUES ${rows.join(", ")}`;
        await this.execute(q, params);
    }
}

/**
 * Build a Databricks SQL connector. Retained as a thin wrapper over
 * `new DatabricksConnector(...)` so callers match the other backends' factories.
 */
export function createDatabricks(config: DatabricksConfig): DatabricksConnector {
    return new DatabricksConnector(config);
}

// The default instance: lazily built from `DATABRICKS_CONNECTION` on first use,
// preserving the `import { databricks } from "polysql"` API used by the other
// backends.
let defaultInstance: DatabricksConnector | undefined;
function getDefault(): DatabricksConnector {
    if (!defaultInstance) {
        if (!process.env.DATABRICKS_CONNECTION)
            throw new Error("Required environment variable DATABRICKS_CONNECTION is undefined.");
        defaultInstance = new DatabricksConnector(process.env.DATABRICKS_CONNECTION);
    }
    return defaultInstance;
}

export const query: DatabricksConnector["query"] = (...args) => getDefault().query(...args);
export const execute: NonNullable<DatabricksConnector["execute"]> = (...args) => getDefault().execute!(...args);
export const insert: DatabricksConnector["insert"] = (...args) => getDefault().insert(...args);

/**
 * Close the default instance's session (if one was opened) so the process can
 * exit cleanly. A no-op when the default instance was never used.
 */
export async function close(): Promise<void> {
    if (defaultInstance) {
        await defaultInstance.close();
        defaultInstance = undefined;
    }
}

export { safeValue };

// The driver sends the statement as-is, and a trailing semicolon is a syntax
// error on the SQL warehouse.
function stripTerminator(query: string): string {
    return query.trim().replace(/;$/, "");
}

// Databricks binds by name (`:name` markers, `namedParameters`) or by position
// (`?` markers, `ordinalParameters`); the driver infers each value's SQL type.
// Accept the same array-or-object shapes as the other connectors and route each
// to the matching option.
function formatBinds(params?: Record<string, any> | any[]): { ordinalParameters?: DBSQLParameterValue[]; namedParameters?: Record<string, DBSQLParameterValue> } | undefined {
    if (Array.isArray(params))
        return { ordinalParameters: params.map(encodeValue) };
    else if (typeof params === "object" && params !== null)
        return { namedParameters: Object.fromEntries(Object.entries(params).map(([key, value]) => [key, encodeValue(value)])) };
    else
        return undefined;
}

// The driver binds only primitives and Dates; JSON-encode objects and arrays so
// they land in STRING/VARIANT columns instead of erroring. undefined becomes
// NULL — as does null, which the driver does not accept directly.
function encodeValue(value: unknown): any {
    if (value === undefined || value === null)
        return null;
    if (typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value))
        return JSON.stringify(value);
    return value;
}

// The driver returns plain objects keyed by the column names from the query, so
// this is a light passthrough — kept to match the shared connector shape and to
// provide a hook for future normalization.
function formatRow(obj: any): any {
    return obj;
}

// Parse the "key:value,key:value" connection string, matching the Snowflake
// connector's format. Values cannot contain a comma or a colon; pass an options
// object instead when one would.
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
