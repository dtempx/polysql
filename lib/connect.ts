import * as bigquery from "./bigquery.js";
import * as duckdb from "./duckdb.js";
import * as mssql from "./mssql.js";
import * as mysql from "./mysql.js";
import * as postgres from "./postgres.js";
import * as snowflake from "./snowflake.js";
import * as sqlite from "./sqlite.js";
import { BigQueryConnector } from "./bigquery.js";
import { DuckDBConnector } from "./duckdb.js";
import { MssqlConnector } from "./mssql.js";
import { MysqlConnector } from "./mysql.js";
import { PostgresConnector } from "./postgres.js";
import { SnowflakeConnector } from "./snowflake.js";
import { SqliteConnector } from "./sqlite.js";
import type { Connector } from "./utilities.js";

/**
 * The set of backends that can be selected by name. Each module exposes:
 *  - the shared Connector surface as its default (env-driven) instance, and
 *  - a connector class instantiated from explicit config.
 */
const registry = {
    bigquery: { default: bigquery, create: (config?: any) => new BigQueryConnector(config) },
    duckdb: { default: duckdb, create: (config?: any) => new DuckDBConnector(config) },
    mssql: { default: mssql, create: (config?: any) => new MssqlConnector(config) },
    mysql: { default: mysql, create: (config?: any) => new MysqlConnector(config) },
    postgres: { default: postgres, create: (config?: any) => new PostgresConnector(config) },
    snowflake: { default: snowflake, create: (config?: any) => new SnowflakeConnector(config) },
    sqlite: { default: sqlite, create: (config?: any) => new SqliteConnector(config) }
} satisfies Record<string, { default: Connector; create: (config?: any) => Connector }>;

export type ConnectorName = keyof typeof registry;

/**
 * The names of every registered backend, for validation/enumeration.
 */
export const connectorNames = Object.keys(registry) as ConnectorName[];

/**
 * Pick a backend by name at runtime instead of importing a hard-coded namespace.
 *
 * Omit `config` to get the backend's default instance, which pulls connection
 * info from the environment (the original way of working — unchanged):
 *
 *   const db = connect(appConfig.database);   // e.g. "snowflake"
 *
 * Pass `config` to build a fresh instance with explicit connection info, so an
 * app can hold several instances of the same backend (e.g. two Snowflake
 * warehouses) side by side:
 *
 *   const east = connect("snowflake", { account, warehouse: "WH_EAST", ... });
 *   const west = connect("snowflake", "account:a,warehouse:WH_WEST,...");
 */
export function connect(name: string, config?: unknown): Connector {
    if (!(name in registry))
        throw new Error(`Unknown connector "${name}". Supported connectors: ${connectorNames.join(", ")}.`);
    const entry = registry[name as ConnectorName];
    return config === undefined ? entry.default : entry.create(config);
}
