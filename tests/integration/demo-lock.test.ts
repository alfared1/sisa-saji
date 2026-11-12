/**
 * Shared demo accounts: the route handlers refuse changes to identity, warung profile,
 * payout details, menus and opening state (403 DEMO_LOCKED), while the demo flow itself
 * (publishing and cancelling surplus) keeps working. Other accounts are not affected.
 */
import { asc, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import type { AuthMeResponse } from "@/lib/contracts";
import {
  DEMO_ACCOUNTS,
  DEMO_LOCKED_MESSAGE,
  DEMO_LOCKED_REASON,
  DEMO_MAX_BATCH_STOCK,
  DEMO_MAX_BATCH_STOCK_MESSAGE,
} from "@/lib/demo-accounts";
import { OtpRequestBody, OtpVerifyBody } from "@/lib/contracts";
import { requestOtp, verifyOtp } from "@/server/services/auth/otp";
import { reseed, testDb } from "../helpers/db";
import { mintSessionToken } from "../helpers/session";

// Route handlers call connection() and read the session cookie through next/headers.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));
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
let demoMerchant: typeof merchants.$inferSelect;
let demoMenuId: string;
let demoOwnerId: string;
let demoBuyerId: string;
let otherOwnerId: string;

beforeAll(async () => {
  ({ db, close } = testDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
  await reseed(db);
  [demoMerchant] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
  demoOwnerId = demoMerchant.ownerUserId;
  [{ id: demoMenuId }] = await db.select({ id: menus.id }).from(menus).where(eq(menus.merchantId, demoMerchant.id)).orderBy(asc(menus.id)).limit(1);
  [{ id: demoBuyerId }] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_ACCOUNTS.CUSTOMER.email));
  [{ ownerUserId: otherOwnerId }] = await db.select().from(merchants).where(ne(merchants.slug, DEMO_MERCHANT_SLUG)).limit(1);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await reseed(db);
  await close();
});

async function as(userId: string) {
  sessionToken = await mintSessionToken(userId);
}

function req(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectLocked(res: Response) {
  expect(res.status).toBe(403);
  const json = await res.json();
  expect(json.error).toMatchObject({ code: "FORBIDDEN", message: DEMO_LOCKED_MESSAGE, details: { reason: DEMO_LOCKED_REASON } });
}

describe("GET /auth/me exposes is_demo", () => {
  it("true for both demo accounts, false for others", async () => {
    const { GET } = await import("@/app/api/v1/auth/me/route");
    for (const [id, expected] of [
      [demoOwnerId, true],
      [demoBuyerId, true],
      [otherOwnerId, false],
    ] as const) {
      await as(id);
      const body = (await (await GET(req("GET", "/auth/me"), undefined)).json()) as { data: AuthMeResponse };
      expect(body.data.user?.is_demo).toBe(expected);
    }
  });
});

describe("demo warung", () => {
  it("cannot change its profile, payout, hours or open/closed state", async () => {
    const { PATCH } = await import("@/app/api/v1/merchant/me/route");
    await as(demoOwnerId);
    for (const body of [
      { merchant_name: "Warung Iseng" },
      { bank_code: "BCA", bank_account_number: "1234567890", bank_account_holder: "Orang Lain" },
      { operational_open_time: "01:00" },
      { is_open: false },
    ]) {
      await expectLocked(await PATCH(req("PATCH", "/merchant/me", body), undefined));
    }
    const [after] = await db.select().from(merchants).where(eq(merchants.id, demoMerchant.id));
    expect(after.merchantName).toBe(demoMerchant.merchantName);
    expect(after.isOpen).toBe(demoMerchant.isOpen);
    expect(after.bankAccountNumber).toBe(demoMerchant.bankAccountNumber);
  });

  it("cannot create, edit or deactivate menus", async () => {
    const { POST } = await import("@/app/api/v1/merchant/menus/route");
    const { PATCH } = await import("@/app/api/v1/merchant/menus/[id]/route");
    await as(demoOwnerId);
    await expectLocked(
      await POST(req("POST", "/merchant/menus", { menu_name: "Menu Iseng", original_price_idr: 15000, min_recovery_price_idr: 5000 }), undefined),
    );
    const ctx = { params: Promise.resolve({ id: demoMenuId }) };
    await expectLocked(await PATCH(req("PATCH", `/merchant/menus/${demoMenuId}`, { menu_name: "Ganti" }), ctx));
    await expectLocked(await PATCH(req("PATCH", `/merchant/menus/${demoMenuId}`, { is_active: false }), ctx));
    const [menu] = await db.select().from(menus).where(eq(menus.id, demoMenuId));
    expect(menu.isActive).toBe(true);
  });

  it("can still publish and cancel its own surplus batch", async () => {
    const { POST } = await import("@/app/api/v1/merchant/surplus/publish/route");
    const { PATCH } = await import("@/app/api/v1/merchant/surplus/[batchId]/route");
    await as(demoOwnerId);
    const published = await POST(
      req("POST", "/merchant/surplus/publish", {
        menu_id: demoMenuId,
        initial_stock: 3,
        pickup_end_time: new Date(Date.now() + 90 * 60_000).toISOString(),
      }),
      undefined,
    );
    expect(published.status).toBe(201);
    const { data } = (await published.json()) as { data: { batch: { id: string } } };
    const cancelled = await PATCH(req("PATCH", `/merchant/surplus/${data.batch.id}`, { status: "CANCELLED" }), {
      params: Promise.resolve({ batchId: data.batch.id }),
    });
    expect(cancelled.status).toBe(200);
  });

  it(`publishes at most ${DEMO_MAX_BATCH_STOCK} portions per batch`, async () => {
    const { POST } = await import("@/app/api/v1/merchant/surplus/publish/route");
    await as(demoOwnerId);
    const res = await POST(
      req("POST", "/merchant/surplus/publish", {
        menu_id: demoMenuId,
        initial_stock: DEMO_MAX_BATCH_STOCK + 1,
        pickup_end_time: new Date(Date.now() + 90 * 60_000).toISOString(),
      }),
      undefined,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe(DEMO_MAX_BATCH_STOCK_MESSAGE);
  });
});

describe("demo buyer", () => {
  it("cannot rename itself or turn into a warung", async () => {
    const { PATCH } = await import("@/app/api/v1/profile/route");
    const { POST } = await import("@/app/api/v1/merchant/onboarding/route");
    await as(demoBuyerId);
    await expectLocked(await PATCH(req("PATCH", "/profile", { full_name: "Nama Iseng" }), undefined));
    await expectLocked(
      await POST(
        req("POST", "/merchant/onboarding", {
          merchant_name: "Warung Iseng",
          address: "Jl. Contoh No. 1",
          lat: -6.55,
          lng: 106.73,
          whatsapp_number: "081234567890",
        }),
        undefined,
      ),
    );
    const [u] = await db.select().from(users).where(eq(users.id, demoBuyerId));
    expect(u.fullName).not.toBe("Nama Iseng");
  });

  it("an OTP login as MERCHANT does not upgrade the demo buyer", async () => {
    const { dev_code } = await requestOtp(db, OtpRequestBody.parse({ email: DEMO_ACCOUNTS.CUSTOMER.email, role: "MERCHANT" }), {
      devMode: true,
    });
    const { user } = await verifyOtp(db, OtpVerifyBody.parse({ email: DEMO_ACCOUNTS.CUSTOMER.email, code: dev_code, role: "MERCHANT" }), {
      devMode: true,
    });
    expect(user.role).toBe("CUSTOMER");
  });
});

describe("other accounts", () => {
  it("edit their own warung and profile as before", async () => {
    const meRoute = await import("@/app/api/v1/merchant/me/route");
    const profileRoute = await import("@/app/api/v1/profile/route");
    await as(otherOwnerId);
    const closed = await meRoute.PATCH(req("PATCH", "/merchant/me", { is_open: false }), undefined);
    expect(closed.status).toBe(200);
    const renamed = await profileRoute.PATCH(req("PATCH", "/profile", { full_name: "Pemilik Warung Lain" }), undefined);
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { data: { user: { full_name: string; is_demo: boolean } } }).data.user).toMatchObject({
      full_name: "Pemilik Warung Lain",
      is_demo: false,
    });
  });
});
