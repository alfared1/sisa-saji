/**
 * Customer orders: list (status / ACTIVE filter), viewer-dependent detail, cancel,
 * expiry job, and review-once.
 */
import { randomInt } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, orders, reviews, surplusBatches, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { CheckoutBody, OrderListQuery, ReviewBody } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { checkout } from "@/server/services/orders/checkout";
import {
  cancelOrder,
  getOrderForViewer,
  listCustomerOrders,
  reviewOrder,
  simulatePayment,
} from "@/server/services/orders/orders";
import { verifyPickup } from "@/server/services/orders/pickup";
import { expirePendingOrders } from "@/server/services/stock";
import { reseed, testDb } from "../helpers/db";
import { TEST_PAYMENT_WEBHOOK_SECRET, TEST_PICKUP_QR_SECRET } from "../setup/constants";

let db: Db;
let close: () => Promise<void>;
let merchant: typeof merchants.$inferSelect;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [merchant] = await db.select().from(merchants).where(eq(merchants.slug, "geprek-mbak-lilis"));
});
afterAll(async () => close());

async function newCustomer(name = "Pembeli Pesanan") {
  const [u] = await db
    .insert(users)
    .values({ fullName: name, phoneNumber: `+62894${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  return u;
}

async function newBatch(stock = 5) {
  const [menu] = await db.select().from(menus).where(eq(menus.merchantId, merchant.id)).orderBy(asc(menus.id)).limit(1);
  const now = Date.now();
  const [b] = await db
    .insert(surplusBatches)
    .values({
      merchantId: merchant.id,
      menuId: menu.id,
      batchDate: wibDate(),
      initialStock: stock,
      availableStock: stock,
      originalPriceIdr: menu.originalPriceIdr,
      currentDiscountPct: 50,
      currentSellingPriceIdr: Math.round(menu.originalPriceIdr / 2),
      pickupStartTime: new Date(now - 30 * 60_000),
      pickupEndTime: new Date(now + 90 * 60_000),
    })
    .returning();
  return b;
}

async function order(userId: string, batchId: string, qty = 1, now?: Date) {
  return checkout(db, {
    userId,
    input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batchId, quantity: qty }] }),
    pickupQrSecret: TEST_PICKUP_QR_SECRET,
    now,
  });
}

const batchRow = async (id: string) => (await db.select().from(surplusBatches).where(eq(surplusBatches.id, id)))[0];

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
  return err as ApiError;
}

describe("POST /orders/:id/cancel", () => {
  it("cancels a pending order and releases its stock; only once and only by the owner", async () => {
    const customer = await newCustomer();
    const batch = await newBatch(5);
    const o = await order(customer.id, batch.id, 3);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 2, reservedStock: 3 });

    const stranger = await newCustomer();
    await expectCode(cancelOrder(db, o.id, stranger.id), "NOT_FOUND");

    const cancelled = await cancelOrder(db, o.id, customer.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancel_reason).toBe("Dibatalkan oleh pembeli");
    expect(cancelled.qris_string).toBeNull();
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });

    await expectCode(cancelOrder(db, o.id, customer.id), "ORDER_STATE_CONFLICT");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });
  });

  it("a paid order cannot be cancelled", async () => {
    const customer = await newCustomer();
    const batch = await newBatch();
    const o = await order(customer.id, batch.id);
    await simulatePayment(db, { orderId: o.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    await expectCode(cancelOrder(db, o.id, customer.id), "ORDER_STATE_CONFLICT");
  });
});

describe("expirePendingOrders (worker job)", () => {
  it("expires unpaid checkouts past payment_expires_at and releases stock", async () => {
    const customer = await newCustomer();
    const batch = await newBatch(4);
    const fresh = await order(customer.id, batch.id, 1);
    // A different customer: one customer holds at most one unpaid order per warung.
    const stale = await order((await newCustomer()).id, batch.id, 2, new Date(Date.now() - 11 * 60_000));
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 1, reservedStock: 3 });

    const n = await expirePendingOrders(db);
    expect(n).toBeGreaterThanOrEqual(1);
    const [s] = await db.select().from(orders).where(eq(orders.id, stale.id));
    const [f] = await db.select().from(orders).where(eq(orders.id, fresh.id));
    expect(s.status).toBe("EXPIRED");
    expect(f.status).toBe("PENDING_PAYMENT");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 3, reservedStock: 1 });

    // Running again is a no-op for this order.
    await expirePendingOrders(db);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 3, reservedStock: 1 });
  });
});

describe("GET /orders and GET /orders/:id", () => {
  it("lists newest first with status / ACTIVE filters", async () => {
    const customer = await newCustomer();
    const batch = await newBatch(6);
    const t0 = Date.now();
    // One unpaid order per warung at a time: settle each before the next checkout.
    const a = await order(customer.id, batch.id, 1, new Date(t0 - 3000));
    await cancelOrder(db, a.id, customer.id);
    const b = await order(customer.id, batch.id, 1, new Date(t0 - 2000));
    await simulatePayment(db, { orderId: b.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    const c = await order(customer.id, batch.id, 1, new Date(t0 - 1000));

    const all = await listCustomerOrders(db, customer.id, OrderListQuery.parse({}));
    expect(all.map((o) => o.id)).toEqual([c.id, b.id, a.id]);

    const active = await listCustomerOrders(db, customer.id, OrderListQuery.parse({ status: "ACTIVE" }));
    expect(active.map((o) => o.id)).toEqual([c.id, b.id]);

    const cancelled = await listCustomerOrders(db, customer.id, OrderListQuery.parse({ status: "CANCELLED" }));
    expect(cancelled.map((o) => o.id)).toEqual([a.id]);

    const limited = await listCustomerOrders(db, customer.id, OrderListQuery.parse({ limit: "1" }));
    expect(limited).toHaveLength(1);

    // Nobody else's orders leak in.
    const other = await newCustomer();
    expect(await listCustomerOrders(db, other.id, OrderListQuery.parse({}))).toEqual([]);
  });

  it("listing lazily expires the customer's stale unpaid orders", async () => {
    const customer = await newCustomer();
    const batch = await newBatch(3);
    const stale = await order(customer.id, batch.id, 1, new Date(Date.now() - 11 * 60_000));
    const list = await listCustomerOrders(db, customer.id, OrderListQuery.parse({ status: "ACTIVE" }));
    expect(list.map((o) => o.id)).not.toContain(stale.id);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 3, reservedStock: 0 });
  });

  it("detail: owner → customer view, the warung → merchant view, anyone else → NOT_FOUND", async () => {
    const customer = await newCustomer();
    const batch = await newBatch();
    const o = await order(customer.id, batch.id);
    await simulatePayment(db, { orderId: o.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });

    const mine = await getOrderForViewer(db, o.id, { userId: customer.id, merchantId: null });
    expect(mine.pickup_code).toMatch(/^\d{4}$/);
    expect(mine.pickup_qr_token).not.toBeNull();

    const warung = await getOrderForViewer(db, o.id, { userId: merchant.ownerUserId, merchantId: merchant.id });
    expect(warung.id).toBe(o.id);
    expect(warung.pickup_code).toBeNull();
    expect(warung.pickup_qr_token).toBeNull();
    expect(warung.customer.phone_number).toBe(customer.phoneNumber);

    const [otherMerchant] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
    await expectCode(
      getOrderForViewer(db, o.id, { userId: otherMerchant.ownerUserId, merchantId: otherMerchant.id }),
      "NOT_FOUND",
    );
    const stranger = await newCustomer();
    await expectCode(getOrderForViewer(db, o.id, { userId: stranger.id, merchantId: null }), "NOT_FOUND");
  });
});

describe("POST /orders/:id/review", () => {
  it("only after COMPLETED, only once; updates the warung rating", async () => {
    const customer = await newCustomer("Nadia Kusuma Wardani");
    const batch = await newBatch();
    const o = await order(customer.id, batch.id);
    const input = ReviewBody.parse({ rating: 4, tags: ["Porsi pas", "Ramah"], comment: "Enak, masih hangat." });

    await expectCode(reviewOrder(db, { orderId: o.id, userId: customer.id, input }), "ORDER_STATE_CONFLICT");

    await simulatePayment(db, { orderId: o.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    await verifyPickup(db, {
      merchantId: merchant.id,
      orderId: o.id,
      input: row.pickupCode,
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
    });

    const stranger = await newCustomer();
    await expectCode(reviewOrder(db, { orderId: o.id, userId: stranger.id, input }), "NOT_FOUND");

    const [before] = await db.select().from(merchants).where(eq(merchants.id, merchant.id));
    const reviewed = await reviewOrder(db, { orderId: o.id, userId: customer.id, input });
    expect(reviewed.review).toEqual({ rating: 4, tags: ["Porsi pas", "Ramah"], comment: "Enak, masih hangat." });

    const [after] = await db.select().from(merchants).where(eq(merchants.id, merchant.id));
    const all = await db.select({ r: reviews.rating }).from(reviews).where(eq(reviews.merchantId, merchant.id));
    expect(after.totalReviews).toBe(before.totalReviews + 1);
    expect(after.totalReviews).toBe(all.length);
    const avg = all.reduce((s, r) => s + r.r, 0) / all.length;
    expect(Number(after.ratingAvg)).toBeCloseTo(Math.round(avg * 100) / 100, 2);

    await expectCode(reviewOrder(db, { orderId: o.id, userId: customer.id, input }), "CONFLICT");
    const [final] = await db.select().from(merchants).where(eq(merchants.id, merchant.id));
    expect(final.totalReviews).toBe(after.totalReviews);
  });
});
