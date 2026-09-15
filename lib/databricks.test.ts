import { expect } from "chai";
import { after, describe, it } from "mocha";
import * as databricks from "./databricks.js";

// Requires a .env file with DATABRICKS_CONNECTION set to
// "host:<workspace-host>,path:<http-path>,token:<token>". The connector opens
// its session lazily on first query, so an unconfigured environment fails here
// rather than at import.
describe.skip("databricks", () => {
    after(async () => {
        // Close the session so it doesn't keep the process alive.
        await databricks.close();
    });

    describe("query", () => {
        it("selects the current timestamp end-to-end", async () => {
            const rows = await databricks.query<{ ts: Date }>("SELECT current_timestamp() AS ts");
            expect(rows).to.have.lengthOf(1);
        });

        it("binds positional parameters with ?", async () => {
            const rows = await databricks.query<{ a: number; b: string }>("SELECT ? AS a, ? AS b", [1, "x"]);
            expect(rows[0]).to.deep.equal({ a: 1, b: "x" });
        });

        it("binds named parameters", async () => {
            const rows = await databricks.query<{ v: number }>("SELECT :id AS v", { id: 7 });
            expect(rows[0].v).to.equal(7);
        });
    });

    describe("insert", () => {
        it("round-trips single and multi-row inserts", async () => {
            await databricks.execute("DROP TABLE IF EXISTS polysql_test");
            await databricks.execute("CREATE TABLE polysql_test (id INT, name STRING)");
            await databricks.insert("polysql_test", { id: 1, name: "Alice" });
            await databricks.insert("polysql_test", [{ id: 2, name: "Bob" }, { id: 3, name: "Carol" }]);
            const rows = await databricks.query<{ id: number; name: string }>("SELECT id, name FROM polysql_test ORDER BY id");
            expect(rows).to.deep.equal([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Carol" }]);
            await databricks.execute("DROP TABLE polysql_test");
        });
    });
});
