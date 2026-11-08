/**
 * `test` with an auto fixture that guarantees fresh "tonight" batches.
 *
 * Seeded batches expire ~2.5 h after seeding. Before every test that imports
 * this `test`, one cheap query checks that enough batches stay open for at
 * least 30 more minutes; otherwise the e2e DB is re-seeded (db-seed wipes and
 * re-inserts, so call sites must create their own data after this point —
 * which every spec does).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test as base } from "@playwright/test";
import { E2E_DATABASE_URL } from "./env";
import { db } from "./helpers";

const ROOT = path.resolve(__dirname, "..");
const MIN_OPEN_BATCHES = 12;

export async function ensureLiveBatches(): Promise<void> {
  const { rows } = await db().query<{ n: string }>(
    `select count(*) as n from surplus_batches
      where status = 'ACTIVE' and available_stock > 0 and pickup_end_time > now() + interval '30 minutes'`,
  );
  if (Number(rows[0].n) >= MIN_OPEN_BATCHES) return;
  console.log(`[e2e] only ${rows[0].n} open batches left — re-seeding`);
  const res = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/db-seed.ts"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: "inherit",
  });
  if (res.status !== 0) throw new Error("[e2e] re-seed failed");
}

export const test = base.extend<{ liveBatches: void }>({
  liveBatches: [
    async ({}, use) => {
      await ensureLiveBatches();
      await use();
    },
    { auto: true, timeout: 120_000 },
  ],
});

export { expect } from "@playwright/test";
