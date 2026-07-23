# Query Parameters

Every connector's `query` and `execute` methods take an optional second argument
of bind parameters. sqlspy accepts either an **array** (positional) or a
plain **object** (named), but what each underlying database actually supports
differs. Use this table to pick the right placeholder syntax.

| Database    | Positional | Named | Placeholder syntax | Example |
| ----------- | :--------: | :---: | ------------------ | ------- |
| PostgreSQL  | ✅ | — | `$1`, `$2`, …       | `query("SELECT * FROM t WHERE id = $1", [1])` |
| MySQL       | ✅ | — | `?`                | `query("SELECT * FROM t WHERE id = ?", [1])` |
| SQLite      | ✅ | ✅ | `?` or `@name` / `:name` / `$name` | `query("SELECT * FROM t WHERE id = @id", { id: 1 })` |
| DuckDB      | ✅ | ✅ | `?` / `$1` or `$name` | `query("SELECT * FROM t WHERE id = $id", { id: 1 })` |
| SQL Server  | ✅ | — | `@p0`, `@p1`, …    | `query("SELECT * FROM t WHERE id = @p0", [1])` |
| Snowflake   | ✅ | — | `?` or `:1`, `:2`, … | `query("SELECT * FROM t WHERE id = ?", [1])` |
| BigQuery    | ✅ | ✅ | `?` or `@name`     | `query("SELECT * FROM t WHERE id = @id", { id: 1 })` |

> **Positional-only databases and objects:** For the databases that don't support
> named parameters (PostgreSQL, MySQL, SQL Server, Snowflake), passing an object
> still works — sqlspy flattens it to positional binds in key order via
> `Object.values`. You still write positional placeholders in the SQL, so prefer
> an array to avoid confusion.

## Examples

### Positional (works everywhere)

```javascript
import { postgres, mysql, snowflake } from "sqlspy";

// PostgreSQL — $N
await postgres.query("SELECT * FROM users WHERE age > $1 AND city = $2", [21, "NYC"]);

// MySQL — ?
await mysql.query("SELECT * FROM users WHERE age > ? AND city = ?", [21, "NYC"]);

// Snowflake — ?
await snowflake.query("SELECT * FROM users WHERE age > ? AND city = ?", [21, "NYC"]);
```

### SQL Server — `@pN`

sqlspy binds positional array values as `@p0`, `@p1`, … so reference them by
those names in the SQL:

```javascript
import { mssql } from "sqlspy";

await mssql.query("SELECT * FROM users WHERE age > @p0 AND city = @p1", [21, "NYC"]);
```

### Named (SQLite, DuckDB, BigQuery)

Pass an object; the keys match the placeholder names:

```javascript
import { sqlite, duckdb, bigquery } from "sqlspy";

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
