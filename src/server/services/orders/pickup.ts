/**
 * Merchant-side pickup: look up a ticket by 4-digit code ("1234" / "SJ-1234") or
 * QR token, then verify it — READY_FOR_PICKUP → COMPLETED, crediting impact,
 * customer totals and the merchant wallet exactly once (row lock + status guard).
 */
import "server-only";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, orderItems, orders, pickupCodeFailures, users } from "@/db/schema";
import { BADGE_TIERS, PICKUP_CODE_LENGTH } from "@/lib/constants";
import type { OrderDetail } from "@/lib/contracts";
import { badgeTierForFoodSaved, co2GramsFromFoodGrams } from "@/lib/impact";
import { verifyPickupToken } from "@/lib/pickup-token";
import { ApiError } from "@/server/http";
import { loadOrderDetails } from "@/server/mappers/order";
import { abandonPayAtWarungOrder, commitReservation } from "@/server/services/stock";

export const PICKUP_GRACE_MINUTES = 30;
const PICKABLE = ["PAID", "READY_FOR_PICKUP"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = new RegExp(`^(?:SJ-?)?(\\d{${PICKUP_CODE_LENGTH}})$`, "i");

export type PickupInput = { kind: "code"; code: string } | { kind: "token"; token: string; orderId: string | null };

export function parsePickupInput(raw: string): PickupInput {
  const v = raw.trim();
  const m = CODE_RE.exec(v.replace(/\s+/g, ""));
  if (m) return { kind: "code", code: m[1] };
  const dot = v.lastIndexOf(".");
  const orderId = dot > 0 ? v.slice(0, dot) : "";
  return { kind: "token", token: v, orderId: UUID_RE.test(orderId) ? orderId : null };
}

/** Wrong typed codes per warung within the window before code entry is locked. */
export const PICKUP_CODE_MAX_FAILURES = 10;
export const PICKUP_CODE_LOCK_WINDOW_MINUTES = 10;

/**
 * Typed 4-digit codes have only 10.000 values, so a warung must not be able to sweep
 * them (it would find and complete tickets without the customer). QR tokens are
 * HMAC-signed and are not limited.
 */
async function assertCodeEntryAllowed(db: Db, merchantId: string, now: Date) {
  const since = new Date(now.getTime() - PICKUP_CODE_LOCK_WINDOW_MINUTES * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pickupCodeFailures)
    .where(and(eq(pickupCodeFailures.merchantId, merchantId), gt(pickupCodeFailures.createdAt, since)));
  if ((row?.n ?? 0) >= PICKUP_CODE_MAX_FAILURES) {
    console.warn(`[pickup] code entry locked for merchant ${merchantId}: ${row?.n} wrong codes`);
    throw new ApiError(
      "RATE_LIMITED",
      "Terlalu banyak kode salah. Coba lagi dalam beberapa menit atau pindai QR pembeli.",
      { retry_after_minutes: PICKUP_CODE_LOCK_WINDOW_MINUTES },
    );
  }
}

async function recordCodeFailure(db: Db, merchantId: string, now: Date) {
  await db.insert(pickupCodeFailures).values({ merchantId, createdAt: now });
}

function invalid(): never {
  throw new ApiError("INVALID_PICKUP_CODE", "Kode pengambilan tidak valid atau tidak ditemukan");
}

export async function lookupPickup(
  db: Db,
  args: { merchantId: string; input: string; pickupQrSecret: string; now?: Date },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const parsed = parsePickupInput(args.input);
  let orderId: string;
  if (parsed.kind === "code") {
    await assertCodeEntryAllowed(db, args.merchantId, now);
    const [o] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, args.merchantId),
          eq(orders.pickupCode, parsed.code),
          inArray(orders.status, [...PICKABLE]),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    if (!o) {
      await recordCodeFailure(db, args.merchantId, now);
      invalid();
    }
    orderId = o.id;
  } else {
    if (!parsed.orderId) invalid();
    const [o] = await db.select().from(orders).where(eq(orders.id, parsed.orderId)).limit(1);
    if (!o || o.merchantId !== args.merchantId) invalid();
    if (verifyPickupToken(parsed.token, o.pickupCode, args.pickupQrSecret) !== o.id) invalid();
    if (o.status === "COMPLETED") throw new ApiError("ORDER_STATE_CONFLICT", "Pesanan ini sudah diambil");
    if (!(PICKABLE as readonly string[]).includes(o.status)) invalid();
    orderId = o.id;
  }
  const [detail] = await loadOrderDetails(db, [orderId], "merchant");
  return detail;
}

export async function verifyPickup(
  db: Db,
  args: {
    merchantId: string;
    orderId: string;
    input: string;
    proofImageUrl?: string;
    pickupQrSecret: string;
    now?: Date;
  },
): Promise<OrderDetail> {
  const now = args.now ?? new Date();
  const isCode = parsePickupInput(args.input).kind === "code";
  if (isCode) await assertCodeEntryAllowed(db, args.merchantId, now);

  try {
    await completePickup(db, args, now);
  } catch (err) {
    // Recorded outside the (rolled back) transaction.
    if (isCode && err instanceof ApiError && err.code === "INVALID_PICKUP_CODE") {
      await recordCodeFailure(db, args.merchantId, now);
    }
    throw err;
  }

  const [detail] = await loadOrderDetails(db, [args.orderId], "merchant");
  return detail;
}

async function completePickup(
  db: Db,
  args: { merchantId: string; orderId: string; input: string; proofImageUrl?: string; pickupQrSecret: string },
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, args.orderId)).for("update").limit(1);
    if (!o || o.merchantId !== args.merchantId) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
    if (!(PICKABLE as readonly string[]).includes(o.status)) {
      throw new ApiError(
        "ORDER_STATE_CONFLICT",
        o.status === "COMPLETED" ? "Pesanan ini sudah diambil" : "Pesanan belum dibayar atau sudah dibatalkan",
      );
    }

    const parsed = parsePickupInput(args.input);
    const matches =
      parsed.kind === "code"
        ? parsed.code === o.pickupCode
        : verifyPickupToken(parsed.token, o.pickupCode, args.pickupQrSecret) === o.id;
    if (!matches) throw new ApiError("INVALID_PICKUP_CODE", "Kode pengambilan tidak cocok dengan pesanan ini");

    if (now.getTime() > o.pickupDeadlineAt.getTime() + PICKUP_GRACE_MINUTES * 60_000) {
      throw new ApiError("PICKUP_WINDOW_CLOSED", "Batas waktu pengambilan sudah lewat");
    }

    const items = await tx
      .select({ quantity: orderItems.quantity, grams: orderItems.portionWeightGrams })
      .from(orderItems)
      .where(eq(orderItems.orderId, o.id));
    const foodGrams = items.reduce((s, i) => s + i.quantity * i.grams, 0);
    const co2Grams = co2GramsFromFoodGrams(foodGrams);
    const moneySaved = o.subtotalOriginalIdr - o.subtotalRecoveryIdr + o.voucherDiscountIdr;
    const points = Math.floor(o.totalCustomerPaidIdr / 1000);
    // Pilot "bayar di warung": the customer pays the warung at this moment.
    const payAtWarung = o.paymentMethod === "BAYAR_DI_WARUNG" && !o.paidAt;

    const [done] = await tx
      .update(orders)
      .set({
        status: "COMPLETED",
        pickedUpAt: now,
        ...(payAtWarung ? { paidAt: now } : {}),
        pickupProofImageUrl: args.proofImageUrl ?? null,
        totalFoodSavedGrams: foodGrams,
        totalCo2AvoidedGrams: co2Grams,
        updatedAt: now,
      })
      .where(and(eq(orders.id, o.id), inArray(orders.status, [...PICKABLE])))
      .returning({ id: orders.id });
    if (!done) throw new ApiError("ORDER_STATE_CONFLICT", "Status pesanan sudah berubah");
    // Pay-at-warung portions stayed reserved until now: they are sold at the counter.
    if (payAtWarung) await commitReservation(tx, o.id, now);

    const [u] = await tx
      .update(users)
      .set({
        totalFoodSavedGrams: sql`${users.totalFoodSavedGrams} + ${foodGrams}`,
        totalCo2AvoidedGrams: sql`${users.totalCo2AvoidedGrams} + ${co2Grams}`,
        totalMoneySavedIdr: sql`${users.totalMoneySavedIdr} + ${moneySaved}`,
        loyaltyPoints: sql`${users.loyaltyPoints} + ${points}`,
        updatedAt: now,
      })
      .where(eq(users.id, o.customerId))
      .returning({ food: users.totalFoodSavedGrams, badge: users.badgeTier });
    if (u) {
      const badge = badgeTierForFoodSaved(u.food);
      const rank = (t: string) => BADGE_TIERS.findIndex((b) => b.tier === t);
      // Badges only go up (never downgrade a tier granted elsewhere).
      if (rank(badge) > rank(u.badge)) await tx.update(users).set({ badgeTier: badge }).where(eq(users.id, o.customerId));
    }

    // The warung already holds the cash for a pay-at-warung order; only online payments are paid out.
    if (!payAtWarung) {
      await tx
        .update(merchants)
        .set({ walletBalanceIdr: sql`${merchants.walletBalanceIdr} + ${o.netMerchantPayoutIdr}`, updatedAt: now })
        .where(eq(merchants.id, o.merchantId));
    }
  });
}

export const UNCLAIMED_ORDER_REASON = "Tidak diambil sebelum batas waktu";

/**
 * Job: paid orders nobody collected by pickup_deadline_at + PICKUP_GRACE_MINUTES
 * become EXPIRED ("Tidak diambil sebelum batas waktu"). That frees their 4-digit
 * code and drops them from the pending-pickup queues.
 *
 * Money policy (no-show): the portions were sold and set aside, and self-pickup is
 * the customer's duty, so the warung is still credited net_merchant_payout_idr
 * (exactly once, in the same transaction as the status change). The customer gets
 * no impact / points credit — the food was not rescued by them. Stock stays sold.
 *
 * Pilot "bayar di warung" tickets were never paid: they expire without a payout and
 * their reserved portions go back to the batch (abandonPayAtWarungOrder).
 */
export async function closeUnclaimedOrders(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - PICKUP_GRACE_MINUTES * 60_000);
  const stale = await db
    .select({ id: orders.id, paymentMethod: orders.paymentMethod, paidAt: orders.paidAt })
    .from(orders)
    .where(and(inArray(orders.status, [...PICKABLE]), sql`${orders.pickupDeadlineAt} < ${cutoff}`))
    .orderBy(orders.pickupDeadlineAt)
    .limit(500);
  let closed = 0;
  for (const { id, paymentMethod, paidAt } of stale) {
    if (paymentMethod === "BAYAR_DI_WARUNG" && !paidAt) {
      const done = await db.transaction((tx) => abandonPayAtWarungOrder(tx, id, "EXPIRED", UNCLAIMED_ORDER_REASON, now));
      if (done) closed++;
      continue;
    }
    const done = await db.transaction(async (tx) => {
      const [o] = await tx
        .update(orders)
        .set({ status: "EXPIRED", cancelReason: UNCLAIMED_ORDER_REASON, updatedAt: now })
        .where(and(eq(orders.id, id), inArray(orders.status, [...PICKABLE])))
        .returning({ merchantId: orders.merchantId, payout: orders.netMerchantPayoutIdr });
      if (!o) return false;
      await tx
        .update(merchants)
        .set({ walletBalanceIdr: sql`${merchants.walletBalanceIdr} + ${o.payout}`, updatedAt: now })
        .where(eq(merchants.id, o.merchantId));
      return true;
    });
    if (done) closed++;
  }
  return closed;
}
