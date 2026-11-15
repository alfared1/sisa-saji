/**
 * Order chat: only the buyer and the order's warung take part, messages flow while the order
 * waits to be collected, opening the chat marks the other side's messages read (and clears the
 * unread count on the order), the per-order rate limit holds, and the chat closes afterwards.
 */
import { randomInt } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, orders, surplusBatches, users } from "@/db/schema";
import { ORDER_CHAT_RATE_LIMIT } from "@/lib/constants";
import { CheckoutBody } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { pollMerchantEvents } from "@/server/services/merchant/stream";
import { listOrderMessages, sendOrderMessage } from "@/server/services/orders/chat";
import { checkout } from "@/server/services/orders/checkout";
import { getOrderForViewer, simulatePayment } from "@/server/services/orders/orders";
import { verifyPickup } from "@/server/services/orders/pickup";
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

async function paidOrder() {
  const [customer] = await db
    .insert(users)
    .values({ fullName: "Pembeli Chat", phoneNumber: `+62896${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  const [menu] = await db.select().from(menus).where(eq(menus.merchantId, merchant.id)).orderBy(asc(menus.id)).limit(1);
  const now = Date.now();
  const [batch] = await db
    .insert(surplusBatches)
    .values({
      merchantId: merchant.id,
      menuId: menu.id,
      batchDate: wibDate(),
      initialStock: 5,
      availableStock: 5,
      originalPriceIdr: menu.originalPriceIdr,
      currentDiscountPct: 50,
      currentSellingPriceIdr: Math.round(menu.originalPriceIdr / 2),
      pickupStartTime: new Date(now - 30 * 60_000),
      pickupEndTime: new Date(now + 90 * 60_000),
    })
    .returning();
  const o = await checkout(db, {
    userId: customer.id,
    input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }),
    pickupQrSecret: TEST_PICKUP_QR_SECRET,
  });
  const paid = await simulatePayment(db, { orderId: o.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
  return { customer, order: paid };
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
}

describe("order chat", () => {
  it("buyer and warung exchange messages; reading clears the unread count", async () => {
    const { customer, order } = await paidOrder();
    const buyer = { userId: customer.id, merchantId: null };
    const warung = { userId: merchant.ownerUserId, merchantId: merchant.id };
    const since = new Date(Date.now() - 1000);

    const first = await sendOrderMessage(db, { orderId: order.id, viewer: buyer, body: "  Sudah sampai di warung  " });
    expect(first).toMatchObject({ sender: "CUSTOMER", body: "Sudah sampai di warung", mine: true, read_at: null });

    // The warung's live feed announces it, and the order shows one unread message.
    const events = await pollMerchantEvents(db, merchant.id, since);
    expect(events.some((e) => e.event.type === "order.message" && e.event.order_id === order.id)).toBe(true);
    expect((await getOrderForViewer(db, order.id, warung)).unread_messages).toBe(1);
    expect((await getOrderForViewer(db, order.id, buyer)).unread_messages).toBe(0);

    const seen = await listOrderMessages(db, order.id, warung);
    expect(seen.viewer).toBe("MERCHANT");
    expect(seen.can_send).toBe(true);
    expect(seen.messages).toHaveLength(1);
    expect(seen.messages[0].mine).toBe(false);
    expect((await getOrderForViewer(db, order.id, warung)).unread_messages).toBe(0);

    await sendOrderMessage(db, { orderId: order.id, viewer: warung, body: "Pesanan sudah siap" });
    const thread = await listOrderMessages(db, order.id, buyer);
    expect(thread.messages.map((m) => [m.sender, m.mine])).toEqual([
      ["CUSTOMER", true],
      ["MERCHANT", false],
    ]);
    // The buyer's first message was read by the warung.
    expect(thread.messages[0].read_at).not.toBeNull();
  });

  it("nobody else can read or write; empty messages are refused", async () => {
    const { customer, order } = await paidOrder();
    const [stranger] = await db
      .insert(users)
      .values({ fullName: "Orang Lain", phoneNumber: `+62897${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
      .returning();
    await expectCode(listOrderMessages(db, order.id, { userId: stranger.id, merchantId: null }), "NOT_FOUND");
    await expectCode(
      sendOrderMessage(db, { orderId: order.id, viewer: { userId: other.ownerUserId, merchantId: other.id }, body: "Halo" }),
      "NOT_FOUND",
    );
    await expectCode(
      sendOrderMessage(db, { orderId: order.id, viewer: { userId: customer.id, merchantId: null }, body: "   " }),
      "VALIDATION_ERROR",
    );
  });

  it("limits messages per sender per order", async () => {
    const { customer, order } = await paidOrder();
    const buyer = { userId: customer.id, merchantId: null };
    for (let i = 0; i < ORDER_CHAT_RATE_LIMIT; i++) {
      await sendOrderMessage(db, { orderId: order.id, viewer: buyer, body: `Pesan ${i + 1}` });
    }
    await expectCode(sendOrderMessage(db, { orderId: order.id, viewer: buyer, body: "Satu lagi" }), "RATE_LIMITED");
    // The warung can still answer.
    await sendOrderMessage(db, { orderId: order.id, viewer: { userId: merchant.ownerUserId, merchantId: merchant.id }, body: "Sabar ya" });
  });

  it("closes once the order is collected but stays readable", async () => {
    const { customer, order } = await paidOrder();
    const buyer = { userId: customer.id, merchantId: null };
    await sendOrderMessage(db, { orderId: order.id, viewer: buyer, body: "Saya sedang di jalan" });
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    await verifyPickup(db, { merchantId: merchant.id, orderId: order.id, input: row.pickupCode, pickupQrSecret: TEST_PICKUP_QR_SECRET });

    const thread = await listOrderMessages(db, order.id, buyer);
    expect(thread.can_send).toBe(false);
    expect(thread.messages).toHaveLength(1);
    await expectCode(sendOrderMessage(db, { orderId: order.id, viewer: buyer, body: "Terima kasih" }), "ORDER_STATE_CONFLICT");
  });
});
