/**
 * Merchant-side pickup: look up a ticket by 4-digit code ("1234" / "SJ-1234") or
 * QR token, then verify it — READY_FOR_PICKUP → COMPLETED, crediting impact,
 * customer totals and the merchant wallet exactly once (row lock + status guard).
 */
import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, orderItems, orders, users } from "@/db/schema";
import { BADGE_TIERS, PICKUP_CODE_LENGTH } from "@/lib/constants";
import type { OrderDetail } from "@/lib/contracts";
import { badgeTierForFoodSaved, co2GramsFromFoodGrams } from "@/lib/impact";
import { verifyPickupToken } from "@/lib/pickup-token";
import { ApiError } from "@/server/http";
import { loadOrderDetails } from "@/server/mappers/order";

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

function invalid(): never {
  throw new ApiError("INVALID_PICKUP_CODE", "Kode pengambilan tidak valid atau tidak ditemukan");
}

export async function lookupPickup(
  db: Db,
  args: { merchantId: string; input: string; pickupQrSecret: string },
): Promise<OrderDetail> {
  const parsed = parsePickupInput(args.input);
  let orderId: string;
  if (parsed.kind === "code") {
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
    if (!o) invalid();
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

    const [done] = await tx
      .update(orders)
      .set({
        status: "COMPLETED",
        pickedUpAt: now,
        pickupProofImageUrl: args.proofImageUrl ?? null,
        totalFoodSavedGrams: foodGrams,
        totalCo2AvoidedGrams: co2Grams,
        updatedAt: now,
      })
      .where(and(eq(orders.id, o.id), inArray(orders.status, [...PICKABLE])))
      .returning({ id: orders.id });
    if (!done) throw new ApiError("ORDER_STATE_CONFLICT", "Status pesanan sudah berubah");

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

    await tx
      .update(merchants)
      .set({ walletBalanceIdr: sql`${merchants.walletBalanceIdr} + ${o.netMerchantPayoutIdr}`, updatedAt: now })
      .where(eq(merchants.id, o.merchantId));
  });

  const [detail] = await loadOrderDetails(db, [args.orderId], "merchant");
  return detail;
}
