/**
 * Accounts that belong to real people: owners of field pilot warung, and buyers who have
 * ordered at one. While OTP_DEV_MODE shows login codes on screen, anyone who knows such a
 * phone number or email could sign in as that person, so OTP login refuses them until
 * real WhatsApp/email delivery is on (see otp.ts). Demo accounts are never "real".
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, orders, users } from "@/db/schema";
import { REAL_OTP_REQUIRED_REASON } from "@/lib/contracts";
import { isDemoAccount } from "@/lib/demo-accounts";
import { ApiError } from "@/server/http";
import type { LoginIdentifier } from "./identifier";

/**
 * Deliberately neutral: it must not confirm that a number belongs to a pilot warung or
 * one of its buyers (anyone can type any number into the login form).
 */
export const REAL_OTP_REQUIRED_MESSAGE =
  "Nomor atau email ini belum bisa masuk di versi demo, karena kode masuknya harus dikirim lewat WhatsApp atau email. " +
  "Untuk mencoba aplikasi, pakai akun demo.";

export async function isRealPersonAccount(db: Db, id: LoginIdentifier): Promise<boolean> {
  const identityWhere = id.kind === "phone" ? eq(users.phoneNumber, id.value) : eq(users.email, id.value);
  const [user] = await db
    .select({ id: users.id, email: users.email, phoneNumber: users.phoneNumber })
    .from(users)
    .where(identityWhere)
    .limit(1);
  if (!user || isDemoAccount(user)) return false;

  const [owner] = await db
    .select({ one: sql<number>`1` })
    .from(merchants)
    .where(and(eq(merchants.ownerUserId, user.id), eq(merchants.isPilot, true)))
    .limit(1);
  if (owner) return true;

  const [buyer] = await db
    .select({ one: sql<number>`1` })
    .from(orders)
    .innerJoin(merchants, eq(merchants.id, orders.merchantId))
    .where(and(eq(orders.customerId, user.id), eq(merchants.isPilot, true)))
    .limit(1);
  return Boolean(buyer);
}

/** Throws 403 (details.reason REAL_OTP_REQUIRED) when dev-mode OTP must not open this account. */
export async function assertDevOtpAllowed(db: Db, id: LoginIdentifier, devMode: boolean): Promise<void> {
  if (!devMode) return;
  if (await isRealPersonAccount(db, id)) {
    throw new ApiError("FORBIDDEN", REAL_OTP_REQUIRED_MESSAGE, { reason: REAL_OTP_REQUIRED_REASON });
  }
}
