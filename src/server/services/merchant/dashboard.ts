/** Merchant command center (dashboard) and order list. */
import "server-only";
import { and, asc, desc, eq, gt, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { menus, orderItems, orders, surplusBatches } from "@/db/schema";
import type { MerchantDashboard, MerchantOrdersQuery, OrderDetail, OrderStatus, TonightPrediction } from "@/lib/contracts";
import { atWib, DAY_MS, wibDate } from "@/lib/time";
import { loadOrderDetails } from "@/server/mappers/order";
import { getMenuPredictions, getPrediction } from "@/server/services/prediction";
import { loadMerchant } from "./profile";
import { batchViews } from "./surplus";
import { toMerchantProfile } from "./views";

export type MerchantOrdersInput = z.output<typeof MerchantOrdersQuery>;

const ACTIVE_ORDER_STATES: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "READY_FOR_PICKUP"];
const PAID_STATES: OrderStatus[] = ["PAID", "READY_FOR_PICKUP", "COMPLETED"];
const PENDING_PICKUP_STATES: OrderStatus[] = ["PAID", "READY_FOR_PICKUP"];

/** UTC bounds of a WIB calendar date. */
export function wibDayBounds(date: string): { from: Date; to: Date } {
  const from = atWib(date, "00:00");
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

export async function tonightPrediction(db: Db, merchantId: string, date: string): Promise<TonightPrediction | null> {
  const activeMenus = await db
    .select({ id: menus.id, name: menus.menuName })
    .from(menus)
    .where(and(eq(menus.merchantId, merchantId), eq(menus.isActive, true)));
  if (!activeMenus.length) return null;
  const [overall, perMenu] = await Promise.all([
    getPrediction(db, merchantId, null, date),
    getMenuPredictions(
      db,
      merchantId,
      activeMenus.map((m) => m.id),
      date,
    ),
  ]);
  return {
    target_date: date,
    predicted_surplus_portions: overall.predictedSurplusPortions,
    sellout_probability_at_50pct: overall.selloutProbabilityAt50pct,
    confidence_score: overall.confidenceScore,
    peak_hour: overall.peakHour,
    model_version: overall.modelVersion,
    rain_forecast_mm: overall.rainForecastMm,
    per_menu: activeMenus
      .map((m) => ({
        menu_id: m.id,
        menu_name: m.name,
        predicted_surplus_portions: perMenu.get(m.id)?.predictedSurplusPortions ?? 0,
      }))
      .sort((a, b) => b.predicted_surplus_portions - a.predicted_surplus_portions),
  };
}

export async function getMerchantDashboard(db: Db, merchantId: string, now: Date = new Date()): Promise<MerchantDashboard> {
  const merchant = await loadMerchant(db, merchantId);
  const today = wibDate(now);
  const { from, to } = wibDayBounds(today);

  const [paidToday] = await db
    .select({
      revenue: sql<number>`COALESCE(SUM(${orders.netMerchantPayoutIdr}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.merchantId, merchantId),
        inArray(orders.status, PAID_STATES),
        gte(orders.paidAt, from),
        lt(orders.paidAt, to),
      ),
    );
  const [portions] = await db
    .select({ n: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orders.merchantId, merchantId),
        inArray(orders.status, PAID_STATES),
        gte(orders.paidAt, from),
        lt(orders.paidAt, to),
      ),
    );
  const [completed] = await db
    .select({
      n: sql<number>`COUNT(*)::int`,
      food: sql<number>`COALESCE(SUM(${orders.totalFoodSavedGrams}), 0)::int`,
      co2: sql<number>`COALESCE(SUM(${orders.totalCo2AvoidedGrams}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.merchantId, merchantId),
        eq(orders.status, "COMPLETED"),
        gte(orders.pickedUpAt, from),
        lt(orders.pickedUpAt, to),
      ),
    );

  const pendingIds = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.merchantId, merchantId), inArray(orders.status, PENDING_PICKUP_STATES)))
    .orderBy(asc(orders.pickupDeadlineAt))
    .limit(50);

  const liveBatches = await db
    .select()
    .from(surplusBatches)
    .where(
      and(
        eq(surplusBatches.merchantId, merchantId),
        inArray(surplusBatches.status, ["ACTIVE", "SCHEDULED", "SOLD_OUT"]),
        gt(surplusBatches.pickupEndTime, now),
      ),
    )
    .orderBy(asc(surplusBatches.pickupEndTime));

  const [activeBatches, pendingPickups, aiPrediction] = await Promise.all([
    batchViews(db, merchant, liveBatches, now),
    loadOrderDetails(
      db,
      pendingIds.map((r) => r.id),
      "merchant",
    ),
    tonightPrediction(db, merchantId, today),
  ]);

  return {
    merchant: toMerchantProfile(merchant),
    today: {
      revenue_idr: paidToday.revenue,
      orders_completed: completed.n,
      orders_pending_pickup: pendingIds.length,
      portions_sold: portions.n,
      food_saved_grams: completed.food,
      co2_avoided_grams: completed.co2,
    },
    active_batches: activeBatches,
    pending_pickups: pendingPickups,
    ai_prediction: aiPrediction,
  };
}

export async function listMerchantOrders(
  db: Db,
  merchantId: string,
  query: MerchantOrdersInput,
): Promise<{ orders: OrderDetail[] }> {
  const conds: SQL[] = [eq(orders.merchantId, merchantId)];
  if (query.status === "ACTIVE") conds.push(inArray(orders.status, ACTIVE_ORDER_STATES));
  else if (query.status) conds.push(eq(orders.status, query.status));
  if (query.date) {
    const { from, to } = wibDayBounds(query.date);
    conds.push(gte(orders.createdAt, from), lt(orders.createdAt, to));
  }
  const ids = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(...conds))
    .orderBy(desc(orders.createdAt))
    .limit(query.limit);
  return {
    orders: await loadOrderDetails(
      db,
      ids.map((r) => r.id),
      "merchant",
    ),
  };
}
