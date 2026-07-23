import { expect } from "chai";
import { after, describe, it } from "mocha";
import * as mssql from "./mssql.js";

// Requires a .env file with MSSQL_CONNECTION set to a full connection string.
describe.skip("mssql", () => {
    after(async () => {
        // Close the pool so its open connections don't keep the process alive.
        await mssql.close();
    });

    describe("query", () => {
        it("selects the current timestamp end-to-end", async () => {
            const rows = await mssql.query<{ ts: Date }>("SELECT CURRENT_TIMESTAMP AS ts");
            expect(rows).to.have.lengthOf(1);
            expect(rows[0].ts).to.be.an.instanceof(Date);
        });
    });
});
