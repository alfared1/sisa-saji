/**
 * Session = HS256 JWT in the httpOnly cookie `ss_session` (7 days).
 * The JWT carries only the user id; role/merchant are re-read from the DB on
 * every request so role changes and deletions take effect immediately.
 */
import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { getDb } from "@/db";
import { merchants, users } from "@/db/schema";
import { getSessionSecret, isProduction } from "@/lib/env";
import type { SessionUser, UserRole } from "@/lib/contracts";
import { ApiError } from "@/server/http";

export const SESSION_COOKIE = "ss_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const key = () => new TextEncoder().encode(getSessionSecret());

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await signSessionToken(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Loads the SessionUser view for a user id (null if the user no longer exists). */
export async function loadSessionUser(userId: string): Promise<SessionUser | null> {
  const db = getDb();
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

/** Current user or null. Safe to call in any route handler. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySessionToken(token);
  return userId ? loadSessionUser(userId) : null;
}

/** Throws 401 when logged out, 403 when the role is not allowed. MERCHANT users may also act as customers. */
export async function requireUser(...roles: UserRole[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError("UNAUTHENTICATED", "Silakan masuk terlebih dahulu");
  if (roles.length && !roles.includes(user.role) && user.role !== "ADMIN") {
    throw new ApiError("FORBIDDEN", "Akses ditolak untuk peran ini");
  }
  return user;
}

/** Current user who owns a warung; returns both. */
export async function requireMerchant(): Promise<{ user: SessionUser; merchantId: string }> {
  const user = await requireUser();
  if (!user.merchant_id) {
    throw new ApiError("MERCHANT_REQUIRED", "Akun ini belum terdaftar sebagai mitra warung");
  }
  return { user, merchantId: user.merchant_id };
}
