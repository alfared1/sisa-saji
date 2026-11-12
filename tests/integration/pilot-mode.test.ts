/**
 * Field pilot: joining with the invite code (only with real OTP delivery, never for the
 * demo warung), "bayar di warung" tickets (no QRIS, no fee, no voucher, stock reserved for
 * a short hold), cancel by buyer or warung / pickup / no-show and fair use, the public
 * pilot results (real pickups only, never demo data) and the reseed guard.
 */
import { randomInt } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, surplusBatches, users } from "@/db/schema";
import { PilotDataPresentError, seedDatabase } from "@/db/seed";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import {
  MERCHANT_TICKET_CANCEL_REASONS,
  noShowCancelOpensAt,
  PAY_AT_WARUNG_EXPIRED_REASON,
  PAY_AT_WARUNG_HOLD_MINUTES,
  PAY_AT_WARUNG_MAX_PORTIONS,
  PAY_AT_WARUNG_NO_SHOW_LAST_MINUTES,
} from "@/lib/constants";
import { CheckoutBody } from "@/lib/contracts";
import { DEMO_LOCKED_REASON } from "@/lib/demo-accounts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { getPilotAvailability, getPilotStats, joinPilot, PILOT_REAL_OTP_REQUIRED } from "@/server/services/merchant/pilot";
import { checkout } from "@/server/services/orders/checkout";
import { cancelTicketByMerchant } from "@/server/services/orders/hold";
import { cancelOrder, getOrderForViewer } from "@/server/services/orders/orders";
import { closeUnclaimedOrders, lookupPickup, verifyPickup } from "@/server/services/orders/pickup";
import { reseed, testDb } from "../helpers/db";
import { TEST_PICKUP_QR_SECRET } from "../setup/constants";

const CODE = "PILOT-IPB-2026";
let db: Db;
let close: () => Promise<void>;
let pilot: typeof merchants.$inferSelect;
let demo: typeof merchants.$inferSelect;
const previousEnv = {
  PILOT_INVITE_CODE: process.env.PILOT_INVITE_CODE,
  OTP_DEV_MODE: process.env.OTP_DEV_MODE,
  FONNTE_TOKEN: process.env.FONNTE_TOKEN,
};
/** Login codes really reach the owner (dev mode off, WhatsApp provider configured). */
function realOtp(on: boolean) {
  process.env.OTP_DEV_MODE = on ? "false" : "true";
  if (on) process.env.FONNTE_TOKEN = "test-fonnte-token";
  else delete process.env.FONNTE_TOKEN;
}

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [pilot] = await db.select().from(merchants).where(eq(merchants.slug, "soto-kuning-mang-oyo-dramaga"));
  [demo] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
  process.env.PILOT_INVITE_CODE = CODE;
  realOtp(true);
});
afterAll(async () => {
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await reseed(db); // leave no pilot warung behind for the other suites
  await close();
});

async function newCustomer() {
  const [u] = await db
    .insert(users)
    .values({ fullName: "Pembeli Pilot", phoneNumber: `+62896${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  return u;
}

async function newBatch(merchantId: string, stock = 6, endsInMinutes = 90) {
  const [menu] = await db.select().from(menus).where(eq(menus.merchantId, merchantId)).orderBy(asc(menus.id)).limit(1);
  const now = Date.now();
  const [b] = await db
    .insert(surplusBatches)
    .values({
      merchantId,
      menuId: menu.id,
      batchDate: wibDate(),
      initialStock: stock,
      availableStock: stock,
      originalPriceIdr: menu.originalPriceIdr,
      currentDiscountPct: 50,
      currentSellingPriceIdr: Math.round(menu.originalPriceIdr / 2),
      pickupStartTime: new Date(now - 60 * 60_000),
      pickupEndTime: new Date(now + endsInMinutes * 60_000),
      status: "ACTIVE",
    })
    .returning();
  return { batch: b, menu };
}

const batchRow = async (id: string) => (await db.select().from(surplusBatches).where(eq(surplusBatches.id, id)))[0];
const wallet = async (id: string) =>
  Number((await db.select({ w: merchants.walletBalanceIdr }).from(merchants).where(eq(merchants.id, id)))[0].w);

function order(userId: string, body: Parameters<typeof CheckoutBody.parse>[0], now?: Date) {
  return checkout(db, { userId, input: CheckoutBody.parse(body), pickupQrSecret: TEST_PICKUP_QR_SECRET, now });
}
const minutes = (n: number, from = Date.now()) => new Date(from + n * 60_000);

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe("joining the pilot", () => {
  it("is refused while login codes are shown on screen, so nobody can log in as a real warung", async () => {
    realOtp(false);
    try {
      expect(await getPilotAvailability(db, pilot.id)).toEqual({ invite_open: true, real_otp_delivery: false, demo_locked: false });
      const err = await rejection(joinPilot(db, pilot.id, CODE, 5));
      expect(err.code).toBe("FORBIDDEN");
      expect(err.details).toEqual({ reason: PILOT_REAL_OTP_REQUIRED });
      expect(err.message).toContain("WhatsApp/email asli");
      const [m] = await db.select().from(merchants).where(eq(merchants.id, pilot.id));
      expect(m.isPilot).toBe(false);
    } finally {
      realOtp(true);
    }
    expect((await getPilotAvailability(db, pilot.id)).real_otp_delivery).toBe(true);
  });

  it("is locked for the shared demo warung", async () => {
    expect((await getPilotAvailability(db, demo.id)).demo_locked).toBe(true);
    const err = await rejection(joinPilot(db, demo.id, CODE, 5));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.details).toEqual({ reason: DEMO_LOCKED_REASON });
  });

  it("rejects a wrong code and accepts the team's code (case-insensitive)", async () => {
    await expectCode(joinPilot(db, pilot.id, "TEBAK-TEBAK"), "VALIDATION_ERROR");
    const me = await joinPilot(db, pilot.id, CODE.toLowerCase());
    expect(me.merchant.is_pilot).toBe(true);
    expect(me.merchant.pilot_joined_at).not.toBeNull();
  });

  it("is closed when no invite code is configured", async () => {
    process.env.PILOT_INVITE_CODE = "";
    await expectCode(joinPilot(db, demo.id, CODE), "FORBIDDEN");
    process.env.PILOT_INVITE_CODE = CODE;
  });
});

describe("bayar di warung tickets", () => {
  it("checkout at a pilot warung is a ticket right away: no QRIS, no fee, stock reserved", async () => {
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    const o = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }] });

    expect(o.status).toBe("READY_FOR_PICKUP");
    expect(o.payment_method).toBe("BAYAR_DI_WARUNG");
    expect(o.platform_commission_idr).toBe(0);
    expect(o.total_customer_paid_idr).toBe(o.subtotal_recovery_idr);
    expect(o.qris_string).toBeNull();
    expect(o.paid_at).toBeNull();
    expect(o.pickup_code).toMatch(/^\d{4}$/);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 4, reservedStock: 2 });
  });

  it("refuses the shared demo accounts, so nobody cooks at a real warung for a buyer who does not exist", async () => {
    const { batch } = await newBatch(pilot.id);
    for (const email of ["demo.pembeli@sisasaji.test", "demo.mitra@sisasaji.test"]) {
      const [demoUser] = await db.select().from(users).where(eq(users.email, email));
      await expectCode(order(demoUser.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 1 }] }), "FORBIDDEN");
    }
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });
  });

  it("refuses vouchers at a pilot warung and pay-at-warung at a regular one", async () => {
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    await expectCode(
      order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }], voucher_code: "BAWABEKAL" }),
      "VOUCHER_INVALID",
    );
    const { batch: regular } = await newBatch(demo.id);
    await expectCode(
      order(buyer.id, { merchant_id: demo.id, items: [{ batch_id: regular.id, quantity: 1 }], payment_method: "BAYAR_DI_WARUNG" }),
      "VALIDATION_ERROR",
    );
  });

  it("counts an open ticket as an unpaid hold: a double tap returns it, other items conflict", async () => {
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    const body = { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 1 }] };
    const first = await order(buyer.id, body);
    expect((await order(buyer.id, body)).id).toBe(first.id);
    await expectCode(order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }] }), "CONFLICT");
  });

  it("a cancelled ticket gives its portions back", async () => {
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    const o = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }] });
    const cancelled = await cancelOrder(db, o.id, buyer.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });
  });

  it("the pickup sells the portions, marks it paid, credits impact and no wallet payout", async () => {
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    const o = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }] });
    const before = await wallet(pilot.id);

    const done = await verifyPickup(db, {
      merchantId: pilot.id,
      orderId: o.id,
      input: o.pickup_code!,
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
    });
    expect(done.status).toBe("COMPLETED");
    expect(done.paid_at).not.toBeNull();
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 4, reservedStock: 0 });
    expect(await wallet(pilot.id)).toBe(before);
    const [u] = await db.select().from(users).where(eq(users.id, buyer.id));
    expect(u.totalFoodSavedGrams).toBe(done.food_saved_grams);
    expect(u.totalFoodSavedGrams).toBeGreaterThan(0);
  });

  it("a ticket nobody collects expires and its portions go back, without a payout", async () => {
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 3 }] });
    const before = await wallet(pilot.id);

    const later = new Date(Date.now() + 4 * 60 * 60_000);
    expect(await closeUnclaimedOrders(db, later)).toBeGreaterThanOrEqual(1);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });
    expect(await wallet(pilot.id)).toBe(before);
  });
});

describe("short hold, fair use and the warung's cancel", () => {
  const status = async (id: string) => (await getOrderForViewer(db, id, { userId: "", merchantId: pilot.id })).status;

  it(`holds the portions for at most ${PAY_AT_WARUNG_HOLD_MINUTES} minutes, never past the pickup end`, async () => {
    const t0 = new Date();
    const { batch } = await newBatch(pilot.id, 6, 90);
    const o = await order((await newCustomer()).id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 1 }] }, t0);
    expect(Date.parse(o.pickup_deadline_at)).toBe(minutes(PAY_AT_WARUNG_HOLD_MINUTES, t0.getTime()).getTime());
    expect(o.payment_expires_at).toBe(o.pickup_deadline_at);

    const { batch: closingSoon } = await newBatch(pilot.id, 6, 25);
    const o2 = await order((await newCustomer()).id, { merchant_id: pilot.id, items: [{ batch_id: closingSoon.id, quantity: 1 }] }, t0);
    expect(o2.pickup_deadline_at).toBe(closingSoon.pickupEndTime.toISOString());
  });

  it("expires exactly when the hold ends (no grace) and gives the portions back", async () => {
    const t0 = new Date();
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    const o = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }] }, t0);

    await closeUnclaimedOrders(db, minutes(PAY_AT_WARUNG_HOLD_MINUTES - 1, t0.getTime()));
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 4, reservedStock: 2 });

    await closeUnclaimedOrders(db, minutes(PAY_AT_WARUNG_HOLD_MINUTES, t0.getTime()));
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });
    const seen = await getOrderForViewer(db, o.id, { userId: buyer.id, merchantId: null });
    expect(seen).toMatchObject({ status: "EXPIRED", cancel_reason: PAY_AT_WARUNG_EXPIRED_REASON });
  });

  it("a lapsed ticket cannot be collected, even before the job runs: scan and verify say so", async () => {
    const t0 = new Date();
    const late = minutes(PAY_AT_WARUNG_HOLD_MINUTES + 1, t0.getTime());
    const { batch } = await newBatch(pilot.id);
    const a = await order((await newCustomer()).id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 1 }] }, t0);
    const b = await order((await newCustomer()).id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 1 }] }, t0);

    const viaVerify = await rejection(
      verifyPickup(db, { merchantId: pilot.id, orderId: a.id, input: a.pickup_code!, pickupQrSecret: TEST_PICKUP_QR_SECRET, now: late }),
    );
    expect(viaVerify.code).toBe("ORDER_STATE_CONFLICT");
    expect(viaVerify.message).toContain("lewat batas waktu");

    const viaScan = await rejection(
      lookupPickup(db, { merchantId: pilot.id, input: b.pickup_qr_token!, pickupQrSecret: TEST_PICKUP_QR_SECRET, now: late }),
    );
    expect(viaScan.code).toBe("ORDER_STATE_CONFLICT");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });

    // After the job (or an earlier read) closed them, typing the code or scanning again still says why.
    const typedAgain = await rejection(
      lookupPickup(db, { merchantId: pilot.id, input: a.pickup_code!, pickupQrSecret: TEST_PICKUP_QR_SECRET, now: late }),
    );
    expect(typedAgain.code).toBe("ORDER_STATE_CONFLICT");
    expect(typedAgain.message).toContain("lewat batas waktu");
    const scannedAgain = await rejection(
      lookupPickup(db, { merchantId: pilot.id, input: b.pickup_qr_token!, pickupQrSecret: TEST_PICKUP_QR_SECRET, now: late }),
    );
    expect(scannedAgain.message).toContain("lewat batas waktu");
  });

  it("another buyer's checkout frees lapsed holds on the same menu first", async () => {
    const t0 = new Date();
    const { batch } = await newBatch(pilot.id, 3);
    const first = await order((await newCustomer()).id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 3 }] }, t0);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 0, reservedStock: 3 });

    const later = minutes(PAY_AT_WARUNG_HOLD_MINUTES + 1, t0.getTime());
    const second = await order((await newCustomer()).id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }] }, later);
    expect(second.status).toBe("READY_FOR_PICKUP");
    expect(await status(first.id)).toBe("EXPIRED");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 1, reservedStock: 2 });
  });

  it("a buyer cannot cancel a lapsed ticket to dodge the no-show count", async () => {
    const t0 = new Date();
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    const o = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 1 }] }, t0);
    await expectCode(cancelOrder(db, o.id, buyer.id, minutes(PAY_AT_WARUNG_HOLD_MINUTES + 1, t0.getTime())), "ORDER_STATE_CONFLICT");
    expect(await status(o.id)).toBe("EXPIRED");
  });

  it(`caps a ticket at ${PAY_AT_WARUNG_MAX_PORTIONS} portions`, async () => {
    const { batch } = await newBatch(pilot.id, 10);
    const err = await rejection(
      order((await newCustomer()).id, {
        merchant_id: pilot.id,
        items: [{ batch_id: batch.id, quantity: PAY_AT_WARUNG_MAX_PORTIONS + 1 }],
      }),
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toContain(`${PAY_AT_WARUNG_MAX_PORTIONS} porsi`);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 10, reservedStock: 0 });
  });

  it("an open ticket counts toward the 2 unpaid holds a buyer may have across warung", async () => {
    const buyer = await newCustomer();
    const [third] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.isPilot, false), eq(merchants.isOpen, true), ne(merchants.id, demo.id)))
      .limit(1);
    for (const m of [demo, third]) {
      const { batch } = await newBatch(m.id);
      const pending = await order(buyer.id, { merchant_id: m.id, items: [{ batch_id: batch.id, quantity: 1 }] });
      expect(pending.status).toBe("PENDING_PAYMENT");
    }
    const { batch } = await newBatch(pilot.id);
    const err = await rejection(order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 1 }] }));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toContain("belum dibayar atau belum diambil");
  });

  it("two no-shows within the window block new tickets for a while", async () => {
    const t0 = new Date();
    const buyer = await newCustomer();
    const { batch: b1 } = await newBatch(pilot.id);
    await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: b1.id, quantity: 1 }] }, t0);
    await closeUnclaimedOrders(db, minutes(PAY_AT_WARUNG_HOLD_MINUTES + 1, t0.getTime()));

    const { batch: b2 } = await newBatch(pilot.id);
    const second = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: b2.id, quantity: 1 }] }, minutes(62, t0.getTime()));
    // "Tidak datang" near the end of the second hold.
    const late = new Date(Date.parse(second.pickup_deadline_at) - 60_000);
    await cancelTicketByMerchant(db, { merchantId: pilot.id, orderId: second.id, reason: "NO_SHOW", now: late });

    const { batch: b3 } = await newBatch(pilot.id);
    const err = await rejection(order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: b3.id, quantity: 1 }] }, new Date(late.getTime() + 60_000)));
    expect(err.code).toBe("RATE_LIMITED");
    expect(await batchRow(b3.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });
  });

  it('"Tidak datang": the warung cancels, the portions go back and the buyer sees who cancelled', async () => {
    const buyer = await newCustomer();
    const { batch } = await newBatch(pilot.id);
    const o = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }] });

    await expectCode(cancelTicketByMerchant(db, { merchantId: demo.id, orderId: o.id, reason: "NO_SHOW" }), "NOT_FOUND");
    // Right after checkout the buyer is still inside the promised hold: too early for "Tidak datang".
    const early = await rejection(cancelTicketByMerchant(db, { merchantId: pilot.id, orderId: o.id, reason: "NO_SHOW" }));
    expect(early.code).toBe("ORDER_STATE_CONFLICT");
    expect(early.message).toContain("Stok habis");
    const opensAt = noShowCancelOpensAt(o.created_at, o.pickup_deadline_at);
    expect(Date.parse(o.pickup_deadline_at) - opensAt.getTime()).toBeLessThanOrEqual(PAY_AT_WARUNG_NO_SHOW_LAST_MINUTES * 60_000);
    const done = await cancelTicketByMerchant(db, { merchantId: pilot.id, orderId: o.id, reason: "NO_SHOW", now: opensAt });
    expect(done).toMatchObject({ status: "CANCELLED", cancel_reason: MERCHANT_TICKET_CANCEL_REASONS.NO_SHOW.reason });
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0, status: "ACTIVE" });

    const seen = await getOrderForViewer(db, o.id, { userId: buyer.id, merchantId: null });
    expect(seen).toMatchObject({ status: "CANCELLED", cancel_reason: MERCHANT_TICKET_CANCEL_REASONS.NO_SHOW.reason });
    await expectCode(cancelTicketByMerchant(db, { merchantId: pilot.id, orderId: o.id, reason: "NO_SHOW", now: opensAt }), "ORDER_STATE_CONFLICT");
  });

  it('"Stok habis": the menu\'s remaining stock becomes 0 and it does not count against the buyer', async () => {
    const buyer = await newCustomer();
    // Two tickets the buyer cancelled themselves within the churn window (limit: 3).
    for (let i = 0; i < 2; i++) {
      const { batch } = await newBatch(pilot.id);
      const o = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 1 }] });
      await cancelOrder(db, o.id, buyer.id);
    }
    const { batch } = await newBatch(pilot.id);
    const o = await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: batch.id, quantity: 2 }] });
    const done = await cancelTicketByMerchant(db, { merchantId: pilot.id, orderId: o.id, reason: "OUT_OF_STOCK" });
    expect(done.cancel_reason).toBe(MERCHANT_TICKET_CANCEL_REASONS.OUT_OF_STOCK.reason);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 0, reservedStock: 0, status: "SOLD_OUT" });

    const { batch: next } = await newBatch(pilot.id);
    expect((await order(buyer.id, { merchant_id: pilot.id, items: [{ batch_id: next.id, quantity: 1 }] })).status).toBe("READY_FOR_PICKUP");
  });

  it("only open bayar-di-warung tickets can be cancelled by the warung", async () => {
    const { batch } = await newBatch(demo.id);
    const qris = await order((await newCustomer()).id, { merchant_id: demo.id, items: [{ batch_id: batch.id, quantity: 1 }] });
    await expectCode(cancelTicketByMerchant(db, { merchantId: demo.id, orderId: qris.id, reason: "NO_SHOW" }), "ORDER_STATE_CONFLICT");
  });
});

describe("public pilot results", () => {
  it("counts only verified pickups at pilot warung, never the seeded demo history", async () => {
    const stats = await getPilotStats(db);
    expect(stats.warung_count).toBe(1);
    expect(stats.started_at).not.toBeNull();
    // Exactly the one ticket collected above (2 portions). Excluded: every other warung's seeded history and
    // the ~130 seeded orders this very warung had before it joined the pilot.
    expect(stats.orders_completed).toBe(1);
    expect(stats.portions_rescued).toBe(2);
    expect(stats.food_saved_grams).toBeGreaterThan(0);
    expect(stats.co2_avoided_grams).toBe(Math.round(stats.food_saved_grams * 2.5));
    expect(stats.unique_buyers).toBe(1);
    expect(stats.warung).toEqual([expect.objectContaining({ slug: pilot.slug, orders_completed: 1, portions_rescued: 2 })]);
    expect(stats.daily).toHaveLength(1);
  });
});

describe("reseed guard", () => {
  it("refuses to wipe real pilot data unless explicitly allowed", async () => {
    await expect(seedDatabase(db, { pickupQrSecret: TEST_PICKUP_QR_SECRET })).rejects.toBeInstanceOf(PilotDataPresentError);
    expect((await getPilotStats(db)).orders_completed).toBe(1);
  });
});
