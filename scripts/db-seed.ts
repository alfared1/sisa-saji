/** CLI wrapper: wipes the database and inserts the demo dataset. */
import "dotenv/config";
import { createDb } from "../src/db/client";
import { seedDatabase } from "../src/db/seed";
import { getDatabaseUrl, getPickupQrSecret } from "../src/lib/env";

async function main() {
  const { db, pool } = createDb(getDatabaseUrl(), { max: 1 });
  const summary = await seedDatabase(db, {
    pickupQrSecret: getPickupQrSecret(),
    log: console.log,
    allowPilotWipe: process.env.SEED_WIPE_PILOT === "1",
  });
  console.table(summary);
  console.log(
    "[seed] demo accounts: demo.pembeli@sisasaji.test (+6281200000001), demo.mitra@sisasaji.test (+6281300000001)",
  );
  await pool.end();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
