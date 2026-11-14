/**
 * Derives the /discover sections from GET /discover/nearby (pure, unit-tested).
 *
 *  - "Hampir Habis & Diskon Tertinggi": closing within 60 min or discount ≥ 50 %,
 *    ordered by urgency (closing soonest first, then biggest discount).
 *  - "Harga ceban, maksimal Rp 12.000": selling price ≤ CEBAN_MAX_PRICE_IDR, cheapest first.
 *  - "Mitra Terdekat": merchants as returned (server sort), sold-out last.
 *
 * Quick filters ("< 500 m", "< 1 km", "Harga ≤ Rp 12.000", "Diskon ≥ 30%") run here on the
 * client, over the nearby data already fetched for the radius: the SSE feed only refetches
 * batches no cache holds, so a server-filtered cache would miss batches that just dropped
 * into range. Apply them before deriveDiscoverSections; the quick-order sheet keeps the
 * unfiltered list so a batch that is live but filtered out still opens.
 */
import {
  CEBAN_MAX_PRICE_IDR,
  QUICK_FILTER_MID_M,
  QUICK_FILTER_MIN_DISCOUNT_PCT,
  QUICK_FILTER_NEAR_M,
} from "@/lib/constants";
import type { BatchCard, MerchantSummary, NearbyResponse } from "@/lib/contracts";
import { recomputeMerchant } from "./sse-patch";

export const URGENT_CLOSING_MINUTES = 60;
export const HOT_DISCOUNT_PCT = 50;
export const SECTION_LIMIT = 10;

export type DiscoverSections = {
  urgent: BatchCard[];
  /** "Harga ceban": at most CEBAN_MAX_PRICE_IDR. */
  ceban: BatchCard[];
  merchants: MerchantSummary[];
  totalBatches: number;
  totalPortions: number;
};

/** Minutes until `pickup_end_time`, recomputed against a clock when available. */
export function minutesLeft(batch: Pick<BatchCard, "pickup_end_time" | "minutes_to_close">, nowMs: number | null): number {
  if (nowMs === null) return batch.minutes_to_close;
  const end = Date.parse(batch.pickup_end_time);
  return Number.isFinite(end) ? Math.floor((end - nowMs) / 60_000) : batch.minutes_to_close;
}

export function isBatchLive(batch: BatchCard, nowMs: number | null): boolean {
  return batch.available_stock > 0 && minutesLeft(batch, nowMs) > 0;
}

export function deriveDiscoverSections(data: NearbyResponse | undefined, nowMs: number | null): DiscoverSections {
  if (!data) return { urgent: [], ceban: [], merchants: [], totalBatches: 0, totalPortions: 0 };
  const all = data.merchants.flatMap((m) => m.batches).filter((b) => isBatchLive(b, nowMs));

  const urgent = all
    .filter((b) => minutesLeft(b, nowMs) <= URGENT_CLOSING_MINUTES || b.discount_pct >= HOT_DISCOUNT_PCT)
    .sort((a, b) => minutesLeft(a, nowMs) - minutesLeft(b, nowMs) || b.discount_pct - a.discount_pct)
    .slice(0, SECTION_LIMIT);

  const ceban = all
    .filter((b) => b.selling_price_idr <= CEBAN_MAX_PRICE_IDR)
    .sort((a, b) => a.selling_price_idr - b.selling_price_idr || b.discount_pct - a.discount_pct)
    .slice(0, SECTION_LIMIT);

  const merchants = [...data.merchants].sort((a, b) => {
    const aOut = a.total_available_stock <= 0 ? 1 : 0;
    const bOut = b.total_available_stock <= 0 ? 1 : 0;
    return aOut - bOut;
  });

  return {
    urgent,
    ceban,
    merchants,
    totalBatches: all.length,
    totalPortions: all.reduce((s, b) => s + b.available_stock, 0),
  };
}

/** Next radius to suggest when nothing is in range (2 km → 5 km → 10 km → null). */
export function nextRadius(current: number, options: readonly number[]): number | null {
  return options.find((r) => r > current) ?? null;
}

/* ------------------------------------------------------------------ */
/* Quick filters                                                       */
/* ------------------------------------------------------------------ */

/** The chip row's state. The two distance chips are one choice (at most one is on). */
export type QuickFilterState = {
  distance: "near" | "mid" | null;
  cheap: boolean;
  discount: boolean;
};

export const NO_QUICK_FILTERS: QuickFilterState = { distance: null, cheap: false, discount: false };

export type QuickFilterCriteria = {
  /** Keep batches strictly closer than this (metres). */
  maxDistanceM?: number;
  /** Keep batches at or below this selling price. */
  maxPriceIdr?: number;
  /** Keep batches at or above this discount. */
  minDiscountPct?: number;
};

export function hasQuickFilters(s: QuickFilterState): boolean {
  return s.distance !== null || s.cheap || s.discount;
}

/** Metres of the active distance chip, or null. */
export function quickFilterDistanceM(s: QuickFilterState): number | null {
  return s.distance === "near" ? QUICK_FILTER_NEAR_M : s.distance === "mid" ? QUICK_FILTER_MID_M : null;
}

export function quickFilterCriteria(s: QuickFilterState): QuickFilterCriteria {
  const maxDistanceM = quickFilterDistanceM(s);
  return {
    ...(maxDistanceM !== null ? { maxDistanceM } : {}),
    ...(s.cheap ? { maxPriceIdr: CEBAN_MAX_PRICE_IDR } : {}),
    ...(s.discount ? { minDiscountPct: QUICK_FILTER_MIN_DISCOUNT_PCT } : {}),
  };
}

function matches(b: BatchCard, c: QuickFilterCriteria): boolean {
  if (c.maxDistanceM !== undefined && (b.distance_m === null || b.distance_m >= c.maxDistanceM)) return false;
  if (c.maxPriceIdr !== undefined && b.selling_price_idr > c.maxPriceIdr) return false;
  if (c.minDiscountPct !== undefined && b.discount_pct < c.minDiscountPct) return false;
  return true;
}

/**
 * Keeps the batches that pass every active criterion, drops merchants left without batches
 * and re-aggregates the rest (discount, price, stock, closing time). Returns the same
 * reference when no criterion is active.
 */
export function applyQuickFilters(data: NearbyResponse, c: QuickFilterCriteria): NearbyResponse;
export function applyQuickFilters(data: NearbyResponse | undefined, c: QuickFilterCriteria): NearbyResponse | undefined;
export function applyQuickFilters(data: NearbyResponse | undefined, c: QuickFilterCriteria): NearbyResponse | undefined {
  if (!data) return data;
  if (c.maxDistanceM === undefined && c.maxPriceIdr === undefined && c.minDiscountPct === undefined) return data;
  const merchants: MerchantSummary[] = [];
  for (const m of data.merchants) {
    const kept = m.batches.filter((b) => matches(b, c));
    if (kept.length === 0) continue;
    merchants.push(kept.length === m.batches.length ? m : recomputeMerchant(m, kept));
  }
  return { ...data, merchants, total_batches: merchants.reduce((s, m) => s + m.batches.length, 0) };
}
