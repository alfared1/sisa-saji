/**
 * Sisa-Saji database schema (PostgreSQL 16+ / PostGIS).
 * Source of truth: blueprint_sisa_saji.md §2.1.
 *
 * TypeScript keys are camelCase; the client and drizzle-kit both use
 * `casing: "snake_case"`, so `originalPriceIdr` is stored as `original_price_idr`.
 *
 * Deviations from the blueprint DDL (deliberate, documented in README):
 *  - UUIDs use built-in gen_random_uuid() (no uuid-ossp extension needed).
 *  - merchants.geom is a GENERATED column derived from latitude/longitude, so the
 *    spatial column can never drift from the coordinates the app writes.
 *  - users.phone_number is nullable (Google OAuth users may have no phone); a CHECK
 *    requires at least one of email / phone_number. Merchants get their own
 *    NOT NULL whatsapp_number so the customer can always contact the warung.
 *  - surplus_batches.current_discount_pct allows 0–90 (floor price can push the
 *    effective discount below 10%).
 *  - Extra integrity CHECKs and indexes (see inline comments).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Custom types                                                        */
/* ------------------------------------------------------------------ */

/** PostGIS geography(Point, 4326). Read-only from the app (generated column). */
const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geography(Point, 4326)";
  },
});

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const userRole = pgEnum("user_role", ["CUSTOMER", "MERCHANT", "ADMIN"]);
export const merchantTier = pgEnum("merchant_tier", ["REGULAR", "PREMIUM"]);
export const menuCategory = pgEnum("menu_category", [
  "MAKANAN_BERAT",
  "MAKANAN_RINGAN",
  "MAKANAN_VEGAN",
  "MINUMAN",
  "ROTI_PASTRY",
  "BAHAN_MAKANAN",
  "MYSTERY_BAG",
]);
export const batchStatus = pgEnum("batch_status", [
  "SCHEDULED",
  "ACTIVE",
  "SOLD_OUT",
  "EXPIRED",
  "CANCELLED",
]);
export const orderStatus = pgEnum("order_status", [
  "PENDING_PAYMENT",
  "PAID",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);
export const paymentMethodType = pgEnum("payment_method_type", [
  "QRIS",
  "GOPAY",
  "OVO",
  "DANA",
  "SURPLUS_PAY",
  /** Pilot warung: the customer pays the warung directly (cash or its own QRIS) at pickup. */
  "BAYAR_DI_WARUNG",
]);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ------------------------------------------------------------------ */
/* 2. users                                                            */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    role: userRole().notNull().default("CUSTOMER"),
    fullName: varchar({ length: 120 }).notNull(),
    email: varchar({ length: 150 }).unique(),
    phoneNumber: varchar({ length: 25 }).unique(),
    passwordHash: text(),
    avatarUrl: text(),
    campusOrArea: varchar({ length: 100 }),
    defaultLat: doublePrecision(),
    defaultLng: doublePrecision(),
    webpushSubscription: jsonb(),
    loyaltyPoints: integer().notNull().default(0),
    badgeTier: varchar({ length: 50 }).notNull().default("SURPLUS_ROOKIE"),
    totalFoodSavedGrams: integer().notNull().default(0),
    totalCo2AvoidedGrams: integer().notNull().default(0),
    totalMoneySavedIdr: bigint({ mode: "number" }).notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check("users_contact_required", sql`${t.email} IS NOT NULL OR ${t.phoneNumber} IS NOT NULL`),
  ],
);

/* ------------------------------------------------------------------ */
/* 3. merchants                                                        */
/* ------------------------------------------------------------------ */

export const merchants = pgTable(
  "merchants",
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantName: varchar({ length: 150 }).notNull(),
    slug: varchar({ length: 160 }).notNull().unique(),
    merchantCategory: menuCategory().notNull().default("MAKANAN_BERAT"),
    description: text(),
    logoUrl: text(),
    bannerUrl: text(),
    address: text().notNull(),
    /** Contact for the "Hubungi Warung (WhatsApp)" button; required even if the owner logs in with Google. */
    whatsappNumber: varchar({ length: 25 }).notNull(),
    latitude: doublePrecision().notNull(),
    longitude: doublePrecision().notNull(),
    geom: geographyPoint().generatedAlwaysAs(
      sql`(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)`,
    ),
    operationalOpenTime: time().notNull().default("09:00:00"),
    operationalCloseTime: time().notNull().default("22:00:00"),
    defaultSurplusStartTime: time().notNull().default("20:00:00"),
    isOpen: boolean().notNull().default(true),
    merchantVerified: boolean().notNull().default(false),
    subscriptionTier: merchantTier().notNull().default("REGULAR"),
    subscriptionExpiresAt: timestamp({ withTimezone: true }),
    staticQrisPayload: text(),
    /**
     * Real warung in the field pilot (joined with the pilot invite code). Their orders are
     * paid at the warung and counted in the public pilot results, apart from demo data.
     */
    isPilot: boolean().notNull().default(false),
    pilotJoinedAt: timestamp({ withTimezone: true }),
    /**
     * Owner's estimate, given when joining the pilot, of how many portions were usually
     * left over per night before Sisa-Saji. Set once and never changed, so the waste
     * reduction in the pilot results compares against a fixed baseline.
     */
    pilotBaselineLeftoverPortions: integer(),
    bankCode: varchar({ length: 30 }),
    bankAccountNumber: varchar({ length: 50 }),
    bankAccountHolder: varchar({ length: 120 }),
    walletBalanceIdr: bigint({ mode: "number" }).notNull().default(0),
    historicalConversionRate: numeric({ precision: 5, scale: 4, mode: "number" })
      .notNull()
      .default(0.65),
    ratingAvg: numeric({ precision: 3, scale: 2, mode: "number" }).notNull().default(5),
    totalReviews: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("idx_merchants_geom").using("gist", t.geom),
    index("idx_merchants_tier_open").on(t.isOpen, t.subscriptionTier, t.ratingAvg.desc()),
    index("idx_merchants_owner").on(t.ownerUserId),
    check("merchants_lat_range", sql`${t.latitude} BETWEEN -90 AND 90`),
    check("merchants_lng_range", sql`${t.longitude} BETWEEN -180 AND 180`),
    check(
      "merchants_conversion_rate_range",
      sql`${t.historicalConversionRate} BETWEEN 0 AND 1`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* 4. menus                                                            */
/* ------------------------------------------------------------------ */

export const menus = pgTable(
  "menus",
  {
    id: uuid().primaryKey().defaultRandom(),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    menuName: varchar({ length: 150 }).notNull(),
    category: menuCategory().notNull().default("MAKANAN_BERAT"),
    description: text(),
    imageUrl: text(),
    originalPriceIdr: integer().notNull(),
    minRecoveryPriceIdr: integer().notNull(),
    portionWeightGrams: integer().notNull().default(200),
    isMysteryBag: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("idx_menus_merchant").on(t.merchantId, t.isActive),
    check("menus_original_price_positive", sql`${t.originalPriceIdr} > 0`),
    check("menus_min_recovery_positive", sql`${t.minRecoveryPriceIdr} > 0`),
    // Floor price must not exceed the normal price.
    check("menus_floor_le_original", sql`${t.minRecoveryPriceIdr} <= ${t.originalPriceIdr}`),
    check("menus_portion_weight_positive", sql`${t.portionWeightGrams} > 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 5. surplus_batches                                                  */
/* ------------------------------------------------------------------ */

export const surplusBatches = pgTable(
  "surplus_batches",
  {
    id: uuid().primaryKey().defaultRandom(),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    menuId: uuid()
      .notNull()
      .references(() => menus.id, { onDelete: "cascade" }),
    batchDate: date({ mode: "string" }).notNull().default(sql`CURRENT_DATE`),
    initialStock: integer().notNull(),
    availableStock: integer().notNull(),
    reservedStock: integer().notNull().default(0),
    originalPriceIdr: integer().notNull(),
    currentDiscountPct: integer().notNull(),
    currentSellingPriceIdr: integer().notNull(),
    autoDiscountEnabled: boolean().notNull().default(true),
    predictedSelloutProb: numeric({ precision: 5, scale: 4, mode: "number" }),
    pickupStartTime: timestamp({ withTimezone: true }).notNull(),
    pickupEndTime: timestamp({ withTimezone: true }).notNull(),
    status: batchStatus().notNull().default("ACTIVE"),
    lastPriceUpdatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("idx_batches_active_window").on(t.status, t.pickupEndTime, t.currentSellingPriceIdr),
    index("idx_batches_merchant_date").on(t.merchantId, t.batchDate),
    check("batches_initial_stock_positive", sql`${t.initialStock} > 0`),
    check("batches_available_stock_nonneg", sql`${t.availableStock} >= 0`),
    check("batches_reserved_stock_nonneg", sql`${t.reservedStock} >= 0`),
    check(
      "batches_stock_le_initial",
      sql`${t.availableStock} + ${t.reservedStock} <= ${t.initialStock}`,
    ),
    check("batches_discount_range", sql`${t.currentDiscountPct} BETWEEN 0 AND 90`),
    check("batches_selling_price_positive", sql`${t.currentSellingPriceIdr} > 0`),
    check("batches_pickup_window", sql`${t.pickupEndTime} > ${t.pickupStartTime}`),
  ],
);

/* ------------------------------------------------------------------ */
/* 6. orders                                                           */
/* ------------------------------------------------------------------ */

export const orders = pgTable(
  "orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderNumber: varchar({ length: 32 }).notNull().unique(),
    customerId: uuid()
      .notNull()
      .references(() => users.id),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id),
    status: orderStatus().notNull().default("PENDING_PAYMENT"),
    /** 4 digits, displayed as `SJ-XXXX`. Generated at checkout, revealed after payment. */
    pickupCode: varchar({ length: 10 }).notNull(),
    /** HMAC-signed token encoded in the pickup QR (see src/lib/pickup-token.ts). */
    pickupQrToken: text().notNull().unique(),
    scheduledPickupTime: timestamp({ withTimezone: true }),
    pickupDeadlineAt: timestamp({ withTimezone: true }).notNull(),
    usesOwnLunchbox: boolean().notNull().default(false),
    subtotalOriginalIdr: integer().notNull(),
    subtotalRecoveryIdr: integer().notNull(),
    voucherDiscountIdr: integer().notNull().default(0),
    platformCommissionIdr: integer().notNull().default(1500),
    totalCustomerPaidIdr: integer().notNull(),
    netMerchantPayoutIdr: integer().notNull(),
    paymentMethod: paymentMethodType().notNull().default("QRIS"),
    paymentGatewayRef: varchar({ length: 120 }),
    qrisDynamicString: text(),
    paymentExpiresAt: timestamp({ withTimezone: true }).notNull(),
    paidAt: timestamp({ withTimezone: true }),
    pickedUpAt: timestamp({ withTimezone: true }),
    pickupProofImageUrl: text(),
    cancelReason: text(),
    totalFoodSavedGrams: integer().notNull().default(0),
    totalCo2AvoidedGrams: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("idx_orders_customer_status").on(t.customerId, t.status, t.createdAt.desc()),
    index("idx_orders_merchant_status").on(t.merchantId, t.status, t.pickupDeadlineAt.asc()),
    // A pickup code must be unambiguous among a merchant's orders that are still awaiting pickup.
    uniqueIndex("uq_orders_active_pickup_code")
      .on(t.merchantId, t.pickupCode)
      .where(sql`status IN ('PENDING_PAYMENT', 'PAID', 'READY_FOR_PICKUP')`),
    check("orders_amounts_nonneg", sql`
      ${t.subtotalOriginalIdr} >= 0 AND ${t.subtotalRecoveryIdr} >= 0 AND
      ${t.voucherDiscountIdr} >= 0 AND ${t.platformCommissionIdr} >= 0 AND
      ${t.totalCustomerPaidIdr} >= 0 AND ${t.netMerchantPayoutIdr} >= 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 7. order_items                                                      */
/* ------------------------------------------------------------------ */

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    surplusBatchId: uuid()
      .notNull()
      .references(() => surplusBatches.id),
    menuId: uuid()
      .notNull()
      .references(() => menus.id),
    menuNameSnapshot: varchar({ length: 150 }).notNull(),
    quantity: integer().notNull(),
    unitOriginalPriceIdr: integer().notNull(),
    unitSellingPriceIdr: integer().notNull(),
    discountPctApplied: integer().notNull(),
    portionWeightGrams: integer().notNull().default(200),
  },
  (t) => [
    index("idx_order_items_order").on(t.orderId),
    index("idx_order_items_batch").on(t.surplusBatchId),
    check("order_items_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* 8. discount_adjustment_logs                                         */
/* ------------------------------------------------------------------ */

export const discountAdjustmentLogs = pgTable(
  "discount_adjustment_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    surplusBatchId: uuid()
      .notNull()
      .references(() => surplusBatches.id, { onDelete: "cascade" }),
    previousDiscountPct: integer().notNull(),
    newDiscountPct: integer().notNull(),
    previousPriceIdr: integer().notNull(),
    newPriceIdr: integer().notNull(),
    remainingStock: integer().notNull(),
    minutesToClosing: integer().notNull(),
    activeUsersInRadius: integer().notNull(),
    /** e.g. INITIAL_PUBLISH, TIME_DECAY_30M_RULE, LOW_DEMAND_BOOST */
    triggerReason: varchar({ length: 100 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_discount_logs_batch").on(t.surplusBatchId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* 9. merchant_surplus_predictions                                     */
/* ------------------------------------------------------------------ */

export const merchantSurplusPredictions = pgTable(
  "merchant_surplus_predictions",
  {
    id: uuid().primaryKey().defaultRandom(),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    /** NULL = merchant-level prediction (all menus). */
    menuId: uuid().references(() => menus.id, { onDelete: "cascade" }),
    targetDate: date({ mode: "string" }).notNull(),
    /** 0 = Minggu … 5 = Jumat, 6 = Sabtu (matches Postgres EXTRACT(DOW)). */
    dayOfWeek: smallint().notNull(),
    predictedSurplusPortions: numeric({ precision: 6, scale: 2, mode: "number" }).notNull(),
    predictedPeakSurplusHour: time().notNull().default("20:00:00"),
    // Explicit name: snake_case casing would otherwise produce "..._at50pct".
    selloutProbabilityAt50pct: numeric("sellout_probability_at_50pct", {
      precision: 5,
      scale: 4,
      mode: "number",
    }).notNull(),
    confidenceScore: numeric({ precision: 5, scale: 4, mode: "number" }).notNull(),
    /** Evening (17-23 WIB) rain forecast the model used, from Open-Meteo; NULL = unknown / heuristic row. */
    rainForecastMm: numeric({ precision: 5, scale: 1, mode: "number" }),
    modelVersion: varchar({ length: 40 }).notNull(),
    proactiveNotifSent: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT so merchant-level rows (menu_id NULL) are unique per date too.
    unique("uq_predictions_merchant_menu_date")
      .on(t.merchantId, t.menuId, t.targetDate)
      .nullsNotDistinct(),
    index("idx_predictions_date").on(t.targetDate),
    check("predictions_dow_range", sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
  ],
);

/* ------------------------------------------------------------------ */
/* 9b. leftover_reports                                                */
/* ------------------------------------------------------------------ */

/**
 * What happened to the portions still unsold after the warung closed, one row per warung
 * per WIB night. Together with merchants.pilot_baseline_leftover_portions this measures
 * how much food a pilot warung still throws away.
 */
export const leftoverReports = pgTable(
  "leftover_reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    reportDate: date({ mode: "string" }).notNull(),
    /** Given away: staff, neighbours, a mosque or orphanage. */
    donatedPortions: integer().notNull().default(0),
    /** Animal feed or black soldier fly (maggot) larvae. */
    animalFeedPortions: integer().notNull().default(0),
    compostPortions: integer().notNull().default(0),
    discardedPortions: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("uq_leftover_reports_merchant_date").on(t.merchantId, t.reportDate),
    check(
      "leftover_reports_non_negative",
      sql`${t.donatedPortions} >= 0 AND ${t.animalFeedPortions} >= 0 AND ${t.compostPortions} >= 0 AND ${t.discardedPortions} >= 0`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* 10. customer_merchant_subscriptions                                 */
/* ------------------------------------------------------------------ */

export const customerMerchantSubscriptions = pgTable(
  "customer_merchant_subscriptions",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    notifyOnSurplusLive: boolean().notNull().default(true),
    notifyOnAiPrediction: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.merchantId] }),
    index("idx_subscriptions_merchant").on(t.merchantId),
  ],
);

/* ------------------------------------------------------------------ */
/* 11. reviews                                                         */
/* ------------------------------------------------------------------ */

export const reviews = pgTable(
  "reviews",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    customerId: uuid()
      .notNull()
      .references(() => users.id),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id),
    rating: smallint().notNull(),
    tags: text().array(),
    comment: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_reviews_merchant").on(t.merchantId, t.createdAt.desc()),
    check("reviews_rating_range", sql`${t.rating} BETWEEN 1 AND 5`),
  ],
);

/* ------------------------------------------------------------------ */
/* 12. otp_codes (login by WhatsApp/SMS/email OTP)                     */
/* ------------------------------------------------------------------ */

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Normalised phone (+62…) or lower-cased email. */
    identifier: varchar({ length: 150 }).notNull(),
    channel: varchar({ length: 20 }).notNull(), // WHATSAPP | EMAIL
    requestedRole: userRole().notNull().default("CUSTOMER"),
    /** SHA-256 of `${identifier}:${code}`; the plain code is never stored. */
    codeHash: varchar({ length: 64 }).notNull(),
    attempts: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    /**
     * SHA-256 of the requesting client's IP address (never the address itself), for the
     * per-client limit once codes are really sent. Null for older rows and in dev mode.
     */
    clientKey: varchar({ length: 64 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_otp_identifier").on(t.identifier, t.createdAt.desc()),
    index("idx_otp_client_key").on(t.clientKey, t.createdAt.desc()),
    index("idx_otp_created_at").on(t.createdAt.desc()),
  ],
);

/* ------------------------------------------------------------------ */
/* 13. customer_presence (replaces Redis GEO "active users in 2 km")   */
/* ------------------------------------------------------------------ */

export const customerPresence = pgTable(
  "customer_presence",
  {
    /** Random id generated by the browser (works before login). */
    clientId: varchar({ length: 64 }).primaryKey(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    latitude: doublePrecision().notNull(),
    longitude: doublePrecision().notNull(),
    geom: geographyPoint().generatedAlwaysAs(
      sql`(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography)`,
    ),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_presence_geom").using("gist", t.geom),
    index("idx_presence_last_seen").on(t.lastSeenAt),
  ],
);

/* ------------------------------------------------------------------ */
/* 14. push_subscriptions (Web Push, one row per device)               */
/* ------------------------------------------------------------------ */

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id, { onDelete: "cascade" }),
    clientId: varchar({ length: 64 }),
    endpoint: text().notNull().unique(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("idx_push_user").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* 15. pickup_code_failures (lockout against 4-digit code guessing)    */
/* ------------------------------------------------------------------ */

/** One row per wrong typed pickup code entered by a warung (lookup or verify). */
export const pickupCodeFailures = pgTable(
  "pickup_code_failures",
  {
    id: uuid().primaryKey().defaultRandom(),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_pickup_failures_merchant").on(t.merchantId, t.createdAt.desc())],
);

/* ------------------------------------------------------------------ */
/* 16. job_runs (serverless job leases)                                */
/* ------------------------------------------------------------------ */

/**
 * One row per scheduled job (or per idempotency key, e.g. "reminder:<merchant>:<date>").
 * On serverless hosts (Vercel) jobs are triggered by cron and by traffic; a conditional
 * UPSERT on last_run_at acts as a lease so concurrent instances never run a job twice.
 */
export const jobRuns = pgTable("job_runs", {
  name: varchar({ length: 120 }).primaryKey(),
  lastRunAt: timestamp({ withTimezone: true }).notNull(),
  lastStatus: varchar({ length: 20 }),
  lastSummary: jsonb(),
});

export type User = typeof users.$inferSelect;
export type Merchant = typeof merchants.$inferSelect;
export type Menu = typeof menus.$inferSelect;
export type SurplusBatch = typeof surplusBatches.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type LeftoverReport = typeof leftoverReports.$inferSelect;
