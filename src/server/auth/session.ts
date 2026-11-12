/**
 * Session = HS256 JWT in the httpOnly cookie `ss_session` (7 days).
 * The JWT carries the user id and how the login was proven; role/merchant are re-read
 * from the DB on every request so role changes and deletions take effect immediately.
 *
 * `otp: "real"` marks a session opened with a code that was really delivered by
 * WhatsApp/email. Once real delivery is on (isRealOtpDelivery), sessions without it
 * (opened while codes were shown on screen, when anyone could have typed a stranger's
 * number) no longer count, except the shared demo accounts. So switching OTP_DEV_MODE
 * off logs everyone out once, and nobody keeps an account squatted in dev mode.
 */
import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { getDb } from "@/db";
import { getSessionSecret, isProduction, isRealOtpDelivery } from "@/lib/env";
import type { SessionUser, UserRole } from "@/lib/contracts";
import { DEMO_LOCKED_MESSAGE, DEMO_LOCKED_REASON } from "@/lib/demo-accounts";
import { ApiError } from "@/server/http";
import { sessionUserView } from "@/server/services/auth/session-user";

export const SESSION_COOKIE = "ss_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const key = () => new TextEncoder().encode(getSessionSecret());

export type SessionProof = { realOtp?: boolean };

export async function signSessionToken(userId: string, proof: SessionProof = {}): Promise<string> {
  return new SignJWT(proof.realOtp ? { otp: "real" } : {})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

export type SessionClaims = { userId: string; realOtp: boolean };

export async function readSessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub, realOtp: payload.otp === "real" };
  } catch {
    return null;
  }
}

export async function verifySessionToken(token: string): Promise<string | null> {
  return (await readSessionToken(token))?.userId ?? null;
}

/**
 * Whether a session still counts. While codes are shown on screen every session does;
 * once real delivery is on, only sessions proven by a delivered code (and demo accounts).
 */
export function sessionStillValid(claims: SessionClaims, user: Pick<SessionUser, "is_demo">, realDelivery: boolean): boolean {
  return !realDelivery || claims.realOtp || user.is_demo;
}

export async function setSessionCookie(userId: string, proof: SessionProof = {}): Promise<void> {
  const token = await signSessionToken(userId, proof);
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
export function loadSessionUser(userId: string): Promise<SessionUser | null> {
  return sessionUserView(getDb(), userId);
}

/** Current user or null. Safe to call in any route handler. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await readSessionToken(token);
  if (!claims) return null;
  const user = await loadSessionUser(claims.userId);
  return user && sessionStillValid(claims, user, isRealOtpDelivery()) ? user : null;
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

/**
 * Refuses changes that would alter a shared demo account for every other visitor: its name,
 * the demo warung's profile, payout details, menus, opening state and pilot status.
 * The demo flow itself (publishing surplus, orders, pickups, reviews) stays open.
 */
export function assertDemoUnlocked(user: Pick<SessionUser, "is_demo">): void {
  if (user.is_demo) throw new ApiError("FORBIDDEN", DEMO_LOCKED_MESSAGE, { reason: DEMO_LOCKED_REASON });
}
