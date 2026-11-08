/**
 * SessionUser view loader that takes an explicit db (testable). Same mapping as
 * loadSessionUser() in src/server/auth/session.ts, which uses the app singleton.
 */
import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, users } from "@/db/schema";
import type { SessionUser } from "@/lib/contracts";
import type { DbOrTx } from "@/server/services/stock";

export async function sessionUserView(db: Db | DbOrTx, userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ user: users, merchantId: merchants.id, merchantSlug: merchants.slug })
    .from(users)
    .leftJoin(merchants, eq(merchants.ownerUserId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  const u = row.user;
  return {
    id: u.id,
    role: u.role,
    full_name: u.fullName,
    email: u.email,
    phone_number: u.phoneNumber,
    campus_or_area: u.campusOrArea,
    default_lat: u.defaultLat,
    default_lng: u.defaultLng,
    badge_tier: u.badgeTier,
    loyalty_points: u.loyaltyPoints,
    merchant_id: row.merchantId,
    merchant_slug: row.merchantSlug,
  };
}
