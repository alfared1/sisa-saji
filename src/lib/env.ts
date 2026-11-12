/**
 * Server environment, validated lazily per variable so that `next build`
 * does not require runtime secrets. Each getter throws a readable error the
 * first time a misconfigured value is actually needed.
 *
 * An empty value (`KEY=`) is treated as unset.
 */
import { z } from "zod";

const DEV_SECRETS = {
  PICKUP_QR_SECRET: "dev-only-pickup-qr-secret-change-me-0123456789",
  SESSION_SECRET: "dev-only-session-secret-change-me-0123456789abcd",
  PAYMENT_WEBHOOK_SECRET: "dev-only-payment-webhook-secret-change-me-012345",
} as const;

function raw(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

/** Like raw(), without one pair of surrounding quotes (`"x"` or `'x'`) pasted from a .env file. */
function rawUnquoted(name: string): string | undefined {
  const v = raw(name);
  const m = v === undefined ? null : /^(["'])([^]*)\1$/.exec(v);
  return m ? m[2].trim() || undefined : v;
}

function check<T>(name: string, value: string | undefined, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Invalid environment variable ${name}: ${msg}. See .env.example.`);
  }
  return parsed.data;
}

function read<T>(name: string, schema: z.ZodType<T>): T {
  return check(name, raw(name), schema);
}

const reportedEnvErrors = new Set<string>();

/**
 * Runs a strict env getter on a path that must not fail (every session check, every OTP
 * request). A misconfigured variable gives `fallback` instead of throwing, and is logged once
 * per process. Only our own "Invalid environment variable NAME: rule" text is logged; it never
 * holds the value.
 */
export function readOrFallback<T>(get: () => T, fallback: T): T {
  try {
    return get();
  } catch (err) {
    const msg = err instanceof Error && err.message.startsWith("Invalid environment variable ") ? err.message : "Invalid environment variable.";
    if (!reportedEnvErrors.has(msg)) {
      reportedEnvErrors.add(msg);
      console.error(`[env] ${msg} This provider stays off until it is fixed and redeployed.`);
    }
    return fallback;
  }
}

export const isProduction = () => process.env.NODE_ENV === "production";

/** Secrets with a dev fallback; mandatory (min. 32 chars) in production. */
function secret(name: keyof typeof DEV_SECRETS): string {
  const value = read(name, z.string().min(32).optional());
  if (value) return value;
  if (isProduction() && process.env.ALLOW_DEV_SECRETS !== "true") {
    throw new Error(`${name} must be set in production (min. 32 chars). See .env.example.`);
  }
  return DEV_SECRETS[name];
}

export function getDatabaseUrl(): string {
  return read("DATABASE_URL", z.string().url());
}

export function getRedisUrl(): string | undefined {
  return read("REDIS_URL", z.string().url().optional());
}

/** HMAC secret for pickup QR tokens. */
export const getPickupQrSecret = () => secret("PICKUP_QR_SECRET");
/** HS256 key for the `ss_session` JWT cookie. */
export const getSessionSecret = () => secret("SESSION_SECRET");
/** HMAC-SHA512 key shared with the payment gateway (webhook signature). */
export const getPaymentWebhookSecret = () => secret("PAYMENT_WEBHOOK_SECRET");

/**
 * When true, OTP codes are returned in the API response (and logged) instead of
 * being sent through WhatsApp/email. Default: true outside production.
 */
export function isOtpDevMode(): boolean {
  const v = raw("OTP_DEV_MODE");
  return v === undefined ? !isProduction() : v === "true";
}

/** Resend (https://resend.com) credentials for OTP email; null when not configured. */
export function getResendConfig(): { apiKey: string; from: string } | null {
  const apiKey = read("RESEND_API_KEY", z.string().min(8).optional());
  const from = read(
    "OTP_EMAIL_FROM",
    z
      .string()
      .regex(/^(?:[^<>]*<\s*[^\s@<>]+@[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+)$/, "use name@domain or Name <name@domain>")
      .optional(),
  );
  if (!apiKey && !from) return null;
  // Half a setup would silently turn email login off: say what is missing instead.
  if (!apiKey || !from) {
    const missing = apiKey ? "OTP_EMAIL_FROM" : "RESEND_API_KEY";
    const other = apiKey ? "RESEND_API_KEY" : "OTP_EMAIL_FROM";
    throw new Error(`Invalid environment variable ${missing}: required together with ${other} for OTP email. See .env.example.`);
  }
  return { apiKey, from };
}

export type SmtpConfig = {
  host: string;
  port: number;
  /** Implicit TLS (port 465); other ports upgrade with STARTTLS. */
  secure: boolean;
  user: string;
  pass: string;
  /** Display name in the From header. The address is always SMTP_USER. */
  fromName: string;
};

/**
 * SMTP mailbox for OTP email (default: Gmail with a Google App Password); null when not
 * configured. Preferred over Resend when both are set. The From address is always
 * SMTP_USER, because Gmail rewrites any other sender (OTP_EMAIL_FROM is not used here).
 */
export function getSmtpConfig(): SmtpConfig | null {
  const user = check(
    "SMTP_USER",
    rawUnquoted("SMTP_USER"),
    z.email("use the full mailbox address, e.g. kode.sisasaji@gmail.com").optional(),
  );
  // App Passwords are shown as "abcd efgh ijkl mnop"; any whitespace pasted with it is noise.
  const pass = rawUnquoted("SMTP_PASS")?.replace(/\s+/g, "") || undefined;
  if (!user && !pass) return null;
  // Half a setup would silently turn email login off: say what is missing instead.
  if (!user || !pass) {
    const missing = user ? "SMTP_PASS" : "SMTP_USER";
    const other = user ? "SMTP_USER" : "SMTP_PASS";
    throw new Error(`Invalid environment variable ${missing}: required together with ${other} for OTP email. See .env.example.`);
  }
  const host = read("SMTP_HOST", z.string().regex(/^[^\s/:]+$/, "use a host name such as smtp.gmail.com").default("smtp.gmail.com"));
  const port = read("SMTP_PORT", z.coerce.number().int().min(1).max(65535).default(465));
  // Header-safe display name: no quotes, angle brackets or line breaks.
  const fromName = raw("SMTP_FROM_NAME")?.replace(/["<>\r\n]/g, "").trim() || "Sisa-Saji";
  return { host, port, secure: port === 465, user, pass, fromName };
}

/** Fonnte (https://fonnte.com) device token for OTP over WhatsApp; null when not configured. */
export function getFonnteToken(): string | null {
  return read("FONNTE_TOKEN", z.string().min(8).optional()) ?? null;
}

/**
 * Channels whose provider is set up (none in dev mode). Never throws: it runs on every
 * session check. A provider whose variables are set but invalid still counts (fail closed),
 * so a typo in Vercel cannot bring back sessions opened while codes were shown on screen.
 */
export function getRealOtpChannels(): { email: boolean; whatsapp: boolean } {
  if (isOtpDevMode()) return { email: false, whatsapp: false };
  // SMTP first: when it is set, Resend is not used (and its variables are not read).
  const smtp = readOrFallback(() => getSmtpConfig() !== null, true);
  const email = smtp || readOrFallback(() => getResendConfig() !== null, true);
  return { email, whatsapp: readOrFallback(() => getFonnteToken() !== null, true) };
}

/**
 * True when login codes really reach the account owner: OTP_DEV_MODE is off and at least
 * one provider (SMTP or Resend email, Fonnte WhatsApp) is configured. While false, the code is
 * shown on screen, so anyone who knows a phone number or email could log in as that
 * person: real warung (pilot) must not join, and real people's accounts stay locked.
 */
export function isRealOtpDelivery(): boolean {
  const c = getRealOtpChannels();
  return c.email || c.whatsapp;
}

/** "simulator" (default) enables /orders/:id/simulate-payment for demos. */
export function getPaymentProvider(): "simulator" | "midtrans" | "xendit" {
  return read("PAYMENT_PROVIDER", z.enum(["simulator", "midtrans", "xendit"]).default("simulator"));
}

/** VAPID keys for Web Push; push is disabled when unset. */
export function getVapidKeys(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = raw("VAPID_PUBLIC_KEY");
  const privateKey = raw("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: raw("VAPID_SUBJECT") ?? "mailto:admin@sisasaji.test" };
}

/** Public base URL (used in push notification links). */
export function getAppUrl(): string {
  return read("APP_URL", z.string().url().default("http://localhost:3000"));
}

/**
 * Shared secret for scheduled triggers (GET /api/cron/tick). Vercel Cron sends it as
 * `Authorization: Bearer <CRON_SECRET>`. Unset = the endpoint refuses every call.
 */
export function getCronSecret(): string | undefined {
  return read("CRON_SECRET", z.string().min(16).optional());
}

/**
 * Invite code the team hands to real warung joining the field pilot. Unset = the pilot
 * is closed (nobody can join). At least 8 characters so it cannot be guessed by trying.
 */
export function getPilotInviteCode(): string | undefined {
  return read("PILOT_INVITE_CODE", z.string().trim().min(8).optional());
}

/**
 * Serverless hosts have no long-running worker: when true, hot endpoints run due jobs
 * after their response (next/server `after`), guarded by DB leases (job_runs).
 * Leave false when `npm run worker` is running.
 */
export function isInlineJobsEnabled(): boolean {
  return raw("INLINE_JOBS") === "true";
}

/**
 * Public demo deployments: keep "tonight" populated by auto-publishing fresh surplus
 * batches for seeded warung whenever live batches run low (see jobs/serverless.ts).
 */
export function isDemoMode(): boolean {
  return raw("DEMO_MODE") === "true";
}

/**
 * True when what users see is sample data: a demo deployment, or any setup where
 * payments are simulated (so no order, rating or "verified" badge is real).
 */
export function isDemoData(): boolean {
  return isDemoMode() || getPaymentProvider() === "simulator";
}
