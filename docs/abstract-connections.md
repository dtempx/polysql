# Abstract Connections

The `connect` function enables the creation of an *abstract* database connection, where the *concrete* backend behind it is decided while the program is running—not fixed in the source by an `import`.

You write against an abstact `Connector` interface:

```typescript
import type { Connector } from "sqlspy";

async function topProducts(db: Connector) {
    return db.query("SELECT name, revenue FROM products ORDER BY revenue DESC LIMIT 10");
}
```

`topProducts` never says *which* warehouse it runs against. Something else—a config value, an environment variable, a per-request header — decides that, and hands the function a bound connection:

```typescript
import { connect } from "sqlspy";

const db = connect(config.database);   // "bigquery" | "snowflake" | "sqlite" | ...
await topProducts(db);
```

The same query now runs against BigQuery in production, SQLite in a test, and Snowflake for a customer who happens to use Snowflake — with no change to `topProducts`.

## How it works

Two properties of the library make runtime binding possible:

1. **One shared `Connector` interface.** Every backend is checked against the same `query` / `execute` / `insert` / `safeValue` shape, so any of them is a drop-in for a variable typed as `Connector`. The type system guarantees a backend can't quietly diverge.
2. **Connections are values, not module globals.** Each `create*` factory returns an independent instance, so a connection is something you *hold and pass around* rather than a fixed singleton reached by import.

Together these make "which database?" a runtime value rather than a compile-time import decision — the defining move of runtime binding.

## When to reach for it

- **Config-driven deployments** — the same build ships to environments backed by different warehouses; a config key selects one.
- **Multi-tenant apps** — different tenants sit on different backends (or different instances of the same backend); bind per request or per tenant.
- **Portable, testable data code** — write logic against `Connector`, run it in tests against an in-memory SQLite instance, and against the real warehouse in production, with identical code paths.
- **Gradual migration** — moving from one warehouse to another becomes a binding change plus differential testing, not a rewrite of every call site.

## A note on SQL dialects

Runtime binding unifies the *connection surface* (`query` / `execute` / `insert` / `safeValue`), not the *SQL dialect*. Query syntax may of course differ between engines — a query using BigQuery-specific syntax will not necessarily run on Snowflake — and reconciling that is the application's responsibility, whether by keeping to portable SQL or by selecting per-backend SQL alongside the bound connection. That's an app-level concern, not a limit on binding: the capability to swap the backend at runtime is there regardless.

## Related

- [Multi-Instance Connections](multi-instance.md) — the factories and config that produce a bound `Connector`, including multiple instances of one backend.
