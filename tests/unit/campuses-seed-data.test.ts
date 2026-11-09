/**
 * Campus hubs (src/lib/campuses.ts) and the seed fixtures that hang off them:
 * Bogor first, every warung near its own hub, unique slugs, sane menus.
 */
import { describe, expect, it } from "vitest";
import {
  DEMO_MERCHANT_NAME,
  DEMO_MERCHANT_OWNER,
  DEMO_MERCHANT_SLUG,
  SEED_MERCHANTS,
} from "@/db/seed/data";
import {
  campusById,
  campusIdByName,
  campusesByRegion,
  distanceMeters,
  filterCampuses,
  nearestCampus,
} from "@/lib/campuses";
import { CAMPUSES, HOME_REGION } from "@/lib/constants";

describe("campus hubs", () => {
  it("lists Bogor hubs first, with IPB Dramaga as the default point", () => {
    expect(CAMPUSES.slice(0, 3).map((c) => c.id)).toEqual(["ipb", "bogor", "cibinong"]);
    expect(CAMPUSES.slice(0, 3).every((c) => c.region === HOME_REGION)).toBe(true);
    expect(CAMPUSES[0].name).toBe("IPB Dramaga, Bogor");
    expect(new Set(CAMPUSES.map((c) => c.id)).size).toBe(CAMPUSES.length);
    // Names other code matches on stay stable.
    expect(campusById("ugm").name).toBe("UGM Yogyakarta");
    expect(campusById("uny").name).toBe("UNY Yogyakarta");
  });

  it("resolves stored campus names, including the pre-rename IPB name", () => {
    expect(campusIdByName("IPB Dramaga, Bogor")).toBe("ipb");
    expect(campusIdByName("IPB Bogor")).toBe("ipb");
    expect(campusIdByName("UGM Yogyakarta")).toBe("ugm");
    expect(campusIdByName("Kampus Lain")).toBeNull();
    expect(campusIdByName(null)).toBeNull();
  });

  it("groups by region in list order, each region once", () => {
    const groups = campusesByRegion();
    expect(groups[0].region).toBe(HOME_REGION);
    expect(groups.map((g) => g.region)).toEqual([...new Set(CAMPUSES.map((c) => c.region))]);
    expect(groups.flatMap((g) => g.campuses)).toHaveLength(CAMPUSES.length);
  });

  it("filters by name or region, case-insensitively", () => {
    expect(filterCampuses("  ").length).toBe(CAMPUSES.length);
    expect(filterCampuses("bogor").map((c) => c.id)).toEqual(["ipb", "bogor", "cibinong"]);
    expect(filterCampuses("JAWA TIMUR").map((c) => c.id)).toEqual(["its", "ub"]);
    expect(filterCampuses("tidak ada")).toEqual([]);
  });

  it("measures distance and finds the nearest hub within a limit", () => {
    // IPB Dramaga ↔ Kota Bogor (Baranangsiang): ~9.6 km.
    expect(distanceMeters(campusById("ipb"), campusById("bogor"))).toBeGreaterThan(9_000);
    expect(distanceMeters(campusById("ipb"), campusById("bogor"))).toBeLessThan(10_500);
    expect(nearestCampus({ lat: -6.5574, lng: 106.7334 })?.campus.id).toBe("ipb");
    expect(nearestCampus({ lat: -7.7628, lng: 110.3741 })?.campus.id).toBe("ugm");
    // Middle of the Java Sea: nothing within 15 km.
    expect(nearestCampus({ lat: -5.5, lng: 110 }, 15_000)).toBeNull();
  });
});

describe("seed fixtures", () => {
  it("starts with the Bogor demo merchant", () => {
    expect(SEED_MERCHANTS[0]).toMatchObject({
      slug: DEMO_MERCHANT_SLUG,
      name: DEMO_MERCHANT_NAME,
      owner: DEMO_MERCHANT_OWNER,
      hub: "ipb",
    });
  });

  it("has unique slugs, warung names and owners", () => {
    for (const key of ["slug", "name", "owner"] as const) {
      const values = SEED_MERCHANTS.map((m) => m[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
  });

  it("covers every hub, with Bogor the biggest region", () => {
    const perHub = new Map<string, number>();
    for (const m of SEED_MERCHANTS) perHub.set(m.hub, (perHub.get(m.hub) ?? 0) + 1);
    for (const c of CAMPUSES) expect(perHub.get(c.id) ?? 0, c.id).toBeGreaterThanOrEqual(2);
    const perRegion = new Map<string, number>();
    for (const m of SEED_MERCHANTS) {
      const r = campusById(m.hub).region;
      perRegion.set(r, (perRegion.get(r) ?? 0) + 1);
    }
    const [top] = [...perRegion.entries()].sort((a, b) => b[1] - a[1]);
    expect(top[0]).toBe(HOME_REGION);
  });

  it("places every warung within 6 km of its own hub, and that hub is the nearest", () => {
    for (const m of SEED_MERCHANTS) {
      expect(distanceMeters(m, campusById(m.hub)), m.slug).toBeLessThan(6_000);
      expect(nearestCampus(m)?.campus.id, m.slug).toBe(m.hub);
    }
  });

  it("keeps the original Yogyakarta warung", () => {
    const slugs = SEED_MERCHANTS.map((m) => m.slug);
    for (const s of ["warung-bu-sri-pogung", "gudeg-bu-tini-sagan", "pecel-lele-mas-bejo-seturan", "dapur-mama-kost-condongcatur"]) {
      expect(slugs).toContain(s);
    }
    expect(SEED_MERCHANTS.filter((m) => campusById(m.hub).region === "DI Yogyakarta")).toHaveLength(15);
  });

  it("has sane hours and menus", () => {
    for (const m of SEED_MERCHANTS) {
      expect(m.open < m.close, m.slug).toBe(true);
      expect(m.close >= "20:00", m.slug).toBe(true); // open into the 20:00 surplus window
      expect(m.sellRate).toBeGreaterThan(0.3);
      expect(m.sellRate).toBeLessThan(1);
      expect(m.menus.length).toBeGreaterThan(0);
      expect(new Set(m.menus.map((x) => x.name)).size, m.slug).toBe(m.menus.length);
      for (const x of m.menus) {
        expect(x.priceIdr % 500, x.name).toBe(0);
        expect(x.priceIdr).toBeGreaterThanOrEqual(5_000);
        expect(x.priceIdr).toBeLessThanOrEqual(50_000);
        expect(Boolean(x.isMysteryBag), x.name).toBe(x.category === "MYSTERY_BAG");
        expect(x.baseSurplus).toBeGreaterThan(0);
      }
    }
  });
});
