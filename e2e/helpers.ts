/**
 * Shared e2e helpers: API envelope parsing, fresh customers via the real OTP
 * API (dev code), session cookies for seeded accounts, DB lookups and
 * order/batch fixtures created through the public REST API.
 */
import { randomInt } from "node:crypto";
import { expect, type APIRequestContext, type APIResponse, type BrowserContext } from "@playwright/test";
import pg from "pg";
import type {
  BatchCard,
  CheckoutBody,
  MerchantMeResponse,
  NearbyResponse,
  OrderDetail,
  PublishResponse,
  SessionUser,
} from "../src/lib/contracts";
import { mintSessionToken } from "../tests/helpers/session";
import { E2E_BASE_URL, E2E_DATABASE_URL, UGM } from "./env";

type Envelope<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };

/** Parses the API envelope and asserts success. */
export async function ok<T>(res: APIResponse): Promise<T> {
  const body = (await res.json()) as Envelope<T>;
  if (!body.success) throw new Error(`API ${res.url()} → ${res.status()} ${body.error.code}: ${body.error.message}`);
  return body.data;
}

export async function errorCode(res: APIResponse): Promise<string> {
  const body = (await res.json()) as Envelope<unknown>;
  return body.success ? "OK" : body.error.code;
}

/** Random, valid Indonesian mobile number that the seed never uses. */
export function freshPhone(): string {
  return `0857${String(randomInt(0, 1e8)).padStart(8, "0")}`;
}

/** Registers a brand-new customer through the OTP API; the cookie lands in `request`'s jar. */
export async function registerCustomer(request: APIRequestContext, fullName = "Pembeli E2E"): Promise<SessionUser> {
  const phone = freshPhone();
  const otp = await ok<{ dev_code?: string }>(await request.post("/api/v1/auth/otp/request", { data: { phone_number: phone } }));
  expect(otp.dev_code, "OTP_DEV_MODE must expose dev_code").toMatch(/^\d{6}$/);
  const verified = await ok<{ user: SessionUser }>(
    await request.post("/api/v1/auth/otp/verify", {
      data: { phone_number: phone, code: otp.dev_code, full_name: fullName },
    }),
  );
  return verified.user;
}

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: E2E_DATABASE_URL, max: 2 });
  return pool;
}

export async function userIdByEmail(email: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>("select id from users where email = $1", [email]);
  if (!rows[0]) throw new Error(`no user ${email}`);
  return rows[0].id;
}

/** `ss_session` cookie value for a seeded account (same HS256 dev secret as the server). */
export async function sessionTokenFor(email: string): Promise<string> {
  return mintSessionToken(await userIdByEmail(email));
}

/** Logs a browser context (and its `context.request`) in as a seeded account. */
export async function loginContextAs(context: BrowserContext, email: string) {
  await context.addCookies([
    { name: "ss_session", value: await sessionTokenFor(email), url: E2E_BASE_URL, httpOnly: true, sameSite: "Lax" },
  ]);
}

export async function nearby(request: APIRequestContext, radius = 2000): Promise<NearbyResponse> {
  return ok<NearbyResponse>(
    await request.get(`/api/v1/discover/nearby?lat=${UGM.lat}&lng=${UGM.lng}&radius_m=${radius}`),
  );
}

/** First live batch within 2 km with at least `minStock` portions, optionally of one merchant. */
export async function pickBatch(
  request: APIRequestContext,
  opts: { minStock?: number; merchantSlug?: string; excludeMerchantSlug?: string } = {},
): Promise<BatchCard> {
  const { merchants } = await nearby(request);
  for (const m of merchants) {
    if (opts.merchantSlug && m.slug !== opts.merchantSlug) continue;
    if (opts.excludeMerchantSlug && m.slug === opts.excludeMerchantSlug) continue;
    const b = m.batches.find((x) => x.available_stock >= (opts.minStock ?? 1));
    if (b) return b;
  }
  throw new Error(`no live batch matching ${JSON.stringify(opts)} — reseed the e2e DB`);
}

export async function checkout(request: APIRequestContext, body: CheckoutBody): Promise<APIResponse> {
  return request.post("/api/v1/orders/checkout", { data: body });
}

/** Fresh customer + paid order (READY_FOR_PICKUP) for one portion of `batch`. */
export async function createPaidOrder(request: APIRequestContext, batch: BatchCard): Promise<OrderDetail> {
  await registerCustomer(request, "Pembeli Tiket");
  const { order } = await ok<{ order: OrderDetail }>(
    await checkout(request, { merchant_id: batch.merchant_id, items: [{ batch_id: batch.batch_id, quantity: 1 }] }),
  );
  const paid = await ok<{ order: OrderDetail }>(await request.post(`/api/v1/orders/${order.id}/simulate-payment`));
  expect(paid.order.pickup_code).toMatch(/^\d{4}$/);
  return paid.order;
}

/** Publishes a fresh batch for the logged-in merchant's first active menu. */
export async function publishBatch(
  merchantRequest: APIRequestContext,
  initialStock: number,
  minutesOpen = 120,
): Promise<PublishResponse> {
  const me = await ok<MerchantMeResponse>(await merchantRequest.get("/api/v1/merchant/me"));
  const menu = me.menus.find((m) => m.is_active);
  if (!menu) throw new Error("merchant has no active menu");
  return ok<PublishResponse>(
    await merchantRequest.post("/api/v1/merchant/surplus/publish", {
      data: {
        menu_id: menu.id,
        initial_stock: initialStock,
        pickup_end_time: new Date(Date.now() + minutesOpen * 60_000).toISOString(),
      },
    }),
  );
}

export function idr(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}
