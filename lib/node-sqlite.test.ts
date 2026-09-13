import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as nodesqlite from "./node-sqlite.js";
import { NodeSqliteConnector } from "./node-sqlite.js";

use(chaiAsPromised);

// No NODE_SQLITE_CONNECTION env var is set, so the connector opens an in-memory
// (":memory:") database. The connection is a module-scoped singleton, so all
// tests in this file share one database — each test uses its own table.
//
// These mirror sqlite.test.ts case for case: the two SQLite connectors are meant
// to be interchangeable, so the same expectations must hold for both.
describe("node-sqlite", () => {
    describe("query", () => {
        it("returns rows from a created and populated table", async () => {
            await nodesqlite.execute("CREATE TABLE query_rows (id INTEGER, name TEXT)");
            await nodesqlite.execute("INSERT INTO query_rows (id, name) VALUES (1, 'alice'), (2, 'bob')");
            const rows = await nodesqlite.query("SELECT * FROM query_rows ORDER BY id");
            expect(rows).to.deep.equal([
                { id: 1, name: "alice" },
                { id: 2, name: "bob" }
            ]);
        });

        it("binds positional (?) parameters", async () => {
            await nodesqlite.execute("CREATE TABLE query_positional (id INTEGER, name TEXT)");
            await nodesqlite.execute("INSERT INTO query_positional (id, name) VALUES (1, 'alice'), (2, 'bob')");
            const rows = await nodesqlite.query("SELECT name FROM query_positional WHERE id = ?", [2]);
            expect(rows).to.deep.equal([{ name: "bob" }]);
        });

        it("binds named (@name) parameters", async () => {
            await nodesqlite.execute("CREATE TABLE query_named (id INTEGER, name TEXT)");
            await nodesqlite.execute("INSERT INTO query_named (id, name) VALUES (1, 'alice'), (2, 'bob')");
            const rows = await nodesqlite.query("SELECT id FROM query_named WHERE name = @name", { name: "alice" });
            expect(rows).to.deep.equal([{ id: 1 }]);
        });

        it("rejects invalid SQL with query context", async () => {
            await expect(nodesqlite.query("SELECT * FROM does_not_exist")).to.be.rejectedWith(/QUERY:/);
        });
    });

    describe("execute", () => {
        it("runs DDL and DML without returning rows", async () => {
            await nodesqlite.execute("CREATE TABLE execute_test (id INTEGER)");
            await nodesqlite.execute("INSERT INTO execute_test (id) VALUES (?)", [42]);
            const rows = await nodesqlite.query("SELECT id FROM execute_test");
            expect(rows).to.deep.equal([{ id: 42 }]);
        });
    });

    describe("insert", () => {
        it("inserts a single object", async () => {
            await nodesqlite.execute("CREATE TABLE insert_single (id INTEGER, name TEXT)");
            await nodesqlite.insert("insert_single", { id: 1, name: "alice" });
            const rows = await nodesqlite.query("SELECT * FROM insert_single");
            expect(rows).to.deep.equal([{ id: 1, name: "alice" }]);
        });

        it("inserts an array of objects", async () => {
            await nodesqlite.execute("CREATE TABLE insert_array (id INTEGER, name TEXT)");
            await nodesqlite.insert("insert_array", [
                { id: 1, name: "alice" },
                { id: 2, name: "bob" }
            ]);
            const rows = await nodesqlite.query("SELECT * FROM insert_array ORDER BY id");
            expect(rows).to.deep.equal([
                { id: 1, name: "alice" },
                { id: 2, name: "bob" }
            ]);
        });

        it("encodes booleans and objects for storage", async () => {
            await nodesqlite.execute("CREATE TABLE insert_encoded (flag INTEGER, meta TEXT)");
            await nodesqlite.insert("insert_encoded", { flag: true, meta: { a: 1 } });
            const rows = await nodesqlite.query("SELECT * FROM insert_encoded");
            expect(rows).to.deep.equal([{ flag: 1, meta: JSON.stringify({ a: 1 }) }]);
        });

        // node:sqlite binds an unrecognized value as NULL rather than throwing, so
        // a Date would silently lose its value if it were passed through raw.
        it("encodes dates as ISO strings rather than binding them as null", async () => {
            await nodesqlite.execute("CREATE TABLE insert_date (at TEXT)");
            await nodesqlite.insert("insert_date", { at: new Date("2020-01-02T03:04:05.000Z") });
            const rows = await nodesqlite.query("SELECT at FROM insert_date");
            expect(rows).to.deep.equal([{ at: "2020-01-02T03:04:05.000Z" }]);
        });

        it("is a no-op for an empty array", async () => {
            await nodesqlite.execute("CREATE TABLE insert_empty (id INTEGER)");
            await nodesqlite.insert("insert_empty", []);
            const rows = await nodesqlite.query("SELECT * FROM insert_empty");
            expect(rows).to.deep.equal([]);
        });

        it("rejects an unsafe table name", async () => {
            await expect(nodesqlite.insert("bad name; DROP TABLE x", { id: 1 })).to.be.rejected;
        });

        // DatabaseSync has no transaction() helper, so insert() drives BEGIN /
        // COMMIT / ROLLBACK itself — a failed row must leave the table untouched.
        it("rolls back the whole batch when one row fails", async () => {
            await nodesqlite.execute("CREATE TABLE insert_rollback (id INTEGER PRIMARY KEY)");
            await expect(nodesqlite.insert("insert_rollback", [{ id: 1 }, { id: 2 }, { id: 1 }])).to.be.rejected;
            const rows = await nodesqlite.query("SELECT id FROM insert_rollback");
            expect(rows).to.deep.equal([]);
        });
    });

    describe("BLOB round-trip", () => {
        // node:sqlite hands back a bare Uint8Array where better-sqlite3 returns a
        // Buffer; formatRow normalizes it so rows look the same from either.
        it("returns BLOBs as Buffers, matching the better-sqlite3 connector", async () => {
            await nodesqlite.execute("CREATE TABLE blob_test (data BLOB)");
            await nodesqlite.insert("blob_test", { data: Buffer.from("hello") });
            const rows = await nodesqlite.query<{ data: Buffer }>("SELECT data FROM blob_test");
            expect(Buffer.isBuffer(rows[0].data)).to.equal(true);
            expect(rows[0].data.toString()).to.equal("hello");
        });
    });

    describe("constructor config", () => {
        // The string path and the { file } object form must resolve to the same
        // on-disk file: data written through one instance is visible when a fresh
        // instance is opened against the other form of the same path.
        it("accepts a string path and an equivalent { file } object", async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), "node-sqlite-config-"));
            const file = path.join(dir, "data.db");
            try {
                const byString = new NodeSqliteConnector(file);
                await byString.execute!("CREATE TABLE t (id INTEGER)");
                await byString.insert("t", { id: 7 });
                await byString.close!();

                const byObject = new NodeSqliteConnector({ file });
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
            const db = new NodeSqliteConnector({});
            await db.execute!("CREATE TABLE mem (id INTEGER)");
            await db.insert("mem", { id: 1 });
            const rows = await db.query("SELECT id FROM mem");
            await db.close!();
            expect(rows).to.deep.equal([{ id: 1 }]);
        });
    });

    describe("safeValue", () => {
        it("wraps safe strings in quotes", () => {
            expect(nodesqlite.safeValue("hello_world")).to.equal("'hello_world'");
        });

        it("returns null for unsafe strings", () => {
            expect(nodesqlite.safeValue("hello world!")).to.equal("null");
        });

        it("stringifies numbers", () => {
            expect(nodesqlite.safeValue(42)).to.equal("42");
        });

        it("throws for unsupported types", () => {
            expect(() => nodesqlite.safeValue({})).to.throw();
        });
    });
});
