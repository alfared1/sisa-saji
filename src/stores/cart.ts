/**
 * Single-merchant cart (blueprint: DiffMerchantModal guardrail — self-pickup is
 * per warung). Persisted to localStorage; hydrated on the client by
 * <StoreHydration /> so the first render matches the server.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistStorage } from "@/lib/pwa/storage";

export type CartMerchant = { id: string; slug: string; name: string };

export type CartItem = {
  batch_id: string;
  menu_id: string;
  menu_name: string;
  quantity: number;
  unit_price_idr: number;
  original_price_idr: number;
  discount_pct: number;
  max_quantity: number;
  portion_weight_grams: number;
  pickup_end_time: string;
};

export type AddItemResult = "added" | "different_merchant";

/** Hard cap per line, mirrors CheckoutBody (quantity ≤ 10, ≤ 10 lines). */
export const CART_MAX_QTY_PER_ITEM = 10;
export const CART_MAX_LINES = 10;

type CartState = {
  merchant: CartMerchant | null;
  items: CartItem[];
  addItem: (merchant: CartMerchant, item: CartItem) => AddItemResult;
  replaceCart: (merchant: CartMerchant, item: CartItem) => void;
  setQuantity: (batchId: string, quantity: number) => void;
  removeItem: (batchId: string) => void;
  /** Live updates (price/stock) from SSE or refetch; clamps quantity to new stock. */
  updateItem: (batchId: string, patch: Partial<Omit<CartItem, "batch_id">>) => void;
  clear: () => void;
};

function clampQty(q: number, max: number): number {
  const upper = Math.max(1, Math.min(max, CART_MAX_QTY_PER_ITEM));
  if (!Number.isFinite(q)) return 1;
  return Math.min(upper, Math.max(1, Math.round(q)));
}

function normalise(item: CartItem): CartItem {
  return { ...item, quantity: clampQty(item.quantity, item.max_quantity) };
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      merchant: null,
      items: [],

      addItem: (merchant, item) => {
        const state = get();
        if (state.merchant && state.merchant.id !== merchant.id && state.items.length > 0) {
          return "different_merchant";
        }
        const existing = state.items.find((i) => i.batch_id === item.batch_id);
        if (existing) {
          const merged = normalise({
            ...existing,
            ...item,
            quantity: existing.quantity + item.quantity,
          });
          set({
            merchant,
            items: state.items.map((i) => (i.batch_id === item.batch_id ? merged : i)),
          });
        } else {
          if (state.items.length >= CART_MAX_LINES) return "added";
          set({ merchant, items: [...state.items, normalise(item)] });
        }
        return "added";
      },

      replaceCart: (merchant, item) => set({ merchant, items: [normalise(item)] }),

      setQuantity: (batchId, quantity) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.batch_id === batchId ? { ...i, quantity: clampQty(quantity, i.max_quantity) } : i,
          ),
        })),

      removeItem: (batchId) =>
        set((s) => {
          const items = s.items.filter((i) => i.batch_id !== batchId);
          return { items, merchant: items.length ? s.merchant : null };
        }),

      updateItem: (batchId, patch) =>
        set((s) => ({
          items: s.items.map((i) => (i.batch_id === batchId ? normalise({ ...i, ...patch }) : i)),
        })),

      clear: () => set({ merchant: null, items: [] }),
    }),
    {
      name: "ss-cart",
      version: 1,
      storage: persistStorage(),
      skipHydration: true,
      partialize: (s) => ({ merchant: s.merchant, items: s.items }),
    },
  ),
);

/* ---------------------------- selectors ---------------------------- */

type CartData = Pick<CartState, "items" | "merchant">;

export const selectCartCount = (s: CartData) => s.items.reduce((n, i) => n + i.quantity, 0);
export const selectCartSubtotal = (s: CartData) =>
  s.items.reduce((n, i) => n + i.unit_price_idr * i.quantity, 0);
export const selectCartOriginalSubtotal = (s: CartData) =>
  s.items.reduce((n, i) => n + i.original_price_idr * i.quantity, 0);
export const selectCartSavings = (s: CartData) =>
  Math.max(0, selectCartOriginalSubtotal(s) - selectCartSubtotal(s));
export const selectCartFoodGrams = (s: CartData) =>
  s.items.reduce((n, i) => n + i.portion_weight_grams * i.quantity, 0);
/** Earliest pickup_end_time across the cart (the binding deadline). */
export const selectCartEarliestEnd = (s: CartData): string | null =>
  s.items.reduce<string | null>(
    (min, i) => (min === null || i.pickup_end_time < min ? i.pickup_end_time : min),
    null,
  );
export const selectCartQuantityFor = (batchId: string) => (s: CartData) =>
  s.items.find((i) => i.batch_id === batchId)?.quantity ?? 0;
