/**
 * Surplus Prediction Engine — serving side (blueprint §2.3.2).
 *
 * Predictions are pre-computed into merchant_surplus_predictions by
 *   - ml/train_predict.py           (weekly, model_version "lgbm-v1")
 *   - refreshHeuristicPredictions() (daily 00:15 WIB, "heuristic-v0")
 * The table is UNIQUE NULLS NOT DISTINCT (merchant_id, menu_id, target_date), so a
 * key holds one row: the heuristic refresh never overwrites an lgbm-v1 row, while
 * the ML pipeline replaces heuristic rows. When no row exists (new merchant/menu,
 * date beyond the horizon) the heuristic is computed on the fly from history.
 */
import "server-only";
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { menus, merchants, merchantSurplusPredictions, surplusBatches } from "@/db/schema";
import { wibDayOfWeek } from "@/lib/time";
import {
  combineMenuEstimates,
  heuristicForMenu,
  HEURISTIC_MODEL_VERSION,
  HISTORY_WEEKS,
  LGBM_MODEL_VERSION,
  shiftDate,
  type HeuristicEstimate,
  type HistoryBatch,
} from "./heuristic";

export { HEURISTIC_MODEL_VERSION, LGBM_MODEL_VERSION } from "./heuristic";

export interface Prediction {
  merchantId: string;
  menuId: string | null;
  targetDate: string;
  dayOfWeek: number;
  predictedSurplusPortions: number;
  selloutProbabilityAt50pct: number;
  confidenceScore: number;
  /** "HH:MM" (WIB). */
  peakHour: string;
  modelVersion: string;
  proactiveNotifSent: boolean;
  /** "stored" = read from merchant_surplus_predictions, "computed" = on-the-fly heuristic. */
  source: "stored" | "computed";
}

const MODEL_RANK: Record<string, number> = { [LGBM_MODEL_VERSION]: 2, [HEURISTIC_MODEL_VERSION]: 1 };

type PredictionRow = typeof merchantSurplusPredictions.$inferSelect;

function fromRow(r: PredictionRow): Prediction {
  return {
    merchantId: r.merchantId,
    menuId: r.menuId,
    targetDate: r.targetDate,
    dayOfWeek: r.dayOfWeek,
    predictedSurplusPortions: Number(r.predictedSurplusPortions),
    selloutProbabilityAt50pct: Number(r.selloutProbabilityAt50pct),
    confidenceScore: Number(r.confidenceScore),
    peakHour: r.predictedPeakSurplusHour.slice(0, 5),
    modelVersion: r.modelVersion,
    proactiveNotifSent: r.proactiveNotifSent,
    source: "stored",
  };
}

/** Closed batches of the given menus in the 4 weeks before `beforeDate` (exclusive). */
async function loadHistory(db: Db, menuIds: string[], fromDate: string, beforeDate: string): Promise<HistoryBatch[]> {
  if (!menuIds.length) return [];
  return db
    .select({
      menuId: surplusBatches.menuId,
      batchDate: surplusBatches.batchDate,
      initialStock: surplusBatches.initialStock,
      status: surplusBatches.status,
    })
    .from(surplusBatches)
    .where(
      and(
        inArray(surplusBatches.menuId, menuIds),
        inArray(surplusBatches.status, ["SOLD_OUT", "EXPIRED"]),
        gte(surplusBatches.batchDate, fromDate),
        lt(surplusBatches.batchDate, beforeDate),
      ),
    );
}

async function merchantStartHour(db: Db, merchantId: string): Promise<string> {
  const [m] = await db
    .select({ start: merchants.defaultSurplusStartTime })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  return (m?.start ?? "20:00:00").slice(0, 5);
}

async function activeMenuIds(db: Db, merchantId: string): Promise<string[]> {
  const rows = await db
    .select({ id: menus.id })
    .from(menus)
    .where(and(eq(menus.merchantId, merchantId), eq(menus.isActive, true)));
  return rows.map((r) => r.id);
}

/** On-the-fly heuristic for one menu, or for the whole merchant when menuId is null. */
export async function computeHeuristicPrediction(
  db: Db,
  merchantId: string,
  menuId: string | null,
  targetDate: string,
): Promise<Prediction> {
  const menuIds = menuId ? [menuId] : await activeMenuIds(db, merchantId);
  const history = await loadHistory(db, menuIds, shiftDate(targetDate, -7 * HISTORY_WEEKS), targetDate);
  const perMenu = menuIds.map((id) => heuristicForMenu(history.filter((h) => h.menuId === id), targetDate));
  const est: HeuristicEstimate = menuId ? perMenu[0] : combineMenuEstimates(perMenu);
  return {
    merchantId,
    menuId,
    targetDate,
    dayOfWeek: wibDayOfWeek(targetDate),
    predictedSurplusPortions: est.predictedSurplusPortions,
    selloutProbabilityAt50pct: est.selloutProbabilityAt50pct,
    confidenceScore: est.confidenceScore,
    peakHour: await merchantStartHour(db, merchantId),
    modelVersion: HEURISTIC_MODEL_VERSION,
    proactiveNotifSent: false,
    source: "computed",
  };
}

/** Stored prediction (lgbm-v1 preferred over heuristic-v0), else the on-the-fly heuristic. */
export async function getPrediction(
  db: Db,
  merchantId: string,
  menuId: string | null,
  targetDate: string,
): Promise<Prediction> {
  const rows = await db
    .select()
    .from(merchantSurplusPredictions)
    .where(
      and(
        eq(merchantSurplusPredictions.merchantId, merchantId),
        menuId ? eq(merchantSurplusPredictions.menuId, menuId) : isNull(merchantSurplusPredictions.menuId),
        eq(merchantSurplusPredictions.targetDate, targetDate),
      ),
    );
  if (rows.length) {
    rows.sort((a, b) => (MODEL_RANK[b.modelVersion] ?? 0) - (MODEL_RANK[a.modelVersion] ?? 0));
    return fromRow(rows[0]);
  }
  return computeHeuristicPrediction(db, merchantId, menuId, targetDate);
}

/** Stored predictions for a set of merchant/menu keys on one date, keyed `${menuId ?? "all"}`. */
export async function getMenuPredictions(
  db: Db,
  merchantId: string,
  menuIds: string[],
  targetDate: string,
): Promise<Map<string, Prediction>> {
  const out = new Map<string, Prediction>();
  if (!menuIds.length) return out;
  const rows = await db
    .select()
    .from(merchantSurplusPredictions)
    .where(
      and(
        eq(merchantSurplusPredictions.merchantId, merchantId),
        inArray(merchantSurplusPredictions.menuId, menuIds),
        eq(merchantSurplusPredictions.targetDate, targetDate),
      ),
    );
  for (const r of rows) out.set(r.menuId!, fromRow(r));
  for (const id of menuIds) {
    if (!out.has(id)) out.set(id, await computeHeuristicPrediction(db, merchantId, id, targetDate));
  }
  return out;
}

export interface RefreshSummary {
  upserted: number;
  skippedLgbm: number;
}

/**
 * Daily job: (re)computes heuristic rows for every merchant × active menu (+ the
 * merchant-level row) for `days` dates starting at `fromDate`. Never overwrites
 * an lgbm-v1 row; keeps proactive_notif_sent of rows it updates.
 */
export async function refreshHeuristicPredictions(db: Db, fromDate: string, days = 7): Promise<RefreshSummary> {
  const allMenus = await db
    .select({ id: menus.id, merchantId: menus.merchantId, start: merchants.defaultSurplusStartTime })
    .from(menus)
    .innerJoin(merchants, eq(merchants.id, menus.merchantId))
    .where(eq(menus.isActive, true));
  const lastDate = shiftDate(fromDate, days - 1);
  const history = await loadHistory(
    db,
    allMenus.map((m) => m.id),
    shiftDate(fromDate, -7 * HISTORY_WEEKS),
    lastDate,
  );
  const historyByMenu = new Map<string, HistoryBatch[]>();
  for (const h of history) {
    const list = historyByMenu.get(h.menuId) ?? [];
    list.push(h);
    historyByMenu.set(h.menuId, list);
  }
  const byMerchant = new Map<string, { start: string; menuIds: string[] }>();
  for (const m of allMenus) {
    const entry = byMerchant.get(m.merchantId) ?? { start: m.start, menuIds: [] };
    entry.menuIds.push(m.id);
    byMerchant.set(m.merchantId, entry);
  }

  type Row = { merchantId: string; menuId: string | null; date: string; est: HeuristicEstimate; start: string };
  const rows: Row[] = [];
  for (let k = 0; k < days; k++) {
    const date = shiftDate(fromDate, k);
    for (const [merchantId, { start, menuIds }] of byMerchant) {
      const ests = menuIds.map((id) => {
        const est = heuristicForMenu(historyByMenu.get(id) ?? [], date);
        rows.push({ merchantId, menuId: id, date, est, start });
        return est;
      });
      rows.push({ merchantId, menuId: null, date, est: combineMenuEstimates(ests), start });
    }
  }

  let upserted = 0;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = sql.join(
      chunk.map(
        (r) => sql`(${r.merchantId}::uuid, ${r.menuId}::uuid, ${r.date}::date, ${wibDayOfWeek(r.date)},
          ${r.est.predictedSurplusPortions}, ${r.start}::time, ${r.est.selloutProbabilityAt50pct},
          ${r.est.confidenceScore}, ${HEURISTIC_MODEL_VERSION})`,
      ),
      sql`, `,
    );
    const res = await db.execute<{ id: string }>(sql`
      INSERT INTO merchant_surplus_predictions
        (merchant_id, menu_id, target_date, day_of_week, predicted_surplus_portions,
         predicted_peak_surplus_hour, sellout_probability_at_50pct, confidence_score, model_version)
      VALUES ${values}
      ON CONFLICT ON CONSTRAINT uq_predictions_merchant_menu_date DO UPDATE SET
        day_of_week = EXCLUDED.day_of_week,
        predicted_surplus_portions = EXCLUDED.predicted_surplus_portions,
        predicted_peak_surplus_hour = EXCLUDED.predicted_peak_surplus_hour,
        sellout_probability_at_50pct = EXCLUDED.sellout_probability_at_50pct,
        confidence_score = EXCLUDED.confidence_score,
        model_version = EXCLUDED.model_version,
        created_at = now()
      WHERE merchant_surplus_predictions.model_version <> ${LGBM_MODEL_VERSION}
      RETURNING id`);
    upserted += res.rows.length;
  }
  return { upserted, skippedLgbm: rows.length - upserted };
}
