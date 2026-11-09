/**
 * Nationwide map pins (GET /api/v1/discover/map-pins/all) against the seeded
 * data: all 95 warung, live ones flagged with their live aggregates, idle ones
 * zeroed, one bounded query, plus the route handler (contract + validation).
 */
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { merchants, surplusBatches } from "@/db/schema";
import { DEMO_MERCHANT_SLUG, SEED_MERCHANTS } from "@/db/seed/data";
import { distanceMeters } from "@/lib/campuses";
import { CAMPUSES } from "@/lib/constants";
import { AllMapPinsQuery, type AllMapPinsResponse, type WarungMapPin } from "@/lib/contracts";
import { findAllMapPins } from "@/server/services/discovery/discovery";
import { reseed, testDb } from "../helpers/db";

// Route handlers call next/server's connection(), which needs a request scope.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

let db: Db;
let close: () => Promise<void>;
const IPB = CAMPUSES[0];

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
});
afterAll(async () => {
  // Leave pristine data for the next file, and close the pool getDb() opened for the route.
  await reseed(db);
  await close();
  const routeDb = (globalThis as { sisaSajiDb?: { $client?: { end: () => Promise<void> } } }).sisaSajiDb;
  await routeDb?.$client?.end();
});

type LiveBatchRow = {
  merchant_id: string;
  available_stock: number;
  discount_pct: number;
  price: number;
  pickup_end_time: Date | string;
};

/** Live batches per merchant, read straight from the tables (the reference for the aggregates). */
async function liveBatchesByMerchant(now: Date): Promise<Map<string, LiveBatchRow[]>> {
  const { rows } = await db.execute<LiveBatchRow>(sql`
    SELECT b.merchant_id, b.available_stock, b.current_discount_pct AS discount_pct,
           b.current_selling_price_idr AS price, b.pickup_end_time
    FROM surplus_batches b JOIN merchants m ON m.id = b.merchant_id
    WHERE m.is_open AND b.status = 'ACTIVE' AND b.available_stock > 0 AND b.pickup_end_time > ${now}`);
  const map = new Map<string, LiveBatchRow[]>();
  for (const r of rows) map.set(r.merchant_id, [...(map.get(r.merchant_id) ?? []), r]);
  return map;
}

describe("GET /discover/map-pins/all", () => {
  it("returns every seeded warung once, all live right after the seed, each on its hub", async () => {
    const { pins, truncated } = await findAllMapPins(db, {});
    expect(truncated).toBe(false);
    expect(pins).toHaveLength(95);
    expect(new Set(pins.map((p) => p.merchant_id)).size).toBe(95);
    expect(pins.every((p) => p.live)).toBe(true);

    const bySlug = new Map(pins.map((p) => [p.slug, p]));
    for (const m of SEED_MERCHANTS) {
      const p = bySlug.get(m.slug);
      expect(p, m.slug).toBeDefined();
      expect(p!.hub_id).toBe(m.hub);
      expect(p!.lat).toBeCloseTo(m.lat, 6);
      expect(p!.lng).toBeCloseTo(m.lng, 6);
      expect(p!.distance_m).toBeNull();
    }
    expect(new Set(pins.map((p) => p.hub_id)).size).toBe(21);
  });

  it("aggregates live batches per warung and flags idle ones (closed, sold out, expired)", async () => {
    const [closedM, soldOutM, expiredM] = SEED_MERCHANTS.filter((m) => m.hub === "ugm").map((m) => m.slug);
    const ids = await db
      .select({ id: merchants.id, slug: merchants.slug })
      .from(merchants)
      .where(inArray(merchants.slug, [closedM, soldOutM, expiredM]));
    const idOf = (slug: string) => ids.find((r) => r.slug === slug)!.id;

    await db.update(merchants).set({ isOpen: false }).where(eq(merchants.id, idOf(closedM)));
    await db.update(surplusBatches).set({ status: "SOLD_OUT" }).where(eq(surplusBatches.merchantId, idOf(soldOutM)));
    await db
      .update(surplusBatches)
      .set({ pickupStartTime: new Date(Date.now() - 2 * 3_600_000), pickupEndTime: new Date(Date.now() - 60_000) })
      .where(eq(surplusBatches.merchantId, idOf(expiredM)));

    const now = new Date();
    const { pins } = await findAllMapPins(db, {}, now);
    const reference = await liveBatchesByMerchant(now);
    expect(pins).toHaveLength(95);
    expect(pins.filter((p) => p.live)).toHaveLength(92);
    expect(pins.filter((p) => !p.live).map((p) => p.slug).sort()).toEqual([closedM, soldOutM, expiredM].sort());

    const closedPin = pins.find((p) => p.slug === closedM)!;
    expect(closedPin.is_open).toBe(false);
    for (const p of pins.filter((x) => !x.live)) {
      expect(p).toMatchObject({
        live_menu_count: 0,
        total_available_stock: 0,
        max_discount_pct: 0,
        min_price_idr: 0,
        pickup_end_time: null,
      });
    }

    for (const p of pins.filter((x) => x.live)) {
      const batches = reference.get(p.merchant_id) ?? [];
      expect(batches.length, p.slug).toBeGreaterThan(0);
      expect(p.live_menu_count).toBe(batches.length);
      expect(p.total_available_stock).toBe(batches.reduce((s, b) => s + Number(b.available_stock), 0));
      expect(p.max_discount_pct).toBe(Math.max(...batches.map((b) => Number(b.discount_pct))));
      expect(p.min_price_idr).toBe(Math.min(...batches.map((b) => Number(b.price))));
      const soonest = Math.min(...batches.map((b) => new Date(b.pickup_end_time).getTime()));
      expect(new Date(p.pickup_end_time!).getTime()).toBe(soonest);
    }
  });

  it("is one query, bounded, with live warung first", async () => {
    const spy = vi.spyOn(db, "execute");
    try {
      await findAllMapPins(db, { lat: IPB.lat, lng: IPB.lng });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }

    const capped = await findAllMapPins(db, {}, new Date(), 10);
    expect(capped.pins).toHaveLength(10);
    expect(capped.truncated).toBe(true);

    const { pins } = await findAllMapPins(db, {});
    const firstIdle = pins.findIndex((p) => !p.live);
    expect(firstIdle).toBeGreaterThan(0);
    expect(pins.slice(firstIdle).every((p) => !p.live)).toBe(true);
  });

  it("adds distance_m from lat/lng (meters, ~haversine)", async () => {
    const { pins } = await findAllMapPins(db, { lat: IPB.lat, lng: IPB.lng });
    const demo = pins.find((p) => p.slug === DEMO_MERCHANT_SLUG)!;
    expect(demo.distance_m).toBeLessThan(2000);
    for (const p of pins) {
      const d = distanceMeters(IPB, p);
      expect(Math.abs(p.distance_m! - d)).toBeLessThanOrEqual(Math.max(5, d * 0.01));
    }
  });

  it("route handler: public envelope, optional lat/lng (both or neither)", async () => {
    const { GET } = await import("@/app/api/v1/discover/map-pins/all/route");
    const res = await GET(new Request("http://localhost/api/v1/discover/map-pins/all"), undefined);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: true; data: AllMapPinsResponse };
    expect(body.success).toBe(true);
    expect(body.data.pins).toHaveLength(95);
    expect(body.data.truncated).toBe(false);
    const sample: WarungMapPin = body.data.pins[0];
    expect(Object.keys(sample).sort()).toEqual(
      [
        "merchant_id",
        "slug",
        "merchant_name",
        "category",
        "lat",
        "lng",
        "hub_id",
        "is_verified",
        "is_open",
        "rating_avg",
        "total_reviews",
        "live",
        "live_menu_count",
        "total_available_stock",
        "max_discount_pct",
        "min_price_idr",
        "pickup_end_time",
        "distance_m",
      ].sort(),
    );

    const near = await GET(
      new Request(`http://localhost/api/v1/discover/map-pins/all?lat=${IPB.lat}&lng=${IPB.lng}`),
      undefined,
    );
    const nearBody = (await near.json()) as { data: AllMapPinsResponse };
    expect(nearBody.data.pins.every((p) => typeof p.distance_m === "number")).toBe(true);

    const bad = await GET(new Request(`http://localhost/api/v1/discover/map-pins/all?lat=${IPB.lat}`), undefined);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
    expect(AllMapPinsQuery.safeParse({ lat: "200", lng: "0" }).success).toBe(false);
  });
});
