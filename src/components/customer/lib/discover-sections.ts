/**
 * Derives the /discover sections from GET /discover/nearby (pure, unit-tested).
 *
 *  - "Hampir Habis & Diskon Tertinggi": closing within 60 min or discount ≥ 60 %,
 *    ordered by urgency (closing soonest first, then biggest discount).
 *  - "Di Bawah Rp 10.000": selling price < 10.000, cheapest first.
 *  - "Mitra Terdekat": merchants as returned (server sort), sold-out last.
 */
import type { BatchCard, MerchantSummary, NearbyResponse } from "@/lib/contracts";

export const URGENT_CLOSING_MINUTES = 60;
export const HOT_DISCOUNT_PCT = 60;
export const UNDER_PRICE_IDR = 10_000;
export const SECTION_LIMIT = 10;

export type DiscoverSections = {
  urgent: BatchCard[];
  under10k: BatchCard[];
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
  if (!data) return { urgent: [], under10k: [], merchants: [], totalBatches: 0, totalPortions: 0 };
  const all = data.merchants.flatMap((m) => m.batches).filter((b) => isBatchLive(b, nowMs));

  const urgent = all
    .filter((b) => minutesLeft(b, nowMs) <= URGENT_CLOSING_MINUTES || b.discount_pct >= HOT_DISCOUNT_PCT)
    .sort((a, b) => minutesLeft(a, nowMs) - minutesLeft(b, nowMs) || b.discount_pct - a.discount_pct)
    .slice(0, SECTION_LIMIT);

  const under10k = all
    .filter((b) => b.selling_price_idr < UNDER_PRICE_IDR)
    .sort((a, b) => a.selling_price_idr - b.selling_price_idr || b.discount_pct - a.discount_pct)
    .slice(0, SECTION_LIMIT);

  const merchants = [...data.merchants].sort((a, b) => {
    const aOut = a.total_available_stock <= 0 ? 1 : 0;
    const bOut = b.total_available_stock <= 0 ? 1 : 0;
    return aOut - bOut;
  });

  return {
    urgent,
    under10k,
    merchants,
    totalBatches: all.length,
    totalPortions: all.reduce((s, b) => s + b.available_stock, 0),
  };
}

/** Next radius to suggest when nothing is in range (2 km → 5 km → 10 km → null). */
export function nextRadius(current: number, options: readonly number[]): number | null {
  return options.find((r) => r > current) ?? null;
}
