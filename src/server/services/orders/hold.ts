/**
 * "Bayar di warung" tickets (every warung; pilot warung only take these): the portions are
 * reserved without any payment, so the hold is short and the warung can end it.
 *
 *   hold end   = min(checkout + PAY_AT_WARUNG_HOLD_MINUTES, batch pickup end)
 *                stored as the ticket's pickup_deadline_at (and payment_expires_at), so the
 *                ticket, the merchant queue and the scan screen all count down to it.
 *   expiry     = at the hold end, no grace: EXPIRED, portions back on the shelf
 *                (closeUnclaimedOrders job, plus lazy expiry wherever tickets are read).
 *   warung     = may cancel an open ticket ("Stok habis" any time, "Tidak datang" only near
 *                the hold end, see noShowCancelOpensAt).
 */
import "server-only";
import { and, eq, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "@/db/client";
import { orderItems, orders, surplusBatches } from "@/db/schema";
import {
  MERCHANT_TICKET_CANCEL_REASONS,
  PAY_AT_WARUNG_EXPIRED_REASON,
  PAY_AT_WARUNG_HOLD_MINUTES,
  noShowCancelOpensAt,
  type MerchantTicketCancelReason,
} from "@/lib/constants";
import { formatClockId } from "@/lib/time";
import type { OrderDetail } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { loadOrderDetails } from "@/server/mappers/order";
import { abandonPayAtWarungOrder } from "@/server/services/stock";

/** Open, unpaid "bayar di warung" ticket at any warung (portions still reserved, nothing paid). */
export const OPEN_PAY_AT_WARUNG = and(
  eq(orders.status, "READY_FOR_PICKUP"),
  eq(orders.paymentMethod, "BAYAR_DI_WARUNG"),
  isNull(orders.paidAt),
);

/** When a ticket created at `now` stops holding its portions. */
export function payAtWarungHoldEnd(now: Date, pickupEnd: Date): Date {
  return new Date(Math.min(now.getTime() + PAY_AT_WARUNG_HOLD_MINUTES * 60_000, pickupEnd.getTime()));
}

/** True once an open ticket's hold has ended (it can no longer be collected). */
export function isHoldOver(pickupDeadlineAt: Date, now: Date): boolean {
  return pickupDeadlineAt.getTime() <= now.getTime();
}

export type HoldScope = { customerId?: string; merchantId?: string; orderId?: string; batchIds?: string[] };

/**
 * Expires open tickets in `scope` whose hold has ended, returning their portions.
 * Runs inside the caller's transaction when given one. Returns the number expired.
 */
export async function expireLapsedHolds(dbOrTx: DbOrTx, scope: HoldScope, now: Date): Promise<number> {
  const conds: (SQL | undefined)[] = [OPEN_PAY_AT_WARUNG, lte(orders.pickupDeadlineAt, now)];
  if (scope.customerId) conds.push(eq(orders.customerId, scope.customerId));
  if (scope.merchantId) conds.push(eq(orders.merchantId, scope.merchantId));
  if (scope.orderId) conds.push(eq(orders.id, scope.orderId));
  let ids: string[];
  if (scope.batchIds) {
    if (scope.batchIds.length === 0) return 0;
    const rows = await dbOrTx
      .selectDistinct({ id: orders.id })
      .from(orders)
      .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
      .where(and(...conds, inArray(orderItems.surplusBatchId, scope.batchIds)))
      // Same lock order everywhere, so concurrent checkouts cannot deadlock on two tickets.
      .orderBy(orders.id)
      .limit(100);
    ids = rows.map((r) => r.id);
  } else {
    const rows = await dbOrTx.select({ id: orders.id }).from(orders).where(and(...conds)).orderBy(orders.id).limit(100);
    ids = rows.map((r) => r.id);
  }
  let n = 0;
  for (const id of ids) {
    // Inside a caller's transaction this is a savepoint.
    const done = await (dbOrTx as Db).transaction((tx: Tx) =>
      abandonPayAtWarungOrder(tx, id, "EXPIRED", PAY_AT_WARUNG_EXPIRED_REASON, now),
    );
    if (done) n++;
  }
  return n;
}

/**
 * The warung cancels an open "bayar di warung" ticket; the buyer sees the reason on it.
 *  - NO_SHOW ("Tidak datang"): the portions go back on the shelf for other buyers. Only from
 *    noShowCancelOpensAt (near the hold end): it counts as the buyer's no-show.
 *  - OUT_OF_STOCK ("Stok habis"): the reservation is released too, but the food is gone, so
 *    the menu's remaining stock in the app becomes 0 (like setting it to 0 on the dashboard)
 *    instead of showing portions nobody can collect.
 */
export async function cancelTicketByMerchant(
  db: Db,
  args: { merchantId: string; orderId: string; reason: MerchantTicketCancelReason; now?: Date },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const [o] = await db
    .select({
      merchantId: orders.merchantId,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      paidAt: orders.paidAt,
      createdAt: orders.createdAt,
      pickupDeadlineAt: orders.pickupDeadlineAt,
    })
    .from(orders)
    .where(eq(orders.id, args.orderId))
    .limit(1);
  if (!o || o.merchantId !== args.merchantId) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  if (o.paymentMethod !== "BAYAR_DI_WARUNG") {
    throw new ApiError("ORDER_STATE_CONFLICT", "Hanya tiket bayar di warung yang bisa dibatalkan warung.");
  }
  if (o.status !== "READY_FOR_PICKUP" || o.paidAt) {
    throw new ApiError(
      "ORDER_STATE_CONFLICT",
      o.status === "COMPLETED" ? "Tiket ini sudah diambil." : "Tiket ini sudah tidak aktif.",
    );
  }
  if (args.reason === "NO_SHOW") {
    const opensAt = noShowCancelOpensAt(o.createdAt, o.pickupDeadlineAt);
    if (now < opensAt) {
      throw new ApiError(
        "ORDER_STATE_CONFLICT",
        `Pembeli masih punya waktu sampai jam ${formatClockId(o.pickupDeadlineAt)}. "Tidak datang" bisa dipilih mulai jam ${formatClockId(opensAt)}. Kalau stoknya memang habis, pilih "Stok habis".`,
        { no_show_from: opensAt.toISOString() },
      );
    }
  }
  const done = await db.transaction(async (tx) => {
    const ok = await abandonPayAtWarungOrder(tx, args.orderId, "CANCELLED", MERCHANT_TICKET_CANCEL_REASONS[args.reason].reason, now);
    if (ok && args.reason === "OUT_OF_STOCK") {
      const lines = await tx
        .select({ batchId: orderItems.surplusBatchId })
        .from(orderItems)
        .where(eq(orderItems.orderId, args.orderId));
      await tx
        .update(surplusBatches)
        .set({
          availableStock: 0,
          status: sql`CASE WHEN ${surplusBatches.status} = 'ACTIVE' AND ${surplusBatches.reservedStock} = 0
                           THEN 'SOLD_OUT'::batch_status ELSE ${surplusBatches.status} END`,
          updatedAt: now,
        })
        .where(and(inArray(surplusBatches.id, lines.map((l) => l.batchId)), eq(surplusBatches.merchantId, args.merchantId)));
    }
    return ok;
  });
  if (!done) throw new ApiError("ORDER_STATE_CONFLICT", "Status tiket sudah berubah. Muat ulang daftar pesanan.");
  const [detail] = await loadOrderDetails(db, [args.orderId], "merchant");
  return detail;
}
