/**
 * Discovery against the seeded campus data around the default point (IPB
 * Dramaga, Bogor): PostGIS radius, filters, sorts, map pins, merchant detail,
 * favourites and the SSE change feed query.
 */
import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, surplusBatches, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { CAMPUSES } from "@/lib/constants";
import { DiscoverQuery, SubscribeBody, type MerchantSummary } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import {
  batchChangesSince,
  currentCursor,
  newBatchStreamState,
  pollBatchStream,
  findMapPins,
  findNearby,
  getMerchantDetail,
  setSubscription,
} from "@/server/services/discovery/discovery";
import { reseed, testDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;
/** The app's default search point. */
const IPB = CAMPUSES[0];
/** IPB-area warung ~3.7 / ~4.7 km from campus: outside 2 km, inside 5 km. */
const FAR = ["nasi-timbel-ceu-iyah-sindang-barang", "laksa-asinan-bu-nining-loji"];

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
});
afterAll(async () => close());

const nearby = (q: Partial<Parameters<typeof DiscoverQuery.parse>[0]> = {}) =>
  findNearby(db, DiscoverQuery.parse({ lat: IPB.lat, lng: IPB.lng, ...q }));

const slugs = (list: MerchantSummary[]) => list.map((m) => m.slug);

function expectSorted<T>(values: T[], cmp: (a: T, b: T) => number) {
  for (let i = 1; i < values.length; i++) expect(cmp(values[i - 1], values[i])).toBeLessThanOrEqual(0);
}

describe("GET /discover/nearby", () => {
  it("2 km around IPB Dramaga excludes Sindang Barang & Loji; 5 km includes them", async () => {
    const r2 = await nearby({ radius_m: 2000 });
    expect(r2.radius_m).toBe(2000);
    expect(r2.merchants.length).toBeGreaterThanOrEqual(8);
    for (const s of FAR) expect(slugs(r2.merchants)).not.toContain(s);
    for (const m of r2.merchants) expect(m.distance_m!).toBeLessThanOrEqual(2000);

    const r5 = await nearby({ radius_m: 5000 });
    for (const s of FAR) expect(slugs(r5.merchants)).toContain(s);
    expect(r5.merchants.length).toBeGreaterThan(r2.merchants.length);
  });

  it("returns only live batches with consistent summary fields", async () => {
    const now = Date.now();
    const r = await nearby({ radius_m: 5000 });
    expect(r.total_batches).toBe(r.merchants.reduce((s, m) => s + m.batches.length, 0));
    for (const m of r.merchants) {
      expect(m.is_open).toBe(true);
      expect(m.batches.length).toBeGreaterThan(0);
      expect(m.max_discount_pct).toBe(Math.max(...m.batches.map((b) => b.discount_pct)));
      expect(m.min_price_idr).toBe(Math.min(...m.batches.map((b) => b.selling_price_idr)));
      expect(m.total_available_stock).toBe(m.batches.reduce((s, b) => s + b.available_stock, 0));
      // batches inside a merchant: discount desc
      expectSorted(m.batches, (a, b) => b.discount_pct - a.discount_pct);
      for (const b of m.batches) {
        expect(b.available_stock).toBeGreaterThan(0);
        expect(new Date(b.pickup_end_time).getTime()).toBeGreaterThan(now);
        const expected = Math.floor((new Date(b.pickup_end_time).getTime() - now) / 60_000);
        expect(Math.abs(b.minutes_to_close - expected)).toBeLessThanOrEqual(1);
        expect(b.merchant_id).toBe(m.id);
        expect(b.distance_m).toBe(m.distance_m);
      }
    }
  });

  it("excludes closed merchants and sold-out / expired batches", async () => {
    const r = await nearby();
    const target = r.merchants[0];
    await db.update(merchants).set({ isOpen: false }).where(eq(merchants.id, target.id));
    try {
      expect(slugs((await nearby()).merchants)).not.toContain(target.slug);
    } finally {
      await db.update(merchants).set({ isOpen: true }).where(eq(merchants.id, target.id));
    }

    const batch = r.merchants[1].batches[0];
    await db.update(surplusBatches).set({ status: "EXPIRED" }).where(eq(surplusBatches.id, batch.batch_id));
    try {
      const ids = (await nearby()).merchants.flatMap((m) => m.batches.map((b) => b.batch_id));
      expect(ids).not.toContain(batch.batch_id);
    } finally {
      await db.update(surplusBatches).set({ status: "ACTIVE" }).where(eq(surplusBatches.id, batch.batch_id));
    }
  });

  it("cards say what is in the portion, tonight's lauk and the portion promise", async () => {
    const r = await nearby({ radius_m: 5000 });
    const cards = r.merchants.flatMap((m) => m.batches);
    expect(cards.length).toBeGreaterThan(0);
    for (const b of cards) {
      expect(b).not.toHaveProperty("is_mystery_bag");
      expect(Array.isArray(b.contents)).toBe(true);
      expect(Array.isArray(b.lauk_options)).toBe(true);
      expect(Array.isArray(b.lauk_available)).toBe(true);
      // Tonight's lauk are always from the menu's list (case-insensitive).
      const options = b.lauk_options.map((x) => x.toLowerCase());
      for (const l of b.lauk_available) expect(options).toContain(l.toLowerCase());
      expect(typeof b.full_portion).toBe("boolean");
      expect(b.photo).toBeNull(); // seed has no photos
      expect(b.merchant_trust).toHaveProperty("hygiene");
      expect(b.merchant_trust).toHaveProperty("portion_full");
      // Seed warung are not pilot warung: no menu photo is passed on to buyers.
      if (!b.merchant_is_pilot) expect(b.image_url).toBeNull();
    }
    for (const m of r.merchants) expect(m.trust).toEqual(m.batches[0].merchant_trust);
  });

  it("never lists a legacy closed surprise menu", async () => {
    const target = (await nearby()).merchants[0].batches[0];
    await db.update(menus).set({ isMysteryBag: true }).where(eq(menus.id, target.menu_id));
    try {
      const ids = (await nearby()).merchants.flatMap((m) => m.batches.map((b) => b.batch_id));
      expect(ids).not.toContain(target.batch_id);
    } finally {
      await db.update(menus).set({ isMysteryBag: false }).where(eq(menus.id, target.menu_id));
    }
    const [{ category }] = await db.select({ category: menus.category }).from(menus).where(eq(menus.id, target.menu_id));
    await db.update(menus).set({ category: "MYSTERY_BAG" }).where(eq(menus.id, target.menu_id));
    try {
      const ids = (await nearby()).merchants.flatMap((m) => m.batches.map((b) => b.batch_id));
      expect(ids).not.toContain(target.batch_id);
    } finally {
      await db.update(menus).set({ category }).where(eq(menus.id, target.menu_id));
    }
  });

  it("trust signals stay null below 10 answers and show the real share from 10", async () => {
    const m = (await nearby()).merchants[0];
    const [before] = await db.select().from(merchants).where(eq(merchants.id, m.id));
    const trustOf = async () => (await nearby()).merchants.find((x) => x.id === m.id)!;
    try {
      await db
        .update(merchants)
        .set({ hygieneAvg: 4.86, hygieneCount: 9, portionFullCount: 9, portionAnswerCount: 9 })
        .where(eq(merchants.id, m.id));
      let x = await trustOf();
      expect(x.trust).toEqual({ hygiene: null, portion_full: null });
      expect(x.batches[0].merchant_trust).toEqual({ hygiene: null, portion_full: null });

      await db
        .update(merchants)
        .set({ hygieneAvg: 4.86, hygieneCount: 12, portionFullCount: 11, portionAnswerCount: 12 })
        .where(eq(merchants.id, m.id));
      x = await trustOf();
      expect(x.trust).toEqual({ hygiene: { avg: 4.9, count: 12 }, portion_full: { pct: 92, count: 12 } });
      expect(x.batches[0].merchant_trust).toEqual(x.trust);
    } finally {
      await db
        .update(merchants)
        .set({
          hygieneAvg: before.hygieneAvg,
          hygieneCount: before.hygieneCount,
          portionFullCount: before.portionFullCount,
          portionAnswerCount: before.portionAnswerCount,
        })
        .where(eq(merchants.id, m.id));
    }
  });

  it("filters by menu category, max price and text query", async () => {
    const all = await nearby({ radius_m: 5000 });
    const cats = new Set(all.merchants.flatMap((m) => m.batches.map((b) => b.category)));
    expect(cats.size).toBeGreaterThan(1);
    const cat = [...cats].find((c) => c !== "MAKANAN_BERAT")!;
    const byCat = await nearby({ radius_m: 5000, category: cat });
    expect(byCat.total_batches).toBeGreaterThan(0);
    for (const m of byCat.merchants) for (const b of m.batches) expect(b.category).toBe(cat);

    const prices = all.merchants.flatMap((m) => m.batches.map((b) => b.selling_price_idr)).sort((a, b) => a - b);
    const max = prices[Math.floor(prices.length / 2)];
    const cheap = await nearby({ radius_m: 5000, max_price: max });
    expect(cheap.total_batches).toBeGreaterThan(0);
    expect(cheap.total_batches).toBeLessThan(all.total_batches);
    for (const m of cheap.merchants) for (const b of m.batches) expect(b.selling_price_idr).toBeLessThanOrEqual(max);

    const byName = await nearby({ radius_m: 5000, q: "DOCLANG" });
    expect(slugs(byName.merchants)).toContain("doclang-toge-goreng-ma-icih-babakan-doneng");
    for (const m of byName.merchants) {
      for (const b of m.batches) {
        expect(`${m.name} ${b.menu_name}`.toLowerCase()).toContain("doclang");
      }
    }
    // LIKE wildcards are escaped.
    expect((await nearby({ radius_m: 5000, q: "%" })).total_batches).toBe(0);
  });

  it("sorts: distance, discount, closing_soon, price, priority_distance", async () => {
    const d = (await nearby({ radius_m: 5000, sort: "distance" })).merchants;
    expectSorted(d, (a, b) => a.distance_m! - b.distance_m!);

    const disc = (await nearby({ radius_m: 5000, sort: "discount" })).merchants;
    expectSorted(disc, (a, b) => b.max_discount_pct - a.max_discount_pct);

    const soon = (await nearby({ radius_m: 5000, sort: "closing_soon" })).merchants;
    const earliest = (m: MerchantSummary) => Math.min(...m.batches.map((b) => new Date(b.pickup_end_time).getTime()));
    expectSorted(soon, (a, b) => earliest(a) - earliest(b));

    const price = (await nearby({ radius_m: 5000, sort: "price" })).merchants;
    expectSorted(price, (a, b) => a.min_price_idr - b.min_price_idr);

    const prio = (await nearby({ radius_m: 5000 })).merchants;
    const isPrio = (m: MerchantSummary) => m.tier === "PREMIUM" || m.is_verified;
    expect(prio.some(isPrio)).toBe(true);
    expect(prio.some((m) => !isPrio(m))).toBe(true);
    const firstRegular = prio.findIndex((m) => !isPrio(m));
    expect(prio.slice(firstRegular).every((m) => !isPrio(m))).toBe(true);
    expectSorted(prio.slice(0, firstRegular), (a, b) => a.distance_m! - b.distance_m!);
    expectSorted(prio.slice(firstRegular), (a, b) => a.distance_m! - b.distance_m!);
  });
});

describe("GET /discover/map-pins", () => {
  it("one pin per merchant with the soonest closing time", async () => {
    const q = DiscoverQuery.parse({ lat: IPB.lat, lng: IPB.lng });
    const [pins, r] = await Promise.all([findMapPins(db, q), findNearby(db, q)]);
    expect(pins.map((p) => p.merchant_id)).toEqual(r.merchants.map((m) => m.id));
    for (const p of pins) {
      const m = r.merchants.find((x) => x.id === p.merchant_id)!;
      expect(p.pickup_end_time).toBe(m.batches.map((b) => b.pickup_end_time).sort()[0]);
      expect(p.max_discount_pct).toBe(m.max_discount_pct);
      expect(p.distance_m).toBe(m.distance_m);
    }
  });
});

describe("GET /merchants/:slugOrId and subscribe", () => {
  let customerId: string;
  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({ fullName: "Penguji Diskoveri", phoneNumber: `+62898${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
      .returning({ id: users.id });
    customerId = u.id;
  });

  it("by slug with distance, live batches and abbreviated reviews; null subscription when logged out", async () => {
    const d = await getMerchantDetail(db, DEMO_MERCHANT_SLUG, { lat: IPB.lat, lng: IPB.lng, userId: null });
    expect(d.slug).toBe(DEMO_MERCHANT_SLUG);
    expect(d.distance_m).toBeGreaterThan(0);
    expect(d.distance_m).toBeLessThan(2000);
    expect(d.batches.length).toBeGreaterThan(0);
    expect(d.operational_open_time).toMatch(/^\d{2}:\d{2}$/);
    expect(d.whatsapp_number).toMatch(/^\+62/);
    expect(d.subscription).toBeNull();
    expect(d.reviews.length).toBeGreaterThan(0);
    expect(d.reviews.length).toBeLessThanOrEqual(10);
    for (const r of d.reviews) {
      expect(r.customer_name).toMatch(/^\S+( [A-Z]\.)?$/);
      expect(r).toHaveProperty("hygiene_rating");
      expect(r).toHaveProperty("portion_full");
      if (r.hygiene_rating !== null) expect(r.hygiene_rating).toBeGreaterThanOrEqual(1);
    }
    expect(d.trust).toHaveProperty("hygiene");
    expectSorted(d.reviews, (a, b) => b.created_at.localeCompare(a.created_at));
  });

  it("by uuid, without coordinates → distance null; unknown → NOT_FOUND", async () => {
    const [m] = await db.select().from(merchants).where(eq(merchants.slug, "soto-kuning-mang-oyo-dramaga"));
    const d = await getMerchantDetail(db, m.id, { userId: null });
    expect(d.id).toBe(m.id);
    expect(d.distance_m).toBeNull();

    for (const bad of ["tidak-ada-warung", "00000000-0000-4000-8000-000000000000"]) {
      const err = await getMerchantDetail(db, bad, { userId: null }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("NOT_FOUND");
    }
  });

  it("subscribe toggles the favourite and shows up in merchant detail", async () => {
    const on = await setSubscription(
      db,
      customerId,
      DEMO_MERCHANT_SLUG,
      SubscribeBody.parse({ subscribed: true, notify_on_ai_prediction: false }),
    );
    expect(on).toEqual({ subscribed: true });
    let d = await getMerchantDetail(db, DEMO_MERCHANT_SLUG, { userId: customerId });
    expect(d.subscription).toEqual({ notify_on_surplus_live: true, notify_on_ai_prediction: false });

    // Idempotent upsert
    await setSubscription(db, customerId, d.id, SubscribeBody.parse({ subscribed: true }));
    d = await getMerchantDetail(db, d.id, { userId: customerId });
    expect(d.subscription).toEqual({ notify_on_surplus_live: true, notify_on_ai_prediction: true });

    const off = await setSubscription(db, customerId, d.id, SubscribeBody.parse({ subscribed: false }));
    expect(off).toEqual({ subscribed: false });
    d = await getMerchantDetail(db, d.id, { userId: customerId });
    expect(d.subscription).toBeNull();
  });
});

describe("SSE change feed query", () => {
  it("emits batches updated after the cursor inside the radius only", async () => {
    const cursor = await currentCursor(db);
    expect((await batchChangesSince(db, { lat: IPB.lat, lng: IPB.lng, radius_m: 2000 }, cursor)).events).toHaveLength(0);

    const near = (await nearby({ radius_m: 2000 })).merchants[0].batches[0];
    const far = (await nearby({ radius_m: 5000 })).merchants.find((m) => FAR.includes(m.slug))!.batches[0];
    await db
      .update(surplusBatches)
      .set({ availableStock: sql`${surplusBatches.availableStock} - 1`, updatedAt: sql`now()` })
      .where(sql`${surplusBatches.id} IN (${near.batch_id}, ${far.batch_id})`);

    const changes = await batchChangesSince(db, { lat: IPB.lat, lng: IPB.lng, radius_m: 2000 }, cursor);
    expect(changes.events.map((e) => e.batch_id)).toEqual([near.batch_id]);
    expect(changes.events[0]).toMatchObject({
      merchant_id: near.merchant_id,
      available_stock: near.available_stock - 1,
      status: "ACTIVE",
      lauk_available: near.lauk_available,
    });
    expect(changes.cursor).not.toBe(cursor);
    // Advancing the cursor drains the feed.
    expect((await batchChangesSince(db, { lat: IPB.lat, lng: IPB.lng, radius_m: 2000 }, changes.cursor)).events).toHaveLength(0);
  });
});

describe("SSE stream poll (overlap + dedupe)", () => {
  it("delivers two batches stamped with the same time across two polls, each exactly once", async () => {
    const area = { lat: IPB.lat, lng: IPB.lng, radius_m: 2000 };
    const state = newBatchStreamState(await currentCursor(db));
    const [a, b] = (await nearby({ radius_m: 2000 })).merchants.flatMap((m) => m.batches).slice(0, 2);
    await pollBatchStream(db, area, state); // drain the replayed overlap of earlier changes
    // One escalation tick stamps every batch with the same tick-start time, but
    // commits them one by one, with a poll landing in between.
    const tick = new Date(Date.now() + 500);
    await db.update(surplusBatches).set({ currentDiscountPct: 61, updatedAt: tick }).where(eq(surplusBatches.id, a.batch_id));
    await new Promise((r) => setTimeout(r, 700)); // the poll starts after the tick stamp
    const p1 = await pollBatchStream(db, area, state);
    expect(p1.events.map((e) => e.batch_id)).toEqual([a.batch_id]);

    await db.update(surplusBatches).set({ currentDiscountPct: 61, updatedAt: tick }).where(eq(surplusBatches.id, b.batch_id));
    const p2 = await pollBatchStream(db, area, state);
    expect(p2.events.map((e) => e.batch_id)).toEqual([b.batch_id]);

    // A late commit stamped before the previous poll is still delivered; nothing repeats.
    await db
      .update(surplusBatches)
      .set({ availableStock: sql`${surplusBatches.availableStock} - 1`, updatedAt: new Date(Date.now() - 3_000) })
      .where(eq(surplusBatches.id, a.batch_id));
    const p3 = await pollBatchStream(db, area, state);
    expect(p3.events.map((e) => e.batch_id)).toEqual([a.batch_id]);
    expect((await pollBatchStream(db, area, state)).events).toEqual([]);
  });
});
