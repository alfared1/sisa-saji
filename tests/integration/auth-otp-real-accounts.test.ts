/**
 * While OTP codes are shown on screen (dev mode), accounts of real people (field pilot
 * warung owners and their buyers) cannot be opened with OTP at all; demo and demo-data
 * accounts keep working. With real delivery the same accounts log in normally.
 */
import { eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { merchants, orders, otpCodes, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { OTP_MAX_REQUESTS_PER_WINDOW } from "@/lib/constants";
import { OtpRequestBody, OtpVerifyBody, REAL_OTP_REQUIRED_REASON } from "@/lib/contracts";
import { DEMO_ACCOUNTS, isDemoAccount } from "@/lib/demo-accounts";
import { ApiError } from "@/server/http";
import { hashOtp, requestOtp, verifyOtp } from "@/server/services/auth/otp";
import { isRealPersonAccount } from "@/server/services/auth/real-accounts";
import { reseed, testDb } from "../helpers/db";

let db: Db;
let close: () => Promise<void>;
let owner: typeof users.$inferSelect;
let buyer: typeof users.$inferSelect;
let ordinary: typeof users.$inferSelect;

beforeAll(async () => {
  ({ db, close } = testDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await reseed(db);
  // A seeded warung (not the demo one) that has orders becomes a pilot warung.
  const [row] = await db
    .select({ merchant: merchants, customerId: orders.customerId })
    .from(orders)
    .innerJoin(merchants, eq(merchants.id, orders.merchantId))
    .where(ne(merchants.slug, DEMO_MERCHANT_SLUG))
    .limit(1);
  await db.update(merchants).set({ isPilot: true, pilotJoinedAt: new Date() }).where(eq(merchants.id, row.merchant.id));
  [owner] = await db.select().from(users).where(eq(users.id, row.merchant.ownerUserId));
  [buyer] = await db.select().from(users).where(eq(users.id, row.customerId));
  // The owner also gets an email, so the test can log in by either identifier.
  if (!owner.email) {
    [owner] = await db.update(users).set({ email: `pilot.owner.${Date.now()}@sisasaji.test` }).where(eq(users.id, owner.id)).returning();
  }
  // A buyer with no order at the pilot warung.
  const linked = new Set(
    (await db.select({ id: orders.customerId }).from(orders).where(eq(orders.merchantId, row.merchant.id))).map((r) => r.id),
  );
  const customers = await db.select().from(users).where(eq(users.role, "CUSTOMER")).limit(200);
  ordinary = customers.find((u) => !linked.has(u.id) && u.phoneNumber && !isDemoAccount(u))!;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await reseed(db); // leave no pilot warung behind
  await close();
});

const loginOf = (u: typeof users.$inferSelect) => (u.phoneNumber ? { phone_number: u.phoneNumber } : { email: u.email! });

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe("isRealPersonAccount", () => {
  it("is true for the pilot owner and a buyer of the pilot warung, false otherwise", async () => {
    const id = (u: typeof users.$inferSelect) =>
      u.phoneNumber ? ({ kind: "phone", value: u.phoneNumber, channel: "WHATSAPP" } as const) : ({ kind: "email", value: u.email!, channel: "EMAIL" } as const);
    expect(await isRealPersonAccount(db, id(owner))).toBe(true);
    expect(await isRealPersonAccount(db, id(buyer))).toBe(true);
    expect(await isRealPersonAccount(db, id(ordinary))).toBe(false);
    expect(await isRealPersonAccount(db, { kind: "email", value: DEMO_ACCOUNTS.MERCHANT.email, channel: "EMAIL" })).toBe(false);
    expect(await isRealPersonAccount(db, { kind: "email", value: "belum.terdaftar@contoh.id", channel: "EMAIL" })).toBe(false);
  });
});

describe("dev-mode OTP for real people", () => {
  it("request is refused with REAL_OTP_REQUIRED, no code is shown or stored", async () => {
    for (const u of [owner, buyer]) {
      const logins = [...(u.email ? [{ email: u.email }] : []), ...(u.phoneNumber ? [{ phone_number: u.phoneNumber }] : [])];
      expect(logins.length).toBeGreaterThan(0);
      for (const login of logins) {
        const err = await rejection(requestOtp(db, OtpRequestBody.parse(login), { devMode: true }));
        expect(err.code).toBe("FORBIDDEN");
        expect(err.status).toBe(403);
        expect(err.details).toEqual({ reason: REAL_OTP_REQUIRED_REASON });
        expect(err.message).toMatch(/WhatsApp atau email/);
      }
    }
    // Refused requests are recorded (they count towards the rate limit) but leave no usable code.
    const ownerRows = await db.select().from(otpCodes).where(eq(otpCodes.identifier, owner.email!));
    expect(ownerRows.length).toBeGreaterThan(0);
    expect(ownerRows.every((r) => r.consumedAt !== null)).toBe(true);
  });

  it("the refusal is rate limited like any request and does not name the pilot", async () => {
    const login = loginOf(buyer);
    let last: ApiError | null = null;
    for (let i = 0; i < OTP_MAX_REQUESTS_PER_WINDOW + 1; i++) {
      last = await rejection(requestOtp(db, OtpRequestBody.parse(login), { devMode: true }));
      if (last.code === "RATE_LIMITED") break;
      expect(last.message).not.toMatch(/uji coba/i);
    }
    expect(last?.code).toBe("RATE_LIMITED");
  });

  it("verify is refused too, even with a code issued before the account became real", async () => {
    // A code row as if it had been requested earlier (dev mode would have shown it).
    const code = "246810";
    const identifier = owner.email!;
    await db.insert(otpCodes).values({
      identifier,
      channel: "EMAIL",
      requestedRole: "MERCHANT",
      codeHash: hashOtp(identifier, code),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    const err = await rejection(verifyOtp(db, OtpVerifyBody.parse({ email: identifier, code, role: "MERCHANT" }), { devMode: true }));
    expect(err.details).toEqual({ reason: REAL_OTP_REQUIRED_REASON });

    // With real delivery the same (valid) code logs the owner in.
    const ok = await verifyOtp(db, OtpVerifyBody.parse({ email: identifier, code, role: "MERCHANT" }), { devMode: false });
    expect(ok.user.id).toBe(owner.id);
  });

  it("with real delivery the pilot owner gets a code by provider, not on screen", async () => {
    const fakeFetch = (async () => Response.json({ id: "email_1" })) as unknown as typeof fetch;
    const res = await requestOtp(db, OtpRequestBody.parse({ email: owner.email! }), {
      devMode: false,
      delivery: { providers: { resend: { apiKey: "re_test_key_123", from: "kode@sisasaji.id" }, fonnteToken: null }, fetch: fakeFetch },
    });
    expect(res.dev_code).toBeUndefined();
    expect(res.channel).toBe("EMAIL");
  });

  it("ordinary and demo accounts still get the on-screen code", async () => {
    const a = await requestOtp(db, OtpRequestBody.parse(loginOf(ordinary)), { devMode: true });
    expect(a.dev_code).toMatch(/^\d{6}$/);
    const d = await requestOtp(db, OtpRequestBody.parse({ email: DEMO_ACCOUNTS.MERCHANT.email, role: "MERCHANT" }), { devMode: true });
    const v = await verifyOtp(db, OtpVerifyBody.parse({ email: DEMO_ACCOUNTS.MERCHANT.email, code: d.dev_code!, role: "MERCHANT" }), {
      devMode: true,
    });
    expect(v.user.is_demo).toBe(true);
    expect(v.user.merchant_slug).toBe(DEMO_MERCHANT_SLUG);
  });
});
