/**
 * OTP delivery. Optional providers, each on only when its variables are set (src/lib/env.ts):
 *
 *  - email:    SMTP mailbox, e.g. Gmail + App Password (SMTP_USER + SMTP_PASS), via nodemailer;
 *              otherwise Resend (RESEND_API_KEY + OTP_EMAIL_FROM), POST https://api.resend.com/emails.
 *              When both are set, SMTP is used and Resend is skipped.
 *  - WhatsApp: Fonnte (FONNTE_TOKEN), POST https://api.fonnte.com/send
 *
 * With OTP_DEV_MODE=true nothing is sent: the code is logged and returned to the client as
 * `dev_code`. Outside dev mode the code and the credentials are never logged, and neither
 * are provider error bodies or SMTP replies (they may echo the message or the address).
 *
 * A failed send says why (`failure`), so the user is not told to check an address that is
 * fine: PROVIDER_CONFIG (our key/password/sender/device is wrong), QUOTA (the mailbox hit its
 * daily sending limit), RECIPIENT (the provider refused this address or number) or TEMPORARY
 * (timeout, network, provider outage).
 */
import "server-only";
import { createTransport } from "nodemailer";
import type { OtpDeliveryFailureReason } from "@/lib/contracts";
import { getFonnteToken, getResendConfig, getSmtpConfig, readOrFallback, type SmtpConfig } from "@/lib/env";
import type { OtpChannel } from "./identifier";

export type OtpDeliveryResult = {
  delivered: boolean;
  provider: string | null;
  /** Why it was not delivered (absent when delivered or when the channel has no provider). */
  failure?: OtpDeliveryFailureReason;
};

export interface OtpMessage {
  channel: OtpChannel;
  /** Normalised phone (+62…) or lower-cased email. */
  to: string;
  code: string;
  expiresInSeconds: number;
}

/** Provider credentials; null = that channel has no provider. */
export type OtpProviders = {
  /** SMTP mailbox for email; wins over `resend` when both are set. */
  smtp?: SmtpConfig | null;
  resend: { apiKey: string; from: string } | null;
  fonnteToken: string | null;
};

/** One email as handed to the SMTP transport. */
export type SmtpMail = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  html: string;
};
/** The part of a nodemailer transporter the SMTP sender uses (a fake in tests). */
export type SmtpMailer = { sendMail(mail: SmtpMail): Promise<unknown> };

/** Injected in tests; defaults to the env-configured providers, the global fetch and nodemailer. */
export type OtpDeliveryDeps = {
  providers?: OtpProviders;
  fetch?: typeof fetch;
  timeoutMs?: number;
  smtpMailer?: (cfg: SmtpConfig, timeoutMs: number) => SmtpMailer;
};

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const FONNTE_ENDPOINT = "https://api.fonnte.com/send";
const DEFAULT_TIMEOUT_MS = 10_000;
const EMAIL_SUBJECT = "Kode masuk Sisa-Saji";

/**
 * Providers from the environment. Never throws: a channel whose variables are set but
 * invalid is left without a provider (logged once by readOrFallback), so its requests get
 * the PROVIDER_CONFIG answer and the other channel keeps working.
 */
export function configuredOtpProviders(): OtpProviders {
  const smtp = readOrFallback<SmtpConfig | null | "invalid">(getSmtpConfig, "invalid");
  // SMTP wins, even when broken: Resend variables left over from an earlier setup are not read.
  const resend = smtp === null ? readOrFallback(getResendConfig, null) : null;
  return { smtp: smtp === "invalid" ? null : smtp, resend, fonnteToken: readOrFallback(getFonnteToken, null) };
}

/** True when `channel` has a provider in `providers`. */
export function canDeliver(channel: OtpChannel, providers: OtpProviders): boolean {
  return channel === "EMAIL" ? Boolean(providers.smtp) || providers.resend !== null : providers.fonnteToken !== null;
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

/**
 * HTTP status of a refused provider call: a 4xx means our request or credentials are wrong
 * (401/403 bad or restricted key, Resend 403 unverified domain, 422 invalid sender), except
 * 408/409/429 (timeout, conflict, quota), which pass like a 5xx.
 */
export function classifyHttpStatus(status: number): OtpDeliveryFailureReason {
  return status >= 400 && status < 500 && ![408, 409, 429].includes(status) ? "PROVIDER_CONFIG" : "TEMPORARY";
}

/** Classifies a nodemailer error. Nothing read here is logged. */
export function classifySmtpError(err: unknown): OtpDeliveryFailureReason {
  const e = (typeof err === "object" && err !== null ? err : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const code = str(e.code);
  const original = str(e.originalCode);
  const command = str(e.command).toUpperCase();
  const reply = typeof e.responseCode === "number" ? e.responseCode : 0;
  // A 4xx reply is temporary by definition, even to AUTH (Gmail: "454 4.7.0 Too many login attempts").
  if (reply >= 400 && reply < 500) return "TEMPORARY";
  // Daily sending limit (Gmail: "550 5.4.5 Daily user sending limit exceeded"): email is out
  // until the limit resets, which can take up to a day.
  if (/\b5\.4\.5\b|limit exceeded|quota/i.test(str(e.response))) return "QUOTA";
  // The connection dropped during the STARTTLS upgrade: usually a network hiccup.
  if (code === "ETLS" && /closed unexpectedly/i.test(str(e.message))) return "TEMPORARY";
  // Wrong App Password / user (535), auth required (530), or 2-Step Verification missing (534).
  if (["EAUTH", "ENOAUTH", "EOAUTH2", "ECONFIG", "ETLS"].includes(code) || [530, 534, 535].includes(reply)) {
    return "PROVIDER_CONFIG";
  }
  // Wrong SMTP_HOST or SMTP_PORT.
  if (["ENOTFOUND", "ECONNREFUSED"].includes(original) || ["ENOTFOUND", "ECONNREFUSED"].includes(code)) {
    return "PROVIDER_CONFIG";
  }
  if (reply >= 500 && command.startsWith("RCPT")) return "RECIPIENT";
  if (code === "EENVELOPE" && Array.isArray(e.rejected) && e.rejected.length > 0) return "RECIPIENT";
  // The server refused our sender (invalid From) or the envelope itself.
  if ((reply >= 500 && command.startsWith("MAIL")) || code === "EENVELOPE") return "PROVIDER_CONFIG";
  return "TEMPORARY";
}

/** Fonnte answers 200 with { status: false, reason } for most errors; the reason picks the kind. */
export function classifyFonnte(status: number, reason: string): OtpDeliveryFailureReason {
  if (status === 401 || status === 403 || /token|unauthori[sz]ed|disconnect|device|package|quota|expired/i.test(reason)) {
    return "PROVIDER_CONFIG";
  }
  if (/target|number|nomor|not registered|invalid/i.test(reason)) return "RECIPIENT";
  return status >= 400 ? classifyHttpStatus(status) : "TEMPORARY";
}

/** Node SMTP options: implicit TLS on 465, STARTTLS required otherwise, short timeouts. */
export function smtpTransportOptions(cfg: SmtpConfig, timeoutMs: number) {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: !cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  };
}

// One transporter per process (and per configuration), reused across requests.
let smtpCache: { key: string; mailer: SmtpMailer } | null = null;

function defaultSmtpMailer(cfg: SmtpConfig, timeoutMs: number): SmtpMailer {
  const key = JSON.stringify([cfg.host, cfg.port, cfg.user, cfg.pass, timeoutMs]);
  if (smtpCache?.key !== key) {
    const transport = createTransport(smtpTransportOptions(cfg, timeoutMs));
    smtpCache = { key, mailer: { sendMail: (mail) => transport.sendMail(mail) } };
  }
  return smtpCache.mailer;
}

/** Safe summary of an SMTP error for logs: codes only, never the server reply or the message. */
function smtpErrorLabel(err: unknown): string {
  const e = (typeof err === "object" && err !== null ? err : {}) as Record<string, unknown>;
  const parts = [typeof e.code === "string" ? e.code : err instanceof Error ? err.name : "Error"];
  if (typeof e.originalCode === "string") parts.push(e.originalCode);
  if (typeof e.responseCode === "number") parts.push(String(e.responseCode));
  return parts.join(" ");
}

/** Each sender resolves to null when delivered, or why it was not. */
type SendOutcome = OtpDeliveryFailureReason | null;

async function sendSmtp(msg: OtpMessage, cfg: SmtpConfig, mailer: SmtpMailer): Promise<SendOutcome> {
  const text = otpMessageText(msg.code, msg.expiresInSeconds);
  try {
    await mailer.sendMail({
      // Gmail rewrites any other sender, so the address is always the mailbox itself.
      from: { name: cfg.fromName, address: cfg.user },
      to: msg.to,
      subject: EMAIL_SUBJECT,
      text,
      html: emailHtml(text),
    });
    return null;
  } catch (err) {
    const failure = classifySmtpError(err);
    console.warn(`[otp] SMTP gagal mengirim ke ${maskDestination(msg.to)} (${smtpErrorLabel(err)}; ${failure}).`);
    return failure;
  }
}

async function sendResend(
  msg: OtpMessage,
  cfg: { apiKey: string; from: string },
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<SendOutcome> {
  const text = otpMessageText(msg.code, msg.expiresInSeconds);
  const res = await doFetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: EMAIL_SUBJECT, text, html: emailHtml(text) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.ok) return null;
  // Resend names the field it refused; only a refused `to` is about the user's address.
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  const failure =
    res.status === 422 && typeof body?.message === "string" && /`to`/.test(body.message) ? "RECIPIENT" : classifyHttpStatus(res.status);
  console.warn(`[otp] Resend menolak pengiriman ke ${maskDestination(msg.to)} (HTTP ${res.status}; ${failure}).`);
  return failure;
}

async function sendFonnte(msg: OtpMessage, token: string, doFetch: typeof fetch, timeoutMs: number): Promise<SendOutcome> {
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
  const json = (await res.json().catch(() => null)) as { status?: unknown; reason?: unknown } | null;
  if (res.ok && json?.status === true) return null;
  const failure = classifyFonnte(res.status, typeof json?.reason === "string" ? json.reason : "");
  console.warn(`[otp] Fonnte menolak pengiriman ke ${maskDestination(msg.to)} (HTTP ${res.status}; ${failure}).`);
  return failure;
}

async function sendViaProvider(msg: OtpMessage, deps: OtpDeliveryDeps): Promise<OtpDeliveryResult> {
  const providers = deps.providers ?? configuredOtpProviders();
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const smtp = msg.channel === "EMAIL" ? (providers.smtp ?? null) : null;
  const provider = msg.channel === "WHATSAPP" ? "fonnte" : smtp ? "smtp" : "resend";
  const result = (failure: SendOutcome): OtpDeliveryResult =>
    failure ? { delivered: false, provider, failure } : { delivered: true, provider };
  try {
    if (smtp) return result(await sendSmtp(msg, smtp, (deps.smtpMailer ?? defaultSmtpMailer)(smtp, timeoutMs)));
    if (msg.channel === "EMAIL") {
      if (!providers.resend) return { delivered: false, provider: null };
      return result(await sendResend(msg, providers.resend, doFetch, timeoutMs));
    }
    if (!providers.fonnteToken) return { delivered: false, provider: null };
    return result(await sendFonnte(msg, providers.fonnteToken, doFetch, timeoutMs));
  } catch (err) {
    // Network error or timeout. Only the error name: messages can carry request details.
    const name = err instanceof Error ? err.name : "Error";
    console.warn(`[otp] Pengiriman lewat ${provider} ke ${maskDestination(msg.to)} gagal (${name}).`);
    return { delivered: false, provider, failure: "TEMPORARY" };
  }
}

export async function deliverOtp(msg: OtpMessage, devMode: boolean, deps: OtpDeliveryDeps = {}): Promise<OtpDeliveryResult> {
  if (devMode) {
    console.log(`[otp] (dev) ${msg.channel} ${msg.to}: ${msg.code}`);
    return { delivered: true, provider: "dev-console" };
  }
  return sendViaProvider(msg, deps);
}
