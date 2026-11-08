/**
 * Pure helpers shared by /auth/login and /auth/verify (client-safe, unit-tested).
 */
import type { SessionUser } from "@/lib/contracts";

export type AuthRole = "CUSTOMER" | "MERCHANT";
export type IdentifierKind = "phone" | "email";

/** sessionStorage key for the in-flight OTP request (dev code, resend cooldown). */
export const OTP_FLOW_KEY = "ss-otp-flow";
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export type OtpFlowState = {
  identifier: string;
  kind: IdentifierKind;
  role: AuthRole;
  channel: "WHATSAPP" | "EMAIL";
  /** Only when the server runs in OTP dev mode. */
  dev_code: string | null;
  /** epoch ms of the last successful request. */
  sent_at: number;
};

/** Builds the sessionStorage record after a successful OTP request. */
export function newOtpFlow(fields: Omit<OtpFlowState, "sent_at">, nowMs: number = Date.now()): OtpFlowState {
  return { ...fields, sent_at: nowMs };
}

export function parseRole(value: string | null | undefined): AuthRole {
  return value?.toUpperCase() === "MERCHANT" ? "MERCHANT" : "CUSTOMER";
}

export function parseKind(value: string | null | undefined): IdentifierKind {
  return value === "email" ? "email" : "phone";
}

/** Only same-origin absolute paths ("/x"), never "//host" or "/\\host". */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (next.startsWith("/auth/")) return null;
  return next;
}

/** Strips spaces, dashes, dots and parentheses users type in phone numbers. */
export function normalisePhoneInput(raw: string): string {
  return raw.replace(/[\s\-().]/g, "");
}

/** Where to go after a successful OTP verify. */
export function postLoginPath(user: Pick<SessionUser, "role" | "merchant_id">, requestedRole: AuthRole, next: string | null): string {
  const safe = safeNextPath(next);
  if (safe) return safe;
  if (user.merchant_id) return "/merchant/dashboard";
  if (user.role === "MERCHANT" || requestedRole === "MERCHANT") return "/merchant/onboarding";
  return "/discover";
}

/** "0812****7890" / "ra***@gmail.com" for the "kode dikirim ke …" line. */
export function maskIdentifier(identifier: string, kind: IdentifierKind): string {
  if (kind === "email") {
    const [user, domain] = identifier.split("@");
    if (!domain) return identifier;
    return `${user.slice(0, 2)}${"*".repeat(Math.max(1, Math.min(4, user.length - 2)))}@${domain}`;
  }
  if (identifier.length < 8) return identifier;
  return `${identifier.slice(0, 4)}****${identifier.slice(-4)}`;
}

/** True when an API VALIDATION_ERROR is about a missing full_name (new account). */
export function isFullNameRequired(code: string, details: unknown, message = ""): boolean {
  if (code !== "VALIDATION_ERROR") return false;
  if (Array.isArray(details)) {
    return details.some((d) => {
      if (typeof d !== "object" || d === null || !("path" in d)) return false;
      const path = (d as { path: unknown }).path;
      return path === "full_name" || (Array.isArray(path) && path.includes("full_name"));
    });
  }
  return /nama lengkap|full_name/i.test(message);
}

export function cooldownRemaining(sentAt: number | null, nowMs: number, cooldownSeconds = OTP_RESEND_COOLDOWN_SECONDS): number {
  if (!sentAt) return 0;
  return Math.max(0, Math.ceil((sentAt + cooldownSeconds * 1000 - nowMs) / 1000));
}
