# Postgres-Compatible Databases

Several databases speak the PostgreSQL wire protocol, so polysql's `postgres`
connector talks to them with no code changes — you just point it at a different
connection string. This covers **CockroachDB**, **Amazon Redshift**,
**YugabyteDB**, **AlloyDB**, **TimescaleDB**, and others.

There is no separate `cockroachdb` or `redshift` connector to import — use
`postgres` (or `createPostgres`) with the target's connection string.

## Connecting

Point the default instance at the database by setting `POSTGRES_CONNECTION`:

```bash
# CockroachDB
export POSTGRES_CONNECTION="postgresql://user@host:26257/mydb?sslmode=verify-full"

# Redshift
export POSTGRES_CONNECTION="postgres://user:pass@my-cluster.abc123.us-east-1.redshift.amazonaws.com:5439/mydb"
```

```javascript
import { postgres } from "polysql";

const rows = await postgres.query("SELECT * FROM events WHERE id = $1", [1]);
```

Or build an explicit instance — handy when connecting to a compatible database
alongside a "real" Postgres, or to several at once:

```javascript
import { createPostgres } from "polysql";

const crdb = createPostgres("postgresql://user@host:26257/mydb?sslmode=verify-full");
const rows = await crdb.query("SELECT * FROM events");
```

Everything the Postgres connector offers works unchanged: `query`, `execute`,
`insert`, `$1` numbered parameters, connection pooling, and `close()`.

## What to watch for

The wire protocol is identical, but the databases behave differently in a few
places that can surface through this connector:

- **64-bit integers come back as strings.** Like Postgres `BIGINT`, CockroachDB's
  default `INT` is 64-bit, and the driver returns it as a string (e.g. `"123"`)
  to avoid JavaScript precision loss. Cast in SQL (`id::int`) or convert in your
  code if you need a JS number.

- **CockroachDB serialization retries.** CockroachDB uses `SERIALIZABLE`
  isolation and expects clients to retry transactions that fail with SQLSTATE
  `40001`. polysql surfaces the error rather than retrying — wrap your
  transaction in a retry loop if you run into it under contention.

- **Redshift `insert` at scale.** `insert()` builds a multi-row `INSERT ...
  VALUES` statement. That's fine for small batches, but Redshift is optimized for
  bulk `COPY` from S3 — for large loads, issue a `COPY` via `execute()` instead
  of `insert()`.

- **SQL dialect differences.** These databases each omit or change some Postgres
  features (Redshift has no `jsonb` or upserts; CockroachDB differs on some
  system catalogs). The connector passes your SQL through verbatim, so write SQL
  for the target database, not for Postgres generally.

## Summary

| | |
|---|---|
| Connector to use | `postgres` / `createPostgres` |
| Env var | `POSTGRES_CONNECTION` |
| Driver | `pg` (node-postgres) |
| Works out of the box | connect, `query`, `execute`, `insert`, params, pooling |
| Needs attention | bigint-as-string, CockroachDB `40001` retries, Redshift bulk loads |
