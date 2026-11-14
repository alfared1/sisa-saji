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
  floorPrice,
} from "@/db/seed/data";
import { normalizeItems } from "@/lib/lauk";
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
        expect(x.category, x.name).not.toBe("MYSTERY_BAG");
        expect(x.baseSurplus).toBeGreaterThan(0);
      }
    }
  });
});

describe("seed menus are transparent and priced for the research", () => {
  const BOGOR_HUBS = new Set(["ipb", "bogor", "cibinong"]);
  const menus = SEED_MERCHANTS.flatMap((m) => m.menus.map((x) => ({ m, x })));

  it("has no surprise items: every menu lists its contents", () => {
    for (const { m, x } of menus) {
      const label = `${m.slug} / ${x.name}`;
      expect(x.name, label).not.toMatch(/kejutan|surprise|misteri|mystery/i);
      expect(x.description, label).not.toMatch(/isi acak|kejutan/i);
      expect(x.contents.length, label).toBeGreaterThanOrEqual(1);
      expect(x.contents.length, label).toBeLessThanOrEqual(12);
      expect(x.laukOptions?.length ?? 0, label).toBeLessThanOrEqual(8);
      for (const item of [...x.contents, ...(x.laukOptions ?? [])]) {
        expect(item.length, `${label}: ${item}`).toBeGreaterThan(0);
        expect(item.length, `${label}: ${item}`).toBeLessThanOrEqual(40);
      }
      // The same normalisation the API applies: trimmed, no case-insensitive duplicates.
      expect(normalizeItems(x.contents), label).toEqual(x.contents);
      expect(normalizeItems(x.laukOptions ?? []), label).toEqual(x.laukOptions ?? []);
    }
  });

  it("offers a lauk choice at the demo warung and at a few others", () => {
    expect(SEED_MERCHANTS[0].menus[0].laukOptions?.length).toBeGreaterThanOrEqual(2);
    expect(menus.filter(({ x }) => (x.laukOptions?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(10);
  });

  it("prices every menu at Rp 16.000 or more, and Bogor menus at Rp 18.000 to 25.000", () => {
    for (const { m, x } of menus) {
      const label = `${m.slug} / ${x.name}`;
      expect(x.priceIdr, label).toBeGreaterThanOrEqual(16_000);
      if (BOGOR_HUBS.has(m.hub)) {
        expect(x.priceIdr, label).toBeGreaterThanOrEqual(18_000);
        expect(x.priceIdr, label).toBeLessThanOrEqual(25_000);
      }
    }
  });

  it("floors at Rp 10.000, so even the floor price is a discount of at least 35%", () => {
    expect(floorPrice(18_000)).toBe(10_000);
    expect(floorPrice(8_000)).toBe(8_000);
    for (const { x } of menus) {
      const floor = floorPrice(x.priceIdr);
      expect(floor).toBeLessThanOrEqual(10_000);
      expect(Math.round((1 - floor / x.priceIdr) * 100), x.name).toBeGreaterThanOrEqual(35);
    }
    // The demo warung's first two menus stay the cheapest (checkout tests use HEMAT2K on them).
    const demo = SEED_MERCHANTS[0].menus.map((x) => x.priceIdr);
    expect(demo[0]).toBeLessThan(20_000);
    expect(Math.max(demo[0], demo[1])).toBeLessThanOrEqual(Math.min(...demo.slice(2)));
  });

  it("puts 6 warung within walking distance (500 m) of IPB and 10 within 1 km", () => {
    const ipb = campusById("ipb");
    const d = SEED_MERCHANTS.map((m) => distanceMeters(m, ipb));
    expect(d.filter((x) => x <= 500).length).toBeGreaterThanOrEqual(6);
    expect(d.filter((x) => x <= 1_000).length).toBeGreaterThanOrEqual(10);
  });

  it("keeps the renamed Bogor warung at their hub, and the slugs other tests use", () => {
    const bySlug = new Map(SEED_MERCHANTS.map((m) => [m.slug, m]));
    const renamed: [string, string][] = [
      ["warteg-bahari-kang-iwan-babakan-lebak", "ipb"],
      ["angkringan-mang-didin-babakan-lebak", "ipb"],
      ["mie-ayam-kang-asep-pakuan", "bogor"],
      ["warteg-bu-enok-cilibende", "bogor"],
      ["angkringan-mang-ade-cilibende", "bogor"],
      ["roti-unyil-saung-kenari-taman-kencana", "bogor"],
    ];
    for (const [slug, hub] of renamed) {
      const m = bySlug.get(slug);
      expect(m, slug).toBeDefined();
      if (m) expect(nearestCampus(m)?.campus.id, slug).toBe(hub);
    }
    for (const slug of [
      "toko-roti-wangi-gandum-babakan-raya",
      "soto-kuning-mang-oyo-dramaga",
      "geprek-kang-dadan-babakan-tengah",
      "seblak-cireng-teh-yuyun-babakan-tengah",
      "doclang-toge-goreng-ma-icih-babakan-doneng",
      "nasi-timbel-ceu-iyah-sindang-barang",
      "laksa-asinan-bu-nining-loji",
      "warung-vegetarian-saung-hejo-balio",
    ]) {
      expect(bySlug.has(slug), slug).toBe(true);
    }
    expect(SEED_MERCHANTS.filter((m) => BOGOR_HUBS.has(m.hub))).toHaveLength(28);
    expect(SEED_MERCHANTS).toHaveLength(95);
  });
});
