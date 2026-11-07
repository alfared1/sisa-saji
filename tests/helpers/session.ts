/**
 * Mints a session JWT exactly like src/server/auth/session.ts (HS256, sub = user id),
 * without importing server-only/next modules. For tests and local curl smoke tests.
 */
import { SignJWT } from "jose";

const DEV_SESSION_SECRET = "dev-only-session-secret-change-me-0123456789abcd";

export async function mintSessionToken(userId: string, secret = process.env.SESSION_SECRET || DEV_SESSION_SECRET) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
}

/** Cookie header value for fetch/curl: `ss_session=<jwt>`. */
export async function sessionCookie(userId: string, secret?: string) {
  return `ss_session=${await mintSessionToken(userId, secret)}`;
}
