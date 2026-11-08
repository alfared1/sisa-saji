/**
 * OTP delivery — integration point for a real WhatsApp / email provider.
 *
 * To go live, implement `sendViaProvider` (e.g. WhatsApp Business Cloud API,
 * Fonnte/Wablas, or an SMTP/Resend email sender), read its credentials from
 * src/lib/env.ts, and set OTP_DEV_MODE=false. Until then, in dev mode the code
 * is logged and returned to the client as `dev_code`.
 */
import "server-only";
import type { OtpChannel } from "./identifier";

export type OtpDeliveryResult = { delivered: boolean; provider: string | null };

export interface OtpMessage {
  channel: OtpChannel;
  /** Normalised phone (+62…) or lower-cased email. */
  to: string;
  code: string;
  expiresInSeconds: number;
}

/** Text sent to the user (Indonesian). */
export function otpMessageText(code: string, expiresInSeconds: number): string {
  const minutes = Math.round(expiresInSeconds / 60);
  return `Kode masuk Sisa-Saji kamu: ${code}. Berlaku ${minutes} menit. Jangan berikan kode ini kepada siapa pun.`;
}

/**
 * Provider hook. Returns `delivered: false` while no provider is configured.
 * Never log the code here in production.
 */
async function sendViaProvider(msg: OtpMessage): Promise<OtpDeliveryResult> {
  console.warn(
    `[otp] Tidak ada penyedia ${msg.channel === "WHATSAPP" ? "WhatsApp" : "email"} yang dikonfigurasi; ` +
      "kode OTP tidak terkirim. Hubungkan penyedia di src/server/services/auth/otp-delivery.ts.",
  );
  return { delivered: false, provider: null };
}

export async function deliverOtp(msg: OtpMessage, devMode: boolean): Promise<OtpDeliveryResult> {
  if (devMode) {
    console.log(`[otp] (dev) ${msg.channel} ${msg.to}: ${msg.code}`);
    return { delivered: true, provider: "dev-console" };
  }
  return sendViaProvider(msg);
}
