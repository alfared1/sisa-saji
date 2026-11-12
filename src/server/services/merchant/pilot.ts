/**
 * Field pilot: real warung join with the team's invite code (PILOT_INVITE_CODE).
 * Pilot warung are paid at the counter (see orders/checkout.ts) and only their
 * verified pickups feed the public pilot results (getPilotStats), never demo data.
 */
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, orderItems, orders } from "@/db/schema";
import type { MerchantMeResponse, PilotStats } from "@/lib/contracts";
import { getPilotInviteCode } from "@/lib/env";
import { ApiError } from "@/server/http";
import { getMerchantMe, loadMerchant } from "@/server/services/merchant/profile";

function sameCode(given: string, expected: string): boolean {
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(expected.trim().toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function joinPilot(db: Db, merchantId: string, code: string, now: Date = new Date()): Promise<MerchantMeResponse> {
  const expected = getPilotInviteCode();
  if (!expected) throw new ApiError("FORBIDDEN", "Uji coba belum dibuka.");
  const m = await loadMerchant(db, merchantId);
  if (!m.isPilot) {
    if (!sameCode(code, expected)) throw new ApiError("VALIDATION_ERROR", "Kode undangan uji coba tidak cocok.", [
      { path: "code", message: "Kode tidak cocok" },
    ]);
    await db.update(merchants).set({ isPilot: true, pilotJoinedAt: now, updatedAt: now }).where(eq(merchants.id, merchantId));
  }
  return getMerchantMe(db, merchantId);
}

/**
 * Completed orders at pilot warung placed after the warung joined the pilot (anything
 * older is demo history), minus orders an owner placed at their own warung.
 */
const realPilotOrder = and(
  eq(merchants.isPilot, true),
  eq(orders.status, "COMPLETED"),
  gte(orders.createdAt, merchants.pilotJoinedAt),
  ne(orders.customerId, merchants.ownerUserId),
);

export async function getPilotStats(db: Db): Promise<PilotStats> {
  const pilots = await db
    .select({ id: merchants.id, name: merchants.merchantName, slug: merchants.slug, joinedAt: merchants.pilotJoinedAt })
    .from(merchants)
    .where(eq(merchants.isPilot, true))
    .orderBy(asc(merchants.pilotJoinedAt));

  const perOrder = db
    .select({
      merchantId: orders.merchantId,
      customerId: orders.customerId,
      pickedUpAt: orders.pickedUpAt,
      food: orders.totalFoodSavedGrams,
      co2: orders.totalCo2AvoidedGrams,
      saved: sql<number>`${orders.subtotalOriginalIdr} - ${orders.subtotalRecoveryIdr} + ${orders.voucherDiscountIdr}`.as("saved"),
      revenue: orders.subtotalRecoveryIdr,
      portions: sql<number>`(SELECT COALESCE(SUM(${orderItems.quantity}), 0) FROM ${orderItems} WHERE ${orderItems.orderId} = ${orders.id})`.as(
        "portions",
      ),
    })
    .from(orders)
    .innerJoin(merchants, eq(merchants.id, orders.merchantId))
    .where(realPilotOrder)
    .as("po");

  const [t] = await db
    .select({
      orders: sql<number>`COUNT(*)::int`,
      portions: sql<number>`COALESCE(SUM(${perOrder.portions}), 0)::int`,
      food: sql<number>`COALESCE(SUM(${perOrder.food}), 0)::bigint`,
      co2: sql<number>`COALESCE(SUM(${perOrder.co2}), 0)::bigint`,
      saved: sql<number>`COALESCE(SUM(${perOrder.saved}), 0)::bigint`,
      revenue: sql<number>`COALESCE(SUM(${perOrder.revenue}), 0)::bigint`,
      buyers: sql<number>`COUNT(DISTINCT ${perOrder.customerId})::int`,
    })
    .from(perOrder);

  const byWarung = await db
    .select({
      merchantId: perOrder.merchantId,
      orders: sql<number>`COUNT(*)::int`,
      portions: sql<number>`COALESCE(SUM(${perOrder.portions}), 0)::int`,
      food: sql<number>`COALESCE(SUM(${perOrder.food}), 0)::bigint`,
    })
    .from(perOrder)
    .groupBy(perOrder.merchantId);
  const stat = new Map(byWarung.map((r) => [r.merchantId, r]));

  const day = sql<string>`to_char(${perOrder.pickedUpAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;
  const daily = await db
    .select({
      date: day,
      portions: sql<number>`COALESCE(SUM(${perOrder.portions}), 0)::int`,
      food: sql<number>`COALESCE(SUM(${perOrder.food}), 0)::bigint`,
    })
    .from(perOrder)
    .groupBy(day)
    .orderBy(day);

  return {
    started_at: pilots.find((p) => p.joinedAt)?.joinedAt?.toISOString() ?? null,
    warung_count: pilots.length,
    orders_completed: t?.orders ?? 0,
    portions_rescued: t?.portions ?? 0,
    food_saved_grams: Number(t?.food ?? 0),
    co2_avoided_grams: Number(t?.co2 ?? 0),
    money_saved_idr: Number(t?.saved ?? 0),
    warung_revenue_idr: Number(t?.revenue ?? 0),
    unique_buyers: t?.buyers ?? 0,
    warung: pilots.map((p) => {
      const s = stat.get(p.id);
      return {
        name: p.name,
        slug: p.slug,
        joined_at: (p.joinedAt ?? new Date(0)).toISOString(),
        orders_completed: s?.orders ?? 0,
        portions_rescued: s?.portions ?? 0,
        food_saved_grams: Number(s?.food ?? 0),
      };
    }),
    daily: daily.map((d) => ({ date: d.date, portions_rescued: d.portions, food_saved_grams: Number(d.food) })),
  };
}
