/** Prediction insights (weekly outlook, weekday × menu heatmap, advisories) and analytics. */
import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { menus, orderItems, orders, surplusBatches } from "@/db/schema";
import type { AnalyticsResponse, InsightsResponse, OrderStatus } from "@/lib/contracts";
import { MERCHANT_PREMIUM_PRICE_IDR } from "@/lib/constants";
import { DAY_NAMES_ID, formatIdr, wibDate } from "@/lib/time";
import { getPrediction, HEURISTIC_MODEL_VERSION } from "@/server/services/prediction";
import { shiftDate } from "@/server/services/prediction/heuristic";
import { loadMerchant } from "./profile";
import { wibDayBounds } from "./dashboard";

/** Ingredient cost assumed when estimating savings from producing less (share of the normal price). */
export const FOOD_COST_SHARE = 0.4;
const PAID_STATES: OrderStatus[] = ["PAID", "READY_FOR_PICKUP", "COMPLETED"];
/** WIB calendar date of a timestamptz column, as text. */
const wibDay = (col: unknown) => sql<string>`to_char((${col} AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD')`;

export async function getInsights(db: Db, merchantId: string, now: Date = new Date()): Promise<InsightsResponse> {
  const today = wibDate(now);
  const week = [];
  for (let k = 0; k < 7; k++) {
    const date = shiftDate(today, k);
    const p = await getPrediction(db, merchantId, null, date);
    week.push({ p, row: {
      date,
      day_of_week: p.dayOfWeek,
      predicted_surplus_portions: p.predictedSurplusPortions,
      sellout_probability_at_50pct: p.selloutProbabilityAt50pct,
      confidence_score: p.confidenceScore,
    } });
  }

  const from = shiftDate(today, -28);
  const heat = await db
    .select({
      dow: sql<number>`EXTRACT(DOW FROM ${surplusBatches.batchDate})::int`,
      menuId: surplusBatches.menuId,
      menuName: menus.menuName,
      price: menus.originalPriceIdr,
      avgSurplus: sql<number>`ROUND(AVG(${surplusBatches.initialStock})::numeric, 1)::float8`,
      avgLeftover: sql<number>`ROUND(AVG(${surplusBatches.availableStock})::numeric, 1)::float8`,
    })
    .from(surplusBatches)
    .innerJoin(menus, eq(menus.id, surplusBatches.menuId))
    .where(
      and(
        eq(surplusBatches.merchantId, merchantId),
        inArray(surplusBatches.status, ["SOLD_OUT", "EXPIRED"]),
        gte(surplusBatches.batchDate, from),
        lt(surplusBatches.batchDate, today),
      ),
    )
    .groupBy(sql`1`, surplusBatches.menuId, menus.menuName, menus.originalPriceIdr)
    .orderBy(sql`1`, menus.menuName);

  const advisories: string[] = [];
  const wasteful = heat.filter((h) => h.avgLeftover >= 2).sort((a, b) => b.avgLeftover - a.avgLeftover);
  for (const h of wasteful.slice(0, 3)) {
    const cut = Math.max(1, Math.round(h.avgLeftover));
    const saving = Math.round((cut * h.price * FOOD_COST_SHARE) / 1000) * 1000;
    advisories.push(
      `Rata-rata ${h.menuName} masih tersisa ${String(h.avgLeftover).replace(".", ",")} porsi tiap ${DAY_NAMES_ID[h.dow]} malam. ` +
        `Kurangi produksi ~${cut} porsi untuk menghemat bahan baku ±${formatIdr(saving)}/hari.`,
    );
  }
  const peak = [...week].sort((a, b) => b.row.predicted_surplus_portions - a.row.predicted_surplus_portions)[0];
  if (peak && peak.row.predicted_surplus_portions >= 1) {
    advisories.push(
      `Prediksi surplus tertinggi minggu ini: ${DAY_NAMES_ID[peak.row.day_of_week]} (${peak.row.date}) ~${Math.round(peak.row.predicted_surplus_portions)} porsi. Siapkan publikasi lebih awal.`,
    );
  }
  if (!heat.length) {
    advisories.push("Belum cukup histori. Publikasikan surplus beberapa malam agar prediksi AI makin akurat.");
  }

  return {
    model_version: week[0]?.p.modelVersion ?? HEURISTIC_MODEL_VERSION,
    week: week.map((w) => w.row),
    heatmap: heat.map((h) => ({
      day_of_week: h.dow,
      menu_id: h.menuId,
      menu_name: h.menuName,
      avg_surplus_portions: Number(h.avgSurplus),
      avg_leftover_portions: Number(h.avgLeftover),
    })),
    advisories,
  };
}

export async function getAnalytics(
  db: Db,
  merchantId: string,
  rangeDays: number,
  now: Date = new Date(),
): Promise<AnalyticsResponse> {
  const merchant = await loadMerchant(db, merchantId);
  const today = wibDate(now);
  const firstDate = shiftDate(today, -(rangeDays - 1));
  const from = wibDayBounds(firstDate).from;
  const to = wibDayBounds(today).to;

  // Batches by batch_date: published / sold (incl. offline) / wasted (left at close).
  const batchDaily = await db
    .select({
      date: sql<string>`${surplusBatches.batchDate}::text`,
      published: sql<number>`SUM(${surplusBatches.initialStock})::int`,
      sold: sql<number>`SUM(${surplusBatches.initialStock} - ${surplusBatches.availableStock} - ${surplusBatches.reservedStock})::int`,
      wasted: sql<number>`SUM(CASE WHEN ${surplusBatches.status} IN ('EXPIRED', 'CANCELLED') THEN ${surplusBatches.availableStock} ELSE 0 END)::int`,
      potential: sql<number>`SUM(${surplusBatches.initialStock} * ${surplusBatches.originalPriceIdr})::bigint`,
    })
    .from(surplusBatches)
    .where(
      and(
        eq(surplusBatches.merchantId, merchantId),
        gte(surplusBatches.batchDate, firstDate),
        sql`${surplusBatches.batchDate} <= ${today}::date`,
        sql`${surplusBatches.status} <> 'SCHEDULED'`,
      ),
    )
    .groupBy(surplusBatches.batchDate);

  const paidInRange = and(
    eq(orders.merchantId, merchantId),
    inArray(orders.status, PAID_STATES),
    gte(orders.createdAt, from),
    lt(orders.createdAt, to),
  );
  const revenueDaily = await db
    .select({
      date: wibDay(orders.createdAt),
      revenue: sql<number>`SUM(${orders.netMerchantPayoutIdr})::bigint`,
    })
    .from(orders)
    .where(paidInRange)
    .groupBy(sql`1`);

  const [impact] = await db
    .select({
      food: sql<number>`COALESCE(SUM(${orders.totalFoodSavedGrams}), 0)::int`,
      co2: sql<number>`COALESCE(SUM(${orders.totalCo2AvoidedGrams}), 0)::int`,
    })
    .from(orders)
    .where(
      and(eq(orders.merchantId, merchantId), eq(orders.status, "COMPLETED"), gte(orders.createdAt, from), lt(orders.createdAt, to)),
    );

  const top = await db
    .select({
      menuId: orderItems.menuId,
      menuName: menus.menuName,
      sold: sql<number>`SUM(${orderItems.quantity})::int`,
      revenue: sql<number>`SUM(${orderItems.quantity} * ${orderItems.unitSellingPriceIdr})::bigint`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(menus, eq(menus.id, orderItems.menuId))
    .where(paidInRange)
    .groupBy(orderItems.menuId, menus.menuName)
    .orderBy(sql`3 DESC`)
    .limit(5);

  const byDate = new Map(batchDaily.map((r) => [r.date, r]));
  const revByDate = new Map(revenueDaily.map((r) => [r.date, Number(r.revenue)]));
  const daily: AnalyticsResponse["daily"] = [];
  for (let k = 0; k < rangeDays; k++) {
    const date = shiftDate(firstDate, k);
    daily.push({
      date,
      revenue_idr: revByDate.get(date) ?? 0,
      portions_sold: byDate.get(date)?.sold ?? 0,
      portions_wasted: byDate.get(date)?.wasted ?? 0,
    });
  }
  const sum = <K extends "published" | "sold" | "wasted">(k: K) => batchDaily.reduce((s, r) => s + Number(r[k]), 0);
  const published = sum("published");
  const sold = sum("sold");

  return {
    range_days: rangeDays,
    revenue_recovered_idr: daily.reduce((s, d) => s + d.revenue_idr, 0),
    potential_revenue_idr: batchDaily.reduce((s, r) => s + Number(r.potential), 0),
    portions_published: published,
    portions_sold: sold,
    portions_wasted: sum("wasted"),
    sell_through_rate: published ? Math.round((sold / published) * 10_000) / 10_000 : 0,
    food_saved_grams: impact.food,
    co2_avoided_grams: impact.co2,
    daily,
    top_menus: top.map((t) => ({
      menu_id: t.menuId,
      menu_name: t.menuName,
      portions_sold: t.sold,
      revenue_idr: Number(t.revenue),
    })),
    subscription: {
      tier: merchant.subscriptionTier,
      expires_at: merchant.subscriptionExpiresAt ? merchant.subscriptionExpiresAt.toISOString() : null,
      price_idr: MERCHANT_PREMIUM_PRICE_IDR,
    },
  };
}
