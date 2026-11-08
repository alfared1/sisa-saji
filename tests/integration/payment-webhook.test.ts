/**
 * Payment webhook: signature, PAID → READY_FOR_PICKUP (stock committed), idempotency,
 * amount mismatch, FAILED/EXPIRED, late payment after expiry, and the simulator.
 */
import { randomInt } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, orders, surplusBatches, users } from "@/db/schema";
import { CheckoutBody, type OrderDetail } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { checkout } from "@/server/services/orders/checkout";
import { getOrderForViewer, simulatePayment } from "@/server/services/orders/orders";
import {
  LATE_PAYMENT_REASON,
  processPaymentWebhook,
  receivePaymentWebhook,
  signWebhookBody,
} from "@/server/services/payment/webhook";
import { expirePendingOrders } from "@/server/services/stock";
import { reseed, testDb } from "../helpers/db";
import { TEST_PAYMENT_WEBHOOK_SECRET, TEST_PICKUP_QR_SECRET } from "../setup/constants";

let db: Db;
let close: () => Promise<void>;
let merchantId: string;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [{ id: merchantId }] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, "angkringan-lik-jarwo"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(async () => {
  vi.restoreAllMocks();
  await close();
});

async function newCustomer() {
  const [u] = await db
    .insert(users)
    .values({ fullName: "Pembeli Bayar", phoneNumber: `+62896${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  return u;
}

async function newBatch(stock: number) {
  const [menu] = await db.select().from(menus).where(eq(menus.merchantId, merchantId)).orderBy(asc(menus.id)).limit(1);
  const now = Date.now();
  const [b] = await db
    .insert(surplusBatches)
    .values({
      merchantId,
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

const batchRow = async (id: string) => (await db.select().from(surplusBatches).where(eq(surplusBatches.id, id)))[0];
const orderRow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0];

async function placeOrder(qty: number, stock = 5) {
  const customer = await newCustomer();
  const batch = await newBatch(stock);
  const order = await checkout(db, {
    userId: customer.id,
    input: CheckoutBody.parse({ merchant_id: merchantId, items: [{ batch_id: batch.id, quantity: qty }] }),
    pickupQrSecret: TEST_PICKUP_QR_SECRET,
  });
  return { customer, batch, order };
}

function signed(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return { raw, sig: signWebhookBody(raw, TEST_PAYMENT_WEBHOOK_SECRET) };
}

function paidBody(order: OrderDetail, overrides: Record<string, unknown> = {}) {
  return {
    order_id: order.id,
    gateway_ref: "SIM-TEST-REF",
    status: "PAID",
    amount_idr: order.total_customer_paid_idr,
    ...overrides,
  };
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

describe("POST /webhooks/payment", () => {
  it("rejects a bad or missing signature without touching the order", async () => {
    const { order } = await placeOrder(1);
    const { raw, sig } = signed(paidBody(order));
    await expectCode(receivePaymentWebhook(db, raw, null, TEST_PAYMENT_WEBHOOK_SECRET), "INVALID_SIGNATURE");
    await expectCode(receivePaymentWebhook(db, raw, "ab".repeat(64), TEST_PAYMENT_WEBHOOK_SECRET), "INVALID_SIGNATURE");
    await expectCode(receivePaymentWebhook(db, raw, sig, "another-secret-0123456789abcdef0123"), "INVALID_SIGNATURE");
    const tampered = raw.replace(`"amount_idr":${order.total_customer_paid_idr}`, `"amount_idr":1`);
    await expectCode(receivePaymentWebhook(db, tampered, sig, TEST_PAYMENT_WEBHOOK_SECRET), "INVALID_SIGNATURE");
    expect((await orderRow(order.id)).status).toBe("PENDING_PAYMENT");
  });

  it("rejects a signed but malformed body", async () => {
    const { raw, sig } = signed({ order_id: "nope", status: "PAID" });
    await expectCode(receivePaymentWebhook(db, raw, sig, TEST_PAYMENT_WEBHOOK_SECRET), "VALIDATION_ERROR");
  });

  it("PAID → READY_FOR_PICKUP, reserved portions become sold; duplicate is idempotent", async () => {
    const { order, batch, customer } = await placeOrder(2);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 3, reservedStock: 2 });

    const { raw, sig } = signed(paidBody(order, { gateway_ref: "MID-123" }));
    const out = await receivePaymentWebhook(db, raw, sig, TEST_PAYMENT_WEBHOOK_SECRET);
    expect(out).toEqual({ order_id: order.id, status: "READY_FOR_PICKUP", changed: true });

    const row = await orderRow(order.id);
    expect(row.status).toBe("READY_FOR_PICKUP");
    expect(row.paidAt).toBeInstanceOf(Date);
    expect(row.paymentGatewayRef).toBe("MID-123");
    const after = await batchRow(batch.id);
    expect(after).toMatchObject({ availableStock: 3, reservedStock: 0, status: "ACTIVE" });
    const sold = after.initialStock - after.availableStock - after.reservedStock;
    expect(sold).toBe(2);

    // The customer now sees the pickup code + QR token, and no QRIS.
    const view = await getOrderForViewer(db, order.id, { userId: customer.id, merchantId: null });
    expect(view.pickup_code).toMatch(/^\d{4}$/);
    expect(view.pickup_qr_token).toBe(row.pickupQrToken);
    expect(view.qris_string).toBeNull();

    const again = await receivePaymentWebhook(db, raw, sig, TEST_PAYMENT_WEBHOOK_SECRET);
    expect(again).toEqual({ order_id: order.id, status: "READY_FOR_PICKUP", changed: false });
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 3, reservedStock: 0 });
    expect((await orderRow(order.id)).paidAt!.getTime()).toBe(row.paidAt!.getTime());
  });

  it("marks the batch SOLD_OUT when its last reserved portions are paid", async () => {
    const { order, batch } = await placeOrder(2, 2);
    const { raw, sig } = signed(paidBody(order));
    await receivePaymentWebhook(db, raw, sig, TEST_PAYMENT_WEBHOOK_SECRET);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 0, reservedStock: 0, status: "SOLD_OUT" });
  });

  it("amount mismatch is rejected and the order stays pending", async () => {
    const { order, batch } = await placeOrder(1);
    const { raw, sig } = signed(paidBody(order, { amount_idr: order.total_customer_paid_idr - 500 }));
    const err = await expectCode(receivePaymentWebhook(db, raw, sig, TEST_PAYMENT_WEBHOOK_SECRET), "VALIDATION_ERROR");
    expect(err.details).toMatchObject({ expected_amount_idr: order.total_customer_paid_idr });
    expect((await orderRow(order.id)).status).toBe("PENDING_PAYMENT");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 4, reservedStock: 1 });
  });

  it("FAILED → CANCELLED and EXPIRED → EXPIRED release the reservation", async () => {
    const a = await placeOrder(2);
    const failed = signed(paidBody(a.order, { status: "FAILED" }));
    expect(await receivePaymentWebhook(db, failed.raw, failed.sig, TEST_PAYMENT_WEBHOOK_SECRET)).toMatchObject({
      status: "CANCELLED",
      changed: true,
    });
    expect(await batchRow(a.batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });
    expect((await orderRow(a.order.id)).cancelReason).toBe("Pembayaran gagal");

    const b = await placeOrder(1);
    const expired = signed(paidBody(b.order, { status: "EXPIRED" }));
    expect(await receivePaymentWebhook(db, expired.raw, expired.sig, TEST_PAYMENT_WEBHOOK_SECRET)).toMatchObject({
      status: "EXPIRED",
      changed: true,
    });
    expect(await batchRow(b.batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });
  });

  it("PAID after the order expired: flagged for refund, stock untouched, status unchanged", async () => {
    const { order, batch } = await placeOrder(1);
    const expiredCount = await expirePendingOrders(db, new Date(Date.now() + 11 * 60_000));
    expect(expiredCount).toBeGreaterThanOrEqual(1);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });

    const out = await processPaymentWebhook(db, {
      order_id: order.id,
      gateway_ref: "LATE-1",
      status: "PAID",
      amount_idr: order.total_customer_paid_idr,
    });
    expect(out).toEqual({ order_id: order.id, status: "EXPIRED", changed: true });
    const row = await orderRow(order.id);
    expect(row.status).toBe("EXPIRED");
    expect(row.cancelReason).toBe(LATE_PAYMENT_REASON);
    expect(row.paidAt).toBeNull();
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });
  });

  it("unknown order → NOT_FOUND", async () => {
    await expectCode(
      processPaymentWebhook(db, {
        order_id: "00000000-0000-4000-8000-000000000000",
        gateway_ref: "X",
        status: "PAID",
        amount_idr: 1000,
      }),
      "NOT_FOUND",
    );
  });
});

describe("POST /orders/:id/simulate-payment", () => {
  it("pays through the signed webhook path; repeated calls are idempotent", async () => {
    const { order, customer, batch } = await placeOrder(1);
    const paid = await simulatePayment(db, { orderId: order.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    expect(paid.status).toBe("READY_FOR_PICKUP");
    expect(paid.pickup_code).toMatch(/^\d{4}$/);
    expect(paid.paid_at).not.toBeNull();
    // gateway ref from checkout is reused
    expect((await orderRow(order.id)).paymentGatewayRef).toMatch(/^SIM-/);

    const again = await simulatePayment(db, { orderId: order.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    expect(again.paid_at).toBe(paid.paid_at);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 4, reservedStock: 0 });
  });

  it("only the owner can pay; an expired checkout → PAYMENT_EXPIRED and stock released", async () => {
    const { order, customer, batch } = await placeOrder(1);
    const stranger = await newCustomer();
    await expectCode(
      simulatePayment(db, { orderId: order.id, userId: stranger.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET }),
      "NOT_FOUND",
    );

    const late = new Date(Date.now() + 11 * 60_000);
    await expectCode(
      simulatePayment(db, { orderId: order.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET, now: late }),
      "PAYMENT_EXPIRED",
    );
    expect((await orderRow(order.id)).status).toBe("EXPIRED");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });

    await expectCode(
      simulatePayment(db, { orderId: order.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET }),
      "ORDER_STATE_CONFLICT",
    );
  });
});
