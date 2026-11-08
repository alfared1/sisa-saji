import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, desc, eq } from "drizzle-orm";
import { discountAdjustmentLogs, menus, merchants, surplusBatches, users, type Menu, type Merchant } from "@/db/schema";
import { PublishBody } from "@/lib/contracts";
import { runEscalationJobs } from "@/server/jobs";
import { publishSurplus } from "@/server/services/merchant/surplus";
import { reseed, testDb } from "../helpers/db";

const { db, close } = testDb();
const MIN = 60_000;
const T0 = new Date();
const at = (m: number) => new Date(T0.getTime() + m * MIN);
let merchant: Merchant;
let menu: Menu;

async function publish(stock: number, endInMin: number, extra: Record<string, unknown> = {}) {
  const { batch } = await publishSurplus(
    db,
    merchant.id,
    PublishBody.parse({ menu_id: menu.id, initial_stock: stock, pickup_end_time: at(endInMin).toISOString(), ...extra }),
    T0,
  );
  return batch;
}
const row = async (id: string) => (await db.select().from(surplusBatches).where(eq(surplusBatches.id, id)))[0];
const logsOf = (id: string) =>
  db
    .select()
    .from(discountAdjustmentLogs)
    .where(eq(discountAdjustmentLogs.surplusBatchId, id))
    .orderBy(asc(discountAdjustmentLogs.createdAt));

beforeAll(async () => {
  await reseed(db, T0);
  const [r] = await db
    .select({ merchant: merchants })
    .from(merchants)
    .innerJoin(users, eq(users.id, merchants.ownerUserId))
    .where(eq(users.email, "demo.mitra@sisasaji.test"));
  merchant = r.merchant;
  // A menu with a low floor so the 50% → 70% escalation is visible.
  [menu] = await db
    .insert(menus)
    .values({ merchantId: merchant.id, menuName: "Nasi Ayam Geprek Uji", originalPriceIdr: 20000, minRecoveryPriceIdr: 4000 })
    .returning();
});
afterAll(close);

describe("runEscalation (time-decay job)", () => {
  let escalating: string;
  let manual: string;
  let pinned: string;

  it("raises the discount over time and logs TIME_DECAY_RULE", async () => {
    escalating = (await publish(10, 120)).id;
    manual = (await publish(10, 120, { auto_discount_enabled: false })).id;
    pinned = (await publish(10, 120)).id;
    // The merchant priced `pinned` deeper than the optimizer would: 80% → Rp 4.000.
    await db.update(surplusBatches).set({ currentDiscountPct: 80, currentSellingPriceIdr: 4000 }).where(eq(surplusBatches.id, pinned));

    const before = await row(escalating);
    const summary = await runEscalationJobs(db, at(65)); // 55 min to close, 10 portions → ≥60%
    expect(summary.raised).toBeGreaterThanOrEqual(1);

    const after = await row(escalating);
    expect(after.currentDiscountPct).toBeGreaterThan(before.currentDiscountPct);
    expect(after.currentDiscountPct).toBeGreaterThanOrEqual(60);
    expect(after.currentSellingPriceIdr).toBeLessThan(before.currentSellingPriceIdr);
    expect(after.currentSellingPriceIdr).toBeGreaterThanOrEqual(menu.minRecoveryPriceIdr);
    expect(after.lastPriceUpdatedAt.getTime()).toBe(at(65).getTime());

    const logs = await logsOf(escalating);
    expect(logs.map((l) => l.triggerReason)).toEqual(["INITIAL_PUBLISH", "TIME_DECAY_RULE"]);
    expect(logs[1]).toMatchObject({
      previousDiscountPct: before.currentDiscountPct,
      newDiscountPct: after.currentDiscountPct,
      previousPriceIdr: before.currentSellingPriceIdr,
      newPriceIdr: after.currentSellingPriceIdr,
      minutesToClosing: 55,
      remainingStock: 10,
    });
  });

  it("never lowers a discount and ignores batches with auto discount off", async () => {
    const p = await row(pinned);
    expect(p.currentDiscountPct).toBe(80);
    expect(p.currentSellingPriceIdr).toBe(4000);
    expect((await logsOf(pinned)).map((l) => l.triggerReason)).toEqual(["INITIAL_PUBLISH"]);

    const m = await row(manual);
    const initial = (await logsOf(manual))[0];
    expect(m.currentDiscountPct).toBe(initial.newDiscountPct);
    expect(await logsOf(manual)).toHaveLength(1);
  });

  it("enters the 30-minute tier: 70%, TIME_DECAY_30M_RULE and one Flash Rescue per batch", async () => {
    const summary = await runEscalationJobs(db, at(100)); // 20 min to close
    const b = await row(escalating);
    expect(b.currentDiscountPct).toBeGreaterThanOrEqual(70);
    const logs = await logsOf(escalating);
    expect(logs[logs.length - 1].triggerReason).toBe("TIME_DECAY_30M_RULE");
    expect(logs[logs.length - 1].newPriceIdr).toBe(b.currentSellingPriceIdr); // latest log = live price
    // escalating + pinned (marker row, price unchanged) both get their Flash Rescue.
    expect(summary.flashRescues).toBeGreaterThanOrEqual(2);

    const pinnedLogs = await logsOf(pinned);
    const marker = pinnedLogs[pinnedLogs.length - 1];
    expect(marker.triggerReason).toBe("TIME_DECAY_30M_RULE");
    expect(marker.newDiscountPct).toBe(marker.previousDiscountPct);
    expect((await row(pinned)).currentDiscountPct).toBe(80);

    // A later run in the same tier sends no second Flash Rescue for these batches.
    await runEscalationJobs(db, at(105));
    for (const id of [escalating, pinned]) {
      const flashLogs = await db
        .select()
        .from(discountAdjustmentLogs)
        .where(and(eq(discountAdjustmentLogs.surplusBatchId, id), eq(discountAdjustmentLogs.triggerReason, "TIME_DECAY_30M_RULE")));
      expect(flashLogs).toHaveLength(1);
    }
  });

  it("keeps every escalated batch's price at or above its floor", async () => {
    const latest = await db
      .select()
      .from(discountAdjustmentLogs)
      .where(eq(discountAdjustmentLogs.surplusBatchId, escalating))
      .orderBy(desc(discountAdjustmentLogs.createdAt))
      .limit(1);
    expect(latest[0].newPriceIdr).toBeGreaterThanOrEqual(menu.minRecoveryPriceIdr);
  });
});
