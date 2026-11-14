/**
 * "Notifikasi Jam Lapar": settings, the event-driven alert (pilot warung only), the
 * 20:00-21:30 digest, the once-per-night claim and the test push. web-push is mocked and
 * VAPID keys are set for this file only, so every "sent" push is a recorded call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

const env = vi.hoisted(() => {
  const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  return saved;
});
const webpush = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(async () => ({ statusCode: 201, body: "", headers: {} })),
}));
vi.mock("web-push", () => webpush);

import { customerPresence, merchants, pushSubscriptions } from "@/db/schema";
import { HUNGER_ALERT_RADIUS_M } from "@/lib/constants";
import { atWib, wibDate } from "@/lib/time";
import {
  hungerAlertPayload,
  hungerAlertStatus,
  runHungerDigest,
  saveHungerAlert,
  sendHungerAlertsForMerchant,
  sendHungerTest,
} from "@/server/services/hunger-alert";
import { notifyMerchantAudience } from "@/server/services/merchant/notify";
import { reseed, testDb } from "../helpers/db";

const { db, close } = testDb();
const TODAY = wibDate(new Date());
const at = (hhmm: string) => atWib(TODAY, hhmm);
/** The seed runs at 20:15 WIB, so "tonight" closes between 20:33 and 22:45. */
const SEED_AT = at("20:15");
const PILOT_SLUG = "toko-roti-wangi-gandum-babakan-raya";

const P256DH = Buffer.alloc(65, 4).toString("base64url");
const AUTH = Buffer.alloc(16, 7).toString("base64url");
let seq = 0;

function device(lat: number, lng: number, label = "Kos Melati") {
  seq += 1;
  const endpoint = `https://fcm.googleapis.com/fcm/send/hunger-${seq}`;
  return {
    endpoint,
    body: {
      client_id: `hunger-client-${seq}`,
      webpush_subscription: { endpoint, keys: { p256dh: P256DH, auth: AUTH } },
      enabled: true,
      lat,
      lng,
      label,
    },
  };
}

/** Payloads sent to one endpoint since the last reset. */
function sentTo(endpoint: string): { title: string; body: string; url?: string; tag?: string }[] {
  return webpush.sendNotification.mock.calls
    .filter((c) => (c as unknown as [{ endpoint: string }])[0].endpoint === endpoint)
    .map((c) => JSON.parse((c as unknown as [unknown, string])[1]) as { title: string; body: string });
}

let pilot: { id: string; lat: number; lng: number };

beforeAll(async () => {
  await reseed(db, SEED_AT);
  const [m] = await db
    .update(merchants)
    .set({ isPilot: true })
    .where(eq(merchants.slug, PILOT_SLUG))
    .returning({ id: merchants.id, lat: merchants.latitude, lng: merchants.longitude });
  pilot = m;
});
afterAll(async () => {
  // Leave no pilot warung behind for the next file's seed.
  await db.update(merchants).set({ isPilot: false }).where(eq(merchants.slug, PILOT_SLUG));
  if (env.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = env.pub;
  if (env.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = env.priv;
  await close();
});
beforeEach(async () => {
  webpush.sendNotification.mockClear();
  // Every test starts with no alert devices.
  await db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint LIKE 'https://fcm.googleapis.com/fcm/send/hunger-%'`);
});

/** ~200 m north of the pilot warung (0.0018° latitude). */
const near = () => ({ lat: pilot.lat + 0.0018, lng: pilot.lng });

describe("settings", () => {
  it("enables with a rounded point and reports the status by endpoint", async () => {
    const d = device(-6.556789, 106.731234, "Kos Melati");
    const res = await saveHungerAlert(db, d.body);
    expect(res).toEqual({ enabled: true, label: "Kos Melati", radius_m: HUNGER_ALERT_RADIUS_M });
    expect(await hungerAlertStatus(db, d.endpoint)).toEqual(res);
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, d.endpoint));
    expect(row.hungerAlertLat).toBe(-6.557);
    expect(row.hungerAlertLng).toBe(106.731);
    expect(row.hungerAlertRadiusM).toBe(HUNGER_ALERT_RADIUS_M);
    // An unknown device is simply off.
    expect((await hungerAlertStatus(db, "https://fcm.googleapis.com/fcm/send/unknown")).enabled).toBe(false);
  });

  it("disabling clears the point and the label", async () => {
    const d = device(-6.5568, 106.7313);
    await saveHungerAlert(db, d.body);
    const off = await saveHungerAlert(db, { ...d.body, enabled: false, lat: undefined, lng: undefined, label: undefined });
    expect(off.enabled).toBe(false);
    expect(off.label).toBeNull();
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, d.endpoint));
    expect([row.hungerAlertLat, row.hungerAlertLng, row.hungerAlertLabel]).toEqual([null, null, null]);
  });

  it("rejects an endpoint that is not a known push service (SSRF)", async () => {
    const d = device(-6.5568, 106.7313);
    const bad = { ...d.body, webpush_subscription: { ...d.body.webpush_subscription, endpoint: "https://169.254.169.254/latest" } };
    await expect(saveHungerAlert(db, bad)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("event-driven alert (pilot warung)", () => {
  it("claims a device within 500 m once per night; a second publish does not resend", async () => {
    const d = device(near().lat, near().lng);
    await saveHungerAlert(db, d.body);

    const first = await sendHungerAlertsForMerchant(db, pilot.id, at("20:20"));
    expect(first.delivered).toBe(1);
    expect(first.endpointIds).toHaveLength(1);
    const [msg] = sentTo(d.endpoint);
    expect(msg.title).toMatch(/^Jam lapar: .+ buka diskon malam$/);
    expect(msg.body).toMatch(/Rp\s?\d{1,3}(\.\d{3})+ \(hemat \d+%\), sisa \d+ porsi, \d+ m dari Kos Melati\. Tutup \d{2}\.\d{2}\./);
    expect(msg.url).toBe(`/warung/${PILOT_SLUG}`);
    expect(msg.tag).toBe(`hunger-${TODAY}`);

    const second = await sendHungerAlertsForMerchant(db, pilot.id, at("20:40"));
    expect(second.delivered).toBe(0);
    expect(sentTo(d.endpoint)).toHaveLength(1);
  });

  it("sends nothing before 20.00 WIB, and does not use up the night", async () => {
    const d = device(near().lat, near().lng);
    await saveHungerAlert(db, d.body);
    expect((await sendHungerAlertsForMerchant(db, pilot.id, at("19:45"))).delivered).toBe(0);
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, d.endpoint));
    expect(row.lastHungerAlertOn).toBeNull();
  });

  it("sends nothing to a device beyond 500 m", async () => {
    const d = device(pilot.lat + 0.01, pilot.lng); // ~1.1 km
    await saveHungerAlert(db, d.body);
    expect((await sendHungerAlertsForMerchant(db, pilot.id, at("20:20"))).delivered).toBe(0);
    expect(sentTo(d.endpoint)).toHaveLength(0);
  });

  it("never alerts for a non-pilot (fictional) warung", async () => {
    const [other] = await db
      .select({ id: merchants.id, lat: merchants.latitude, lng: merchants.longitude })
      .from(merchants)
      .where(eq(merchants.slug, "geprek-kang-dadan-babakan-tengah"));
    const d = device(other.lat + 0.001, other.lng);
    await saveHungerAlert(db, d.body);
    expect((await sendHungerAlertsForMerchant(db, other.id, at("20:20"))).delivered).toBe(0);
  });

  it("leaves the alerted device out of the regular nearby push for the same event", async () => {
    const d = device(near().lat, near().lng);
    await saveHungerAlert(db, d.body);
    // The same browser was also seen near the warung, so the nearby push would reach it too.
    await db
      .insert(customerPresence)
      .values({ clientId: d.body.client_id, latitude: near().lat, longitude: near().lng, lastSeenAt: at("20:19") })
      .onConflictDoUpdate({ target: customerPresence.clientId, set: { lastSeenAt: at("20:19") } });

    const delivered = await notifyMerchantAudience(db, {
      merchantId: pilot.id,
      point: { lat: pilot.lat, lng: pilot.lng },
      subscribers: "notify_on_surplus_live",
      nearbyRadiusM: 2000,
      payload: { title: "Surplus baru", body: "Porsi malam ini sudah tersedia." },
      now: at("20:20"),
    });
    expect(delivered).toBeGreaterThanOrEqual(1);
    const msgs = sentTo(d.endpoint);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].title).toMatch(/^Jam lapar:/);
  });
});

describe("payload copy", () => {
  it("prefixes 'Data demo' for fictional warung and never says WhatsApp", () => {
    const base = {
      merchantName: "Warung Contoh",
      slug: "warung-contoh",
      menuName: "Nasi Timbel + Lauk Pilihan",
      priceIdr: 11000,
      discountPct: 50,
      stock: 4,
      distanceM: 348,
      label: "Kos Melati",
      endsAt: atWib(TODAY, "22:30"),
      date: TODAY,
    };
    const demo = hungerAlertPayload({ ...base, demo: true });
    expect(demo.title).toBe("Data demo · Jam lapar: Warung Contoh buka diskon malam");
    expect(demo.body).toBe("Nasi Timbel + Lauk Pilihan Rp 11.000 (hemat 50%), sisa 4 porsi, 350 m dari Kos Melati. Tutup 22.30.");
    expect(hungerAlertPayload({ ...base, demo: false }).title).toBe("Jam lapar: Warung Contoh buka diskon malam");
    expect(JSON.stringify(demo).toLowerCase()).not.toContain("whatsapp");
  });
});

describe("digest (hunger-hour)", () => {
  it("claims devices with live batches within 500 m once per night, with the demo prefix for seed warung", async () => {
    const d = device(near().lat, near().lng);
    const far = device(-7.9, 110.0); // nowhere near a warung
    await saveHungerAlert(db, d.body);
    await saveHungerAlert(db, far.body);

    expect(await runHungerDigest(db, at("19:59"))).toEqual({ claimed: 0, delivered: 0 });

    const run = await runHungerDigest(db, at("20:21"));
    expect(run).toEqual({ claimed: 1, delivered: 1 });
    const [msg] = sentTo(d.endpoint);
    expect(msg.title).toMatch(/^Data demo · Jam lapar: \d+ warung dekatmu buka diskon$/);
    expect(msg.body).toMatch(new RegExp(`^Mulai Rp\\s?[\\d.]+ dalam ${HUNGER_ALERT_RADIUS_M} m dari Kos Melati\\. Ambil sebelum tutup\\.$`));
    expect(msg.url).toBe("/discover");
    expect(sentTo(far.endpoint)).toHaveLength(0);

    // Same night: neither the digest nor an event alert sends again.
    expect(await runHungerDigest(db, at("20:50"))).toEqual({ claimed: 0, delivered: 0 });
    expect((await sendHungerAlertsForMerchant(db, pilot.id, at("20:51"))).delivered).toBe(0);
    expect(sentTo(d.endpoint)).toHaveLength(1);
  });

  it("does nothing after 21.30 WIB", async () => {
    const d = device(near().lat, near().lng);
    await saveHungerAlert(db, d.body);
    expect(await runHungerDigest(db, at("21:30"))).toEqual({ claimed: 0, delivered: 0 });
  });
});

describe("test push (Kirim contoh notifikasi)", () => {
  it("sends one sample to this device only, then waits out the cooldown", async () => {
    const d = device(near().lat, near().lng);
    const other = device(near().lat, near().lng);
    await saveHungerAlert(db, d.body);
    await saveHungerAlert(db, other.body);

    expect(await sendHungerTest(db, d.endpoint, at("20:00"))).toEqual({ delivered: true });
    expect(sentTo(d.endpoint).map((m) => m.title)).toEqual(["Contoh notifikasi Jam Lapar"]);
    expect(sentTo(other.endpoint)).toHaveLength(0);

    await expect(sendHungerTest(db, d.endpoint, at("20:00"))).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await sendHungerTest(db, d.endpoint, new Date(at("20:00").getTime() + 61_000))).toEqual({ delivered: true });

    // The sample does not use up the night's alert.
    const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, d.endpoint));
    expect(row.lastHungerAlertOn).toBeNull();
  });

  it("refuses an unknown device", async () => {
    await expect(sendHungerTest(db, "https://fcm.googleapis.com/fcm/send/hunger-missing", at("20:00"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
