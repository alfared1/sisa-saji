/**
 * OTP delivery. Two optional providers over plain HTTPS (no SDK):
 *
 *  - email:    Resend (RESEND_API_KEY + OTP_EMAIL_FROM), POST https://api.resend.com/emails
 *  - WhatsApp: Fonnte (FONNTE_TOKEN),                    POST https://api.fonnte.com/send
 *
 * Each provider is on only when its variables are set (src/lib/env.ts). With
 * OTP_DEV_MODE=true nothing is sent: the code is logged and returned to the client as
 * `dev_code`. Outside dev mode the code and the credentials are never logged, and
 * neither are provider error bodies (they may echo the message).
 */
import "server-only";
import { getFonnteToken, getResendConfig } from "@/lib/env";
import type { OtpChannel } from "./identifier";

export type OtpDeliveryResult = { delivered: boolean; provider: string | null };

export interface OtpMessage {
  channel: OtpChannel;
  /** Normalised phone (+62…) or lower-cased email. */
  to: string;
  code: string;
  expiresInSeconds: number;
}

/** Provider credentials; null = that channel has no provider. */
export type OtpProviders = {
  resend: { apiKey: string; from: string } | null;
  fonnteToken: string | null;
};

/** Injected in tests; defaults to the env-configured providers and the global fetch. */
export type OtpDeliveryDeps = { providers?: OtpProviders; fetch?: typeof fetch; timeoutMs?: number };

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const FONNTE_ENDPOINT = "https://api.fonnte.com/send";
const DEFAULT_TIMEOUT_MS = 10_000;

export function configuredOtpProviders(): OtpProviders {
  return { resend: getResendConfig(), fonnteToken: getFonnteToken() };
}

/** True when `channel` has a provider in `providers`. */
export function canDeliver(channel: OtpChannel, providers: OtpProviders): boolean {
  return channel === "EMAIL" ? providers.resend !== null : providers.fonnteToken !== null;
}

/** Text sent to the user (Indonesian). */
export function otpMessageText(code: string, expiresInSeconds: number): string {
  const minutes = Math.round(expiresInSeconds / 60);
  return `Kode masuk Sisa-Saji kamu: ${code}. Berlaku ${minutes} menit. Jangan berikan kode ini kepada siapa pun.`;
}

/** "+6281234567890" → "+62812•••••890", "nama@kampus.ac.id" → "na•••@kampus.ac.id" (for logs). */
export function maskDestination(to: string): string {
  const at = to.indexOf("@");
  if (at > 0) return `${to.slice(0, Math.min(2, at))}•••${to.slice(at)}`;
  return to.length > 9 ? `${to.slice(0, 6)}•••••${to.slice(-3)}` : "•••";
}

function emailHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5">${escaped}</p>`;
}

async function sendResend(
  msg: OtpMessage,
  cfg: { apiKey: string; from: string },
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const text = otpMessageText(msg.code, msg.expiresInSeconds);
  const res = await doFetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: "Kode masuk Sisa-Saji", text, html: emailHtml(text) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    console.warn(`[otp] Resend menolak pengiriman ke ${maskDestination(msg.to)} (HTTP ${res.status}).`);
    return false;
  }
  return true;
}

async function sendFonnte(msg: OtpMessage, token: string, doFetch: typeof fetch, timeoutMs: number): Promise<boolean> {
  // Stored numbers are +62…; Fonnte takes digits. countryCode "0" = send to the number as given.
  const body = new URLSearchParams({
    target: msg.to.replace(/^\+/, ""),
    message: otpMessageText(msg.code, msg.expiresInSeconds),
    countryCode: "0",
  });
  const res = await doFetch(FONNTE_ENDPOINT, {
    method: "POST",
    headers: { authorization: token, "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Fonnte answers 200 with { status: false, reason } for errors such as a disconnected device.
  const json = (await res.json().catch(() => null)) as { status?: unknown } | null;
  if (!res.ok || json?.status !== true) {
    console.warn(`[otp] Fonnte menolak pengiriman ke ${maskDestination(msg.to)} (HTTP ${res.status}).`);
    return false;
  }
  return true;
}

async function sendViaProvider(msg: OtpMessage, deps: OtpDeliveryDeps): Promise<OtpDeliveryResult> {
  const providers = deps.providers ?? configuredOtpProviders();
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const provider = msg.channel === "EMAIL" ? "resend" : "fonnte";
  try {
    if (msg.channel === "EMAIL") {
      if (!providers.resend) return { delivered: false, provider: null };
      return { delivered: await sendResend(msg, providers.resend, doFetch, timeoutMs), provider };
    }
    if (!providers.fonnteToken) return { delivered: false, provider: null };
    return { delivered: await sendFonnte(msg, providers.fonnteToken, doFetch, timeoutMs), provider };
  } catch (err) {
    // Network error or timeout. Only the error name: messages can carry request details.
    const name = err instanceof Error ? err.name : "Error";
    console.warn(`[otp] Pengiriman lewat ${provider} ke ${maskDestination(msg.to)} gagal (${name}).`);
    return { delivered: false, provider };
  }
}

export async function deliverOtp(msg: OtpMessage, devMode: boolean, deps: OtpDeliveryDeps = {}): Promise<OtpDeliveryResult> {
  if (devMode) {
    console.log(`[otp] (dev) ${msg.channel} ${msg.to}: ${msg.code}`);
    return { delivered: true, provider: "dev-console" };
  }
  return sendViaProvider(msg, deps);
}
