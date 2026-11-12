/**
 * Quick order (≤ 3 steps: /discover → menu card → "Pesan & Ambil Sendiri" →
 * QRIS). Pure helpers, unit-tested in tests/unit/qo-logic.test.ts.
 */
import type { BatchCard, CheckoutBody, ErrorCode } from "@/lib/contracts";
import { PAY_AT_WARUNG_MAX_PORTIONS } from "@/lib/constants";
import { CART_MAX_QTY_PER_ITEM } from "@/stores/cart";
import { QUICK_ORDER_PARAM } from "./quick-order-param";

export { QUICK_ORDER_PARAM };

/**
 * Highest quantity the stepper allows: 1..min(available, 10), and at most
 * PAY_AT_WARUNG_MAX_PORTIONS on a pilot warung's "bayar di warung" ticket.
 */
export function quickOrderMaxQty(available: number, isPilot = false): number {
  const cap = isPilot ? PAY_AT_WARUNG_MAX_PORTIONS : CART_MAX_QTY_PER_ITEM;
  return Math.max(1, Math.min(Math.floor(available), cap));
}

/** Clamps a stepper value into 1..max. */
export function clampQuickOrderQty(qty: number, available: number, isPilot = false): number {
  return Math.min(Math.max(1, Math.floor(qty)), quickOrderMaxQty(available, isPilot));
}

/** Path of the warung page that reopens the sheet for `batchId` after login. */
export function quickOrderReturnPath(merchantSlug: string, batchId: string): string {
  return `/warung/${encodeURIComponent(merchantSlug)}?${QUICK_ORDER_PARAM}=${encodeURIComponent(batchId)}`;
}

/** /auth/login?next=… for a logged-out "Pesan & Ambil Sendiri". */
export function quickOrderLoginUrl(merchantSlug: string, batchId: string): string {
  return `/auth/login?next=${encodeURIComponent(quickOrderReturnPath(merchantSlug, batchId))}`;
}

/** Checkout body: one batch, QRIS, pickup as soon as possible (no slot). */
export function quickOrderBody(
  batch: Pick<BatchCard, "merchant_id" | "batch_id"> & Partial<Pick<BatchCard, "merchant_is_pilot">>,
  quantity: number,
): CheckoutBody {
  return {
    merchant_id: batch.merchant_id,
    items: [{ batch_id: batch.batch_id, quantity }],
    // Pilot warung are paid at the counter (the server enforces it either way).
    payment_method: batch.merchant_is_pilot ? "BAYAR_DI_WARUNG" : "QRIS",
  };
}

export type QuickOrderError =
  | { kind: "login" }
  | { kind: "stock"; available: number | null; title: string; description?: string }
  | { kind: "closed"; title: string; description: string }
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
    case "NETWORK_ERROR":
      return { kind: "generic", title: "Tidak ada koneksi", description: "Periksa internet lalu coba lagi." };
    default:
      return { kind: "generic", title: message || "Gagal membuat pesanan. Coba lagi." };
  }
}
