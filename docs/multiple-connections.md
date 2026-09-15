# Multiple Connections

By default each connector reads its connection info from the environment and shares a single connection across your whole app:

```javascript
import { snowflake } from "polysql";

// Uses SNOWFLAKE_CONNECTION from the environment.
const rows = await snowflake.query("SELECT 1");
```

That's the simplest way to connect. This page covers the two things the default doesn't do: supplying connection info at runtime, and talking to more than one instance of the same backend at once (for example two Snowflake warehouses, or two BigQuery projects).

## Building a connector from explicit config

Each backend exposes a `create*` factory that takes connection info directly instead of reading the environment. Every factory returns a `Connector`—the same `query` / `execute` / `insert` / `safeValue` surface as the default export.

```javascript
import { createBigQuery, createSnowflake, createSqlite } from "polysql";

const bq = createBigQuery({ projectId: "my-project", keyFilename: "./key.json" });

const sf = createSnowflake({
    account: "myaccount",
    username: "myuser",
    password: "mypass",
    warehouse: "mywh",
    database: "mydb"
});

const lite = createSqlite("./data.db");   // omit the argument for ":memory:"
```

Each call owns its own connection (BigQuery client, Snowflake pool, or SQLite handle). Nothing is shared between instances, so you can hold as many as you need.

### Snowflake also accepts the env-string form

`createSnowflake` accepts either the driver's options object (above) or the same comma-separated `key:value` string used by the `SNOWFLAKE_CONNECTION` environment variable. This is handy when your own config already stores it that way:

```javascript
const sf = createSnowflake("account:myaccount,username:myuser,password:mypass,warehouse:mywh");
```

An optional second argument sets the pool size (it otherwise falls back to `SNOWFLAKE_POOL_MAX`, or 1):

```javascript
const sf = createSnowflake(config, { poolMax: 4 });
```

## Multiple instances of the same backend

Because each factory call is independent, two warehouses (or projects, or databases) are just two instances:

```javascript
import { createSnowflake } from "polysql";

const east = createSnowflake({ account: "acct", warehouse: "WH_EAST", /* ... */ });
const west = createSnowflake({ account: "acct", warehouse: "WH_WEST", /* ... */ });

const [eastRows, westRows] = await Promise.all([
    east.query("SELECT COUNT(*) AS n FROM events"),
    west.query("SELECT COUNT(*) AS n FROM events")
]);
```

The same applies to `createBigQuery` (different projects/credentials) and `createSqlite` (different files or independent `:memory:` databases).

## Config-driven selection: `connect`

When the target backend isn't known until runtime — for example it comes from a config file — pick it by name with `connect`:

```javascript
import { connect, connectorNames } from "polysql";

console.log(connectorNames);          // ["bigquery", "clickhouse", "databricks", "duckdb", "mssql", "mysql", "nodesqlite", "oracle", "postgres", "snowflake", "sqlite"]

// Omit config to use the backend's environment-driven default instance.
const db = connect(appConfig.database);   // e.g. "snowflake"
const rows = await db.query("SELECT 1");

// Pass config to build a fresh instance with explicit connection info.
const west = connect("snowflake", { account: "acct", warehouse: "WH_WEST", /* ... */ });
```

An unknown name throws with the list of supported connectors.

## The `Connector` type

All of the above return a value typed as `Connector`, so code that works against one backend works against any:

```typescript
import type { Connector } from "polysql";

async function loadUsers(db: Connector) {
    return db.query("SELECT * FROM users");
}
```

| Method | Notes |
|--------|-------|
| `query<T>(sql, params?)` | Returns `T[]`. |
| `execute(sql, params?)` | Returns `void`. Optional — BigQuery has no separate execute path. |
| `insert(table, data)` | `data` is an object or array of objects. |
| `safeValue(value)` | Quotes a safe string / stringifies a number for inline use. |

Snowflake instances additionally expose `stage(stageName, file)` (typed as `SnowflakeConnector`).
