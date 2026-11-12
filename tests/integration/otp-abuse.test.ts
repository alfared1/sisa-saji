/**
 * Once login codes are really sent (WhatsApp/email cost money, and a flood gets the sender
 * number banned): limits per client and for the whole app, the shared demo numbers are
 * never messaged, and sessions opened while codes were shown on screen stop counting.
 */
import { randomInt } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { otpCodes, users } from "@/db/schema";
import { OTP_MAX_REQUESTS_PER_CLIENT_WINDOW, OTP_MAX_SENDS_PER_HOUR } from "@/lib/constants";
import { DEMO_LOGIN_ONLY_REASON, OtpRequestBody } from "@/lib/contracts";
import { DEMO_ACCOUNTS, isDemoAccount } from "@/lib/demo-accounts";
import { readSessionToken, sessionStillValid, signSessionToken } from "@/server/auth/session";
import { ApiError } from "@/server/http";
import { hashOtp, otpClientKey, requestOtp } from "@/server/services/auth/otp";
import type { OtpDeliveryDeps } from "@/server/services/auth/otp-delivery";
import { testDb } from "../helpers/db";

// session.ts reads the cookie through next/headers.
let sessionToken: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "ss_session" && sessionToken ? { name, value: sessionToken } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));

let db: Db;
let close: () => Promise<void>;

beforeAll(() => {
  ({ db, close } = testDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await close();
});

const freshPhone = () => `0898${String(randomInt(0, 10 ** 8)).padStart(8, "0")}`;

function fonnte(calls: string[] = []): OtpDeliveryDeps {
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    calls.push(new URLSearchParams(init.body as URLSearchParams).get("target") ?? "");
    return Response.json({ status: true });
  }) as unknown as typeof fetch;
  return { providers: { resend: null, fonnteToken: "fonnte-token-123" }, fetch: fakeFetch };
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe("real delivery: abuse limits", () => {
  it("never sends a code to the shared demo numbers (one-tap demo login only)", async () => {
    const calls: string[] = [];
    for (const login of [{ phone_number: DEMO_ACCOUNTS.CUSTOMER.phone }, { email: DEMO_ACCOUNTS.MERCHANT.email }]) {
      const err = await rejection(requestOtp(db, OtpRequestBody.parse(login), { devMode: false, delivery: fonnte(calls) }));
      expect(err.status).toBe(403);
      expect(err.details).toEqual({ reason: DEMO_LOGIN_ONLY_REASON });
    }
    expect(calls).toEqual([]);
    // In dev mode (code on screen, nothing sent) the demo numbers still work.
    const dev = await requestOtp(db, OtpRequestBody.parse({ phone_number: DEMO_ACCOUNTS.CUSTOMER.phone }), { devMode: true });
    expect(dev.dev_code).toMatch(/^\d{6}$/);
  });

  it(`one client gets at most ${OTP_MAX_REQUESTS_PER_CLIENT_WINDOW} codes per 10 minutes, whatever the numbers`, async () => {
    const calls: string[] = [];
    const ip = `203.0.113.${randomInt(1, 254)}`;
    for (let i = 0; i < OTP_MAX_REQUESTS_PER_CLIENT_WINDOW; i++) {
      await requestOtp(db, OtpRequestBody.parse({ phone_number: freshPhone() }), { devMode: false, delivery: fonnte(calls), clientIp: ip });
    }
    const err = await rejection(
      requestOtp(db, OtpRequestBody.parse({ phone_number: freshPhone() }), { devMode: false, delivery: fonnte(calls), clientIp: ip }),
    );
    expect(err.code).toBe("RATE_LIMITED");
    expect(calls).toHaveLength(OTP_MAX_REQUESTS_PER_CLIENT_WINDOW);
    // Another client is not affected, and the address itself is never stored.
    await requestOtp(db, OtpRequestBody.parse({ phone_number: freshPhone() }), { devMode: false, delivery: fonnte(), clientIp: "198.51.100.7" });
    const keys = await db.select({ k: otpCodes.clientKey }).from(otpCodes).where(eq(otpCodes.clientKey, otpClientKey(ip)!));
    expect(keys).toHaveLength(OTP_MAX_REQUESTS_PER_CLIENT_WINDOW);
    expect(otpClientKey(ip)).not.toContain(ip);
  });

  it(`stops sending once the whole app asked for ${OTP_MAX_SENDS_PER_HOUR} codes in an hour`, async () => {
    const now = new Date();
    const filler = Array.from({ length: OTP_MAX_SENDS_PER_HOUR }, (_, i) => ({
      identifier: `banjir.${i}@flood.test`,
      channel: "EMAIL",
      codeHash: hashOtp(`banjir.${i}@flood.test`, "000000"),
      expiresAt: now,
      consumedAt: now,
      createdAt: new Date(now.getTime() - 60_000),
    }));
    await db.insert(otpCodes).values(filler);
    try {
      const err = await rejection(requestOtp(db, OtpRequestBody.parse({ phone_number: freshPhone() }), { devMode: false, delivery: fonnte() }));
      expect(err.code).toBe("RATE_LIMITED");
      // Dev mode sends nothing, so the app-wide cap does not apply there.
      const dev = await requestOtp(db, OtpRequestBody.parse({ phone_number: freshPhone() }), { devMode: true });
      expect(dev.dev_code).toBeDefined();
    } finally {
      await db.delete(otpCodes).where(like(otpCodes.identifier, "banjir.%@flood.test"));
    }
  });
});

describe("sessions opened while codes were shown on screen", () => {
  it("carry no real-OTP proof; a session from a delivered code does", async () => {
    const dev = await readSessionToken(await signSessionToken("00000000-0000-4000-8000-000000000001"));
    const real = await readSessionToken(await signSessionToken("00000000-0000-4000-8000-000000000001", { realOtp: true }));
    expect(dev).toEqual({ userId: "00000000-0000-4000-8000-000000000001", realOtp: false });
    expect(real?.realOtp).toBe(true);
  });

  it("stop counting once real delivery is on, except the shared demo accounts", () => {
    const devClaims = { userId: "u", realOtp: false };
    expect(sessionStillValid(devClaims, { is_demo: false }, false)).toBe(true);
    expect(sessionStillValid(devClaims, { is_demo: false }, true)).toBe(false);
    expect(sessionStillValid(devClaims, { is_demo: true }, true)).toBe(true);
    expect(sessionStillValid({ userId: "u", realOtp: true }, { is_demo: false }, true)).toBe(true);
  });

  it("getSessionUser logs out a dev-mode session when real delivery is switched on", async () => {
    const { getSessionUser } = await import("@/server/auth/session");
    const customers = await db.select().from(users).where(eq(users.role, "CUSTOMER")).limit(20);
    const ordinary = customers.find((u) => !isDemoAccount(u))!;
    const [demo] = await db.select().from(users).where(eq(users.email, DEMO_ACCOUNTS.CUSTOMER.email));

    sessionToken = await signSessionToken(ordinary.id);
    expect((await getSessionUser())?.id).toBe(ordinary.id);

    vi.stubEnv("OTP_DEV_MODE", "false");
    vi.stubEnv("FONNTE_TOKEN", "fonnte-token-123");
    expect(await getSessionUser()).toBeNull();
    sessionToken = await signSessionToken(ordinary.id, { realOtp: true });
    expect((await getSessionUser())?.id).toBe(ordinary.id);
    sessionToken = await signSessionToken(demo.id);
    expect((await getSessionUser())?.is_demo).toBe(true);
    sessionToken = null;
  });
});
