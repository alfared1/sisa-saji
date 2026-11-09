/**
 * Profile: edit, presence/push ping, personal impact summary, global stats, favourites.
 */
import { randomInt, randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { customerPresence, menus, merchants, orders, pushSubscriptions, surplusBatches, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG, SEED_MERCHANTS } from "@/db/seed/data";
import { BADGE_TIERS, CAMPUSES } from "@/lib/constants";
import { CheckoutBody, LocationPushBody, ProfileUpdateBody, SubscribeBody } from "@/lib/contracts";
import { treeYearsFromCo2Grams } from "@/lib/impact";
import { wibDate } from "@/lib/time";
import { setSubscription } from "@/server/services/discovery/discovery";
import { checkout } from "@/server/services/orders/checkout";
import { simulatePayment } from "@/server/services/orders/orders";
import { verifyPickup } from "@/server/services/orders/pickup";
import { prunePresence } from "@/server/services/presence";
import { isValidPushSubscription, unlinkPushSubscription } from "@/server/services/push";
import { ApiError } from "@/server/http";
import {
  getGlobalStats,
  getImpactSummary,
  lastWibMonths,
  listSubscriptions,
  nextBadge,
  recordLocationPush,
  updateProfile,
} from "@/server/services/profile/profile";
import { reseed, testDb } from "../helpers/db";
import { TEST_PAYMENT_WEBHOOK_SECRET, TEST_PICKUP_QR_SECRET } from "../setup/constants";

let db: Db;
/** A real-shaped subscription key pair: 65-byte P-256 point and 16-byte auth secret (base64url). */
const KEYS = {
  p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url"),
  auth: Buffer.alloc(16, 9).toString("base64url"),
};
let close: () => Promise<void>;
const UGM = CAMPUSES.find((c) => c.id === "ugm")!;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
});
afterAll(async () => close());

async function newCustomer(name = "Pembeli Profil") {
  const [u] = await db
    .insert(users)
    .values({ fullName: name, phoneNumber: `+62893${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  return u;
}

/** Runs one full order (checkout → pay → pickup) and returns the completed order row. */
async function completedOrder(customerId: string, slug: string, qty: number) {
  const [m] = await db.select().from(merchants).where(eq(merchants.slug, slug));
  const [menu] = await db.select().from(menus).where(eq(menus.merchantId, m.id)).orderBy(asc(menus.id)).limit(1);
  const now = Date.now();
  const [batch] = await db
    .insert(surplusBatches)
    .values({
      merchantId: m.id,
      menuId: menu.id,
      batchDate: wibDate(),
      initialStock: 10,
      availableStock: 10,
      originalPriceIdr: menu.originalPriceIdr,
      currentDiscountPct: 50,
      currentSellingPriceIdr: Math.round(menu.originalPriceIdr / 2),
      pickupStartTime: new Date(now - 30 * 60_000),
      pickupEndTime: new Date(now + 90 * 60_000),
    })
    .returning();
  const o = await checkout(db, {
    userId: customerId,
    input: CheckoutBody.parse({ merchant_id: m.id, items: [{ batch_id: batch.id, quantity: qty }] }),
    pickupQrSecret: TEST_PICKUP_QR_SECRET,
  });
  await simulatePayment(db, { orderId: o.id, userId: customerId, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
  const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
  await verifyPickup(db, { merchantId: m.id, orderId: o.id, input: row.pickupCode, pickupQrSecret: TEST_PICKUP_QR_SECRET });
  return (await db.select().from(orders).where(eq(orders.id, o.id)))[0];
}

describe("PATCH /profile", () => {
  it("updates only the given fields and returns the session view", async () => {
    const u = await newCustomer();
    const res = await updateProfile(
      db,
      u.id,
      ProfileUpdateBody.parse({ full_name: "  Ayu Lestari ", campus_or_area: "UGM Yogyakarta", default_lat: UGM.lat, default_lng: UGM.lng }),
    );
    expect(res).toMatchObject({
      id: u.id,
      full_name: "Ayu Lestari",
      campus_or_area: "UGM Yogyakarta",
      default_lat: UGM.lat,
      default_lng: UGM.lng,
      phone_number: u.phoneNumber,
    });
    const cleared = await updateProfile(db, u.id, ProfileUpdateBody.parse({ campus_or_area: null, default_lat: null }));
    expect(cleared).toMatchObject({ full_name: "Ayu Lestari", campus_or_area: null, default_lat: null, default_lng: UGM.lng });
    // Empty patch is a no-op.
    expect(await updateProfile(db, u.id, ProfileUpdateBody.parse({}))).toEqual(cleared);
  });
});

describe("PUT /profile/location-push", () => {
  it("upserts presence, stores the push subscription and counts active devices nearby", async () => {
    const before = await recordLocationPush(db, {
      ...LocationPushBody.parse({ client_id: `probe-${randomUUID()}`, lat: UGM.lat, lng: UGM.lng }),
      userId: null,
    });
    const u = await newCustomer();
    const clientId = `client-${randomUUID()}`;
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    const res = await recordLocationPush(db, {
      ...LocationPushBody.parse({
        client_id: clientId,
        lat: String(UGM.lat + 0.001),
        lng: String(UGM.lng),
        webpush_subscription: { endpoint, keys: KEYS },
      }),
      userId: u.id,
    });
    expect(res.ok).toBe(true);
    expect(res.active_users_in_radius).toBe(before.active_users_in_radius + 1);

    const [p] = await db.select().from(customerPresence).where(eq(customerPresence.clientId, clientId));
    expect(p).toMatchObject({ userId: u.id, latitude: UGM.lat + 0.001, longitude: UGM.lng });
    const [s] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(s).toMatchObject({ userId: u.id, clientId, p256dh: KEYS.p256dh, auth: KEYS.auth });

    // A later anonymous ping from the same device keeps the user and does not double count.
    const again = await recordLocationPush(db, {
      ...LocationPushBody.parse({ client_id: clientId, lat: UGM.lat, lng: UGM.lng }),
      userId: null,
    });
    expect(again.active_users_in_radius).toBe(res.active_users_in_radius);
    const [p2] = await db.select().from(customerPresence).where(eq(customerPresence.clientId, clientId));
    expect(p2.userId).toBe(u.id);

    // Logout with this device's endpoint unlinks it from the account (only the owner's row).
    const stranger = await newCustomer();
    expect(await unlinkPushSubscription(db, { userId: stranger.id, endpoint })).toBe(0);
    expect(await unlinkPushSubscription(db, { userId: u.id, endpoint })).toBe(1);
    const [s2] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    expect(s2.userId).toBeNull();
  });

  it("rejects push endpoints outside the known push services (no SSRF) and malformed keys", async () => {
    const bad = [
      "https://10.0.0.5:8443/admin",
      "http://fcm.googleapis.com/fcm/send/x",
      "https://fcm.googleapis.com:8443/fcm/send/x",
      "https://fcm.googleapis.com.evil.test/x",
      "https://localhost/x",
    ];
    for (const endpoint of bad) {
      expect(isValidPushSubscription({ endpoint, keys: KEYS })).toBe(false);
      const err = await recordLocationPush(db, {
        ...LocationPushBody.parse({ client_id: `ssrf-${randomUUID()}`, lat: UGM.lat, lng: UGM.lng, webpush_subscription: { endpoint, keys: KEYS } }),
        userId: null,
      }).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("VALIDATION_ERROR");
    }
    expect(isValidPushSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "x", auth: "y" } })).toBe(false);
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
      "https://web.push.apple.com/abc",
    ]) {
      expect(isValidPushSubscription({ endpoint: ok, keys: KEYS })).toBe(true);
    }
  });

  it("prunes presence rows older than 24 h", async () => {
    const clientId = `old-${randomUUID()}`;
    await db.insert(customerPresence).values({ clientId, latitude: UGM.lat, longitude: UGM.lng, lastSeenAt: new Date(Date.now() - 25 * 3_600_000) });
    expect(await prunePresence(db)).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(customerPresence).where(eq(customerPresence.clientId, clientId))).toEqual([]);
  });
});

describe("GET /profile/impact", () => {
  it("helpers: last 6 WIB months and next badge progress", () => {
    expect(lastWibMonths(new Date("2026-02-15T00:00:00Z"), 6)).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    // 31 Jan 20:00 UTC is already 1 Feb in WIB.
    expect(lastWibMonths(new Date("2026-01-31T20:00:00Z"), 1)).toEqual(["2026-02"]);
    expect(nextBadge(0)).toEqual({ tier: "SURPLUS_SAVER", min_food_saved_grams: 2000, progress_pct: 0 });
    expect(nextBadge(1000)).toMatchObject({ tier: "SURPLUS_SAVER", progress_pct: 50 });
    expect(nextBadge(2500)).toMatchObject({ tier: "SURPLUS_HERO", progress_pct: 50 });
    expect(nextBadge(BADGE_TIERS[BADGE_TIERS.length - 1].minFoodSavedGrams)).toBeNull();
  });

  it("new customer: zeros, 6 empty months, next badge = SURPLUS_SAVER", async () => {
    const u = await newCustomer();
    const s = await getImpactSummary(db, u.id);
    expect(s).toMatchObject({
      total_food_saved_grams: 0,
      total_co2_avoided_grams: 0,
      total_money_saved_idr: 0,
      tree_equivalent: 0,
      completed_orders: 0,
      loyalty_points: 0,
      badge_tier: "SURPLUS_ROOKIE",
      next_badge: { tier: "SURPLUS_SAVER", min_food_saved_grams: 2000, progress_pct: 0 },
    });
    expect(s.monthly).toHaveLength(6);
    expect(s.monthly.every((m) => m.orders === 0)).toBe(true);
    expect(s.monthly[5].month).toBe(wibDate().slice(0, 7));
  });

  it("after two completed orders the totals and the current month add up", async () => {
    const u = await newCustomer();
    const o1 = await completedOrder(u.id, "soto-lamongan-cak-har", 2);
    const o2 = await completedOrder(u.id, "warung-vegan-hijau-daun", 1);
    const s = await getImpactSummary(db, u.id);

    const food = o1.totalFoodSavedGrams + o2.totalFoodSavedGrams;
    const co2 = o1.totalCo2AvoidedGrams + o2.totalCo2AvoidedGrams;
    const saved = [o1, o2].reduce((acc, o) => acc + o.subtotalOriginalIdr - o.subtotalRecoveryIdr + o.voucherDiscountIdr, 0);
    const points = Math.floor(o1.totalCustomerPaidIdr / 1000) + Math.floor(o2.totalCustomerPaidIdr / 1000);
    expect(s).toMatchObject({
      total_food_saved_grams: food,
      total_co2_avoided_grams: co2,
      total_money_saved_idr: saved,
      completed_orders: 2,
      loyalty_points: points,
      tree_equivalent: Math.round(treeYearsFromCo2Grams(co2) * 100) / 100,
    });
    expect(s.monthly[5]).toEqual({
      month: wibDate().slice(0, 7),
      orders: 2,
      food_saved_grams: food,
      co2_avoided_grams: co2,
      money_saved_idr: saved,
    });
  });

  it("seeded demo customer: monthly history never exceeds the lifetime totals", async () => {
    const [demo] = await db.select().from(users).where(eq(users.email, "demo.pembeli@sisasaji.test"));
    const s = await getImpactSummary(db, demo.id);
    expect(s.completed_orders).toBeGreaterThan(0);
    const sum = s.monthly.reduce((acc, m) => acc + m.food_saved_grams, 0);
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(s.total_food_saved_grams);
  });
});

describe("GET /stats/global", () => {
  it("matches the database", async () => {
    const now = new Date();
    const stats = await getGlobalStats(db, now);
    const [o] = await db
      .select({
        n: sql<number>`count(*)::int`,
        food: sql<number>`coalesce(sum(${orders.totalFoodSavedGrams}), 0)::bigint`,
      })
      .from(orders)
      .where(eq(orders.status, "COMPLETED"));
    expect(stats.total_orders_completed).toBe(o.n);
    expect(stats.total_food_saved_grams).toBe(Number(o.food));
    expect(stats.total_co2_avoided_grams).toBeGreaterThan(stats.total_food_saved_grams);
    expect(stats.active_merchants).toBe(SEED_MERCHANTS.length);
    const [b] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(surplusBatches)
      .where(and(eq(surplusBatches.status, "ACTIVE"), gt(surplusBatches.availableStock, 0), gt(surplusBatches.pickupEndTime, now)));
    expect(stats.live_batches).toBe(b.n);
  });
});

describe("GET /subscriptions", () => {
  it("lists favourites with live state and tonight's prediction", async () => {
    const u = await newCustomer();
    expect(await listSubscriptions(db, u.id)).toEqual([]);
    await setSubscription(db, u.id, DEMO_MERCHANT_SLUG, SubscribeBody.parse({ subscribed: true }));
    await setSubscription(db, u.id, "toko-roti-wangi-gandum-babakan-raya", SubscribeBody.parse({ subscribed: true, notify_on_surplus_live: false }));

    const list = await listSubscriptions(db, u.id);
    expect(list.map((s) => s.merchant_slug)).toEqual([DEMO_MERCHANT_SLUG, "toko-roti-wangi-gandum-babakan-raya"]);
    expect(list[0]).toMatchObject({ notify_on_surplus_live: true, notify_on_ai_prediction: true, has_live_batches: true });
    expect(list[1]).toMatchObject({ notify_on_surplus_live: false });
    for (const s of list) {
      if (s.predicted_surplus_portions !== null) expect(Number.isInteger(s.predicted_surplus_portions)).toBe(true);
    }
  });
});
