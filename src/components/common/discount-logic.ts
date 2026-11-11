/**
 * Discount badge rules (docs/ARCHITECTURE.md, Konvensi UI): pure, unit-tested, shared by
 * <DiscountBadge />, the map pins and every card that shows a discount.
 *
 *  - "Hemat N%"         emerald, the normal case.
 *  - "Diskon Kilat N%"  amber/orange when the discount is ≥ 70 % OR the batch
 *                       closes in < 45 minutes; it pulses only under 45 minutes.
 *
 * Colours (WCAG): the spec hues #10B981 / #F97316 only reach 2,5:1 / 2,8:1
 * against white text, which fails AA even for large text (3:1). The badge fill
 * therefore uses the 700 shades of the same hues — emerald #047857 (5,48:1)
 * and orange #C2410C (5,18:1) — which pass AA for normal-size text (4,5:1), so
 * the 11–14 px badge labels stay readable. The spec hues stay visible as the
 * badge ring and the pulse glow. See tests/unit/pol-ui-logic.test.ts.
 */

export const FLASH_RESCUE_MIN_PCT = 70;
/** Same threshold as the countdown / map pins (blueprint: < 45 minutes before closing). */
export const FLASH_RESCUE_URGENT_MINUTES = 45;

export const DISCOUNT_COLORS = {
  /** Hemat: emerald (accent: ring, glow). */
  hematAccent: "#10B981",
  /** Fill behind white text — emerald-700, 5,48:1. */
  hemat: "#047857",
  /** Diskon Kilat: amber/orange (accent: ring, pulse). */
  flashAccent: "#F97316",
  /** Fill behind white text — orange-700, 5,18:1. */
  flash: "#C2410C",
} as const;

export type DiscountVariant = "hemat" | "flash";

export type DiscountBadgeState = {
  variant: DiscountVariant;
  /** Pulses only while the batch closes within 45 minutes. */
  pulse: boolean;
  pct: number;
  /** "Hemat 50%" / "Diskon Kilat 70%". */
  label: string;
  /** Short label for tight spots (map pins): "Hemat 50%" / "Flash 70%". */
  shortLabel: string;
};

/** Minutes until `endIso` (null when unknown / no clock yet). */
export function minutesUntil(endIso: string | null | undefined, nowMs: number | null): number | null {
  if (!endIso || nowMs === null) return null;
  const end = Date.parse(endIso);
  if (!Number.isFinite(end)) return null;
  return (end - nowMs) / 60_000;
}

export function isClosingSoon(minutesToClose: number | null | undefined): boolean {
  return minutesToClose !== null && minutesToClose !== undefined && minutesToClose > 0 && minutesToClose < FLASH_RESCUE_URGENT_MINUTES;
}

export function discountBadgeState(pct: number, minutesToClose: number | null = null): DiscountBadgeState {
  const p = Math.max(0, Math.round(pct));
  const closingSoon = isClosingSoon(minutesToClose);
  const flash = p >= FLASH_RESCUE_MIN_PCT || closingSoon;
  return {
    variant: flash ? "flash" : "hemat",
    pulse: closingSoon,
    pct: p,
    label: flash ? `Diskon Kilat ${p}%` : `Hemat ${p}%`,
    shortLabel: flash ? `Flash ${p}%` : `Hemat ${p}%`,
  };
}

/** WCAG 2.x relative luminance of "#RRGGBB". */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const [r, g, b] = m.slice(1).map((h) => {
    const v = parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two "#RRGGBB" colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
