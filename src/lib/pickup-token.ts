/**
 * Pickup QR token: `<orderId>.<base64url HMAC-SHA256(orderId.pickupCode)>`.
 * The merchant scanner sends the token; the server recomputes the HMAC, so a
 * token cannot be forged or moved to another order without the secret.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { PICKUP_CODE_LENGTH } from "@/lib/constants";

function sign(orderId: string, pickupCode: string, secret: string): string {
  return createHmac("sha256", secret).update(`${orderId}.${pickupCode}`).digest("base64url");
}

export function createPickupToken(orderId: string, pickupCode: string, secret: string): string {
  return `${orderId}.${sign(orderId, pickupCode, secret)}`;
}

/** Returns the orderId when the token is authentic for the given pickup code, else null. */
export function verifyPickupToken(
  token: string,
  pickupCode: string,
  secret: string,
): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const orderId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(orderId, pickupCode, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return orderId;
}

/** Uniform random numeric code, e.g. "0482". */
export function generatePickupCode(): string {
  return randomInt(0, 10 ** PICKUP_CODE_LENGTH)
    .toString()
    .padStart(PICKUP_CODE_LENGTH, "0");
}
