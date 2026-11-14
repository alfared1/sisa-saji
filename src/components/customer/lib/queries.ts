/**
 * Query keys + cart mapping for the customer app (client-safe, unit-tested).
 */
import type { BatchCard, MerchantSummary } from "@/lib/contracts";
import { defaultLauk, lineKey } from "@/lib/lauk";
import { CART_MAX_QTY_PER_ITEM, type CartBatchPatch, type CartItem, type CartMerchant } from "@/stores/cart";

export const customerKeys = {
  nearbyAll: ["discover", "nearby"] as const,
  nearby: (p: { lat: number; lng: number; radius_m: number; category: string | null; q: string; sort: string }) =>
    ["discover", "nearby", p] as const,
  pinsAll: ["discover", "map-pins"] as const,
  pins: (p: { lat: number; lng: number; radius_m: number }) => ["discover", "map-pins", p] as const,
  /** Nationwide map. Not under `pinsAll`, so SSE batch events do not refetch it (it polls). */
  allPins: ["discover", "all-pins"] as const,
  warungAll: ["warung"] as const,
  warung: (slug: string) => ["warung", slug] as const,
  ordersAll: ["orders"] as const,
  orders: (status: string) => ["orders", "list", status] as const,
  order: (id: string) => ["orders", "detail", id] as const,
  impact: ["profile", "impact"] as const,
  subscriptions: ["subscriptions"] as const,
  vouchers: ["vouchers"] as const,
  globalStats: ["stats", "global"] as const,
};

export function cartMerchantOf(m: Pick<MerchantSummary, "id" | "slug" | "name">): CartMerchant {
  return { id: m.id, slug: m.slug, name: m.name };
}

export function cartMerchantFromBatch(b: Pick<BatchCard, "merchant_id" | "merchant_slug" | "merchant_name">): CartMerchant {
  return { id: b.merchant_id, slug: b.merchant_slug, name: b.merchant_name };
}

/**
 * Cart line for a batch. The lauk defaults to the first one still available (the UI
 * preselects it and lets the buyer change it); pass null for "choose at the counter".
 */
export function cartItemFromBatch(b: BatchCard, quantity = 1, lauk: string | null = defaultLauk(b)): CartItem {
  return {
    key: lineKey(b.batch_id, lauk),
    batch_id: b.batch_id,
    menu_id: b.menu_id,
    menu_name: b.menu_name,
    category: b.category,
    lauk,
    lauk_available: b.lauk_available,
    quantity,
    unit_price_idr: b.selling_price_idr,
    original_price_idr: b.original_price_idr,
    discount_pct: b.discount_pct,
    max_quantity: Math.max(1, Math.min(b.available_stock, CART_MAX_QTY_PER_ITEM)),
    portion_weight_grams: b.portion_weight_grams,
    pickup_end_time: b.pickup_end_time,
  };
}

/**
 * Patch for every cart line of a batch when its live price / stock / lauk changed
 * (useCartStore.patchBatch). A chosen lauk that disappeared stays on the line; checkout
 * refuses it with the lauk still available.
 */
export function cartPatchFromBatch(
  b: Pick<BatchCard, "selling_price_idr" | "discount_pct" | "available_stock"> & Partial<Pick<BatchCard, "lauk_available">>,
): CartBatchPatch {
  return {
    unit_price_idr: b.selling_price_idr,
    discount_pct: b.discount_pct,
    max_quantity: Math.max(1, Math.min(b.available_stock, CART_MAX_QTY_PER_ITEM)),
    ...(b.lauk_available ? { lauk_available: b.lauk_available } : {}),
  };
}
