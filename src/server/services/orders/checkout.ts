/**
 * Checkout: one transaction:
 *   reserve stock (stock.reserveItems, row-level conditional UPDATE)
 *   → check each line's lauk against the batch's lauk_available (snapshot in order_items)
 *   → price lines from each batch's current price (snapshotted in order_items)
 *   → computeOrderTotals → order number / pickup code / QR token
 *   → simulated dynamic QRIS → PENDING_PAYMENT order.
 *
 * "Bayar di warung" (payment_method BAYAR_DI_WARUNG, any warung; pilot warung are forced to
 * it): the customer pays the warung directly at pickup. The order is a ticket right away
 * (READY_FOR_PICKUP, no QRIS, no service fee, no voucher) and its portions stay reserved until
 * the warung verifies the pickup (see pickup.ts), the buyer or the warung cancels it, or its
 * short hold ends (PAY_AT_WARUNG_HOLD_MINUTES, see hold.ts). Because the hold is free, every
 * ticket is capped at PAY_AT_WARUNG_MAX_PORTIONS; repeated no-shows block new tickets at pilot
 * warung (the only warung where a no-show costs a real cook).
 *
 * Lauk: one batch may appear on several lines with a different lauk each. Lauk have no stock
 * of their own; the batch portion is the reserved unit, so per-batch limits sum the lines.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, like, ne, not, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { menus, merchants, orderItems, orders, surplusBatches, users } from "@/db/schema";
import {
  DEMO_VOUCHERS,
  MERCHANT_TICKET_CANCEL_REASONS,
  PAY_AT_WARUNG_EXPIRED_REASON,
  PAY_AT_WARUNG_MAX_PORTIONS,
  PAY_AT_WARUNG_NO_SHOW_LIMIT,
  PAY_AT_WARUNG_NO_SHOW_WINDOW_DAYS,
  PAYMENT_TTL_SECONDS,
} from "@/lib/constants";
import type { CheckoutBody, OrderDetail } from "@/lib/contracts";
import { isDemoAccount } from "@/lib/demo-accounts";
import { findItem, lineKey } from "@/lib/lauk";
import { createPickupToken, generatePickupCode } from "@/lib/pickup-token";
import { computeOrderTotals, serviceFeeFor, type OrderLineInput } from "@/lib/pricing/order-totals";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { loadOrderDetails } from "@/server/mappers/order";
import { buildDynamicQris, cityFromAddress } from "@/server/services/payment/qris";
import { newGatewayRef } from "@/server/services/payment/webhook";
import { abandonPayAtWarungOrder, abandonPendingOrder, reserveItems, type Tx } from "@/server/services/stock";
import { expireLapsedHolds, isHoldOver, OPEN_PAY_AT_WARUNG, payAtWarungHoldEnd } from "./hold";

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

/** Unpaid checkouts (PENDING_PAYMENT, or open "bayar di warung" tickets) a customer may hold at once, across warung. */
export const MAX_PENDING_ORDERS_PER_USER = 2;
/** Cancelled/expired checkouts within the window before new checkouts are refused. */
export const MAX_ABANDONED_ORDERS_IN_WINDOW = 3;
export const ABANDONED_ORDERS_WINDOW_MINUTES = 30;
/** Portions of one batch a customer may hold across their active orders. */
export function maxPortionsPerCustomer(initialStock: number): number {
  return Math.max(3, Math.ceil(initialStock / 2));
}

/**
 * Identity of an order line for the double-tap check: the batch plus the lauk ignoring case
 * (the request may differ in casing from the stored snapshot).
 */
const matchKey = (batchId: string, lauk: string | null): string =>
  lineKey(batchId, lauk === null ? null : lauk.toLocaleLowerCase("id-ID"));

const sameItems = (a: Map<string, number>, b: Map<string, number>) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/** A lapsed cash ticket: expired at its hold end or marked "Tidak datang" by the warung. */
const LAPSED_CASH_TICKET = sql`(${orders.paymentMethod} = 'BAYAR_DI_WARUNG' AND (${orders.status} = 'EXPIRED' OR ${orders.cancelReason} IS NOT DISTINCT FROM ${MERCHANT_TICKET_CANCEL_REASONS.NO_SHOW.reason}))`;

type FairUseArgs = {
  userId: string;
  merchantId: string;
  isPilot: boolean;
  /** Requested portions per batch (summed over lauk lines). */
  perBatch: Map<string, number>;
  /** Requested portions per matchKey line. */
  perLine: Map<string, number>;
  now: Date;
  cash: boolean;
  /**
   * The shared demo buyer account. Many visitors use it at once, so its open cash tickets and
   * lapsed cash tickets must not lock other visitors out: they are left out of the pending
   * and churn limits (the demo account can never order at a pilot warung). The per-batch cap
   * still counts its open tickets, so one session cannot hold a whole batch.
   */
  demoBuyer: boolean;
};

/**
 * Enforces the fair-use limits inside the checkout transaction (the users row lock
 * serialises concurrent checkouts of one customer). Returns the id of an existing
 * identical unpaid order at the same warung (idempotent retry / double tap), or null.
 */
async function enforceFairUse(tx: Tx, args: FairUseArgs): Promise<string | null> {
  const { userId, merchantId, perBatch, perLine, now, cash, demoBuyer } = args;
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");

  const pendingRows = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      merchantId: orders.merchantId,
      paymentExpiresAt: orders.paymentExpiresAt,
      pickupDeadlineAt: orders.pickupDeadlineAt,
      status: orders.status,
    })
    .from(orders)
    .where(and(eq(orders.customerId, userId), or(eq(orders.status, "PENDING_PAYMENT"), OPEN_PAY_AT_WARUNG)))
    .orderBy(orders.createdAt);
  const pending: typeof pendingRows = [];
  /** The demo buyer's open cash tickets: never counted, only matched for a double tap. */
  const uncounted: typeof pendingRows = [];
  for (const o of pendingRows) {
    // Lazily expire stale unpaid checkouts and lapsed tickets the worker has not reached yet.
    if (o.status === "PENDING_PAYMENT" && o.paymentExpiresAt && o.paymentExpiresAt <= now) {
      await abandonPendingOrder(tx, o.id, "EXPIRED", "Pembayaran tidak diselesaikan dalam 10 menit", now);
    } else if (o.status === "READY_FOR_PICKUP" && isHoldOver(o.pickupDeadlineAt, now)) {
      await abandonPayAtWarungOrder(tx, o.id, "EXPIRED", PAY_AT_WARUNG_EXPIRED_REASON, now);
    } else if (demoBuyer && o.status === "READY_FOR_PICKUP") uncounted.push(o);
    else pending.push(o);
  }

  const sameWarung = [...pending, ...uncounted].filter((o) => o.merchantId === merchantId);
  if (sameWarung.length > 0) {
    const lines = await tx
      .select({
        orderId: orderItems.orderId,
        batchId: orderItems.surplusBatchId,
        lauk: orderItems.laukChoice,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, sameWarung.map((o) => o.id)));
    for (const o of sameWarung) {
      const existing = new Map<string, number>();
      for (const l of lines) {
        if (l.orderId !== o.id) continue;
        const k = matchKey(l.batchId, l.lauk);
        existing.set(k, (existing.get(k) ?? 0) + l.quantity);
      }
      if (sameItems(existing, perLine)) return o.id;
    }
  }
  const atSameWarung = pending.find((o) => o.merchantId === merchantId);
  if (atSameWarung) {
    throw new ApiError(
      "CONFLICT",
      atSameWarung.status === "PENDING_PAYMENT"
        ? `Kamu masih punya pesanan belum dibayar di warung ini (${atSameWarung.orderNumber}). Bayar atau batalkan dulu.`
        : `Kamu masih punya pesanan yang belum diambil di warung ini (${atSameWarung.orderNumber}). Ambil atau batalkan dulu.`,
      { order_id: atSameWarung.id, order_number: atSameWarung.orderNumber },
    );
  }
  if (pending.length >= MAX_PENDING_ORDERS_PER_USER) {
    throw new ApiError(
      "CONFLICT",
      `Kamu sudah punya ${pending.length} pesanan yang belum dibayar atau belum diambil. Selesaikan atau batalkan dulu salah satunya.`,
      { pending_order_ids: pending.map((o) => o.id) },
    );
  }

  if (cash) await enforcePayAtWarungLimits(tx, { userId, perBatch, now, isPilot: args.isPilot });

  const windowStart = new Date(now.getTime() - ABANDONED_ORDERS_WINDOW_MINUTES * 60_000);
  const [abandoned] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, userId),
        inArray(orders.status, ["CANCELLED", "EXPIRED"]),
        gt(orders.updatedAt, windowStart),
        // A ticket the warung cancelled because the food ran out is not the buyer's doing.
        or(isNull(orders.cancelReason), ne(orders.cancelReason, MERCHANT_TICKET_CANCEL_REASONS.OUT_OF_STOCK.reason)),
        demoBuyer ? not(LAPSED_CASH_TICKET) : undefined,
      ),
    );
  if ((abandoned?.n ?? 0) >= MAX_ABANDONED_ORDERS_IN_WINDOW) {
    throw new ApiError("RATE_LIMITED", "Terlalu banyak pesanan dibatalkan atau tidak dibayar. Coba lagi nanti.", {
      retry_after_minutes: ABANDONED_ORDERS_WINDOW_MINUTES,
    });
  }

  const batchIds = [...perBatch.keys()];
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
    if (already + (perBatch.get(b.id) ?? 0) > cap) {
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

/**
 * "Bayar di warung" holds cost the buyer nothing, so on top of the general limits: at most
 * PAY_AT_WARUNG_MAX_PORTIONS portions per ticket at any warung (one open ticket per warung,
 * see above, so this is also the cap per buyer per warung). At pilot warung only, no new
 * ticket after PAY_AT_WARUNG_NO_SHOW_LIMIT no-shows at pilot warung within
 * PAY_AT_WARUNG_NO_SHOW_WINDOW_DAYS: lapses at demo warung cost nobody food.
 */
async function enforcePayAtWarungLimits(
  tx: Tx,
  args: { userId: string; perBatch: Map<string, number>; now: Date; isPilot: boolean },
) {
  const portions = [...args.perBatch.values()].reduce((s, q) => s + q, 0);
  if (portions > PAY_AT_WARUNG_MAX_PORTIONS) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Satu tiket bayar di warung paling banyak ${PAY_AT_WARUNG_MAX_PORTIONS} porsi. Kurangi jumlahnya, ya.`,
      // With one menu the client can set its quantity to the cap directly (perBuyerCaps).
      [
        {
          path: "items",
          message: `Maksimal ${PAY_AT_WARUNG_MAX_PORTIONS} porsi per tiket`,
          ...(args.perBatch.size === 1 ? { batch_id: [...args.perBatch.keys()][0] } : {}),
          max_quantity: PAY_AT_WARUNG_MAX_PORTIONS,
        },
      ],
    );
  }
  if (!args.isPilot) return;
  const since = new Date(args.now.getTime() - PAY_AT_WARUNG_NO_SHOW_WINDOW_DAYS * 24 * 60 * 60_000);
  const [noShows] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .innerJoin(merchants, eq(merchants.id, orders.merchantId))
    .where(
      and(
        eq(orders.customerId, args.userId),
        eq(merchants.isPilot, true),
        eq(orders.paymentMethod, "BAYAR_DI_WARUNG"),
        gt(orders.updatedAt, since),
        or(
          and(eq(orders.status, "EXPIRED"), eq(orders.cancelReason, PAY_AT_WARUNG_EXPIRED_REASON)),
          and(eq(orders.status, "CANCELLED"), eq(orders.cancelReason, MERCHANT_TICKET_CANCEL_REASONS.NO_SHOW.reason)),
        ),
      ),
    );
  const n = noShows?.n ?? 0;
  if (n >= PAY_AT_WARUNG_NO_SHOW_LIMIT) {
    throw new ApiError(
      "RATE_LIMITED",
      `Kamu ${n} kali tidak mengambil tiket bayar di warung dalam ${PAY_AT_WARUNG_NO_SHOW_WINDOW_DAYS} hari terakhir, jadi untuk sementara belum bisa memesan di warung uji coba.`,
      { retry_after_days: PAY_AT_WARUNG_NO_SHOW_WINDOW_DAYS },
    );
  }
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
    // Pilot warung are paid at the counter only; elsewhere the buyer may choose cash.
    const cash = merchant.isPilot || input.payment_method === "BAYAR_DI_WARUNG";
    if (cash && voucher) {
      throw new ApiError(
        "VOUCHER_INVALID",
        merchant.isPilot
          ? "Voucher belum berlaku di warung uji coba. Pembayaran langsung ke warung."
          : "Voucher hanya untuk bayar lewat QRIS atau dompet digital.",
      );
    }
    const [buyer] = await tx
      .select({ email: users.email, phoneNumber: users.phoneNumber })
      .from(users)
      .where(eq(users.id, args.userId));
    const demoBuyer = buyer ? isDemoAccount(buyer) : false;
    if (merchant.isPilot && demoBuyer) {
      throw new ApiError(
        "FORBIDDEN",
        "Ini warung sungguhan yang ikut uji coba. Untuk memesan di sini, masuk dengan nomor HP atau emailmu sendiri.",
      );
    }

    const perBatch = new Map<string, number>();
    const perLine = new Map<string, number>();
    for (const it of input.items) {
      perBatch.set(it.batch_id, (perBatch.get(it.batch_id) ?? 0) + it.quantity);
      const k = matchKey(it.batch_id, it.lauk ?? null);
      perLine.set(k, (perLine.get(k) ?? 0) + it.quantity);
    }
    const existingId = await enforceFairUse(tx, {
      userId: args.userId,
      merchantId: merchant.id,
      isPilot: merchant.isPilot,
      perBatch,
      perLine,
      now,
      cash,
      demoBuyer,
    });
    if (existingId) {
      const [existing] = await loadOrderDetails(tx, [existingId], "customer");
      if (existing) return existing;
    }
    // Portions on other buyers' lapsed tickets go back on the shelf before reserving, so a
    // QRIS buyer is not refused for portions nobody will collect any more.
    await expireLapsedHolds(tx, { batchIds: [...perBatch.keys()] }, now);

    const reserved = await reserveItems(
      tx,
      merchant.id,
      [...perBatch].map(([batchId, quantity]) => ({ batchId, quantity })),
      now,
    );
    const batchById = new Map(reserved.map((b) => [b.id, b]));
    const menuRows = await tx
      .select()
      .from(menus)
      .where(inArray(menus.id, [...new Set(reserved.map((b) => b.menuId))]));
    const menuById = new Map(menuRows.map((m) => [m.id, m]));
    // Surprise menus are gone (migration 0009 left only already-ordered batches live), so a
    // cached cart or a direct call cannot buy them; throwing rolls the reservation back.
    if (menuRows.some((m) => m.isMysteryBag || m.category === "MYSTERY_BAG")) {
      throw new ApiError("BATCH_CLOSED", "Menu ini sudah tidak tersedia");
    }

    // One order line per (batch, lauk), the lauk in the batch's stored casing. Lauk are
    // checked after the reservation, so a refusal rolls the reservation back with the rest.
    const merged = new Map<string, { batchId: string; lauk: string | null; quantity: number }>();
    for (const it of input.items) {
      const batch = batchById.get(it.batch_id);
      if (!batch) throw new ApiError("NOT_FOUND", "Menu surplus tidak ditemukan");
      let lauk: string | null = null;
      if (it.lauk !== undefined) {
        lauk = findItem(batch.laukAvailable, it.lauk);
        if (lauk === null) {
          const offered = findItem(menuById.get(batch.menuId)?.laukOptions ?? [], it.lauk) !== null;
          throw new ApiError(
            "VALIDATION_ERROR",
            offered ? `Lauk ${it.lauk} sudah habis. Pilih lauk lain, ya.` : `Lauk ${it.lauk} tidak ada di menu ini.`,
            [
              {
                path: "items",
                message: offered ? "Lauk sudah habis" : "Lauk tidak ada di menu ini",
                batch_id: batch.id,
                lauk: it.lauk,
                lauk_available: batch.laukAvailable,
              },
            ],
          );
        }
      }
      const key = lineKey(batch.id, lauk);
      const line = merged.get(key);
      if (line) line.quantity += it.quantity;
      else merged.set(key, { batchId: batch.id, lauk, quantity: it.quantity });
    }

    const lines = [...merged.values()].map(({ batchId, lauk, quantity }) => {
      const batch = batchById.get(batchId);
      const menu = batch ? menuById.get(batch.menuId) : undefined;
      if (!batch || !menu) throw new ApiError("NOT_FOUND", "Menu tidak ditemukan");
      const line: OrderLineInput = {
        quantity,
        unitOriginalPriceIdr: batch.originalPriceIdr,
        unitSellingPriceIdr: batch.currentSellingPriceIdr,
        portionWeightGrams: menu.portionWeightGrams,
      };
      return { batch, menu, lauk, line };
    });

    const subtotalRecovery = lines.reduce((s, l) => s + l.line.quantity * l.line.unitSellingPriceIdr, 0);
    if (voucher && subtotalRecovery < voucher.min_subtotal_idr) {
      throw new ApiError(
        "VOUCHER_INVALID",
        `Voucher ${voucher.code} butuh minimal belanja Rp ${voucher.min_subtotal_idr.toLocaleString("id-ID")}`,
        { min_subtotal_idr: voucher.min_subtotal_idr },
      );
    }
    const paymentMethod = cash ? "BAYAR_DI_WARUNG" : input.payment_method;
    const totals = computeOrderTotals(
      lines.map((l) => l.line),
      // Cash: the warung collects the recovery price itself; the platform charges nothing.
      { voucherDiscountIdr: voucher?.discount_idr ?? 0, platformCommissionIdr: serviceFeeFor(paymentMethod) },
    );

    const pickupEnd = new Date(Math.min(...reserved.map((b) => b.pickupEndTime.getTime())));
    // Cash tickets have no online payment: their free hold is short and is also the ticket's
    // pickup deadline (hold.ts). Paid orders keep the batch's pickup end.
    const deadline = cash ? payAtWarungHoldEnd(now, pickupEnd) : pickupEnd;
    const paymentExpiresAt = cash
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
            status: cash ? "READY_FOR_PICKUP" : "PENDING_PAYMENT",
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
            paymentMethod,
            paymentGatewayRef: cash ? null : newGatewayRef(),
            qrisDynamicString: cash
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
        laukChoice: l.lauk,
      })),
    );

    const [detail] = await loadOrderDetails(tx, [orderId], "customer");
    if (!detail) throw new ApiError("INTERNAL_ERROR", "Pesanan tidak dapat dimuat");
    return detail;
  });
}
