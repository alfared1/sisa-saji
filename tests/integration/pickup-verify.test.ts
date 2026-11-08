/**
 * Merchant pickup: lookup by code / "SJ-" code / QR token, verify-pickup crediting
 * impact, customer totals, badge and wallet exactly once.
 */
import { randomInt } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, orders, surplusBatches, users } from "@/db/schema";
import { CheckoutBody } from "@/lib/contracts";
import { badgeTierForFoodSaved } from "@/lib/impact";
import { createPickupToken } from "@/lib/pickup-token";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { checkout } from "@/server/services/orders/checkout";
import { simulatePayment } from "@/server/services/orders/orders";
import { lookupPickup, PICKUP_GRACE_MINUTES, verifyPickup } from "@/server/services/orders/pickup";
import { reseed, testDb } from "../helpers/db";
import { TEST_PAYMENT_WEBHOOK_SECRET, TEST_PICKUP_QR_SECRET } from "../setup/constants";

let db: Db;
let close: () => Promise<void>;
let merchant: typeof merchants.$inferSelect;
let otherMerchantId: string;
const SECRET = TEST_PICKUP_QR_SECRET;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [merchant] = await db.select().from(merchants).where(eq(merchants.slug, "warung-bu-sri-pogung"));
  [{ id: otherMerchantId }] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, "bakmi-jawa-pak-harjo"));
});
afterAll(async () => close());

async function newCustomer(extra: Partial<typeof users.$inferInsert> = {}) {
  const [u] = await db
    .insert(users)
    .values({ fullName: "Pembeli Ambil", phoneNumber: `+62895${String(randomInt(0, 10 ** 8)).padStart(8, "0")}`, ...extra })
    .returning();
  return u;
}

async function newBatch(endInMin = 90) {
  const [menu] = await db
    .select()
    .from(menus)
    .where(eq(menus.merchantId, merchant.id))
    .orderBy(asc(menus.originalPriceIdr))
    .limit(1);
  const now = Date.now();
  const [b] = await db
    .insert(surplusBatches)
    .values({
      merchantId: merchant.id,
      menuId: menu.id,
      batchDate: wibDate(),
      initialStock: 10,
      availableStock: 10,
      originalPriceIdr: menu.originalPriceIdr,
      currentDiscountPct: 50,
      currentSellingPriceIdr: Math.round(menu.originalPriceIdr / 2),
      pickupStartTime: new Date(now - 30 * 60_000),
      pickupEndTime: new Date(now + endInMin * 60_000),
    })
    .returning();
  return { batch: b, menu };
}

/** Checkout + simulated payment → READY_FOR_PICKUP order with its secrets. */
async function paidOrder(qty = 2, opts: { customer?: typeof users.$inferSelect; pay?: boolean } = {}) {
  const customer = opts.customer ?? (await newCustomer());
  const { batch, menu } = await newBatch();
  let order = await checkout(db, {
    userId: customer.id,
    input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: qty }] }),
    pickupQrSecret: SECRET,
  });
  if (opts.pay !== false) {
    order = await simulatePayment(db, { orderId: order.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
  }
  const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
  return { customer, batch, menu, order, row };
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

const lookup = (input: string, merchantId = merchant.id) => lookupPickup(db, { merchantId, input, pickupQrSecret: SECRET });

describe("POST /orders/lookup-pickup", () => {
  it("finds the merchant's paid order by 4-digit code, SJ- code and QR token (merchant view)", async () => {
    const { order, row } = await paidOrder();
    for (const input of [row.pickupCode, `SJ-${row.pickupCode}`, `sj${row.pickupCode}`, row.pickupQrToken]) {
      const found = await lookup(input);
      expect(found.id).toBe(order.id);
      expect(found.status).toBe("READY_FOR_PICKUP");
      // The merchant never sees the customer's secrets.
      expect(found.pickup_code).toBeNull();
      expect(found.pickup_qr_token).toBeNull();
      expect(found.customer.full_name).toBe("Pembeli Ambil");
    }
  });

  it("rejects unknown codes, forged tokens, other merchants and unpaid orders", async () => {
    const { row } = await paidOrder();
    const unused = String((Number(row.pickupCode) + 1) % 10000).padStart(4, "0");
    const taken = await db.select({ c: orders.pickupCode }).from(orders).where(eq(orders.merchantId, merchant.id));
    if (!taken.some((t) => t.c === unused)) await expectCode(lookup(unused), "INVALID_PICKUP_CODE");

    const forged = createPickupToken(row.id, row.pickupCode, "wrong-secret-0123456789abcdef0123456");
    await expectCode(lookup(forged), "INVALID_PICKUP_CODE");
    await expectCode(lookup("not-a-token-at-all"), "INVALID_PICKUP_CODE");
    await expectCode(lookup(row.pickupCode, otherMerchantId), "INVALID_PICKUP_CODE");
    await expectCode(lookup(row.pickupQrToken, otherMerchantId), "INVALID_PICKUP_CODE");

    const unpaid = await paidOrder(1, { pay: false });
    await expectCode(lookup(unpaid.row.pickupCode), "INVALID_PICKUP_CODE");
    await expectCode(lookup(unpaid.row.pickupQrToken), "INVALID_PICKUP_CODE");
  });
});

describe("POST /orders/:id/verify-pickup", () => {
  it("completes the order and credits impact, customer totals, badge and wallet exactly once", async () => {
    // 1.9 kg already saved → this order crosses the SURPLUS_SAVER threshold (2 kg).
    const customer = await newCustomer({ totalFoodSavedGrams: 1900 });
    const { order, row, menu } = await paidOrder(3, { customer });
    const [walletBefore] = await db.select({ w: merchants.walletBalanceIdr }).from(merchants).where(eq(merchants.id, merchant.id));

    const proof = "https://example.test/bukti.jpg";
    const done = await verifyPickup(db, {
      merchantId: merchant.id,
      orderId: order.id,
      input: `SJ-${row.pickupCode}`,
      proofImageUrl: proof,
      pickupQrSecret: SECRET,
    });
    const food = 3 * menu.portionWeightGrams;
    const co2 = Math.round(food * 2.5);
    expect(done).toMatchObject({ status: "COMPLETED", food_saved_grams: food, co2_avoided_grams: co2 });
    expect(done.picked_up_at).not.toBeNull();

    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o).toMatchObject({ totalFoodSavedGrams: food, totalCo2AvoidedGrams: co2, pickupProofImageUrl: proof });

    const [u] = await db.select().from(users).where(eq(users.id, customer.id));
    const moneySaved = row.subtotalOriginalIdr - row.subtotalRecoveryIdr + row.voucherDiscountIdr;
    expect(u).toMatchObject({
      totalFoodSavedGrams: 1900 + food,
      totalCo2AvoidedGrams: co2,
      totalMoneySavedIdr: moneySaved,
      loyaltyPoints: Math.floor(row.totalCustomerPaidIdr / 1000),
      badgeTier: badgeTierForFoodSaved(1900 + food),
    });
    expect(u.badgeTier).toBe("SURPLUS_SAVER");

    const [walletAfter] = await db.select({ w: merchants.walletBalanceIdr }).from(merchants).where(eq(merchants.id, merchant.id));
    expect(walletAfter.w - walletBefore.w).toBe(row.netMerchantPayoutIdr);

    // Second verification: conflict, nothing credited twice.
    await expectCode(
      verifyPickup(db, { merchantId: merchant.id, orderId: order.id, input: row.pickupCode, pickupQrSecret: SECRET }),
      "ORDER_STATE_CONFLICT",
    );
    await expectCode(lookup(row.pickupQrToken), "ORDER_STATE_CONFLICT");
    const [u2] = await db.select().from(users).where(eq(users.id, customer.id));
    expect(u2.totalFoodSavedGrams).toBe(1900 + food);
    expect(u2.loyaltyPoints).toBe(u.loyaltyPoints);
    const [walletFinal] = await db.select({ w: merchants.walletBalanceIdr }).from(merchants).where(eq(merchants.id, merchant.id));
    expect(walletFinal.w).toBe(walletAfter.w);
  });

  it("accepts the QR token as proof", async () => {
    const { order, row } = await paidOrder(1);
    const done = await verifyPickup(db, { merchantId: merchant.id, orderId: order.id, input: row.pickupQrToken, pickupQrSecret: SECRET });
    expect(done.status).toBe("COMPLETED");
  });

  it("wrong code → INVALID_PICKUP_CODE and nothing changes", async () => {
    const { order, row, customer } = await paidOrder(1);
    const wrong = row.pickupCode === "0000" ? "1111" : "0000";
    await expectCode(
      verifyPickup(db, { merchantId: merchant.id, orderId: order.id, input: wrong, pickupQrSecret: SECRET }),
      "INVALID_PICKUP_CODE",
    );
    // A token of another order does not work either.
    const other = await paidOrder(1);
    await expectCode(
      verifyPickup(db, { merchantId: merchant.id, orderId: order.id, input: other.row.pickupQrToken, pickupQrSecret: SECRET }),
      "INVALID_PICKUP_CODE",
    );
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe("READY_FOR_PICKUP");
    expect((await db.select().from(users).where(eq(users.id, customer.id)))[0].totalFoodSavedGrams).toBe(0);
  });

  it("another merchant → NOT_FOUND; unpaid → ORDER_STATE_CONFLICT; after deadline + grace → PICKUP_WINDOW_CLOSED", async () => {
    const { order, row } = await paidOrder(1);
    await expectCode(
      verifyPickup(db, { merchantId: otherMerchantId, orderId: order.id, input: row.pickupCode, pickupQrSecret: SECRET }),
      "NOT_FOUND",
    );

    const unpaid = await paidOrder(1, { pay: false });
    await expectCode(
      verifyPickup(db, { merchantId: merchant.id, orderId: unpaid.order.id, input: unpaid.row.pickupCode, pickupQrSecret: SECRET }),
      "ORDER_STATE_CONFLICT",
    );

    const withinGrace = new Date(row.pickupDeadlineAt.getTime() + (PICKUP_GRACE_MINUTES - 1) * 60_000);
    const tooLate = new Date(row.pickupDeadlineAt.getTime() + (PICKUP_GRACE_MINUTES + 1) * 60_000);
    await expectCode(
      verifyPickup(db, { merchantId: merchant.id, orderId: order.id, input: row.pickupCode, pickupQrSecret: SECRET, now: tooLate }),
      "PICKUP_WINDOW_CLOSED",
    );
    const done = await verifyPickup(db, {
      merchantId: merchant.id,
      orderId: order.id,
      input: row.pickupCode,
      pickupQrSecret: SECRET,
      now: withinGrace,
    });
    expect(done.status).toBe("COMPLETED");
  });
});
