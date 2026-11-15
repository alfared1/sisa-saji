/**
 * SessionUser view loader that takes an explicit db (testable). loadSessionUser() in
 * src/server/auth/session.ts calls it with the app singleton.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { merchants, merchantStaff, users } from "@/db/schema";
import type { SessionUser } from "@/lib/contracts";
import { isDemoAccount } from "@/lib/demo-accounts";
import type { DbOrTx } from "@/server/services/stock";

export async function sessionUserView(db: Db | DbOrTx, userId: string): Promise<SessionUser | null> {
  const staffOf = alias(merchants, "staff_of");
  const [row] = await db
    .select({
      user: users,
      merchantId: merchants.id,
      merchantSlug: merchants.slug,
      cashierMerchantId: staffOf.id,
      cashierMerchantName: staffOf.merchantName,
      cashierMerchantSlug: staffOf.slug,
    })
    .from(users)
    .leftJoin(merchants, eq(merchants.ownerUserId, users.id))
    .leftJoin(merchantStaff, eq(merchantStaff.userId, users.id))
    .leftJoin(staffOf, eq(staffOf.id, merchantStaff.merchantId))
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
    // An owner is never also a cashier (staff.ts refuses it); owning wins if data says both.
    cashier_of:
      !row.merchantId && row.cashierMerchantId && row.cashierMerchantName && row.cashierMerchantSlug
        ? { merchant_id: row.cashierMerchantId, merchant_name: row.cashierMerchantName, merchant_slug: row.cashierMerchantSlug }
        : null,
    is_demo: isDemoAccount(u),
  };
}
