# Query Parameters

Every connector's `query` and `execute` methods take an optional second argument
of bind parameters. polysql accepts either an **array** (positional) or a
plain **object** (named), but what each underlying database actually supports
differs. Use this table to pick the right placeholder syntax.

| Database    | Positional | Named | Placeholder syntax | Example |
| ----------- | :--------: | :---: | ------------------ | ------- |
| PostgreSQL  | ✅ | — | `$1`, `$2`, …       | `query("SELECT * FROM t WHERE id = $1", [1])` |
| MySQL       | ✅ | — | `?`                | `query("SELECT * FROM t WHERE id = ?", [1])` |
| SQLite      | ✅ | ✅ | `?` or `@name` / `:name` / `$name` | `query("SELECT * FROM t WHERE id = @id", { id: 1 })` |
| DuckDB      | ✅ | ✅ | `?` / `$1` or `$name` | `query("SELECT * FROM t WHERE id = $id", { id: 1 })` |
| SQL Server  | ✅ | — | `@p0`, `@p1`, …    | `query("SELECT * FROM t WHERE id = @p0", [1])` |
| Oracle      | ✅ | ✅ | `:0`, `:1`, … or `:name` | `query("SELECT * FROM t WHERE id = :0", [1])` |
| ClickHouse  | ✅ | ✅ | `{p0:Type}`, … or `{name:Type}` | `query("SELECT * FROM t WHERE id = {p0:UInt32}", [1])` |
| Snowflake   | ✅ | — | `?` or `:1`, `:2`, … | `query("SELECT * FROM t WHERE id = ?", [1])` |
| Databricks  | ✅ | ✅ | `?` or `:name`     | `query("SELECT * FROM t WHERE id = ?", [1])` |
| BigQuery    | ✅ | ✅ | `?` or `@name`     | `query("SELECT * FROM t WHERE id = @id", { id: 1 })` |

> **Positional-only databases and objects:** For the databases that don't support
> named parameters (PostgreSQL, MySQL, SQL Server, Snowflake), passing an object
> still works — polysql flattens it to positional binds in key order via
> `Object.values`. You still write positional placeholders in the SQL, so prefer
> an array to avoid confusion.

> **Oracle and ClickHouse bind by name only.** Neither driver has a bare
> positional marker, so polysql names the values in a positional array `0`, `1`,
> … for Oracle (written `:0`, `:1`) and `p0`, `p1`, … for ClickHouse (written
> `{p0:Type}`) — the same trick the SQL Server connector uses with `@p0`. An
> array still works the way it does everywhere else; only the placeholder text
> differs.

## Examples

### Positional (works everywhere)

```javascript
import { postgres, mysql, snowflake } from "polysql";

// PostgreSQL — $N
await postgres.query("SELECT * FROM users WHERE age > $1 AND city = $2", [21, "NYC"]);

// MySQL — ?
await mysql.query("SELECT * FROM users WHERE age > ? AND city = ?", [21, "NYC"]);

// Snowflake — ?
await snowflake.query("SELECT * FROM users WHERE age > ? AND city = ?", [21, "NYC"]);
```

### SQL Server — `@pN`

polysql binds positional array values as `@p0`, `@p1`, … so reference them by
those names in the SQL:

```javascript
import { mssql } from "polysql";

await mssql.query("SELECT * FROM users WHERE age > @p0 AND city = @p1", [21, "NYC"]);
```

### Oracle — `:0`, `:1`, … or `:name`

Oracle binds by name. polysql names positional array values `0`, `1`, … so they
are referenced as `:0`, `:1` in the SQL:

```javascript
import { oracle } from "polysql";

await oracle.query("SELECT * FROM users WHERE age > :0 AND city = :1", [21, "NYC"]);

// or bind by name
await oracle.query("SELECT * FROM users WHERE age > :age AND city = :city",
    { age: 21, city: "NYC" });
```

### ClickHouse — `{p0:Type}` or `{name:Type}`

ClickHouse placeholders carry the parameter's type, and the name must be a valid
identifier — so positional values are bound as `p0`, `p1`, … rather than as bare
numbers:

```javascript
import { clickhouse } from "polysql";

await clickhouse.query("SELECT * FROM users WHERE age > {p0:UInt8} AND city = {p1:String}",
    [21, "NYC"]);

// or bind by name
await clickhouse.query("SELECT * FROM users WHERE age > {age:UInt8} AND city = {city:String}",
    { age: 21, city: "NYC" });
```

### Databricks — `?` or `:name`

The driver infers each value's SQL type, so placeholders carry no type:

```javascript
import { databricks } from "polysql";

await databricks.query("SELECT * FROM users WHERE age > ? AND city = ?", [21, "NYC"]);

// or bind by name
await databricks.query("SELECT * FROM users WHERE age > :age AND city = :city",
    { age: 21, city: "NYC" });
```

### Named (SQLite, DuckDB, BigQuery)

Pass an object; the keys match the placeholder names:

```javascript
import { sqlite, duckdb, bigquery } from "polysql";

// SQLite — @name / :name / $name
await sqlite.query("SELECT * FROM users WHERE age > @age AND city = @city",
    { age: 21, city: "NYC" });

// DuckDB — $name
await duckdb.query("SELECT * FROM users WHERE age > $age AND city = $city",
    { age: 21, city: "NYC" });

// BigQuery — @name
await bigquery.query("SELECT * FROM users WHERE age > @age AND city = @city",
    { age: 21, city: "NYC" });
```

SQLite, DuckDB, and BigQuery also accept positional arrays if you'd rather keep
one style across your codebase:

```javascript
await sqlite.query("SELECT * FROM users WHERE age > ? AND city = ?", [21, "NYC"]);
await duckdb.query("SELECT * FROM users WHERE age > ? AND city = ?", [21, "NYC"]);
await bigquery.query("SELECT * FROM users WHERE age > ? AND city = ?", [21, "NYC"]);
```
