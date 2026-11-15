/**
 * Cancelling paid online orders: the buyer's request (warung approves → full refund, portions
 * back; rejects with a note → order stays), the warung's "Stok habis" cancel (refund, stock 0),
 * an unanswered request at expiry (approved, no payout), and a pickup that closes a pending
 * request. The stock invariant (sold = initial − available − reserved) must hold throughout.
 */
import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, orderItems, orders, surplusBatches, users } from "@/db/schema";
import { PAID_ORDER_CANCEL_REASONS } from "@/lib/constants";
import { CheckoutBody } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { cancelOrderByMerchant, requestCancel, respondToCancelRequest } from "@/server/services/orders/cancel-request";
import { checkout } from "@/server/services/orders/checkout";
import { simulatePayment } from "@/server/services/orders/orders";
import { closeUnclaimedOrders, verifyPickup } from "@/server/services/orders/pickup";
import { reseed, testDb } from "../helpers/db";
import { TEST_PAYMENT_WEBHOOK_SECRET, TEST_PICKUP_QR_SECRET } from "../setup/constants";

let db: Db;
let close: () => Promise<void>;
let merchant: typeof merchants.$inferSelect;
let other: typeof merchants.$inferSelect;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [merchant] = await db.select().from(merchants).where(eq(merchants.slug, "geprek-mbak-lilis"));
  [other] = await db.select().from(merchants).where(and(eq(merchants.isPilot, false), sql`${merchants.id} <> ${merchant.id}`)).limit(1);
});
afterAll(async () => close());

async function newCustomer() {
  const [u] = await db
    .insert(users)
    .values({ fullName: "Pembeli Batal", phoneNumber: `+62895${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  return u;
}

async function newBatch(stock = 6) {
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

/** A paid QRIS order of `qty` portions from a fresh batch. */
async function paidOrder(qty = 2) {
  const customer = await newCustomer();
  const batch = await newBatch();
  const o = await checkout(db, {
    userId: customer.id,
    input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: qty }] }),
    pickupQrSecret: TEST_PICKUP_QR_SECRET,
  });
  const paid = await simulatePayment(db, { orderId: o.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
  expect(["PAID", "READY_FOR_PICKUP"]).toContain(paid.status);
  return { customer, batch, order: paid };
}

const batchRow = async (id: string) => (await db.select().from(surplusBatches).where(eq(surplusBatches.id, id)))[0];
const orderRow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0];
const wallet = async () => (await db.select().from(merchants).where(eq(merchants.id, merchant.id)))[0].walletBalanceIdr;

/** sold = initial − available − reserved, where sold = portions of paid / collected orders. */
async function expectStockInvariant(batchId: string) {
  const b = await batchRow(batchId);
  const [{ q }] = await db
    .select({ q: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.surplusBatchId, batchId), inArray(orders.status, ["PAID", "READY_FOR_PICKUP", "COMPLETED"])));
  expect(b.initialStock - b.availableStock - b.reservedStock).toBe(q);
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
  return err as ApiError;
}

describe("buyer cancel request on a paid order", () => {
  it("approved: CANCELLED, full refund, portions back on the shelf, no payout", async () => {
    const { customer, batch, order } = await paidOrder(2);
    const before = await wallet();
    expect((await batchRow(batch.id)).availableStock).toBe(4);

    const asked = await requestCancel(db, { orderId: order.id, userId: customer.id, reason: "WRONG_ORDER" });
    expect(asked.cancel_request).toMatchObject({ status: "PENDING", reason: "Salah pesan", response: null });
    expect(asked.status).toBe(order.status);

    const done = await respondToCancelRequest(db, { merchantId: merchant.id, orderId: order.id, decision: "APPROVE" });
    expect(done.status).toBe("CANCELLED");
    expect(done.cancel_reason).toBe(PAID_ORDER_CANCEL_REASONS.BUYER_APPROVED.reason);
    expect(done.cancel_request?.status).toBe("APPROVED");
    expect(done.refund?.amount_idr).toBe(order.total_customer_paid_idr);
    expect(done.refund?.ref).toMatch(/^RFD-[0-9A-F]{12}$/);

    expect((await batchRow(batch.id)).availableStock).toBe(6);
    await expectStockInvariant(batch.id);
    expect(await wallet()).toBe(before);
  });

  it("rejected with a note: the order stays collectable and cannot be asked again", async () => {
    const { customer, order } = await paidOrder(1);
    await requestCancel(db, { orderId: order.id, userId: customer.id, reason: "CANNOT_COME", note: "Hujan deras" });
    expect((await orderRow(order.id)).cancelRequestReason).toBe("Tidak sempat datang. Hujan deras");

    await expectCode(respondToCancelRequest(db, { merchantId: merchant.id, orderId: order.id, decision: "REJECT" }), "VALIDATION_ERROR");
    const rejected = await respondToCancelRequest(db, {
      merchantId: merchant.id,
      orderId: order.id,
      decision: "REJECT",
      note: "Pesanan sudah disiapkan",
    });
    expect(rejected.status).toBe(order.status);
    expect(rejected.cancel_request).toMatchObject({ status: "REJECTED", response: "Pesanan sudah disiapkan" });
    expect(rejected.refund).toBeNull();

    await expectCode(requestCancel(db, { orderId: order.id, userId: customer.id, reason: "CHANGED_MIND" }), "ORDER_STATE_CONFLICT");
    await expectCode(respondToCancelRequest(db, { merchantId: merchant.id, orderId: order.id, decision: "APPROVE" }), "ORDER_STATE_CONFLICT");
  });

  it("checks the reason, the owner, the warung and the order state", async () => {
    const { customer, order } = await paidOrder(1);
    await expectCode(requestCancel(db, { orderId: order.id, userId: customer.id, reason: "OTHER" }), "VALIDATION_ERROR");
    const stranger = await newCustomer();
    await expectCode(requestCancel(db, { orderId: order.id, userId: stranger.id, reason: "WRONG_ORDER" }), "NOT_FOUND");

    await requestCancel(db, { orderId: order.id, userId: customer.id, reason: "OTHER", note: "Teman sudah belikan" });
    await expectCode(requestCancel(db, { orderId: order.id, userId: customer.id, reason: "WRONG_ORDER" }), "ORDER_STATE_CONFLICT");
    await expectCode(respondToCancelRequest(db, { merchantId: other.id, orderId: order.id, decision: "APPROVE" }), "NOT_FOUND");

    // Not paid yet: cancelled directly instead.
    const unpaidBuyer = await newCustomer();
    const batch = await newBatch();
    const unpaid = await checkout(db, {
      userId: unpaidBuyer.id,
      input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }),
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
    });
    await expectCode(requestCancel(db, { orderId: unpaid.id, userId: unpaidBuyer.id, reason: "WRONG_ORDER" }), "ORDER_STATE_CONFLICT");

    // Past the pickup deadline: too late to ask.
    const late = await paidOrder(1);
    const after = new Date(Date.parse(late.order.pickup_deadline_at) + 60_000);
    await expectCode(
      requestCancel(db, { orderId: late.order.id, userId: late.customer.id, reason: "CANNOT_COME", now: after }),
      "ORDER_STATE_CONFLICT",
    );
  });

  it("a request the warung never answers is approved when the order would expire", async () => {
    const { customer, batch, order } = await paidOrder(2);
    await requestCancel(db, { orderId: order.id, userId: customer.id, reason: "CANNOT_COME" });
    const before = await wallet();
    // Other open orders of this warung (from earlier tests) expire in the same run and are paid out.
    const others = await db
      .select({ id: orders.id, payout: orders.netMerchantPayoutIdr })
      .from(orders)
      .where(and(eq(orders.merchantId, merchant.id), inArray(orders.status, ["PAID", "READY_FOR_PICKUP"]), sql`${orders.id} <> ${order.id}`));

    const later = new Date(Date.parse(order.pickup_deadline_at) + 31 * 60_000);
    await closeUnclaimedOrders(db, later);

    const row = await orderRow(order.id);
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelReason).toBe(PAID_ORDER_CANCEL_REASONS.BUYER_UNANSWERED.reason);
    expect(row.cancelRequestStatus).toBe("APPROVED");
    expect(row.refundAmountIdr).toBe(order.total_customer_paid_idr);
    let expiredPayouts = 0;
    for (const o of others) if ((await orderRow(o.id)).status === "EXPIRED") expiredPayouts += o.payout;
    expect(await wallet()).toBe(before + expiredPayouts);
    await expectStockInvariant(batch.id);
  });

  it("collecting the order closes a pending request", async () => {
    const { customer, order } = await paidOrder(1);
    await requestCancel(db, { orderId: order.id, userId: customer.id, reason: "CHANGED_MIND" });
    const row = await orderRow(order.id);
    const done = await verifyPickup(db, {
      merchantId: merchant.id,
      orderId: order.id,
      input: row.pickupCode,
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
    });
    expect(done.status).toBe("COMPLETED");
    expect(done.cancel_request).toMatchObject({ status: "REJECTED", response: "Pesanan sudah diambil." });
  });
});

describe("warung cancels a paid order", () => {
  it("out of stock: CANCELLED, full refund, the menu's remaining stock becomes 0", async () => {
    const { customer, batch, order } = await paidOrder(2);
    await requestCancel(db, { orderId: order.id, userId: customer.id, reason: "WRONG_ORDER" });

    const done = await cancelOrderByMerchant(db, { merchantId: merchant.id, orderId: order.id, reason: "OUT_OF_STOCK" });
    expect(done.status).toBe("CANCELLED");
    expect(done.cancel_reason).toBe(PAID_ORDER_CANCEL_REASONS.OUT_OF_STOCK.reason);
    expect(done.refund?.amount_idr).toBe(order.total_customer_paid_idr);
    // The pending request is settled by the cancel.
    expect(done.cancel_request?.status).toBe("APPROVED");
    const b = await batchRow(batch.id);
    expect(b.availableStock).toBe(0);
    expect(b.status).toBe("SOLD_OUT");

    await expectCode(
      cancelOrderByMerchant(db, { merchantId: merchant.id, orderId: order.id, reason: "OUT_OF_STOCK" }),
      "ORDER_STATE_CONFLICT",
    );
  });

  it("'Tidak datang' and other warung are refused; the buyer's fair-use count ignores stock-outs", async () => {
    const { customer, order } = await paidOrder(1);
    await expectCode(cancelOrderByMerchant(db, { merchantId: merchant.id, orderId: order.id, reason: "NO_SHOW" }), "ORDER_STATE_CONFLICT");
    await expectCode(cancelOrderByMerchant(db, { merchantId: other.id, orderId: order.id, reason: "OUT_OF_STOCK" }), "NOT_FOUND");

    // Three stock-outs in a row for the same buyer: checkout still works.
    await cancelOrderByMerchant(db, { merchantId: merchant.id, orderId: order.id, reason: "OUT_OF_STOCK" });
    for (let i = 0; i < 2; i++) {
      const batch = await newBatch();
      const o = await checkout(db, {
        userId: customer.id,
        input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }),
        pickupQrSecret: TEST_PICKUP_QR_SECRET,
      });
      await simulatePayment(db, { orderId: o.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
      await cancelOrderByMerchant(db, { merchantId: merchant.id, orderId: o.id, reason: "OUT_OF_STOCK" });
    }
    const batch = await newBatch();
    const next = await checkout(db, {
      userId: customer.id,
      input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }),
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
    });
    expect(next.status).toBe("PENDING_PAYMENT");
  });
});
