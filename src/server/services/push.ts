/**
 * Web Push (VAPID). Disabled gracefully when VAPID keys are not configured.
 * Subscriptions are stored per device in push_subscriptions.
 */
import "server-only";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import webpush from "web-push";
import type { Db } from "@/db/client";
import { customerPresence, pushSubscriptions } from "@/db/schema";
import { getVapidKeys } from "@/lib/env";
import type { WebPushSubscriptionInput } from "@/lib/contracts";
import { PRESENCE_ACTIVE_MINUTES } from "@/lib/constants";

export type PushPayload = {
  title: string;
  body: string;
  /** Path to open on click, e.g. "/warung/warung-bu-sri-pogung". */
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

export async function savePushSubscription(
  db: Db,
  input: { userId: string | null; clientId: string | null; subscription: WebPushSubscriptionInput },
) {
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

type SubRow = typeof pushSubscriptions.$inferSelect;

async function sendTo(db: Db, subs: SubRow[], payload: PushPayload): Promise<number> {
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

export async function sendPushToUsers(db: Db, userIds: string[], payload: PushPayload): Promise<number> {
  if (!userIds.length || !ensureConfigured()) return 0;
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  return sendTo(db, subs, payload);
}

/** Devices recently seen within `radiusM` of a point (logged in or not). */
export async function sendPushNearby(
  db: Db,
  point: { lat: number; lng: number },
  radiusM: number,
  payload: PushPayload,
  now: Date = new Date(),
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
  return sendTo(db, subs, payload);
}
