import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, connectorNames } from "./index.js";
import { loadDriver } from "./utilities.js";

use(chaiAsPromised);

const dir = path.dirname(fileURLToPath(import.meta.url));

// connector module -> the npm package that backs it, for the drivers that are
// optional peers. `postgres` is deliberately absent: `pg` is small enough
// (~95 kB published, ~450 kB installed) to be a regular dependency imported
// statically, and is covered by its own tests below.
const drivers: Record<string, string> = {
    bigquery: "@google-cloud/bigquery",
    clickhouse: "@clickhouse/client",
    databricks: "@databricks/sql",
    duckdb: "@duckdb/node-api",
    mssql: "mssql",
    mysql: "mysql2",
    oracle: "oracledb",
    snowflake: "snowflake-sdk",
    sqlite: "better-sqlite3"
};

// Drivers are optional peer dependencies: installing polysql installs none of
// them, and `import "polysql"` must succeed when any (or all) are absent. These
// tests pin the two things that make that true — no connector may import its
// driver statically, and the manifest must declare every driver as an optional
// peer — plus the error a caller sees when the driver they need is missing.
describe("drivers", () => {
    describe("are optional peer dependencies", () => {
        for (const [name, pkg] of Object.entries(drivers)) {
            it(`${name} loads ${pkg} lazily`, () => {
                const source = fs.readFileSync(path.join(dir, `${name}.ts`), "utf8");
                const staticImports = source.match(/^import\s+(?!type\b)[^;]*?\sfrom\s+"[^"]+"/gm) ?? [];
                const offenders = staticImports.filter(line => line.includes(`"${pkg}`));
                expect(offenders, `${name}.ts must not statically import ${pkg}`).to.deep.equal([]);
                const escaped = pkg.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
                expect(source, `${name}.ts must load ${pkg} with a dynamic import()`).to.match(new RegExp(`import\\("${escaped}`));
            });
        }

        it("are declared in package.json as optional peers and as dev dependencies", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8"));
            for (const name of Object.values(drivers)) {
                expect(pkg.dependencies ?? {}, `${name} must not be a regular dependency`).to.not.have.property(name);
                expect(pkg.peerDependencies ?? {}, `${name} must be a peer dependency`).to.have.property(name);
                expect(pkg.peerDependenciesMeta?.[name]?.optional, `${name} must be an optional peer`).to.equal(true);
                expect(pkg.devDependencies ?? {}, `${name} must be a dev dependency so the repo builds and tests`).to.have.property(name);
            }
        });

        it("connect() resolves every connector without touching a driver", () => {
            for (const name of connectorNames)
                expect(() => connect(name), name).to.not.throw();
        });
    });

    // `pg` is the one driver polysql depends on outright, so the rules above are
    // inverted for it: it must be a regular dependency and may be imported
    // statically. These pin that decision so a later refactor does not quietly
    // demote it back to an optional peer (or promote another driver alongside it).
    describe("pg is a bundled dependency", () => {
        it("is declared as a regular dependency, not an optional peer", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8"));
            expect(pkg.dependencies ?? {}, "pg must be a regular dependency").to.have.property("pg");
            expect(pkg.peerDependencies ?? {}, "pg must not be a peer dependency").to.not.have.property("pg");
            expect(pkg.peerDependenciesMeta ?? {}, "pg must not have a peer meta entry").to.not.have.property("pg");
            expect(pkg.dependencies ?? {}, "@types/pg must ship with pg because the public .d.ts exposes pg.PoolConfig").to.have.property("@types/pg");
        });

        it("postgres.ts imports pg statically", () => {
            const source = fs.readFileSync(path.join(dir, "postgres.ts"), "utf8");
            expect(source, "postgres.ts must import pg statically").to.match(/^import pg from "pg";$/m);
            expect(source, "postgres.ts must not lazily load pg").to.not.match(/import\("pg"/);
        });
    });

    // Node's built-in SQLite is not an npm package, so it is neither a dependency
    // nor a peer — but it is still loaded lazily, because it does not exist on
    // Node < 22.5 and importing polysql there must not fail.
    describe("node:sqlite is loaded lazily", () => {
        it("is not declared as a dependency of any kind", () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8"));
            for (const field of ["dependencies", "peerDependencies", "devDependencies"])
                expect(pkg[field] ?? {}, `node:sqlite must not appear in ${field}`).to.not.have.property("node:sqlite");
        });

        it("node-sqlite.ts loads node:sqlite with a dynamic import()", () => {
            const source = fs.readFileSync(path.join(dir, "node-sqlite.ts"), "utf8");
            const staticImports = source.match(/^import\s+(?!type\b)[^;]*?\sfrom\s+"[^"]+"/gm) ?? [];
            expect(staticImports.filter(line => line.includes('"node:sqlite"')), "node-sqlite.ts must not statically import node:sqlite").to.deep.equal([]);
            expect(source, "node-sqlite.ts must load node:sqlite with a dynamic import()").to.match(/import\("node:sqlite"/);
        });
    });

    describe("loadDriver", () => {
        it("reports a missing package with the command to install it", async () => {
            const missing = "polysql-driver-that-does-not-exist";
            await expect(loadDriver(missing, "Test", () => import(missing)))
                .to.be.rejectedWith(`The Test connector requires the "${missing}" package, which is not installed. Install it with: npm install ${missing}`);
        });

        it("passes through failures other than a missing package", async () => {
            await expect(loadDriver("pg", "PostgreSQL", () => Promise.reject(new Error("boom"))))
                .to.be.rejectedWith("boom");
        });
    });
});
