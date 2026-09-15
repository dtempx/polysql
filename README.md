# PolySQL

A simple data adapter that provides a single, consistent interface for querying across PostgreSQL, MySQL, Microsoft SQL Server, Oracle, SQLite, DuckDB, ClickHouse, Snowflake, Databricks, and BigQuery.

Instead of juggling different SDKs and connection patterns, PolySQL abstracts away the complexity so you can focus on your data. Really useful when dealing with more than one database.

## Supported Databases
- **PostgreSQL** - Open-source relational database
- **MySQL** - Another open-source relational database
- **Microsoft SQL Server** - Microsoft proprietary relational database engine
- **Oracle** - Oracle Database, the long-standing enterprise relational engine
- **SQLite** - Embedded, file-based (or in-memory) SQL database *(via `better-sqlite3`, or Node's built-in `node:sqlite`)*
- **DuckDB** - Embedded, file-based (or in-memory) analytical (OLAP) database
- **ClickHouse** - Column-oriented analytical (OLAP) database, self-hosted or ClickHouse Cloud
- **Snowflake** - Multi-cloud data warehouse *(runs on AWS, Azure, or GCP)*
- **Databricks SQL** - SQL warehouses on the Databricks lakehouse platform
- **BigQuery** - Google Cloud's serverless data warehouse

> Postgres also works with databases that speak the PostgreSQL wire protocol—namely CockroachDB, Redshift, YugabyteDB, AlloyDB, TimescaleDB. [Learn more](docs/postgres-compatible-databases.md)

> MySQL also works with MySQL-compatible databases like MariaDB.

> Each database is reached through its own driver module, installed separately. [See the full list, with versions and install sizes](docs/supported-databases.md)

## Why PolySQL?
Use one simple, consistent interface instead of learning different APIs for each different database engine.

Without PolySQL you need a different coding pattern for each database engine...
```javascript

// Postgres setup
import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgres://...' });
const { rows } = await pool.query('SELECT ...');

// MySQL setup
import mysql from 'mysql2/promise';
const connection = await mysql.createConnection({ host: '...', user: '...' });
const [rows] = await connection.execute('SELECT ...');

// SQL Server setup
import mssql from 'mssql';
const pool = await mssql.connect('Server=host,1433;Database=db;User Id=sa;Password=pw');
const { recordset } = await pool.request().query('SELECT ...');
```


With PolySQL, same pattern everywhere...
```javascript
import { postgres, mysql, mssql } from "polysql";

const r1 = await postgres.query("SELECT ...");
const r2 = await mysql.query("SELECT ...");
const r3 = await mssql.query("SELECT ...");
```

## Key Features
- **Unified Data Interface**: Same query interface across all supported databases.
- **Data Normalization**: Consistent row format result across databases *(returns an array of javascript objects)*.
- **Runtime Connector Abstraction**: Decide at runtime which database environment to connect to.
- **Parameterized Queries**: Supports safe parameter binding—positional and/or named depending on the database. [Learn more](docs/query-parameters.md)

## Installation
`npm install polysql` covers PostgreSQL out of the box — `pg` is small enough (~95 kB) that it ships as a regular dependency. On Node 22.5+ you also get SQLite for free through Node's built-in `node:sqlite`. Add a driver for any other database you use:

```bash
npm install polysql                 # PostgreSQL + node:sqlite, nothing else needed
npm install polysql mysql2          # MySQL / MariaDB
npm install polysql mssql           # Microsoft SQL Server
npm install polysql oracledb        # Oracle
npm install polysql better-sqlite3  # SQLite via better-sqlite3
npm install polysql @duckdb/node-api        # DuckDB
npm install polysql @clickhouse/client      # ClickHouse
npm install polysql snowflake-sdk           # Snowflake
npm install polysql @databricks/sql         # Databricks SQL
npm install polysql @google-cloud/bigquery  # BigQuery
```

The remaining drivers are *optional peer dependencies*: installing polysql installs none of them, so a project only pays for the databases it talks to. Each of those connectors loads its driver the first time it runs a query. If the driver is missing you get an error naming the package to install:

```
The MySQL connector requires the "mysql2" package, which is not installed. Install it with: npm install mysql2
```

| Connector | Class | Driver package |
|---|---|---|
| `postgres` | `PostgresConnector` | `pg` *(bundled with polysql)* |
| `mysql` | `MysqlConnector` | `mysql2` |
| `mssql` | `MssqlConnector` | `mssql` |
| `oracle` | `OracleConnector` | `oracledb` |
| `sqlite` | `SqliteConnector` | `better-sqlite3` |
| `nodesqlite` | `NodeSqliteConnector` | `node:sqlite` *(built into Node 22.5+)* |
| `duckdb` | `DuckDBConnector` | `@duckdb/node-api` |
| `clickhouse` | `ClickHouseConnector` | `@clickhouse/client` |
| `snowflake` | `SnowflakeConnector` | `snowflake-sdk` |
| `databricks` | `DatabricksConnector` | `@databricks/sql` |
| `bigquery` | `BigQueryConnector` | `@google-cloud/bigquery` |

> Versions, install footprint, and memory cost for each driver are in [Supported Databases](docs/supported-databases.md).

> For TypeScript, `mssql` and `oracledb` ship their types separately: add `@types/mssql` and `@types/oracledb` alongside them. `@types/pg` comes with polysql.

## Quick Start
Each connector's default instance reads its connection info from an environment variable. The formats for every connector are documented in [Environment Variables](docs/environment-variables.md).

## Postgres example
```javascript
import { postgres } from "polysql";

await postgres.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)");
await postgres.insert("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);

const rows = await postgres.query("SELECT * FROM users WHERE id = $1", [1]);
for (const row of rows)
    console.log(JSON.stringify(row));
postgres.close();
```

> Set the `POSTGRES_CONNECTION` environment variable to a value like `postgres://myuser:mypass@localhost:5432/mydb`.

## MySQL example
```javascript
import { mysql } from "polysql";

await mysql.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)");
await mysql.insert("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);

const rows = await mysql.query("SELECT * FROM users WHERE id = ?", [1]);
for (const row of rows)
    console.log(JSON.stringify(row));
mysql.close();
```

> Set the `MYSQL_CONNECTION` environment variable to a value like `mysql://myuser:mypass@localhost:3306/mydb`.

## SQL Server example
```javascript
import { mssql } from "polysql";

await mssql.execute("CREATE TABLE users (id INTEGER, name VARCHAR(255))");
await mssql.insert("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);

const rows = await mssql.query("SELECT * FROM users WHERE id = @p0", [1]);
for (const row of rows)
    console.log(JSON.stringify(row));
mssql.close();
```

> Set the `MSSQL_CONNECTION` environment variable to a value like `Server=localhost,1433;Database=mydb;User Id=myuser;Password=mypass;Encrypt=true` or `mssql://myuser:mypass@localhost:1433/mydb`.

## Oracle example
```javascript
import { oracle } from "polysql";

await oracle.execute("CREATE TABLE users (id NUMBER, name VARCHAR2(255))");
await oracle.insert("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);

const rows = await oracle.query("SELECT * FROM users WHERE id = :0", [1]);
for (const row of rows)
    console.log(JSON.stringify(row));
oracle.close();
```

> Set the `ORACLE_CONNECTION` environment variable to a value like `myuser/mypass@localhost:1521/FREEPDB1`.

> Column names come back lower-cased, so `SELECT id FROM users` gives you `row.id` regardless of how Oracle reports the column. Oracle has no autocommit, so `execute` and `insert` commit on your behalf.

## SQLite example
```javascript
import { sqlite } from "polysql";

await sqlite.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)");
await sqlite.insert("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);

const rows = await sqlite.query("SELECT * FROM users WHERE id = ?", [1]);
for (const row of rows)
    console.log(JSON.stringify(row));
```

> Set the `SQLITE_CONNECTION` environment variable to a value that specifies the path to a local file, or leave unspecified and it will default to an in-memory database.

## SQLite example (Node built-in, no install)
On Node 22.5 and later, the `nodesqlite` connector uses Node's own `node:sqlite` module instead of `better-sqlite3` — the same engine and the same files, with nothing to install and no native compile step.

```javascript
import { nodesqlite } from "polysql";

await nodesqlite.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)");
await nodesqlite.insert("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);

const rows = await nodesqlite.query("SELECT * FROM users WHERE id = ?", [1]);
for (const row of rows)
    console.log(JSON.stringify(row));
nodesqlite.close();
```

> Set the `NODE_SQLITE_CONNECTION` environment variable to a value that specifies the path to a local file, or leave unspecified and it will default to an in-memory database.

> Both SQLite backends are synchronous engines that polysql adapts to its async interface, so `await` works the same way on either. [Compare them](docs/supported-databases.md#two-ways-to-reach-sqlite)

## DuckDB example
```javascript
import { duckdb } from "polysql";

await duckdb.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER, name TEXT)");
await duckdb.insert("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);

const rows = await duckdb.query("SELECT * FROM users WHERE id = ?", [1]);
for (const row of rows)
    console.log(JSON.stringify(row));
duckdb.close();
```

> Set the `DUCKDB_CONNECTION` environment variable to a value that specifies the path to a local file, or leave unspecified and it will default to an in-memory database.

## ClickHouse example
```javascript
import { clickhouse } from "polysql";

await clickhouse.execute("CREATE TABLE IF NOT EXISTS users (id UInt32, name String) ENGINE = MergeTree ORDER BY id");
await clickhouse.insert("users", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]);

const rows = await clickhouse.query("SELECT * FROM users WHERE id = {p0:UInt32}", [1]);
for (const row of rows)
    console.log(JSON.stringify(row));
clickhouse.close();
```

> Set the `CLICKHOUSE_CONNECTION` environment variable to a value like `http://myuser:mypass@localhost:8123/mydb`. When unset it defaults to `http://localhost:8123` as the `default` user.

> ClickHouse binds by name only, and every placeholder carries its type — `{name:Type}`. Positional array values are bound as `{p0:Type}`, `{p1:Type}`, … [Learn more](docs/query-parameters.md)

## Snowflake example
```javascript
import { snowflake } from "polysql";

const sql = "SELECT table_schema, table_name, table_type FROM INFORMATION_SCHEMA.TABLES WHERE table_schema != 'INFORMATION_SCHEMA' LIMIT 10";

const rows = await snowflake.query(sql);
for (const row of rows)
    console.log(JSON.stringify(row));
snowflake.close();
```

> Set the `SNOWFLAKE_CONNECTION` environment variable to a value like `account:myaccount,username:myuser,authenticator:SNOWFLAKE_JWT,privateKeyPath:/path/to/rsa_key.p8,database:mydb,warehouse:mywh`. See [Environment Variables](docs/environment-variables.md#snowflake) for details on key-pair authentication.

## Databricks example
```javascript
import { databricks } from "polysql";

const sql = "SELECT * FROM samples.nyctaxi.trips LIMIT 10";

const rows = await databricks.query(sql);
for (const row of rows)
    console.log(JSON.stringify(row));
databricks.close();
```

> Set the `DATABRICKS_CONNECTION` environment variable to a value like `host:myworkspace.cloud.databricks.com,path:/sql/1.0/warehouses/abc123,token:dapi...`. See [Environment Variables](docs/environment-variables.md#databricks-sql) for details.

## BigQuery example
```javascript
import { bigquery } from "polysql";

const sql = "SELECT word, COUNT(*) as word_count FROM bigquery-public-data.samples.shakespeare GROUP BY ALL ORDER BY 2 DESC LIMIT 10";

const rows = await bigquery.query(sql);
for (const row of rows)
    console.log(JSON.stringify(row));
```

> Uses Google Cloud default credentials or a service account key specified in the `GOOGLE_APPLICATION_CREDENTIALS` environment variable. No connection string is required when running within Google Cloud.

## Local Databases
SQLite and DuckDB are *embedded*—the database is a file on disk (or in memory) rather than a server you connect to. [Learn more](docs/local-databases.md)

## Abstract Connections
The `connect` function enables the creation of an *abstract* database connection, where the *concrete* backend behind it is decided while the program is running—not fixed in the source by an `import`. [Learn more](docs/abstract-connections.md)

## Multiple Connections to Same Database Type
Need to pass connection info at runtime, pick a backend from config, or talk to more than one instance of the same database (e.g. two Snowflake warehouses)? [Learn more](docs/multiple-connections.md)

## License
MIT
