/**
 * Quick order (≤ 3 steps: /discover → menu card → "Kunci Porsi Sekarang" →
 * QRIS, or a cash ticket). Pure helpers, unit-tested in tests/unit/qo-logic.test.ts.
 */
import type { BatchCard, CheckoutBody, ErrorCode } from "@/lib/contracts";
import { PAY_AT_WARUNG_MAX_PORTIONS } from "@/lib/constants";
import { CART_MAX_QTY_PER_ITEM } from "@/stores/cart";
import { laukUnavailable } from "../lib/checkout-logic";
import { QUICK_ORDER_PARAM } from "./quick-order-param";

export { QUICK_ORDER_PARAM };

/** The sheet's two payment choices ("QRIS Instan", "Tunai di warung"). */
export type QuickPayMethod = "QRIS" | "BAYAR_DI_WARUNG";

/**
 * Highest quantity the stepper allows: 1..min(available, 10), and at most
 * PAY_AT_WARUNG_MAX_PORTIONS on a cash ("bayar di warung") ticket, at any warung.
 */
export function quickOrderMaxQty(available: number, cash = false): number {
  const cap = cash ? PAY_AT_WARUNG_MAX_PORTIONS : CART_MAX_QTY_PER_ITEM;
  return Math.max(1, Math.min(Math.floor(available), cap));
}

/** Clamps a stepper value into 1..max. */
export function clampQuickOrderQty(qty: number, available: number, cash = false): number {
  return Math.min(Math.max(1, Math.floor(qty)), quickOrderMaxQty(available, cash));
}

/** True when the order becomes a cash ticket: chosen, or forced by a pilot warung. */
export function quickOrderIsCash(batch: Partial<Pick<BatchCard, "merchant_is_pilot">>, method: QuickPayMethod): boolean {
  return Boolean(batch.merchant_is_pilot) || method === "BAYAR_DI_WARUNG";
}

/** Path of the warung page that reopens the sheet for `batchId` after login. */
export function quickOrderReturnPath(merchantSlug: string, batchId: string): string {
  return `/warung/${encodeURIComponent(merchantSlug)}?${QUICK_ORDER_PARAM}=${encodeURIComponent(batchId)}`;
}

/** /auth/login?next=… for a logged-out "Kunci Porsi Sekarang". */
export function quickOrderLoginUrl(merchantSlug: string, batchId: string): string {
  return `/auth/login?next=${encodeURIComponent(quickOrderReturnPath(merchantSlug, batchId))}`;
}

/**
 * Checkout body: one batch, pickup as soon as possible (no slot), the chosen payment
 * (QRIS by default; pilot warung are always paid at the counter, the server enforces it
 * either way) and the chosen lauk (omitted when there is none: the buyer picks at the counter).
 */
export function quickOrderBody(
  batch: Pick<BatchCard, "merchant_id" | "batch_id"> & Partial<Pick<BatchCard, "merchant_is_pilot">>,
  quantity: number,
  opts: { method?: QuickPayMethod; lauk?: string | null } = {},
): CheckoutBody {
  const method = opts.method ?? "QRIS";
  return {
    merchant_id: batch.merchant_id,
    items: [{ batch_id: batch.batch_id, quantity, ...(opts.lauk ? { lauk: opts.lauk } : {}) }],
    payment_method: quickOrderIsCash(batch, method) ? "BAYAR_DI_WARUNG" : "QRIS",
  };
}

export type QuickOrderError =
  | { kind: "login" }
  | { kind: "stock"; available: number | null; title: string; description?: string }
  | { kind: "closed"; title: string; description: string }
  | { kind: "lauk"; lauk_available: string[]; title: string; description: string }
  | { kind: "generic"; title: string; description?: string };

/** Maps a checkout API error to the sheet's reaction + Indonesian copy. */
export function quickOrderError(
  code: ErrorCode | "NETWORK_ERROR",
  message: string,
  details: unknown,
  menuName: string,
): QuickOrderError {
  switch (code) {
    case "UNAUTHENTICATED":
      return { kind: "login" };
    case "OUT_OF_STOCK": {
      const d = (details ?? {}) as { available_stock?: unknown };
      const available = typeof d.available_stock === "number" ? d.available_stock : null;
      if (available !== null && available > 0) {
        return {
          kind: "stock",
          available,
          title: `Stok ${menuName} tinggal ${available} porsi`,
          description: "Jumlah sudah disesuaikan. Tekan pesan lagi untuk lanjut.",
        };
      }
      return {
        kind: "stock",
        available,
        title: `Yah, ${menuName} sudah habis`,
        description: "Porsi terakhir baru saja diselamatkan pembeli lain. Coba menu lain di sekitarmu.",
      };
    }
    case "BATCH_CLOSED":
      return {
        kind: "closed",
        title: `${menuName} sudah tutup`,
        description: "Jam ambil menu ini sudah lewat. Pilih menu lain yang masih buka.",
      };
    case "VALIDATION_ERROR": {
      // The chosen lauk ran out meanwhile: keep the sheet open with tonight's remaining lauk.
      const gone = laukUnavailable(code, details)[0];
      if (gone) {
        return {
          kind: "lauk",
          lauk_available: gone.lauk_available,
          title: message || `Lauk ${gone.lauk} sudah habis. Pilih lauk lain, ya.`,
          description:
            gone.lauk_available.length > 0 ? "Pilihan lauk sudah diperbarui." : "Lauk menu ini sudah habis semua.",
        };
      }
      return { kind: "generic", title: message || "Gagal membuat pesanan. Coba lagi." };
    }
    case "NETWORK_ERROR":
      return { kind: "generic", title: "Tidak ada koneksi", description: "Periksa internet lalu coba lagi." };
    default:
      return { kind: "generic", title: message || "Gagal membuat pesanan. Coba lagi." };
  }
}
