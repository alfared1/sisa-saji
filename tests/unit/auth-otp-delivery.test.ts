/**
 * OTP delivery providers (Resend email, Fonnte WhatsApp) with a fake fetch, and the env
 * switches that decide whether login codes really reach the account owner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRealOtpChannels, getResendConfig, isRealOtpDelivery } from "@/lib/env";
import {
  FONNTE_ENDPOINT,
  RESEND_ENDPOINT,
  canDeliver,
  deliverOtp,
  maskDestination,
  type OtpMessage,
  type OtpProviders,
} from "@/server/services/auth/otp-delivery";
import { channelUnavailableMessage } from "@/server/services/auth/otp";

const CODE = "482915";
const BOTH: OtpProviders = { resend: { apiKey: "re_test_key_123", from: "Sisa-Saji <kode@sisasaji.id>" }, fonnteToken: "fonnte-token-123" };
const NONE: OtpProviders = { resend: null, fonnteToken: null };
const email: OtpMessage = { channel: "EMAIL", to: "warung@contoh.id", code: CODE, expiresInSeconds: 300 };
const wa: OtpMessage = { channel: "WHATSAPP", to: "+6281234567890", code: CODE, expiresInSeconds: 300 };

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url));
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  const capture = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => vi.restoreAllMocks());

describe("deliverOtp", () => {
  it("dev mode sends nothing and never calls a provider", async () => {
    const f = fakeFetch(() => new Response("{}"));
    const r = await deliverOtp(email, true, { providers: BOTH, fetch: f.fetch });
    expect(r).toEqual({ delivered: true, provider: "dev-console" });
    expect(f.calls).toHaveLength(0);
  });

  it("email goes to Resend with the bearer key, sender and the code in the text", async () => {
    const f = fakeFetch(() => Response.json({ id: "email_1" }));
    const r = await deliverOtp(email, false, { providers: BOTH, fetch: f.fetch });
    expect(r).toEqual({ delivered: true, provider: "resend" });
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key_123");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: "Sisa-Saji <kode@sisasaji.id>", to: ["warung@contoh.id"], subject: "Kode masuk Sisa-Saji" });
    expect(body.text).toContain(CODE);
    expect(body.text).toContain("5 menit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("WhatsApp goes to Fonnte with the device token and the number without +", async () => {
    const f = fakeFetch(() => Response.json({ status: true, detail: "success! message in queue" }));
    const r = await deliverOtp(wa, false, { providers: BOTH, fetch: f.fetch });
    expect(r).toEqual({ delivered: true, provider: "fonnte" });
    const { url, init } = f.calls[0];
    expect(url).toBe(FONNTE_ENDPOINT);
    expect((init.headers as Record<string, string>).authorization).toBe("fonnte-token-123");
    const form = new URLSearchParams(init.body as URLSearchParams);
    expect(form.get("target")).toBe("6281234567890");
    expect(form.get("countryCode")).toBe("0");
    expect(form.get("message")).toContain(CODE);
  });

  it("a provider error, a Fonnte status:false and a network failure all report not delivered", async () => {
    const r500 = await deliverOtp(email, false, { providers: BOTH, fetch: fakeFetch(() => new Response("boom", { status: 500 })).fetch });
    expect(r500).toEqual({ delivered: false, provider: "resend" });

    const rFalse = await deliverOtp(wa, false, {
      providers: BOTH,
      fetch: fakeFetch(() => Response.json({ status: false, reason: `device disconnected ${CODE}` })).fetch,
    });
    expect(rFalse).toEqual({ delivered: false, provider: "fonnte" });

    const rNet = await deliverOtp(wa, false, {
      providers: BOTH,
      fetch: fakeFetch(() => {
        throw new TypeError(`fetch failed for ${CODE}`);
      }).fetch,
    });
    expect(rNet).toEqual({ delivered: false, provider: "fonnte" });
  });

  it("never logs the code, the token or the full destination outside dev mode", async () => {
    await deliverOtp(email, false, { providers: BOTH, fetch: fakeFetch(() => new Response(CODE, { status: 422 })).fetch });
    await deliverOtp(wa, false, {
      providers: BOTH,
      fetch: fakeFetch(() => {
        throw new Error(`socket hang up ${CODE}`);
      }).fetch,
    });
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join("\n");
    expect(all).not.toContain(CODE);
    expect(all).not.toContain("fonnte-token-123");
    expect(all).not.toContain("re_test_key_123");
    expect(all).not.toContain("+6281234567890");
    expect(all).not.toContain("warung@contoh.id");
  });

  it("without a provider for the channel nothing is sent", async () => {
    const f = fakeFetch(() => Response.json({}));
    expect(await deliverOtp(email, false, { providers: NONE, fetch: f.fetch })).toEqual({ delivered: false, provider: null });
    expect(await deliverOtp(wa, false, { providers: NONE, fetch: f.fetch })).toEqual({ delivered: false, provider: null });
    expect(f.calls).toHaveLength(0);
  });
});

describe("channel availability", () => {
  it("canDeliver follows the configured providers", () => {
    expect(canDeliver("EMAIL", BOTH)).toBe(true);
    expect(canDeliver("WHATSAPP", { ...BOTH, fonnteToken: null })).toBe(false);
    expect(canDeliver("EMAIL", { ...BOTH, resend: null })).toBe(false);
  });

  it("points to the other channel when only that one works", () => {
    expect(channelUnavailableMessage("WHATSAPP", { ...NONE, resend: BOTH.resend })).toMatch(/Masuk dengan email/);
    expect(channelUnavailableMessage("EMAIL", { ...NONE, fonnteToken: "x".repeat(10) })).toMatch(/nomor WhatsApp/);
    expect(channelUnavailableMessage("EMAIL", NONE)).toMatch(/belum bisa dikirim/);
  });

  it("masks destinations for logs", () => {
    expect(maskDestination("+6281234567890")).toBe("+62812•••••890");
    expect(maskDestination("warung@contoh.id")).toBe("wa•••@contoh.id");
  });
});

describe("env: isRealOtpDelivery", () => {
  const KEYS = ["OTP_DEV_MODE", "RESEND_API_KEY", "OTP_EMAIL_FROM", "FONNTE_TOKEN"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("is false in dev mode even with providers configured", () => {
    process.env.OTP_DEV_MODE = "true";
    process.env.FONNTE_TOKEN = "fonnte-token-123";
    process.env.RESEND_API_KEY = "re_test_key_123";
    process.env.OTP_EMAIL_FROM = "kode@sisasaji.id";
    expect(isRealOtpDelivery()).toBe(false);
    expect(getRealOtpChannels()).toEqual({ email: false, whatsapp: false });
  });

  it("is false with dev mode off but no provider", () => {
    process.env.OTP_DEV_MODE = "false";
    expect(isRealOtpDelivery()).toBe(false);
  });

  it("is true with dev mode off and one provider", () => {
    process.env.OTP_DEV_MODE = "false";
    process.env.FONNTE_TOKEN = "fonnte-token-123";
    expect(isRealOtpDelivery()).toBe(true);
    expect(getRealOtpChannels()).toEqual({ email: false, whatsapp: true });
  });

  it("Resend needs both the key and a valid sender", () => {
    process.env.OTP_DEV_MODE = "false";
    expect(getResendConfig()).toBeNull();
    // Half a setup is an error, not a silently disabled channel.
    process.env.RESEND_API_KEY = "re_test_key_123";
    expect(() => getResendConfig()).toThrow(/OTP_EMAIL_FROM/);
    expect(() => getRealOtpChannels()).toThrow(/OTP_EMAIL_FROM/);
    delete process.env.RESEND_API_KEY;
    process.env.OTP_EMAIL_FROM = "kode@sisasaji.id";
    expect(() => getResendConfig()).toThrow(/RESEND_API_KEY/);
    process.env.RESEND_API_KEY = "re_test_key_123";
    process.env.OTP_EMAIL_FROM = "Sisa-Saji <kode@sisasaji.id>";
    expect(getResendConfig()).toEqual({ apiKey: "re_test_key_123", from: "Sisa-Saji <kode@sisasaji.id>" });
    expect(getRealOtpChannels()).toEqual({ email: true, whatsapp: false });
    process.env.OTP_EMAIL_FROM = "bukan email";
    expect(() => getResendConfig()).toThrow(/OTP_EMAIL_FROM/);
  });
});
