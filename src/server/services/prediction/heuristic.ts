/**
 * Heuristic Surplus Prediction ("heuristic-v0") — cold-start fallback for the
 * LightGBM pipeline (ml/train_predict.py → model_version "lgbm-v1").
 *
 * For a target WIB date, look at the same weekday in the previous 4 weeks:
 *   - predicted surplus portions = mean initial_stock of the closed batches
 *     (initial_stock is what the warung declared as surplus that evening)
 *   - sell-out probability       = Laplace-smoothed share of SOLD_OUT batches
 *   - confidence                 = grows with the number of observations
 * Pure functions (no DB) so they are unit-testable.
 */
import { DAY_MS, wibDayOfWeek } from "@/lib/time";

export const HEURISTIC_MODEL_VERSION = "heuristic-v0";
export const LGBM_MODEL_VERSION = "lgbm-v1";
export const HISTORY_WEEKS = 4;

export interface HistoryBatch {
  menuId: string;
  batchDate: string; // YYYY-MM-DD (WIB)
  initialStock: number;
  /** Only closed batches count (SOLD_OUT | EXPIRED). */
  status: string;
}

export interface HeuristicEstimate {
  predictedSurplusPortions: number;
  selloutProbabilityAt50pct: number;
  confidenceScore: number;
  /** Number of same-weekday batches the estimate is based on. */
  observations: number;
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** "YYYY-MM-DD" shifted by whole days (calendar arithmetic, timezone-free). */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The same weekday in the previous `weeks` weeks (newest first). */
export function sameWeekdayDates(targetDate: string, weeks = HISTORY_WEEKS): string[] {
  return Array.from({ length: weeks }, (_, i) => shiftDate(targetDate, -7 * (i + 1)));
}

const isClosed = (status: string) => status === "SOLD_OUT" || status === "EXPIRED";

/**
 * Estimate for one menu. `history` may contain any batches of the menu; only
 * closed ones on the same weekday within the last 4 weeks before the target are used.
 * Without same-weekday data it falls back to the menu's mean over the whole
 * 4-week window (low confidence), and to 0 portions for a brand-new menu.
 */
export function heuristicForMenu(history: HistoryBatch[], targetDate: string): HeuristicEstimate {
  const windowStart = shiftDate(targetDate, -7 * HISTORY_WEEKS);
  const closed = history.filter((b) => isClosed(b.status) && b.batchDate >= windowStart && b.batchDate < targetDate);
  const dow = wibDayOfWeek(targetDate);
  const same = closed.filter((b) => wibDayOfWeek(b.batchDate) === dow);
  const n = same.length;

  if (n === 0) {
    const anyMean = closed.length ? closed.reduce((s, b) => s + b.initialStock, 0) / closed.length : 0;
    const soldOut = closed.filter((b) => b.status === "SOLD_OUT").length;
    return {
      predictedSurplusPortions: round(anyMean, 2),
      selloutProbabilityAt50pct: round((soldOut + 1) / (closed.length + 2), 4),
      confidenceScore: closed.length ? 0.35 : 0.3,
      observations: 0,
    };
  }
  const mean = same.reduce((s, b) => s + b.initialStock, 0) / n;
  const soldOut = same.filter((b) => b.status === "SOLD_OUT").length;
  return {
    predictedSurplusPortions: round(mean, 2),
    selloutProbabilityAt50pct: round((soldOut + 1) / (n + 2), 4), // Laplace smoothing
    confidenceScore: round(clamp(0.45 + 0.12 * n, 0.3, 0.95), 4),
    observations: n,
  };
}

/** Merchant-level estimate (menu_id NULL): sum of portions, mean probability & confidence. */
export function combineMenuEstimates(estimates: HeuristicEstimate[]): HeuristicEstimate {
  if (!estimates.length) {
    return { predictedSurplusPortions: 0, selloutProbabilityAt50pct: 0.5, confidenceScore: 0.3, observations: 0 };
  }
  const k = estimates.length;
  return {
    predictedSurplusPortions: round(estimates.reduce((s, e) => s + e.predictedSurplusPortions, 0), 2),
    selloutProbabilityAt50pct: round(estimates.reduce((s, e) => s + e.selloutProbabilityAt50pct, 0) / k, 4),
    confidenceScore: round(estimates.reduce((s, e) => s + e.confidenceScore, 0) / k, 4),
    observations: estimates.reduce((s, e) => s + e.observations, 0),
  };
}
