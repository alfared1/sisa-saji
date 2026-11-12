/**
 * Realistic campus seeder — blueprint Phase 1.3.
 *
 *   npm run db:seed            (CLI: scripts/db-seed.ts)
 *   seedDatabase(db, { … })    (tests)
 *
 * Wipes all app tables, then creates:
 *  - 1 admin, one owner per warung, 120 customers (mahasiswa) incl. demo accounts,
 *    spread over the 21 campus hubs with ~45% in the three Bogor hubs
 *  - 95 fictional warung around those hubs (Bogor first) with 1–3 menus each
 *  - 28 days of history: closed surplus batches, completed/expired orders
 *    (bought by customers of the same hub), reviews and discount logs
 *    (training data for the Surplus Prediction Engine)
 *  - "Tonight": ACTIVE batches at every warung whose pickup window is relative to
 *    the time the seed runs (closing in 18–150 min), so the demo is always live
 *    and every discount tier (50% → 70%) is visible
 *  - presence pings (the "active users nearby" demand signal), mostly in Bogor
 *  - 7 days of heuristic predictions (model_version "heuristic-v0")
 *  - derived aggregates (impact totals, wallet balance, ratings, conversion rate)
 *
 * Random values come from a seeded PRNG, so the data shape is reproducible;
 * timestamps are relative to "now".
 */
import { randomUUID } from "node:crypto";
import { getTableColumns, getTableName, sql, type Column } from "drizzle-orm";
import { toSnakeCase } from "drizzle-orm/casing";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db, DbOrTx } from "../client";
import * as s from "../schema";
import { calculateOptimalRecoveryPrice } from "@/lib/pricing/dynamic-discount";
import { computeOrderTotals } from "@/lib/pricing/order-totals";
import { createPickupToken } from "@/lib/pickup-token";
import { campusById } from "@/lib/campuses";
import { BADGE_TIERS, CAMPUSES, HOME_REGION, PAYMENT_TTL_SECONDS, type CampusId } from "@/lib/constants";
import {
  FIRST_NAMES,
  LAST_NAMES,
  REVIEW_COMMENTS,
  REVIEW_TAGS,
  SEED_MERCHANTS,
  type SeedMerchant,
  type SeedMenu,
} from "./data";

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DEFAULT_SEED = 20271107;
let rand = mulberry32(DEFAULT_SEED);
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
const chance = (p: number) => rand() < p;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const roundTo = (x: number, step: number) => Math.round(x / step) * step;

/* ------------------------------------------------------------------ */
/* Time helpers (WIB = UTC+7, no DST)                                  */
/* ------------------------------------------------------------------ */

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const WIB_OFFSET = 7 * 60 * MIN;

const wibDate = (d: Date) => new Date(d.getTime() + WIB_OFFSET).toISOString().slice(0, 10);
const atWib = (date: string, hhmm: string) => new Date(`${date}T${hhmm.slice(0, 5)}:00+07:00`);
const dowOf = (date: string) => new Date(`${date}T12:00:00+07:00`).getUTCDay();
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * MIN);
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / MIN);

/** Surplus pickup window for a merchant on a date: 20:00 (or close−60m) → close (max 23:30). */
function pickupWindow(m: SeedMerchant, date: string) {
  const close = m.close > "23:30" ? "23:30" : m.close;
  const end = atWib(date, close);
  const start = new Date(Math.min(atWib(date, "20:00").getTime(), end.getTime() - 60 * MIN));
  return { start, end };
}

/** Evening surplus model shared by history and tonight. */
function surplusFactors(date: string) {
  const dow = dowOf(date);
  const dayOfMonth = Number(date.slice(8, 10));
  const raining = chance(0.25);
  let surplus = 1;
  let sell = 0;
  if (dow === 4) surplus *= 1.35; // malam Jumat
  if (dow === 6 || dow === 0) surplus *= 1.2; // akhir pekan, mahasiswa pulang
  if (dayOfMonth >= 25) {
    surplus *= 0.85; // akhir bulan: permintaan mahasiswa naik
    sell += 0.08;
  }
  if (raining) {
    surplus *= 1.3;
    sell -= 0.12;
  }
  return { surplus, sell, raining };
}

/* ------------------------------------------------------------------ */
/* Row builders                                                        */
/* ------------------------------------------------------------------ */

type UserRow = typeof s.users.$inferInsert;
type MerchantRow = typeof s.merchants.$inferInsert;
type MenuRow = typeof s.menus.$inferInsert & { id: string };
type BatchRow = typeof s.surplusBatches.$inferInsert & { id: string };
type OrderRow = typeof s.orders.$inferInsert & { id: string };
type ItemRow = typeof s.orderItems.$inferInsert;
type LogRow = typeof s.discountAdjustmentLogs.$inferInsert;
type ReviewRow = typeof s.reviews.$inferInsert;
type PredictionRow = typeof s.merchantSurplusPredictions.$inferInsert;

const rows = {
  users: [] as UserRow[],
  merchants: [] as (MerchantRow & { id: string })[],
  menus: [] as MenuRow[],
  batches: [] as BatchRow[],
  orders: [] as OrderRow[],
  items: [] as ItemRow[],
  logs: [] as LogRow[],
  reviews: [] as ReviewRow[],
  subscriptions: [] as (typeof s.customerMerchantSubscriptions.$inferInsert)[],
  predictions: [] as PredictionRow[],
  presence: [] as (typeof s.customerPresence.$inferInsert)[],
};

function resetState(seed: number) {
  rand = mulberry32(seed);
  for (const list of Object.values(rows)) list.length = 0;
  orderSeqByDay.clear();
}

const orderSeqByDay = new Map<string, number>();
function nextOrderNumber(date: string) {
  const n = (orderSeqByDay.get(date) ?? 0) + 1;
  orderSeqByDay.set(date, n);
  return `SS-${date.replaceAll("-", "")}-${String(n).padStart(4, "0")}`;
}

function floorPrice(priceIdr: number) {
  // HPP floor ≈ 30% of normal price, rounded up to Rp 500.
  return Math.ceil((priceIdr * 0.3) / 500) * 500;
}

function quote(
  menu: MenuRow,
  stock: number,
  minutesToClose: number,
  conversionRate: number,
  activeUsers = intBetween(8, 60),
) {
  return calculateOptimalRecoveryPrice({
    originalPriceIdr: menu.originalPriceIdr,
    minRecoveryPriceIdr: menu.minRecoveryPriceIdr,
    availableStock: Math.max(1, stock),
    minutesToClose,
    activeUsersIn2km: activeUsers,
    historicalConversionRate: conversionRate,
  });
}

/** Local demand (active users in 2 km) that drifts a little around a per-batch level. */
function demandAround(level: number) {
  return () => clamp(level + intBetween(-4, 4), 1, 200);
}

type Quote = ReturnType<typeof calculateOptimalRecoveryPrice>;

/**
 * Keeps discount_adjustment_logs consistent with the batch: every price change is
 * logged with the exact inputs that produced it, and the batch's current price
 * always equals the newest log row.
 */
class PriceLog {
  constructor(
    private batch: BatchRow,
    opening: Quote,
    stock: number,
    minutesToClose: number,
    users: number,
    at: Date,
  ) {
    this.push("INITIAL_PUBLISH", opening, opening, stock, minutesToClose, users, at);
  }

  update(next: Quote, stock: number, minutesToClose: number, users: number, at: Date) {
    const prevPct = this.batch.currentDiscountPct;
    if (next.recommendedDiscountPct === prevPct) return;
    const prev = { recommendedDiscountPct: prevPct, recommendedSellingPriceIdr: this.batch.currentSellingPriceIdr } as Quote;
    // Discount up toward closing = time-decay rule; down = less stock left / stronger demand.
    const reason =
      next.recommendedDiscountPct > prevPct
        ? minutesToClose <= 30
          ? "TIME_DECAY_30M_RULE"
          : "TIME_DECAY_RULE"
        : "STOCK_DEMAND_ADJUST";
    this.push(reason, prev, next, stock, minutesToClose, users, at);
  }

  private push(
    reason: string,
    prev: Quote,
    next: Quote,
    stock: number,
    minutesToClose: number,
    users: number,
    at: Date,
  ) {
    rows.logs.push({
      surplusBatchId: this.batch.id,
      previousDiscountPct: prev.recommendedDiscountPct,
      newDiscountPct: next.recommendedDiscountPct,
      previousPriceIdr: prev.recommendedSellingPriceIdr,
      newPriceIdr: next.recommendedSellingPriceIdr,
      remainingStock: stock,
      minutesToClosing: minutesToClose,
      activeUsersInRadius: users,
      triggerReason: reason,
      createdAt: at,
    });
    this.batch.currentDiscountPct = next.recommendedDiscountPct;
    this.batch.currentSellingPriceIdr = next.recommendedSellingPriceIdr;
    this.batch.lastPriceUpdatedAt = at;
  }
}

/** Splits sold portions into order quantities (mostly 1, sometimes 2–3). */
function splitIntoOrders(sold: number): number[] {
  const qty: number[] = [];
  let left = sold;
  while (left > 0) {
    const q = Math.min(left, chance(0.65) ? 1 : chance(0.7) ? 2 : 3);
    qty.push(q);
    left -= q;
  }
  return qty;
}

interface OrderSpec {
  merchant: MerchantRow & { id: string };
  menu: MenuRow;
  batch: BatchRow;
  customerId: string;
  quantity: number;
  createdAt: Date;
  unitPrice: number;
  discountPct: number;
  status: (typeof s.orderStatus.enumValues)[number];
  pickupCode: string;
  date: string;
}

/** `now` caps every timestamp: nothing may be picked up or reviewed in the future. */
function buildOrder(spec: OrderSpec, secret: string, now: Date) {
  const id = randomUUID();
  const totals = computeOrderTotals([
    {
      quantity: spec.quantity,
      unitOriginalPriceIdr: spec.menu.originalPriceIdr,
      unitSellingPriceIdr: spec.unitPrice,
      portionWeightGrams: spec.menu.portionWeightGrams ?? 200,
    },
  ]);
  let status = spec.status;
  const paid = status === "COMPLETED" || status === "READY_FOR_PICKUP" || status === "PAID";
  const paidAt = paid ? addMin(spec.createdAt, between(0.5, 3)) : null;
  const deadline = spec.batch.pickupEndTime as Date;
  let pickedUpAt: Date | null = null;
  if (status === "COMPLETED" && paidAt) {
    pickedUpAt = new Date(
      Math.min(
        addMin(paidAt, between(8, 40)).getTime(),
        deadline.getTime() - MIN,
        now.getTime() - MIN,
      ),
    );
    // Not enough time has passed for a pickup yet → the ticket is still waiting.
    if (pickedUpAt.getTime() <= paidAt.getTime()) {
      status = "READY_FOR_PICKUP";
      pickedUpAt = null;
    }
  }

  rows.orders.push({
    id,
    orderNumber: nextOrderNumber(spec.date),
    customerId: spec.customerId,
    merchantId: spec.merchant.id,
    status: status,
    pickupCode: spec.pickupCode,
    pickupQrToken: createPickupToken(id, spec.pickupCode, secret),
    scheduledPickupTime: paidAt ? addMin(paidAt, 15) : null,
    pickupDeadlineAt: deadline,
    usesOwnLunchbox: chance(0.18),
    subtotalOriginalIdr: totals.subtotalOriginalIdr,
    subtotalRecoveryIdr: totals.subtotalRecoveryIdr,
    voucherDiscountIdr: totals.voucherDiscountIdr,
    platformCommissionIdr: totals.platformCommissionIdr,
    totalCustomerPaidIdr: totals.totalCustomerPaidIdr,
    netMerchantPayoutIdr: totals.netMerchantPayoutIdr,
    paymentMethod: pick(["QRIS", "QRIS", "QRIS", "GOPAY", "DANA", "OVO"] as const),
    paymentGatewayRef: paid ? `SIM-${id.slice(0, 8).toUpperCase()}` : null,
    paymentExpiresAt: addMin(spec.createdAt, PAYMENT_TTL_SECONDS / 60),
    paidAt,
    pickedUpAt,
    cancelReason: status === "EXPIRED" ? "Pembayaran tidak diselesaikan dalam 10 menit" : null,
    // Impact is only credited once food is actually picked up.
    totalFoodSavedGrams: status === "COMPLETED" ? totals.totalFoodSavedGrams : 0,
    totalCo2AvoidedGrams: status === "COMPLETED" ? totals.totalCo2AvoidedGrams : 0,
    createdAt: spec.createdAt,
    updatedAt: pickedUpAt ?? paidAt ?? spec.createdAt,
  });
  rows.items.push({
    orderId: id,
    surplusBatchId: spec.batch.id,
    menuId: spec.menu.id,
    menuNameSnapshot: spec.menu.menuName,
    quantity: spec.quantity,
    unitOriginalPriceIdr: spec.menu.originalPriceIdr,
    unitSellingPriceIdr: spec.unitPrice,
    discountPctApplied: spec.discountPct,
    portionWeightGrams: spec.menu.portionWeightGrams ?? 200,
  });

  if (status === "COMPLETED" && pickedUpAt && pickedUpAt.getTime() <= now.getTime() - 5 * MIN && chance(0.35)) {
    const r = rand();
    const rating = r < 0.55 ? 5 : r < 0.85 ? 4 : r < 0.95 ? 3 : r < 0.99 ? 2 : 1;
    rows.reviews.push({
      orderId: id,
      customerId: spec.customerId,
      merchantId: spec.merchant.id,
      rating,
      tags: rating >= 4 ? [pick(REVIEW_TAGS), pick(REVIEW_TAGS)].filter((t, i, a) => a.indexOf(t) === i) : [],
      comment: rating >= 4 ? pick(REVIEW_COMMENTS) : "Agak dingin waktu diambil.",
      createdAt: new Date(Math.min(addMin(pickedUpAt, between(5, 120)).getTime(), now.getTime())),
    });
  }
}

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

/** Customers in the dataset; ~45% live around the Bogor hubs (the home region). */
export const SEED_CUSTOMER_COUNT = 120;
const HOME_CUSTOMER_SHARE = 0.45;
/** Presence pings (devices browsing right now); half of them in Bogor. */
const SEED_PRESENCE_COUNT = 80;
const HOME_PRESENCE_SHARE = 0.5;
/** The demo customer's second favourite: the bakery next to the demo warung. */
const DEMO_SUBSCRIPTION_SLUG = "toko-roti-wangi-gandum-babakan-raya";

/**
 * Splits `total` over hubs proportionally to `weight` (largest remainder), with
 * at least `min` per hub. Deterministic.
 */
function allocate(total: number, hubs: { id: CampusId; weight: number }[], min: number): Map<CampusId, number> {
  const out = new Map<CampusId, number>(hubs.map((h) => [h.id, min]));
  const left = Math.max(0, total - min * hubs.length);
  const weightSum = hubs.reduce((s, h) => s + h.weight, 0) || 1;
  const shares = hubs.map((h) => ({ id: h.id, exact: (left * h.weight) / weightSum }));
  let given = 0;
  for (const sh of shares) {
    const n = Math.floor(sh.exact);
    out.set(sh.id, out.get(sh.id)! + n);
    given += n;
  }
  const frac = (x: number) => x - Math.floor(x);
  [...shares]
    .sort((a, b) => frac(b.exact) - frac(a.exact))
    .slice(0, left - given)
    .forEach((sh) => out.set(sh.id, out.get(sh.id)! + 1));
  return out;
}

/** People per hub (in CAMPUSES order): `homeShare` of them in the home region, weighted by warung count. */
function hubQuotas(total: number, homeShare: number, minPerHub: number): [CampusId, number][] {
  const weight = (id: CampusId) => SEED_MERCHANTS.filter((m) => m.hub === id).length;
  const hubs = (home: boolean) =>
    CAMPUSES.filter((c) => (c.region === HOME_REGION) === home).map((c) => ({ id: c.id as CampusId, weight: weight(c.id) }));
  const homeTotal = Math.round(total * homeShare);
  const quotas = new Map([...allocate(homeTotal, hubs(true), minPerHub), ...allocate(total - homeTotal, hubs(false), minPerHub)]);
  return CAMPUSES.map((c) => [c.id, quotas.get(c.id) ?? 0]);
}

/** A point jittered around a hub so people are not stacked on one spot (±0.006° ≈ ±650 m). */
const near = (c: { lat: number; lng: number }, spread = 0.006) => ({
  lat: c.lat + between(-spread, spread),
  lng: c.lng + between(-spread, spread),
});

function buildAll(now: Date, secret: string) {
  const today = wibDate(now);

  // --- Users ---------------------------------------------------------
  rows.users.push({
    id: randomUUID(),
    role: "ADMIN",
    fullName: "Admin Sisa-Saji",
    email: "admin@sisasaji.test",
    phoneNumber: "+6281100000001",
  });

  // Customer 0 is the demo account; CAMPUSES[0] (IPB Dramaga) comes first, so it lives there.
  const customerHubs: CampusId[] = hubQuotas(SEED_CUSTOMER_COUNT, HOME_CUSTOMER_SHARE, 3).flatMap(([hub, n]) =>
    Array.from({ length: n }, () => hub),
  );
  const customers: string[] = [];
  const customersByHub = new Map<CampusId, string[]>();
  customerHubs.forEach((hub, i) => {
    const first = i === 0 ? "Raka" : FIRST_NAMES[i % FIRST_NAMES.length];
    const last = i === 0 ? "Pratama" : LAST_NAMES[(i * 7) % LAST_NAMES.length];
    const campus = campusById(hub);
    const id = randomUUID();
    customers.push(id);
    customersByHub.set(hub, [...(customersByHub.get(hub) ?? []), id]);
    const home = near(campus);
    rows.users.push({
      id,
      role: "CUSTOMER",
      fullName: `${first} ${last}`,
      email:
        i === 0
          ? "demo.pembeli@sisasaji.test"
          : chance(0.5)
            ? `${first.toLowerCase()}.${last.toLowerCase()}${i}@mail.test`
            : null,
      phoneNumber: `+628120000${String(i + 1).padStart(4, "0")}`,
      campusOrArea: campus.name,
      defaultLat: home.lat,
      defaultLng: home.lng,
    });
  });
  const demoCustomer = customers[0];
  /** A customer living near the hub (anyone when the hub has nobody else). */
  const hubCustomer = (hub: CampusId, exclude?: string) => {
    const local = (customersByHub.get(hub) ?? []).filter((c) => c !== exclude);
    return pick(local.length ? local : customers.filter((c) => c !== exclude));
  };

  // --- Merchants & menus ----------------------------------------------
  const menusByMerchant = new Map<string, MenuRow[]>();
  SEED_MERCHANTS.forEach((m, idx) => {
    const ownerId = randomUUID();
    rows.users.push({
      id: ownerId,
      role: "MERCHANT",
      fullName: m.owner,
      email: idx === 0 ? "demo.mitra@sisasaji.test" : null,
      phoneNumber: `+628130000${String(idx + 1).padStart(4, "0")}`,
      campusOrArea: m.city,
    });
    const merchantId = randomUUID();
    rows.merchants.push({
      id: merchantId,
      ownerUserId: ownerId,
      merchantName: m.name,
      slug: m.slug,
      merchantCategory: m.category,
      description: m.description,
      address: m.address,
      whatsappNumber: `+628130000${String(idx + 1).padStart(4, "0")}`,
      latitude: m.lat,
      longitude: m.lng,
      operationalOpenTime: `${m.open}:00`,
      operationalCloseTime: m.close === "23:59" ? "23:59:00" : `${m.close}:00`,
      defaultSurplusStartTime: "20:00:00",
      isOpen: true,
      merchantVerified: m.premium,
      subscriptionTier: m.premium ? "PREMIUM" : "REGULAR",
      subscriptionExpiresAt: m.premium ? new Date(now.getTime() + 20 * DAY) : null,
      staticQrisPayload: null,
      bankCode: pick(["BCA", "BRI", "BNI", "MANDIRI", "BSI"]),
      bankAccountNumber: String(intBetween(1_000_000_000, 9_999_999_999)),
      bankAccountHolder: m.owner,
      historicalConversionRate: m.sellRate,
    });
    const own: MenuRow[] = m.menus.map((menu) => ({
      id: randomUUID(),
      merchantId,
      menuName: menu.name,
      category: menu.category,
      description: menu.description,
      originalPriceIdr: menu.priceIdr,
      minRecoveryPriceIdr: floorPrice(menu.priceIdr),
      portionWeightGrams: menu.portionWeightGrams ?? 200,
      isMysteryBag: menu.isMysteryBag ?? false,
      isActive: true,
    }));
    rows.menus.push(...own);
    menusByMerchant.set(merchantId, own);
  });

  const menusOf = (merchantId: string) => menusByMerchant.get(merchantId) ?? [];
  const seedMenuOf = (m: SeedMerchant, menu: MenuRow): SeedMenu =>
    m.menus.find((x) => x.name === menu.menuName)!;

  // --- 28 days of history ------------------------------------------------
  for (let k = 28; k >= 1; k--) {
    const date = wibDate(new Date(now.getTime() - k * DAY));
    const f = surplusFactors(date);
    SEED_MERCHANTS.forEach((m, idx) => {
      const merchant = rows.merchants[idx];
      const { start, end } = pickupWindow(m, date);
      for (const menu of menusOf(merchant.id)) {
        const sm = seedMenuOf(m, menu);
        if (!chance(sm.isMysteryBag ? 0.7 : 0.85)) continue;
        const initial = Math.max(1, Math.round(sm.baseSurplus * f.surplus * between(0.7, 1.3)));
        const sellRate = clamp(m.sellRate + f.sell + between(-0.1, 0.1), 0.2, 1);
        const sold = Math.min(initial, Math.round(initial * sellRate));
        const conv = m.sellRate;

        const batchId = randomUUID();
        const windowMin = minutesBetween(start, end);
        const demand = demandAround(intBetween(8, 60));
        const openUsers = demand();
        const opening = quote(menu, initial, windowMin, conv, openUsers);
        const batch: BatchRow = {
          id: batchId,
          merchantId: merchant.id,
          menuId: menu.id,
          batchDate: date,
          initialStock: initial,
          availableStock: initial - sold,
          reservedStock: 0,
          originalPriceIdr: menu.originalPriceIdr,
          // Final price fields are filled after the order loop (see below).
          currentDiscountPct: opening.recommendedDiscountPct,
          currentSellingPriceIdr: opening.recommendedSellingPriceIdr,
          autoDiscountEnabled: true,
          predictedSelloutProb: roundTo(clamp(conv + between(-0.1, 0.1), 0.05, 0.99), 0.0001),
          pickupStartTime: start,
          pickupEndTime: end,
          status: sold === initial ? "SOLD_OUT" : "EXPIRED",
          lastPriceUpdatedAt: addMin(start, -5),
          createdAt: addMin(start, -5),
          updatedAt: end,
        };
        rows.batches.push(batch);
        const priceLog = new PriceLog(batch, opening, initial, windowMin, openUsers, addMin(start, -5));

        // Orders: spread through the window, priced by the optimizer at that moment,
        // bought by students living near the same campus hub.
        const quantities = splitIntoOrders(sold);
        const times = quantities
          .map(() => addMin(start, between(0, Math.max(1, windowMin - 10))))
          .sort((a, b) => a.getTime() - b.getTime());
        let remaining = initial;
        quantities.forEach((q, i) => {
          const t = times[i];
          const users = demand();
          const qt = quote(menu, remaining, minutesBetween(t, end), conv, users);
          priceLog.update(qt, remaining, minutesBetween(t, end), users, addMin(t, -1));
          buildOrder(
            {
              merchant,
              menu,
              batch,
              customerId: hubCustomer(m.hub),
              quantity: q,
              createdAt: t,
              unitPrice: qt.recommendedSellingPriceIdr,
              discountPct: qt.recommendedDiscountPct,
              status: "COMPLETED",
              pickupCode: String(intBetween(0, 9999)).padStart(4, "0"),
              date,
            },
            secret,
            now,
          );
          remaining -= q;
        });

        // Last escalation run before closing (≥ end−30m, after the last order).
        if (remaining > 0) {
          const lastOrderAt = times.length ? times[times.length - 1].getTime() + MIN : 0;
          const at = new Date(Math.min(Math.max(addMin(end, -30).getTime(), lastOrderAt), end.getTime() - MIN));
          const users = demand();
          const closing = quote(menu, remaining, minutesBetween(at, end), conv, users);
          priceLog.update(closing, remaining, minutesBetween(at, end), users, at);
        }
        const lastDiscount = batch.currentDiscountPct;
        const lastPrice = batch.currentSellingPriceIdr;

        // A few abandoned checkouts (payment timeout) that never consumed stock.
        if (chance(0.06)) {
          const t = addMin(start, between(0, Math.max(1, windowMin - 15)));
          buildOrder(
            {
              merchant,
              menu,
              batch,
              customerId: hubCustomer(m.hub),
              quantity: 1,
              createdAt: t,
              unitPrice: lastPrice,
              discountPct: lastDiscount,
              status: "EXPIRED",
              pickupCode: String(intBetween(0, 9999)).padStart(4, "0"),
              date,
            },
            secret,
            now,
          );
        }
      }
    });
  }

  // --- Tonight: live batches relative to now ---------------------------
  // Every warung is live. Closing times cycle through 18–150 minutes, so every
  // hub with a few warung shows the whole ladder (Hemat 50% → Diskon Kilat 70%).
  const closeInMinutes = [150, 120, 95, 75, 55, 40, 28, 18, 140, 110, 85, 65, 45, 130, 100];
  const fToday = surplusFactors(today);
  SEED_MERCHANTS.forEach((m, idx) => {
    const merchant = rows.merchants[idx];
    const end = addMin(now, closeInMinutes[idx % closeInMinutes.length]);
    const start = addMin(now, -30);
    const usedCodes = new Set<string>();
    const freshCode = () => {
      let c: string;
      do c = String(intBetween(0, 9999)).padStart(4, "0");
      while (usedCodes.has(c));
      usedCodes.add(c);
      return c;
    };

    menusOf(merchant.id).forEach((menu, menuIdx) => {
      const sm = seedMenuOf(m, menu);
      if (menuIdx > 0 && !chance(0.8)) return; // first menu always live
      const initial = Math.max(2, Math.round(sm.baseSurplus * fToday.surplus * between(0.9, 1.4)));
      const isDemoBatch = idx === 0 && menuIdx === 0;
      const sold = Math.min(initial - 1, Math.floor(initial * between(0, 0.5)) + (isDemoBatch ? 2 : 0));
      const available = initial - sold;
      const minutesToClose = minutesBetween(now, end);
      const demand = demandAround(intBetween(5, 60));
      const openUsers = demand();
      const activeUsers = demand();
      const q = quote(menu, available, minutesToClose, m.sellRate, activeUsers);
      const batchId = randomUUID();
      const batch: BatchRow = {
        id: batchId,
        merchantId: merchant.id,
        menuId: menu.id,
        batchDate: today,
        initialStock: initial,
        availableStock: available,
        reservedStock: 0,
        originalPriceIdr: menu.originalPriceIdr,
        currentDiscountPct: q.recommendedDiscountPct,
        currentSellingPriceIdr: q.recommendedSellingPriceIdr,
        autoDiscountEnabled: true,
        predictedSelloutProb: roundTo(clamp(m.sellRate + between(-0.08, 0.08), 0.05, 0.99), 0.0001),
        pickupStartTime: start,
        pickupEndTime: end,
        status: "ACTIVE",
        lastPriceUpdatedAt: start,
        createdAt: start,
        updatedAt: now,
      };
      rows.batches.push(batch);
      const opening = quote(menu, initial, minutesBetween(start, end), m.sellRate, openUsers);
      // Log the publish, then the latest worker run (sets the batch's current price).
      const priceLog = new PriceLog(batch, opening, initial, minutesBetween(start, end), openUsers, start);
      priceLog.update(q, available, minutesToClose, activeUsers, addMin(now, -intBetween(1, 4)));

      // Orders already placed tonight. The demo customer always has one ticket
      // waiting for pickup at the demo merchant (SEED_MERCHANTS[0]).
      const quantities = splitIntoOrders(sold);
      quantities.forEach((qty, i) => {
        const demoTicket = isDemoBatch && i === 0;
        const status = demoTicket ? "READY_FOR_PICKUP" : chance(0.6) ? "COMPLETED" : "READY_FOR_PICKUP";
        buildOrder(
          {
            merchant,
            menu,
            batch,
            customerId: demoTicket ? demoCustomer : hubCustomer(m.hub, demoCustomer),
            quantity: qty,
            createdAt: addMin(start, between(1, 25)),
            unitPrice: opening.recommendedSellingPriceIdr,
            discountPct: opening.recommendedDiscountPct,
            status,
            pickupCode: freshCode(),
            date: today,
          },
          secret,
          now,
        );
      });
    });
  });

  // --- Subscriptions (favorites + AI prediction alerts) ----------------
  const subs = new Set<string>();
  const addSub = (userId: string, merchantId: string) => {
    const key = `${userId}:${merchantId}`;
    if (subs.has(key)) return;
    subs.add(key);
    rows.subscriptions.push({
      userId,
      merchantId,
      notifyOnSurplusLive: true,
      notifyOnAiPrediction: chance(0.8),
    });
  };
  const merchantIdsByHub = new Map<CampusId, string[]>();
  SEED_MERCHANTS.forEach((m, idx) =>
    merchantIdsByHub.set(m.hub, [...(merchantIdsByHub.get(m.hub) ?? []), rows.merchants[idx].id]),
  );
  addSub(demoCustomer, rows.merchants[0].id);
  addSub(demoCustomer, rows.merchants[SEED_MERCHANTS.findIndex((m) => m.slug === DEMO_SUBSCRIPTION_SLUG)].id);
  customerHubs.forEach((hub, i) => {
    if (i === 0) return;
    const local = merchantIdsByHub.get(hub) ?? [];
    for (let n = intBetween(0, 3); n > 0; n--) {
      addSub(customers[i], local.length && chance(0.85) ? pick(local) : pick(rows.merchants).id);
    }
  });

  // --- Presence: students currently browsing near campus (demand signal) --
  let device = 0;
  for (const [hub, n] of hubQuotas(SEED_PRESENCE_COUNT, HOME_PRESENCE_SHARE, 2)) {
    const campus = campusById(hub);
    const locals = customersByHub.get(hub) ?? [];
    for (let i = 0; i < n; i++) {
      const point = near(campus, 0.008);
      rows.presence.push({
        clientId: `seed-device-${String(device++).padStart(3, "0")}`,
        userId: i < locals.length ? locals[i] : null,
        latitude: point.lat,
        longitude: point.lng,
        lastSeenAt: addMin(now, -intBetween(0, 25)),
      });
    }
  }

  // --- Predictions: next 7 days, from same-weekday history --------------
  const historyByMenuDow = new Map<string, BatchRow[]>();
  for (const b of rows.batches) {
    if (b.status === "ACTIVE") continue;
    const key = `${b.menuId}:${dowOf(b.batchDate as string)}`;
    const list = historyByMenuDow.get(key);
    if (list) list.push(b);
    else historyByMenuDow.set(key, [b]);
  }
  for (let k = 0; k < 7; k++) {
    const date = wibDate(new Date(now.getTime() + k * DAY));
    const dow = dowOf(date);
    SEED_MERCHANTS.forEach((m, idx) => {
      const merchant = rows.merchants[idx];
      let sumPortions = 0;
      let sumProb = 0;
      let sumConf = 0;
      const menus = menusOf(merchant.id);
      for (const menu of menus) {
        const hist = historyByMenuDow.get(`${menu.id}:${dow}`) ?? [];
        const n = hist.length;
        const avg = n ? hist.reduce((acc, b) => acc + b.initialStock, 0) / n : seedMenuOf(m, menu).baseSurplus;
        const soldOut = hist.filter((b) => b.status === "SOLD_OUT").length;
        const prob = (soldOut + 1) / (n + 2); // Laplace-smoothed
        const conf = clamp(0.45 + 0.12 * n, 0.3, 0.95);
        sumPortions += avg;
        sumProb += prob;
        sumConf += conf;
        rows.predictions.push({
          merchantId: merchant.id,
          menuId: menu.id,
          targetDate: date,
          dayOfWeek: dow,
          predictedSurplusPortions: roundTo(avg, 0.01),
          predictedPeakSurplusHour: "20:00:00",
          selloutProbabilityAt50pct: roundTo(prob, 0.0001),
          confidenceScore: roundTo(conf, 0.0001),
          modelVersion: "heuristic-v0",
        });
      }
      rows.predictions.push({
        merchantId: merchant.id,
        menuId: null,
        targetDate: date,
        dayOfWeek: dow,
        predictedSurplusPortions: roundTo(sumPortions, 0.01),
        predictedPeakSurplusHour: "20:00:00",
        selloutProbabilityAt50pct: roundTo(sumProb / menus.length, 0.0001),
        confidenceScore: roundTo(sumConf / menus.length, 0.0001),
        modelVersion: "heuristic-v0",
      });
    });
  }
}

/**
 * Bulk insert: each chunk is one statement with a single JSON parameter
 * (`json_populate_recordset`), instead of one bind parameter per cell. Far
 * fewer round trips and much less parse/bind work, which matters on PGlite and
 * over the network to Neon. Rows are grouped by the keys they set, so omitted
 * keys still get the column DEFAULT, as with a regular Drizzle insert.
 */
async function insertChunked(
  db: DbOrTx,
  table: PgTable,
  values: Record<string, unknown>[],
  size = 2000,
) {
  const columns = getTableColumns(table) as Record<string, Column>;
  const colName = (key: string) => (columns[key].keyAsName ? toSnakeCase(key) : columns[key].name);
  const groups = new Map<string, { keys: string[]; rows: Record<string, unknown>[] }>();
  for (const row of values) {
    const keys = Object.keys(row).filter((k) => row[k] !== undefined && k in columns);
    const sig = keys.join(",");
    const g = groups.get(sig) ?? { keys, rows: [] };
    g.rows.push(row);
    groups.set(sig, g);
  }
  const tableName = getTableName(table);
  for (const { keys, rows: groupRows } of groups.values()) {
    const cols = sql.join(keys.map((k) => sql.identifier(colName(k))), sql`, `);
    for (let i = 0; i < groupRows.length; i += size) {
      const payload = groupRows.slice(i, i + size).map((row) => {
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          const v = row[k];
          out[colName(k)] = v === null ? null : columns[k].mapToDriverValue(v);
        }
        return out;
      });
      await db.execute(sql`
        INSERT INTO ${sql.identifier(tableName)} (${cols})
        SELECT ${cols} FROM json_populate_recordset(NULL::${sql.identifier(tableName)}, ${JSON.stringify(payload)}::json)`);
    }
  }
}

/** Derived columns, computed in SQL so they always match the inserted facts. */
async function recomputeAggregates(db: DbOrTx) {
  const rookie = BADGE_TIERS[0].tier;
  const saver = BADGE_TIERS[1];
  const hero = BADGE_TIERS[2];
  await db.execute(sql`
    UPDATE users u SET
      total_food_saved_grams = agg.food,
      total_co2_avoided_grams = agg.co2,
      total_money_saved_idr = agg.saved,
      loyalty_points = agg.points,
      badge_tier = CASE
        WHEN agg.food >= ${hero.minFoodSavedGrams} THEN ${hero.tier}
        WHEN agg.food >= ${saver.minFoodSavedGrams} THEN ${saver.tier}
        ELSE ${rookie} END
    FROM (
      SELECT customer_id,
             SUM(total_food_saved_grams)::int AS food,
             SUM(total_co2_avoided_grams)::int AS co2,
             SUM(subtotal_original_idr - subtotal_recovery_idr + voucher_discount_idr)::bigint AS saved,
             (SUM(total_customer_paid_idr) / 1000)::int AS points
      FROM orders WHERE status = 'COMPLETED' GROUP BY customer_id
    ) agg
    WHERE u.id = agg.customer_id`);

  await db.execute(sql`
    UPDATE merchants m SET wallet_balance_idr = agg.balance
    FROM (SELECT merchant_id, SUM(net_merchant_payout_idr)::bigint AS balance
          FROM orders WHERE status = 'COMPLETED' GROUP BY merchant_id) agg
    WHERE m.id = agg.merchant_id`);

  await db.execute(sql`
    UPDATE merchants m SET rating_avg = ROUND(agg.avg_rating, 2), total_reviews = agg.n
    FROM (SELECT merchant_id, AVG(rating)::numeric AS avg_rating, COUNT(*)::int AS n
          FROM reviews GROUP BY merchant_id) agg
    WHERE m.id = agg.merchant_id`);

  await db.execute(sql`
    UPDATE merchants m SET historical_conversion_rate = ROUND(agg.rate, 4)
    FROM (SELECT merchant_id,
                 GREATEST(0.05, LEAST(1, SUM(initial_stock - available_stock)::numeric / NULLIF(SUM(initial_stock), 0))) AS rate
          FROM surplus_batches WHERE status IN ('SOLD_OUT', 'EXPIRED') GROUP BY merchant_id) agg
    WHERE m.id = agg.merchant_id AND agg.rate IS NOT NULL`);
}

export interface SeedOptions {
  now?: Date;
  /** HMAC secret for pickup QR tokens (must match the app's PICKUP_QR_SECRET). */
  pickupQrSecret: string;
  /** PRNG seed (default 20271107 or env SEED). */
  seed?: number;
  log?: (msg: string) => void;
  /**
   * Seeding wipes every table. When real pilot warung exist (merchants.is_pilot) it refuses,
   * unless this is set: the field-pilot results must not disappear with a demo reseed.
   */
  allowPilotWipe?: boolean;
}

/** Thrown by seedDatabase when pilot data would be wiped without allowPilotWipe. */
export class PilotDataPresentError extends Error {
  constructor(readonly pilotWarung: number) {
    super(
      `${pilotWarung} warung uji coba (data nyata) ada di database. Seed menghapus semua data; ` +
        "set allowPilotWipe (SEED_WIPE_PILOT=1 / ?wipe_pilot=1) kalau memang ingin menghapusnya.",
    );
    this.name = "PilotDataPresentError";
  }
}

export interface SeedSummary {
  users: number;
  merchants: number;
  menus: number;
  batches: number;
  active_batches: number;
  orders: number;
  order_items: number;
  discount_logs: number;
  reviews: number;
  subscriptions: number;
  predictions: number;
  presence: number;
}

/** Wipes all app tables and inserts the demo dataset. */
export async function seedDatabase(db: Db, opts: SeedOptions): Promise<SeedSummary> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  resetState(opts.seed ?? Number(process.env.SEED ?? DEFAULT_SEED));

  log("[seed] building rows …");
  buildAll(now, opts.pickupQrSecret);

  // One transaction: readers never see half-seeded tables, and a failed seed
  // leaves the previous data in place.
  await db.transaction(async (tx) => {
    if (!opts.allowPilotWipe) {
      const { rows } = await tx.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM merchants WHERE is_pilot`);
      const n = rows[0]?.n ?? 0;
      if (n > 0) throw new PilotDataPresentError(n);
    }
    log("[seed] wiping tables …");
    await tx.execute(sql`
      TRUNCATE reviews, order_items, orders, discount_adjustment_logs,
               merchant_surplus_predictions, customer_merchant_subscriptions,
               surplus_batches, menus, merchants, otp_codes, customer_presence,
               push_subscriptions, users
      RESTART IDENTITY CASCADE`);

    log("[seed] inserting …");
    await insertChunked(tx, s.users, rows.users);
    await insertChunked(tx, s.merchants, rows.merchants);
    await insertChunked(tx, s.menus, rows.menus);
    await insertChunked(tx, s.surplusBatches, rows.batches);
    await insertChunked(tx, s.orders, rows.orders);
    await insertChunked(tx, s.orderItems, rows.items);
    await insertChunked(tx, s.discountAdjustmentLogs, rows.logs);
    await insertChunked(tx, s.reviews, rows.reviews);
    await insertChunked(tx, s.customerMerchantSubscriptions, rows.subscriptions);
    await insertChunked(tx, s.merchantSurplusPredictions, rows.predictions);
    await insertChunked(tx, s.customerPresence, rows.presence);

    log("[seed] recomputing aggregates …");
    await recomputeAggregates(tx);
  });

  return {
    users: rows.users.length,
    merchants: rows.merchants.length,
    menus: rows.menus.length,
    batches: rows.batches.length,
    active_batches: rows.batches.filter((b) => b.status === "ACTIVE").length,
    orders: rows.orders.length,
    order_items: rows.items.length,
    discount_logs: rows.logs.length,
    reviews: rows.reviews.length,
    subscriptions: rows.subscriptions.length,
    predictions: rows.predictions.length,
    presence: rows.presence.length,
  };
}
