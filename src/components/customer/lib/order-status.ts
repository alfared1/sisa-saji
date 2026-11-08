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
  PENDING_PAYMENT: { label: "Menunggu Pembayaran", tone: "deal" },
  PAID: { label: "Dibayar", tone: "brand" },
  READY_FOR_PICKUP: { label: "Siap Diambil", tone: "brand" },
  COMPLETED: { label: "Selesai", tone: "success" },
  CANCELLED: { label: "Dibatalkan", tone: "muted" },
  EXPIRED: { label: "Kedaluwarsa", tone: "urgent" },
};

export const PICKUP_TAGS = [
  "Porsi Banyak",
  "Masih Hangat",
  "Pelayanan Ramah",
  "Rasa Enak",
  "Hemat Banget",
  "Pengambilan Cepat",
] as const;

export const RATING_COPY = ["", "Kurang", "Biasa saja", "Lumayan", "Enak!", "Mantap banget!"] as const;
