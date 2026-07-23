import { expect } from "chai";
import { after, describe, it } from "mocha";
import * as postgres from "./postgres.js";

// Requires a .env file with POSTGRES_CONNECTION set to a full connection string.
describe.skip("postgres", () => {
    after(async () => {
        // Drain the pool so its open connections don't keep the process alive.
        await postgres.close();
    });

    describe("query", () => {
        it("selects the current timestamp end-to-end", async () => {
            const rows = await postgres.query<{ ts: Date }>("SELECT CURRENT_TIMESTAMP AS ts");
            expect(rows).to.have.lengthOf(1);
            expect(rows[0].ts).to.be.an.instanceof(Date);
        });
    });
});
