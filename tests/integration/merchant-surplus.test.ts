import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, ne } from "drizzle-orm";
import {
  batchPhotos,
  discountAdjustmentLogs,
  menus,
  merchants,
  orders,
  surplusBatches,
  users,
  type Menu,
  type Merchant,
} from "@/db/schema";
import { BatchPatchBody, CheckoutBody, PublishBody, StockPatchBody, type MerchantBatchView } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { checkout } from "@/server/services/orders/checkout";
import { simulatePayment } from "@/server/services/orders/orders";
import { pollMerchantEvents } from "@/server/services/merchant/stream";
import {
  activateScheduledBatches,
  patchBatch,
  patchBatchStock,
  priceForDiscount,
  publishSurplus,
  quoteSurplus,
  uploadBatchPhoto,
} from "@/server/services/merchant/surplus";
import { reseed, testDb } from "../helpers/db";
import { TEST_PAYMENT_WEBHOOK_SECRET, TEST_PICKUP_QR_SECRET } from "../setup/constants";

const { db, close } = testDb();
const MIN = 60_000;
let merchant: Merchant;
let menu: Menu;
let customerId: string;

async function expectApiError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
  return err as ApiError;
}

const inMin = (now: Date, m: number) => new Date(now.getTime() + m * MIN).toISOString();

async function publish(stock: number, endInMin = 120, extra: Record<string, unknown> = {}, now = new Date()) {
  return publishSurplus(
    db,
    merchant.id,
    PublishBody.parse({ menu_id: menu.id, initial_stock: stock, pickup_end_time: inMin(now, endInMin), ...extra }),
    now,
  );
}

async function batchRow(id: string) {
  const [b] = await db.select().from(surplusBatches).where(eq(surplusBatches.id, id));
  return b;
}

function expectInvariant(v: MerchantBatchView) {
  expect(v.initial_stock).toBe(v.available_stock + v.reserved_stock + v.sold);
  expect(v.sold).toBeGreaterThanOrEqual(0);
}

beforeAll(async () => {
  await reseed(db);
  const [row] = await db
    .select({ merchant: merchants })
    .from(merchants)
    .innerJoin(users, eq(users.id, merchants.ownerUserId))
    .where(eq(users.email, "demo.mitra@sisasaji.test"));
  merchant = row.merchant;
  [menu] = await db
    .select()
    .from(menus)
    .where(
      and(
        eq(menus.merchantId, merchant.id),
        eq(menus.isActive, true),
        eq(menus.isMysteryBag, false),
        ne(menus.category, "MYSTERY_BAG"),
      ),
    )
    .orderBy(asc(menus.createdAt))
    .limit(1);
  const [c] = await db.select().from(users).where(eq(users.email, "demo.pembeli@sisasaji.test"));
  customerId = c.id;
});
afterAll(close);

describe("POST /merchant/surplus/quote-ai", () => {
  it("returns the contract shape with a monotonic schedule and Indonesian explanation", async () => {
    const now = new Date();
    const q = await quoteSurplus(db, merchant.id, { menu_id: menu.id, available_stock: 8, pickup_end_time: inMin(now, 150) }, now);
    expect(q.menu_id).toBe(menu.id);
    expect(q.original_price_idr).toBe(menu.originalPriceIdr);
    expect(q.min_recovery_price_idr).toBe(menu.minRecoveryPriceIdr);
    expect(q.sellout_probability).toBeGreaterThanOrEqual(0.02);
    expect(q.sellout_probability).toBeLessThanOrEqual(0.98);
    expect(q.recommended_selling_price_idr).toBeGreaterThanOrEqual(menu.minRecoveryPriceIdr);
    expect(q.recommended_selling_price_idr % 500 === 0 || q.floor_applied).toBe(true);
    expect(q.minutes_to_close).toBe(150);
    expect(q.active_users_in_radius).toBeGreaterThanOrEqual(0);
    expect(["heuristic-v0", "lgbm-v1"]).toContain(q.model_version);
    expect(q.escalation_schedule.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < q.escalation_schedule.length; i++) {
      expect(q.escalation_schedule[i].discount_pct).toBeGreaterThanOrEqual(q.escalation_schedule[i - 1].discount_pct);
    }
    expect(q.explanation.length).toBeGreaterThanOrEqual(3);
    expect(q.explanation.join(" ")).toMatch(/radius 2 km/);
    expect(q.explanation.join(" ")).toMatch(/Peluang habis terjual/);
  });

  it("404s on another merchant's menu and rejects a past closing time", async () => {
    const foreign = (await db.select().from(menus)).find((m) => m.merchantId !== merchant.id)!;
    const now = new Date();
    await expectApiError(quoteSurplus(db, merchant.id, { menu_id: foreign.id, available_stock: 5, pickup_end_time: inMin(now, 60) }, now), "NOT_FOUND");
    await expectApiError(quoteSurplus(db, merchant.id, { menu_id: menu.id, available_stock: 5, pickup_end_time: inMin(now, -5) }, now), "VALIDATION_ERROR");
  });
});

describe("POST /merchant/surplus/publish", () => {
  it("creates an ACTIVE batch with the optimizer price and an INITIAL_PUBLISH log", async () => {
    const res = await publish(10, 120);
    const b = res.batch;
    expect(b.status).toBe("ACTIVE");
    expect(b.initial_stock).toBe(10);
    expect(b.available_stock).toBe(10);
    expect(b.reserved_stock).toBe(0);
    expect(b.sold).toBe(0);
    expect(b.current_selling_price_idr).toBeGreaterThanOrEqual(menu.minRecoveryPriceIdr);
    expect(b.current_discount_pct).toBeGreaterThanOrEqual(40);
    expect(b.predicted_sellout_prob).not.toBeNull();
    expect(res.notified_devices).toBeGreaterThanOrEqual(0);
    expect(b.next_escalation === null || Date.parse(b.next_escalation.at) > Date.now() - MIN).toBe(true);

    const logs = await db.select().from(discountAdjustmentLogs).where(eq(discountAdjustmentLogs.surplusBatchId, b.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      triggerReason: "INITIAL_PUBLISH",
      newDiscountPct: b.current_discount_pct,
      newPriceIdr: b.current_selling_price_idr,
      remainingStock: 10,
    });
  });

  it("applies a manual discount override but never below the floor", async () => {
    const res = await publish(5, 90, { discount_pct_override: 90 });
    const expected = priceForDiscount(menu.originalPriceIdr, menu.minRecoveryPriceIdr, 90);
    expect(res.batch.current_selling_price_idr).toBe(expected.sellingPriceIdr);
    expect(res.batch.current_selling_price_idr).toBeGreaterThanOrEqual(menu.minRecoveryPriceIdr);
  });

  it("schedules a future start (SCHEDULED, no notifications)", async () => {
    const now = new Date();
    const res = await publish(6, 180, { pickup_start_time: inMin(now, 60) }, now);
    expect(res.batch.status).toBe("SCHEDULED");
    expect(res.notified_devices).toBe(0);
    expect(res.batch.next_escalation).toBeNull();
  });

  it("validates the pickup window (>10 min, ≤12 h) and the menu", async () => {
    await expectApiError(publish(5, 5), "VALIDATION_ERROR");
    await expectApiError(publish(5, 13 * 60), "VALIDATION_ERROR");
    const foreign = (await db.select().from(menus)).find((m) => m.merchantId !== merchant.id)!;
    const now = new Date();
    await expectApiError(
      publishSurplus(db, merchant.id, PublishBody.parse({ menu_id: foreign.id, initial_stock: 3, pickup_end_time: inMin(now, 60) }), now),
      "NOT_FOUND",
    );
    await db.update(menus).set({ isActive: false }).where(eq(menus.id, menu.id));
    try {
      await expectApiError(publish(5, 60), "VALIDATION_ERROR");
    } finally {
      await db.update(menus).set({ isActive: true }).where(eq(menus.id, menu.id));
    }
  });
});

describe("PATCH /merchant/surplus/:id/stock", () => {
  it("keeps initial = available + reserved + sold through decreases, increases, sell-out and reopen", async () => {
    const { batch } = await publish(10, 120);
    const patch = (body: Record<string, number>) => patchBatchStock(db, merchant.id, batch.id, StockPatchBody.parse(body));

    let v = await patch({ delta: -3 }); // 3 sold offline
    expect(v).toMatchObject({ initial_stock: 10, available_stock: 7, sold: 3, status: "ACTIVE" });
    expectInvariant(v);

    v = await patch({ available_stock: 9 }); // undo part of the offline reduction
    expect(v).toMatchObject({ initial_stock: 10, available_stock: 9, sold: 1 });
    expectInvariant(v);

    v = await patch({ available_stock: 14 }); // more than published → initial raised
    expect(v).toMatchObject({ initial_stock: 14, available_stock: 14, sold: 0 });
    expectInvariant(v);

    await expectApiError(patch({ delta: -15 }), "VALIDATION_ERROR");

    v = await patch({ available_stock: 0 });
    expect(v.status).toBe("SOLD_OUT");
    expectInvariant(v);

    v = await patch({ delta: 2 }); // reopen before pickup_end
    expect(v.status).toBe("ACTIVE");
    expect(v.available_stock).toBe(2);
    expectInvariant(v);
  });

  it("never lets an increase eat into portions customers paid for", async () => {
    const { batch } = await publish(4, 120);
    const order = await checkout(db, {
      userId: customerId,
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
      input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 2 }] }),
    });
    await simulatePayment(db, { orderId: order.id, userId: customerId, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    const v = await patchBatchStock(db, merchant.id, batch.id, StockPatchBody.parse({ available_stock: 4 }));
    expect(v.initial_stock).toBe(6); // 2 paid + 4 available
    expect(v.sold).toBe(2);
    expectInvariant(v);
  });

  it("404s for another merchant's batch and refuses closed batches", async () => {
    const other = (await db.select().from(surplusBatches).where(eq(surplusBatches.status, "ACTIVE"))).find(
      (b) => b.merchantId !== merchant.id,
    )!;
    await expectApiError(patchBatchStock(db, merchant.id, other.id, StockPatchBody.parse({ delta: 1 })), "NOT_FOUND");

    const { batch } = await publish(3, 60);
    await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" }));
    await expectApiError(patchBatchStock(db, merchant.id, batch.id, StockPatchBody.parse({ delta: 1 })), "BATCH_CLOSED");
  });

  it("caps the resulting stock, not each step, when a limit is given (demo warung)", async () => {
    const { batch } = await publish(5, 120);
    const limit = { maxAvailable: 30, message: "batas demo" };
    const patch = (body: Record<string, number>) =>
      patchBatchStock(db, merchant.id, batch.id, StockPatchBody.parse(body), new Date(), limit);

    expect((await patch({ delta: 25 })).available_stock).toBe(30);
    await expectApiError(patch({ delta: 1 }), "VALIDATION_ERROR");
    await expectApiError(patch({ available_stock: 31 }), "VALIDATION_ERROR");
    expect((await patch({ delta: -10 })).available_stock).toBe(20);
  });
});

describe("PATCH /merchant/surplus/:id (cancel / auto discount)", () => {
  it("refuses to cancel while portions are reserved; paid orders stay valid after cancelling", async () => {
    const { batch } = await publish(5, 120);
    const order = await checkout(db, {
      userId: customerId,
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
      input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: batch.id, quantity: 1 }] }),
    });
    expect((await batchRow(batch.id)).reservedStock).toBe(1);
    const err = await expectApiError(patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" })), "CONFLICT");
    expect(err.status).toBe(409);

    await simulatePayment(db, { orderId: order.id, userId: customerId, webhookSecret: TEST_PAYMENT_WEBHOOK_SECRET });
    const v = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" }));
    expect(v.status).toBe("CANCELLED");
    expect(v.sold).toBe(1);
    expectInvariant(v);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(["PAID", "READY_FOR_PICKUP"]).toContain(o.status);

    await expectApiError(patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" })), "BATCH_CLOSED");
  });

  it("toggles auto discount (next_escalation disappears when off)", async () => {
    const { batch } = await publish(12, 150);
    const off = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ auto_discount_enabled: false }));
    expect(off.auto_discount_enabled).toBe(false);
    expect(off.next_escalation).toBeNull();
    const on = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ auto_discount_enabled: true }));
    expect(on.auto_discount_enabled).toBe(true);
    // An empty patch is refused by the body schema and, for direct callers, by the service.
    expect(BatchPatchBody.safeParse({}).success).toBe(false);
    await expectApiError(patchBatch(db, merchant.id, batch.id, {}), "VALIDATION_ERROR");
  });
});

/* ------------------------------------------------------------------ */
/* Menu contents, lauk and the portion promise                         */
/* ------------------------------------------------------------------ */

const LAUK = ["Ayam goreng", "Pepes ikan mas", "Tahu tempe bacem"];

async function insertMenu(values: Partial<typeof menus.$inferInsert>) {
  const [row] = await db
    .insert(menus)
    .values({
      merchantId: merchant.id,
      menuName: "Nasi Timbel + Lauk Pilihan (tes)",
      category: "MAKANAN_BERAT",
      originalPriceIdr: 18000,
      minRecoveryPriceIdr: 10000,
      ...values,
    })
    .returning();
  return row;
}

async function publishMenu(m: Menu, extra: Record<string, unknown> = {}, endInMin = 120, now = new Date()) {
  return publishSurplus(
    db,
    merchant.id,
    PublishBody.parse({ menu_id: m.id, initial_stock: 4, pickup_end_time: inMin(now, endInMin), ...extra }),
    now,
  );
}

/** A tiny JPEG header (SOI, SOF0 frame of 640 × 480, SOS, EOI); enough for the server checks. */
function jpeg(): Buffer {
  const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9];
  return Buffer.from([0xff, 0xd8, ...frame, ...sos]);
}

describe("publish: menu contents and lauk", () => {
  let laukMenu: Menu;
  beforeAll(async () => {
    laukMenu = await insertMenu({ contents: ["Nasi timbel", "Sayur asem", "Lalapan", "Sambal terasi"], laukOptions: LAUK });
  });

  it("defaults tonight's lauk to every option and the portion promise to normal", async () => {
    const { batch } = await publishMenu(laukMenu);
    expect(batch.contents).toEqual(["Nasi timbel", "Sayur asem", "Lalapan", "Sambal terasi"]);
    expect(batch.lauk_options).toEqual(LAUK);
    expect(batch.lauk_available).toEqual(LAUK);
    expect(batch.full_portion).toBe(true);
    expect(batch.photo).toBeNull();
    expect(batch.photo_uploads_left).toBe(5);
  });

  it("stores a subset in the menu's casing and order, and full_portion false", async () => {
    const { batch } = await publishMenu(laukMenu, { lauk_available: ["tahu tempe BACEM", "Ayam  goreng"], full_portion: false });
    expect(batch.lauk_available).toEqual(["Ayam goreng", "Tahu tempe bacem"]);
    expect(batch.full_portion).toBe(false);
    const row = await batchRow(batch.id);
    expect(row.laukAvailable).toEqual(["Ayam goreng", "Tahu tempe bacem"]);
    expect(row.fullPortion).toBe(false);
  });

  it("refuses lauk outside the menu, and no lauk at all when the menu has options", async () => {
    const outside = await expectApiError(publishMenu(laukMenu, { lauk_available: ["Rendang"] }), "VALIDATION_ERROR");
    expect(outside.message).toBe("Lauk harus dipilih dari daftar lauk menu");
    await expectApiError(publishMenu(laukMenu, { lauk_available: [] }), "VALIDATION_ERROR");
  });

  it("refuses an old surprise menu but still publishes a menu created before contents existed", async () => {
    const mystery = await insertMenu({ menuName: "Paket lama (tes)", category: "MYSTERY_BAG", isMysteryBag: true });
    const err = await expectApiError(publishMenu(mystery), "VALIDATION_ERROR");
    expect(err.details).toMatchObject({ reason: "MENU_CONTENTS_REQUIRED", menu_id: mystery.id });

    const legacy = await insertMenu({ menuName: "Menu lama tanpa isi (tes)" });
    const { batch } = await publishMenu(legacy);
    expect(batch.status).toBe("ACTIVE");
    expect(batch.contents).toEqual([]);
    expect(batch.lauk_available).toEqual([]);
    // A fixed menu has no lauk to pick from.
    await expectApiError(publishMenu(legacy, { lauk_available: ["Ayam goreng"] }), "VALIDATION_ERROR");
  });

  it("still accepts the old body without lauk_available or full_portion (demo top-up)", async () => {
    const now = new Date();
    const { batch } = await publishSurplus(
      db,
      merchant.id,
      { menu_id: laukMenu.id, initial_stock: 3, pickup_end_time: inMin(now, 90), auto_discount_enabled: true },
      now,
    );
    expect(batch.lauk_available).toEqual(LAUK);
    expect(batch.full_portion).toBe(true);
  });
});

describe("PATCH /merchant/surplus/:id (lauk, portion, photo on cancel)", () => {
  let laukMenu: Menu;
  beforeAll(async () => {
    laukMenu = await insertMenu({ menuName: "Nasi Rames (tes)", contents: ["Nasi putih", "Sayur asem"], laukOptions: LAUK });
  });

  it("updates tonight's lauk and portion, bumps updated_at and streams lauk_available", async () => {
    const t0 = new Date(Date.now() - 5 * MIN);
    const { batch } = await publishMenu(laukMenu, {}, 120, t0);
    const before = await batchRow(batch.id);
    const now = new Date();
    const v = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ lauk_available: ["pepes ikan mas"] }), now);
    expect(v.lauk_available).toEqual(["Pepes ikan mas"]);
    const after = await batchRow(batch.id);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    const events = await pollMerchantEvents(db, merchant.id, new Date(now.getTime() - 1000));
    const ev = events.find((e) => e.event.type === "batch.updated" && e.event.batch_id === batch.id);
    expect(ev?.event).toMatchObject({ type: "batch.updated", lauk_available: ["Pepes ikan mas"] });

    const p = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ full_portion: false }));
    expect(p.full_portion).toBe(false);
    expect(p.lauk_available).toEqual(["Pepes ikan mas"]);

    await expectApiError(
      patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ lauk_available: [] })),
      "VALIDATION_ERROR",
    );
    await expectApiError(
      patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ lauk_available: ["Rendang"] })),
      "VALIDATION_ERROR",
    );
  });

  it("refuses lauk and portion edits once the batch is closed", async () => {
    const { batch } = await publishMenu(laukMenu);
    await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" }));
    await expectApiError(
      patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ lauk_available: ["Ayam goreng"] })),
      "BATCH_CLOSED",
    );
    await expectApiError(patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ full_portion: false })), "BATCH_CLOSED");
  });

  it("deletes the batch photo when the batch is cancelled", async () => {
    const { batch } = await publishMenu(laukMenu);
    const up = await uploadBatchPhoto(db, merchant.id, batch.id, { bytes: jpeg(), contentType: "image/jpeg", demoOnly: false });
    expect(up.photo).not.toBeNull();
    expect((await db.select().from(batchPhotos).where(eq(batchPhotos.surplusBatchId, batch.id))).length).toBe(1);
    const v = await patchBatch(db, merchant.id, batch.id, BatchPatchBody.parse({ status: "CANCELLED" }));
    expect(v.photo).toBeNull();
    expect((await db.select().from(batchPhotos).where(eq(batchPhotos.surplusBatchId, batch.id))).length).toBe(0);
  });

  it("deletes the photo of a scheduled batch that expired before it went live", async () => {
    const t0 = new Date(Date.now() - 60 * MIN);
    const { batch } = await publishMenu(laukMenu, { pickup_start_time: inMin(t0, 30) }, 45, t0);
    expect(batch.status).toBe("SCHEDULED");
    await uploadBatchPhoto(db, merchant.id, batch.id, { bytes: jpeg(), contentType: "image/jpeg", demoOnly: false }, t0);
    await activateScheduledBatches(db, new Date(t0.getTime() + 50 * MIN));
    expect((await batchRow(batch.id)).status).toBe("EXPIRED");
    expect((await db.select().from(batchPhotos).where(eq(batchPhotos.surplusBatchId, batch.id))).length).toBe(0);
  });
});
