/**
 * Query keys + cart mapping for the customer app (client-safe, unit-tested).
 */
import type { BatchCard, MerchantSummary } from "@/lib/contracts";
import { CART_MAX_QTY_PER_ITEM, type CartItem, type CartMerchant } from "@/stores/cart";

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

export function cartItemFromBatch(b: BatchCard, quantity = 1): CartItem {
  return {
    batch_id: b.batch_id,
    menu_id: b.menu_id,
    menu_name: b.menu_name,
    quantity,
    unit_price_idr: b.selling_price_idr,
    original_price_idr: b.original_price_idr,
    discount_pct: b.discount_pct,
    max_quantity: Math.max(1, Math.min(b.available_stock, CART_MAX_QTY_PER_ITEM)),
    portion_weight_grams: b.portion_weight_grams,
    pickup_end_time: b.pickup_end_time,
  };
}

/** Patch for the cart when a batch's live price / stock changed. */
export function cartPatchFromBatch(
  b: Pick<BatchCard, "selling_price_idr" | "discount_pct" | "available_stock">,
): Partial<CartItem> {
  return {
    unit_price_idr: b.selling_price_idr,
    discount_pct: b.discount_pct,
    max_quantity: Math.max(1, Math.min(b.available_stock, CART_MAX_QTY_PER_ITEM)),
  };
}
