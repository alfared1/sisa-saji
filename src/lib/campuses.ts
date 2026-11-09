/**
 * Campus hubs: grouping for pickers and nearest-hub lookup (seed, demo top-up,
 * db:verify). Pure functions, safe on client and server.
 */
import { CAMPUSES, HOME_REGION, type Campus, type CampusId, type CampusRegion } from "./constants";

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function campusById(id: CampusId): Campus {
  return CAMPUSES.find((c) => c.id === id)!;
}

/** Hub names used before a rename, still stored in older profiles and devices. */
const LEGACY_CAMPUS_NAMES: Readonly<Record<string, CampusId>> = {
  "IPB Bogor": "ipb",
};

/** Hub id for a stored campus name (`users.campus_or_area`), current or legacy. */
export function campusIdByName(name: string | null | undefined): CampusId | null {
  if (!name) return null;
  return CAMPUSES.find((c) => c.name === name)?.id ?? LEGACY_CAMPUS_NAMES[name] ?? null;
}

/**
 * Closest campus hub to a point, or null when every hub is farther than
 * `maxDistanceM` (e.g. a warung outside the covered areas).
 */
export function nearestCampus(
  point: { lat: number; lng: number },
  maxDistanceM = Number.POSITIVE_INFINITY,
): { campus: Campus; distanceM: number } | null {
  let best: { campus: Campus; distanceM: number } | null = null;
  for (const campus of CAMPUSES) {
    const d = distanceMeters(point, campus);
    if (!best || d < best.distanceM) best = { campus, distanceM: d };
  }
  return best && best.distanceM <= maxDistanceM ? best : null;
}

/** Local time zone label (WIB / WITA / WIT) of the hub nearest to a point; surplus hours are local time. */
export function localTimeZone(point: { lat: number; lng: number }): Campus["tz"] {
  return nearestCampus(point)?.campus.tz ?? "WIB";
}

export function isHomeRegion(region: string): boolean {
  return region === HOME_REGION;
}

export interface CampusGroup {
  region: CampusRegion;
  campuses: Campus[];
}

/** Campuses grouped by region, in CAMPUSES order (home region first). */
export function campusesByRegion(list: readonly Campus[] = CAMPUSES): CampusGroup[] {
  const groups: CampusGroup[] = [];
  for (const c of list) {
    const g = groups.find((x) => x.region === c.region);
    if (g) g.campuses.push(c);
    else groups.push({ region: c.region, campuses: [c] });
  }
  return groups;
}

/** Case-insensitive filter on campus name and region (for the picker search box). */
export function filterCampuses(query: string, list: readonly Campus[] = CAMPUSES): Campus[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((c) => `${c.name} ${c.region}`.toLowerCase().includes(q));
}
