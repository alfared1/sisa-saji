/**
 * Checkout: money math, stock reservation (incl. a 10-way race for 3 portions),
 * merchant/batch/voucher rules, the simulated QRIS payload, "bayar di warung" at a regular
 * (non-pilot) warung, and the lauk chosen per order line.
 */
import { randomInt } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { menus, merchants, orderItems, orders, surplusBatches, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import {
  PAY_AT_WARUNG_HOLD_MINUTES,
  PAY_AT_WARUNG_MAX_PORTIONS,
  PAYMENT_TTL_SECONDS,
  PLATFORM_COMMISSION_DEFAULT_IDR,
} from "@/lib/constants";
import { CheckoutBody } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import {
  ABANDONED_ORDERS_WINDOW_MINUTES,
  checkout,
  MAX_ABANDONED_ORDERS_IN_WINDOW,
  MAX_PENDING_ORDERS_PER_USER,
  maxPortionsPerCustomer,
} from "@/server/services/orders/checkout";
import { hasValidQrisCrc, parseTlv } from "@/server/services/payment/qris";
import { reseed, testDb } from "../helpers/db";
import { TEST_PICKUP_QR_SECRET } from "../setup/constants";

let db: Db;
let close: () => Promise<void>;
let demoMerchant: typeof merchants.$inferSelect;
let other: typeof merchants.$inferSelect;

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [demoMerchant] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
  [other] = await db.select().from(merchants).where(eq(merchants.slug, "soto-kuning-mang-oyo-dramaga"));
});
afterAll(async () => close());

/* ---------------- fixtures ---------------- */

async function newCustomer(name = "Pembeli Uji") {
  const [u] = await db
    .insert(users)
    .values({ fullName: name, phoneNumber: `+62897${String(randomInt(0, 10 ** 8)).padStart(8, "0")}` })
    .returning();
  return u;
}

/** Inserts an ACTIVE batch for the merchant's first menu at exactly 50% off. */
async function newBatch(
  merchantId: string,
  opts: {
    stock?: number;
    endInMin?: number;
    status?: "ACTIVE" | "EXPIRED";
    menuIndex?: number;
    /** Sets the menu's lauk options and the batch's lauk still available tonight. */
    lauk?: { options: string[]; available: string[] };
  } = {},
) {
  // Cheapest first (Teh Euis: Rp 17.000, Rp 18.000, Rp 20.000) so the voucher math is deterministic.
  const menuList = await db
    .select()
    .from(menus)
    .where(eq(menus.merchantId, merchantId))
    .orderBy(asc(menus.originalPriceIdr), asc(menus.id));
  let menu = menuList[opts.menuIndex ?? 0];
  if (opts.lauk) {
    [menu] = await db.update(menus).set({ laukOptions: opts.lauk.options }).where(eq(menus.id, menu.id)).returning();
  }
  const now = Date.now();
  const stock = opts.stock ?? 5;
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
      pickupEndTime: new Date(now + (opts.endInMin ?? 90) * 60_000),
      status: opts.status ?? "ACTIVE",
      laukAvailable: opts.lauk?.available ?? [],
    })
    .returning();
  return { batch: b, menu };
}

const batchRow = async (id: string) => (await db.select().from(surplusBatches).where(eq(surplusBatches.id, id)))[0];

function run(userId: string, body: Parameters<typeof CheckoutBody.parse>[0], now?: Date, onDb: Db = db) {
  return checkout(onDb, { userId, input: CheckoutBody.parse(body), pickupQrSecret: TEST_PICKUP_QR_SECRET, now });
}

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
  return err as ApiError;
}

/* ---------------- tests ---------------- */

describe("POST /orders/checkout — happy path", () => {
  it("reserves stock, snapshots prices and computes the money flow", async () => {
    const customer = await newCustomer();
    const a = await newBatch(demoMerchant.id, { stock: 5, menuIndex: 0 });
    const b = await newBatch(demoMerchant.id, { stock: 4, menuIndex: 1, endInMin: 45 });
    const now = new Date();

    const order = await run(
      customer.id,
      {
        merchant_id: demoMerchant.id,
        items: [
          { batch_id: a.batch.id, quantity: 2 },
          { batch_id: b.batch.id, quantity: 1 },
        ],
        uses_own_lunchbox: true,
      },
      now,
    );

    const sellA = a.batch.currentSellingPriceIdr;
    const sellB = b.batch.currentSellingPriceIdr;
    const subtotalOriginal = 2 * a.batch.originalPriceIdr + b.batch.originalPriceIdr;
    const subtotalRecovery = 2 * sellA + sellB;
    expect(order).toMatchObject({
      status: "PENDING_PAYMENT",
      subtotal_original_idr: subtotalOriginal,
      subtotal_recovery_idr: subtotalRecovery,
      voucher_discount_idr: 0,
      platform_commission_idr: PLATFORM_COMMISSION_DEFAULT_IDR,
      total_customer_paid_idr: subtotalRecovery + PLATFORM_COMMISSION_DEFAULT_IDR,
      net_merchant_payout_idr: subtotalRecovery,
      money_saved_idr: subtotalOriginal - subtotalRecovery,
      uses_own_lunchbox: true,
      payment_method: "QRIS",
      paid_at: null,
      pickup_code: null, // hidden until paid
      pickup_qr_token: null,
      food_saved_grams: 2 * a.menu.portionWeightGrams + b.menu.portionWeightGrams,
    });
    expect(order.order_number).toMatch(new RegExp(`^SS-${wibDate(now).replaceAll("-", "")}-\\d{4}$`));
    expect(order.merchant.id).toBe(demoMerchant.id);
    expect(order.items).toHaveLength(2);
    expect(order.items.find((i) => i.batch_id === a.batch.id)).toMatchObject({
      quantity: 2,
      unit_original_price_idr: a.batch.originalPriceIdr,
      unit_selling_price_idr: sellA,
      discount_pct: 50,
      menu_name: a.menu.menuName,
    });

    // Payment window: now + TTL; pickup deadline = earliest batch end (b).
    expect(new Date(order.payment_expires_at).getTime()).toBe(now.getTime() + PAYMENT_TTL_SECONDS * 1000);
    expect(order.pickup_deadline_at).toBe(b.batch.pickupEndTime.toISOString());

    // Stock moved from available to reserved.
    expect(await batchRow(a.batch.id)).toMatchObject({ availableStock: 3, reservedStock: 2 });
    expect(await batchRow(b.batch.id)).toMatchObject({ availableStock: 3, reservedStock: 1 });

    // Stored secrets: 4-digit code, signed QR token, simulated gateway ref.
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.pickupCode).toMatch(/^\d{4}$/);
    expect(row.pickupQrToken.startsWith(`${order.id}.`)).toBe(true);
    expect(row.paymentGatewayRef).toMatch(/^SIM-[0-9A-F]{16}$/);

    // QRIS: valid CRC, dynamic, amount tag 54 = total paid, reference = order number.
    const qris = order.qris_string!;
    expect(hasValidQrisCrc(qris)).toBe(true);
    const tags = parseTlv(qris);
    expect(tags.get("01")).toBe("12");
    expect(tags.get("54")).toBe(String(order.total_customer_paid_idr));
    expect(tags.get("53")).toBe("360");
    expect(parseTlv(tags.get("62")!).get("01")).toBe(order.order_number);
    expect(tags.get("59")).toBe(demoMerchant.merchantName.slice(0, 25));
  });

  it("payment window never extends past the pickup deadline; order numbers are sequential", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { endInMin: 4 });
    const now = new Date();
    const o1 = await run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }, now);
    expect(o1.payment_expires_at).toBe(batch.pickupEndTime.toISOString());

    const o2 = await run((await newCustomer()).id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }, now);
    const seq = (n: string) => Number(n.slice(-4));
    expect(seq(o2.order_number)).toBeGreaterThan(seq(o1.order_number));
  });

  it("duplicate batch lines are merged", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 4 });
    const order = await run(customer.id, {
      merchant_id: demoMerchant.id,
      items: [
        { batch_id: batch.id, quantity: 1 },
        { batch_id: batch.id, quantity: 2 },
      ],
    });
    expect(order.items).toEqual([expect.objectContaining({ batch_id: batch.id, quantity: 3 })]);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 1, reservedStock: 3 });
  });

  it("validates scheduled_pickup_time against [now, deadline]", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { endInMin: 60 });
    const items = [{ batch_id: batch.id, quantity: 1 }];
    const now = new Date();

    const err = await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items, scheduled_pickup_time: new Date(now.getTime() + 2 * 3600_000).toISOString() }, now),
      "VALIDATION_ERROR",
    );
    expect(err.details).toEqual([expect.objectContaining({ path: "scheduled_pickup_time" })]);
    await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items, scheduled_pickup_time: new Date(now.getTime() - 3600_000).toISOString() }, now),
      "VALIDATION_ERROR",
    );
    // Rolled back: nothing reserved.
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });

    const at = new Date(now.getTime() + 30 * 60_000).toISOString();
    const ok = await run(customer.id, { merchant_id: demoMerchant.id, items, scheduled_pickup_time: at }, now);
    expect(ok.scheduled_pickup_time).toBe(at);
  });
});

describe("POST /orders/checkout — concurrency", () => {
  it("12 parallel checkouts (separate connections) for 1 portion each → exactly 3 succeed", async () => {
    const { batch } = await newBatch(other.id, { stock: 3 });
    const buyers = await Promise.all(Array.from({ length: 12 }, (_, i) => newCustomer(`Rebutan ${i + 1}`)));
    const { db: racingDb, pool } = createDb(process.env.DATABASE_URL!, { max: 12 });
    try {
      const results = await Promise.allSettled(
        buyers.map((u) =>
          run(u.id, { merchant_id: other.id, items: [{ batch_id: batch.id, quantity: 1 }] }, undefined, racingDb),
        ),
      );
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(won).toHaveLength(3);
      expect(lost).toHaveLength(9);
      for (const l of lost) {
        expect(l.reason).toBeInstanceOf(ApiError);
        expect((l.reason as ApiError).code).toBe("OUT_OF_STOCK");
      }
    } finally {
      await pool.end();
    }

    const after = await batchRow(batch.id);
    const items = await db.select().from(orderItems).where(eq(orderItems.surplusBatchId, batch.id));
    const pending = await db.select({ id: orders.id, code: orders.pickupCode }).from(orders).where(eq(orders.status, "PENDING_PAYMENT"));
    const sold = 0; // nothing paid yet
    expect(after).toMatchObject({ initialStock: 3, availableStock: 0, reservedStock: 3 });
    expect(after.initialStock).toBe(after.availableStock + after.reservedStock + sold);
    expect(items.reduce((s, i) => s + i.quantity, 0)).toBe(3);
    // Order numbers and pickup codes are unique.
    const winners = items.map((i) => i.orderId);
    const winRows = await db.select().from(orders).where(eq(orders.merchantId, other.id));
    const mine = winRows.filter((o) => winners.includes(o.id));
    expect(new Set(mine.map((o) => o.orderNumber)).size).toBe(3);
    expect(new Set(mine.map((o) => o.pickupCode)).size).toBe(3);
    expect(pending.length).toBeGreaterThanOrEqual(3);
  });
});

describe("POST /orders/checkout — rules", () => {
  it("DIFFERENT_MERCHANT when a batch belongs to another warung (nothing reserved)", async () => {
    const customer = await newCustomer();
    const mine = await newBatch(demoMerchant.id);
    const theirs = await newBatch(other.id);
    await expectCode(
      run(customer.id, {
        merchant_id: demoMerchant.id,
        items: [
          { batch_id: mine.batch.id, quantity: 1 },
          { batch_id: theirs.batch.id, quantity: 1 },
        ],
      }),
      "DIFFERENT_MERCHANT",
    );
    expect(await batchRow(mine.batch.id)).toMatchObject({ availableStock: 5, reservedStock: 0 });
  });

  it("BATCH_CLOSED for an ended pickup window, a non-ACTIVE batch or a closed warung", async () => {
    const customer = await newCustomer();
    const ended = await newBatch(demoMerchant.id, { endInMin: 30 });
    const later = new Date(Date.now() + 31 * 60_000);
    await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: ended.batch.id, quantity: 1 }] }, later),
      "BATCH_CLOSED",
    );

    const expired = await newBatch(demoMerchant.id, { status: "EXPIRED" });
    await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: expired.batch.id, quantity: 1 }] }),
      "BATCH_CLOSED",
    );

    const open = await newBatch(demoMerchant.id);
    await db.update(merchants).set({ isOpen: false }).where(eq(merchants.id, demoMerchant.id));
    try {
      await expectCode(
        run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: open.batch.id, quantity: 1 }] }),
        "BATCH_CLOSED",
      );
    } finally {
      await db.update(merchants).set({ isOpen: true }).where(eq(merchants.id, demoMerchant.id));
    }
  });

  it("OUT_OF_STOCK when asking for more than available; NOT_FOUND for unknown merchant/batch", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 2 });
    const err = await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 3 }] }),
      "OUT_OF_STOCK",
    );
    expect(err.details).toMatchObject({ batch_id: batch.id, available_stock: 2 });
    await expectCode(
      run(customer.id, { merchant_id: "00000000-0000-4000-8000-000000000000", items: [{ batch_id: batch.id, quantity: 1 }] }),
      "NOT_FOUND",
    );
    await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: "00000000-0000-4000-8000-000000000000", quantity: 1 }] }),
      "NOT_FOUND",
    );
  });

  it("a merchant cannot order from their own warung", async () => {
    const { batch } = await newBatch(demoMerchant.id);
    await expectCode(
      run(demoMerchant.ownerUserId, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }),
      "FORBIDDEN",
    );
  });

  it("vouchers: unknown code and minimum subtotal → VOUCHER_INVALID; valid voucher lowers the total", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 6 }); // Rp 8.500 per portion
    const one = [{ batch_id: batch.id, quantity: 1 }];

    await expectCode(run(customer.id, { merchant_id: demoMerchant.id, items: one, voucher_code: "GRATIS100" }), "VOUCHER_INVALID");
    const minErr = await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: one, voucher_code: "hemat2k" }),
      "VOUCHER_INVALID",
    );
    expect(minErr.details).toEqual({ min_subtotal_idr: 10000 });
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });

    const two = [{ batch_id: batch.id, quantity: 2 }];
    const order = await run(customer.id, { merchant_id: demoMerchant.id, items: two, voucher_code: "HEMAT2K" });
    const recovery = 2 * batch.currentSellingPriceIdr;
    expect(order).toMatchObject({
      voucher_discount_idr: 2000,
      subtotal_recovery_idr: recovery,
      total_customer_paid_idr: recovery + PLATFORM_COMMISSION_DEFAULT_IDR - 2000,
      net_merchant_payout_idr: recovery, // platform funds the voucher
      money_saved_idr: 2 * batch.originalPriceIdr - recovery + 2000,
    });
    expect(parseTlv(order.qris_string!).get("54")).toBe(String(order.total_customer_paid_idr));
  });
});

describe("POST /orders/checkout — fair use (no stock hoarding)", () => {
  let third: typeof merchants.$inferSelect;
  beforeAll(async () => {
    [third] = await db.select().from(merchants).where(eq(merchants.slug, "geprek-kang-dadan-babakan-tengah"));
  });

  it("a double tap with the same items returns the same unpaid order; different items at the same warung → CONFLICT", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 6 });
    const items = [{ batch_id: batch.id, quantity: 1 }];
    const first = await run(customer.id, { merchant_id: demoMerchant.id, items });
    const again = await run(customer.id, { merchant_id: demoMerchant.id, items });
    expect(again.id).toBe(first.id);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 1 });

    const err = await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 2 }] }),
      "CONFLICT",
    );
    expect(err.details).toMatchObject({ order_id: first.id });
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 1 });
  });

  it(`at most ${MAX_PENDING_ORDERS_PER_USER} unpaid orders across warung; an expired one no longer counts`, async () => {
    const customer = await newCustomer();
    const a = (await newBatch(demoMerchant.id, { stock: 6 })).batch;
    const b = (await newBatch(other.id, { stock: 6 })).batch;
    const c = (await newBatch(third.id, { stock: 6 })).batch;
    const stale = await run(
      customer.id,
      { merchant_id: demoMerchant.id, items: [{ batch_id: a.id, quantity: 1 }] },
      new Date(Date.now() - (PAYMENT_TTL_SECONDS + 60) * 1000),
    );
    await run(customer.id, { merchant_id: other.id, items: [{ batch_id: b.id, quantity: 1 }] });
    await run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: a.id, quantity: 2 }] });
    const [s] = await db.select().from(orders).where(eq(orders.id, stale.id));
    expect(s.status).toBe("EXPIRED");

    await expectCode(run(customer.id, { merchant_id: third.id, items: [{ batch_id: c.id, quantity: 1 }] }), "CONFLICT");
    expect(await batchRow(c.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });
  });

  it("caps the portions of one batch a customer can hold (paid orders included)", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 10 });
    const cap = maxPortionsPerCustomer(10);
    expect(cap).toBe(5);
    await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: cap + 1 }] }),
      "VALIDATION_ERROR",
    );
    const o = await run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: cap - 1 }] });
    await db.update(orders).set({ status: "READY_FOR_PICKUP" }).where(eq(orders.id, o.id));
    await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 2 }] }),
      "VALIDATION_ERROR",
    );
    await run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 1 }] });
  });

  it(`refuses new checkouts after ${MAX_ABANDONED_ORDERS_IN_WINDOW} cancelled/expired ones in ${ABANDONED_ORDERS_WINDOW_MINUTES} min`, async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 6 });
    const items = [{ batch_id: batch.id, quantity: 1 }];
    for (let i = 0; i < MAX_ABANDONED_ORDERS_IN_WINDOW; i++) {
      const o = await run(customer.id, { merchant_id: demoMerchant.id, items });
      await db.update(orders).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(orders.id, o.id));
    }
    await expectCode(run(customer.id, { merchant_id: demoMerchant.id, items }), "RATE_LIMITED");
    const later = new Date(Date.now() + (ABANDONED_ORDERS_WINDOW_MINUTES + 1) * 60_000);
    const { batch: fresh } = await newBatch(demoMerchant.id, { stock: 6, endInMin: 240 });
    await run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: fresh.id, quantity: 1 }] }, later);
  });

  it("parallel checkouts of one customer are serialised: only one unpaid order is created", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(other.id, { stock: 6 });
    const results = await Promise.allSettled(
      [1, 2, 3].map((q) => run(customer.id, { merchant_id: other.id, items: [{ batch_id: batch.id, quantity: q }] })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const pending = await db.select().from(orders).where(eq(orders.customerId, customer.id));
    expect(pending).toHaveLength(1);
  });
});

describe("POST /orders/checkout — bayar di warung at a regular warung", () => {
  it("is a ticket right away: READY_FOR_PICKUP, no QRIS, fee 0, portions held at most 30 minutes", async () => {
    expect(demoMerchant.isPilot).toBe(false);
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 5, endInMin: 120 });
    const now = new Date();
    const o = await run(
      customer.id,
      { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 2 }], payment_method: "BAYAR_DI_WARUNG" },
      now,
    );
    expect(o).toMatchObject({
      status: "READY_FOR_PICKUP",
      payment_method: "BAYAR_DI_WARUNG",
      platform_commission_idr: 0,
      total_customer_paid_idr: o.subtotal_recovery_idr,
      qris_string: null,
      paid_at: null,
      merchant: { id: demoMerchant.id, is_pilot: false },
    });
    expect(o.pickup_code).toMatch(/^\d{4}$/);
    expect(Date.parse(o.pickup_deadline_at)).toBe(now.getTime() + PAY_AT_WARUNG_HOLD_MINUTES * 60_000);
    expect(o.payment_expires_at).toBe(o.pickup_deadline_at);
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(row.paymentGatewayRef).toBeNull();
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 3, reservedStock: 2 });
  });

  it("never holds past the batch's pickup end", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { endInMin: 20 });
    const o = await run(customer.id, {
      merchant_id: demoMerchant.id,
      items: [{ batch_id: batch.id, quantity: 1 }],
      payment_method: "BAYAR_DI_WARUNG",
    });
    expect(o.pickup_deadline_at).toBe(batch.pickupEndTime.toISOString());
  });

  it("refuses a voucher with cash, and caps a cash ticket at the portion limit (nothing reserved)", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 10 });
    const err = await expectCode(
      run(customer.id, {
        merchant_id: demoMerchant.id,
        items: [{ batch_id: batch.id, quantity: 2 }],
        payment_method: "BAYAR_DI_WARUNG",
        voucher_code: "HEMAT2K",
      }),
      "VOUCHER_INVALID",
    );
    expect(err.message).toBe("Voucher hanya untuk bayar lewat QRIS atau dompet digital.");
    const cap = await expectCode(
      run(customer.id, {
        merchant_id: demoMerchant.id,
        items: [{ batch_id: batch.id, quantity: PAY_AT_WARUNG_MAX_PORTIONS + 1 }],
        payment_method: "BAYAR_DI_WARUNG",
      }),
      "VALIDATION_ERROR",
    );
    expect(cap.message).toContain(`${PAY_AT_WARUNG_MAX_PORTIONS} porsi`);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 10, reservedStock: 0 });
  });

  it("a QRIS checkout first frees portions on another buyer's lapsed cash ticket", async () => {
    const t0 = new Date();
    const { batch } = await newBatch(demoMerchant.id, { stock: 3, endInMin: 120 });
    const first = await run(
      (await newCustomer()).id,
      { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 3 }], payment_method: "BAYAR_DI_WARUNG" },
      t0,
    );
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 0, reservedStock: 3 });

    const later = new Date(t0.getTime() + (PAY_AT_WARUNG_HOLD_MINUTES + 1) * 60_000);
    const second = await run(
      (await newCustomer()).id,
      { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 2 }] },
      later,
    );
    expect(second.status).toBe("PENDING_PAYMENT");
    const [lapsed] = await db.select().from(orders).where(eq(orders.id, first.id));
    expect(lapsed.status).toBe("EXPIRED");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 1, reservedStock: 2 });
  });
});

describe("POST /orders/checkout — lauk per line", () => {
  const LAUK = { options: ["Ayam goreng", "Pepes ikan mas", "Tahu tempe bacem"], available: ["Ayam goreng", "Pepes ikan mas"] };

  it("snapshots the chosen lauk in the stored casing; an omitted lauk stays null", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 6, lauk: LAUK });
    const o = await run(customer.id, {
      merchant_id: demoMerchant.id,
      items: [{ batch_id: batch.id, quantity: 1, lauk: "  ayam   GORENG " }],
    });
    expect(o.items).toEqual([expect.objectContaining({ batch_id: batch.id, quantity: 1, lauk: "Ayam goreng" })]);
    const rows = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(rows.map((r) => r.laukChoice)).toEqual(["Ayam goreng"]);

    const plain = await run((await newCustomer()).id, {
      merchant_id: demoMerchant.id,
      items: [{ batch_id: batch.id, quantity: 1 }],
    });
    expect(plain.items).toEqual([expect.objectContaining({ lauk: null })]);
  });

  it("refuses a sold-out or unknown lauk and rolls the reservation back", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 6, lauk: LAUK });
    const soldOut = await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 1, lauk: "Tahu tempe bacem" }] }),
      "VALIDATION_ERROR",
    );
    expect(soldOut.message).toBe("Lauk Tahu tempe bacem sudah habis. Pilih lauk lain, ya.");
    expect(soldOut.details).toEqual([
      expect.objectContaining({ path: "items", batch_id: batch.id, lauk: "Tahu tempe bacem", lauk_available: LAUK.available }),
    ]);
    const unknown = await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 1, lauk: "Rendang" }] }),
      "VALIDATION_ERROR",
    );
    expect(unknown.message).toContain("tidak ada di menu ini");
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });
    expect(await db.select().from(orders).where(eq(orders.customerId, customer.id))).toHaveLength(0);
  });

  it("one batch with two lauk: two order lines, one reservation of the sum", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 6, lauk: LAUK });
    const o = await run(customer.id, {
      merchant_id: demoMerchant.id,
      items: [
        { batch_id: batch.id, quantity: 1, lauk: "Ayam goreng" },
        { batch_id: batch.id, quantity: 1, lauk: "Pepes ikan mas" },
        { batch_id: batch.id, quantity: 1, lauk: "ayam goreng" },
      ],
    });
    expect(o.items).toHaveLength(2);
    expect(o.items.find((i) => i.lauk === "Ayam goreng")?.quantity).toBe(2);
    expect(o.items.find((i) => i.lauk === "Pepes ikan mas")?.quantity).toBe(1);
    expect(o.subtotal_recovery_idr).toBe(3 * batch.currentSellingPriceIdr);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 3, reservedStock: 3 });
  });

  it("the per-buyer cap and the cash ticket cap sum the lauk lines of a batch", async () => {
    const { batch } = await newBatch(demoMerchant.id, { stock: 6, lauk: LAUK }); // cap: 3 per buyer
    expect(maxPortionsPerCustomer(6)).toBe(3);
    await expectCode(
      run((await newCustomer()).id, {
        merchant_id: demoMerchant.id,
        items: [
          { batch_id: batch.id, quantity: 2, lauk: "Ayam goreng" },
          { batch_id: batch.id, quantity: 2, lauk: "Pepes ikan mas" },
        ],
      }),
      "VALIDATION_ERROR",
    );
    const cash = await expectCode(
      run((await newCustomer()).id, {
        merchant_id: demoMerchant.id,
        items: [
          { batch_id: batch.id, quantity: 2, lauk: "Ayam goreng" },
          { batch_id: batch.id, quantity: 2, lauk: "Pepes ikan mas" },
        ],
        payment_method: "BAYAR_DI_WARUNG",
      }),
      "VALIDATION_ERROR",
    );
    expect(cash.details).toEqual([expect.objectContaining({ batch_id: batch.id, max_quantity: PAY_AT_WARUNG_MAX_PORTIONS })]);
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 6, reservedStock: 0 });
  });

  it("a double tap with the same lauk returns the same order; another lauk conflicts", async () => {
    const customer = await newCustomer();
    const { batch } = await newBatch(demoMerchant.id, { stock: 6, lauk: LAUK });
    const first = await run(customer.id, {
      merchant_id: demoMerchant.id,
      items: [{ batch_id: batch.id, quantity: 1, lauk: "Ayam goreng" }],
    });
    const again = await run(customer.id, {
      merchant_id: demoMerchant.id,
      items: [{ batch_id: batch.id, quantity: 1, lauk: "AYAM GORENG" }],
    });
    expect(again.id).toBe(first.id);
    const err = await expectCode(
      run(customer.id, { merchant_id: demoMerchant.id, items: [{ batch_id: batch.id, quantity: 1, lauk: "Pepes ikan mas" }] }),
      "CONFLICT",
    );
    expect(err.details).toMatchObject({ order_id: first.id });
    expect(await batchRow(batch.id)).toMatchObject({ availableStock: 5, reservedStock: 1 });
  });
});
