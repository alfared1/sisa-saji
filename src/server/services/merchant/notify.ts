/**
 * Web Push fan-out for merchant events. Never throws: a failed notification must
 * not fail a publish or a job run.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customerMerchantSubscriptions } from "@/db/schema";
import { sendPushNearby, sendPushToUsers, type PushPayload } from "@/server/services/push";

export type SubscriberFlag = "notify_on_surplus_live" | "notify_on_ai_prediction";

export async function subscriberIds(db: Db, merchantId: string, flag: SubscriberFlag): Promise<string[]> {
  const col =
    flag === "notify_on_surplus_live"
      ? customerMerchantSubscriptions.notifyOnSurplusLive
      : customerMerchantSubscriptions.notifyOnAiPrediction;
  const rows = await db
    .select({ userId: customerMerchantSubscriptions.userId })
    .from(customerMerchantSubscriptions)
    .where(and(eq(customerMerchantSubscriptions.merchantId, merchantId), eq(col, true)));
  return rows.map((r) => r.userId);
}

/** Pushes to the merchant's subscribers (flag) and/or devices near the warung. Returns devices reached. */
export async function notifyMerchantAudience(
  db: Db,
  opts: {
    merchantId: string;
    point: { lat: number; lng: number };
    subscribers?: SubscriberFlag;
    nearbyRadiusM?: number;
    payload: PushPayload;
    now?: Date;
  },
): Promise<number> {
  let delivered = 0;
  try {
    if (opts.subscribers) {
      const ids = await subscriberIds(db, opts.merchantId, opts.subscribers);
      delivered += await sendPushToUsers(db, ids, opts.payload);
    }
    if (opts.nearbyRadiusM) {
      delivered += await sendPushNearby(db, opts.point, opts.nearbyRadiusM, opts.payload, opts.now);
    }
  } catch (err) {
    console.warn("[notify] push fan-out failed", err instanceof Error ? err.message : err);
  }
  return delivered;
}
