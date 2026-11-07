/**
 * Customer presence (replaces Redis GEO "active users in 2 km").
 * The browser pings PUT /api/v1/profile/location-push with a random client_id.
 */
import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customerPresence } from "@/db/schema";
import { DEFAULT_SEARCH_RADIUS_M, PRESENCE_ACTIVE_MINUTES } from "@/lib/constants";

export async function upsertPresence(
  db: Db,
  input: { clientId: string; userId: string | null; lat: number; lng: number; now?: Date },
) {
  const now = input.now ?? new Date();
  await db
    .insert(customerPresence)
    .values({ clientId: input.clientId, userId: input.userId, latitude: input.lat, longitude: input.lng, lastSeenAt: now })
    .onConflictDoUpdate({
      target: customerPresence.clientId,
      set: {
        // Keep a known user id if a later anonymous ping arrives from the same device.
        userId: sql`COALESCE(${input.userId}::uuid, ${customerPresence.userId})`,
        latitude: input.lat,
        longitude: input.lng,
        lastSeenAt: now,
      },
    });
}

/** Devices seen within PRESENCE_ACTIVE_MINUTES inside `radiusM` of a point. */
export async function countActiveUsersNear(
  db: Db,
  lat: number,
  lng: number,
  radiusM: number = DEFAULT_SEARCH_RADIUS_M,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - PRESENCE_ACTIVE_MINUTES * 60_000);
  const { rows } = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM customer_presence
    WHERE last_seen_at >= ${since}
      AND ST_DWithin(geom, ST_MakePoint(${lng}, ${lat})::geography, ${radiusM})`);
  return rows[0]?.n ?? 0;
}
