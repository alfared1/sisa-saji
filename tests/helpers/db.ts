/**
 * Test DB helpers. The database is seeded once per run (global setup); tests that
 * need pristine data call `reseed()` in beforeAll. Always end the pool in afterAll.
 */
import { createDb, type Db } from "../../src/db/client";
import { seedDatabase } from "../../src/db/seed";
import { TEST_PICKUP_QR_SECRET } from "../setup/constants";

export function testDb(): { db: Db; close: () => Promise<void> } {
  const { db, pool } = createDb(process.env.DATABASE_URL!, { max: 5 });
  return { db, close: () => pool.end() };
}

export async function reseed(db: Db, now = new Date()) {
  return seedDatabase(db, { pickupQrSecret: TEST_PICKUP_QR_SECRET, now });
}
