/**
 * Web Push (VAPID). Disabled gracefully when VAPID keys are not configured.
 * Subscriptions are stored per device in push_subscriptions. The "Jam Lapar" alerts
 * (src/server/services/hunger-alert.ts) use the same rows and `sendToSubscriptions`.
 */
import "server-only";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
// web-push 4 is ESM-only with named exports (no default export).
import * as webpush from "web-push";
import type { Db } from "@/db/client";
import { customerPresence, pushSubscriptions } from "@/db/schema";
import { getVapidKeys } from "@/lib/env";
import type { WebPushSubscriptionInput } from "@/lib/contracts";
import { PRESENCE_ACTIVE_MINUTES } from "@/lib/constants";
import { ApiError } from "@/server/http";

export type PushPayload = {
  title: string;
  body: string;
  /** Path to open on click, e.g. "/warung/warung-nasi-teh-euis-babakan-raya". */
  url?: string;
  tag?: string;
};

let configured: boolean | null = null;
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const keys = getVapidKeys();
  if (keys) webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  configured = Boolean(keys);
  return configured;
}

export function isPushEnabled(): boolean {
  return ensureConfigured();
}

/**
 * Push services of the browsers we support. The server POSTs to the stored endpoint,
 * so arbitrary URLs would let anyone aim it at internal hosts (blind SSRF).
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Samsung, Opera
  /^([a-z0-9-]+\.)?push\.services\.mozilla\.com$/, // Firefox (updates.push.services.mozilla.com)
  /^[a-z0-9-]+\.notify\.windows\.com$/, // legacy Edge / Windows
  /^web\.push\.apple\.com$/, // Safari
];

function base64UrlBytes(v: string): number {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(v)) return -1;
  return Buffer.from(v.replace(/=+$/, ""), "base64url").length;
}

/** True for an https endpoint of a known push service with well-formed P-256 / auth keys. */
export function isValidPushSubscription(sub: WebPushSubscriptionInput): boolean {
  let url: URL;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  if (!PUSH_SERVICE_HOSTS.some((re) => re.test(url.hostname.toLowerCase()))) return false;
  return base64UrlBytes(sub.keys.p256dh) === 65 && base64UrlBytes(sub.keys.auth) === 16;
}

/** Logout: the device stops receiving this account's notifications (keeps anonymous nearby pushes). */
export async function unlinkPushSubscription(db: Db, input: { userId: string; endpoint: string }): Promise<number> {
  const rows = await db
    .update(pushSubscriptions)
    .set({ userId: null })
    .where(and(eq(pushSubscriptions.endpoint, input.endpoint), eq(pushSubscriptions.userId, input.userId)))
    .returning({ id: pushSubscriptions.id });
  return rows.length;
}

export async function savePushSubscription(
  db: Db,
  input: { userId: string | null; clientId: string | null; subscription: WebPushSubscriptionInput },
) {
  if (!isValidPushSubscription(input.subscription)) {
    throw new ApiError("VALIDATION_ERROR", "Langganan notifikasi tidak valid", [
      { path: "webpush_subscription", message: "Endpoint push tidak dikenal atau kunci tidak valid" },
    ]);
  }
  const { endpoint, keys } = input.subscription;
  await db
    .insert(pushSubscriptions)
    .values({ userId: input.userId, clientId: input.clientId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: sql`COALESCE(${input.userId}::uuid, ${pushSubscriptions.userId})`,
        clientId: input.clientId,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });
}

/** What sending needs from a push_subscriptions row. */
export type PushTarget = Pick<typeof pushSubscriptions.$inferSelect, "id" | "endpoint" | "p256dh" | "auth">;

/** Options shared by the fan-out helpers. */
export type FanOutOptions = {
  /** push_subscriptions ids to skip (e.g. devices that just got a hunger alert for this event). */
  excludeIds?: readonly string[];
};

const without = <T extends { id: string }>(subs: T[], excludeIds: readonly string[] | undefined): T[] => {
  if (!excludeIds?.length) return subs;
  const skip = new Set(excludeIds);
  return subs.filter((s) => !skip.has(s.id));
};

/** Sends one payload to these devices. Returns how many accepted it. */
export function sendToSubscriptions(db: Db, subs: PushTarget[], payload: PushPayload): Promise<number> {
  return sendTo(db, subs, payload);
}

async function sendTo(db: Db, subs: PushTarget[], payload: PushPayload): Promise<number> {
  if (!ensureConfigured() || subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  let delivered = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 60 * 60,
        });
        delivered++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, s.id));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 = subscription gone (uninstalled / permission revoked).
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        } else {
          console.warn("[push] delivery failed", status ?? err);
        }
      }
    }),
  );
  return delivered;
}

export async function sendPushToUsers(
  db: Db,
  userIds: string[],
  payload: PushPayload,
  opts: FanOutOptions = {},
): Promise<number> {
  if (!userIds.length || !ensureConfigured()) return 0;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  return sendTo(db, without(subs, opts.excludeIds), payload);
}

/** Devices recently seen within `radiusM` of a point (logged in or not). */
export async function sendPushNearby(
  db: Db,
  point: { lat: number; lng: number },
  radiusM: number,
  payload: PushPayload,
  now: Date = new Date(),
  opts: FanOutOptions = {},
): Promise<number> {
  if (!ensureConfigured()) return 0;
  const since = new Date(now.getTime() - 6 * PRESENCE_ACTIVE_MINUTES * 60_000);
  const nearby = await db
    .select({ clientId: customerPresence.clientId })
    .from(customerPresence)
    .where(
      and(
        gte(customerPresence.lastSeenAt, since),
        sql`ST_DWithin(${customerPresence.geom}, ST_MakePoint(${point.lng}, ${point.lat})::geography, ${radiusM})`,
      ),
    );
  const clientIds = nearby.map((n) => n.clientId);
  if (!clientIds.length) return 0;
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(isNotNull(pushSubscriptions.clientId), inArray(pushSubscriptions.clientId, clientIds)));
  return sendTo(db, without(subs, opts.excludeIds), payload);
}
