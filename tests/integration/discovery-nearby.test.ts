/**
 * Discovery against the seeded campus data: PostGIS radius, filters, sorts,
 * map pins, merchant detail, favourites and the SSE change feed query.
 */
import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { merchants, surplusBatches, users } from "@/db/schema";
import { CAMPUSES } from "@/lib/constants";
import { DiscoverQuery, SubscribeBody, type MerchantSummary } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import {
  batchChangesSince,
  currentCursor,
  findMapPins,
  findNearby,
  getMerchantDetail,
  setSubscription,
} from "@/server/services/discovery/discovery";
import { reseed, testDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;
const UGM = CAMPUSES.find((c) => c.id === "ugm")!;
const FAR = ["pecel-lele-mas-bejo-seturan", "dapur-mama-kost-condongcatur"];

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
});
afterAll(async () => close());

const nearby = (q: Partial<Parameters<typeof DiscoverQuery.parse>[0]> = {}) =>
  findNearby(db, DiscoverQuery.parse({ lat: UGM.lat, lng: UGM.lng, ...q }));

const slugs = (list: MerchantSummary[]) => list.map((m) => m.slug);

function expectSorted<T>(values: T[], cmp: (a: T, b: T) => number) {
  for (let i = 1; i < values.length; i++) expect(cmp(values[i - 1], values[i])).toBeLessThanOrEqual(0);
}

describe("GET /discover/nearby", () => {
  it("2 km around UGM excludes Seturan & Condongcatur; 5 km includes them", async () => {
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

    const byName = await nearby({ radius_m: 5000, q: "GUDEG" });
    expect(slugs(byName.merchants)).toContain("gudeg-bu-tini-sagan");
    for (const m of byName.merchants) {
      for (const b of m.batches) {
        expect(`${m.name} ${b.menu_name}`.toLowerCase()).toContain("gudeg");
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
    const q = DiscoverQuery.parse({ lat: UGM.lat, lng: UGM.lng });
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
    const d = await getMerchantDetail(db, "warung-bu-sri-pogung", { lat: UGM.lat, lng: UGM.lng, userId: null });
    expect(d.slug).toBe("warung-bu-sri-pogung");
    expect(d.distance_m).toBeGreaterThan(0);
    expect(d.distance_m).toBeLessThan(2000);
    expect(d.batches.length).toBeGreaterThan(0);
    expect(d.operational_open_time).toMatch(/^\d{2}:\d{2}$/);
    expect(d.whatsapp_number).toMatch(/^\+62/);
    expect(d.subscription).toBeNull();
    expect(d.reviews.length).toBeGreaterThan(0);
    expect(d.reviews.length).toBeLessThanOrEqual(10);
    for (const r of d.reviews) expect(r.customer_name).toMatch(/^\S+( [A-Z]\.)?$/);
    expectSorted(d.reviews, (a, b) => b.created_at.localeCompare(a.created_at));
  });

  it("by uuid, without coordinates → distance null; unknown → NOT_FOUND", async () => {
    const [m] = await db.select().from(merchants).where(eq(merchants.slug, "gudeg-bu-tini-sagan"));
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
      "warung-bu-sri-pogung",
      SubscribeBody.parse({ subscribed: true, notify_on_ai_prediction: false }),
    );
    expect(on).toEqual({ subscribed: true });
    let d = await getMerchantDetail(db, "warung-bu-sri-pogung", { userId: customerId });
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
    expect((await batchChangesSince(db, { lat: UGM.lat, lng: UGM.lng, radius_m: 2000 }, cursor)).events).toHaveLength(0);

    const near = (await nearby({ radius_m: 2000 })).merchants[0].batches[0];
    const far = (await nearby({ radius_m: 5000 })).merchants.find((m) => FAR.includes(m.slug))!.batches[0];
    await db
      .update(surplusBatches)
      .set({ availableStock: sql`${surplusBatches.availableStock} - 1`, updatedAt: sql`now()` })
      .where(sql`${surplusBatches.id} IN (${near.batch_id}, ${far.batch_id})`);

    const changes = await batchChangesSince(db, { lat: UGM.lat, lng: UGM.lng, radius_m: 2000 }, cursor);
    expect(changes.events.map((e) => e.batch_id)).toEqual([near.batch_id]);
    expect(changes.events[0]).toMatchObject({
      merchant_id: near.merchant_id,
      available_stock: near.available_stock - 1,
      status: "ACTIVE",
    });
    expect(changes.cursor).not.toBe(cursor);
    // Advancing the cursor drains the feed.
    expect((await batchChangesSince(db, { lat: UGM.lat, lng: UGM.lng, radius_m: 2000 }, changes.cursor)).events).toHaveLength(0);
  });
});
