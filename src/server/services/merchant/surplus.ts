/**
 * Surplus batches: AI quote, publish, stock edits, cancel / auto-discount toggle,
 * and activation of SCHEDULED batches (job).
 *
 * Stock invariant (see src/server/services/stock.ts):
 *   initial_stock = available_stock + reserved_stock + sold
 * where sold = portions paid online + portions the warung sold/served offline.
 *
 * PATCH stock semantics:
 *  - decreasing available (down to 0) = portions sold offline / no longer available;
 *    initial stays, so "sold" grows.
 *  - increasing available first undoes offline reductions, but never below what
 *    customers actually paid for online; beyond the published amount, initial_stock
 *    is raised so the invariant keeps holding (= extra portions added).
 *  - available = reserved = 0 → SOLD_OUT; SOLD_OUT with available > 0 before
 *    pickup_end → ACTIVE again.
 */
import "server-only";
import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { discountAdjustmentLogs, menus, merchants, orderItems, orders, surplusBatches, type Menu, type Merchant, type SurplusBatch } from "@/db/schema";
import type {
  BatchPatchBody,
  MerchantBatchView,
  PublishBody,
  PublishResponse,
  QuoteAiResponse,
  StockPatchBody,
} from "@/lib/contracts";
import { DEFAULT_SEARCH_RADIUS_M, PRICE_ROUNDING_IDR } from "@/lib/constants";
import { calculateOptimalRecoveryPrice } from "@/lib/pricing/dynamic-discount";
import { DAY_NAMES_ID, formatClockId, formatIdr, MINUTE_MS, minutesBetween, wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { buildEscalationSchedule } from "@/server/services/escalation/schedule";
import { getPrediction, type Prediction } from "@/server/services/prediction";
import { estimateSelloutProbability } from "@/server/services/prediction/sellout";
import { countActiveUsersNear } from "@/server/services/presence";
import { getOwnedMenu } from "./menus";
import { notifyMerchantAudience } from "./notify";
import { loadMerchant } from "./profile";
import { toMerchantBatchView } from "./views";

export type PublishInput = z.output<typeof PublishBody>;
export type StockPatchInput = z.output<typeof StockPatchBody>;
export type BatchPatchInput = z.output<typeof BatchPatchBody>;

export const PUBLISH_MIN_LEAD_MINUTES = 10;
export const PUBLISH_MAX_WINDOW_HOURS = 12;
export const SURPLUS_LIVE_RADIUS_M = DEFAULT_SEARCH_RADIUS_M;
export const REASON_INITIAL_PUBLISH = "INITIAL_PUBLISH";

const PAID_STATES = ["PAID", "READY_FOR_PICKUP", "COMPLETED"] as const;

/* ------------------------------------------------------------------ */
/* Quote                                                               */
/* ------------------------------------------------------------------ */

/** Price for a manual discount: Rp 500 steps (rounded up), clamped to [floor, original]. */
export function priceForDiscount(originalPriceIdr: number, minRecoveryPriceIdr: number, discountPct: number) {
  const rounded =
    Math.ceil((originalPriceIdr * (100 - discountPct)) / (100 * PRICE_ROUNDING_IDR)) * PRICE_ROUNDING_IDR;
  const price = Math.min(originalPriceIdr, Math.max(minRecoveryPriceIdr, rounded));
  return {
    sellingPriceIdr: price,
    discountPct: Math.round((1 - price / originalPriceIdr) * 100),
    floorApplied: price > rounded,
  };
}

interface QuoteArgs {
  merchant: Merchant;
  menu: Menu;
  availableStock: number;
  pickupEndTime: Date;
  /** When the batch goes live (now for an immediate publish). */
  startAt: Date;
  now: Date;
  discountOverridePct?: number;
}

export async function computeQuote(db: Db, a: QuoteArgs): Promise<QuoteAiResponse> {
  const conversionRate = Number(a.merchant.historicalConversionRate);
  const minutesToClose = Math.max(0, minutesBetween(a.startAt, a.pickupEndTime));
  const [activeUsers, prediction] = await Promise.all([
    countActiveUsersNear(db, a.merchant.latitude, a.merchant.longitude, DEFAULT_SEARCH_RADIUS_M, a.now),
    getPrediction(db, a.merchant.id, a.menu.id, wibDate(a.startAt)),
  ]);

  const schedule = buildEscalationSchedule({
    originalPriceIdr: a.menu.originalPriceIdr,
    minRecoveryPriceIdr: a.menu.minRecoveryPriceIdr,
    availableStock: a.availableStock,
    pickupEndTime: a.pickupEndTime,
    now: a.startAt,
    activeUsersInRadius: activeUsers,
    historicalConversionRate: conversionRate,
    current:
      a.discountOverridePct === undefined
        ? undefined
        : (() => {
            const p = priceForDiscount(a.menu.originalPriceIdr, a.menu.minRecoveryPriceIdr, a.discountOverridePct);
            return { discountPct: p.discountPct, sellingPriceIdr: p.sellingPriceIdr };
          })(),
  });

  let recommendedPct: number;
  let recommendedPrice: number;
  let floorApplied: boolean;
  if (a.discountOverridePct !== undefined) {
    const p = priceForDiscount(a.menu.originalPriceIdr, a.menu.minRecoveryPriceIdr, a.discountOverridePct);
    recommendedPct = p.discountPct;
    recommendedPrice = p.sellingPriceIdr;
    floorApplied = p.floorApplied;
  } else {
    const q = calculateOptimalRecoveryPrice({
      originalPriceIdr: a.menu.originalPriceIdr,
      minRecoveryPriceIdr: a.menu.minRecoveryPriceIdr,
      availableStock: a.availableStock,
      minutesToClose,
      activeUsersIn2km: activeUsers,
      historicalConversionRate: conversionRate,
    });
    recommendedPct = q.recommendedDiscountPct;
    recommendedPrice = q.recommendedSellingPriceIdr;
    floorApplied = q.floorApplied;
  }

  const hasPrediction = prediction.source === "stored" || prediction.confidenceScore > 0.3;
  const expected = hasPrediction ? prediction.predictedSurplusPortions : null;
  const selloutProbability = estimateSelloutProbability({
    baseRate: hasPrediction ? prediction.selloutProbabilityAt50pct * 0.5 + conversionRate * 0.5 : conversionRate,
    availableStock: a.availableStock,
    expectedSurplusPortions: expected,
    discountPct: recommendedPct,
    minutesToClose,
    activeUsersInRadius: activeUsers,
  });

  return {
    menu_id: a.menu.id,
    original_price_idr: a.menu.originalPriceIdr,
    min_recovery_price_idr: a.menu.minRecoveryPriceIdr,
    sellout_probability: selloutProbability,
    predicted_surplus_portions: expected === null ? null : Math.round(expected * 10) / 10,
    recommended_discount_pct: recommendedPct,
    recommended_selling_price_idr: recommendedPrice,
    floor_applied: floorApplied,
    minutes_to_close: minutesToClose,
    active_users_in_radius: activeUsers,
    escalation_schedule: schedule,
    model_version: prediction.modelVersion,
    explanation: explain({
      menu: a.menu,
      prediction: hasPrediction ? prediction : null,
      stock: a.availableStock,
      activeUsers,
      pct: recommendedPct,
      price: recommendedPrice,
      floorApplied,
      minutesToClose,
      selloutProbability,
      pickupEndTime: a.pickupEndTime,
      schedule,
    }),
  };
}

function explain(x: {
  menu: Menu;
  prediction: Prediction | null;
  stock: number;
  activeUsers: number;
  pct: number;
  price: number;
  floorApplied: boolean;
  minutesToClose: number;
  selloutProbability: number;
  pickupEndTime: Date;
  schedule: QuoteAiResponse["escalation_schedule"];
}): string[] {
  const out: string[] = [];
  if (x.prediction && x.prediction.predictedSurplusPortions > 0) {
    const day = DAY_NAMES_ID[x.prediction.dayOfWeek];
    const n = Math.max(1, Math.round(x.prediction.predictedSurplusPortions));
    // "Kamis malam", not "Malam Kamis": colloquially "malam Jumat" means Thursday evening.
    out.push(`Setiap ${day} malam, ${x.menu.menuName} biasanya tersisa ~${n} porsi.`);
    if (x.stock >= n * 1.5 && x.stock - n >= 3) {
      out.push(`Stok malam ini (${x.stock} porsi) jauh di atas biasanya, jadi peluang habis lebih kecil.`);
    }
  }
  out.push(
    x.activeUsers > 0
      ? `Ada ${x.activeUsers} mahasiswa aktif dalam radius 2 km.`
      : "Belum ada mahasiswa aktif terdeteksi dalam radius 2 km.",
  );
  out.push(`Diskon ${x.pct}% (${formatIdr(x.price)}) untuk ${x.minutesToClose} menit sebelum tutup.`);
  if (x.floorApplied) out.push(`Harga ditahan di harga minimum ${formatIdr(x.price)} yang Anda tetapkan.`);
  const last = x.schedule[x.schedule.length - 1];
  if (last && last.discount_pct > x.pct) {
    out.push(`Jika auto-diskon aktif, diskon naik bertahap hingga ${last.discount_pct}% pukul ${formatClockId(last.time)}.`);
  }
  out.push(
    `Peluang habis terjual sebelum ${formatClockId(x.pickupEndTime)}: ${Math.round(x.selloutProbability * 100)}%.`,
  );
  return out;
}

function validateWindow(start: Date, end: Date, now: Date) {
  if (end.getTime() <= now.getTime() + PUBLISH_MIN_LEAD_MINUTES * MINUTE_MS) {
    throw new ApiError("VALIDATION_ERROR", `Batas ambil minimal ${PUBLISH_MIN_LEAD_MINUTES} menit dari sekarang`, [
      { path: "pickup_end_time", message: "Terlalu dekat dengan waktu sekarang" },
    ]);
  }
  if (end.getTime() > now.getTime() + PUBLISH_MAX_WINDOW_HOURS * 60 * MINUTE_MS) {
    throw new ApiError("VALIDATION_ERROR", `Batas ambil maksimal ${PUBLISH_MAX_WINDOW_HOURS} jam dari sekarang`, [
      { path: "pickup_end_time", message: "Terlalu jauh dari waktu sekarang" },
    ]);
  }
  if (end.getTime() < start.getTime() + PUBLISH_MIN_LEAD_MINUTES * MINUTE_MS) {
    throw new ApiError("VALIDATION_ERROR", "Jam selesai ambil harus minimal 10 menit setelah jam mulai", [
      { path: "pickup_start_time", message: "Jendela ambil terlalu pendek" },
    ]);
  }
}

export async function quoteSurplus(
  db: Db,
  merchantId: string,
  body: { menu_id: string; available_stock: number; pickup_end_time: string },
  now: Date = new Date(),
): Promise<QuoteAiResponse> {
  const menu = await getOwnedMenu(db, merchantId, body.menu_id);
  if (!menu.isActive) throw new ApiError("VALIDATION_ERROR", "Menu ini sedang nonaktif");
  const end = new Date(body.pickup_end_time);
  if (end.getTime() <= now.getTime()) {
    throw new ApiError("VALIDATION_ERROR", "Batas ambil harus di masa depan", [
      { path: "pickup_end_time", message: "Sudah lewat" },
    ]);
  }
  const merchant = await loadMerchant(db, merchantId);
  return computeQuote(db, { merchant, menu, availableStock: body.available_stock, pickupEndTime: end, startAt: now, now });
}

/* ------------------------------------------------------------------ */
/* Batch views                                                         */
/* ------------------------------------------------------------------ */

/** Views for the given batch rows of one merchant (one presence query). */
export async function batchViews(db: Db, merchant: Merchant, batches: SurplusBatch[], now: Date): Promise<MerchantBatchView[]> {
  if (!batches.length) return [];
  const menuRows = await db
    .select()
    .from(menus)
    .where(inArray(menus.id, [...new Set(batches.map((b) => b.menuId))]));
  const menuById = new Map(menuRows.map((m) => [m.id, m]));
  const needsUsers = batches.some((b) => b.autoDiscountEnabled && b.status === "ACTIVE");
  const activeUsers = needsUsers
    ? await countActiveUsersNear(db, merchant.latitude, merchant.longitude, DEFAULT_SEARCH_RADIUS_M, now)
    : 0;
  const ctx = { now, activeUsersInRadius: activeUsers, historicalConversionRate: Number(merchant.historicalConversionRate) };
  return batches.map((b) => toMerchantBatchView(b, menuById.get(b.menuId)!, ctx));
}

async function batchView(db: Db, merchantId: string, batch: SurplusBatch, now: Date) {
  const merchant = await loadMerchant(db, merchantId);
  const [view] = await batchViews(db, merchant, [batch], now);
  return view;
}

/* ------------------------------------------------------------------ */
/* Publish                                                             */
/* ------------------------------------------------------------------ */

function liveNotification(merchant: Merchant, menu: Menu, b: { pct: number; price: number; end: Date; stock: number }) {
  return {
    title: `${merchant.merchantName} buka porsi surplus!`,
    body: `${menu.menuName} diskon ${b.pct}% jadi ${formatIdr(b.price)} (${b.stock} porsi). Ambil sebelum ${formatClockId(b.end)}.`,
    url: `/warung/${merchant.slug}`,
    tag: `live-${merchant.id}`,
  };
}

async function notifyLive(db: Db, merchant: Merchant, menu: Menu, b: SurplusBatch, now: Date) {
  return notifyMerchantAudience(db, {
    merchantId: merchant.id,
    point: { lat: merchant.latitude, lng: merchant.longitude },
    subscribers: "notify_on_surplus_live",
    nearbyRadiusM: SURPLUS_LIVE_RADIUS_M,
    now,
    payload: liveNotification(merchant, menu, {
      pct: b.currentDiscountPct,
      price: b.currentSellingPriceIdr,
      end: b.pickupEndTime,
      stock: b.availableStock,
    }),
  });
}

export async function publishSurplus(
  db: Db,
  merchantId: string,
  body: PublishInput,
  now: Date = new Date(),
): Promise<PublishResponse> {
  const menu = await getOwnedMenu(db, merchantId, body.menu_id);
  if (!menu.isActive) throw new ApiError("VALIDATION_ERROR", "Menu ini sedang nonaktif");
  const merchant = await loadMerchant(db, merchantId);
  const end = new Date(body.pickup_end_time);
  const requestedStart = body.pickup_start_time ? new Date(body.pickup_start_time) : now;
  const start = requestedStart.getTime() > now.getTime() ? requestedStart : now;
  validateWindow(start, end, now);
  const scheduled = start.getTime() > now.getTime();

  const quote = await computeQuote(db, {
    merchant,
    menu,
    availableStock: body.initial_stock,
    pickupEndTime: end,
    startAt: start,
    now,
    discountOverridePct: body.discount_pct_override,
  });

  const batch = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(surplusBatches)
      .values({
        merchantId,
        menuId: menu.id,
        batchDate: wibDate(start),
        initialStock: body.initial_stock,
        availableStock: body.initial_stock,
        reservedStock: 0,
        originalPriceIdr: menu.originalPriceIdr,
        currentDiscountPct: quote.recommended_discount_pct,
        currentSellingPriceIdr: quote.recommended_selling_price_idr,
        autoDiscountEnabled: body.auto_discount_enabled,
        predictedSelloutProb: quote.sellout_probability,
        pickupStartTime: start,
        pickupEndTime: end,
        status: scheduled ? "SCHEDULED" : "ACTIVE",
        lastPriceUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(discountAdjustmentLogs).values({
      surplusBatchId: b.id,
      previousDiscountPct: b.currentDiscountPct,
      newDiscountPct: b.currentDiscountPct,
      previousPriceIdr: b.currentSellingPriceIdr,
      newPriceIdr: b.currentSellingPriceIdr,
      remainingStock: b.initialStock,
      minutesToClosing: quote.minutes_to_close,
      activeUsersInRadius: quote.active_users_in_radius,
      triggerReason: REASON_INITIAL_PUBLISH,
      createdAt: now,
    });
    return b;
  });

  // Scheduled batches notify when the job activates them.
  const notified = scheduled ? 0 : await notifyLive(db, merchant, menu, batch, now);
  const [view] = await batchViews(db, merchant, [batch], now);
  return { batch: view, notified_devices: notified };
}

/* ------------------------------------------------------------------ */
/* Stock & status edits                                                */
/* ------------------------------------------------------------------ */

async function lockOwnedBatch(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], merchantId: string, batchId: string) {
  const [b] = await tx
    .select()
    .from(surplusBatches)
    .where(and(eq(surplusBatches.id, batchId), eq(surplusBatches.merchantId, merchantId)))
    .for("update");
  if (!b) throw new ApiError("NOT_FOUND", "Batch surplus tidak ditemukan");
  return b;
}

export async function patchBatchStock(
  db: Db,
  merchantId: string,
  batchId: string,
  body: StockPatchInput,
  now: Date = new Date(),
): Promise<MerchantBatchView> {
  const updated = await db.transaction(async (tx) => {
    const b = await lockOwnedBatch(tx, merchantId, batchId);
    if (b.status === "EXPIRED" || b.status === "CANCELLED" || b.pickupEndTime <= now) {
      throw new ApiError("BATCH_CLOSED", "Batch ini sudah ditutup");
    }
    const target = body.available_stock ?? b.availableStock + (body.delta ?? 0);
    if (target < 0) {
      throw new ApiError("VALIDATION_ERROR", `Stok tidak boleh negatif (tersisa ${b.availableStock} porsi)`, [
        { path: body.delta !== undefined ? "delta" : "available_stock", message: "Stok tidak boleh negatif" },
      ]);
    }
    if (target > 500) throw new ApiError("VALIDATION_ERROR", "Stok maksimal 500 porsi");

    const [{ paid }] = await tx
      .select({ paid: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.surplusBatchId, b.id), inArray(orders.status, [...PAID_STATES])));
    // Portions that must stay accounted for: reserved (pending checkouts) + paid online.
    const committed = b.reservedStock + paid;
    const initial = Math.max(b.initialStock, target + committed);

    let status = b.status;
    if (status === "ACTIVE" && target === 0 && b.reservedStock === 0) status = "SOLD_OUT";
    else if (status === "SOLD_OUT" && target > 0) status = "ACTIVE";

    const [row] = await tx
      .update(surplusBatches)
      .set({ availableStock: target, initialStock: initial, status, updatedAt: now })
      .where(eq(surplusBatches.id, b.id))
      .returning();
    return row;
  });
  return batchView(db, merchantId, updated, now);
}

export async function patchBatch(
  db: Db,
  merchantId: string,
  batchId: string,
  body: BatchPatchInput,
  now: Date = new Date(),
): Promise<MerchantBatchView> {
  if (body.status === undefined && body.auto_discount_enabled === undefined) {
    throw new ApiError("VALIDATION_ERROR", "Isi status atau auto_discount_enabled");
  }
  const updated = await db.transaction(async (tx) => {
    const b = await lockOwnedBatch(tx, merchantId, batchId);
    const set: Partial<typeof surplusBatches.$inferInsert> = { updatedAt: now };
    if (body.status === "CANCELLED") {
      if (b.status === "CANCELLED") throw new ApiError("BATCH_CLOSED", "Batch ini sudah dibatalkan");
      if (b.status === "EXPIRED") throw new ApiError("BATCH_CLOSED", "Batch ini sudah ditutup");
      if (b.reservedStock > 0) {
        throw new ApiError(
          "CONFLICT",
          `Masih ada ${b.reservedStock} porsi dalam proses pembayaran. Tunggu sebentar lalu coba lagi.`,
        );
      }
      // Already-paid orders stay valid and can still be picked up.
      set.status = "CANCELLED";
    }
    if (body.auto_discount_enabled !== undefined) {
      if (body.status !== "CANCELLED" && (b.status === "EXPIRED" || b.status === "CANCELLED")) {
        throw new ApiError("BATCH_CLOSED", "Batch ini sudah ditutup");
      }
      set.autoDiscountEnabled = body.auto_discount_enabled;
    }
    const [row] = await tx.update(surplusBatches).set(set).where(eq(surplusBatches.id, b.id)).returning();
    return row;
  });
  return batchView(db, merchantId, updated, now);
}

/* ------------------------------------------------------------------ */
/* Job: SCHEDULED → ACTIVE                                             */
/* ------------------------------------------------------------------ */

export interface ActivationSummary {
  activated: number;
  expired: number;
  notifiedDevices: number;
}

export async function activateScheduledBatches(db: Db, now: Date = new Date()): Promise<ActivationSummary> {
  const expired = await db
    .update(surplusBatches)
    .set({ status: "EXPIRED", updatedAt: now })
    .where(and(eq(surplusBatches.status, "SCHEDULED"), lte(surplusBatches.pickupEndTime, now)))
    .returning({ id: surplusBatches.id });
  const activated = await db
    .update(surplusBatches)
    .set({
      status: sql`CASE WHEN ${surplusBatches.availableStock} = 0 AND ${surplusBatches.reservedStock} = 0
                       THEN 'SOLD_OUT'::batch_status ELSE 'ACTIVE'::batch_status END`,
      updatedAt: now,
    })
    .where(
      and(
        eq(surplusBatches.status, "SCHEDULED"),
        lte(surplusBatches.pickupStartTime, now),
        gt(surplusBatches.pickupEndTime, now),
      ),
    )
    .returning();
  let notified = 0;
  for (const b of activated) {
    if (b.status !== "ACTIVE") continue;
    const [row] = await db
      .select({ merchant: merchants, menu: menus })
      .from(merchants)
      .innerJoin(menus, eq(menus.id, b.menuId))
      .where(eq(merchants.id, b.merchantId))
      .limit(1);
    if (row) notified += await notifyLive(db, row.merchant, row.menu, b, now);
  }
  return { activated: activated.length, expired: expired.length, notifiedDevices: notified };
}
