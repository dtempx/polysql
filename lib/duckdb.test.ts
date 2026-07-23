import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as duckdb from "./duckdb.js";
import { DuckDBConnector } from "./duckdb.js";

use(chaiAsPromised);

// No DUCKDB_CONNECTION env var is set, so the connector opens an in-memory
// (":memory:") database. The connection is a module-scoped singleton, so all
// tests in this file share one database — each test uses its own table.
describe("duckdb", () => {
    describe("query", () => {
        it("returns rows from a created and populated table", async () => {
            await duckdb.execute("CREATE TABLE query_rows (id INTEGER, name VARCHAR)");
            await duckdb.execute("INSERT INTO query_rows (id, name) VALUES (1, 'alice'), (2, 'bob')");
            const rows = await duckdb.query("SELECT * FROM query_rows ORDER BY id");
            expect(rows).to.deep.equal([
                { id: 1, name: "alice" },
                { id: 2, name: "bob" }
            ]);
        });

        it("binds positional (?) parameters", async () => {
            await duckdb.execute("CREATE TABLE query_positional (id INTEGER, name VARCHAR)");
            await duckdb.execute("INSERT INTO query_positional (id, name) VALUES (1, 'alice'), (2, 'bob')");
            const rows = await duckdb.query("SELECT name FROM query_positional WHERE id = ?", [2]);
            expect(rows).to.deep.equal([{ name: "bob" }]);
        });

        it("binds named ($name) parameters", async () => {
            await duckdb.execute("CREATE TABLE query_named (id INTEGER, name VARCHAR)");
            await duckdb.execute("INSERT INTO query_named (id, name) VALUES (1, 'alice'), (2, 'bob')");
            const rows = await duckdb.query("SELECT id FROM query_named WHERE name = $name", { name: "alice" });
            expect(rows).to.deep.equal([{ id: 1 }]);
        });

        it("rejects invalid SQL with query context", async () => {
            await expect(duckdb.query("SELECT * FROM does_not_exist")).to.be.rejectedWith(/QUERY:/);
        });
    });

    describe("execute", () => {
        it("runs DDL and DML without returning rows", async () => {
            await duckdb.execute("CREATE TABLE execute_test (id INTEGER)");
            await duckdb.execute("INSERT INTO execute_test (id) VALUES (?)", [42]);
            const rows = await duckdb.query("SELECT id FROM execute_test");
            expect(rows).to.deep.equal([{ id: 42 }]);
        });
    });

    describe("insert", () => {
        it("inserts a single object", async () => {
            await duckdb.execute("CREATE TABLE insert_single (id INTEGER, name VARCHAR)");
            await duckdb.insert("insert_single", { id: 1, name: "alice" });
            const rows = await duckdb.query("SELECT * FROM insert_single");
            expect(rows).to.deep.equal([{ id: 1, name: "alice" }]);
        });

        it("inserts an array of objects", async () => {
            await duckdb.execute("CREATE TABLE insert_array (id INTEGER, name VARCHAR)");
            await duckdb.insert("insert_array", [
                { id: 1, name: "alice" },
                { id: 2, name: "bob" }
            ]);
            const rows = await duckdb.query("SELECT * FROM insert_array ORDER BY id");
            expect(rows).to.deep.equal([
                { id: 1, name: "alice" },
                { id: 2, name: "bob" }
            ]);
        });

        it("encodes objects for storage", async () => {
            await duckdb.execute("CREATE TABLE insert_encoded (flag BOOLEAN, meta VARCHAR)");
            await duckdb.insert("insert_encoded", { flag: true, meta: { a: 1 } });
            const rows = await duckdb.query("SELECT * FROM insert_encoded");
            expect(rows).to.deep.equal([{ flag: true, meta: JSON.stringify({ a: 1 }) }]);
        });

        it("is a no-op for an empty array", async () => {
            await duckdb.execute("CREATE TABLE insert_empty (id INTEGER)");
            await duckdb.insert("insert_empty", []);
            const rows = await duckdb.query("SELECT * FROM insert_empty");
            expect(rows).to.deep.equal([]);
        });

        it("rejects an unsafe table name", async () => {
            await expect(duckdb.insert("bad name; DROP TABLE x", { id: 1 })).to.be.rejected;
        });
    });

    describe("constructor config", () => {
        // The string path and the { file } object form must resolve to the same
        // on-disk file: data written through one instance is visible when a fresh
        // instance is opened against the other form of the same path.
        it("accepts a string path and an equivalent { file } object", async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "duckdb-config-"));
            const file = path.join(dir, "data.duckdb");
            try {
                const byString = new DuckDBConnector(file);
                await byString.execute!("CREATE TABLE t (id INTEGER)");
                await byString.insert("t", { id: 7 });
                await byString.close!();

                const byObject = new DuckDBConnector({ file });
                const rows = await byObject.query("SELECT id FROM t");
                await byObject.close!();
                expect(rows).to.deep.equal([{ id: 7 }]);
            }
            finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        });

        // An empty object (no file) falls back to a private in-memory database,
        // just like omitting the argument entirely.
        it("defaults an empty { } object to in-memory", async () => {
            const db = new DuckDBConnector({});
            await db.execute!("CREATE TABLE mem (id INTEGER)");
            await db.insert("mem", { id: 1 });
            const rows = await db.query("SELECT id FROM mem");
            await db.close!();
            expect(rows).to.deep.equal([{ id: 1 }]);
        });
    });

    describe("safeValue", () => {
        it("wraps safe strings in quotes", () => {
            expect(duckdb.safeValue("hello_world")).to.equal("'hello_world'");
        });

        it("returns null for unsafe strings", () => {
            expect(duckdb.safeValue("hello world!")).to.equal("null");
        });

        it("stringifies numbers", () => {
            expect(duckdb.safeValue(42)).to.equal("42");
        });

        it("throws for unsupported types", () => {
            expect(() => duckdb.safeValue({})).to.throw();
        });
    });
});
