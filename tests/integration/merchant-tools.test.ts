/**
 * Warung tools: the wallet (history + payouts), buyer reviews with the warung's reply, cashier
 * accounts (counter-only access, enforced on the routes), and "Pasang lagi menu kemarin".
 */
import { randomInt } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchantPayouts, merchants, merchantStaff, orders, reviews, surplusBatches, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { MAX_CASHIERS_PER_WARUNG, PAYOUT_MIN_IDR } from "@/lib/constants";
import { CheckoutBody } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { repeatCandidates, repeatYesterday } from "@/server/services/merchant/repeat";
import { listMerchantReviews, replyToReview } from "@/server/services/merchant/reviews";
import { addCashier, listCashiers, removeCashier } from "@/server/services/merchant/staff";
import { getWallet, requestPayout } from "@/server/services/merchant/wallet";
import { sessionUserView } from "@/server/services/auth/session-user";
import { checkout } from "@/server/services/orders/checkout";
import { simulatePayment } from "@/server/services/orders/orders";
import { verifyPickup } from "@/server/services/orders/pickup";
import { reseed, testDb } from "../helpers/db";
import { mintSessionToken } from "../helpers/session";
import { TEST_PAYMENT_WEBHOOK_SECRET, TEST_PICKUP_QR_SECRET } from "../setup/constants";

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
let merchant: typeof merchants.$inferSelect;
let other: typeof merchants.$inferSelect;

beforeAll(async () => {
  ({ db, close } = testDb());
  vi.spyOn(console, "log").mockImplementation(() => {});
  await reseed(db);
  [merchant] = await db.select().from(merchants).where(eq(merchants.slug, "geprek-mbak-lilis"));
  [other] = await db
    .select()
    .from(merchants)
    .where(and(ne(merchants.id, merchant.id), ne(merchants.slug, DEMO_MERCHANT_SLUG)))
    .limit(1);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await close();
});

const phone = () => `08${String(randomInt(1, 9))}${String(randomInt(0, 10 ** 9)).padStart(9, "0")}`;

async function newCustomer() {
  const [u] = await db
    .insert(users)
    .values({ fullName: "Sari Wulandari", phoneNumber: `+62898${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  return u;
}

async function newBatch(m = merchant, opts: { stock?: number; batchDate?: string; endInMinutes?: number } = {}) {
  const [menu] = await db
    .select()
    .from(menus)
    .where(and(eq(menus.merchantId, m.id), eq(menus.isActive, true), eq(menus.isMysteryBag, false)))
    .orderBy(asc(menus.id))
    .limit(1);
  const now = Date.now();
  const end = now + (opts.endInMinutes ?? 90) * 60_000;
  const [b] = await db
    .insert(surplusBatches)
    .values({
      merchantId: m.id,
      menuId: menu.id,
      batchDate: opts.batchDate ?? wibDate(),
      initialStock: opts.stock ?? 6,
      availableStock: opts.stock ?? 6,
      originalPriceIdr: menu.originalPriceIdr,
      currentDiscountPct: 50,
      currentSellingPriceIdr: Math.max(menu.minRecoveryPriceIdr, Math.round(menu.originalPriceIdr / 2)),
      pickupStartTime: new Date(Math.min(now - 30 * 60_000, end - 2 * 60 * 60_000)),
      pickupEndTime: new Date(end),
    })
    .returning();
  return { batch: b, menu };
}

/** A collected online order: credits the warung's wallet. */
async function collectedOrder() {
  const customer = await newCustomer();
  const { batch } = await newBatch();
  const o = await checkout(db, {
    userId: customer.id,
    input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }),
    pickupQrSecret: TEST_PICKUP_QR_SECRET,
  });
  await simulatePayment(db, { orderId: o.id, userId: customer.id, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
  const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
  return verifyPickup(db, { merchantId: merchant.id, orderId: o.id, input: row.pickupCode, pickupQrSecret: TEST_PICKUP_QR_SECRET });
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
}

function req(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("wallet", () => {
  it("lists collected orders as money in and pays out (simulated on demo data)", async () => {
    const done = await collectedOrder();
    const before = await getWallet(db, merchant.id);
    expect(before.entries[0]).toMatchObject({ kind: "ORDER", amount_idr: done.net_merchant_payout_idr, order_number: done.order_number });
    expect(before.destination).not.toBeNull();
    expect(before.payout_blocked_reason).toBeNull();

    await expectCode(requestPayout(db, merchant.id, PAYOUT_MIN_IDR - 1), "VALIDATION_ERROR");
    await expectCode(requestPayout(db, merchant.id, before.balance_idr + 1), "VALIDATION_ERROR");

    const res = await requestPayout(db, merchant.id, PAYOUT_MIN_IDR);
    expect(res.balance_idr).toBe(before.balance_idr - PAYOUT_MIN_IDR);
    expect(res.payout).toMatchObject({ status: "PAID", simulated: true, amount_idr: PAYOUT_MIN_IDR });
    expect(res.payout.ref).toMatch(/^PO-[0-9A-F]{10}$/);

    const after = await getWallet(db, merchant.id);
    expect(after.entries[0]).toMatchObject({ kind: "PAYOUT", amount_idr: -PAYOUT_MIN_IDR, payout_status: "PAID" });
  });

  it("the shared demo warung can try a payout without emptying its balance", async () => {
    const [demo] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
    const res = await requestPayout(db, demo.id, PAYOUT_MIN_IDR, new Date(), { sharedDemoAccount: true });
    expect(res.payout).toMatchObject({ status: "PAID", simulated: true });
    expect(res.balance_idr).toBe(demo.walletBalanceIdr);
    const [after] = await db.select().from(merchants).where(eq(merchants.id, demo.id));
    expect(after.walletBalanceIdr).toBe(demo.walletBalanceIdr);
    await expectCode(requestPayout(db, demo.id, demo.walletBalanceIdr + 1, new Date(), { sharedDemoAccount: true }), "VALIDATION_ERROR");
  });

  it("allows one payout in progress at a time and needs a payout account", async () => {
    await db.insert(merchantPayouts).values({
      merchantId: merchant.id,
      amountIdr: 5_000,
      status: "PROCESSING",
      bankCode: "BCA",
      accountMasked: "••••1234",
      ref: `PO-T${randomInt(0, 10 ** 8)}`,
    });
    expect((await getWallet(db, merchant.id)).payout_blocked_reason).toMatch(/sedang diproses/);
    await expectCode(requestPayout(db, merchant.id, PAYOUT_MIN_IDR), "CONFLICT");

    await db.update(merchants).set({ bankAccountNumber: null }).where(eq(merchants.id, other.id));
    expect((await getWallet(db, other.id)).destination).toBeNull();
    await expectCode(requestPayout(db, other.id, PAYOUT_MIN_IDR), "VALIDATION_ERROR");
  });
});

describe("reviews", () => {
  it("summarises, filters, and takes the warung's reply (only on its own reviews)", async () => {
    const all = await listMerchantReviews(db, merchant.id, { filter: "all", limit: 100 });
    expect(all.summary.count).toBeGreaterThan(0);
    expect(all.reviews.every((r) => !r.customer_name.includes(" "))).toBe(true);

    const low = await listMerchantReviews(db, merchant.id, { filter: "low", limit: 100 });
    expect(low.reviews.every((r) => r.rating <= 3)).toBe(true);

    const target = all.reviews[0];
    const replied = await replyToReview(db, { merchantId: merchant.id, reviewId: target.id, reply: "  Terima kasih, ditunggu lagi!  " });
    expect(replied.reply).toBe("Terima kasih, ditunggu lagi!");
    expect(replied.replied_at).not.toBeNull();
    const unreplied = await listMerchantReviews(db, merchant.id, { filter: "unreplied", limit: 100 });
    expect(unreplied.reviews.some((r) => r.id === target.id)).toBe(false);

    const cleared = await replyToReview(db, { merchantId: merchant.id, reviewId: target.id, reply: "" });
    expect(cleared.reply).toBeNull();
    await expectCode(replyToReview(db, { merchantId: other.id, reviewId: target.id, reply: "Bukan punyaku" }), "NOT_FOUND");
    const [row] = await db.select().from(reviews).where(eq(reviews.id, target.id));
    expect(row.merchantReply).toBeNull();
  });
});

describe("cashiers", () => {
  it("adds a cashier by phone (creating the account), refuses owners, duplicates and the limit", async () => {
    const p = phone();
    const res = await addCashier(db, { merchantId: merchant.id, ownerUserId: merchant.ownerUserId, phoneNumber: p, fullName: "Dewi Kasir" });
    const cashier = res.cashiers.find((c) => c.full_name === "Dewi Kasir");
    expect(cashier?.phone_number).toBe(`+62${p.slice(1)}`);

    const view = await sessionUserView(db, cashier!.user_id);
    expect(view?.merchant_id).toBeNull();
    expect(view?.cashier_of).toMatchObject({ merchant_id: merchant.id, merchant_name: merchant.merchantName });

    const [owner] = await db.select().from(users).where(eq(users.id, other.ownerUserId));
    await expectCode(
      addCashier(db, { merchantId: merchant.id, ownerUserId: merchant.ownerUserId, phoneNumber: owner.phoneNumber!.replace("+62", "0") }),
      "VALIDATION_ERROR",
    );
    await expectCode(addCashier(db, { merchantId: other.id, ownerUserId: other.ownerUserId, phoneNumber: p }), "CONFLICT");

    while ((await listCashiers(db, merchant.id)).cashiers.length < MAX_CASHIERS_PER_WARUNG) {
      await addCashier(db, { merchantId: merchant.id, ownerUserId: merchant.ownerUserId, phoneNumber: phone() });
    }
    await expectCode(addCashier(db, { merchantId: merchant.id, ownerUserId: merchant.ownerUserId, phoneNumber: phone() }), "VALIDATION_ERROR");

    await removeCashier(db, merchant.id, cashier!.user_id);
    expect((await sessionUserView(db, cashier!.user_id))?.cashier_of).toBeNull();
  });

  it("a cashier works the counter only: orders yes; dashboard, wallet, staff and refunds no", async () => {
    const p = phone();
    const res = await addCashier(db, { merchantId: other.id, ownerUserId: other.ownerUserId, phoneNumber: p, fullName: "Budi Kasir" });
    const cashierId = res.cashiers.find((c) => c.full_name === "Budi Kasir")!.user_id;
    sessionToken = await mintSessionToken(cashierId);

    const ordersRoute = await import("@/app/api/v1/merchant/orders/route");
    const list = await ordersRoute.GET(req("GET", "/merchant/orders?status=ACTIVE"), undefined);
    expect(list.status).toBe(200);

    const dashboard = await import("@/app/api/v1/merchant/dashboard/route");
    const wallet = await import("@/app/api/v1/merchant/wallet/route");
    const staff = await import("@/app/api/v1/merchant/staff/route");
    const cancelReq = await import("@/app/api/v1/merchant/orders/[id]/cancel-request/route");
    expect((await dashboard.GET(req("GET", "/merchant/dashboard"), undefined)).status).toBe(403);
    expect((await wallet.GET(req("GET", "/merchant/wallet"), undefined)).status).toBe(403);
    expect((await staff.GET(req("GET", "/merchant/staff"), undefined)).status).toBe(403);
    const decision = await cancelReq.POST(req("POST", `/merchant/orders/${crypto.randomUUID()}/cancel-request`, { decision: "APPROVE" }), {
      params: Promise.resolve({ id: crypto.randomUUID() }),
    });
    expect(decision.status).toBe(403);
    sessionToken = null;
    await db.delete(merchantStaff).where(eq(merchantStaff.userId, cashierId));
  });
});

describe("pasang lagi menu kemarin", () => {
  it("offers yesterday's menus that are not live today, and publishes them", async () => {
    // Clean slate for this warung: nothing live, one batch yesterday that closed 2 hours from now (yesterday).
    await db
      .update(surplusBatches)
      .set({ status: "EXPIRED" })
      .where(and(eq(surplusBatches.merchantId, other.id), sql`${surplusBatches.status} IN ('ACTIVE','SCHEDULED')`));
    const yesterday = wibDate(new Date(Date.now() - 24 * 60 * 60_000));
    const { batch, menu } = await newBatch(other, { batchDate: yesterday, stock: 7, endInMinutes: 120 - 24 * 60 });
    await db.update(surplusBatches).set({ status: "EXPIRED" }).where(eq(surplusBatches.id, batch.id));

    const candidates = await repeatCandidates(db, other.id);
    const c = candidates.find((x) => x.menu_id === menu.id);
    expect(c).toMatchObject({ initial_stock: 7 });
    expect(Date.parse(c!.pickup_end_time)).toBe(batch.pickupEndTime.getTime() + 24 * 60 * 60_000);
    expect((await repeatCandidates(db, other.id, { maxStock: 5 })).find((x) => x.menu_id === menu.id)?.initial_stock).toBe(5);

    const res = await repeatYesterday(db, other.id);
    expect(res.published).toBeGreaterThanOrEqual(1);
    // Now live today: no longer offered.
    expect((await repeatCandidates(db, other.id)).some((x) => x.menu_id === menu.id)).toBe(false);
    await expectCode(repeatYesterday(db, other.id), "VALIDATION_ERROR");
  });
});
