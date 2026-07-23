import { expect } from "chai";
import * as bigquery from "./bigquery.js";

// Requires a .env file with GOOGLE_APPLICATION_CREDENTIALS pointing at a service
// account key (used by BigQuery's application default credentials).
describe.skip("bigquery", () => {
    describe("query", () => {
        it("selects the current timestamp end-to-end", async () => {
            const rows = await bigquery.query<{ ts: Date }>("SELECT CURRENT_TIMESTAMP() AS ts");
            expect(rows).to.have.lengthOf(1);
            expect(rows[0].ts).to.be.an.instanceof(Date);
        });
    });
});
