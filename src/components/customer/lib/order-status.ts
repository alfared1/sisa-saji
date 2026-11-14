/**
 * Order list tabs and status presentation (pure, unit-tested).
 */
import type { OrderDetail, OrderStatus } from "@/lib/contracts";

export type OrderTabKey = "unpaid" | "ready" | "done" | "cancelled";

export const ORDER_TABS: readonly { key: OrderTabKey; label: string; statuses: readonly OrderStatus[] }[] = [
  { key: "unpaid", label: "Belum Dibayar", statuses: ["PENDING_PAYMENT"] },
  { key: "ready", label: "Siap Diambil", statuses: ["PAID", "READY_FOR_PICKUP"] },
  { key: "done", label: "Selesai", statuses: ["COMPLETED"] },
  { key: "cancelled", label: "Dibatalkan", statuses: ["CANCELLED", "EXPIRED"] },
];

export function parseOrderTab(value: string | null | undefined): OrderTabKey | null {
  return ORDER_TABS.some((t) => t.key === value) ? (value as OrderTabKey) : null;
}

export function tabForStatus(status: OrderStatus): OrderTabKey {
  return ORDER_TABS.find((t) => t.statuses.includes(status))?.key ?? "done";
}

/** Splits orders (newest first from the API) into the four tabs. */
export function groupOrdersByTab(orders: OrderDetail[]): Record<OrderTabKey, OrderDetail[]> {
  const out: Record<OrderTabKey, OrderDetail[]> = { unpaid: [], ready: [], done: [], cancelled: [] };
  for (const o of orders) out[tabForStatus(o.status)].push(o);
  return out;
}

/** Default tab: an active ticket first, then an unpaid order, else history. */
export function defaultOrderTab(groups: Record<OrderTabKey, OrderDetail[]>): OrderTabKey {
  if (groups.ready.length) return "ready";
  if (groups.unpaid.length) return "unpaid";
  return "done";
}

export type StatusTone = "deal" | "brand" | "success" | "muted" | "urgent";

export const STATUS_META: Record<OrderStatus, { label: string; tone: StatusTone }> = {
  PENDING_PAYMENT: { label: "Belum Dibayar", tone: "deal" },
  PAID: { label: "Dibayar", tone: "brand" },
  READY_FOR_PICKUP: { label: "Siap Diambil", tone: "brand" },
  COMPLETED: { label: "Selesai", tone: "success" },
  CANCELLED: { label: "Dibatalkan", tone: "muted" },
  EXPIRED: { label: "Kedaluwarsa", tone: "urgent" },
};

export const PICKUP_TAGS = [
  "Lauk sesuai pilihan",
  "Masih Hangat",
  "Pelayanan Ramah",
  "Rasa Enak",
  "Hemat Banget",
  "Pengambilan Cepat",
] as const;

export const RATING_COPY = ["", "Kurang", "Biasa saja", "Lumayan", "Enak!", "Mantap banget!"] as const;

/** Review question about hygiene (optional, 1-5); feeds the warung's "Kebersihan" score. */
export const HYGIENE_QUESTION = "Seberapa bersih tempat dan makanannya?";
export const HYGIENE_SCALE_ENDS = { low: "Kurang bersih", high: "Sangat bersih" } as const;
/** Review question about the portion (optional); feeds "Porsi normal {pct}%". */
export const PORTION_QUESTION = "Porsinya sesuai porsi normal?";
export const PORTION_ANSWERS = [
  { value: true, label: "Ya, kenyang" },
  { value: false, label: "Lebih sedikit dari biasa" },
] as const;

/** Chips for a review's own answers ("Kebersihan 5/5", "Porsi normal" / "Porsi kurang"). */
export function reviewAnswerChips(review: {
  hygiene_rating?: number | null;
  portion_full?: boolean | null;
}): string[] {
  // Optional fields: reviews cached offline before these questions existed lack them.
  const chips: string[] = [];
  if (typeof review.hygiene_rating === "number") chips.push(`Kebersihan ${review.hygiene_rating}/5`);
  if (typeof review.portion_full === "boolean") chips.push(review.portion_full ? "Porsi normal" : "Porsi kurang");
  return chips;
}

/**
 * Which warung a "bayar di warung" ticket is for, from the order detail:
 *  - "pilot": a real warung in the field pilot (is_pilot true);
 *  - "demo": a fictional seed warung while the app runs on demo data;
 *  - "neutral": anything else, including a ticket cached offline before these fields existed.
 */
export function payAtWarungAudience(
  merchant: Pick<OrderDetail["merchant"], "is_pilot" | "is_demo_data">,
): "pilot" | "demo" | "neutral" {
  if (merchant.is_pilot === true) return "pilot";
  if (merchant.is_pilot === false && merchant.is_demo_data === true) return "demo";
  return "neutral";
}

/** One order line in words: "2× Nasi Timbel (Lauk: Ayam goreng)". */
export function orderLineText(item: { quantity: number; menu_name: string; lauk?: string | null }): string {
  return `${item.quantity}× ${item.menu_name}${item.lauk ? ` (Lauk: ${item.lauk})` : ""}`;
}
