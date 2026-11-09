/**
 * Marker grouping for the nationwide map, without a clustering library.
 *
 * Points are projected to Web Mercator pixels at the current zoom (the same
 * 256 px tiles Leaflet uses) and merged level by level (see clusterPoints); a
 * grid of footprint-sized cells keeps neighbour lookups cheap (2,000 points
 * stay fast). "Overlap" depends on what is drawn: below PIN_FOOTPRINT_ZOOM
 * mostly count bubbles (a circle about one bubble across; bubbles are smaller
 * on the whole-country view, see groupSizePx), from there discount pins, which
 * are wide and short (PIN_FOOTPRINT). At CLUSTER_MAX_ZOOM and
 * above nothing is grouped, so every warung shows as its own marker once the
 * user zooms in. Pure and deterministic (unit-tested).
 */

export type ClusterPoint = {
  id: string;
  lat: number;
  lng: number;
  live: boolean;
  /** Short place name (the hub's city), used to caption a group. */
  area?: string;
};

export type LatLngBoundsTuple = [[number, number], [number, number]];

export type MarkerGroup = {
  /** Stable key: "group:" + the seed point's id. */
  id: string;
  lat: number;
  lng: number;
  points: ClusterPoint[];
  /** Points with live surplus. */
  live: number;
  /** Distinct member areas, most members first (ties: first seen). */
  areas: string[];
  /** [[south, west], [north, east]] of the members, for zooming in on tap. */
  bounds: LatLngBoundsTuple;
};

export type ClusterItem = { kind: "single"; point: ClusterPoint } | { kind: "group"; group: MarkerGroup };

/** Below this zoom (the whole country, even on a 390 px phone) bubbles are compact. */
export const COUNTRY_ZOOM = 5;
/** From this zoom groups split into discount pins, so overlap is judged on a pin's footprint. */
export const PIN_FOOTPRINT_ZOOM = 12;
/** A "Hemat 50% · Sisa 15" pin is ~120 px wide and ~40 px tall (globals.css .ss-pin). */
export const PIN_FOOTPRINT = { x: 120, y: 44 } as const;
/** From this zoom every warung is its own marker (street level; the 2 km radius view is ~14). */
export const CLUSTER_MAX_ZOOM = 17;

const TILE = 256;
const MAX_LAT = 85.0511287798;

/** Web Mercator world pixel at `zoom` (fractional zoom allowed). */
export function projectToPixels(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export type ClusterFootprint = { x: number; y: number; round: boolean };

/** Group bubbles closer than this (px) at `zoom`: about one bubble across. */
export function clusterRadiusPx(zoom: number): number {
  return zoom < COUNTRY_ZOOM ? 32 : 48;
}

/** What counts as overlapping at `zoom`: a bubble circle, or a pin box once zoomed in. */
export function clusterFootprint(zoom: number, radiusPx = clusterRadiusPx(zoom)): ClusterFootprint {
  return zoom >= PIN_FOOTPRINT_ZOOM
    ? { x: PIN_FOOTPRINT.x, y: PIN_FOOTPRINT.y, round: false }
    : { x: radiusPx, y: radiusPx, round: true };
}

/** True when two markers `dx`, `dy` px apart would overlap. */
export function footprintOverlaps(dx: number, dy: number, f: ClusterFootprint): boolean {
  return f.round ? dx * dx + dy * dy <= f.x * f.x : Math.abs(dx) <= f.x && Math.abs(dy) <= f.y;
}

/** Distinct areas, most members first; ties keep first-seen order. */
function areasOf(points: readonly ClusterPoint[]): string[] {
  const counts = new Map<string, number>();
  for (const p of points) if (p.area) counts.set(p.area, (counts.get(p.area) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
}

/** A point or an already merged set of points, at its centroid (sums kept for cheap merging). */
type Node = { seed: ClusterPoint; lat: number; lng: number; sumLat: number; sumLng: number; members: ClusterPoint[]; live: number };

/** Numeric grid key (cells stay below 2^20 per axis up to zoom 18). */
const cellKey = (cx: number, cy: number) => cx * 2_097_152 + cy;

/** Heavier nodes absorb their neighbours first, then live ones, then by id (deterministic). */
function nodeOrder(a: Node, b: Node): number {
  return (
    b.members.length - a.members.length ||
    b.live - a.live ||
    (a.seed.id < b.seed.id ? -1 : a.seed.id > b.seed.id ? 1 : 0)
  );
}

/** One pass at `zoom`: every node takes the not yet taken nodes whose centroids overlap it. */
function mergeLevel(nodes: readonly Node[], zoom: number, f: ClusterFootprint): Node[] {
  const ordered = [...nodes].sort(nodeOrder);
  const px = ordered.map((n) => projectToPixels(n.lat, n.lng, zoom));
  const cellOf = (i: number) => [Math.floor(px[i].x / f.x), Math.floor(px[i].y / f.y)] as const;
  const grid = new Map<number, number[]>();
  ordered.forEach((_, i) => {
    const [cx, cy] = cellOf(i);
    const key = cellKey(cx, cy);
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
  });
  const taken = new Uint8Array(ordered.length);
  const out: Node[] = [];
  for (let i = 0; i < ordered.length; i++) {
    if (taken[i]) continue;
    taken[i] = 1;
    const parts = [ordered[i]];
    const [cx, cy] = cellOf(i);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(cellKey(cx + dx, cy + dy)) ?? []) {
          if (taken[j] || !footprintOverlaps(px[j].x - px[i].x, px[j].y - px[i].y, f)) continue;
          taken[j] = 1;
          parts.push(ordered[j]);
        }
      }
    }
    if (parts.length === 1) {
      out.push(ordered[i]);
      continue;
    }
    // Nodes of the previous level are discarded, so the seed's member list is extended in place.
    const merged = ordered[i];
    for (let k = 1; k < parts.length; k++) {
      for (const m of parts[k].members) merged.members.push(m);
      merged.sumLat += parts[k].sumLat;
      merged.sumLng += parts[k].sumLng;
      merged.live += parts[k].live;
    }
    merged.lat = merged.sumLat / merged.members.length;
    merged.lng = merged.sumLng / merged.members.length;
    out.push(merged);
  }
  return out;
}

/**
 * Hierarchical, like map clustering libraries do: merge from street level
 * down to `zoom` one level at a time, comparing group centroids. A warung
 * between two cities therefore never pulls both into one group, so Bogor and
 * Yogyakarta stay apart for as long as their bubbles do not overlap.
 */
export function clusterPoints(
  points: readonly ClusterPoint[],
  zoom: number,
  { radiusPx, maxZoom = CLUSTER_MAX_ZOOM }: { radiusPx?: number; maxZoom?: number } = {},
): ClusterItem[] {
  if (zoom >= maxZoom || points.length < 2) return points.map((point) => ({ kind: "single", point }));

  let nodes: Node[] = points.map((p) => ({
    seed: p,
    lat: p.lat,
    lng: p.lng,
    sumLat: p.lat,
    sumLng: p.lng,
    members: [p],
    live: p.live ? 1 : 0,
  }));
  const levels: number[] = [];
  for (let z = maxZoom - 1; z > zoom; z--) levels.push(z);
  levels.push(zoom);
  for (const z of levels) nodes = mergeLevel(nodes, z, clusterFootprint(z, radiusPx));

  return nodes.sort(nodeOrder).map((n): ClusterItem => {
    if (n.members.length === 1) return { kind: "single", point: n.members[0] };
    const lats = n.members.map((p) => p.lat);
    const lngs = n.members.map((p) => p.lng);
    return {
      kind: "group",
      group: {
        id: `group:${n.seed.id}`,
        lat: n.lat,
        lng: n.lng,
        points: n.members,
        live: n.live,
        areas: areasOf(n.members),
        bounds: [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)],
        ],
      },
    };
  });
}

/** Bubble diameter (px): grows with the log of the count; 28–34 px nationally, 34–50 px closer in. */
export function groupSizePx(count: number, zoom: number = COUNTRY_ZOOM): number {
  const steps = Math.log2(Math.max(2, count) / 2);
  return zoom < COUNTRY_ZOOM ? Math.min(34, Math.round(28 + 2 * steps)) : Math.min(50, Math.round(34 + 4 * steps));
}

/** Caption under a bubble: its main area, "+N" for the other areas in it. */
export function groupCaption(areas: readonly string[]): string {
  if (areas.length === 0) return "";
  return areas.length === 1 ? areas[0] : `${areas[0]} +${areas.length - 1}`;
}

/** Bounds of a set of points, or null when empty. */
export function boundsOfPoints(points: readonly { lat: number; lng: number }[]): LatLngBoundsTuple | null {
  if (points.length === 0) return null;
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const p of points) {
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
  }
  return [
    [s, w],
    [n, e],
  ];
}

/** "-start" / "-end": under or over the bubble, aligned to its left / right edge. */
export type CaptionPlacement =
  | "below"
  | "above"
  | "right"
  | "left"
  | "below-start"
  | "below-end"
  | "above-start"
  | "above-end";

const PLACEMENTS: readonly CaptionPlacement[] = [
  "below",
  "above",
  "right",
  "left",
  "below-end",
  "below-start",
  "above-end",
  "above-start",
];

type Rect = { x0: number; y0: number; x1: number; y1: number };

const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A marker drawn as a circle (bubble) overlaps a caption rectangle. */
function circleHits(c: { x: number; y: number }, r: number, rect: Rect): boolean {
  const dx = c.x - Math.max(rect.x0, Math.min(c.x, rect.x1));
  const dy = c.y - Math.max(rect.y0, Math.min(c.y, rect.y1));
  return dx * dx + dy * dy < r * r;
}

/** Rough width of a caption pill (10.5 px bold text plus padding). */
export function captionWidthPx(text: string): number {
  return Math.round(text.length * 6.2 + 12);
}

export const CAPTION_HEIGHT_PX = 16;

/** Screen box of a caption beside a bubble of radius `r` centred on `c`. */
export function captionRect(c: { x: number; y: number }, r: number, w: number, at: CaptionPlacement): Rect {
  const h = CAPTION_HEIGHT_PX;
  switch (at) {
    case "below":
      return { x0: c.x - w / 2, y0: c.y + r + 2, x1: c.x + w / 2, y1: c.y + r + 2 + h };
    case "above":
      return { x0: c.x - w / 2, y0: c.y - r - 2 - h, x1: c.x + w / 2, y1: c.y - r - 2 };
    case "right":
      return { x0: c.x + r + 2, y0: c.y - h / 2, x1: c.x + r + 2 + w, y1: c.y + h / 2 };
    case "left":
      return { x0: c.x - r - 2 - w, y0: c.y - h / 2, x1: c.x - r - 2, y1: c.y + h / 2 };
    case "below-start":
      return { x0: c.x - r, y0: c.y + r + 2, x1: c.x - r + w, y1: c.y + r + 2 + h };
    case "below-end":
      return { x0: c.x + r - w, y0: c.y + r + 2, x1: c.x + r, y1: c.y + r + 2 + h };
    case "above-start":
      return { x0: c.x - r, y0: c.y - r - 2 - h, x1: c.x - r + w, y1: c.y - r - 2 };
    case "above-end":
      return { x0: c.x + r - w, y0: c.y - r - 2 - h, x1: c.x + r, y1: c.y - r - 2 };
  }
}

export type GroupCaption = { text: string; placement: CaptionPlacement };

/** Visible map area in world pixels at the same zoom ({ x0, y0, x1, y1 }). */
export type PixelView = Rect;

/**
 * Area caption of each group (biggest groups first): the full caption below
 * its bubble, else above / right / left / under one edge, else just the main
 * area there, else none, so captions never cover each other or another marker,
 * and (with `view`) never run off the visible map. Keyed by group id.
 */
export function placeCaptions(
  items: readonly ClusterItem[],
  zoom: number,
  view?: PixelView,
): Map<string, GroupCaption> {
  const inView = (r: Rect) => !view || (r.x0 >= view.x0 && r.x1 <= view.x1 && r.y0 >= view.y0 && r.y1 <= view.y1);
  const marks = items.map((item) => {
    const g = item.kind === "group" ? item.group : null;
    const c = g ? projectToPixels(g.lat, g.lng, zoom) : projectToPixels(item.kind === "single" ? item.point.lat : 0, item.kind === "single" ? item.point.lng : 0, zoom);
    return { c, r: g ? groupSizePx(g.points.length, zoom) / 2 : 12 };
  });
  const order = items
    .map((item, i) => i)
    .filter((i) => items[i].kind === "group")
    .sort((a, b) => {
      const ga = items[a] as Extract<ClusterItem, { kind: "group" }>;
      const gb = items[b] as Extract<ClusterItem, { kind: "group" }>;
      return gb.group.points.length - ga.group.points.length;
    });
  const placed: Rect[] = [];
  const out = new Map<string, GroupCaption>();
  for (const i of order) {
    const { group } = items[i] as Extract<ClusterItem, { kind: "group" }>;
    if (group.areas.length === 0) continue;
    const { c, r } = marks[i];
    const texts = [...new Set([groupCaption(group.areas), group.areas[0]])];
    const tries = texts.flatMap((text) => PLACEMENTS.map((placement) => ({ text, placement })));
    for (const t of tries) {
      const rect = captionRect(c, r, captionWidthPx(t.text), t.placement);
      if (!inView(rect)) continue;
      if (placed.some((p) => hits(p, rect)) || marks.some((m, j) => j !== i && circleHits(m.c, m.r, rect))) continue;
      placed.push(rect);
      out.set(group.id, t);
      break;
    }
  }
  return out;
}
