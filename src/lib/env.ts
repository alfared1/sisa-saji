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

function read<T>(name: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(raw(name));
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    throw new Error(`Invalid environment variable ${name}: ${msg}. See .env.example.`);
  }
  return parsed.data;
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
