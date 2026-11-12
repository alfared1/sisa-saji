/**
 * OTP login against the seeded test database (service functions, no HTTP).
 */
import { randomInt } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { otpCodes, users } from "@/db/schema";
import { OTP_MAX_ATTEMPTS, OTP_MAX_REQUESTS_PER_WINDOW, OTP_TTL_SECONDS } from "@/lib/constants";
import { OtpRequestBody, OtpVerifyBody } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { hashOtp, requestOtp, verifyOtp } from "@/server/services/auth/otp";
import { testDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = testDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(async () => {
  vi.restoreAllMocks();
  await close();
});

/** A phone number nobody else uses in this run ("08" + 10 digits). */
const freshPhone = () => `0899${String(randomInt(0, 10 ** 8)).padStart(8, "0")}`;
const toE164 = (local: string) => `+62${local.slice(1)}`;

async function request(body: Parameters<typeof OtpRequestBody.parse>[0], devMode = true, now?: Date) {
  return requestOtp(db, OtpRequestBody.parse(body), { devMode, now });
}

async function verify(body: Parameters<typeof OtpVerifyBody.parse>[0], now?: Date) {
  return verifyOtp(db, OtpVerifyBody.parse(body), { devMode: true, now });
}

async function expectApiError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
  return err as ApiError;
}

describe("POST /auth/otp/request", () => {
  it("normalises the phone, stores only the hash and returns dev_code in dev mode", async () => {
    const local = freshPhone();
    const res = await request({ phone_number: local });
    expect(res.sent).toBe(true);
    expect(res.channel).toBe("WHATSAPP");
    expect(res.expires_in_seconds).toBe(OTP_TTL_SECONDS);
    expect(res.dev_code).toMatch(/^\d{6}$/);

    const [row] = await db
      .select()
      .from(otpCodes)
      .where(eq(otpCodes.identifier, toE164(local)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    expect(row).toBeDefined();
    expect(row.codeHash).toBe(hashOtp(toE164(local), res.dev_code!));
    expect(row.codeHash).not.toContain(res.dev_code!);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(OTP_TTL_SECONDS * 1000);
  });

  it("accepts 62… and +62… forms as the same identifier", async () => {
    const local = freshPhone();
    await request({ phone_number: `62${local.slice(1)}` });
    await request({ phone_number: toE164(local) });
    const rows = await db.select().from(otpCodes).where(eq(otpCodes.identifier, toE164(local)));
    expect(rows).toHaveLength(2);
  });

  it("lower-cases emails and uses the EMAIL channel", async () => {
    const res = await request({ email: "  Mixed.Case@Example.TEST " });
    expect(res.channel).toBe("EMAIL");
    const rows = await db.select().from(otpCodes).where(eq(otpCodes.identifier, "mixed.case@example.test"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("dev mode off without a provider: OTP_DELIVERY_FAILED and no usable code is left", async () => {
    const phone = freshPhone();
    const noProviders = { providers: { resend: null, fonnteToken: null } };
    const err = await expectApiError(
      requestOtp(db, OtpRequestBody.parse({ phone_number: phone }), { devMode: false, delivery: noProviders }),
      "OTP_DELIVERY_FAILED",
    );
    expect(err.status).toBe(503);
    expect(err.message).not.toMatch(/\d{6}/);
    const rows = await db.select().from(otpCodes).where(eq(otpCodes.identifier, toE164(phone)));
    expect(rows).toHaveLength(0);
  });

  it("dev mode off with a provider: the code goes out, never back in the response", async () => {
    const phone = freshPhone();
    let sentText = "";
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sentText = new URLSearchParams(init.body as URLSearchParams).get("message") ?? "";
      return Response.json({ status: true });
    }) as unknown as typeof fetch;
    const res = await requestOtp(db, OtpRequestBody.parse({ phone_number: phone }), {
      devMode: false,
      delivery: { providers: { resend: null, fonnteToken: "fonnte-token-123" }, fetch: fakeFetch },
    });
    expect(res).toEqual({ sent: true, channel: "WHATSAPP", expires_in_seconds: OTP_TTL_SECONDS });
    const code = sentText.match(/\d{6}/)?.[0];
    expect(code).toBeDefined();
    const ok = await verifyOtp(db, OtpVerifyBody.parse({ phone_number: phone, code, full_name: "Pemilik Asli" }), { devMode: false });
    expect(ok.isNewUser).toBe(true);
  });

  it("dev mode off and the provider fails: the stored code is retired", async () => {
    const phone = freshPhone();
    const failing = (async () => new Response("down", { status: 502 })) as unknown as typeof fetch;
    const err = await expectApiError(
      requestOtp(db, OtpRequestBody.parse({ phone_number: phone }), {
        devMode: false,
        delivery: { providers: { resend: null, fonnteToken: "fonnte-token-123" }, fetch: failing },
      }),
      "OTP_DELIVERY_FAILED",
    );
    // An outage: try again later, without blaming the number.
    expect(err.status).toBe(503);
    expect(err.message).toBe("Kode belum terkirim ke WhatsApp. Coba lagi sebentar lagi.");
    expect(err.details).toEqual({ channel: "WHATSAPP", reason: "TEMPORARY" });
    const [row] = await db.select().from(otpCodes).where(eq(otpCodes.identifier, toE164(phone)));
    expect(row.consumedAt).not.toBeNull();
  });

  it("a rejected SMTP password points to WhatsApp instead of the address, and retires the code", async () => {
    const address = `smtp-${randomInt(0, 10 ** 9)}@contoh.test`;
    const rejected = Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });
    const smtp = { host: "smtp.gmail.com", port: 465, secure: true, user: "kode.sisasaji@gmail.com", pass: "abcdefghijklmnop", fromName: "Sisa-Saji" };
    const err = await expectApiError(
      requestOtp(db, OtpRequestBody.parse({ email: address }), {
        devMode: false,
        delivery: {
          providers: { smtp, resend: null, fonnteToken: "fonnte-token-123" },
          smtpMailer: () => ({
            sendMail: async () => {
              throw rejected;
            },
          }),
        },
      }),
      "OTP_DELIVERY_FAILED",
    );
    expect(err.message).toBe("Kode lewat email sedang tidak bisa dikirim. Masuk dengan nomor WhatsApp dulu.");
    expect(err.details).toEqual({ channel: "EMAIL", reason: "PROVIDER_CONFIG", alternative_channel: "WHATSAPP" });
    const [row] = await db.select().from(otpCodes).where(eq(otpCodes.identifier, address));
    expect(row.consumedAt).not.toBeNull();
  });

  it("the Gmail daily limit points to WhatsApp instead of asking to retry soon", async () => {
    const address = `quota-${randomInt(0, 10 ** 9)}@contoh.test`;
    const limit = Object.assign(new Error("Daily user sending limit exceeded"), {
      code: "EENVELOPE",
      responseCode: 550,
      command: "MAIL FROM",
      response: "550 5.4.5 Daily user sending limit exceeded.",
    });
    const smtp = { host: "smtp.gmail.com", port: 465, secure: true, user: "kode.sisasaji@gmail.com", pass: "abcdefghijklmnop", fromName: "Sisa-Saji" };
    const err = await expectApiError(
      requestOtp(db, OtpRequestBody.parse({ email: address }), {
        devMode: false,
        delivery: {
          providers: { smtp, resend: null, fonnteToken: "fonnte-token-123" },
          smtpMailer: () => ({
            sendMail: async () => {
              throw limit;
            },
          }),
        },
      }),
      "OTP_DELIVERY_FAILED",
    );
    expect(err.message).toBe("Kode lewat email sudah mencapai batas kirim hari ini. Masuk dengan nomor WhatsApp dulu.");
    expect(err.details).toEqual({ channel: "EMAIL", reason: "QUOTA", alternative_channel: "WHATSAPP" });
  });

  it("a half-set SMTP_* in the environment does not stop WhatsApp login", async () => {
    const KEYS = ["SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "RESEND_API_KEY", "OTP_EMAIL_FROM", "FONNTE_TOKEN"] as const;
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const k of KEYS) delete process.env[k];
      process.env.SMTP_USER = "kode.sisasaji@gmail.com"; // SMTP_PASS forgotten
      process.env.FONNTE_TOKEN = "fonnte-token-123";
      const fonnte = (async () => Response.json({ status: true })) as unknown as typeof fetch;

      // No `providers`: they come from the environment, as in production.
      const res = await requestOtp(db, OtpRequestBody.parse({ phone_number: freshPhone() }), { devMode: false, delivery: { fetch: fonnte } });
      expect(res).toMatchObject({ sent: true, channel: "WHATSAPP" });

      const err = await expectApiError(
        requestOtp(db, OtpRequestBody.parse({ email: `half-${randomInt(0, 10 ** 9)}@contoh.test` }), { devMode: false, delivery: { fetch: fonnte } }),
        "OTP_DELIVERY_FAILED",
      );
      expect(err.status).toBe(503);
      expect(err.details).toEqual({ channel: "EMAIL", reason: "PROVIDER_CONFIG", alternative_channel: "WHATSAPP" });
    } finally {
      errorLog.mockRestore();
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it(`rate limits after ${OTP_MAX_REQUESTS_PER_WINDOW} requests per 10 minutes`, async () => {
    const phone = freshPhone();
    for (let i = 0; i < OTP_MAX_REQUESTS_PER_WINDOW; i++) await request({ phone_number: phone });
    await expectApiError(request({ phone_number: phone }), "RATE_LIMITED");
    // The window slides: 11 minutes later it is allowed again.
    const later = new Date(Date.now() + 11 * 60_000);
    await expect(request({ phone_number: phone }, true, later)).resolves.toMatchObject({ sent: true });
  });
});

describe("POST /auth/otp/verify", () => {
  it("new user: requires full_name without consuming the code, then creates the account", async () => {
    const phone = freshPhone();
    const { dev_code } = await request({ phone_number: phone });

    const err = await expectApiError(verify({ phone_number: phone, code: dev_code! }), "VALIDATION_ERROR");
    expect(err.details).toEqual([expect.objectContaining({ path: "full_name" })]);

    const res = await verify({ phone_number: phone, code: dev_code!, full_name: "Raka Pratama" });
    expect(res.isNewUser).toBe(true);
    expect(res.user).toMatchObject({
      role: "CUSTOMER",
      full_name: "Raka Pratama",
      phone_number: toE164(phone),
      email: null,
      badge_tier: "SURPLUS_ROOKIE",
      loyalty_points: 0,
      merchant_id: null,
    });

    // The code is now consumed.
    await expectApiError(verify({ phone_number: phone, code: dev_code!, full_name: "Raka Pratama" }), "OTP_INVALID");
  });

  it("existing user logs in (is_new_user false) by email", async () => {
    const { dev_code } = await request({ email: "DEMO.PEMBELI@sisasaji.test" });
    const res = await verify({ email: "demo.pembeli@sisasaji.test", code: dev_code! });
    expect(res.isNewUser).toBe(false);
    expect(res.user.email).toBe("demo.pembeli@sisasaji.test");
    expect(res.user.role).toBe("CUSTOMER");
  });

  it("wrong code increments attempts and locks after OTP_MAX_ATTEMPTS", async () => {
    const phone = freshPhone();
    const { dev_code } = await request({ phone_number: phone });
    const wrong = dev_code === "000000" ? "111111" : "000000";

    for (let i = 1; i <= OTP_MAX_ATTEMPTS; i++) {
      const err = await expectApiError(verify({ phone_number: phone, code: wrong, full_name: "Siti" }), "OTP_INVALID");
      expect(err.details).toEqual({ remaining_attempts: OTP_MAX_ATTEMPTS - i });
    }
    const [row] = await db.select().from(otpCodes).where(eq(otpCodes.identifier, toE164(phone)));
    expect(row.attempts).toBe(OTP_MAX_ATTEMPTS);

    // Even the right code is refused once locked.
    const locked = await expectApiError(
      verify({ phone_number: phone, code: dev_code!, full_name: "Siti Aminah" }),
      "OTP_INVALID",
    );
    expect(locked.details).toEqual({ locked: true });
    const created = await db.select().from(users).where(eq(users.phoneNumber, toE164(phone)));
    expect(created).toHaveLength(0);
  });

  it("parallel wrong guesses never compare more than OTP_MAX_ATTEMPTS codes", async () => {
    const phone = freshPhone();
    const { dev_code } = await request({ phone_number: phone });
    const wrong = dev_code === "000000" ? "111111" : "000000";

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => verify({ phone_number: phone, code: wrong, full_name: "Siti" })),
    );
    const details = results.map((r) => (r.status === "rejected" ? (r.reason as ApiError).details : null));
    const compared = details.filter((d) => d && typeof d === "object" && "remaining_attempts" in d);
    const locked = details.filter((d) => d && typeof d === "object" && "locked" in d);
    expect(compared).toHaveLength(OTP_MAX_ATTEMPTS);
    expect(locked).toHaveLength(20 - OTP_MAX_ATTEMPTS);
    const [row] = await db.select().from(otpCodes).where(eq(otpCodes.identifier, toE164(phone)));
    expect(row.attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it("expired code → OTP_EXPIRED", async () => {
    const phone = freshPhone();
    const past = new Date(Date.now() - (OTP_TTL_SECONDS + 60) * 1000);
    const { dev_code } = await request({ phone_number: phone }, true, past);
    await expectApiError(verify({ phone_number: phone, code: dev_code!, full_name: "Budi Santoso" }), "OTP_EXPIRED");
  });

  it("only the latest unconsumed code is valid", async () => {
    const phone = freshPhone();
    const first = await request({ phone_number: phone }, true, new Date(Date.now() - 1000));
    const second = await request({ phone_number: phone });
    if (first.dev_code !== second.dev_code) {
      await expectApiError(verify({ phone_number: phone, code: first.dev_code!, full_name: "Dewi" }), "OTP_INVALID");
    }
    const res = await verify({ phone_number: phone, code: second.dev_code!, full_name: "Dewi Lestari" });
    expect(res.isNewUser).toBe(true);
  });

  it("MERCHANT login upgrades an existing CUSTOMER account", async () => {
    const phone = freshPhone();
    const a = await request({ phone_number: phone });
    const created = await verify({ phone_number: phone, code: a.dev_code!, full_name: "Calon Mitra" });
    expect(created.user.role).toBe("CUSTOMER");

    const b = await request({ phone_number: phone, role: "MERCHANT" });
    const upgraded = await verify({ phone_number: phone, code: b.dev_code!, role: "MERCHANT" });
    expect(upgraded.isNewUser).toBe(false);
    expect(upgraded.user.role).toBe("MERCHANT");

    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, created.user.id)));
    expect(row.role).toBe("MERCHANT");
  });
});
