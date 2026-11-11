/**
 * Pure merchant-app helpers (no React, no DOM) — unit-tested in
 * tests/unit/fem-merchant-logic.test.ts.
 */
import type { InsightsResponse, MerchantBatchView } from "@/lib/contracts";
import { PICKUP_CODE_LENGTH, PICKUP_CODE_PREFIX, PRICE_ROUNDING_IDR } from "@/lib/constants";
import { MINUTE_MS, atWib, formatClockId, wibDate, wibTime } from "@/lib/time";

/* ------------------------------------------------------------------ */
/* Publish window                                                      */
/* ------------------------------------------------------------------ */

/** Server rules (services/merchant/surplus.ts): end > now + 10 min and ≤ now + 12 h. */
export const PUBLISH_MIN_LEAD_MINUTES = 10;
export const PUBLISH_MAX_WINDOW_HOURS = 12;
/** Client safety margin on top of the server minimum (request latency, slow taps). */
const LEAD_MARGIN_MINUTES = 2;
export const QUICK_WINDOW_MINUTES = [60, 90, 120] as const;
export const DEFAULT_WINDOW_MINUTES = 120;

/** Rounds a timestamp up to the next 5-minute mark (nicer clock labels). */
export function ceilTo5Minutes(ms: number): number {
  const step = 5 * MINUTE_MS;
  return Math.ceil(ms / step) * step;
}

export type WindowCheck = { ok: true } | { ok: false; reason: "too_soon" | "too_far"; message: string };

export function checkPickupEnd(endMs: number, nowMs: number): WindowCheck {
  if (!Number.isFinite(endMs)) return { ok: false, reason: "too_soon", message: "Pilih jam batas ambil" };
  if (endMs <= nowMs + (PUBLISH_MIN_LEAD_MINUTES + LEAD_MARGIN_MINUTES) * MINUTE_MS) {
    return { ok: false, reason: "too_soon", message: `Batas ambil minimal ${PUBLISH_MIN_LEAD_MINUTES + LEAD_MARGIN_MINUTES} menit dari sekarang` };
  }
  if (endMs > nowMs + PUBLISH_MAX_WINDOW_HOURS * 60 * MINUTE_MS) {
    return { ok: false, reason: "too_far", message: `Batas ambil maksimal ${PUBLISH_MAX_WINDOW_HOURS} jam dari sekarang` };
  }
  return { ok: true };
}

/** Today's (WIB) closing time as epoch ms, or null for a malformed "HH:MM". */
export function closingTimeToday(closeHhmm: string, nowMs: number): number | null {
  if (!/^\d{2}:\d{2}/.test(closeHhmm)) return null;
  const t = atWib(wibDate(new Date(nowMs)), closeHhmm).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Default pickup end: the warung's closing time today when it is a valid window
 * (more than ~10 min and at most 12 h ahead), otherwise now + 2 h (rounded to 5 min).
 */
export function defaultPickupEnd(closeHhmm: string | null | undefined, nowMs: number): { endMs: number; source: "closing" | "relative" } {
  const close = closeHhmm ? closingTimeToday(closeHhmm, nowMs) : null;
  if (close !== null && checkPickupEnd(close, nowMs).ok && close - nowMs >= 30 * MINUTE_MS) {
    return { endMs: close, source: "closing" };
  }
  return { endMs: ceilTo5Minutes(nowMs + DEFAULT_WINDOW_MINUTES * MINUTE_MS), source: "relative" };
}

/** "HH:MM" (WIB) typed into a time input → the next occurrence after now (today, else tomorrow). */
export function endFromClock(hhmm: string, nowMs: number): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const today = atWib(wibDate(new Date(nowMs)), hhmm).getTime();
  return today > nowMs ? today : today + 24 * 60 * MINUTE_MS;
}

/** epoch ms → "HH:MM" in WIB for <input type="time">. */
export function clockValue(ms: number): string {
  return wibTime(new Date(ms));
}

/** "2j 15m" (same style as the app's countdowns) / "2 jam" / "45 menit" duration label. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}j ${r}m` : `${h} jam`;
}

/* ------------------------------------------------------------------ */
/* Steppers & prices                                                   */
/* ------------------------------------------------------------------ */

export const STOCK_MIN = 1;
export const STOCK_MAX = 500;

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Parse a free-typed number ("1.500", "Rp 12.000", "12") → integer, or null when empty. */
export function parseIntLoose(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

export const SUGGESTED_FLOOR_RATIO = 0.3;

/** Suggested minimum recovery price: 30 % of the normal price, rounded up to Rp 500 (≥ Rp 500). */
export function suggestMinPrice(originalPriceIdr: number): number {
  if (!Number.isFinite(originalPriceIdr) || originalPriceIdr <= 0) return 0;
  const raw = Math.ceil((originalPriceIdr * SUGGESTED_FLOOR_RATIO) / PRICE_ROUNDING_IDR) * PRICE_ROUNDING_IDR;
  return Math.min(originalPriceIdr, Math.max(500, raw));
}

/** Mirror of the server's priceForDiscount: Rp 500 steps (rounded up), clamped to [floor, original]. */
export function priceForDiscount(originalPriceIdr: number, minRecoveryPriceIdr: number, discountPct: number) {
  const rounded = Math.ceil((originalPriceIdr * (100 - discountPct)) / (100 * PRICE_ROUNDING_IDR)) * PRICE_ROUNDING_IDR;
  const price = Math.min(originalPriceIdr, Math.max(minRecoveryPriceIdr, rounded));
  return {
    sellingPriceIdr: price,
    discountPct: originalPriceIdr > 0 ? Math.round((1 - price / originalPriceIdr) * 100) : 0,
    floorApplied: price > rounded,
  };
}

/** Largest whole discount % that still respects the floor price (≤ 90). */
export function maxDiscountForFloor(originalPriceIdr: number, minRecoveryPriceIdr: number): number {
  if (originalPriceIdr <= 0) return 0;
  const pct = Math.floor((1 - minRecoveryPriceIdr / originalPriceIdr) * 100);
  return clampInt(pct, 0, 90);
}

/* ------------------------------------------------------------------ */
/* Pickup codes                                                        */
/* ------------------------------------------------------------------ */

export type ParsedPickup = { kind: "code"; code: string } | { kind: "token"; value: string };

const CODE_RE = new RegExp(`^(?:SJ-?)?(\\d{${PICKUP_CODE_LENGTH}})$`, "i");

/**
 * Normalises what the cashier typed or the camera read:
 * "SJ-4829" / "sj 4829" / "4829" → code "4829"; a QR token (orderId.signature) or a
 * URL carrying one (…?t=…) → token; anything else → null.
 */
export function parsePickupCode(raw: string | null | undefined): ParsedPickup | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const m = CODE_RE.exec(v.replace(/[\s]/g, ""));
  if (m) return { kind: "code", code: m[1] };
  let candidate = v;
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      candidate = u.searchParams.get("t") ?? u.searchParams.get("token") ?? u.searchParams.get("code") ?? "";
      if (!candidate) return null;
      const inner = CODE_RE.exec(candidate.replace(/\s/g, ""));
      if (inner) return { kind: "code", code: inner[1] };
    } catch {
      return null;
    }
  }
  if (/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{16,}$/i.test(candidate)) return { kind: "token", value: candidate };
  return null;
}

/** Keeps only the digits of a typed / pasted PIN ("SJ-48 29" → "4829"), max 4. */
export function sanitizePinInput(raw: string): string {
  return raw.replace(/^\s*SJ-?/i, "").replace(/\D/g, "").slice(0, PICKUP_CODE_LENGTH);
}

export function formatPickupCode(code: string): string {
  return `${PICKUP_CODE_PREFIX}${code}`;
}

/** The string sent to lookup-pickup / verify-pickup. */
export function pickupPayload(p: ParsedPickup): string {
  return p.kind === "code" ? p.code : p.value;
}

/* ------------------------------------------------------------------ */
/* Batches & AI                                                        */
/* ------------------------------------------------------------------ */

/** "LightGBM" for the trained model (lgbm-*), "Heuristik" for the cold-start rule model. */
export function modelLabel(version: string | null | undefined): "LightGBM" | "Heuristik" {
  return version && /lgbm|lightgbm/i.test(version) ? "LightGBM" : "Heuristik";
}

/** Stock bar segments as % of the initial stock (sold | reserved | available). */
export function stockSegments(b: Pick<MerchantBatchView, "initial_stock" | "sold" | "reserved_stock" | "available_stock">) {
  const total = Math.max(1, b.initial_stock, b.sold + b.reserved_stock + b.available_stock);
  const pct = (n: number) => Math.max(0, Math.min(100, (n / total) * 100));
  return { sold: pct(b.sold), reserved: pct(b.reserved_stock), available: pct(b.available_stock), total };
}

/**
 * Price-curve labels (publisher "Kurva harga otomatis"). The schedule has one
 * step per 30 minutes, so an early publish draws 15-24 columns, each narrower
 * than a "50%" or "14.30" label. At most CURVE_MAX_LABELS labels per row are
 * drawn, at least `curveLabelStride` columns apart; every step keeps its
 * screen-reader line.
 */
export const CURVE_MAX_LABELS = 6;

export function curveLabelStride(count: number): number {
  return Math.max(1, Math.ceil(count / CURVE_MAX_LABELS));
}

/**
 * Columns that show their discount: the first and the last step, then the
 * steps where the discount changes (latest first: the Flash Rescue end of the
 * curve), skipping any too close to one already shown. A run of equal
 * discounts needs no repeat, the bars have the same height.
 */
export function curvePctLabelIndexes(discounts: readonly number[]): Set<number> {
  const n = discounts.length;
  const stride = curveLabelStride(n);
  const changes: number[] = [];
  for (let i = n - 1; i > 0; i--) if (discounts[i] !== discounts[i - 1]) changes.push(i);
  const shown: number[] = [];
  for (const i of [0, n - 1, ...changes]) {
    if (i >= 0 && i < n && shown.every((j) => Math.abs(i - j) >= stride)) shown.push(i);
  }
  return new Set(shown);
}

/**
 * Columns that show their clock time: "Kini" (index 0), then every stride-th
 * step counted back from the closing time (the chart's last column, one step
 * after the last bar). A short schedule (stride 1) labels every bar; a long
 * one leaves the last bar unlabelled, since its time would touch the closing
 * time next to it.
 */
export function curveTimeLabelIndexes(count: number): Set<number> {
  const stride = curveLabelStride(count);
  const shown = new Set<number>(count > 0 ? [0] : []);
  for (let i = count - stride; i >= stride; i -= stride) shown.add(i);
  return shown;
}

export function escalationLabel(next: MerchantBatchView["next_escalation"]): string | null {
  if (!next) return null;
  return `Naik ke ${Math.round(next.discount_pct)}% pukul ${formatClockId(next.at)}`;
}

/** Applies a stock delta to a batch view (optimistic update), mirroring the server's status rules. */
export function applyStockDelta(b: MerchantBatchView, delta: number): MerchantBatchView {
  const available = Math.max(0, Math.min(STOCK_MAX, b.available_stock + delta));
  const initial = Math.max(b.initial_stock, available + b.reserved_stock + b.sold);
  let status = b.status;
  if (status === "ACTIVE" && available === 0 && b.reserved_stock === 0) status = "SOLD_OUT";
  else if (status === "SOLD_OUT" && available > 0) status = "ACTIVE";
  return { ...b, available_stock: available, initial_stock: initial, status };
}

export function roundPortions(n: number): number {
  return Math.max(0, Math.round(n));
}

export function percent(p: number): string {
  return `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

export const HEATMAP_LEVELS = 5;
/** Monday-first column order used in the UI (0 = Minggu in the API). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Value → intensity level 0..4, scaled over the observed [min, max] range so
 * close values still separate (0 only for no surplus).
 */
export function heatLevel(value: number, max: number, min = 0): number {
  if (!(value > 0) || !(max > 0)) return 0;
  const lo = Math.min(min, max);
  if (max - lo <= 0) return HEATMAP_LEVELS - 1;
  const t = Math.max(0, Math.min(1, (value - lo) / (max - lo)));
  return Math.min(HEATMAP_LEVELS - 1, 1 + Math.floor(t * (HEATMAP_LEVELS - 1 - 1e-9)));
}

export type HeatmapRow = {
  menu_id: string;
  menu_name: string;
  /** Indexed by day_of_week (0 = Minggu). */
  values: (number | null)[];
  leftovers: (number | null)[];
  total: number;
};

export function buildHeatmap(cells: InsightsResponse["heatmap"]): { rows: HeatmapRow[]; max: number; min: number; peak: { day: number; menu: string; value: number } | null } {
  const byMenu = new Map<string, HeatmapRow>();
  let max = 0;
  let min = Number.POSITIVE_INFINITY;
  let peak: { day: number; menu: string; value: number } | null = null;
  for (const c of cells) {
    let row = byMenu.get(c.menu_id);
    if (!row) {
      row = { menu_id: c.menu_id, menu_name: c.menu_name, values: Array(7).fill(null), leftovers: Array(7).fill(null), total: 0 };
      byMenu.set(c.menu_id, row);
    }
    if (c.day_of_week < 0 || c.day_of_week > 6) continue;
    row.values[c.day_of_week] = c.avg_surplus_portions;
    row.leftovers[c.day_of_week] = c.avg_leftover_portions;
    row.total += c.avg_surplus_portions;
    if (c.avg_surplus_portions > max) max = c.avg_surplus_portions;
    if (c.avg_surplus_portions > 0 && c.avg_surplus_portions < min) min = c.avg_surplus_portions;
    if (!peak || c.avg_surplus_portions > peak.value) peak = { day: c.day_of_week, menu: c.menu_name, value: c.avg_surplus_portions };
  }
  const rows = [...byMenu.values()].sort((a, b) => b.total - a.total);
  return { rows, max, min: Number.isFinite(min) ? min : 0, peak };
}

/* ------------------------------------------------------------------ */
/* Charts & misc                                                       */
/* ------------------------------------------------------------------ */

/** "Nice" axis max ≥ value (1, 2, 2.5, 5, 10 × 10^n). */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= value) return m * base;
  return 10 * base;
}

/** "Rp 2,5 jt" / "Rp 120 rb" compact money for chart axes. */
export function formatIdrCompact(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000).toLocaleString("id-ID")} rb`;
  return `Rp ${Math.round(n)}`;
}

/** Removes "" / undefined / null string fields (optional form inputs left blank). */
export function stripEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    (out as Record<string, unknown>)[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

/** "+6281234567890" / "081234…" typed with spaces or dashes → digits and leading +. */
export function sanitizePhone(raw: string): string {
  const t = raw.replace(/[^\d+]/g, "");
  return t.startsWith("+") ? `+${t.slice(1).replace(/\+/g, "")}` : t.replace(/\+/g, "");
}

/** WIB "YYYY-MM-DD" n days before `nowMs`. */
export function wibDateDaysAgo(nowMs: number, days: number): string {
  return wibDate(new Date(nowMs - days * 24 * 60 * MINUTE_MS));
}
