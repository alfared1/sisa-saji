import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gt, sql } from "drizzle-orm";
import { jobRuns, surplusBatches } from "../../src/db/schema";
import { acquireLease, runDueJobs, topUpDemoBatches } from "../../src/server/jobs/serverless";
import { reseed, testDb } from "../helpers/db";

const { db, close } = testDb();

beforeAll(async () => {
  await reseed(db);
  await db.delete(jobRuns);
});
afterAll(close);

async function liveCount(now: Date) {
  const soon = new Date(now.getTime() + 20 * 60_000);
  const [r] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(surplusBatches)
    .where(and(eq(surplusBatches.status, "ACTIVE"), gt(surplusBatches.availableStock, 0), gt(surplusBatches.pickupEndTime, soon)));
  return r.n;
}

describe("serverless job leases", () => {
  it("grants a lease once per interval, even to concurrent callers", async () => {
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 8 }, () => acquireLease(db, "test-lease", now, 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await acquireLease(db, "test-lease", new Date(now.getTime() + 30_000), 60_000)).toBe(false);
    expect(await acquireLease(db, "test-lease", new Date(now.getTime() + 61_000), 60_000)).toBe(true);
  });

  it("runDueJobs runs the minute job once and skips it on an immediate second call", async () => {
    const now = new Date();
    const first = await runDueJobs(db, now);
    expect(first.minute.status).toBe("ok");
    expect(first.escalation.status).toBe("ok");
    const second = await runDueJobs(db, new Date(now.getTime() + 5_000));
    expect(second.minute.status).toBe("skipped");
    expect(second.escalation.status).toBe("skipped");
    const [row] = await db.select().from(jobRuns).where(eq(jobRuns.name, "minute"));
    expect(row.lastStatus).toBe("ok");
  });
});

describe("demo top-up", () => {
  it("publishes fresh batches when live batches run low, then stops", async () => {
    const now = new Date();
    // Close every live batch: the demo looks empty.
    await db.update(surplusBatches).set({ status: "EXPIRED" }).where(eq(surplusBatches.status, "ACTIVE"));
    expect(await liveCount(now)).toBe(0);

    const r = await topUpDemoBatches(db, now, { minLive: 10, perMerchant: 2 });
    expect(r.liveBefore).toBe(0);
    expect(r.published).toBeGreaterThanOrEqual(10);
    expect(await liveCount(now)).toBeGreaterThanOrEqual(10);

    // Enough live batches now: nothing more is published.
    const again = await topUpDemoBatches(db, now, { minLive: 10 });
    expect(again.published).toBe(0);
  });

  it("only runs inside runDueJobs when DEMO_MODE=true", async () => {
    const prev = process.env.DEMO_MODE;
    try {
      process.env.DEMO_MODE = "false";
      const off = await runDueJobs(db, new Date(Date.now() + 10 * 60_000));
      expect(off.demoTopUp).toBeUndefined();
      process.env.DEMO_MODE = "true";
      const on = await runDueJobs(db, new Date(Date.now() + 20 * 60_000));
      expect(on.demoTopUp?.status).toBe("ok");
    } finally {
      process.env.DEMO_MODE = prev;
    }
  });
});
