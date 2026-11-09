/**
 * /map scopes: the scope store (nationwide by default, an explicit "Ambil di
 * sekitar" pick switches to nearby), marker grouping and captions for the
 * nationwide view, and the per-hub summaries.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CLUSTER_MAX_ZOOM,
  boundsOfPoints,
  captionRect,
  captionWidthPx,
  clusterPoints,
  groupSizePx,
  placeCaptions,
  projectToPixels,
  type ClusterPoint,
} from "@/components/map/cluster";
import { groupHtml, groupLabel, idleLabel } from "@/components/map/types";
import {
  hubMetaText,
  hubPickRadius,
  hubRowText,
  idlePinsWithin,
  indonesiaMarkers,
  indonesiaStatusText,
  merchantCardFromWarungPin,
  nationalTotals,
  previewIsIdle,
  previewSlug,
  summarizeHubs,
} from "@/components/customer/map/map-scope";
import { SEED_MERCHANTS } from "@/db/seed/data";
import { distanceMeters, localTimeZone } from "@/lib/campuses";
import { CAMPUSES } from "@/lib/constants";
import type { WarungMapPin } from "@/lib/contracts";
import { rehydratePersistedStores } from "@/stores/hydration";
import { DEFAULT_LOCATION, useLocationStore } from "@/stores/location";
import { nextMapScope, selectShowsIndonesia, useMapScopeStore } from "@/stores/map-scope";

function warung(over: Partial<WarungMapPin> & { merchant_id: string }): WarungMapPin {
  return {
    slug: over.merchant_id,
    merchant_name: `Warung ${over.merchant_id}`,
    category: "MAKANAN_BERAT",
    lat: CAMPUSES[0].lat,
    lng: CAMPUSES[0].lng,
    hub_id: "ipb",
    is_verified: false,
    is_open: true,
    rating_avg: 4.5,
    total_reviews: 10,
    live: true,
    live_menu_count: 2,
    total_available_stock: 5,
    max_discount_pct: 50,
    min_price_idr: 8000,
    pickup_end_time: "2026-11-09T15:00:00.000Z",
    distance_m: null,
    ...over,
  };
}

/** Seed warung as all-pins rows: every one live except the ids in `idle`. */
function seedPins(idle: ReadonlySet<string> = new Set()): WarungMapPin[] {
  return SEED_MERCHANTS.map((m) =>
    warung({
      merchant_id: m.slug,
      merchant_name: m.name,
      lat: m.lat,
      lng: m.lng,
      hub_id: m.hub,
      live: !idle.has(m.slug),
      live_menu_count: idle.has(m.slug) ? 0 : 2,
      total_available_stock: idle.has(m.slug) ? 0 : 4,
      pickup_end_time: idle.has(m.slug) ? null : "2026-11-09T15:00:00.000Z",
    }),
  );
}

describe("map scope store", () => {
  beforeAll(async () => {
    await rehydratePersistedStores();
  });
  beforeEach(() => {
    useMapScopeStore.getState().closeMap();
    useLocationStore.setState({ ...DEFAULT_LOCATION, radius_m: 2000 });
  });

  it("pure transitions: open / close / show-all → indonesia, a location pick → nearby", () => {
    expect(nextMapScope("nearby", "open")).toBe("indonesia");
    expect(nextMapScope("nearby", "close")).toBe("indonesia");
    expect(nextMapScope("nearby", "show-all")).toBe("indonesia");
    expect(nextMapScope("indonesia", "pick-location")).toBe("nearby");
    expect(nextMapScope("nearby", "pick-location")).toBe("nearby");
  });

  it("opening the map always starts nationwide, even after a nearby visit", () => {
    const s = useMapScopeStore.getState();
    s.openMap();
    expect(useMapScopeStore.getState().scope).toBe("indonesia");
    useLocationStore.getState().setCampus("ugm");
    s.pickLocation();
    expect(useMapScopeStore.getState().scope).toBe("nearby");
    const visits = useMapScopeStore.getState().visits;
    s.closeMap();
    // Leaving bumps the map key, so the next visit gets a fresh Leaflet instance.
    expect(useMapScopeStore.getState().visits).toBe(visits + 1);
    s.openMap();
    expect(useMapScopeStore.getState().scope).toBe("indonesia");
  });

  it("re-selecting the stored campus is a pick too", () => {
    useMapScopeStore.getState().openMap();
    expect(useLocationStore.getState().campus_id).toBe(CAMPUSES[0].id);
    useLocationStore.getState().setCampus(CAMPUSES[0].id);
    useMapScopeStore.getState().pickLocation();
    expect(useMapScopeStore.getState().scope).toBe("nearby");
  });

  it("a background location write (e.g. a GPS fix Beranda started earlier) does not switch the scope", () => {
    useMapScopeStore.getState().openMap();
    useLocationStore.getState().setLocation({ lat: -7.78, lng: 110.38, source: "gps" });
    useLocationStore.getState().setRadius(5000);
    useLocationStore.getState().setCampus("ugm");
    expect(useMapScopeStore.getState().scope).toBe("indonesia");
    expect(selectShowsIndonesia(useMapScopeStore.getState())).toBe(true);
  });

  it("show-all goes back after any pick; picks off the map are ignored", () => {
    const { openMap, showAll, pickLocation } = useMapScopeStore.getState();
    pickLocation(); // map closed: Beranda's own pickers never touch the map scope
    expect(useMapScopeStore.getState()).toMatchObject({ mapOpen: false, scope: "indonesia" });
    openMap();
    pickLocation();
    expect(useMapScopeStore.getState().scope).toBe("nearby");
    showAll();
    expect(useMapScopeStore.getState().scope).toBe("indonesia");
    pickLocation();
    expect(useMapScopeStore.getState().scope).toBe("nearby");
  });

  it("the pill override is map-only", () => {
    useLocationStore.getState().setCampus("ugm");
    expect(selectShowsIndonesia(useMapScopeStore.getState())).toBe(false);
    useMapScopeStore.getState().openMap();
    expect(selectShowsIndonesia(useMapScopeStore.getState())).toBe(true);
    useMapScopeStore.getState().pickLocation();
    expect(selectShowsIndonesia(useMapScopeStore.getState())).toBe(false);
  });

  it("the store keeps the chosen location when the map shows all of Indonesia", () => {
    useLocationStore.getState().setCampus("its");
    useMapScopeStore.getState().openMap();
    expect(useLocationStore.getState()).toMatchObject({ campus_id: "its", source: "campus" });
  });
});

describe("marker grouping (nationwide map)", () => {
  const p = (id: string, lat: number, lng: number, live = true): ClusterPoint => ({ id, lat, lng, live });
  const size = (items: ReturnType<typeof clusterPoints>) =>
    items.reduce((s, i) => s + (i.kind === "group" ? i.group.points.length : 1), 0);

  it("projects like Leaflet (EPSG:3857, 256 px tiles)", () => {
    expect(projectToPixels(0, 0, 0)).toEqual({ x: 128, y: 128 });
    const z1 = projectToPixels(0, 180, 1);
    expect(z1.x).toBeCloseTo(512);
  });

  it("groups close points at low zoom and splits them when zoomed in", () => {
    const pts = [p("a", -6.5568, 106.7313), p("b", -6.5575, 106.732), p("c", -2.61, 140.66)];
    const far = clusterPoints(pts, 5);
    expect(far).toHaveLength(2);
    const group = far.find((i) => i.kind === "group");
    expect(group?.kind === "group" && group.group.points.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(far.find((i) => i.kind === "single")).toMatchObject({ point: { id: "c" } });

    const near = clusterPoints(pts, CLUSTER_MAX_ZOOM);
    expect(near.every((i) => i.kind === "single")).toBe(true);
  });

  it("never loses or duplicates a marker, at any zoom", () => {
    const pts: ClusterPoint[] = SEED_MERCHANTS.map((m, i) => p(m.slug, m.lat, m.lng, i % 3 !== 0));
    for (let z = 3; z <= 16; z += 0.5) {
      const items = clusterPoints(pts, z);
      expect(size(items)).toBe(pts.length);
      const ids = items.flatMap((i) => (i.kind === "group" ? i.group.points.map((x) => x.id) : [i.point.id]));
      expect(new Set(ids).size).toBe(pts.length);
    }
  });

  it("the 95 seed warung read as a few bubbles nationally and as 95 markers up close", () => {
    const pts = SEED_MERCHANTS.map((m) => p(m.slug, m.lat, m.lng));
    expect(pts).toHaveLength(95);
    for (const z of [3.5, 4.5]) {
      const national = clusterPoints(pts, z);
      expect(national.length).toBeLessThanOrEqual(25);
      // Java never collapses into one bubble: the Bogor group is the biggest, well short of all of Java.
      const biggest = Math.max(...national.map((i) => (i.kind === "group" ? i.group.points.length : 1)));
      expect(biggest).toBeLessThan(60);
      const bogor = national.find((i) => i.kind === "group" && i.group.points.some((x) => x.id === SEED_MERCHANTS[0].slug));
      expect(bogor?.kind === "group" && bogor.group.points.length).toBe(biggest);
      // Group bubbles never overlap each other.
      const groups = national.flatMap((i) => (i.kind === "group" ? [i.group] : []));
      for (const g of groups) {
        for (const h of groups) {
          if (g === h) continue;
          const a = projectToPixels(g.lat, g.lng, z);
          const b = projectToPixels(h.lat, h.lng, z);
          const minGap = (groupSizePx(g.points.length, z) + groupSizePx(h.points.length, z)) / 2;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(minGap * 0.9);
        }
      }
    }
    // Laptop zoom: Java splits into a western (Bogor), a central and an eastern group.
    const laptop = clusterPoints(pts, 4.5).filter((i) => i.kind === "group" && i.group.points.length >= 8);
    expect(laptop.length).toBeGreaterThanOrEqual(3);
    expect(clusterPoints(pts, CLUSTER_MAX_ZOOM)).toHaveLength(95);
  });

  it("captions name a group's areas, never overlap each other, and fall back to the main area", () => {
    const pts = SEED_MERCHANTS.map((m) => ({ ...p(m.slug, m.lat, m.lng), area: CAMPUSES.find((c) => c.id === m.hub)!.city }));
    for (const z of [3.5, 4, 4.5, 6, 8]) {
      const items = clusterPoints(pts, z);
      const captions = placeCaptions(items, z);
      const groups = items.flatMap((i) => (i.kind === "group" ? [i.group] : []));
      // Every group gets a caption on the seed data, at phone and laptop zoom alike.
      expect(captions.size).toBe(groups.length);
      const bogor = groups.find((g) => g.points.some((x) => x.id === SEED_MERCHANTS[0].slug))!;
      expect(captions.get(bogor.id)?.text.startsWith("Bogor")).toBe(true);
      const rects = groups.map((g) => {
        const c = captions.get(g.id)!;
        const at = projectToPixels(g.lat, g.lng, z);
        return captionRect(at, groupSizePx(g.points.length, z) / 2, captionWidthPx(c.text), c.placement);
      });
      for (const a of rects) {
        for (const b of rects) {
          if (a === b) continue;
          const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          expect(overlap).toBe(false);
        }
      }
    }
    // A group of one area has no "+N".
    const one = clusterPoints(
      [
        { ...p("a", -6.5568, 106.7313), area: "Bogor" },
        { ...p("b", -6.5575, 106.732), area: "Bogor" },
      ],
      5,
    );
    const g = one.find((i) => i.kind === "group");
    expect(g && g.kind === "group" && placeCaptions(one, 5).get(g.group.id)?.text).toBe("Bogor");
  });

  it("counts live members, seeds on live warung, and gives bounds that cover every member", () => {
    const pts = [p("idle-1", -6.556, 106.731, false), p("live-1", -6.557, 106.732), p("idle-2", -6.558, 106.733, false)];
    const [item] = clusterPoints(pts, 8);
    expect(item.kind).toBe("group");
    if (item.kind !== "group") return;
    expect(item.group.live).toBe(1);
    expect(item.group.id).toBe("group:live-1");
    expect(item.group.bounds).toEqual([
      [-6.558, 106.731],
      [-6.556, 106.733],
    ]);
    // Same input, same output (stable keys between refetches).
    expect(clusterPoints([...pts].reverse(), 8)).toEqual(clusterPoints(pts, 8));
  });

  it("bubble size grows with the count: 28–34 px on the whole-country view, 34–50 px closer in", () => {
    expect(groupSizePx(2, 4)).toBe(28);
    expect(groupSizePx(2000, 4)).toBe(34);
    expect(groupSizePx(2, 8)).toBe(34);
    expect(groupSizePx(28, 8)).toBeGreaterThan(groupSizePx(5, 8));
    expect(groupSizePx(2000, 8)).toBe(50);
    expect(boundsOfPoints([])).toBeNull();
    expect(
      boundsOfPoints([
        { lat: 3.56, lng: 98.65 },
        { lat: -8.67, lng: 140.66 },
      ]),
    ).toEqual([
      [-8.67, 98.65],
      [3.56, 140.66],
    ]);
  });

  it("marker labels: groups and idle warung never say 'porsi' (only live pins do)", () => {
    expect(groupLabel(28, 26)).toBe("28 warung, 26 ada surplus. Perbesar peta ke sini");
    expect(groupLabel(28, 26, "Bogor +2")).toBe("Bogor +2: 28 warung, 26 ada surplus. Perbesar peta ke sini");
    expect(groupLabel(5, 5)).toContain("semua ada surplus");
    expect(groupLabel(3, 0)).toContain("belum ada surplus");
    expect(idleLabel("Warung A")).toBe("Warung A: belum ada surplus saat ini");
    expect(groupLabel(9, 4)).not.toContain("porsi");
    expect(groupHtml(28, 44)).toContain('data-count="28"');
    expect(groupHtml(28, 44)).toContain("--size:44px");
    expect(groupHtml(28, 44)).not.toContain("ss-group__caption");
    const html = groupHtml(3, 30, { text: "Bogor <+2>", placement: "below-end" });
    expect(html).toContain('class="ss-group__caption ss-group__caption--below-end" aria-hidden="true"');
    expect(html).toContain("Bogor &lt;+2&gt;");
  });
});

describe("nationwide summaries", () => {
  it("summarises hubs per region, Bogor (the home region) first in CAMPUSES order", () => {
    const regions = summarizeHubs(seedPins(), 2000);
    expect(regions[0]).toMatchObject({ region: "Bogor", isHome: true, warung: 28 });
    expect(regions[0].hubs.map((h) => h.hub.id)).toEqual(["ipb", "bogor", "cibinong"]);
    expect(regions.find((r) => r.region === "DI Yogyakarta")?.warung).toBe(15);
    expect(regions.reduce((s, r) => s + r.warung, 0)).toBe(95);
    const hubs = regions.flatMap((r) => r.hubs);
    expect(hubs).toHaveLength(21);
    const order = hubs.map((h) => CAMPUSES.findIndex((c) => c.id === h.hub.id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("a hub row counts exactly what picking it shows: its radius covers every warung of the hub", () => {
    for (const stored of [2000, 5000, 10000]) {
      const idle = new Set(SEED_MERCHANTS.filter((_, i) => i % 4 === 0).map((m) => m.slug));
      const pins = seedPins(idle);
      for (const row of summarizeHubs(pins, stored).flatMap((r) => r.hubs)) {
        expect(row.radiusM).toBeGreaterThanOrEqual(stored);
        // Every warung of this hub is inside the radius the row picks...
        for (const m of SEED_MERCHANTS.filter((x) => x.hub === row.hub.id)) {
          expect(distanceMeters(row.hub, m), `${m.slug} within ${row.radiusM} m of ${row.hub.id}`).toBeLessThanOrEqual(
            row.radiusM,
          );
        }
        // ...and the counts equal the nearby scope after the pick: live radius pins + idle markers.
        const inRadius = pins.filter((w) => distanceMeters(row.hub, w) <= row.radiusM);
        const live = inRadius.filter((w) => w.live);
        const liveIds = new Set(live.map((w) => w.merchant_id));
        const idleShown = idlePinsWithin(pins, row.hub, row.radiusM, liveIds);
        expect(row.warung).toBe(live.length + idleShown.length);
        expect(row.liveWarung).toBe(live.length);
        expect(row.portions).toBe(live.reduce((s, w) => s + w.total_available_stock, 0));
      }
    }
    // IPB has warung 2.5–4.7 km out: its row widens the default 2 km to 5 km.
    const ipb = summarizeHubs(seedPins(), 2000)[0].hubs[0];
    expect(ipb).toMatchObject({ radiusM: 5000, warung: SEED_MERCHANTS.filter((m) => m.hub === "ipb").length });
  });

  it("hub pick radius: the stored one when it covers, else the smallest wider option", () => {
    const hub = { lat: -6.5568, lng: 106.7313 };
    const near = { lat: -6.56, lng: 106.735 }; // ~0.5 km
    const far = { lat: -6.59, lng: 106.7313 }; // ~3.7 km
    expect(hubPickRadius(hub, [near], 2000)).toBe(2000);
    expect(hubPickRadius(hub, [near, far], 2000)).toBe(5000);
    expect(hubPickRadius(hub, [near, far], 10000)).toBe(10000);
    expect(hubPickRadius(hub, [{ lat: -7.0, lng: 106.7313 }], 2000)).toBe(10000);
  });

  it("counts live menus and portions only from live warung; cities are distinct cities, not hubs", () => {
    const idle = new Set(SEED_MERCHANTS.filter((m) => m.hub === "ipb").slice(0, 4).map((m) => m.slug));
    const pins = seedPins(idle);
    const bogorRegion = summarizeHubs(pins, 2000)[0];
    const bogorCount = SEED_MERCHANTS.filter((m) => ["ipb", "bogor", "cibinong"].includes(m.hub)).length;
    expect(bogorRegion).toMatchObject({ warung: bogorCount, liveMenus: (bogorCount - 4) * 2, portions: (bogorCount - 4) * 4 });

    const t = nationalTotals(pins);
    // 21 hubs, but IPB Dramaga, Kota Bogor and Cibinong are one city, as are UGM and UNY.
    expect(t).toEqual({ warung: 95, cities: 18, liveWarung: 91, liveMenus: 182, portions: 364 });
    expect(indonesiaStatusText(t)).toBe("95 warung di 18 kota · 364 porsi live");
    expect(indonesiaStatusText({ ...t, portions: 1234 })).toBe("95 warung di 18 kota · 1.234 porsi live");
  });

  it("hub texts, local time zones and warung outside every hub", () => {
    expect(hubMetaText({ warung: 14, liveMenus: 31 })).toBe("14 warung · 31 menu live");
    expect(hubMetaText({ warung: 3, liveMenus: 0 })).toBe("3 warung · belum ada surplus");
    expect(hubRowText({ warung: 14, liveMenus: 17, radiusM: 5000 })).toBe("14 warung dalam 5 km · 17 menu live");
    expect(hubRowText({ warung: 2, liveMenus: 0, radiusM: 2000 })).toBe("2 warung dalam 2 km · belum ada surplus");
    const tz = (id: string) => localTimeZone(CAMPUSES.find((c) => c.id === id)!);
    expect([tz("ipb"), tz("unud"), tz("unhas"), tz("unsrat"), tz("uncen")]).toEqual(["WIB", "WITA", "WITA", "WITA", "WIT"]);
    const lonely = warung({ merchant_id: "x", hub_id: null });
    expect(summarizeHubs([lonely], 2000)).toEqual([]);
    expect(nationalTotals([lonely])).toMatchObject({ warung: 1, cities: 0 });
  });

  it("splits nationwide pins into live pins and idle markers", () => {
    const { live, idle } = indonesiaMarkers([
      warung({ merchant_id: "a", max_discount_pct: 60, total_available_stock: 7 }),
      warung({ merchant_id: "b", live: false, live_menu_count: 0, total_available_stock: 0, pickup_end_time: null }),
    ]);
    expect(live).toEqual([expect.objectContaining({ id: "a", discount_pct: 60, stock: 7 })]);
    // `area` (the hub's city) captions the group bubbles.
    expect(live[0].area).toBe("Bogor");
    expect(idle).toEqual([{ id: "b", lat: CAMPUSES[0].lat, lng: CAMPUSES[0].lng, name: "Warung b", area: "Bogor" }]);
  });

  it("nearby scope: the radius pins decide; a warung that just sold out turns idle, never vanishes", () => {
    const ugm = CAMPUSES.find((c) => c.id === "ugm")!;
    // The nationwide poll still says live, but the (SSE-fresh) radius pins no longer list it.
    const pins = seedPins();
    const inRadius = pins.filter((w) => distanceMeters(ugm, w) <= 2000);
    const soldOut = inRadius[0].merchant_id;
    const liveIds = new Set(inRadius.map((w) => w.merchant_id).filter((id) => id !== soldOut));
    expect(idlePinsWithin(pins, ugm, 2000, liveIds).map((w) => w.merchant_id)).toEqual([soldOut]);
    // Radius pins not loaded for this area yet: the nationwide flag decides.
    expect(idlePinsWithin(pins, ugm, 2000, null)).toEqual([]);
  });

  it("nearby scope: idle warung inside the radius only, never twice", () => {
    const ugm = CAMPUSES.find((c) => c.id === "ugm")!;
    const idleSlugs = new Set(SEED_MERCHANTS.filter((m) => m.hub === "ugm" || m.hub === "ipb").map((m) => m.slug));
    const pins = seedPins(idleSlugs);
    const inRadius = idlePinsWithin(pins, ugm, 2000, null);
    expect(inRadius.length).toBeGreaterThan(0);
    for (const w of inRadius) {
      expect(w.live).toBe(false);
      expect(distanceMeters(ugm, w)).toBeLessThanOrEqual(2000);
    }
    expect(inRadius.some((w) => w.hub_id === "ipb")).toBe(false);
    const already = new Set([inRadius[0].merchant_id]);
    expect(idlePinsWithin(pins, ugm, 2000, already).map((w) => w.merchant_id)).not.toContain(inRadius[0].merchant_id);
  });

  it("preview: a nationwide idle pick shows the idle card; live data wins when present", () => {
    const idle = warung({ merchant_id: "i", live: false });
    expect(previewIsIdle({ merchant: null, warung: idle, pin: null })).toBe(true);
    expect(previewIsIdle({ merchant: null, warung: warung({ merchant_id: "l" }), pin: null })).toBe(false);
    expect(previewSlug({ merchant: null, warung: idle, pin: null })).toBe("i");
    expect(merchantCardFromWarungPin(warung({ merchant_id: "l", min_price_idr: 9000 }))).toMatchObject({
      slug: "l",
      min_price_idr: 9000,
      total_available_stock: 5,
    });
  });
});
