import { expect } from "chai";
import * as snowflake from "./snowflake.js";

// Requires a .env file with SNOWFLAKE_CONNECTION. The connector connects lazily
// on first query, so an unconfigured environment fails here rather than at import.
describe.skip("snowflake", () => {
    describe("query", () => {
        it("selects the current timestamp end-to-end", async () => {
            const rows = await snowflake.query<{ ts: Date }>("SELECT CURRENT_TIMESTAMP AS ts");
            expect(rows).to.have.lengthOf(1);
            expect(rows[0].ts).to.be.an.instanceof(Date);
        });
    });
});
