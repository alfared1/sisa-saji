/**
 * Checkout: one transaction:
 *   reserve stock (stock.reserveItems, row-level conditional UPDATE)
 *   → price lines from each batch's current price (snapshotted in order_items)
 *   → computeOrderTotals → order number / pickup code / QR token
 *   → simulated dynamic QRIS → PENDING_PAYMENT order.
 *
 * Pilot warung (merchants.is_pilot): the customer pays the warung directly at pickup.
 * The order is a ticket right away (READY_FOR_PICKUP, payment_method BAYAR_DI_WARUNG,
 * no QRIS, no service fee, no voucher) and its portions stay reserved until the warung
 * verifies the pickup (see pickup.ts) or the order is cancelled / not collected.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { menus, merchants, orderItems, orders, surplusBatches, users } from "@/db/schema";
import { DEMO_VOUCHERS, PAYMENT_TTL_SECONDS } from "@/lib/constants";
import type { CheckoutBody, OrderDetail } from "@/lib/contracts";
import { createPickupToken, generatePickupCode } from "@/lib/pickup-token";
import { computeOrderTotals, type OrderLineInput } from "@/lib/pricing/order-totals";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { loadOrderDetails } from "@/server/mappers/order";
import { buildDynamicQris, cityFromAddress } from "@/server/services/payment/qris";
import { newGatewayRef } from "@/server/services/payment/webhook";
import { abandonPendingOrder, reserveItems, type Tx } from "@/server/services/stock";

/** Open, unpaid "bayar di warung" ticket: counts as an unpaid hold for the fair-use limits. */
const UNPAID_PAY_AT_WARUNG = and(
  eq(orders.status, "READY_FOR_PICKUP"),
  eq(orders.paymentMethod, "BAYAR_DI_WARUNG"),
  isNull(orders.paidAt),
);

export type CheckoutInput = z.output<typeof CheckoutBody>;

const ACTIVE_ORDER_STATUSES = ["PENDING_PAYMENT", "PAID", "READY_FOR_PICKUP"] as const;
/** Clock-skew tolerance for scheduled_pickup_time slightly in the past. */
const SCHEDULE_SKEW_MS = 60_000;
const MAX_INSERT_ATTEMPTS = 8;

export function findVoucher(code: string | undefined) {
  if (!code) return null;
  const v = DEMO_VOUCHERS.find((d) => d.code === code.trim().toUpperCase());
  if (!v) throw new ApiError("VOUCHER_INVALID", "Kode voucher tidak dikenal");
  return v;
}

/** "SS-YYYYMMDD-NNNN" (WIB date), next free sequence number of the day. */
async function nextOrderNumber(tx: Tx, now: Date, bump: number): Promise<string> {
  const prefix = `SS-${wibDate(now).replaceAll("-", "")}-`;
  const [last] = await tx
    .select({ n: orders.orderNumber })
    .from(orders)
    .where(like(orders.orderNumber, `${prefix}%`))
    .orderBy(desc(orders.orderNumber))
    .limit(1);
  const seq = (last ? Number.parseInt(last.n.slice(prefix.length), 10) || 0 : 0) + 1 + bump;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/** A 4-digit code not used by the merchant's orders that are still awaiting pickup. */
async function freePickupCode(tx: Tx, merchantId: string): Promise<string> {
  const used = await tx
    .select({ code: orders.pickupCode })
    .from(orders)
    .where(and(eq(orders.merchantId, merchantId), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])));
  const taken = new Set(used.map((u) => u.code));
  for (let i = 0; i < 100; i++) {
    const c = generatePickupCode();
    if (!taken.has(c)) return c;
  }
  for (let n = 0; n < 10_000; n++) {
    const c = String(n).padStart(4, "0");
    if (!taken.has(c)) return c;
  }
  throw new ApiError("CONFLICT", "Warung sedang menerima terlalu banyak pesanan. Coba lagi sebentar.");
}

/* ---------------------------- fair use ---------------------------- */
/*  Stock is scarce (often < 10 portions), so one account must not be able to hold
 *  it all: limits on unpaid checkouts, portions per batch and checkout churn.     */

/** Unpaid (PENDING_PAYMENT) checkouts a customer may hold at once, across warung. */
export const MAX_PENDING_ORDERS_PER_USER = 2;
/** Cancelled/expired checkouts within the window before new checkouts are refused. */
export const MAX_ABANDONED_ORDERS_IN_WINDOW = 3;
export const ABANDONED_ORDERS_WINDOW_MINUTES = 30;
/** Portions of one batch a customer may hold across their active orders. */
export function maxPortionsPerCustomer(initialStock: number): number {
  return Math.max(3, Math.ceil(initialStock / 2));
}

const sameItems = (a: Map<string, number>, b: Map<string, number>) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/**
 * Enforces the fair-use limits inside the checkout transaction (the users row lock
 * serialises concurrent checkouts of one customer). Returns the id of an existing
 * identical unpaid order at the same warung (idempotent retry / double tap), or null.
 */
async function enforceFairUse(
  tx: Tx,
  args: { userId: string; merchantId: string; items: Map<string, number>; now: Date },
): Promise<string | null> {
  const { userId, merchantId, items, now } = args;
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");

  const pendingRows = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      merchantId: orders.merchantId,
      paymentExpiresAt: orders.paymentExpiresAt,
      status: orders.status,
    })
    .from(orders)
    .where(and(eq(orders.customerId, userId), or(eq(orders.status, "PENDING_PAYMENT"), UNPAID_PAY_AT_WARUNG)));
  const pending: typeof pendingRows = [];
  for (const o of pendingRows) {
    // Lazily expire stale unpaid checkouts the worker has not reached yet.
    if (o.status === "PENDING_PAYMENT" && o.paymentExpiresAt && o.paymentExpiresAt <= now) {
      await abandonPendingOrder(tx, o.id, "EXPIRED", "Pembayaran tidak diselesaikan dalam 10 menit", now);
    } else pending.push(o);
  }

  const atSameWarung = pending.find((o) => o.merchantId === merchantId);
  if (atSameWarung) {
    const lines = await tx
      .select({ batchId: orderItems.surplusBatchId, quantity: orderItems.quantity })
      .from(orderItems)
      .where(eq(orderItems.orderId, atSameWarung.id));
    const existing = new Map<string, number>();
    for (const l of lines) existing.set(l.batchId, (existing.get(l.batchId) ?? 0) + l.quantity);
    if (sameItems(existing, items)) return atSameWarung.id;
    throw new ApiError(
      "CONFLICT",
      atSameWarung.status === "PENDING_PAYMENT"
        ? `Kamu masih punya pesanan belum dibayar di warung ini (${atSameWarung.orderNumber}). Bayar atau batalkan dulu.`
        : `Kamu masih punya pesanan yang belum diambil di warung ini (${atSameWarung.orderNumber}). Ambil atau batalkan dulu.`,
      { order_id: atSameWarung.id, order_number: atSameWarung.orderNumber },
    );
  }
  if (pending.length >= MAX_PENDING_ORDERS_PER_USER) {
    throw new ApiError("CONFLICT", "Selesaikan atau batalkan pesanan yang belum dibayar dulu.", {
      pending_order_ids: pending.map((o) => o.id),
    });
  }

  const windowStart = new Date(now.getTime() - ABANDONED_ORDERS_WINDOW_MINUTES * 60_000);
  const [abandoned] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, userId),
        inArray(orders.status, ["CANCELLED", "EXPIRED"]),
        gt(orders.updatedAt, windowStart),
      ),
    );
  if ((abandoned?.n ?? 0) >= MAX_ABANDONED_ORDERS_IN_WINDOW) {
    throw new ApiError("RATE_LIMITED", "Terlalu banyak pesanan dibatalkan atau tidak dibayar. Coba lagi nanti.", {
      retry_after_minutes: ABANDONED_ORDERS_WINDOW_MINUTES,
    });
  }

  const batchIds = [...items.keys()];
  const held = await tx
    .select({ batchId: orderItems.surplusBatchId, qty: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orders.customerId, userId),
        inArray(orders.status, [...ACTIVE_ORDER_STATUSES]),
        inArray(orderItems.surplusBatchId, batchIds),
      ),
    )
    .groupBy(orderItems.surplusBatchId);
  const heldBy = new Map(held.map((h) => [h.batchId, h.qty]));
  const batches = await tx
    .select({ id: surplusBatches.id, initialStock: surplusBatches.initialStock })
    .from(surplusBatches)
    .where(inArray(surplusBatches.id, batchIds));
  for (const b of batches) {
    const cap = maxPortionsPerCustomer(b.initialStock);
    const already = heldBy.get(b.id) ?? 0;
    if (already + (items.get(b.id) ?? 0) > cap) {
      const left = Math.max(0, cap - already);
      throw new ApiError(
        "VALIDATION_ERROR",
        left > 0
          ? `Maksimal ${cap} porsi menu ini per pembeli. Kamu masih bisa memesan ${left} porsi lagi.`
          : `Kamu sudah memesan batas maksimal ${cap} porsi menu ini.`,
        [{ path: "items", message: `Maksimal ${cap} porsi per pembeli`, batch_id: b.id, max_quantity: cap }],
      );
    }
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; i++) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "23505") return true;
    e = typeof e === "object" && e !== null && "cause" in e ? (e as { cause: unknown }).cause : null;
  }
  return false;
}

export async function checkout(
  db: Db,
  args: { userId: string; input: CheckoutInput; pickupQrSecret: string; now?: Date },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const { input } = args;

  const voucher = findVoucher(input.voucher_code);
  const orderId = randomUUID();

  // Every query (merchant check → reservation → insert → response view) runs in ONE
  // transaction: consistent, and safe on the single-session PGlite dev/test server,
  // which interleaves protocol messages of concurrent connections outside a transaction.
  return db.transaction(async (tx) => {
    const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, input.merchant_id)).limit(1);
    if (!merchant) throw new ApiError("NOT_FOUND", "Warung tidak ditemukan");
    if (!merchant.isOpen) throw new ApiError("BATCH_CLOSED", "Warung sedang tutup");
    if (merchant.ownerUserId === args.userId) {
      throw new ApiError("FORBIDDEN", "Tidak bisa memesan dari warung sendiri");
    }
    const payAtWarung = merchant.isPilot;
    if (!payAtWarung && input.payment_method === "BAYAR_DI_WARUNG") {
      throw new ApiError("VALIDATION_ERROR", "Bayar di warung hanya untuk warung uji coba", [
        { path: "payment_method", message: "Pilih QRIS atau dompet digital" },
      ]);
    }
    if (payAtWarung && voucher) {
      throw new ApiError("VOUCHER_INVALID", "Voucher belum berlaku di warung uji coba. Pembayaran langsung ke warung.");
    }

    const requested = new Map<string, number>();
    for (const it of input.items) requested.set(it.batch_id, (requested.get(it.batch_id) ?? 0) + it.quantity);
    const existingId = await enforceFairUse(tx, { userId: args.userId, merchantId: merchant.id, items: requested, now });
    if (existingId) {
      const [existing] = await loadOrderDetails(tx, [existingId], "customer");
      if (existing) return existing;
    }

    const reserved = await reserveItems(
      tx,
      merchant.id,
      input.items.map((i) => ({ batchId: i.batch_id, quantity: i.quantity })),
      now,
    );
    const menuRows = await tx
      .select()
      .from(menus)
      .where(inArray(menus.id, [...new Set(reserved.map((b) => b.menuId))]));
    const menuById = new Map(menuRows.map((m) => [m.id, m]));

    // reserveItems merges duplicate batch ids; mirror that for the order lines.
    const qtyByBatch = new Map<string, number>();
    for (const it of input.items) qtyByBatch.set(it.batch_id, (qtyByBatch.get(it.batch_id) ?? 0) + it.quantity);

    const lines = reserved.map((b) => {
      const menu = menuById.get(b.menuId);
      if (!menu) throw new ApiError("NOT_FOUND", "Menu tidak ditemukan");
      const line: OrderLineInput = {
        quantity: qtyByBatch.get(b.id) ?? 0,
        unitOriginalPriceIdr: b.originalPriceIdr,
        unitSellingPriceIdr: b.currentSellingPriceIdr,
        portionWeightGrams: menu.portionWeightGrams,
      };
      return { batch: b, menu, line };
    });

    const subtotalRecovery = lines.reduce((s, l) => s + l.line.quantity * l.line.unitSellingPriceIdr, 0);
    if (voucher && subtotalRecovery < voucher.min_subtotal_idr) {
      throw new ApiError(
        "VOUCHER_INVALID",
        `Voucher ${voucher.code} butuh minimal belanja Rp ${voucher.min_subtotal_idr.toLocaleString("id-ID")}`,
        { min_subtotal_idr: voucher.min_subtotal_idr },
      );
    }
    const totals = computeOrderTotals(
      lines.map((l) => l.line),
      // Pilot: the warung collects the recovery price itself; the platform charges nothing.
      { voucherDiscountIdr: voucher?.discount_idr ?? 0, platformCommissionIdr: payAtWarung ? 0 : undefined },
    );

    const deadline = new Date(Math.min(...reserved.map((b) => b.pickupEndTime.getTime())));
    // Pay-at-warung tickets have no online payment window: they run to the pickup deadline.
    const paymentExpiresAt = payAtWarung
      ? deadline
      : new Date(Math.min(now.getTime() + PAYMENT_TTL_SECONDS * 1000, deadline.getTime()));

    let scheduled: Date | null = null;
    if (input.scheduled_pickup_time) {
      scheduled = new Date(input.scheduled_pickup_time);
      if (scheduled.getTime() < now.getTime() - SCHEDULE_SKEW_MS || scheduled > deadline) {
        throw new ApiError("VALIDATION_ERROR", "Waktu ambil harus di antara sekarang dan batas pengambilan", [
          { path: "scheduled_pickup_time", message: `Pilih waktu sebelum ${deadline.toISOString()}` },
        ]);
      }
    }

    for (let attempt = 0; ; attempt++) {
      const orderNumber = await nextOrderNumber(tx, now, attempt);
      const pickupCode = await freePickupCode(tx, merchant.id);
      try {
        // Savepoint: a unique violation must not abort the outer transaction.
        await tx.transaction(async (sp) => {
          await sp.insert(orders).values({
            id: orderId,
            orderNumber,
            customerId: args.userId,
            merchantId: merchant.id,
            status: payAtWarung ? "READY_FOR_PICKUP" : "PENDING_PAYMENT",
            pickupCode,
            pickupQrToken: createPickupToken(orderId, pickupCode, args.pickupQrSecret),
            scheduledPickupTime: scheduled,
            pickupDeadlineAt: deadline,
            usesOwnLunchbox: input.uses_own_lunchbox,
            subtotalOriginalIdr: totals.subtotalOriginalIdr,
            subtotalRecoveryIdr: totals.subtotalRecoveryIdr,
            voucherDiscountIdr: totals.voucherDiscountIdr,
            platformCommissionIdr: totals.platformCommissionIdr,
            totalCustomerPaidIdr: totals.totalCustomerPaidIdr,
            netMerchantPayoutIdr: totals.netMerchantPayoutIdr,
            paymentMethod: payAtWarung ? "BAYAR_DI_WARUNG" : input.payment_method,
            paymentGatewayRef: payAtWarung ? null : newGatewayRef(),
            qrisDynamicString: payAtWarung
              ? null
              : buildDynamicQris({
                  merchantName: merchant.merchantName,
                  merchantCity: cityFromAddress(merchant.address),
                  merchantRef: merchant.id,
                  amountIdr: totals.totalCustomerPaidIdr,
                  reference: orderNumber,
                }),
            paymentExpiresAt,
            createdAt: now,
            updatedAt: now,
          });
        });
        break;
      } catch (err) {
        if (isUniqueViolation(err) && attempt + 1 < MAX_INSERT_ATTEMPTS) continue;
        throw err;
      }
    }

    await tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId,
        surplusBatchId: l.batch.id,
        menuId: l.menu.id,
        menuNameSnapshot: l.menu.menuName,
        quantity: l.line.quantity,
        unitOriginalPriceIdr: l.line.unitOriginalPriceIdr,
        unitSellingPriceIdr: l.line.unitSellingPriceIdr,
        discountPctApplied: l.batch.currentDiscountPct,
        portionWeightGrams: l.line.portionWeightGrams,
      })),
    );

    const [detail] = await loadOrderDetails(tx, [orderId], "customer");
    if (!detail) throw new ApiError("INTERNAL_ERROR", "Pesanan tidak dapat dimuat");
    return detail;
  });
}
