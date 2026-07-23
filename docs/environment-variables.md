# Environment Variables

Each connector's default instance (the one you get from `import { <name> } from
"sqlspy"`) reads its connection info from an environment variable. Use this
table to find the exact variable and string format each one expects; the
sections below document each connector in detail.

| Connector | Variable | Format |
|---|---|---|
| BigQuery | `GOOGLE_APPLICATION_CREDENTIALS` | path to service account key JSON (or ambient credentials) |
| Snowflake | `SNOWFLAKE_CONNECTION` | `key:value,key:value` (`account`, `username`, `password`, `database`, `warehouse`, …) |
| PostgreSQL | `POSTGRES_CONNECTION` | `postgres://<user>:<password>@<host>:<port>/<database>` |
| MySQL | `MYSQL_CONNECTION` | `mysql://<user>:<password>@<host>:<port>/<database>` |
| Microsoft SQL Server | `MSSQL_CONNECTION` | `Server=<host>,<port>;Database=<database>;User Id=<user>;Password=<password>;Encrypt=true` |
| SQLite | `SQLITE_CONNECTION` | file path, or `:memory:` (default when unset) |
| DuckDB | `DUCKDB_CONNECTION` | file path, or `:memory:` (default when unset) |

Pool size overrides (where supported): `SNOWFLAKE_POOL_MAX`, `POSTGRES_POOL_MAX`,
`MYSQL_POOL_MAX`, `MSSQL_POOL_MAX`.

Field names below are **generic placeholders** — substitute your own values.
Do not include the angle brackets.

If you build an explicit instance instead (`create<Name>(...)` or
`connect("<name>", config)`), these variables are not read — you pass the same
information directly as an argument. See [Multi-Instance
Connectors](multi-instance.md).

## BigQuery

BigQuery uses Google Cloud's **application default credentials** rather than a
sqlspy-specific variable. Point the standard Google variable at a service
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
directly to the Snowflake driver's connection options:

```bash
export SNOWFLAKE_CONNECTION="account:<account>,username:<user>,password:<password>,database:<database>,warehouse:<warehouse>"
```

Add any other driver options the same way (e.g. `,schema:<schema>,role:<role>`).

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
