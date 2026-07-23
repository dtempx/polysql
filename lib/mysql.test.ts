import { expect } from "chai";
import { after, describe, it } from "mocha";
import * as mysql from "./mysql.js";

// Requires a .env file with MYSQL_CONNECTION set to a full connection string.
describe.skip("mysql", () => {
    after(async () => {
        // Drain the pool so its open connections don't keep the process alive.
        await mysql.close();
    });

    describe("query", () => {
        it("selects the current timestamp end-to-end", async () => {
            const rows = await mysql.query<{ ts: Date }>("SELECT CURRENT_TIMESTAMP AS ts");
            expect(rows).to.have.lengthOf(1);
            expect(rows[0].ts).to.be.an.instanceof(Date);
        });
    });
});
