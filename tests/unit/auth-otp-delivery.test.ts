/**
 * OTP delivery providers (SMTP or Resend email, Fonnte WhatsApp) with a fake fetch and a
 * mocked nodemailer transport, the failure kinds and the messages the user sees, and the
 * env switches that decide whether login codes really reach the account owner.
 * Nothing here opens a network connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRealOtpChannels, getResendConfig, getSmtpConfig, isRealOtpDelivery, type SmtpConfig } from "@/lib/env";
import {
  FONNTE_ENDPOINT,
  RESEND_ENDPOINT,
  canDeliver,
  classifyFonnte,
  classifyHttpStatus,
  classifySmtpError,
  configuredOtpProviders,
  deliverOtp,
  maskDestination,
  type OtpDeliveryDeps,
  type OtpMessage,
  type OtpProviders,
  type SmtpMail,
} from "@/server/services/auth/otp-delivery";
import { alternativeChannel, channelUnavailableMessage, deliveryFailureMessage } from "@/server/services/auth/otp";

// The default SMTP path builds its transporter with nodemailer: never a real connection here.
const nodemailerMock = vi.hoisted(() => ({
  sendMail: vi.fn<(mail: unknown) => Promise<unknown>>(),
  createTransport: vi.fn<(options: unknown) => unknown>(),
}));
vi.mock("nodemailer", () => ({ createTransport: nodemailerMock.createTransport }));

const CODE = "482915";
const BOTH: OtpProviders = { resend: { apiKey: "re_test_key_123", from: "Sisa-Saji <kode@sisasaji.id>" }, fonnteToken: "fonnte-token-123" };
const NONE: OtpProviders = { resend: null, fonnteToken: null };
const SMTP: SmtpConfig = {
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  user: "kode.sisasaji@gmail.com",
  pass: "abcdefghijklmnop",
  fromName: "Sisa-Saji",
};
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
    expect(r500).toEqual({ delivered: false, provider: "resend", failure: "TEMPORARY" });

    const rFalse = await deliverOtp(wa, false, {
      providers: BOTH,
      fetch: fakeFetch(() => Response.json({ status: false, reason: `device disconnected ${CODE}` })).fetch,
    });
    expect(rFalse).toEqual({ delivered: false, provider: "fonnte", failure: "PROVIDER_CONFIG" });

    const rNet = await deliverOtp(wa, false, {
      providers: BOTH,
      fetch: fakeFetch(() => {
        throw new TypeError(`fetch failed for ${CODE}`);
      }).fetch,
    });
    expect(rNet).toEqual({ delivered: false, provider: "fonnte", failure: "TEMPORARY" });
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
  const KEYS = [
    "OTP_DEV_MODE",
    "RESEND_API_KEY",
    "OTP_EMAIL_FROM",
    "FONNTE_TOKEN",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_FROM_NAME",
  ] as const;
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
    // The session check never throws: a broken provider still counts as set up (fail closed).
    expect(getRealOtpChannels()).toEqual({ email: true, whatsapp: false });
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

  it("SMTP: defaults to Gmail on 465 and strips spaces from the App Password", () => {
    process.env.OTP_DEV_MODE = "false";
    expect(getSmtpConfig()).toBeNull();
    process.env.SMTP_USER = "kode.sisasaji@gmail.com";
    process.env.SMTP_PASS = " abcd efgh\tijkl  mnop ";
    expect(getSmtpConfig()).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      user: "kode.sisasaji@gmail.com",
      pass: "abcdefghijklmnop",
      fromName: "Sisa-Saji",
    });
    expect(getRealOtpChannels()).toEqual({ email: true, whatsapp: false });
    expect(isRealOtpDelivery()).toBe(true);

    process.env.SMTP_HOST = "smtp.example.id";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_FROM_NAME = 'Kode "Sisa-Saji" <x>';
    expect(getSmtpConfig()).toMatchObject({ host: "smtp.example.id", port: 587, secure: false, fromName: "Kode Sisa-Saji x" });
    process.env.SMTP_PORT = "bukan-port";
    expect(() => getSmtpConfig()).toThrow(/Invalid environment variable SMTP_PORT/);
  });

  it("SMTP: half a setup, or a user that is not an email address, is an error", () => {
    process.env.OTP_DEV_MODE = "false";
    process.env.SMTP_USER = "kode.sisasaji@gmail.com";
    expect(() => getSmtpConfig()).toThrow(/Invalid environment variable SMTP_PASS/);
    expect(getRealOtpChannels()).toEqual({ email: true, whatsapp: false });
    process.env.SMTP_PASS = "   ";
    expect(() => getSmtpConfig()).toThrow(/SMTP_PASS/);
    delete process.env.SMTP_USER;
    process.env.SMTP_PASS = "abcd efgh ijkl mnop";
    expect(() => getSmtpConfig()).toThrow(/Invalid environment variable SMTP_USER/);
    process.env.SMTP_USER = "kode.sisasaji";
    expect(() => getSmtpConfig()).toThrow(/Invalid environment variable SMTP_USER/);
  });

  it("SMTP wins over Resend, and leftover Resend variables are not read", () => {
    process.env.OTP_DEV_MODE = "false";
    process.env.SMTP_USER = "kode.sisasaji@gmail.com";
    process.env.SMTP_PASS = "abcdefghijklmnop";
    process.env.RESEND_API_KEY = "re_test_key_123";
    process.env.OTP_EMAIL_FROM = "Sisa-Saji <kode@sisasaji.id>";
    const p = configuredOtpProviders();
    expect(p.smtp).toMatchObject({ user: "kode.sisasaji@gmail.com" });
    expect(p.resend).toBeNull();
    // Half a Resend setup throws on its own; with SMTP set it is ignored.
    delete process.env.RESEND_API_KEY;
    expect(() => configuredOtpProviders()).not.toThrow();
    expect(getRealOtpChannels()).toEqual({ email: true, whatsapp: false });
    // Without SMTP, Resend works as before.
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.RESEND_API_KEY = "re_test_key_123";
    expect(configuredOtpProviders()).toMatchObject({ smtp: null, resend: { apiKey: "re_test_key_123" } });
    expect(getRealOtpChannels()).toEqual({ email: true, whatsapp: false });
  });

  it("SMTP: one pair of quotes pasted around the user or password is dropped", () => {
    process.env.SMTP_USER = '"kode.sisasaji@gmail.com"';
    process.env.SMTP_PASS = "'abcd efgh ijkl mnop'";
    expect(getSmtpConfig()).toMatchObject({ user: "kode.sisasaji@gmail.com", pass: "abcdefghijklmnop" });
  });

  it.each([
    ["SMTP_USER without SMTP_PASS", { SMTP_USER: "kode.sisasaji@gmail.com" }],
    ["SMTP_PASS without SMTP_USER", { SMTP_PASS: "abcd efgh ijkl mnop" }],
    ["SMTP_USER without @gmail.com", { SMTP_USER: "tim.otp", SMTP_PASS: "abcd efgh ijkl mnop" }],
    ["SMTP_HOST with a port", { SMTP_USER: "kode.sisasaji@gmail.com", SMTP_PASS: "abcdefghijklmnop", SMTP_HOST: "smtp.gmail.com:465" }],
    ["SMTP_PORT not a number", { SMTP_USER: "kode.sisasaji@gmail.com", SMTP_PASS: "abcdefghijklmnop", SMTP_PORT: "465x" }],
  ])("a broken SMTP setup (%s) never throws on the hot paths, and WhatsApp keeps working", (_label, vars) => {
    process.env.OTP_DEV_MODE = "false";
    process.env.FONNTE_TOKEN = "fonnte-token-123";
    // Leftover Resend variables are not used while SMTP variables are set, even broken ones.
    process.env.RESEND_API_KEY = "re_test_key_123";
    process.env.OTP_EMAIL_FROM = "kode@sisasaji.id";
    Object.assign(process.env, vars);
    expect(() => getSmtpConfig()).toThrow(/Invalid environment variable SMTP_/);
    // Sessions: fail closed (email still counts), so dev-mode sessions stay invalid.
    expect(isRealOtpDelivery()).toBe(true);
    expect(getRealOtpChannels()).toEqual({ email: true, whatsapp: true });
    // Requests: email has no provider (503 PROVIDER_CONFIG + WhatsApp offered), WhatsApp is untouched.
    const p = configuredOtpProviders();
    expect(p).toEqual({ smtp: null, resend: null, fonnteToken: "fonnte-token-123" });
    expect(canDeliver("EMAIL", p)).toBe(false);
    expect(alternativeChannel("EMAIL", p)).toBe("WHATSAPP");
    // The log names the variable, never its value.
    const all = logs.join("\n");
    expect(all).not.toContain("abcd");
    expect(all).not.toContain("tim.otp");
    expect(all).not.toContain("465x");
  });

  it("a broken setup is logged once per process, by variable name only", () => {
    process.env.OTP_DEV_MODE = "false";
    process.env.FONNTE_TOKEN = "short";
    for (let i = 0; i < 3; i++) {
      expect(getRealOtpChannels()).toEqual({ email: false, whatsapp: true });
      expect(configuredOtpProviders().fonnteToken).toBeNull();
    }
    const lines = logs.filter((l) => l.includes("FONNTE_TOKEN"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[env\] Invalid environment variable FONNTE_TOKEN: /);
    expect(lines[0]).not.toContain("short");
  });

  it("dev mode turns SMTP off too", () => {
    process.env.OTP_DEV_MODE = "true";
    process.env.SMTP_USER = "kode.sisasaji@gmail.com";
    process.env.SMTP_PASS = "abcdefghijklmnop";
    expect(getRealOtpChannels()).toEqual({ email: false, whatsapp: false });
  });
});

describe("SMTP sender", () => {
  const smtpOnly: OtpProviders = { smtp: SMTP, resend: null, fonnteToken: null };
  const smtpAndResend: OtpProviders = { ...BOTH, smtp: SMTP };
  function fakeMailer(fail?: unknown) {
    const sent: SmtpMail[] = [];
    const factory = vi.fn<NonNullable<OtpDeliveryDeps["smtpMailer"]>>(() => ({
      sendMail: async (mail: SmtpMail) => {
        sent.push(mail);
        if (fail) throw fail;
        return { messageId: "<1@test>" };
      },
    }));
    return { factory, sent };
  }
  // nodemailer errors carry the server reply in the message: it must never reach the logs.
  const smtpError = (props: Record<string, unknown>) =>
    Object.assign(new Error(`535-5.7.8 Username and Password not accepted for ${SMTP.user} ${CODE}`), props);

  it("sends from the mailbox itself with the code in text and html, and skips Resend", async () => {
    const m = fakeMailer();
    const f = fakeFetch(() => Response.json({ id: "email_1" }));
    const r = await deliverOtp(email, false, { providers: smtpAndResend, fetch: f.fetch, smtpMailer: m.factory });
    expect(r).toEqual({ delivered: true, provider: "smtp" });
    expect(f.calls).toHaveLength(0);
    expect(m.factory).toHaveBeenCalledWith(SMTP, 10_000);
    expect(m.sent).toHaveLength(1);
    const mail = m.sent[0];
    expect(mail.from).toEqual({ name: "Sisa-Saji", address: "kode.sisasaji@gmail.com" });
    expect(mail.to).toBe("warung@contoh.id");
    expect(mail.subject).toBe("Kode masuk Sisa-Saji");
    expect(mail.text).toContain(CODE);
    expect(mail.text).toContain("5 menit");
    expect(mail.html).toContain(CODE);
  });

  it("WhatsApp still goes to Fonnte when SMTP is set", async () => {
    const m = fakeMailer();
    const f = fakeFetch(() => Response.json({ status: true }));
    const r = await deliverOtp(wa, false, { providers: smtpAndResend, fetch: f.fetch, smtpMailer: m.factory });
    expect(r).toEqual({ delivered: true, provider: "fonnte" });
    expect(m.sent).toHaveLength(0);
  });

  it.each([
    ["wrong App Password", { code: "EAUTH", responseCode: 535, command: "AUTH PLAIN" }, "PROVIDER_CONFIG"],
    ["no 2-Step Verification", { code: "EAUTH", responseCode: 534, command: "AUTH PLAIN" }, "PROVIDER_CONFIG"],
    ["unknown host", { code: "EDNS", originalCode: "ENOTFOUND" }, "PROVIDER_CONFIG"],
    ["port closed", { code: "ESOCKET", originalCode: "ECONNREFUSED" }, "PROVIDER_CONFIG"],
    ["sender refused", { code: "EENVELOPE", responseCode: 553, command: "MAIL FROM" }, "PROVIDER_CONFIG"],
    ["recipient refused", { code: "EENVELOPE", responseCode: 550, command: "RCPT TO", rejected: ["warung@contoh.id"] }, "RECIPIENT"],
    ["timeout", { code: "ETIMEDOUT", timeoutType: "CONNECT_TIMEOUT" }, "TEMPORARY"],
    ["connection dropped", { code: "ECONNECTION" }, "TEMPORARY"],
    ["busy server", { code: "EMESSAGE", responseCode: 421, command: "DATA" }, "TEMPORARY"],
    [
      "too many logins",
      { code: "EAUTH", responseCode: 454, command: "AUTH PLAIN", response: "454 4.7.0 Too many login attempts, please try again later." },
      "TEMPORARY",
    ],
    ["STARTTLS cut off", { code: "ETLS", command: "CONN", message: "Connection closed unexpectedly" }, "TEMPORARY"],
    ["TLS certificate refused", { code: "ETLS", command: "CONN", message: "Error initiating TLS - certificate has expired" }, "PROVIDER_CONFIG"],
    [
      "Gmail daily limit",
      { code: "EENVELOPE", responseCode: 550, command: "MAIL FROM", response: "550 5.4.5 Daily user sending limit exceeded." },
      "QUOTA",
    ],
  ] as const)("%s → %s", async (_label, props, expected) => {
    expect(classifySmtpError(smtpError(props))).toBe(expected);
    const m = fakeMailer(smtpError(props));
    const r = await deliverOtp(email, false, { providers: smtpOnly, smtpMailer: m.factory });
    expect(r).toEqual({ delivered: false, provider: "smtp", failure: expected });
  });

  it("never logs the code, the password, the server reply or the full destination", async () => {
    await deliverOtp(email, false, {
      providers: smtpOnly,
      smtpMailer: fakeMailer(smtpError({ code: "EAUTH", responseCode: 535, response: `535 bad ${SMTP.pass} ${CODE}` })).factory,
    });
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join("\n");
    expect(all).toContain("EAUTH");
    expect(all).not.toContain(CODE);
    expect(all).not.toContain(SMTP.pass);
    expect(all).not.toContain("Username and Password");
    expect(all).not.toContain("warung@contoh.id");
  });

  it("the default transport is nodemailer with short timeouts, built once per configuration", async () => {
    nodemailerMock.sendMail.mockReset().mockResolvedValue({ messageId: "<1@test>" });
    nodemailerMock.createTransport.mockReset().mockImplementation(() => ({ sendMail: nodemailerMock.sendMail }));
    expect(await deliverOtp(email, false, { providers: smtpOnly, timeoutMs: 7_000 })).toEqual({ delivered: true, provider: "smtp" });
    expect(await deliverOtp(email, false, { providers: smtpOnly, timeoutMs: 7_000 })).toEqual({ delivered: true, provider: "smtp" });
    expect(nodemailerMock.createTransport).toHaveBeenCalledTimes(1);
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: "kode.sisasaji@gmail.com", pass: "abcdefghijklmnop" },
      connectionTimeout: 7_000,
      greetingTimeout: 7_000,
      socketTimeout: 7_000,
    });
    expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(2);

    // A rotated App Password gets a new transporter; port 587 requires STARTTLS.
    const starttls: SmtpConfig = { ...SMTP, port: 587, secure: false, pass: "ponmlkjihgfedcba" };
    nodemailerMock.sendMail.mockRejectedValueOnce(smtpError({ code: "EAUTH", responseCode: 535 }));
    expect(await deliverOtp(email, false, { providers: { ...smtpOnly, smtp: starttls }, timeoutMs: 7_000 })).toEqual({
      delivered: false,
      provider: "smtp",
      failure: "PROVIDER_CONFIG",
    });
    expect(nodemailerMock.createTransport).toHaveBeenCalledTimes(2);
    expect(nodemailerMock.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
    );
  });

  it("canDeliver counts SMTP as an email provider", () => {
    expect(canDeliver("EMAIL", smtpOnly)).toBe(true);
    expect(canDeliver("WHATSAPP", smtpOnly)).toBe(false);
  });
});

describe("failure kinds and messages", () => {
  it("Resend: an unverified domain or a bad key is a setup problem, not the address", async () => {
    for (const status of [401, 403, 422]) {
      const f = fakeFetch(() => Response.json({ name: "validation_error", message: "The sisasaji.id domain is not verified." }, { status }));
      expect(await deliverOtp(email, false, { providers: BOTH, fetch: f.fetch })).toEqual({
        delivered: false,
        provider: "resend",
        failure: "PROVIDER_CONFIG",
      });
    }
    const badTo = fakeFetch(() => Response.json({ name: "validation_error", message: "Invalid `to` field." }, { status: 422 }));
    expect((await deliverOtp(email, false, { providers: BOTH, fetch: badTo.fetch })).failure).toBe("RECIPIENT");
    const quota = fakeFetch(() => Response.json({ name: "daily_quota_exceeded" }, { status: 429 }));
    expect((await deliverOtp(email, false, { providers: BOTH, fetch: quota.fetch })).failure).toBe("TEMPORARY");
  });

  it("classifies HTTP statuses and Fonnte reasons", () => {
    expect(classifyHttpStatus(400)).toBe("PROVIDER_CONFIG");
    expect(classifyHttpStatus(429)).toBe("TEMPORARY");
    expect(classifyHttpStatus(503)).toBe("TEMPORARY");
    expect(classifyFonnte(200, "invalid token")).toBe("PROVIDER_CONFIG");
    expect(classifyFonnte(200, "device disconnected")).toBe("PROVIDER_CONFIG");
    expect(classifyFonnte(401, "")).toBe("PROVIDER_CONFIG");
    expect(classifyFonnte(200, "target invalid")).toBe("RECIPIENT");
    expect(classifyFonnte(200, "")).toBe("TEMPORARY");
    expect(classifyFonnte(502, "")).toBe("TEMPORARY");
  });

  it("a broken email setup points to WhatsApp instead of blaming the address (and the mirror)", () => {
    const all: OtpProviders = { ...BOTH, smtp: SMTP };
    expect(deliveryFailureMessage("EMAIL", "PROVIDER_CONFIG", all)).toBe(
      "Kode lewat email sedang tidak bisa dikirim. Masuk dengan nomor WhatsApp dulu.",
    );
    expect(deliveryFailureMessage("EMAIL", "PROVIDER_CONFIG", { ...NONE, smtp: SMTP })).toBe(
      "Kode lewat email sedang tidak bisa dikirim. Coba lagi nanti.",
    );
    expect(deliveryFailureMessage("WHATSAPP", "PROVIDER_CONFIG", all)).toBe(
      "Kode lewat WhatsApp sedang tidak bisa dikirim. Masuk dengan email dulu.",
    );
    expect(deliveryFailureMessage("WHATSAPP", "PROVIDER_CONFIG", { ...NONE, fonnteToken: "fonnte-token-123" })).toBe(
      "Kode lewat WhatsApp sedang tidak bisa dikirim. Coba lagi nanti.",
    );
    // A used-up daily limit lasts hours: point to the other channel too, not "try again soon".
    expect(deliveryFailureMessage("EMAIL", "QUOTA", all)).toBe(
      "Kode lewat email sudah mencapai batas kirim hari ini. Masuk dengan nomor WhatsApp dulu.",
    );
    expect(deliveryFailureMessage("EMAIL", "QUOTA", { ...NONE, smtp: SMTP })).toBe(
      "Kode lewat email sudah mencapai batas kirim hari ini. Coba lagi nanti.",
    );
    for (const channel of ["EMAIL", "WHATSAPP"] as const) {
      const temporary = deliveryFailureMessage(channel, "TEMPORARY", all);
      expect(temporary).toMatch(/Coba lagi sebentar lagi\.$/);
      expect(temporary).not.toMatch(/Periksa alamat|Pastikan nomor/);
    }
    expect(deliveryFailureMessage("EMAIL", "RECIPIENT", all)).toMatch(/Periksa alamatnya/);
    expect(deliveryFailureMessage("WHATSAPP", "RECIPIENT", all)).toMatch(/Pastikan nomornya aktif/);
  });

  it("alternativeChannel is the other channel only when it can deliver", () => {
    expect(alternativeChannel("EMAIL", BOTH)).toBe("WHATSAPP");
    expect(alternativeChannel("WHATSAPP", { ...NONE, smtp: SMTP })).toBe("EMAIL");
    expect(alternativeChannel("EMAIL", { ...NONE, smtp: SMTP })).toBeUndefined();
  });
});
