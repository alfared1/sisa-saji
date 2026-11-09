/**
 * Pure helpers for the two /map scopes (unit-tested in tests/unit/map-scope.test.ts).
 *
 *  - "indonesia": every warung from GET /discover/map-pins/all; live ones as
 *    discount pins, the rest as muted markers; the panel lists hubs per region.
 *  - "nearby": live pins from GET /discover/map-pins (radius), plus the idle
 *    warung inside the same radius as muted markers, so a warung seen on the
 *    national map never disappears when the user zooms into its city.
 */
import { distanceMeters } from "@/lib/campuses";
import { CAMPUSES, EXPANDED_RADIUS_OPTIONS_M, HOME_REGION, type Campus, type CampusRegion } from "@/lib/constants";
import type { MapPin, MerchantSummary, WarungMapPin } from "@/lib/contracts";
import type { IdleMapMarker, SurplusMapMarker } from "@/components/map/types";
import { formatRadius } from "@/stores/location";

/**
 * One hub row. Counts are exactly what tapping the row shows: every warung
 * within `radiusM` of the hub point (the radius the pick switches to).
 */
export type HubSummary = {
  hub: Campus;
  /** Radius the row picks: the stored one, widened until it covers every warung of this hub. */
  radiusM: number;
  warung: number;
  liveWarung: number;
  liveMenus: number;
  portions: number;
};

/** A region header: its own warung (each warung belongs to its nearest hub), counted once. */
export type RegionSummary = {
  region: CampusRegion;
  isHome: boolean;
  warung: number;
  liveMenus: number;
  portions: number;
  hubs: HubSummary[];
};

export type NationalTotals = {
  warung: number;
  /** Distinct cities with warung (IPB Dramaga, Kota Bogor and Cibinong are one: Bogor). */
  cities: number;
  liveWarung: number;
  liveMenus: number;
  portions: number;
};

/**
 * Radius a hub row picks: the stored radius, or the smallest wider option that
 * reaches the hub's farthest warung (the largest option when none does).
 */
export function hubPickRadius(
  hub: { lat: number; lng: number },
  members: readonly { lat: number; lng: number }[],
  currentRadiusM: number,
  options: readonly number[] = EXPANDED_RADIUS_OPTIONS_M,
): number {
  const far = members.reduce((m, p) => Math.max(m, distanceMeters(hub, p)), 0);
  if (far <= currentRadiusM) return currentRadiusM;
  return options.find((o) => o >= far && o >= currentRadiusM) ?? Math.max(currentRadiusM, ...options);
}

/**
 * Hubs with warung, grouped by region in CAMPUSES order (Bogor, the home region,
 * first). A row counts what its pick will show (see HubSummary); the region
 * header counts the region's own warung.
 */
export function summarizeHubs(pins: readonly WarungMapPin[], currentRadiusM: number): RegionSummary[] {
  const members = new Map<string, WarungMapPin[]>();
  for (const p of pins) {
    if (!p.hub_id) continue;
    const list = members.get(p.hub_id);
    if (list) list.push(p);
    else members.set(p.hub_id, [p]);
  }
  const regions: RegionSummary[] = [];
  for (const hub of CAMPUSES) {
    const own = members.get(hub.id);
    if (!own) continue;
    const radiusM = hubPickRadius(hub, own, currentRadiusM);
    const row: HubSummary = { hub, radiusM, warung: 0, liveWarung: 0, liveMenus: 0, portions: 0 };
    for (const p of pins) {
      if (distanceMeters(hub, p) > radiusM) continue;
      row.warung++;
      if (!p.live) continue;
      row.liveWarung++;
      row.liveMenus += p.live_menu_count;
      row.portions += p.total_available_stock;
    }
    let r = regions.find((x) => x.region === hub.region);
    if (!r) {
      r = { region: hub.region, isHome: hub.region === HOME_REGION, warung: 0, liveMenus: 0, portions: 0, hubs: [] };
      regions.push(r);
    }
    r.hubs.push(row);
    for (const p of own) {
      r.warung++;
      if (!p.live) continue;
      r.liveMenus += p.live_menu_count;
      r.portions += p.total_available_stock;
    }
  }
  return regions;
}

const hubById = new Map<string, Campus>(CAMPUSES.map((c) => [c.id, c]));

/** City of a warung's hub ("Bogor" for all three Bogor hubs), if it has one. */
export function hubCity(hubId: string | null): string | undefined {
  return hubId ? hubById.get(hubId)?.city : undefined;
}

export function nationalTotals(pins: readonly WarungMapPin[]): NationalTotals {
  const cities = new Set<string>();
  let liveWarung = 0;
  let liveMenus = 0;
  let portions = 0;
  for (const p of pins) {
    const city = hubCity(p.hub_id);
    if (city) cities.add(city);
    if (!p.live) continue;
    liveWarung++;
    liveMenus += p.live_menu_count;
    portions += p.total_available_stock;
  }
  return { warung: pins.length, cities: cities.size, liveWarung, liveMenus, portions };
}

const n = (v: number) => v.toLocaleString("id-ID");

/** "95 warung di 18 kota" */
export function indonesiaCountText(t: NationalTotals): string {
  return `${n(t.warung)} warung di ${n(t.cities)} kota`;
}

/** "95 warung di 18 kota · 412 porsi live" */
export function indonesiaStatusText(t: NationalTotals): string {
  return `${indonesiaCountText(t)} · ${n(t.portions)} porsi live`;
}

/** "14 warung · 31 menu live", or "· belum ada surplus" when nothing is live. */
export function hubMetaText(s: { warung: number; liveMenus: number }): string {
  return `${n(s.warung)} warung · ${s.liveMenus > 0 ? `${n(s.liveMenus)} menu live` : "belum ada surplus"}`;
}

/** Hub row: "14 warung dalam 5 km · 31 menu live" (the area a tap on the row shows). */
export function hubRowText(s: Pick<HubSummary, "warung" | "liveMenus" | "radiusM">): string {
  const menus = s.liveMenus > 0 ? `${n(s.liveMenus)} menu live` : "belum ada surplus";
  return `${n(s.warung)} warung dalam ${formatRadius(s.radiusM)} · ${menus}`;
}

/**
 * Idle warung inside the search radius (nearby scope): every warung in the
 * radius that the radius pins do not show. The radius pins (kept fresh by SSE)
 * are the authority, so a warung that just sold out turns idle at once instead
 * of vanishing until the next nationwide poll. `liveIds` is null while the
 * radius pins for this area are not loaded yet; then the nationwide flag decides.
 */
export function idlePinsWithin(
  pins: readonly WarungMapPin[],
  center: { lat: number; lng: number },
  radiusM: number,
  liveIds: ReadonlySet<string> | null,
): WarungMapPin[] {
  return pins.filter(
    (p) => (liveIds ? !liveIds.has(p.merchant_id) : !p.live) && distanceMeters(center, p) <= radiusM,
  );
}

export function idleMarkerFromPin(p: WarungMapPin): IdleMapMarker {
  return { id: p.merchant_id, lat: p.lat, lng: p.lng, name: p.merchant_name, area: hubCity(p.hub_id) };
}

export function liveMarkerFromPin(p: WarungMapPin): SurplusMapMarker {
  return {
    id: p.merchant_id,
    lat: p.lat,
    lng: p.lng,
    name: p.merchant_name,
    discount_pct: p.max_discount_pct,
    stock: p.total_available_stock,
    closes_at: p.pickup_end_time,
    is_verified: p.is_verified,
    area: hubCity(p.hub_id),
  };
}

/** Live and idle markers of the nationwide map. */
export function indonesiaMarkers(pins: readonly WarungMapPin[]): {
  live: SurplusMapMarker[];
  idle: IdleMapMarker[];
} {
  return {
    live: pins.filter((p) => p.live).map(liveMarkerFromPin),
    idle: pins.filter((p) => !p.live).map(idleMarkerFromPin),
  };
}

/** MerchantCard data for a live warung picked on the nationwide map. */
export function merchantCardFromWarungPin(p: WarungMapPin) {
  return {
    slug: p.slug,
    name: p.merchant_name,
    category: p.category,
    address: "",
    distance_m: p.distance_m,
    is_verified: p.is_verified,
    rating_avg: p.rating_avg,
    total_reviews: p.total_reviews,
    logo_url: null,
    max_discount_pct: p.max_discount_pct,
    min_price_idr: p.min_price_idr,
    total_available_stock: p.total_available_stock,
    closes_at: p.pickup_end_time,
  };
}

/** What is known about the warung picked on the map (best first). */
export type PreviewSources = {
  /** Nearby list entry (has the menus). */
  merchant: MerchantSummary | null;
  /** Nationwide pin (live or idle). */
  warung: WarungMapPin | null;
  /** Radius pin. */
  pin: MapPin | null;
};

export function previewSlug({ merchant, warung, pin }: PreviewSources): string | null {
  return merchant?.slug ?? warung?.slug ?? pin?.slug ?? null;
}

export function previewName({ merchant, warung, pin }: PreviewSources): string {
  return merchant?.name ?? warung?.merchant_name ?? pin?.merchant_name ?? "Warung";
}

/** True when the picked warung has no live surplus (an idle marker). */
export function previewIsIdle({ merchant, warung, pin }: PreviewSources): boolean {
  return !merchant && !pin && warung !== null && !warung.live;
}
