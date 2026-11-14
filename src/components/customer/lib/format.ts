/**
 * Small, pure formatting helpers for the customer app (client-safe, unit-tested).
 */
import { WALK_MINUTES_COPY_MAX_M, WALKABLE_DISTANCE_M } from "@/lib/constants";
import { formatClockId } from "@/lib/time";

/** "450 m" under 1 km, "1,2 km" above. `null` → "". */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return "";
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

/** Walking speed ~4.8 km/h → 80 m/min; motorbike in campus traffic ~20 km/h → 330 m/min. */
export function travelMinutes(meters: number | null | undefined, mode: "walk" | "motor" = "walk"): number | null {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return null;
  const perMin = mode === "walk" ? 80 : 330;
  return Math.max(1, Math.round(meters / perMin));
}

/** Where a distance is measured from: the location store's source and label. */
export type DistanceOrigin = { source: "gps" | "campus" | "manual"; label: string };

/**
 * Distance with what it is measured from, in walking terms (the buyer walks to the warung):
 *  - long:  "350 m dari lokasi kamu, bisa jalan kaki" (≤ 500 m),
 *           "750 m dari lokasi kamu · 9 mnt jalan kaki" (≤ 1,5 km),
 *           "2,4 km dari IPB Dramaga, Bogor" (farther);
 *  - short: "350 m · jalan kaki", "750 m · 9 mnt jalan", "2,4 km".
 * The place is "lokasi kamu" only for a GPS fix, "titik pilihanmu" for a picked point, and
 * the campus name for a campus. `null` → "".
 */
export function distanceLine(
  meters: number | null | undefined,
  origin: DistanceOrigin,
  variant: "short" | "long",
): string {
  const d = formatDistance(meters);
  if (!d || meters === null || meters === undefined) return "";
  const walkable = meters <= WALKABLE_DISTANCE_M;
  const walkMinutes = meters <= WALK_MINUTES_COPY_MAX_M ? travelMinutes(meters, "walk") : null;
  if (variant === "short") {
    if (walkable) return `${d} · jalan kaki`;
    return walkMinutes !== null ? `${d} · ${walkMinutes} mnt jalan` : d;
  }
  const place = origin.source === "gps" ? "lokasi kamu" : origin.source === "manual" ? "titik pilihanmu" : origin.label;
  if (walkable) return `${d} dari ${place}, bisa jalan kaki`;
  return walkMinutes !== null ? `${d} dari ${place} · ${walkMinutes} mnt jalan kaki` : `${d} dari ${place}`;
}

/** "4,4" — rating with one decimal, Indonesian comma. */
export function formatRating(rating: number): string {
  return rating.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "20.00–22.30 WIB" */
export function pickupWindowLabel(startIso: string, endIso: string): string {
  return `${formatClockId(startIso)}–${formatClockId(endIso)} WIB`;
}

/** Google Maps walking directions to a coordinate. */
export function mapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

/** wa.me link; accepts +62…, 62…, 08… */
export function whatsappUrl(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Indonesian short date "8 Nov 2026" in WIB. */
export function formatDateId(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

/** "Sab, 8 Nov · 20.45" in WIB. */
export function formatDateTimeId(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  });
  return `${date} · ${formatClockId(d)}`;
}

/** "Nov" / "Des" month label for "2026-11". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("id-ID", { month: "short", timeZone: "UTC" });
}

/** "1,2" style decimal with up to `digits` fraction digits. */
export function formatDecimal(n: number, digits = 1): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: digits });
}

export const BADGE_LABELS: Record<string, string> = {
  SURPLUS_ROOKIE: "Pemula",
  SURPLUS_SAVER: "Penyelamat",
  SURPLUS_HERO: "Juara Pangan",
};

export function badgeLabel(tier: string | null | undefined): string {
  if (!tier) return BADGE_LABELS.SURPLUS_ROOKIE;
  return (
    BADGE_LABELS[tier] ??
    tier
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}
