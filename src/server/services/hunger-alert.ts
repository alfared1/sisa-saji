/**
 * "Notifikasi Jam Lapar": at most one push per device per WIB night when warung near the
 * buyer's chosen point (kos, campus) open their night discount.
 *
 * Two triggers:
 *  - event-driven (`sendHungerAlertsForMerchant`, called from notifyMerchantAudience on
 *    publish, scheduled activation and Diskon Kilat): only for pilot warung, so a real
 *    student is never woken by fictional seed or demo data, and only between
 *    HUNGER_ALERT_WINDOW_START and SURPLUS_WINDOW_END (WIB);
 *  - the "hunger-hour" digest job (`runHungerDigest`, HUNGER_ALERT_HOUR until
 *    HUNGER_DIGEST_UNTIL): counts live batches within HUNGER_ALERT_RADIUS_M of each device.
 *    While isDemoData(), a digest that counts any non-pilot (fictional) warung starts with
 *    "Data demo · ".
 *
 * Either way the device is claimed first (`last_hunger_alert_on = today`, one conditional
 * UPDATE), so two triggers or two instances never send twice in a night. The claim only
 * happens when Web Push is configured, so missing VAPID keys never burn the nightly slot.
 *
 * There is no WhatsApp path: the UI shows a WhatsApp text only as a labelled simulation.
 */
import "server-only";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import {
  HUNGER_ALERT_HOUR,
  HUNGER_ALERT_RADIUS_M,
  HUNGER_ALERT_WINDOW_START,
  HUNGER_DIGEST_UNTIL,
  HUNGER_TEST_COOLDOWN_SECONDS,
  SURPLUS_WINDOW_END,
} from "@/lib/constants";
import type { HungerAlertBody, HungerAlertResponse } from "@/lib/contracts";
import { isDemoData } from "@/lib/env";
import { formatClockId, formatIdr, wibDate, wibTime } from "@/lib/time";
import { ApiError } from "@/server/http";
import {
  isPushEnabled,
  savePushSubscription,
  sendToSubscriptions,
  type PushPayload,
  type PushTarget,
} from "@/server/services/push";

/** The parsed PUT body. */
export type HungerAlertInput = z.output<typeof HungerAlertBody>;

/** Shown when the buyer gave the point no name. */
const DEFAULT_LABEL = "titik notifikasimu";
const DEMO_PREFIX = "Data demo · ";

/** Stored points are rounded to 3 decimals (about 110 m): enough for 500 m, kinder to privacy. */
export const roundCoord = (x: number) => Math.round(x * 1000) / 1000;

/** WIB time inside [from, until). "HH:MM" strings compare correctly as text. */
function inWindow(now: Date, from: string, until: string): boolean {
  const t = wibTime(now);
  return t >= from && t < until;
}

/** Event-driven alerts: from the label's 20.00 until the surplus window ends. */
export const inHungerAlertWindow = (now: Date) => inWindow(now, HUNGER_ALERT_WINDOW_START, SURPLUS_WINDOW_END);
/** The digest job's own window. */
export const inHungerDigestWindow = (now: Date) => inWindow(now, HUNGER_ALERT_HOUR, HUNGER_DIGEST_UNTIL);

function distanceText(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

/* ------------------------------------------------------------------ */
/* Payloads (pure, exported for tests)                                 */
/* ------------------------------------------------------------------ */

export function hungerAlertPayload(input: {
  merchantName: string;
  slug: string;
  menuName: string;
  priceIdr: number;
  discountPct: number;
  stock: number;
  distanceM: number;
  label: string | null;
  endsAt: Date;
  date: string;
  demo: boolean;
}): PushPayload {
  return {
    title: `${input.demo ? DEMO_PREFIX : ""}Jam lapar: ${input.merchantName} buka diskon malam`,
    body:
      `${input.menuName} ${formatIdr(input.priceIdr)} (hemat ${input.discountPct}%), sisa ${input.stock} porsi, ` +
      `${distanceText(input.distanceM)} dari ${input.label || DEFAULT_LABEL}. Tutup ${formatClockId(input.endsAt)}.`,
    url: `/warung/${input.slug}`,
    tag: `hunger-${input.date}`,
  };
}

export function hungerDigestPayload(input: {
  warung: number;
  minPriceIdr: number;
  label: string | null;
  date: string;
  demo: boolean;
}): PushPayload {
  return {
    title: `${input.demo ? DEMO_PREFIX : ""}Jam lapar: ${input.warung} warung dekatmu buka diskon`,
    body: `Mulai ${formatIdr(input.minPriceIdr)} dalam ${HUNGER_ALERT_RADIUS_M} m dari ${input.label || DEFAULT_LABEL}. Ambil sebelum tutup.`,
    url: "/discover",
    tag: `hunger-${input.date}`,
  };
}

export function hungerTestPayload(label: string | null): PushPayload {
  return {
    title: "Contoh notifikasi Jam Lapar",
    body: `Begini kabarnya nanti: sekali semalam, saat warung dalam ${HUNGER_ALERT_RADIUS_M} m dari ${label || DEFAULT_LABEL} buka diskon malam.`,
    url: "/discover",
    tag: "hunger-test",
  };
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function toResponse(row: { hungerAlertEnabled: boolean; hungerAlertLabel: string | null } | undefined): HungerAlertResponse {
  return {
    enabled: row?.hungerAlertEnabled ?? false,
    label: row?.hungerAlertEnabled ? (row.hungerAlertLabel ?? null) : null,
    radius_m: HUNGER_ALERT_RADIUS_M,
  };
}

/**
 * Turns the alert on (with a point) or off for this device. The push subscription is
 * validated and stored like any other (savePushSubscription rejects unknown push hosts).
 */
export async function saveHungerAlert(
  db: Db,
  body: HungerAlertInput,
  userId: string | null = null,
): Promise<HungerAlertResponse> {
  await savePushSubscription(db, { userId, clientId: body.client_id, subscription: body.webpush_subscription });
  const label = body.label?.trim() || null;
  const settings =
    body.enabled && body.lat !== undefined && body.lng !== undefined
      ? {
          hungerAlertEnabled: true,
          hungerAlertLat: roundCoord(body.lat),
          hungerAlertLng: roundCoord(body.lng),
          hungerAlertLabel: label,
          hungerAlertRadiusM: HUNGER_ALERT_RADIUS_M,
        }
      : { hungerAlertEnabled: false, hungerAlertLat: null, hungerAlertLng: null, hungerAlertLabel: null };
  const [row] = await db
    .update(pushSubscriptions)
    .set(settings)
    .where(eq(pushSubscriptions.endpoint, body.webpush_subscription.endpoint))
    .returning({ hungerAlertEnabled: pushSubscriptions.hungerAlertEnabled, hungerAlertLabel: pushSubscriptions.hungerAlertLabel });
  return toResponse(row);
}

export async function hungerAlertStatus(db: Db, endpoint: string): Promise<HungerAlertResponse> {
  const [row] = await db
    .select({ hungerAlertEnabled: pushSubscriptions.hungerAlertEnabled, hungerAlertLabel: pushSubscriptions.hungerAlertLabel })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1);
  return toResponse(row);
}

/**
 * "Kirim contoh notifikasi": one sample push to this device only, at most once per
 * HUNGER_TEST_COOLDOWN_SECONDS. Does not touch the nightly claim.
 */
export async function sendHungerTest(db: Db, endpoint: string, now: Date = new Date()): Promise<{ delivered: boolean }> {
  if (!isPushEnabled()) {
    throw new ApiError("CONFLICT", "Notifikasi belum disiapkan di server ini.", { reason: "PUSH_DISABLED" }, 503);
  }
  const cutoff = new Date(now.getTime() - HUNGER_TEST_COOLDOWN_SECONDS * 1000);
  const { rows } = await db.execute<{ id: string; endpoint: string; p256dh: string; auth: string; label: string | null }>(sql`
    UPDATE push_subscriptions SET hunger_alert_test_at = ${now}
    WHERE endpoint = ${endpoint}
      AND (hunger_alert_test_at IS NULL OR hunger_alert_test_at <= ${cutoff})
    RETURNING id, endpoint, p256dh, auth, hunger_alert_label AS label`);
  const sub = rows[0];
  if (!sub) {
    const [exists] = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1);
    if (!exists) throw new ApiError("NOT_FOUND", "Aktifkan notifikasi di perangkat ini dulu.");
    throw new ApiError("RATE_LIMITED", "Contoh notifikasi baru saja dikirim. Coba lagi sebentar lagi.", {
      retry_after_seconds: HUNGER_TEST_COOLDOWN_SECONDS,
    });
  }
  const delivered = await sendToSubscriptions(db, [sub], hungerTestPayload(sub.label));
  return { delivered: delivered > 0 };
}

/* ------------------------------------------------------------------ */
/* Event-driven alert (pilot warung only)                              */
/* ------------------------------------------------------------------ */

export interface HungerSendSummary {
  delivered: number;
  /** push_subscriptions ids claimed tonight by this call (skip them in the regular push). */
  endpointIds: string[];
}

const NOTHING: HungerSendSummary = { delivered: 0, endpointIds: [] };

/** Never throws: a failed alert must not fail a publish or a job. */
export async function sendHungerAlertsForMerchant(
  db: Db,
  merchantId: string,
  now: Date = new Date(),
): Promise<HungerSendSummary> {
  try {
    if (!inHungerAlertWindow(now) || !isPushEnabled()) return NOTHING;
    const { rows: merchantRows } = await db.execute<{
      name: string;
      slug: string;
      lat: number;
      lng: number;
      is_pilot: boolean;
      is_open: boolean;
    }>(sql`
      SELECT merchant_name AS name, slug, latitude AS lat, longitude AS lng, is_pilot, is_open
      FROM merchants WHERE id = ${merchantId}`);
    const m = merchantRows[0];
    if (!m || !m.is_pilot || !m.is_open) return NOTHING;

    const { rows: batchRows } = await db.execute<{
      menu_name: string;
      price: number;
      pct: number;
      stock: number;
      end_at: Date | string;
    }>(sql`
      SELECT mn.menu_name, b.current_selling_price_idr AS price, b.current_discount_pct AS pct,
             b.available_stock AS stock, b.pickup_end_time AS end_at
      FROM surplus_batches b JOIN menus mn ON mn.id = b.menu_id
      WHERE b.merchant_id = ${merchantId} AND b.status = 'ACTIVE' AND b.available_stock > 0
        AND b.pickup_end_time > ${now}
        AND NOT mn.is_mystery_bag AND mn.category <> 'MYSTERY_BAG'
      ORDER BY b.current_selling_price_idr ASC, b.pickup_end_time ASC
      LIMIT 1`);
    const batch = batchRows[0];
    if (!batch) return NOTHING;

    const today = wibDate(now);
    const { rows: claimed } = await db.execute<PushTarget & { label: string | null; distance_m: number }>(sql`
      UPDATE push_subscriptions SET last_hunger_alert_on = ${today}::date
      WHERE hunger_alert_enabled AND hunger_alert_geom IS NOT NULL
        AND ST_DWithin(hunger_alert_geom, ST_MakePoint(${m.lng}, ${m.lat})::geography, ${HUNGER_ALERT_RADIUS_M})
        AND last_hunger_alert_on IS DISTINCT FROM ${today}::date
      RETURNING id, endpoint, p256dh, auth, hunger_alert_label AS label,
        ROUND(ST_Distance(hunger_alert_geom, ST_MakePoint(${m.lng}, ${m.lat})::geography))::int AS distance_m`);
    if (!claimed.length) return NOTHING;

    const counts = await Promise.all(
      claimed.map((sub) =>
        sendToSubscriptions(
          db,
          [sub],
          hungerAlertPayload({
            merchantName: m.name,
            slug: m.slug,
            menuName: batch.menu_name,
            priceIdr: Number(batch.price),
            discountPct: Number(batch.pct),
            stock: Number(batch.stock),
            distanceM: Number(sub.distance_m),
            label: sub.label,
            endsAt: new Date(batch.end_at),
            date: today,
            // Pilot warung are real; kept for symmetry with the digest rule.
            demo: isDemoData() && !m.is_pilot,
          }),
        ),
      ),
    );
    return { delivered: counts.reduce((a, b) => a + b, 0), endpointIds: claimed.map((c) => c.id) };
  } catch (err) {
    console.warn("[hunger] alert failed", err instanceof Error ? err.message : err);
    return NOTHING;
  }
}

/* ------------------------------------------------------------------ */
/* Digest job ("hunger-hour")                                          */
/* ------------------------------------------------------------------ */

export interface HungerDigestSummary {
  /** Devices with live batches nearby that were claimed tonight by this run. */
  claimed: number;
  delivered: number;
}

export async function runHungerDigest(db: Db, now: Date = new Date()): Promise<HungerDigestSummary> {
  if (!inHungerDigestWindow(now) || !isPushEnabled()) return { claimed: 0, delivered: 0 };
  const today = wibDate(now);
  // Uses the constant radius (not the per-row one) so the GIST index can serve ST_DWithin.
  const { rows: candidates } = await db.execute<{
    id: string;
    warung: number;
    min_price: number;
    non_pilot: boolean;
  }>(sql`
    SELECT p.id, agg.warung, agg.min_price, agg.non_pilot
    FROM push_subscriptions p
    JOIN LATERAL (
      SELECT COUNT(DISTINCT m.id)::int AS warung,
             COUNT(*)::int AS batches,
             MIN(b.current_selling_price_idr)::int AS min_price,
             BOOL_OR(NOT m.is_pilot) AS non_pilot
      FROM surplus_batches b
      JOIN merchants m ON m.id = b.merchant_id
      JOIN menus mn ON mn.id = b.menu_id
      WHERE b.status = 'ACTIVE' AND b.available_stock > 0 AND b.pickup_end_time > ${now}
        AND m.is_open AND NOT mn.is_mystery_bag AND mn.category <> 'MYSTERY_BAG'
        AND ST_DWithin(m.geom, p.hunger_alert_geom, ${HUNGER_ALERT_RADIUS_M})
    ) agg ON agg.batches > 0
    WHERE p.hunger_alert_enabled AND p.hunger_alert_geom IS NOT NULL
      AND p.last_hunger_alert_on IS DISTINCT FROM ${today}::date`);
  if (!candidates.length) return { claimed: 0, delivered: 0 };

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const { rows: claimed } = await db.execute<PushTarget & { label: string | null }>(sql`
    UPDATE push_subscriptions SET last_hunger_alert_on = ${today}::date
    WHERE id IN (${sql.join(candidates.map((c) => sql`${c.id}::uuid`), sql`, `)})
      AND last_hunger_alert_on IS DISTINCT FROM ${today}::date
    RETURNING id, endpoint, p256dh, auth, hunger_alert_label AS label`);

  const demoData = isDemoData();
  const counts = await Promise.all(
    claimed.map((sub) => {
      const c = byId.get(sub.id);
      if (!c) return Promise.resolve(0);
      return sendToSubscriptions(
        db,
        [sub],
        hungerDigestPayload({
          warung: Number(c.warung),
          minPriceIdr: Number(c.min_price),
          label: sub.label,
          date: today,
          demo: demoData && c.non_pilot,
        }),
      );
    }),
  );
  return { claimed: claimed.length, delivered: counts.reduce((a, b) => a + b, 0) };
}
