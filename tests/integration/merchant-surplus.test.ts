import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { discountAdjustmentLogs, menus, merchants, orders, surplusBatches, users, type Menu, type Merchant } from "@/db/schema";
import { BatchPatchBody, CheckoutBody, PublishBody, StockPatchBody, type MerchantBatchView } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { checkout } from "@/server/services/orders/checkout";
import { simulatePayment } from "@/server/services/orders/orders";
import {
  patchBatch,
  patchBatchStock,
  priceForDiscount,
  publishSurplus,
  quoteSurplus,
} from "@/server/services/merchant/surplus";
import { reseed, testDb } from "../helpers/db";
import { TEST_PAYMENT_WEBHOOK_SECRET, TEST_PICKUP_QR_SECRET } from "../setup/constants";

const { db, close } = testDb();
const MIN = 60_000;
let merchant: Merchant;
let menu: Menu;
let customerId: string;

async function expectApiError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
  return err as ApiError;
}

const inMin = (now: Date, m: number) => new Date(now.getTime() + m * MIN).toISOString();

async function publish(stock: number, endInMin = 120, extra: Record<string, unknown> = {}, now = new Date()) {
  return publishSurplus(
    db,
    merchant.id,
    PublishBody.parse({ menu_id: menu.id, initial_stock: stock, pickup_end_time: inMin(now, endInMin), ...extra }),
    now,
  );
}

async function batchRow(id: string) {
  const [b] = await db.select().from(surplusBatches).where(eq(surplusBatches.id, id));
  return b;
}

function expectInvariant(v: MerchantBatchView) {
  expect(v.initial_stock).toBe(v.available_stock + v.reserved_stock + v.sold);
  expect(v.sold).toBeGreaterThanOrEqual(0);
}

beforeAll(async () => {
  await reseed(db);
  const [row] = await db
    .select({ merchant: merchants })
    .from(merchants)
    .innerJoin(users, eq(users.id, merchants.ownerUserId))
    .where(eq(users.email, "demo.mitra@sisasaji.test"));
  merchant = row.merchant;
  [menu] = await db
    .select()
    .from(menus)
    .where(and(eq(menus.merchantId, merchant.id), eq(menus.isActive, true), eq(menus.isMysteryBag, false)))
    .orderBy(asc(menus.createdAt))
    .limit(1);
  const [c] = await db.select().from(users).where(eq(users.email, "demo.pembeli@sisasaji.test"));
  customerId = c.id;
});
afterAll(close);

describe("POST /merchant/surplus/quote-ai", () => {
  it("returns the contract shape with a monotonic schedule and Indonesian explanation", async () => {
    const now = new Date();
    const q = await quoteSurplus(db, merchant.id, { menu_id: menu.id, available_stock: 8, pickup_end_time: inMin(now, 150) }, now);
    expect(q.menu_id).toBe(menu.id);
    expect(q.original_price_idr).toBe(menu.originalPriceIdr);
    expect(q.min_recovery_price_idr).toBe(menu.minRecoveryPriceIdr);
    expect(q.sellout_probability).toBeGreaterThanOrEqual(0.02);
    expect(q.sellout_probability).toBeLessThanOrEqual(0.98);
    expect(q.recommended_selling_price_idr).toBeGreaterThanOrEqual(menu.minRecoveryPriceIdr);
    expect(q.recommended_selling_price_idr % 500 === 0 || q.floor_applied).toBe(true);
    expect(q.minutes_to_close).toBe(150);
    expect(q.active_users_in_radius).toBeGreaterThanOrEqual(0);
    expect(["heuristic-v0", "lgbm-v1"]).toContain(q.model_version);
    expect(q.escalation_schedule.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < q.escalation_schedule.length; i++) {
      expect(q.escalation_schedule[i].discount_pct).toBeGreaterThanOrEqual(q.escalation_schedule[i - 1].discount_pct);
    }
    expect(q.explanation.length).toBeGreaterThanOrEqual(3);
    expect(q.explanation.join(" ")).toMatch(/radius 2 km/);
    expect(q.explanation.join(" ")).toMatch(/Peluang habis terjual/);
  });

  it("404s on another merchant's menu and rejects a past closing time", async () => {
    const foreign = (await db.select().from(menus)).find((m) => m.merchantId !== merchant.id)!;
    const now = new Date();
    await expectApiError(quoteSurplus(db, merchant.id, { menu_id: foreign.id, available_stock: 5, pickup_end_time: inMin(now, 60) }, now), "NOT_FOUND");
    await expectApiError(quoteSurplus(db, merchant.id, { menu_id: menu.id, available_stock: 5, pickup_end_time: inMin(now, -5) }, now), "VALIDATION_ERROR");
  });
});

describe("POST /merchant/surplus/publish", () => {
  it("creates an ACTIVE batch with the optimizer price and an INITIAL_PUBLISH log", async () => {
    const res = await publish(10, 120);
    const b = res.batch;
    expect(b.status).toBe("ACTIVE");
    expect(b.initial_stock).toBe(10);
    expect(b.available_stock).toBe(10);
    expect(b.reserved_stock).toBe(0);
    expect(b.sold).toBe(0);
    expect(b.current_selling_price_idr).toBeGreaterThanOrEqual(menu.minRecoveryPriceIdr);
    expect(b.current_discount_pct).toBeGreaterThanOrEqual(40);
    expect(b.predicted_sellout_prob).not.toBeNull();
    expect(res.notified_devices).toBeGreaterThanOrEqual(0);
    expect(b.next_escalation === null || Date.parse(b.next_escalation.at) > Date.now() - MIN).toBe(true);

    const logs = await db.select().from(discountAdjustmentLogs).where(eq(discountAdjustmentLogs.surplusBatchId, b.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      triggerReason: "INITIAL_PUBLISH",
      newDiscountPct: b.current_discount_pct,
      newPriceIdr: b.current_selling_price_idr,
      remainingStock: 10,
    });
  });

  it("applies a manual discount override but never below the floor", async () => {
    const res = await publish(5, 90, { discount_pct_override: 90 });
    const expected = priceForDiscount(menu.originalPriceIdr, menu.minRecoveryPriceIdr, 90);
    expect(res.batch.current_selling_price_idr).toBe(expected.sellingPriceIdr);
    expect(res.batch.current_selling_price_idr).toBeGreaterThanOrEqual(menu.minRecoveryPriceIdr);
  });

  it("schedules a future start (SCHEDULED, no notifications)", async () => {
    const now = new Date();
    const res = await publish(6, 180, { pickup_start_time: inMin(now, 60) }, now);
    expect(res.batch.status).toBe("SCHEDULED");
    expect(res.notified_devices).toBe(0);
    expect(res.batch.next_escalation).toBeNull();
  });

  it("validates the pickup window (>10 min, ≤12 h) and the menu", async () => {
    await expectApiError(publish(5, 5), "VALIDATION_ERROR");
    await expectApiError(publish(5, 13 * 60), "VALIDATION_ERROR");
    const foreign = (await db.select().from(menus)).find((m) => m.merchantId !== merchant.id)!;
    const now = new Date();
    await expectApiError(
      publishSurplus(db, merchant.id, PublishBody.parse({ menu_id: foreign.id, initial_stock: 3, pickup_end_time: inMin(now, 60) }), now),
      "NOT_FOUND",
    );
    await db.update(menus).set({ isActive: false }).where(eq(menus.id, menu.id));
    try {
      await expectApiError(publish(5, 60), "VALIDATION_ERROR");
    } finally {
      await db.update(menus).set({ isActive: true }).where(eq(menus.id, menu.id));
    }
  });
});

describe("PATCH /merchant/surplus/:id/stock", () => {
  it("keeps initial = available + reserved + sold through decreases, increases, sell-out and reopen", async () => {
    const { batch } = await publish(10, 120);
    const patch = (body: Record<string, number>) => patchBatchStock(db, merchant.id, batch.id, StockPatchBody.parse(body));

    let v = await patch({ delta: -3 }); // 3 sold offline
    expect(v).toMatchObject({ initial_stock: 10, available_stock: 7, sold: 3, status: "ACTIVE" });
    expectInvariant(v);

    v = await patch({ available_stock: 9 }); // undo part of the offline reduction
    expect(v).toMatchObject({ initial_stock: 10, available_stock: 9, sold: 1 });
    expectInvariant(v);

    v = await patch({ available_stock: 14 }); // more than published → initial raised
    expect(v).toMatchObject({ initial_stock: 14, available_stock: 14, sold: 0 });
    expectInvariant(v);

    await expectApiError(patch({ delta: -15 }), "VALIDATION_ERROR");

    v = await patch({ available_stock: 0 });
    expect(v.status).toBe("SOLD_OUT");
    expectInvariant(v);

    v = await patch({ delta: 2 }); // reopen before pickup_end
    expect(v.status).toBe("ACTIVE");
    expect(v.available_stock).toBe(2);
    expectInvariant(v);
  });

  it("never lets an increase eat into portions customers paid for", async () => {
    const { batch } = await publish(4, 120);
    const order = await checkout(db, {
      userId: customerId,
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
      input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 2 }] }),
    });
    await simulatePayment(db, { orderId: order.id, userId: customerId, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    const v = await patchBatchStock(db, merchant.id, batch.id, StockPatchBody.parse({ available_stock: 4 }));
    expect(v.initial_stock).toBe(6); // 2 paid + 4 available
    expect(v.sold).toBe(2);
    expectInvariant(v);
  });

  it("404s for another merchant's batch and refuses closed batches", async () => {
    const other = (await db.select().from(surplusBatches).where(eq(surplusBatches.status, "ACTIVE"))).find(
      (b) => b.merchantId !== merchant.id,
    )!;
    await expectApiError(patchBatchStock(db, merchant.id, other.id, StockPatchBody.parse({ delta: 1 })), "NOT_FOUND");

    const { batch } = await publish(3, 60);
    await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" }));
    await expectApiError(patchBatchStock(db, merchant.id, batch.id, StockPatchBody.parse({ delta: 1 })), "BATCH_CLOSED");
  });

  it("caps the resulting stock, not each step, when a limit is given (demo warung)", async () => {
    const { batch } = await publish(5, 120);
    const limit = { maxAvailable: 30, message: "batas demo" };
    const patch = (body: Record<string, number>) =>
      patchBatchStock(db, merchant.id, batch.id, StockPatchBody.parse(body), new Date(), limit);

    expect((await patch({ delta: 25 })).available_stock).toBe(30);
    await expectApiError(patch({ delta: 1 }), "VALIDATION_ERROR");
    await expectApiError(patch({ available_stock: 31 }), "VALIDATION_ERROR");
    expect((await patch({ delta: -10 })).available_stock).toBe(20);
  });
});

describe("PATCH /merchant/surplus/:id (cancel / auto discount)", () => {
  it("refuses to cancel while portions are reserved; paid orders stay valid after cancelling", async () => {
    const { batch } = await publish(5, 120);
    const order = await checkout(db, {
      userId: customerId,
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
      input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }),
    });
    expect((await batchRow(batch.id)).reservedStock).toBe(1);
    const err = await expectApiError(patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" })), "CONFLICT");
    expect(err.status).toBe(409);

    await simulatePayment(db, { orderId: order.id, userId: customerId, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    const v = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" }));
    expect(v.status).toBe("CANCELLED");
    expect(v.sold).toBe(1);
    expectInvariant(v);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(["PAID", "READY_FOR_PICKUP"]).toContain(o.status);

    await expectApiError(patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" })), "BATCH_CLOSED");
  });

  it("toggles auto discount (next_escalation disappears when off)", async () => {
    const { batch } = await publish(12, 150);
    const off = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ auto_discount_enabled: false }));
    expect(off.auto_discount_enabled).toBe(false);
    expect(off.next_escalation).toBeNull();
    const on = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ auto_discount_enabled: true }));
    expect(on.auto_discount_enabled).toBe(true);
    await expectApiError(patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({})), "VALIDATION_ERROR");
  });
});
