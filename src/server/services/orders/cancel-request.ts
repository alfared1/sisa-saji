/**
 * Cancelling an order the buyer already paid online (QRIS / e-wallet).
 *
 *   buyer request  = POST /orders/:id/cancel-request: a reason (and a note for "Alasan lain").
 *                    One request per order, only while the order is PAID / READY_FOR_PICKUP and
 *                    before its pickup deadline. The warung may have set the portions aside, so
 *                    it decides.
 *   warung answer  = POST /merchant/orders/:id/cancel-request: APPROVE → CANCELLED, full refund,
 *                    portions back on the shelf; REJECT (note required) → the order stays as is.
 *   no answer      = a request still pending when closeUnclaimedOrders would expire the order is
 *                    approved instead (the buyer asked in time; the warung is not paid).
 *   out of stock   = POST /merchant/orders/:id/cancel { reason: "OUT_OF_STOCK" } on a paid order:
 *                    CANCELLED, full refund, the menu's remaining stock in the app becomes 0.
 *
 * Refunds: the warung's wallet is only credited at pickup (or at expiry), so a cancelled order
 * never touched it. The buyer gets total_customer_paid_idr back; with the payment simulator
 * the refund is recorded at once (refund_ref RFD-…). A real gateway would call its refund API
 * at the same point.
 */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { merchants, orderItems, orders, surplusBatches } from "@/db/schema";
import {
  CANCEL_REQUEST_REASONS,
  PAID_ORDER_CANCEL_REASONS,
  type CancelRequestReasonCode,
  type MerchantTicketCancelReason,
} from "@/lib/constants";
import type { OrderDetail } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { ApiError } from "@/server/http";
import { loadOrderDetails } from "@/server/mappers/order";
import { isPushEnabled, sendPushToUsers, type PushPayload } from "@/server/services/push";
import { returnSoldPortions } from "@/server/services/stock";
import { cancelTicketByMerchant } from "./hold";

const PAID_ONLINE_OPEN = ["PAID", "READY_FOR_PICKUP"] as const;

type PaidCancelReason = keyof typeof PAID_ORDER_CANCEL_REASONS;

/** "Tidak sempat datang" or "Alasan lain: …" as stored and shown to the warung. */
export function cancelRequestText(code: CancelRequestReasonCode, note?: string | null): string {
  const n = note?.trim();
  if (code === "OTHER") return n ? n : CANCEL_REQUEST_REASONS.OTHER;
  return n ? `${CANCEL_REQUEST_REASONS[code]}. ${n}` : CANCEL_REQUEST_REASONS[code];
}

function newRefundRef(): string {
  return `RFD-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/**
 * Moves an open paid online order to CANCELLED with a full refund. Returns false when the order
 * is no longer open (idempotent; the caller decides what that means).
 */
async function refundAndCancel(
  tx: Tx,
  orderId: string,
  reason: PaidCancelReason,
  now: Date,
  extra: Partial<typeof orders.$inferInsert> = {},
): Promise<boolean> {
  const [row] = await tx
    .update(orders)
    .set({
      status: "CANCELLED",
      cancelReason: PAID_ORDER_CANCEL_REASONS[reason].reason,
      refundAmountIdr: sql`${orders.totalCustomerPaidIdr}`,
      refundedAt: now,
      refundRef: newRefundRef(),
      updatedAt: now,
      ...extra,
    })
    .where(
      and(
        eq(orders.id, orderId),
        inArray(orders.status, [...PAID_ONLINE_OPEN]),
        isNotNull(orders.paidAt),
        ne(orders.paymentMethod, "BAYAR_DI_WARUNG"),
      ),
    )
    .returning({ id: orders.id });
  return Boolean(row);
}

function notify(db: Db, userIds: string[], payload: PushPayload) {
  if (!isPushEnabled()) return;
  void sendPushToUsers(db, userIds, payload).catch((err) =>
    console.warn("[cancel] push failed", err instanceof Error ? err.message : err),
  );
}

async function orderRow(db: Db, orderId: string) {
  const [o] = await db
    .select({
      id: orders.id,
      customerId: orders.customerId,
      merchantId: orders.merchantId,
      ownerUserId: merchants.ownerUserId,
      orderNumber: orders.orderNumber,
      status: orders.status,
      paymentMethod: orders.paymentMethod,
      paidAt: orders.paidAt,
      pickupDeadlineAt: orders.pickupDeadlineAt,
      totalPaid: orders.totalCustomerPaidIdr,
      requestStatus: orders.cancelRequestStatus,
    })
    .from(orders)
    .innerJoin(merchants, eq(merchants.id, orders.merchantId))
    .where(eq(orders.id, orderId))
    .limit(1);
  return o;
}

function assertOpenPaidOnline(o: NonNullable<Awaited<ReturnType<typeof orderRow>>>) {
  if (o.paymentMethod === "BAYAR_DI_WARUNG") {
    throw new ApiError("ORDER_STATE_CONFLICT", "Tiket bayar di warung bisa langsung dibatalkan tanpa persetujuan warung.");
  }
  if (!(PAID_ONLINE_OPEN as readonly string[]).includes(o.status) || !o.paidAt) {
    throw new ApiError(
      "ORDER_STATE_CONFLICT",
      o.status === "COMPLETED"
        ? "Pesanan ini sudah diambil."
        : o.status === "PENDING_PAYMENT"
          ? "Pesanan ini belum dibayar. Batalkan saja langsung."
          : "Pesanan ini sudah tidak aktif.",
    );
  }
}

/** Buyer: asks the warung to cancel a paid online order. */
export async function requestCancel(
  db: Db,
  args: { orderId: string; userId: string; reason: CancelRequestReasonCode; note?: string | null; now?: Date },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const o = await orderRow(db, args.orderId);
  if (!o || o.customerId !== args.userId) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  assertOpenPaidOnline(o);
  if (o.pickupDeadlineAt <= now) {
    throw new ApiError("ORDER_STATE_CONFLICT", "Batas waktu ambil sudah lewat, jadi pesanan ini tidak bisa dibatalkan lagi.");
  }
  if (o.requestStatus) {
    throw new ApiError(
      "ORDER_STATE_CONFLICT",
      o.requestStatus === "PENDING"
        ? "Permintaan batalmu masih menunggu jawaban warung."
        : "Permintaan batal untuk pesanan ini sudah dijawab warung.",
    );
  }
  const note = args.note?.trim() || null;
  if (args.reason === "OTHER" && !note) {
    throw new ApiError("VALIDATION_ERROR", "Tulis alasannya supaya warung bisa memutuskan.", [
      { path: "note", message: "Tulis alasannya" },
    ]);
  }
  const text = cancelRequestText(args.reason, note);
  const [row] = await db
    .update(orders)
    .set({ cancelRequestStatus: "PENDING", cancelRequestReason: text, cancelRequestedAt: now, updatedAt: now })
    .where(
      and(
        eq(orders.id, o.id),
        inArray(orders.status, [...PAID_ONLINE_OPEN]),
        sql`${orders.cancelRequestStatus} IS NULL`,
      ),
    )
    .returning({ id: orders.id });
  if (!row) throw new ApiError("ORDER_STATE_CONFLICT", "Status pesanan sudah berubah. Muat ulang halaman.");

  notify(db, [o.ownerUserId], {
    title: "Pembeli minta batal",
    body: `${o.orderNumber}: ${text}. Setujui atau tolak di halaman Pesanan.`,
    url: "/merchant/orders",
    tag: `cancel-${o.id}`,
  });
  const [detail] = await loadOrderDetails(db, [o.id], "customer");
  return detail;
}

/** Warung: approves (refund, portions back) or rejects (note required) a pending request. */
export async function respondToCancelRequest(
  db: Db,
  args: { merchantId: string; orderId: string; decision: "APPROVE" | "REJECT"; note?: string | null; now?: Date },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const o = await orderRow(db, args.orderId);
  if (!o || o.merchantId !== args.merchantId) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  if (o.requestStatus !== "PENDING") {
    throw new ApiError("ORDER_STATE_CONFLICT", "Tidak ada permintaan batal yang menunggu jawaban untuk pesanan ini.");
  }
  assertOpenPaidOnline(o);
  const note = args.note?.trim() || null;

  if (args.decision === "REJECT") {
    if (!note) {
      throw new ApiError("VALIDATION_ERROR", "Tulis alasan penolakannya untuk pembeli.", [
        { path: "note", message: "Tulis alasannya" },
      ]);
    }
    const [row] = await db
      .update(orders)
      .set({ cancelRequestStatus: "REJECTED", cancelRequestResponse: note, cancelRequestRespondedAt: now, updatedAt: now })
      .where(and(eq(orders.id, o.id), eq(orders.cancelRequestStatus, "PENDING"), inArray(orders.status, [...PAID_ONLINE_OPEN])))
      .returning({ id: orders.id });
    if (!row) throw new ApiError("ORDER_STATE_CONFLICT", "Status pesanan sudah berubah. Muat ulang daftar pesanan.");
    notify(db, [o.customerId], {
      title: "Permintaan batal ditolak",
      body: `${o.orderNumber}: ${note}`,
      url: `/orders/${o.id}`,
      tag: `cancel-${o.id}`,
    });
  } else {
    const done = await db.transaction(async (tx) => {
      const ok = await refundAndCancel(tx, o.id, "BUYER_APPROVED", now, {
        cancelRequestStatus: "APPROVED",
        cancelRequestRespondedAt: now,
      });
      if (ok) await returnSoldPortions(tx, o.id, now);
      return ok;
    });
    if (!done) throw new ApiError("ORDER_STATE_CONFLICT", "Status pesanan sudah berubah. Muat ulang daftar pesanan.");
    notify(db, [o.customerId], {
      title: "Permintaan batal disetujui",
      body: `${o.orderNumber} dibatalkan. ${formatIdr(o.totalPaid)} dikembalikan ke pembayaranmu.`,
      url: `/orders/${o.id}`,
      tag: `cancel-${o.id}`,
    });
  }
  const [detail] = await loadOrderDetails(db, [o.id], "merchant");
  return detail;
}

/**
 * Warung: POST /merchant/orders/:id/cancel. Open "bayar di warung" tickets keep their own rules
 * (hold.ts). A paid online order can only be cancelled for lack of stock: full refund, and the
 * menu's remaining stock in the app becomes 0 so nobody else orders food that is gone.
 */
export async function cancelOrderByMerchant(
  db: Db,
  args: { merchantId: string; orderId: string; reason: MerchantTicketCancelReason; now?: Date },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const o = await orderRow(db, args.orderId);
  if (!o || o.merchantId !== args.merchantId) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  if (o.paymentMethod === "BAYAR_DI_WARUNG") return cancelTicketByMerchant(db, { ...args, now });

  assertOpenPaidOnline(o);
  if (args.reason !== "OUT_OF_STOCK") {
    throw new ApiError(
      "ORDER_STATE_CONFLICT",
      "Pesanan yang sudah dibayar hanya bisa dibatalkan warung bila stoknya habis. Bila pembeli tidak datang, pesanan selesai sendiri setelah batas ambil.",
    );
  }
  const done = await db.transaction(async (tx) => {
    const ok = await refundAndCancel(
      tx,
      o.id,
      "OUT_OF_STOCK",
      now,
      // A pending buyer request is settled by this cancel.
      o.requestStatus === "PENDING" ? { cancelRequestStatus: "APPROVED", cancelRequestRespondedAt: now } : {},
    );
    if (!ok) return false;
    const lines = await tx.select({ batchId: orderItems.surplusBatchId }).from(orderItems).where(eq(orderItems.orderId, o.id));
    await tx
      .update(surplusBatches)
      .set({
        availableStock: 0,
        status: sql`CASE WHEN ${surplusBatches.status} = 'ACTIVE' AND ${surplusBatches.reservedStock} = 0
                         THEN 'SOLD_OUT'::batch_status ELSE ${surplusBatches.status} END`,
        updatedAt: now,
      })
      .where(and(inArray(surplusBatches.id, lines.map((l) => l.batchId)), eq(surplusBatches.merchantId, args.merchantId)));
    return true;
  });
  if (!done) throw new ApiError("ORDER_STATE_CONFLICT", "Status pesanan sudah berubah. Muat ulang daftar pesanan.");
  notify(db, [o.customerId], {
    title: "Pesananmu dibatalkan warung",
    body: `Stok habis untuk ${o.orderNumber}. ${formatIdr(o.totalPaid)} dikembalikan ke pembayaranmu.`,
    url: `/orders/${o.id}`,
    tag: `cancel-${o.id}`,
  });
  const [detail] = await loadOrderDetails(db, [o.id], "merchant");
  return detail;
}

/**
 * Called by closeUnclaimedOrders inside its transaction before expiring an order: a buyer's
 * request the warung never answered is approved (refund, portions back). Returns true when it
 * cancelled the order, so the caller must not expire it or credit the warung.
 */
export async function settleUnansweredRequest(tx: Tx, orderId: string, now: Date): Promise<boolean> {
  const [pending] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.cancelRequestStatus, "PENDING")))
    .limit(1);
  if (!pending) return false;
  const ok = await refundAndCancel(tx, orderId, "BUYER_UNANSWERED", now, {
    cancelRequestStatus: "APPROVED",
    cancelRequestRespondedAt: now,
  });
  if (ok) await returnSoldPortions(tx, orderId, now);
  return ok;
}
