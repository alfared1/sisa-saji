import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { jobRuns, merchants, surplusBatches } from "../../src/db/schema";
import { nearestCampus } from "../../src/lib/campuses";
import { CAMPUSES, HOME_REGION } from "../../src/lib/constants";
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
  /** Live batches of open warung per hub (warung grouped by their nearest hub). */
  async function liveByHub(now: Date) {
    const soon = new Date(now.getTime() + 20 * 60_000);
    const rows = await db
      .select({ lat: merchants.latitude, lng: merchants.longitude, n: sql<number>`COUNT(${surplusBatches.id})::int` })
      .from(merchants)
      .leftJoin(
        surplusBatches,
        and(
          eq(surplusBatches.merchantId, merchants.id),
          eq(surplusBatches.status, "ACTIVE"),
          gt(surplusBatches.availableStock, 0),
          gt(surplusBatches.pickupEndTime, soon),
        ),
      )
      .where(eq(merchants.isOpen, true))
      .groupBy(merchants.id);
    const out = Object.fromEntries(CAMPUSES.map((c) => [c.id, 0])) as Record<string, number>;
    for (const r of rows) out[nearestCampus(r)!.campus.id] += r.n;
    return out;
  }
  const expireAll = () => db.update(surplusBatches).set({ status: "EXPIRED" }).where(eq(surplusBatches.status, "ACTIVE"));
  const homeHubs = CAMPUSES.filter((c) => c.region === HOME_REGION).map((c) => c.id as string);

  it("serves empty hubs first (Bogor first among equals), within maxPublish", async () => {
    const now = new Date();
    await expireAll();
    expect(await liveCount(now)).toBe(0);

    // All hubs are empty: ties go to the home region, one warung (2 menus) per hub.
    const first = await topUpDemoBatches(db, now, { maxPublish: 6, perMerchant: 2 });
    expect(first.liveBefore).toBe(0);
    expect(first.published).toBe(6);
    expect(first.byHub).toEqual({ ipb: 2, bogor: 2, cibinong: 2 });

    // Next pass: every hub that is still empty gets food before Bogor gets more.
    const second = await topUpDemoBatches(db, now, { maxPublish: 2 * CAMPUSES.length });
    expect(second.published).toBe(2 * CAMPUSES.length);
    const hubs = await liveByHub(now);
    for (const c of CAMPUSES) expect(hubs[c.id], c.id).toBeGreaterThan(0);
    expect(await liveCount(now)).toBe(first.published + second.published);
  });

  it("keeps calling until every hub meets its target, Bogor hubs richest, then stops", async () => {
    const now = new Date();
    await expireAll();
    let total = 0;
    let calls = 0;
    for (;;) {
      const r = await topUpDemoBatches(db, now, { maxPublish: 24 });
      expect(r.published).toBeLessThanOrEqual(24);
      calls++;
      if (r.published === 0) break;
      total += r.published;
      expect(calls).toBeLessThan(20);
    }
    expect(calls).toBeGreaterThan(1); // bounded per call: the full refill took several runs
    const hubs = await liveByHub(now);
    expect(Object.values(hubs).reduce((a, b) => a + b, 0)).toBe(total);
    for (const c of CAMPUSES) {
      expect(hubs[c.id], c.id).toBeGreaterThanOrEqual(4);
    }
    // ipb (14 warung) and Kota Bogor (10) reach the home target; Cibinong has only
    // 4 warung × 2 menus, so it ends at its capacity of 8.
    expect(hubs.ipb).toBeGreaterThanOrEqual(10);
    expect(hubs.bogor).toBeGreaterThanOrEqual(10);
    expect(hubs.cibinong).toBe(8);
    const maxAway = Math.max(...CAMPUSES.filter((c) => !homeHubs.includes(c.id)).map((c) => hubs[c.id]));
    for (const id of homeHubs) expect(hubs[id]).toBeGreaterThanOrEqual(maxAway);

    // Idempotent: targets met → nothing more is published.
    const again = await topUpDemoBatches(db, now);
    expect(again.published).toBe(0);
  });

  it("refills only the hub that ran dry", async () => {
    const now = new Date();
    const ipb = CAMPUSES[0];
    // Close IPB's batches only: every other hub still meets its target.
    const ipbMerchants = (await db.select({ id: merchants.id, lat: merchants.latitude, lng: merchants.longitude }).from(merchants))
      .filter((m) => nearestCampus(m)!.campus.id === ipb.id)
      .map((m) => m.id);
    await db
      .update(surplusBatches)
      .set({ status: "EXPIRED" })
      .where(and(eq(surplusBatches.status, "ACTIVE"), inArray(surplusBatches.merchantId, ipbMerchants)));
    expect((await liveByHub(now)).ipb).toBe(0);

    const r = await topUpDemoBatches(db, now, { maxPublish: 6 });
    expect(r.published).toBe(6);
    expect(r.byHub).toEqual({ ipb: 6 });
  });

  it("still honours an overall minLive floor", async () => {
    const now = new Date();
    const before = await liveCount(now);
    const r = await topUpDemoBatches(db, now, { minPerHub: 0, minPerHomeHub: 0, minLive: before + 3, maxPublish: 10 });
    expect(r.published).toBeGreaterThanOrEqual(3);
    expect(await liveCount(now)).toBeGreaterThanOrEqual(before + 3);
    expect((await topUpDemoBatches(db, now, { minPerHub: 0, minPerHomeHub: 0, minLive: before + 3 })).published).toBe(0);
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
