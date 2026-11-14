/**
 * Single-merchant cart (blueprint: DiffMerchantModal guardrail — self-pickup is
 * per warung). Persisted to localStorage; hydrated on the client by
 * <StoreHydration /> so the first render matches the server.
 *
 * A line is one batch with one chosen lauk (`key` = lineKey(batch_id, lauk)), so the same
 * batch can sit on several lines ("2× Nasi Timbel, Ayam goreng" and "1× …, Pepes ikan").
 * Quantities are capped per batch across its lines: the batch portion is what is reserved.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MenuCategory } from "@/lib/contracts";
import { lineKey, type LineKey } from "@/lib/lauk";
import { persistStorage } from "@/lib/pwa/storage";

export type CartMerchant = { id: string; slug: string; name: string };

export type CartItem = {
  /** lineKey(batch_id, lauk); recomputed by the store, so callers may pass any value. */
  key: LineKey;
  batch_id: string;
  menu_id: string;
  menu_name: string;
  category: MenuCategory;
  /** Chosen lauk; null = none (fixed menu, or the buyer picks at the counter). */
  lauk: string | null;
  /** Tonight's lauk still available (for the picker in checkout; kept fresh by patchBatch). */
  lauk_available: string[];
  quantity: number;
  unit_price_idr: number;
  original_price_idr: number;
  discount_pct: number;
  /** Most portions of this batch the cart may hold, across all its lines. */
  max_quantity: number;
  portion_weight_grams: number;
  pickup_end_time: string;
};

export type AddItemResult = "added" | "different_merchant";

/** Hard cap per batch, mirrors CheckoutBody (quantity ≤ 10, ≤ 10 lines). */
export const CART_MAX_QTY_PER_ITEM = 10;
export const CART_MAX_LINES = 10;

/** Fields a live update (SSE, refetch) may change on every line of a batch. */
export type CartBatchPatch = Partial<Omit<CartItem, "key" | "batch_id" | "lauk" | "quantity">>;

type CartState = {
  merchant: CartMerchant | null;
  items: CartItem[];
  /** Adds a line, or merges into the line with the same batch and lauk. */
  addItem: (merchant: CartMerchant, item: CartItem) => AddItemResult;
  replaceCart: (merchant: CartMerchant, item: CartItem) => void;
  setQuantity: (key: LineKey, quantity: number) => void;
  removeItem: (key: LineKey) => void;
  /** Changes a line's lauk; merges into an existing line with that lauk. */
  setLauk: (key: LineKey, lauk: string | null) => void;
  /** Live updates (price/stock/lauk) from SSE or refetch, on every line of the batch; re-clamps quantities. */
  patchBatch: (batchId: string, patch: CartBatchPatch) => void;
  /** Portions of a batch across all its lines. */
  quantityForBatch: (batchId: string) => number;
  clear: () => void;
};

const batchCap = (max: number) => Math.max(1, Math.min(max, CART_MAX_QTY_PER_ITEM));

function withKey(item: CartItem): CartItem {
  return { ...item, key: lineKey(item.batch_id, item.lauk) };
}

/**
 * Clamps every line to 1.., and each batch's lines together to its cap (earlier lines keep
 * their quantity first). Lines left with nothing are dropped.
 */
function clampLines(items: CartItem[]): CartItem[] {
  const used = new Map<string, number>();
  const out: CartItem[] = [];
  for (const item of items) {
    const cap = batchCap(item.max_quantity);
    const room = cap - (used.get(item.batch_id) ?? 0);
    if (room <= 0) continue;
    const q = Number.isFinite(item.quantity) ? Math.round(item.quantity) : 1;
    const quantity = Math.min(room, Math.max(1, q));
    used.set(item.batch_id, (used.get(item.batch_id) ?? 0) + quantity);
    out.push({ ...item, quantity });
  }
  return out;
}

/** Puts `incoming` on the line with its key (adding quantities), or appends it. */
function mergeLine(items: CartItem[], incoming: CartItem): CartItem[] {
  const existing = items.find((i) => i.key === incoming.key);
  if (!existing) return [...items, incoming];
  return items.map((i) => (i.key === incoming.key ? { ...i, ...incoming, quantity: i.quantity + incoming.quantity } : i));
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      merchant: null,
      items: [],

      addItem: (merchant, raw) => {
        const state = get();
        if (state.merchant && state.merchant.id !== merchant.id && state.items.length > 0) {
          return "different_merchant";
        }
        const item = withKey(raw);
        const isNewLine = !state.items.some((i) => i.key === item.key);
        if (isNewLine && state.items.length >= CART_MAX_LINES) return "added";
        set({ merchant, items: clampLines(mergeLine(state.items, item)) });
        return "added";
      },

      replaceCart: (merchant, item) => set({ merchant, items: clampLines([withKey(item)]) }),

      setQuantity: (key, quantity) =>
        set((s) => {
          const target = s.items.find((i) => i.key === key);
          if (!target) return {};
          // A line can grow only into its batch's room left by the other lines.
          const others = s.items.reduce((n, i) => (i.batch_id === target.batch_id && i.key !== key ? n + i.quantity : n), 0);
          const room = Math.max(1, batchCap(target.max_quantity) - others);
          const q = Number.isFinite(quantity) ? Math.round(quantity) : 1;
          const next = Math.min(room, Math.max(1, q));
          return { items: s.items.map((i) => (i.key === key ? { ...i, quantity: next } : i)) };
        }),

      removeItem: (key) =>
        set((s) => {
          const items = s.items.filter((i) => i.key !== key);
          return { items, merchant: items.length ? s.merchant : null };
        }),

      setLauk: (key, lauk) =>
        set((s) => {
          const target = s.items.find((i) => i.key === key);
          if (!target) return {};
          const moved = withKey({ ...target, lauk });
          if (moved.key === key) return {};
          const into = s.items.find((i) => i.key === moved.key);
          const items = into
            ? s.items
                .filter((i) => i.key !== key)
                .map((i) => (i.key === moved.key ? { ...i, quantity: i.quantity + target.quantity } : i))
            : s.items.map((i) => (i.key === key ? moved : i));
          return { items: clampLines(items) };
        }),

      patchBatch: (batchId, patch) =>
        set((s) => ({
          items: clampLines(s.items.map((i) => (i.batch_id === batchId ? { ...i, ...patch } : i))),
        })),

      quantityForBatch: (batchId) => selectCartQuantityFor(batchId)(get()),

      clear: () => set({ merchant: null, items: [] }),
    }),
    {
      name: "ss-cart",
      // v2: lines are keyed by batch + lauk.
      version: 2,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { merchant?: CartMerchant | null; items?: unknown };
        const items = Array.isArray(state.items) ? (state.items as Partial<CartItem>[]) : [];
        if (version < 2) {
          return {
            merchant: state.merchant ?? null,
            items: items
              .filter((i): i is Partial<CartItem> & { batch_id: string } => typeof i?.batch_id === "string")
              .map(
                (i) =>
                  ({
                    // Category was not stored in v1; it only picks "Lauk" vs "Varian" wording,
                    // and v1 lines have no lauk.
                    category: "MAKANAN_BERAT",
                    lauk_available: [],
                    ...i,
                    lauk: null,
                    key: lineKey(i.batch_id, null),
                  }) as CartItem,
              ),
          };
        }
        return { merchant: state.merchant ?? null, items: items as CartItem[] };
      },
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
/** Portions of a batch in the cart, summed over its lines (one per lauk). */
export const selectCartQuantityFor = (batchId: string) => (s: CartData) =>
  s.items.reduce((n, i) => (i.batch_id === batchId ? n + i.quantity : n), 0);
