# Environment Variables

Each connector's default instance (the one you get from `import { <name> } from
"polysql"`) reads its connection info from an environment variable. Use this
table to find the exact variable and string format each one expects; the
sections below document each connector in detail.

| Connector | Variable | Format |
|---|---|---|
| BigQuery | `GOOGLE_APPLICATION_CREDENTIALS` | path to service account key JSON (or ambient credentials) |
| Snowflake | `SNOWFLAKE_CONNECTION` | `key:value,key:value` (`account`, `username`, `authenticator`, `privateKeyPath`, `database`, `warehouse`, …) |
| PostgreSQL | `POSTGRES_CONNECTION` | `postgres://<user>:<password>@<host>:<port>/<database>` |
| MySQL | `MYSQL_CONNECTION` | `mysql://<user>:<password>@<host>:<port>/<database>` |
| Microsoft SQL Server | `MSSQL_CONNECTION` | `Server=<host>,<port>;Database=<database>;User Id=<user>;Password=<password>;Encrypt=true` |
| Oracle | `ORACLE_CONNECTION` | `<user>/<password>@<host>:<port>/<service>` |
| ClickHouse | `CLICKHOUSE_CONNECTION` | `http://<user>:<password>@<host>:<port>/<database>` (defaults to `http://localhost:8123` when unset) |
| Databricks SQL | `DATABRICKS_CONNECTION` | `host:<host>,path:<http-path>,token:<token>` |
| SQLite | `SQLITE_CONNECTION` | file path, or `:memory:` (default when unset) |
| DuckDB | `DUCKDB_CONNECTION` | file path, or `:memory:` (default when unset) |

Pool size overrides (where supported): `SNOWFLAKE_POOL_MAX`, `POSTGRES_POOL_MAX`,
`MYSQL_POOL_MAX`, `MSSQL_POOL_MAX`, `ORACLE_POOL_MAX`, `CLICKHOUSE_POOL_MAX`.

Field names below are **generic placeholders** — substitute your own values.
Do not include the angle brackets.

If you build an explicit instance instead (`create<Name>(...)` or
`connect("<name>", config)`), these variables are not read — you pass the same
information directly as an argument. See [Multi-Instance
Connectors](multi-instance.md).

## BigQuery

BigQuery uses Google Cloud's **application default credentials** rather than a
polysql-specific variable. Point the standard Google variable at a service
account key file:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

The project is taken from the key file (or from `GOOGLE_CLOUD_PROJECT` /
`gcloud config`). In environments with ambient credentials — GCE, Cloud Run,
GKE, or a local `gcloud auth application-default login` — no variable is needed
at all.

## Snowflake

Set `SNOWFLAKE_CONNECTION` to a comma-separated `key:value` string. Keys map
directly to the Snowflake driver's connection options. Snowflake authenticates
with **key-pair authentication**: set `authenticator` to `SNOWFLAKE_JWT` and
point `privateKeyPath` at the PEM-encoded private key file registered for the
user:

```bash
export SNOWFLAKE_CONNECTION="account:<account>,username:<user>,authenticator:SNOWFLAKE_JWT,privateKeyPath:<path-to-key>.p8,database:<database>,warehouse:<warehouse>"
```

If the private key file is passphrase-encrypted, add `,privateKeyPass:<passphrase>`.

Add any other driver options the same way (e.g. `,schema:<schema>,role:<role>`).

Notes on the string format — these come from polysql's parser, not the driver:

- Keys are case-sensitive and must use the driver's camelCase names
  (`privateKeyPath`, `privateKeyPass`). The snake_case aliases the driver
  accepts in `connections.toml` (such as `private_key_file`) are not
  recognized here.
- Values cannot contain a comma or a colon. The parser splits on commas, then
  keeps only the text before the first colon of each pair, so a Windows path
  such as `C:\keys\rsa_key.p8` is truncated to `C`. Use a path without a drive
  letter, or build an explicit instance and pass a `ConnectionOptions` object
  instead of a string — see [Multi-Instance Connectors](multi-instance.md).
- The driver's inline `privateKey` option (the PEM text itself) is not
  practical in the string form: the PEM needs real newlines and the parser does
  no unescaping. Use `privateKeyPath`.
- With `VERBOSE=1` the connector logs its connection options at startup and
  masks only `password`. A `privateKeyPass` value will appear in that log, so
  avoid verbose mode where logs are captured.

Optional — re-enable the Snowflake driver's own logging. The Snowflake Node
driver writes log output to the console and to a `snowflake.log` file by
default (which can be distracting). This behavior will be disabled unless
`SNOWFLAKE_DISABLE_LOGGING` is set to any value other than `1` to leave the
driver's logging at its default:

```bash
export SNOWFLAKE_DISABLE_LOGGING="0"
```

Optional — cap the connection pool size (defaults to `1`):

```bash
export SNOWFLAKE_POOL_MAX="<n>"
```

## PostgreSQL

Set `POSTGRES_CONNECTION` to a standard PostgreSQL connection string:

```bash
export POSTGRES_CONNECTION="postgres://<user>:<password>@<host>:<port>/<database>"
```

Append driver options as query parameters, e.g. `?sslmode=require`. The default
port is `5432`. This connector also drives Postgres-compatible databases — see
[Postgres-Compatible Databases](postgres-compatible-databases.md).

Optional — cap the connection pool size (defaults to the `pg` driver default):

```bash
export POSTGRES_POOL_MAX="<n>"
```

## MySQL

Set `MYSQL_CONNECTION` to a standard MySQL connection string:

```bash
export MYSQL_CONNECTION="mysql://<user>:<password>@<host>:<port>/<database>"
```

Append driver options as query parameters, e.g. `?ssl={"rejectUnauthorized":true}`.
The default port is `3306`. This connector also drives MySQL-compatible
databases such as MariaDB.

Optional — cap the connection pool size (defaults to the `mysql2` driver
default):

```bash
export MYSQL_POOL_MAX="<n>"
```

## Microsoft SQL Server

Set `MSSQL_CONNECTION` to a semicolon-delimited `Key=value` connection string:

```bash
export MSSQL_CONNECTION="Server=<host>,<port>;Database=<database>;User Id=<user>;Password=<password>;Encrypt=true;TrustServerCertificate=true"
```

Notes on the fields:

- `Server=<host>,<port>` — the port is comma-separated (SQL Server convention)
  and defaults to `1433`. Use `Server=<host>\<instance>` for a named instance.
- `Encrypt=true` — required by Azure SQL and modern SQL Server; on by default.
- `TrustServerCertificate=true` — add this for self-signed certificates
  (typical for local/dev servers); omit it when the server presents a
  CA-trusted certificate.

Optional — cap the connection pool size (defaults to the `mssql` driver
default):

```bash
export MSSQL_POOL_MAX="<n>"
```

**Troubleshooting — `Failed to connect ... socket hang up`.** If the connection
dies during the TLS handshake with a "socket hang up" error, the server is
likely not configured to accept encrypted connections while the string requests
`Encrypt=true`. Try setting `Encrypt=false` (and dropping
`TrustServerCertificate`, which then has no effect):

```bash
export MSSQL_CONNECTION="Server=<host>,<port>;Database=<database>;User Id=<user>;Password=<password>;Encrypt=false"
```

Note that `Encrypt=false` sends credentials and query traffic unencrypted, so
only use it on a trusted network (e.g. a local dev server). The better fix for
anything reachable over an untrusted network is to enable a TLS certificate on
the SQL Server instance and keep `Encrypt=true`.

## Oracle

Set `ORACLE_CONNECTION` to a `user/password@connect-string` value:

```bash
export ORACLE_CONNECTION="<user>/<password>@<host>:<port>/<service>"
```

The part after `@` is an Oracle *connect string*. The Easy Connect form above is
the common case; a TNS alias or a full descriptor works too. A value with no
`user/password@` prefix is passed through as the connect string on its own, for
external authentication:

```bash
export ORACLE_CONNECTION="<host>:<port>/<service>"
```

The default port is `1521`. On Oracle Free/XE the service name is typically
`FREEPDB1` (or `XEPDB1` on older images).

Notes on this connector:

- **Column names come back lower-cased.** Oracle reports unquoted identifiers in
  upper case; polysql lower-cases them so a row reads the same as it does on
  every other backend — the same normalization the Snowflake connector applies.
- **`execute` and `insert` commit.** Oracle does not autocommit, so without this
  any DML would roll back when the connection returned to the pool.
- **A trailing semicolon is trimmed.** The terminator is a SQL\*Plus convention
  rather than part of the statement, and Oracle rejects it. A PL/SQL block
  ending in `END;` keeps its semicolon, since there it is real syntax.
- The driver runs in **Thin mode** by default and needs no Oracle Client
  libraries. If you need Thick mode, call `oracledb.initOracleClient()` yourself
  before the first query.

Optional — cap the connection pool size (defaults to the `oracledb` default
of 4):

```bash
export ORACLE_POOL_MAX="<n>"
```

## ClickHouse

Set `CLICKHOUSE_CONNECTION` to the server URL, with credentials and database
included:

```bash
export CLICKHOUSE_CONNECTION="http://<user>:<password>@<host>:<port>/<database>"
```

Unlike the other remote backends, this one has a working default: leave the
variable unset and the driver connects to `http://localhost:8123` as the
`default` user, which is what a local ClickHouse install accepts out of the box.

The default port is `8123` (HTTP) or `8443` (HTTPS — use an `https://` URL for
ClickHouse Cloud). Driver settings can be appended as query parameters, and the
URL is parsed by the driver itself rather than by polysql.

Optional — cap the number of concurrent connections (defaults to the driver's
own limit of 10):

```bash
export CLICKHOUSE_POOL_MAX="<n>"
```

## Databricks SQL

Set `DATABRICKS_CONNECTION` to a comma-separated `key:value` string. `host`,
`path`, and `token` are required:

```bash
export DATABRICKS_CONNECTION="host:<workspace-host>,path:<http-path>,token:<token>"
```

- `host` — the workspace hostname with no scheme, e.g.
  `myworkspace.cloud.databricks.com`.
- `path` — the warehouse's **HTTP path**, e.g.
  `/sql/1.0/warehouses/<warehouse-id>`. Find it under *SQL Warehouses →
  your warehouse → Connection details*.
- `token` — a personal access token (*Settings → Developer → Access tokens*).
- `catalog` and `schema` are optional and set the session's initial catalog and
  schema.

The string format is the same one Snowflake uses, and has the same limits:
values cannot contain a comma or a colon — which is why `host` takes no
`https://` prefix. Pass a `ConnectionOptions` object to an explicit instance if
you need a value that would break the parser, or any auth type other than a
token (OAuth, for instance). See [Multiple
Connections](multiple-connections.md).

Unlike the pooled backends there is no `DATABRICKS_POOL_MAX`: the driver holds a
single session that serializes statements, and concurrency comes from the SQL
warehouse rather than from local sockets.

## SQLite

Set `SQLITE_CONNECTION` to a database file path. When unset, it defaults to an
in-memory database that is discarded when the process exits.

```bash
export SQLITE_CONNECTION="<path-to-file>.db"   # e.g. ./data.db
export SQLITE_CONNECTION=":memory:"            # explicit in-memory database
```

## DuckDB

Set `DUCKDB_CONNECTION` to a database file path. When unset, it defaults to an
in-memory database that is discarded when the process exits.

```bash
export DUCKDB_CONNECTION="<path-to-file>.duckdb"   # e.g. ./data.duckdb
export DUCKDB_CONNECTION=":memory:"                # explicit in-memory database
```
