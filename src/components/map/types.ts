/**
 * Map data shapes + pure helpers (no Leaflet import, safe for SSR and tests).
 */
import {
  DISCOUNT_COLORS,
  discountBadgeState,
  minutesUntil,
  type DiscountBadgeState,
} from "@/components/common/discount-logic";
import type { MapPin, MerchantSummary } from "@/lib/contracts";
import type { CaptionPlacement } from "./cluster";

export type LatLng = { lat: number; lng: number };

/** Blueprint: pins turn red & pulse under 45 minutes to close (same as useCountdown). */
export const PIN_URGENT_MINUTES = 45;

export const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

export type SurplusMapMarker = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  discount_pct: number;
  stock: number;
  /** ISO pickup_end_time (latest among active batches); null = unknown. */
  closes_at: string | null;
  is_verified?: boolean;
  /** Short place name (hub city) for group captions on the nationwide map. */
  area?: string;
};

export function markerFromPin(pin: MapPin): SurplusMapMarker {
  return {
    id: pin.merchant_id,
    lat: pin.lat,
    lng: pin.lng,
    name: pin.merchant_name,
    discount_pct: pin.max_discount_pct,
    stock: pin.total_available_stock,
    closes_at: pin.pickup_end_time,
    is_verified: pin.is_verified,
  };
}

export function markerFromMerchant(m: MerchantSummary): SurplusMapMarker {
  return {
    id: m.id,
    lat: m.lat,
    lng: m.lng,
    name: m.name,
    discount_pct: m.max_discount_pct,
    stock: m.total_available_stock,
    closes_at: m.closes_at,
    is_verified: m.is_verified,
  };
}

export type PinState = "normal" | "deal" | "hot" | "urgent" | "closed";

/** From these discounts a pin turns "hot" / "deal" (the same 50 % as the "Diskon Tertinggi" row). */
export const PIN_HOT_DISCOUNT_PCT = 50;
export const PIN_DEAL_DISCOUNT_PCT = 30;

/** Urgency colour of a pin: closed (sold out / past close) → urgent (< 45 min) → by discount. */
export function pinState(marker: Pick<SurplusMapMarker, "discount_pct" | "stock" | "closes_at">, nowMs: number | null): PinState {
  const closeMs = marker.closes_at ? Date.parse(marker.closes_at) : NaN;
  if (marker.stock <= 0) return "closed";
  if (nowMs !== null && Number.isFinite(closeMs)) {
    const minutes = (closeMs - nowMs) / 60_000;
    if (minutes <= 0) return "closed";
    if (minutes < PIN_URGENT_MINUTES) return "urgent";
  }
  if (marker.discount_pct >= PIN_HOT_DISCOUNT_PCT) return "hot";
  if (marker.discount_pct >= PIN_DEAL_DISCOUNT_PCT) return "deal";
  return "normal";
}

export const PIN_COLOR_VAR: Record<PinState, string> = {
  normal: "var(--primary)",
  deal: "var(--deal)",
  hot: "var(--urgent)",
  urgent: "var(--urgent)",
  closed: "var(--muted-foreground)",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/**
 * Discount badge of an open pin — the same "Hemat N%" / "Diskon Kilat N%"
 * rule as <DiscountBadge /> (Diskon Kilat at ≥ 70 % or < 45 min to close; pulses
 * only < 45 min). Null for closed / sold-out pins and pins without discount.
 */
export function pinBadge(
  marker: Pick<SurplusMapMarker, "discount_pct" | "stock" | "closes_at">,
  nowMs: number | null,
): DiscountBadgeState | null {
  if (pinState(marker, nowMs) === "closed" || marker.discount_pct <= 0) return null;
  return discountBadgeState(marker.discount_pct, minutesUntil(marker.closes_at, nowMs));
}

/** Leaflet DivIcon class names: state + hemat/flash (Diskon Kilat) variant + pulse. */
export function pinClassName(state: PinState, badge: DiscountBadgeState | null, selected: boolean): string {
  return [
    "ss-pin",
    `ss-pin--${state}`,
    badge && `ss-pin--${badge.variant}`,
    badge?.pulse && "ss-pin--pulse",
    selected && "ss-pin--selected",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * HTML for the Leaflet DivIcon: discount bubble + "Sisa 3". With `badge`
 * (see pinBadge) the bubble reads "Hemat 50%" / "Kilat 70%" in the badge
 * colours; without it, the legacy "-60%" coloured by urgency state.
 */
export function pinHtml(marker: SurplusMapMarker, state: PinState, badge: DiscountBadgeState | null = null): string {
  const pct = Math.round(marker.discount_pct);
  const stockLabel = state === "closed" ? (marker.stock <= 0 ? "Habis" : "Tutup") : `Sisa ${marker.stock}`;
  const color = badge ? DISCOUNT_COLORS[badge.variant] : PIN_COLOR_VAR[state];
  const pctLabel = badge ? badge.shortLabel : pct > 0 ? `-${pct}%` : "Baru";
  return (
    `<div class="ss-pin__wrap" style="--pin-color:${color}" title="${escapeHtml(marker.name)}">` +
    `<div class="ss-pin__body">` +
    `<span class="ss-pin__pct">${pctLabel}</span>` +
    `<span class="ss-pin__stock">${stockLabel}</span>` +
    `</div><div class="ss-pin__tail"></div></div>`
  );
}

/** A warung without live surplus right now: a small muted marker. */
export type IdleMapMarker = { id: string; lat: number; lng: number; name: string; area?: string };

/** Accessible name / tooltip of a live pin. */
export function pinLabel(marker: SurplusMapMarker, badge: DiscountBadgeState | null): string {
  return `${marker.name}: ${badge ? badge.label : `diskon ${Math.round(marker.discount_pct)}%`}, sisa ${marker.stock} porsi`;
}

export function idleLabel(name: string): string {
  return `${name}: belum ada surplus saat ini`;
}

export function idleClassName(selected: boolean): string {
  return selected ? "ss-idle ss-idle--selected" : "ss-idle";
}

export const IDLE_HTML = '<div class="ss-idle__wrap"><span class="ss-idle__dot"></span></div>';

/** "Bogor +2: 28 warung, 26 ada surplus. Perbesar peta ke sini" (no "porsi": e2e tells pins apart by it). */
export function groupLabel(count: number, live: number, caption?: string): string {
  const status = live === 0 ? "belum ada surplus" : live === count ? "semua ada surplus" : `${live} ada surplus`;
  return `${caption ? `${caption}: ` : ""}${count} warung, ${status}. Perbesar peta ke sini`;
}

/** Live groups get a solid green ring, all-idle groups a dashed grey one (shape, not only colour). */
export function groupClassName(live: number): string {
  return live > 0 ? "ss-group ss-group--live" : "ss-group ss-group--idle";
}

export type GroupCaptionHtml = { text: string; placement: CaptionPlacement };

/** Count bubble, with the area caption (aria-hidden: the marker label says it) on a free side. */
export function groupHtml(count: number, sizePx: number, caption?: GroupCaptionHtml | null): string {
  const cap = caption
    ? `<span class="ss-group__caption ss-group__caption--${caption.placement}" aria-hidden="true">${escapeHtml(caption.text)}</span>`
    : "";
  return (
    `<div class="ss-group__wrap" data-count="${count}" style="--size:${sizePx}px">` +
    `<span class="ss-group__count">${count}</span>${cap}</div>`
  );
}

/** Zoom level that roughly fits a radius circle on a phone-sized map. */
export function zoomForRadius(radiusM: number): number {
  if (radiusM <= 1000) return 15;
  if (radiusM <= 2000) return 14;
  if (radiusM <= 5000) return 13;
  return 12;
}
