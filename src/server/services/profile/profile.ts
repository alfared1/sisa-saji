/**
 * Customer profile: edit, presence ping, personal impact, favourites, global stats.
 */
import "server-only";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import {
  customerMerchantSubscriptions,
  merchants,
  merchantSurplusPredictions,
  orders,
  surplusBatches,
  users,
} from "@/db/schema";
import { BADGE_TIERS, DEFAULT_SEARCH_RADIUS_M } from "@/lib/constants";
import type {
  GlobalStats,
  ImpactSummary,
  LocationPushBody,
  MonthlyImpact,
  ProfileUpdateBody,
  SessionUser,
  SubscriptionItem,
} from "@/lib/contracts";
import { treeYearsFromCo2Grams } from "@/lib/impact";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { countActiveUsersNear, upsertPresence } from "@/server/services/presence";
import { savePushSubscription } from "@/server/services/push";
import { sessionUserView } from "@/server/services/auth/session-user";

type ProfileUpdateInput = z.output<typeof ProfileUpdateBody>;
type LocationPushInput = z.output<typeof LocationPushBody>;

export async function updateProfile(
  db: Db,
  userId: string,
  input: ProfileUpdateInput,
  now: Date = new Date(),
): Promise<SessionUser> {
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.full_name !== undefined) set.fullName = input.full_name;
  if (input.campus_or_area !== undefined) set.campusOrArea = input.campus_or_area || null;
  if (input.default_lat !== undefined) set.defaultLat = input.default_lat;
  if (input.default_lng !== undefined) set.defaultLng = input.default_lng;
  if (Object.keys(set).length > 0) {
    await db.update(users).set({ ...set, updatedAt: now }).where(eq(users.id, userId));
  }
  const user = await sessionUserView(db, userId);
  if (!user) throw new ApiError("UNAUTHENTICATED", "Silakan masuk terlebih dahulu");
  return user;
}

export async function recordLocationPush(
  db: Db,
  input: LocationPushInput & { userId: string | null },
  now: Date = new Date(),
): Promise<{ ok: true; active_users_in_radius: number }> {
  await upsertPresence(db, { clientId: input.client_id, userId: input.userId, lat: input.lat, lng: input.lng, now });
  if (input.webpush_subscription) {
    await savePushSubscription(db, {
      userId: input.userId,
      clientId: input.client_id,
      subscription: input.webpush_subscription,
    });
  }
  const active = await countActiveUsersNear(db, input.lat, input.lng, DEFAULT_SEARCH_RADIUS_M, now);
  return { ok: true, active_users_in_radius: active };
}

/** "YYYY-MM" keys of the last `n` WIB months, oldest first (includes the current month). */
export function lastWibMonths(now: Date, n: number): string[] {
  const [y, m] = wibDate(now).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export function nextBadge(foodGrams: number): ImpactSummary["next_badge"] {
  const next = BADGE_TIERS.find((b) => b.minFoodSavedGrams > foodGrams);
  if (!next) return null;
  return {
    tier: next.tier,
    min_food_saved_grams: next.minFoodSavedGrams,
    progress_pct: Math.max(0, Math.min(100, Math.floor((foodGrams / next.minFoodSavedGrams) * 100))),
  };
}

export async function getImpactSummary(db: Db, userId: string, now: Date = new Date()): Promise<ImpactSummary> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new ApiError("UNAUTHENTICATED", "Silakan masuk terlebih dahulu");

  const months = lastWibMonths(now, 6);
  const { rows } = await db.execute<{
    month: string;
    orders: number;
    food: number;
    co2: number;
    saved: number;
  }>(sql`
    SELECT to_char(COALESCE(picked_up_at, created_at) AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month,
           COUNT(*)::int AS orders,
           COALESCE(SUM(total_food_saved_grams), 0)::int AS food,
           COALESCE(SUM(total_co2_avoided_grams), 0)::int AS co2,
           COALESCE(SUM(subtotal_original_idr - subtotal_recovery_idr + voucher_discount_idr), 0)::bigint AS saved
    FROM orders
    WHERE customer_id = ${userId} AND status = 'COMPLETED'
    GROUP BY 1`);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const monthly: MonthlyImpact[] = months.map((month) => {
    const r = byMonth.get(month);
    return {
      month,
      orders: r ? Number(r.orders) : 0,
      food_saved_grams: r ? Number(r.food) : 0,
      co2_avoided_grams: r ? Number(r.co2) : 0,
      money_saved_idr: r ? Number(r.saved) : 0,
    };
  });
  const completed = rows.reduce((s, r) => s + Number(r.orders), 0);

  return {
    total_food_saved_grams: u.totalFoodSavedGrams,
    total_co2_avoided_grams: u.totalCo2AvoidedGrams,
    total_money_saved_idr: u.totalMoneySavedIdr,
    tree_equivalent: Math.round(treeYearsFromCo2Grams(u.totalCo2AvoidedGrams) * 100) / 100,
    completed_orders: completed,
    loyalty_points: u.loyaltyPoints,
    badge_tier: u.badgeTier,
    next_badge: nextBadge(u.totalFoodSavedGrams),
    monthly,
  };
}

export async function getGlobalStats(db: Db, now: Date = new Date()): Promise<Omit<GlobalStats, "is_demo_data">> {
  const [o] = await db
    .select({
      food: sql<number>`COALESCE(SUM(${orders.totalFoodSavedGrams}), 0)::bigint`,
      co2: sql<number>`COALESCE(SUM(${orders.totalCo2AvoidedGrams}), 0)::bigint`,
      n: count(),
    })
    .from(orders)
    .where(eq(orders.status, "COMPLETED"));
  const [m] = await db.select({ n: count() }).from(merchants).where(eq(merchants.isOpen, true));
  const [b] = await db
    .select({ n: count() })
    .from(surplusBatches)
    .innerJoin(merchants, eq(merchants.id, surplusBatches.merchantId))
    .where(
      and(
        eq(surplusBatches.status, "ACTIVE"),
        gt(surplusBatches.availableStock, 0),
        gt(surplusBatches.pickupEndTime, now),
        eq(merchants.isOpen, true),
      ),
    );
  return {
    total_food_saved_grams: Number(o.food),
    total_co2_avoided_grams: Number(o.co2),
    total_orders_completed: o.n,
    active_merchants: m.n,
    live_batches: b.n,
  };
}

export async function listSubscriptions(db: Db, userId: string, now: Date = new Date()): Promise<SubscriptionItem[]> {
  const today = wibDate(now);
  const rows = await db
    .select({
      merchantId: merchants.id,
      slug: merchants.slug,
      name: merchants.merchantName,
      notifyLive: customerMerchantSubscriptions.notifyOnSurplusLive,
      notifyAi: customerMerchantSubscriptions.notifyOnAiPrediction,
      predicted: merchantSurplusPredictions.predictedSurplusPortions,
      live: sql<boolean>`EXISTS (
        SELECT 1 FROM ${surplusBatches}
        WHERE ${surplusBatches.merchantId} = ${merchants.id}
          AND ${surplusBatches.status} = 'ACTIVE'
          AND ${surplusBatches.availableStock} > 0
          AND ${surplusBatches.pickupEndTime} > ${now})`,
    })
    .from(customerMerchantSubscriptions)
    .innerJoin(merchants, eq(merchants.id, customerMerchantSubscriptions.merchantId))
    .leftJoin(
      merchantSurplusPredictions,
      and(
        eq(merchantSurplusPredictions.merchantId, merchants.id),
        isNull(merchantSurplusPredictions.menuId),
        eq(merchantSurplusPredictions.targetDate, today),
      ),
    )
    .where(eq(customerMerchantSubscriptions.userId, userId))
    .orderBy(customerMerchantSubscriptions.createdAt);

  return rows.map((r) => ({
    merchant_id: r.merchantId,
    merchant_slug: r.slug,
    merchant_name: r.name,
    notify_on_surplus_live: r.notifyLive,
    notify_on_ai_prediction: r.notifyAi,
    predicted_surplus_portions: r.predicted === null ? null : Math.round(Number(r.predicted)),
    has_live_batches: Boolean(r.live),
  }));
}
