/**
 * Customer order queries & actions: list, detail (customer or merchant viewer),
 * cancel, simulated payment, review.
 */
import "server-only";
import { and, avg, count, desc, eq, inArray, lte } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { merchants, orders, reviews } from "@/db/schema";
import type { OrderDetail, OrderListQuery, OrderStatus, ReviewBody } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { loadOrderDetails } from "@/server/mappers/order";
import { receivePaymentWebhook, signWebhookBody, newGatewayRef } from "@/server/services/payment/webhook";
import { abandonPayAtWarungOrder, abandonPendingOrder } from "@/server/services/stock";
import { expireLapsedHolds } from "./hold";

type OrderListInput = z.output<typeof OrderListQuery>;
type ReviewInput = z.output<typeof ReviewBody>;

export const ACTIVE_STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "READY_FOR_PICKUP"];
export const UNPAID_EXPIRY_REASON = "Pembayaran tidak diselesaikan dalam 10 menit";

/**
 * Lazily expires the given user's unpaid orders past payment_expires_at and lapsed
 * "bayar di warung" tickets (the worker does it for everyone).
 */
async function expireStaleFor(db: Db, where: { customerId?: string; orderId?: string }, now: Date) {
  await expireLapsedHolds(db, where, now);
  const conds = [eq(orders.status, "PENDING_PAYMENT"), lte(orders.paymentExpiresAt, now)];
  if (where.customerId) conds.push(eq(orders.customerId, where.customerId));
  if (where.orderId) conds.push(eq(orders.id, where.orderId));
  const stale = await db.select({ id: orders.id }).from(orders).where(and(...conds)).limit(50);
  for (const { id } of stale) {
    await db.transaction((tx) => abandonPendingOrder(tx, id, "EXPIRED", UNPAID_EXPIRY_REASON, now));
  }
}

export async function listCustomerOrders(
  db: Db,
  userId: string,
  q: OrderListInput,
  now: Date = new Date(),
): Promise<OrderDetail[]> {
  await expireStaleFor(db, { customerId: userId }, now);
  const conds = [eq(orders.customerId, userId)];
  if (q.status === "ACTIVE") conds.push(inArray(orders.status, ACTIVE_STATUSES));
  else if (q.status) conds.push(eq(orders.status, q.status));
  const ids = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(...conds))
    .orderBy(desc(orders.createdAt))
    .limit(q.limit);
  return loadOrderDetails(db, ids.map((r) => r.id), "customer");
}

/** Customer owner → customer view; the order's merchant owner → merchant view; anyone else → 404. */
export async function getOrderForViewer(
  db: Db,
  orderId: string,
  viewer: { userId: string; merchantId: string | null },
  now: Date = new Date(),
): Promise<OrderDetail> {
  const [o] = await db
    .select({ customerId: orders.customerId, merchantId: orders.merchantId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!o) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  let as: "customer" | "merchant";
  if (o.customerId === viewer.userId) as = "customer";
  else if (viewer.merchantId && o.merchantId === viewer.merchantId) as = "merchant";
  else throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");

  await expireStaleFor(db, { orderId }, now);
  const [detail] = await loadOrderDetails(db, [orderId], as);
  if (!detail) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  return detail;
}

async function ownedOrder(db: Db, orderId: string, userId: string) {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!o || o.customerId !== userId) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  return o;
}

export async function cancelOrder(db: Db, orderId: string, userId: string, now: Date = new Date()): Promise<OrderDetail> {
  await ownedOrder(db, orderId, userId);
  // A lapsed order expires first, so it counts as not collected rather than cancelled.
  await expireStaleFor(db, { orderId }, now);
  const o = await ownedOrder(db, orderId, userId);
  // Pilot tickets are paid at the warung, so they stay cancellable until the pickup.
  const payAtWarung = o.status === "READY_FOR_PICKUP" && o.paymentMethod === "BAYAR_DI_WARUNG" && !o.paidAt;
  if (o.status !== "PENDING_PAYMENT" && !payAtWarung) {
    throw new ApiError(
      "ORDER_STATE_CONFLICT",
      o.status === "EXPIRED" || o.status === "CANCELLED"
        ? "Pesanan ini sudah tidak aktif."
        : "Hanya pesanan yang belum dibayar yang bisa dibatalkan",
    );
  }
  const done = await db.transaction((tx) =>
    payAtWarung
      ? abandonPayAtWarungOrder(tx, orderId, "CANCELLED", "Dibatalkan oleh pembeli", now)
      : abandonPendingOrder(tx, orderId, "CANCELLED", "Dibatalkan oleh pembeli", now),
  );
  if (!done) throw new ApiError("ORDER_STATE_CONFLICT", "Status pesanan sudah berubah");
  const [detail] = await loadOrderDetails(db, [orderId], "customer");
  return detail;
}

/**
 * Demo payment: builds the gateway's webhook body, signs it with the webhook secret
 * and runs it through the same receivePaymentWebhook() as POST /webhooks/payment.
 */
export async function simulatePayment(
  db: Db,
  args: { orderId: string; userId: string; webhookSecret: string; now?: Date },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const o = await ownedOrder(db, args.orderId, args.userId);
  if (o.status === "PENDING_PAYMENT") {
    if (o.paymentExpiresAt <= now) {
      await db.transaction((tx) => abandonPendingOrder(tx, o.id, "EXPIRED", UNPAID_EXPIRY_REASON, now));
      throw new ApiError("PAYMENT_EXPIRED", "Waktu pembayaran sudah habis. Silakan pesan ulang.");
    }
    const raw = JSON.stringify({
      order_id: o.id,
      gateway_ref: o.paymentGatewayRef ?? newGatewayRef(),
      status: "PAID",
      amount_idr: o.totalCustomerPaidIdr,
    });
    await receivePaymentWebhook(db, raw, signWebhookBody(raw, args.webhookSecret), args.webhookSecret, now);
  } else if (o.status === "EXPIRED" || o.status === "CANCELLED") {
    throw new ApiError("ORDER_STATE_CONFLICT", "Pesanan ini sudah tidak bisa dibayar");
  }
  // Already paid: idempotent, return current state.
  const [detail] = await loadOrderDetails(db, [o.id], "customer");
  return detail;
}

export async function reviewOrder(
  db: Db,
  args: { orderId: string; userId: string; input: ReviewInput; now?: Date },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const o = await ownedOrder(db, args.orderId, args.userId);
  if (o.status !== "COMPLETED") {
    throw new ApiError("ORDER_STATE_CONFLICT", "Ulasan hanya bisa diberikan setelah pesanan diambil");
  }
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(reviews)
      .values({
        orderId: o.id,
        customerId: o.customerId,
        merchantId: o.merchantId,
        rating: args.input.rating,
        tags: args.input.tags,
        comment: args.input.comment || null,
        createdAt: now,
      })
      .onConflictDoNothing({ target: reviews.orderId })
      .returning({ id: reviews.id });
    if (inserted.length === 0) throw new ApiError("CONFLICT", "Pesanan ini sudah diulas");

    const [agg] = await tx
      .select({ avg: avg(reviews.rating), n: count() })
      .from(reviews)
      .where(eq(reviews.merchantId, o.merchantId));
    await tx
      .update(merchants)
      .set({
        ratingAvg: Math.round(Number(agg.avg ?? 5) * 100) / 100,
        totalReviews: agg.n,
        updatedAt: now,
      })
      .where(eq(merchants.id, o.merchantId));
  });
  const [detail] = await loadOrderDetails(db, [o.id], "customer");
  return detail;
}
