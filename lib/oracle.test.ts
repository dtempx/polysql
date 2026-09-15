import { expect } from "chai";
import { after, describe, it } from "mocha";
import * as oracle from "./oracle.js";

// Requires a .env file with ORACLE_CONNECTION set to a full connection string,
// e.g. "system/<password>@localhost:1521/FREEPDB1". The connector connects
// lazily on first query, so an unconfigured environment fails here rather than
// at import.
describe.skip("oracle", () => {
    after(async () => {
        // Drain the pool so its open connections don't keep the process alive.
        await oracle.close();
    });

    describe("query", () => {
        it("selects the current timestamp end-to-end", async () => {
            // Oracle requires a FROM clause; DUAL is its one-row system table.
            const rows = await oracle.query<{ ts: Date }>("SELECT CURRENT_TIMESTAMP AS ts FROM DUAL");
            expect(rows).to.have.lengthOf(1);
            expect(rows[0].ts).to.be.an.instanceof(Date);
        });

        it("lower-cases column names", async () => {
            const rows = await oracle.query<{ n: number }>("SELECT 1 AS N FROM DUAL");
            expect(rows[0]).to.have.property("n", 1);
        });

        it("binds positional parameters as :0, :1, ...", async () => {
            const rows = await oracle.query<{ a: number; b: string }>("SELECT :0 AS a, :1 AS b FROM DUAL", [1, "x"]);
            expect(rows[0]).to.deep.equal({ a: 1, b: "x" });
        });

        it("binds named parameters", async () => {
            const rows = await oracle.query<{ v: number }>("SELECT :id AS v FROM DUAL", { id: 7 });
            expect(rows[0].v).to.equal(7);
        });
    });

    describe("insert", () => {
        it("round-trips single and multi-row inserts", async () => {
            await oracle.execute("BEGIN EXECUTE IMMEDIATE 'DROP TABLE polysql_test'; EXCEPTION WHEN OTHERS THEN NULL; END;");
            await oracle.execute("CREATE TABLE polysql_test (id NUMBER, name VARCHAR2(255))");
            await oracle.insert("polysql_test", { id: 1, name: "Alice" });
            await oracle.insert("polysql_test", [{ id: 2, name: "Bob" }, { id: 3, name: "Carol" }]);
            const rows = await oracle.query<{ id: number; name: string }>("SELECT id, name FROM polysql_test ORDER BY id");
            expect(rows).to.deep.equal([{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Carol" }]);
            await oracle.execute("DROP TABLE polysql_test");
        });
    });
});
