/**
 * Field pilot: joining with the invite code, "bayar di warung" tickets (no QRIS, no fee,
 * no voucher, stock reserved until the counter), cancel / pickup / no-show, the public
 * pilot results (real pickups only, never demo data) and the reseed guard.
 */
import { randomInt } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, surplusBatches, users } from "@/db/schema";
import { PilotDataPresentError, seedDatabase } from "@/db/seed";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { CheckoutBody } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { getPilotStats, joinPilot } from "@/server/services/merchant/pilot";
import { checkout } from "@/server/services/orders/checkout";
import { cancelOrder } from "@/server/services/orders/orders";
import { closeUnclaimedOrders, verifyPickup } from "@/server/services/orders/pickup";
import { reseed, testDb } from "../helpers/db";
import { TEST_PICKUP_QR_SECRET } from "../setup/constants";

const CODE = "PILOT-IPB-2026";
let db: Db;
let close: () => Promise<void>;
let pilot: typeof merchants.$inferSelect;
let demo: typeof merchants.$inferSelect;
const previousCode = process.env.PILOT_INVITE_CODE;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [pilot] = await db.select().from(merchants).where(eq(merchants.slug, "soto-kuning-mang-oyo-dramaga"));
  [demo] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
  process.env.PILOT_INVITE_CODE = CODE;
});
afterAll(async () => {
  process.env.PILOT_INVITE_CODE = previousCode;
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

async function newBatch(merchantId: string, stock = 6) {
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
      pickupEndTime: new Date(now + 90 * 60_000),
      status: "ACTIVE",
    })
    .returning();
  return { batch: b, menu };
}

const batchRow = async (id: string) => (await db.select().from(surplusBatches).where(eq(surplusBatches.id, id)))[0];
const wallet = async (id: string) =>
  Number((await db.select({ w: merchants.walletBalanceIdr }).from(merchants).where(eq(merchants.id, id)))[0].w);

function order(userId: string, body: Parameters<typeof CheckoutBody.parse>[0]) {
  return checkout(db, { userId, input: CheckoutBody.parse(body), pickupQrSecret: TEST_PICKUP_QR_SECRET });
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
}

describe("joining the pilot", () => {
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
