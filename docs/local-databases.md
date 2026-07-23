# Local (Embedded) Databases

Two of sqlspy's backends are **embedded**: the database is a file on your own
disk (or lives entirely in memory), with no server to run and nothing to connect
to over the network.

- **SQLite** — the ubiquitous embedded transactional (OLTP) engine.
- **DuckDB** — an embedded analytical (OLAP) engine.

The other five backends — PostgreSQL, MySQL, SQL Server, BigQuery, and Snowflake
— are **client/server**: they talk to a running database process (local or
remote) or a managed cloud service. There is no local database file to point at,
so this page does not apply to them.

## Choosing where the file lives

For the embedded backends, the "connection string" is simply a file path. You can
supply it three ways, from most to least implicit:

### 1. Environment variable (the default instance)

The default `sqlite` / `duckdb` exports read a path from the environment. When the
variable is unset, they open a private **in-memory** database that disappears when
the process exits.

```bash
export SQLITE_CONNECTION="./data.db"
export DUCKDB_CONNECTION="./analytics.duckdb"
```

```javascript
import { sqlite, duckdb } from "sqlspy";

await sqlite.query("SELECT * FROM users");     // uses SQLITE_CONNECTION
await duckdb.query("SELECT * FROM events");     // uses DUCKDB_CONNECTION
```

Use `":memory:"` explicitly to force an ephemeral database even if you want to be
clear about intent:

```bash
export SQLITE_CONNECTION=":memory:"
```

### 2. A factory / constructor argument

To decide the path in code — or to open several databases at once — pass it to the
`create*` factory (or the connector class). This is the interface the underlying
drivers use (`new Database(path)` for SQLite, `DuckDBInstance.create(path)` for
DuckDB), so it should feel familiar.

```javascript
import { createSqlite, createDuckDB } from "sqlspy";

const app = createSqlite("./data.db");
const scratch = createSqlite();                 // omit for an in-memory database
const olap = createDuckDB("./analytics.duckdb");
```

Each instance owns its own file handle, so nothing is shared between them — see
[Multi-Instance Connectors](multi-instance.md).

### 3. A config object

The factories also accept a `{ file }` object. This is the same object shape the
server backends take, which keeps config-driven code uniform — you can build a
`{ file }` (or `{ ... }`) object per backend and hand it to whichever connector is
selected without special-casing the embedded ones:

```javascript
import { createDuckDB } from "sqlspy";
import { connect } from "sqlspy";

const db = createDuckDB({ file: "./analytics.duckdb" });

// Also works through the runtime selector:
const db2 = connect("sqlite", { file: "./data.db" });
const db3 = connect("sqlite", "./data.db");     // the string form works too
```

An empty object (`{}`) or an omitted `file` falls back to `":memory:"`, matching
the no-argument default.

## Why there is no `open()` method

A natural question is whether the embedded connectors should expose an
`open(file)` method. They deliberately don't: the file location is **construction
config**, not a runtime action. Passing the path when you build the connector
(options 2 and 3 above) is the single, unambiguous way to say where the data
lives, and it matches every embedded driver in the wider ecosystem
(`sqlite3.connect(path)`, `sql.Open("sqlite", path)`, `Connection::open(path)`).

Opening is **lazy**: the file isn't touched until the first `query` / `execute` /
`insert`, so constructing a connector is cheap and side-effect-free. The
counterpart to "open" is [`close()`](multi-instance.md#the-connector-type), which
releases the handle (and the file lock) when you're done:

```javascript
const db = createSqlite("./data.db");
await db.query("SELECT 1");   // file opened here, on first use
await db.close();             // handle + file lock released
```

## In-memory databases are per-instance

Every in-memory connector is its own isolated database. Two `createSqlite()`
instances do **not** share data, and neither survives process exit. Reach for a
file path whenever you need persistence or need two parts of your app to see the
same data.

## Summary

| | SQLite | DuckDB |
|---|---|---|
| Kind | Embedded OLTP | Embedded OLAP |
| Env var | `SQLITE_CONNECTION` | `DUCKDB_CONNECTION` |
| Default when unset | `":memory:"` | `":memory:"` |
| Factory | `createSqlite(path \| { file })` | `createDuckDB(path \| { file })` |
| Driver | `better-sqlite3` | `@duckdb/node-api` |

The client/server backends (PostgreSQL, MySQL, SQL Server, BigQuery, Snowflake)
have no local-file mode — see [Environment Variables](environment-variables.md)
for their connection formats.
