/**
 * "Ubah diskon" on a live batch (PATCH /merchant/surplus/:id { discount_pct }): the price is
 * rounded up to Rp 500 and never below the menu's floor, the change is logged as
 * MANUAL_OVERRIDE, auto discount turns off (unless sent as true), and closed batches refuse it.
 */
import { asc, desc, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { discountAdjustmentLogs, menus, merchants, surplusBatches } from "@/db/schema";
import { BatchPatchBody } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { patchBatch, REASON_MANUAL_OVERRIDE } from "@/server/services/merchant/surplus";
import { reseed, testDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;
let merchant: typeof merchants.$inferSelect;
let menu: typeof menus.$inferSelect;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [merchant] = await db.select().from(merchants).where(eq(merchants.slug, "geprek-mbak-lilis"));
  [menu] = await db.select().from(menus).where(eq(menus.merchantId, merchant.id)).orderBy(asc(menus.id)).limit(1);
  // A clear floor: half the normal price.
  await db.update(menus).set({ minRecoveryPriceIdr: Math.ceil(menu.originalPriceIdr / 2 / 500) * 500 }).where(eq(menus.id, menu.id));
  [menu] = await db.select().from(menus).where(eq(menus.id, menu.id));
});
afterAll(async () => close());

async function liveBatch(endInMinutes = 90) {
  const now = Date.now();
  const [b] = await db
    .insert(surplusBatches)
    .values({
      merchantId: merchant.id,
      menuId: menu.id,
      batchDate: wibDate(),
      initialStock: 6,
      availableStock: 6,
      originalPriceIdr: menu.originalPriceIdr,
      currentDiscountPct: 40,
      currentSellingPriceIdr: Math.ceil((menu.originalPriceIdr * 0.6) / 500) * 500,
      autoDiscountEnabled: true,
      pickupStartTime: new Date(now - 30 * 60_000),
      pickupEndTime: new Date(now + endInMinutes * 60_000),
    })
    .returning();
  return b;
}

describe("manual discount on a live batch", () => {
  it("sets the price, logs it, and turns auto discount off", async () => {
    const b = await liveBatch();
    const v = await patchBatch(db, merchant.id, b.id, BatchPatchBody.parse({ discount_pct: 20 }));
    const expected = Math.ceil((menu.originalPriceIdr * 0.8) / 500) * 500;
    expect(v.current_selling_price_idr).toBe(expected);
    expect(v.auto_discount_enabled).toBe(false);
    expect(v.min_recovery_price_idr).toBe(menu.minRecoveryPriceIdr);

    const [log] = await db
      .select()
      .from(discountAdjustmentLogs)
      .where(eq(discountAdjustmentLogs.surplusBatchId, b.id))
      .orderBy(desc(discountAdjustmentLogs.createdAt))
      .limit(1);
    expect(log.triggerReason).toBe(REASON_MANUAL_OVERRIDE);
    expect(log.previousDiscountPct).toBe(40);
    expect(log.newPriceIdr).toBe(expected);
  });

  it("never goes below the floor price, and keeps auto discount when asked", async () => {
    const b = await liveBatch();
    const v = await patchBatch(db, merchant.id, b.id, BatchPatchBody.parse({ discount_pct: 90, auto_discount_enabled: true }));
    expect(v.current_selling_price_idr).toBe(menu.minRecoveryPriceIdr);
    expect(v.auto_discount_enabled).toBe(true);
  });

  it("refuses closed batches and other warung", async () => {
    const b = await liveBatch();
    await db.update(surplusBatches).set({ status: "EXPIRED" }).where(eq(surplusBatches.id, b.id));
    const err = await patchBatch(db, merchant.id, b.id, BatchPatchBody.parse({ discount_pct: 30 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("BATCH_CLOSED");

    const live = await liveBatch();
    const [other] = await db.select().from(merchants).where(ne(merchants.id, merchant.id)).limit(1);
    const e2 = await patchBatch(db, other.id, live.id, BatchPatchBody.parse({ discount_pct: 30 })).catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(ApiError);
    expect((await db.select().from(surplusBatches).where(eq(surplusBatches.id, live.id)))[0].currentDiscountPct).toBe(40);
  });
});
