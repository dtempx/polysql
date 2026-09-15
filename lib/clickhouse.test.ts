import { expect } from "chai";
import { after, describe, it } from "mocha";
import * as clickhouse from "./clickhouse.js";

// Requires a ClickHouse server. With CLICKHOUSE_CONNECTION unset the connector
// falls back to the driver's own default, http://localhost:8123 as `default`.
describe.skip("clickhouse", () => {
    after(async () => {
        // Close the client so its keep-alive sockets don't keep the process alive.
        await clickhouse.close();
    });

    describe("query", () => {
        it("selects the current timestamp end-to-end", async () => {
            const rows = await clickhouse.query<{ ts: string }>("SELECT now() AS ts");
            expect(rows).to.have.lengthOf(1);
            expect(rows[0].ts).to.be.a("string");
        });

        it("binds positional parameters as {p0}, {p1}, ...", async () => {
            const rows = await clickhouse.query<{ a: number; b: string }>("SELECT {p0:UInt32} AS a, {p1:String} AS b", [42, "x"]);
            expect(rows[0]).to.deep.equal({ a: 42, b: "x" });
        });

        it("binds named parameters", async () => {
            const rows = await clickhouse.query<{ named: string }>("SELECT {name:String} AS named", { name: "polysql" });
            expect(rows[0].named).to.equal("polysql");
        });

        it("returns an empty array when nothing matches", async () => {
            expect(await clickhouse.query("SELECT 1 AS n WHERE 0")).to.deep.equal([]);
        });

        it("tolerates a trailing semicolon", async () => {
            const rows = await clickhouse.query<{ n: number }>("SELECT 7 AS n;");
            expect(rows[0].n).to.equal(7);
        });
    });

    describe("insert", () => {
        it("round-trips single and multi-row inserts", async () => {
            await clickhouse.execute("DROP TABLE IF EXISTS polysql_test");
            await clickhouse.execute("CREATE TABLE polysql_test (id UInt32, name String) ENGINE = MergeTree ORDER BY id");
            await clickhouse.insert("polysql_test", { id: 1, name: "Alice" });
            await clickhouse.insert("polysql_test", [{ id: 2, name: "Bob" }, { id: 3, name: "Carol" }]);
            const rows = await clickhouse.query<{ id: number; name: string }>("SELECT id, name FROM polysql_test ORDER BY id");
            expect(rows).to.deep.equal([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Carol" }]);
            await clickhouse.execute("DROP TABLE polysql_test");
        });
    });
});
