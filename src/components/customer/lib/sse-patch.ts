/**
 * Applies live batch events (GET /stream/batches, event "batch") to cached
 * discovery data (pure, unit-tested). Returns the same reference when nothing
 * changed so TanStack Query does not re-render needlessly.
 */
import type { BatchCard, BatchStreamEvent, MerchantDetail, MerchantSummary, NearbyResponse } from "@/lib/contracts";

export type PriceDrop = {
  batch_id: string;
  menu_name: string;
  merchant_name: string;
  merchant_slug: string;
  old_price_idr: number;
  new_price_idr: number;
  old_discount_pct: number;
  new_discount_pct: number;
};

export type PatchResult<T> = { data: T; found: boolean; priceDrop: PriceDrop | null };

function patchBatch(b: BatchCard, ev: BatchStreamEvent): BatchCard {
  const stock = ev.status === "ACTIVE" ? ev.available_stock : 0;
  if (
    b.available_stock === stock &&
    b.discount_pct === ev.discount_pct &&
    b.selling_price_idr === ev.selling_price_idr
  ) {
    return b;
  }
  return { ...b, available_stock: stock, discount_pct: ev.discount_pct, selling_price_idr: ev.selling_price_idr };
}

function dropOf(before: BatchCard, after: BatchCard): PriceDrop | null {
  if (after.discount_pct <= before.discount_pct || after.selling_price_idr >= before.selling_price_idr) return null;
  return {
    batch_id: after.batch_id,
    menu_name: after.menu_name,
    merchant_name: after.merchant_name,
    merchant_slug: after.merchant_slug,
    old_price_idr: before.selling_price_idr,
    new_price_idr: after.selling_price_idr,
    old_discount_pct: before.discount_pct,
    new_discount_pct: after.discount_pct,
  };
}

/** Recomputes the merchant aggregates after its batches changed. */
export function recomputeMerchant<T extends MerchantSummary>(m: T, batches: BatchCard[]): T {
  const live = batches.filter((b) => b.available_stock > 0);
  const ends = batches.map((b) => b.pickup_end_time).sort();
  return {
    ...m,
    batches,
    max_discount_pct: live.reduce((x, b) => Math.max(x, b.discount_pct), 0),
    min_price_idr: live.length ? Math.min(...live.map((b) => b.selling_price_idr)) : 0,
    total_available_stock: live.reduce((s, b) => s + b.available_stock, 0),
    closes_at: ends.length ? ends[ends.length - 1] : m.closes_at,
  };
}

function patchMerchantBatches<T extends MerchantSummary>(
  m: T,
  ev: BatchStreamEvent,
  removeClosed: boolean,
): { merchant: T; found: boolean; priceDrop: PriceDrop | null } {
  if (m.id !== ev.merchant_id) return { merchant: m, found: false, priceDrop: null };
  const idx = m.batches.findIndex((b) => b.batch_id === ev.batch_id);
  if (idx < 0) return { merchant: m, found: false, priceDrop: null };
  const before = m.batches[idx];
  const closed = ev.status === "EXPIRED" || ev.status === "CANCELLED";
  let batches: BatchCard[];
  let after: BatchCard | null = null;
  if (closed && removeClosed) {
    batches = m.batches.filter((_, i) => i !== idx);
  } else {
    after = patchBatch(before, ev);
    if (after === before) return { merchant: m, found: true, priceDrop: null };
    batches = m.batches.map((b, i) => (i === idx ? (after as BatchCard) : b));
  }
  return { merchant: recomputeMerchant(m, batches), found: true, priceDrop: after ? dropOf(before, after) : null };
}

/** Patches GET /discover/nearby data. Closed batches are removed; sold-out ones stay with stock 0. */
export function patchNearby(data: NearbyResponse, ev: BatchStreamEvent): PatchResult<NearbyResponse> {
  let found = false;
  let priceDrop: PriceDrop | null = null;
  let changed = false;
  const merchants = data.merchants.map((m) => {
    const r = patchMerchantBatches(m, ev, true);
    if (r.found) found = true;
    if (r.priceDrop) priceDrop = r.priceDrop;
    if (r.merchant !== m) changed = true;
    return r.merchant;
  });
  if (!changed) return { data, found, priceDrop: null };
  return {
    data: { ...data, merchants, total_batches: merchants.reduce((s, m) => s + m.batches.length, 0) },
    found,
    priceDrop,
  };
}

/** Patches GET /merchants/:slug data. Closed batches stay visible as "Habis". */
export function patchMerchantDetail(data: MerchantDetail, ev: BatchStreamEvent): PatchResult<MerchantDetail> {
  const r = patchMerchantBatches(data, ev, false);
  return { data: r.merchant, found: r.found, priceDrop: r.priceDrop };
}
