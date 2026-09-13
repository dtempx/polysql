# Supported Databases & Driver Modules

Most of polysql's drivers are **optional peer dependencies**: installing polysql
installs none of them, and each connector loads its driver the first time it runs
a query, so a project only pays for the databases it actually talks to.

Two of the drivers below are exceptions, for opposite reasons:

- **`pg` ships with polysql** as a regular dependency and is imported
  statically. PostgreSQL is far and away the most common target — most projects
  reaching for polysql want it — and `pg` is a lean, size-conscious package with
  a short dependency list, so carrying it outright costs little and buys a lot:
  PostgreSQL works straight out of `npm install polysql` with nothing else to
  add and no lazy-loading indirection in the path.
- **`node:sqlite` is built into Node itself**, so there is nothing to install at
  any size. It is still loaded lazily, because it does not exist before Node
  22.5.0 and importing polysql on an older runtime must not fail.

## Driver modules

| Name | Database(s) | Location | Code | npm module |
|---|---|---|---|---|
| Postgres | PostgreSQL, CockroachDB, Amazon Redshift, YugabyteDB, AlloyDB, TimescaleDB | Remote | `PostgresConnector`<br>`POSTGRES_CONNECTION` | [`pg`](https://www.npmjs.com/package/pg) *(bundled)*<br>`^8.22.0`<br>463 kB on disk<br>~9 MB in memory<br>13 dependencies |
| MySQL | MySQL, MariaDB | Remote | `MysqlConnector`<br>`MYSQL_CONNECTION` | [`mysql2`](https://www.npmjs.com/package/mysql2)<br>`^3.23.0`<br>4.0 MB on disk<br>~20 MB in memory<br>11 dependencies |
| SQL Server | Microsoft SQL Server, Azure SQL | Remote | `MssqlConnector`<br>`MSSQL_CONNECTION` | [`mssql`](https://www.npmjs.com/package/mssql)<br>`^12.7.0`<br>48.1 MB on disk<br>~39 MB in memory<br>73 dependencies |
| SQLite | SQLite *(built-in or packaged)* | Local | `NodeSqliteConnector`<br>`NODE_SQLITE_CONNECTION`<br><br>`SqliteConnector`<br>`SQLITE_CONNECTION` | [`node:sqlite`](https://nodejs.org/api/sqlite.html) *(built into Node)*<br>Node ≥ 22.5.0<br>nothing on disk<br>~2 MB in memory<br>no dependencies<br><br>[`better-sqlite3`](https://www.npmjs.com/package/better-sqlite3)<br>`^12.11.1`<br>26.4 MB on disk<br>~4.5 MB in memory<br>1 dependency |
| DuckDB | DuckDB, MotherDuck | Local or Remote | `DuckDBConnector`<br>`DUCKDB_CONNECTION` | [`@duckdb/node-api`](https://www.npmjs.com/package/@duckdb/node-api)<br>`^1.5.4-r.1`<br>61.3 MB on disk<br>~27 MB in memory<br>3 dependencies |
| Snowflake | Snowflake *(on AWS, Azure, or GCP)* | Remote | `SnowflakeConnector`<br>`SNOWFLAKE_CONNECTION` | [`snowflake-sdk`](https://www.npmjs.com/package/snowflake-sdk)<br>`^3.1.0`<br>74.3 MB on disk<br>~62 MB in memory<br>178 dependencies |
| BigQuery | Google BigQuery | Remote | `BigQueryConnector`<br>`GOOGLE_APPLICATION_CREDENTIALS` | [`@google-cloud/bigquery`](https://www.npmjs.com/package/@google-cloud/bigquery)<br>`^8.3.1`<br>12.1 MB on disk<br>~23 MB in memory<br>46 dependencies |

**Location** is where the data lives. *Local* drivers embed the database engine
in your process and read a file on disk (or memory); *remote* drivers are network
clients that talk to a server or a managed cloud service. DuckDB straddles the
two: it is embedded by default, but the same connector also reaches MotherDuck,
its managed cloud service (see below).

**Code** holds the two names you actually type. The first line is the exported
class, for building explicit instances (`new PostgresConnector(...)`); its
lowercase short name is what you import (`import { postgres } from "polysql"`)
and what `connect()` takes (`connect("postgres")`).

The second line is the environment variable the default instance reads for its
connection info — `connect("mysql")` with no arguments picks up
`MYSQL_CONNECTION`. The local engines default to `:memory:` when theirs is
unset, and BigQuery uses Google's standard credentials variable rather than a
polysql-specific one. See [Environment Variables](environment-variables.md) for
each string's format.

**npm module** names the driver package and what adding it costs you. The
version on the second line is the range polysql declares in `peerDependencies`
— the minimum tested version and anything semver-compatible above it; for `pg`
it is the `dependencies` range, and for `node:sqlite` it is the Node version
required. *On disk* is how much the package and everything it pulls in adds to
`node_modules`, and the last line counts the dependencies it brings along. *In
memory* is the resident memory the driver claims when polysql first loads it,
before a single connection is opened — the floor your process pays for having
that database available at all.

The two costs do not track each other, so watch whichever one your deployment
is short on. `better-sqlite3` is a mid-sized install that loads cheaply, because
most of its bulk is a compiled binary the OS maps rather than heap it copies;
`snowflake-sdk` is heavy on both counts and is the most expensive driver here to
merely import.

> DuckDB's disk figure is platform-specific: `@duckdb/node-api` resolves a
> native binary at install time and npm fetches only the binding your machine
> needs — roughly 38 MB on `win32-x64`, the 61 MB measured here on
> `linux-arm64`, 71 MB on `linux-x64`, 113 MB on `darwin-arm64`.

> `better-sqlite3` ships the SQLite amalgamation as C source and compiles it
> during install when no prebuilt binary matches your platform, so it needs a
> working toolchain. Its disk figure includes the C source and the compiled
> output, which is why it is large next to its single dependency — and why a
> platform with a prebuilt binary lands lower.

> Sizes were measured with a clean `npm install <driver>` on Node 24 /
> `linux-arm64`: *on disk* is the apparent size of the resulting `node_modules`,
> and *in memory* is the resident-set growth from importing the driver in a bare
> Node process, averaged over three runs. Both move with platform and version —
> read them as orders of magnitude, not guarantees. Open connections, pools and
> result sets are charged on top of the import cost.

## DuckDB in the cloud: MotherDuck

DuckDB has no server mode — it is an in-process engine, and a database file
takes a single read-write process at a time. Serving it to other machines means
wrapping it in a service of your own, which polysql never sees. The one hosted
option the `duckdb` connector reaches directly is **MotherDuck**, the managed
DuckDB service (a paid product with a free tier).

MotherDuck is not a separate protocol. You open a database named `md:` or
`md:<database>` with the ordinary DuckDB client, so it needs nothing beyond the
driver already in the table — point `DUCKDB_CONNECTION` at it, or pass it to an
explicit instance:

```bash
export MOTHERDUCK_TOKEN="<your-token>"
export DUCKDB_CONNECTION="md:my_database"
```

```javascript
import { DuckDBConnector } from "polysql";

const db = new DuckDBConnector("md:my_database");
```

On first use DuckDB downloads and loads the `motherduck` extension, then
authenticates — with `MOTHERDUCK_TOKEN` if it is set, and otherwise by opening a
browser for an interactive login, which is worth knowing before you run this on
a server. Queries then execute *hybrid*: MotherDuck decides per query what runs
in the cloud and what runs in your process, and local files and cloud tables can
be joined in the same statement.

Everything else about the connector is unchanged — same class, same methods,
same parameter style. Only the connection string moves the data off your
machine.

## Two ways to reach SQLite

polysql ships two SQLite connectors on purpose. `nodesqlite` is the one to
prefer: `node:sqlite` is part of the Node runtime, so it adds **zero
dependencies** — no package to install, no native addon to compile, nothing to
audit or update, and no effect on image size or cold start. That is the whole
point of supporting it.

The catch is that it only exists from Node 22.5.0 onward. `sqlite`
(`better-sqlite3`) is the answer for everything downlevel of that — an older
runtime you do not control, a Node 18 or 20 LTS deployment, a platform whose
image is pinned — and it is also the one to pick when you need what the built-in
module does not offer: loadable extensions, online backup, worker threads, or
fine-grained bigint control.

Both drive the same database engine and the same files and expose the identical
connector surface, so the choice is only about what you want to install and
which Node you run on.

| | `sqlite` (`better-sqlite3`) | `nodesqlite` (`node:sqlite`) |
|---|---|---|
| Install cost | 12.6 MB, native addon, compiles at install | nothing — part of Node |
| Node required | 16+ | 22.5.0+ *(22.13+ or 23.4+ without a flag)* |
| Execution model | synchronous | synchronous |
| Transactions | `db.transaction()` helper, nested via savepoints | driven with explicit `BEGIN`/`COMMIT` |
| Extras | extensions, online backup, worker threads, bigint controls | smaller API surface |

**Both engines are synchronous.** `node:sqlite`'s `DatabaseSync` returns rows
directly from `prepare().all()`, and `better-sqlite3` is synchronous by design
too — that is its central premise, not an omission. polysql adapts *both* to the
same async connector surface, so `query`, `execute` and `insert` are awaitable
and interchangeable with every other backend:

```javascript
import { connect } from "polysql";

// identical code either way — only the name changes
const db = connect(process.env.NODE_MAJOR >= 22 ? "nodesqlite" : "sqlite");
await db.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)");
const rows = await db.query("SELECT * FROM users WHERE id = ?", [1]);
```

The `await` is interface compatibility, not concurrency: the query still runs
synchronously on the main thread and blocks the event loop while it does. That is
fine for the local-file workloads SQLite is built for, but it does mean a slow
query stalls the process rather than yielding, on either connector.

Two smaller differences polysql smooths over on the `nodesqlite` side:

- `node:sqlite` returns BLOBs as bare `Uint8Array`s; the connector converts them
  to `Buffer`s so a row looks the same from either.
- `node:sqlite` binds a value it does not recognize — a `Date`, for instance — as
  `NULL` instead of throwing. The connector encodes dates as ISO 8601 strings so
  they cannot silently vanish.

> `node:sqlite` landed in Node 22.5.0 behind `--experimental-sqlite`, and is
> available unflagged from 22.13.0 and 23.4.0 onward. On a runtime without it,
> the `nodesqlite` connector throws an error naming the Node version you are on
> and pointing at `sqlite` as the alternative — but only when you first use it,
> so `import "polysql"` still works everywhere.

## Installing

`npm install polysql` gives you PostgreSQL (via the bundled `pg`) and, on Node
22.5+, SQLite through `nodesqlite`. Add a driver for any other database you use:

```bash
npm install polysql                         # PostgreSQL + node:sqlite, nothing else needed
npm install polysql mysql2                  # MySQL / MariaDB
npm install polysql mssql                   # Microsoft SQL Server
npm install polysql better-sqlite3          # SQLite via better-sqlite3
npm install polysql @duckdb/node-api        # DuckDB
npm install polysql snowflake-sdk           # Snowflake
npm install polysql @google-cloud/bigquery  # BigQuery
```

If an optional driver is missing at query time, the connector fails with an error
naming the package to install:

```
The MySQL connector requires the "mysql2" package, which is not installed. Install it with: npm install mysql2
```

For TypeScript, `mssql` ships its types separately — add `@types/mssql` alongside
it. `@types/pg` comes with polysql already, because the published types expose
`pg.PoolConfig`. The remaining drivers bundle their own.

## See also

- [Local Databases](local-databases.md) — working with the embedded SQLite and DuckDB backends
- [Postgres-Compatible Databases](postgres-compatible-databases.md) — using the `postgres` connector with CockroachDB, Redshift, and friends
- [Environment Variables](environment-variables.md) — connection string formats for every connector
