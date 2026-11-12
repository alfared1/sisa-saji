/**
 * Sisa-Saji REST API v1 contract — shared by route handlers (validation) and the
 * frontend (types). Client-safe: imports only zod.
 *
 * Conventions
 *  - JSON keys are snake_case. Money is integer IDR. Weights are integer grams.
 *  - Timestamps are ISO-8601 strings (UTC, with `Z`). Local times of day are "HH:MM".
 *  - Every response is an envelope: { success: true, data, meta? } or
 *    { success: false, error: { code, message, details? } }.
 *  - Auth = httpOnly cookie `ss_session` (JWT). Public endpoints are marked.
 */
import { z } from "zod";

/* ================================================================== */
/* Envelope & errors                                                   */
/* ================================================================== */

export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "MERCHANT_REQUIRED",
  "OUT_OF_STOCK",
  "BATCH_CLOSED",
  "DIFFERENT_MERCHANT",
  "PAYMENT_EXPIRED",
  "INVALID_SIGNATURE",
  "ORDER_STATE_CONFLICT",
  "INVALID_PICKUP_CODE",
  "PICKUP_WINDOW_CLOSED",
  "VOUCHER_INVALID",
  "DB_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiSuccess<T> = { success: true; data: T; meta?: Record<string, unknown> };
export type ApiFailure = {
  success: false;
  error: { code: ErrorCode; message: string; details?: unknown };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/* ================================================================== */
/* Shared primitives                                                   */
/* ================================================================== */

export const MENU_CATEGORIES = [
  "MAKANAN_BERAT",
  "MAKANAN_RINGAN",
  "MAKANAN_VEGAN",
  "MINUMAN",
  "ROTI_PASTRY",
  "BAHAN_MAKANAN",
  "MYSTERY_BAG",
] as const;
export type MenuCategory = (typeof MENU_CATEGORIES)[number];

export const MENU_CATEGORY_LABELS: Record<MenuCategory, string> = {
  MAKANAN_BERAT: "Makanan Berat",
  MAKANAN_RINGAN: "Makanan Ringan",
  MAKANAN_VEGAN: "Vegan",
  MINUMAN: "Minuman",
  ROTI_PASTRY: "Roti & Pastry",
  BAHAN_MAKANAN: "Bahan Makanan",
  MYSTERY_BAG: "Paket Kejutan",
};

export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAID",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Belum Dibayar",
  PAID: "Dibayar",
  READY_FOR_PICKUP: "Siap Diambil",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
  EXPIRED: "Kedaluwarsa",
};

export const BATCH_STATUSES = ["SCHEDULED", "ACTIVE", "SOLD_OUT", "EXPIRED", "CANCELLED"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** BAYAR_DI_WARUNG: pilot warung only, set by the server (the customer pays the warung at pickup). */
export const PAYMENT_METHODS = ["QRIS", "GOPAY", "OVO", "DANA", "SURPLUS_PAY", "BAYAR_DI_WARUNG"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type UserRole = "CUSTOMER" | "MERCHANT" | "ADMIN";
export type MerchantTier = "REGULAR" | "PREMIUM";

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam HH:MM");

/** Accepts 08xx, 628xx, +628xx; the server normalises to +628xx. */
export const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^(\+62|62|0)8\d{7,12}$/, "Nomor HP tidak valid (contoh: 081234567890)");

/* ================================================================== */
/* Auth & profile                                                      */
/* ================================================================== */

const identifierFields = {
  phone_number: phoneNumberSchema.optional(),
  email: z.string().trim().toLowerCase().email().optional(),
};
const oneIdentifier = (v: { phone_number?: string; email?: string }) =>
  Boolean(v.phone_number) !== Boolean(v.email);

/** POST /api/v1/auth/otp/request — public. */
export const OtpRequestBody = z
  .object({ ...identifierFields, role: z.enum(["CUSTOMER", "MERCHANT"]).default("CUSTOMER") })
  .refine(oneIdentifier, { message: "Isi salah satu: nomor HP atau email" });
export type OtpRequestBody = z.input<typeof OtpRequestBody>;
export type OtpRequestResponse = {
  sent: true;
  channel: "WHATSAPP" | "EMAIL";
  expires_in_seconds: number;
  /** Only when OTP_DEV_MODE is on (no real WhatsApp/email provider configured). */
  dev_code?: string;
};

/** POST /api/v1/auth/otp/verify — public. Sets the session cookie. */
export const OtpVerifyBody = z
  .object({
    ...identifierFields,
    code: z.string().regex(/^\d{6}$/, "Kode OTP 6 digit"),
    role: z.enum(["CUSTOMER", "MERCHANT"]).default("CUSTOMER"),
    /** Required when the account does not exist yet. */
    full_name: z.string().trim().min(2).max(120).optional(),
  })
  .refine(oneIdentifier, { message: "Isi salah satu: nomor HP atau email" });
export type OtpVerifyBody = z.input<typeof OtpVerifyBody>;

/**
 * POST /api/v1/auth/logout — optional body. `push_endpoint` = this device's
 * PushSubscription.endpoint, so it stops receiving the account's notifications.
 */
export const LogoutBody = z.object({ push_endpoint: z.string().url().max(2048).optional() });
export type LogoutBody = z.input<typeof LogoutBody>;

export type SessionUser = {
  id: string;
  role: UserRole;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  campus_or_area: string | null;
  default_lat: number | null;
  default_lng: number | null;
  badge_tier: string;
  loyalty_points: number;
  merchant_id: string | null;
  merchant_slug: string | null;
};
export type OtpVerifyResponse = { user: SessionUser; is_new_user: boolean };
/** GET /api/v1/auth/me — public (user is null when logged out). */
export type AuthMeResponse = { user: SessionUser | null };
/** POST /api/v1/auth/logout → { ok: true } */

/** PATCH /api/v1/profile */
export const ProfileUpdateBody = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  campus_or_area: z.string().trim().max(100).nullable().optional(),
  default_lat: lat.nullable().optional(),
  default_lng: lng.nullable().optional(),
});
export type ProfileUpdateBody = z.input<typeof ProfileUpdateBody>;

export const WebPushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type WebPushSubscriptionInput = z.infer<typeof WebPushSubscriptionSchema>;

/** PUT /api/v1/profile/location-push — public (client_id identifies the device). */
export const LocationPushBody = z.object({
  client_id: z.string().min(8).max(64),
  lat,
  lng,
  webpush_subscription: WebPushSubscriptionSchema.optional(),
});
export type LocationPushBody = z.input<typeof LocationPushBody>;
export type LocationPushResponse = { ok: true; active_users_in_radius: number };

/** GET /api/v1/push/public-key — public. */
export type PushPublicKeyResponse = { public_key: string | null };

export type MonthlyImpact = {
  month: string; // "2026-11"
  orders: number;
  food_saved_grams: number;
  co2_avoided_grams: number;
  money_saved_idr: number;
};
/** GET /api/v1/profile/impact */
export type ImpactSummary = {
  total_food_saved_grams: number;
  total_co2_avoided_grams: number;
  total_money_saved_idr: number;
  tree_equivalent: number;
  completed_orders: number;
  loyalty_points: number;
  badge_tier: string;
  next_badge: { tier: string; min_food_saved_grams: number; progress_pct: number } | null;
  monthly: MonthlyImpact[];
};

/** POST /api/v1/merchant/pilot — join the field pilot with the team's invite code. → MerchantMeResponse */
export const PilotJoinBody = z.object({ code: z.string().trim().min(1).max(64) });
export type PilotJoinBody = z.input<typeof PilotJoinBody>;

/**
 * GET /api/v1/stats/pilot — public. Real results of the field pilot only: completed
 * (picked up and verified by the warung) orders at pilot warung, excluding orders a
 * warung owner placed at their own warung. Demo data is never included.
 */
export type PilotStats = {
  /** Earliest pilot_joined_at; null before the first warung joined. */
  started_at: string | null;
  warung_count: number;
  orders_completed: number;
  portions_rescued: number;
  food_saved_grams: number;
  co2_avoided_grams: number;
  /** What buyers saved versus normal prices. */
  money_saved_idr: number;
  /** Recovery revenue the warung collected for food that would have been thrown away. */
  warung_revenue_idr: number;
  unique_buyers: number;
  warung: {
    name: string;
    slug: string;
    joined_at: string;
    orders_completed: number;
    portions_rescued: number;
    food_saved_grams: number;
  }[];
  /** Completed orders per WIB day, oldest first. */
  daily: { date: string; portions_rescued: number; food_saved_grams: number }[];
};

/** GET /api/v1/stats/global — public. */
export type GlobalStats = {
  total_food_saved_grams: number;
  total_co2_avoided_grams: number;
  total_orders_completed: number;
  active_merchants: number;
  live_batches: number;
  /**
   * True when the totals come from demo data (DEMO_MODE or the payment simulator):
   * the UI must label them as such instead of presenting them as real rescues.
   */
  is_demo_data: boolean;
};

/* ================================================================== */
/* Discovery (customer)                                                */
/* ================================================================== */

export const DISCOVER_SORTS = ["priority_distance", "distance", "discount", "closing_soon", "price"] as const;

/** GET /api/v1/discover/nearby and /discover/map-pins — public. */
export const DiscoverQuery = z.object({
  lat,
  lng,
  radius_m: z.coerce.number().int().min(100).max(10000).default(2000),
  category: z.enum(MENU_CATEGORIES).optional(),
  max_price: z.coerce.number().int().positive().optional(),
  sort: z.enum(DISCOVER_SORTS).default("priority_distance"),
  q: z.string().trim().max(60).optional(),
});
export type DiscoverQuery = z.input<typeof DiscoverQuery>;

export type BatchCard = {
  batch_id: string;
  menu_id: string;
  menu_name: string;
  category: MenuCategory;
  description: string | null;
  image_url: string | null;
  is_mystery_bag: boolean;
  portion_weight_grams: number;
  original_price_idr: number;
  selling_price_idr: number;
  discount_pct: number;
  available_stock: number;
  initial_stock: number;
  auto_discount_enabled: boolean;
  pickup_start_time: string;
  pickup_end_time: string;
  minutes_to_close: number;
  merchant_id: string;
  merchant_slug: string;
  merchant_name: string;
  /** Real warung in the field pilot: paid at the warung, no service fee, no vouchers. */
  merchant_is_pilot: boolean;
  distance_m: number | null;
};

export type MerchantSummary = {
  id: string;
  slug: string;
  name: string;
  category: MenuCategory;
  address: string;
  lat: number;
  lng: number;
  distance_m: number | null;
  is_verified: boolean;
  /** Real warung in the field pilot (see BatchCard.merchant_is_pilot). */
  is_pilot: boolean;
  tier: MerchantTier;
  rating_avg: number;
  total_reviews: number;
  logo_url: string | null;
  is_open: boolean;
  max_discount_pct: number;
  min_price_idr: number;
  total_available_stock: number;
  /** Latest pickup_end_time among active batches. */
  closes_at: string | null;
  batches: BatchCard[];
};

export type NearbyResponse = {
  radius_m: number;
  total_batches: number;
  merchants: MerchantSummary[];
};

export type MapPin = {
  merchant_id: string;
  slug: string;
  merchant_name: string;
  lat: number;
  lng: number;
  distance_m: number;
  max_discount_pct: number;
  total_available_stock: number;
  pickup_end_time: string;
  is_verified: boolean;
};
export type MapPinsResponse = { pins: MapPin[] };

/**
 * GET /api/v1/discover/map-pins/all?lat&lng — public. Every warung on the
 * platform (the nationwide "Seluruh Indonesia" map), with or without live
 * surplus. lat/lng are optional (both or neither) and only add `distance_m`.
 */
export const AllMapPinsQuery = z
  .object({ lat: lat.optional(), lng: lng.optional() })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: "lat dan lng harus dikirim bersama",
    path: ["lat"],
  });
export type AllMapPinsQuery = z.input<typeof AllMapPinsQuery>;

/** Upper bound of GET /discover/map-pins/all (live warung come first, so they are never cut). */
export const ALL_MAP_PINS_LIMIT = 2000;

export type WarungMapPin = {
  merchant_id: string;
  slug: string;
  merchant_name: string;
  category: MenuCategory;
  lat: number;
  lng: number;
  /** Nearest campus/city hub (a CampusId from src/lib/constants.ts); null when far from every hub. */
  hub_id: string | null;
  is_verified: boolean;
  is_open: boolean;
  rating_avg: number;
  total_reviews: number;
  /** Has at least one live batch now (warung open, ACTIVE, stock > 0, before pickup_end_time). */
  live: boolean;
  /** Live batches (menus) right now; 0 when idle. */
  live_menu_count: number;
  total_available_stock: number;
  max_discount_pct: number;
  /** Cheapest live recovery price; 0 when idle. */
  min_price_idr: number;
  /** Soonest pickup_end_time among live batches; null when idle. */
  pickup_end_time: string | null;
  /** Meters from lat/lng when given, otherwise null. */
  distance_m: number | null;
};
export type AllMapPinsResponse = { pins: WarungMapPin[]; truncated: boolean };

export type ReviewItem = {
  id: string;
  rating: number;
  tags: string[];
  comment: string | null;
  /** First name + initial, e.g. "Raka P." */
  customer_name: string;
  created_at: string;
};

/** GET /api/v1/merchants/:slugOrId?lat&lng — public. */
export const MerchantDetailQuery = z.object({ lat: lat.optional(), lng: lng.optional() });
export type MerchantDetail = MerchantSummary & {
  description: string | null;
  banner_url: string | null;
  whatsapp_number: string;
  operational_open_time: string; // "HH:MM"
  operational_close_time: string;
  reviews: ReviewItem[];
  /** null when logged out. */
  subscription: { notify_on_surplus_live: boolean; notify_on_ai_prediction: boolean } | null;
};

/** POST /api/v1/merchants/:id/subscribe */
export const SubscribeBody = z.object({
  subscribed: z.boolean(),
  notify_on_surplus_live: z.boolean().default(true),
  notify_on_ai_prediction: z.boolean().default(true),
});
export type SubscribeBody = z.input<typeof SubscribeBody>;
export type SubscribeResponse = { subscribed: boolean };

/** GET /api/v1/subscriptions — the customer's favourite warung. */
export type SubscriptionItem = {
  merchant_id: string;
  merchant_slug: string;
  merchant_name: string;
  notify_on_surplus_live: boolean;
  notify_on_ai_prediction: boolean;
  /** Tonight's prediction for the warung, when available. */
  predicted_surplus_portions: number | null;
  has_live_batches: boolean;
};
export type SubscriptionsResponse = { subscriptions: SubscriptionItem[] };

/**
 * GET /api/v1/stream/batches?lat&lng&radius_m — public Server-Sent Events.
 * Event name "batch" with JSON data BatchStreamEvent; ": ping" comments every 20 s.
 */
export type BatchStreamEvent = {
  batch_id: string;
  merchant_id: string;
  available_stock: number;
  discount_pct: number;
  selling_price_idr: number;
  status: BatchStatus;
  updated_at: string;
};

/* ================================================================== */
/* Checkout, payment & orders                                          */
/* ================================================================== */

export type Voucher = {
  code: string;
  title: string;
  discount_idr: number;
  min_subtotal_idr: number;
};
/** GET /api/v1/vouchers — public. */
export type VouchersResponse = { vouchers: Voucher[] };

/** POST /api/v1/orders/checkout — customer. Reserves stock for PAYMENT_TTL_SECONDS. */
export const CheckoutBody = z.object({
  merchant_id: uuid,
  items: z
    .array(z.object({ batch_id: uuid, quantity: z.number().int().min(1).max(10) }))
    .min(1)
    .max(10),
  scheduled_pickup_time: isoDateTime.optional(),
  uses_own_lunchbox: z.boolean().default(false),
  payment_method: z.enum(PAYMENT_METHODS).default("QRIS"),
  voucher_code: z.string().trim().toUpperCase().max(30).optional(),
});
export type CheckoutBody = z.input<typeof CheckoutBody>;

export type OrderItemView = {
  batch_id: string;
  menu_id: string;
  menu_name: string;
  quantity: number;
  unit_original_price_idr: number;
  unit_selling_price_idr: number;
  discount_pct: number;
  portion_weight_grams: number;
};

export type OrderDetail = {
  id: string;
  order_number: string;
  status: OrderStatus;
  merchant: {
    id: string;
    slug: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    whatsapp_number: string;
  };
  customer: { id: string; full_name: string; phone_number: string | null };
  items: OrderItemView[];
  subtotal_original_idr: number;
  subtotal_recovery_idr: number;
  voucher_discount_idr: number;
  platform_commission_idr: number;
  total_customer_paid_idr: number;
  net_merchant_payout_idr: number;
  money_saved_idr: number;
  uses_own_lunchbox: boolean;
  payment_method: PaymentMethod;
  payment_expires_at: string;
  paid_at: string | null;
  scheduled_pickup_time: string | null;
  pickup_deadline_at: string;
  picked_up_at: string | null;
  /** 4 digits; null until paid. Display as `SJ-XXXX`. */
  pickup_code: string | null;
  /** Value to encode in the pickup QR; null until paid. */
  pickup_qr_token: string | null;
  /** QRIS payload to render as QR; only while PENDING_PAYMENT. */
  qris_string: string | null;
  /** Grams for this order (credited to impact once COMPLETED). */
  food_saved_grams: number;
  co2_avoided_grams: number;
  cancel_reason: string | null;
  review: { rating: number; tags: string[]; comment: string | null } | null;
  created_at: string;
};
export type CheckoutResponse = { order: OrderDetail };

/** GET /api/v1/orders?status=… — customer's own orders, newest first. */
export const OrderListQuery = z.object({
  status: z.enum([...ORDER_STATUSES, "ACTIVE"]).optional(), // ACTIVE = PENDING_PAYMENT|PAID|READY_FOR_PICKUP
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type OrdersResponse = { orders: OrderDetail[] };
/** GET /api/v1/orders/:id → { order: OrderDetail } (customer owner or the order's merchant). */
export type OrderResponse = { order: OrderDetail };

/** POST /api/v1/orders/:id/cancel — customer, only PENDING_PAYMENT. → OrderResponse */

/**
 * POST /api/v1/orders/:id/simulate-payment — customer, demo only
 * (PAYMENT_PROVIDER=simulator). Internally sends a correctly signed webhook. → OrderResponse
 */

/**
 * POST /api/v1/webhooks/payment — payment gateway → server.
 * Header `x-signature`: hex HMAC-SHA512 of the raw body with PAYMENT_WEBHOOK_SECRET.
 */
export const PaymentWebhookBody = z.object({
  order_id: uuid,
  gateway_ref: z.string().min(1).max(120),
  status: z.enum(["PAID", "FAILED", "EXPIRED"]),
  amount_idr: z.number().int().nonnegative(),
});
export type PaymentWebhookBody = z.infer<typeof PaymentWebhookBody>;

/** POST /api/v1/orders/:id/review — customer, only COMPLETED, once. → OrderResponse */
export const ReviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string().trim().min(1).max(30)).max(6).default([]),
  comment: z.string().trim().max(500).optional(),
});
export type ReviewBody = z.input<typeof ReviewBody>;

/** POST /api/v1/orders/lookup-pickup — merchant. Finds the merchant's order by code or QR token. */
export const PickupLookupBody = z.object({
  pickup_code_or_qr_token: z.string().trim().min(4).max(200),
});
export type PickupLookupBody = z.input<typeof PickupLookupBody>;
/** → OrderResponse */

/** POST /api/v1/orders/:id/verify-pickup — merchant. READY_FOR_PICKUP → COMPLETED. → OrderResponse */
export const VerifyPickupBody = z.object({
  pickup_code_or_qr_token: z.string().trim().min(4).max(200),
  proof_image_url: z.string().url().optional(),
});
export type VerifyPickupBody = z.input<typeof VerifyPickupBody>;

/* ================================================================== */
/* Merchant                                                            */
/* ================================================================== */

/** POST /api/v1/merchant/onboarding — logged-in user without a warung (becomes MERCHANT). */
export const MerchantOnboardingBody = z.object({
  merchant_name: z.string().trim().min(3).max(150),
  merchant_category: z.enum(MENU_CATEGORIES).default("MAKANAN_BERAT"),
  description: z.string().trim().max(500).optional(),
  address: z.string().trim().min(5).max(300),
  lat,
  lng,
  whatsapp_number: phoneNumberSchema,
  operational_open_time: timeOfDay.default("09:00"),
  operational_close_time: timeOfDay.default("22:00"),
  default_surplus_start_time: timeOfDay.default("20:00"),
  bank_code: z.string().trim().max(30).optional(),
  bank_account_number: z.string().trim().max(50).optional(),
  bank_account_holder: z.string().trim().max(120).optional(),
});
export type MerchantOnboardingBody = z.input<typeof MerchantOnboardingBody>;

/** PATCH /api/v1/merchant/me */
export const MerchantUpdateBody = MerchantOnboardingBody.partial().extend({
  is_open: z.boolean().optional(),
});
export type MerchantUpdateBody = z.input<typeof MerchantUpdateBody>;

export type MerchantProfile = {
  id: string;
  slug: string;
  merchant_name: string;
  merchant_category: MenuCategory;
  description: string | null;
  address: string;
  lat: number;
  lng: number;
  whatsapp_number: string;
  operational_open_time: string;
  operational_close_time: string;
  default_surplus_start_time: string;
  is_open: boolean;
  merchant_verified: boolean;
  /** Joined the field pilot with the invite code. */
  is_pilot: boolean;
  pilot_joined_at: string | null;
  subscription_tier: MerchantTier;
  subscription_expires_at: string | null;
  wallet_balance_idr: number;
  rating_avg: number;
  total_reviews: number;
  historical_conversion_rate: number;
  logo_url: string | null;
  banner_url: string | null;
  /** Payout details for prefill. The account number is write-only: only a mask ("••••6789") is returned. */
  bank_code: string | null;
  bank_account_holder: string | null;
  bank_account_number_masked: string | null;
};
/** GET /api/v1/merchant/me → MerchantMeResponse (404 MERCHANT_REQUIRED if no warung yet). */
export type MerchantMeResponse = { merchant: MerchantProfile; menus: MenuView[] };

export type MenuView = {
  id: string;
  menu_name: string;
  category: MenuCategory;
  description: string | null;
  image_url: string | null;
  original_price_idr: number;
  min_recovery_price_idr: number;
  portion_weight_grams: number;
  is_mystery_bag: boolean;
  is_active: boolean;
};

/** POST /api/v1/merchant/menus → { menu: MenuView } */
export const MenuCreateBody = z
  .object({
    menu_name: z.string().trim().min(2).max(150),
    category: z.enum(MENU_CATEGORIES).default("MAKANAN_BERAT"),
    description: z.string().trim().max(500).optional(),
    image_url: z.string().url().optional(),
    original_price_idr: z.number().int().min(1000).max(1_000_000),
    min_recovery_price_idr: z.number().int().min(500),
    portion_weight_grams: z.number().int().min(10).max(5000).default(200),
    is_mystery_bag: z.boolean().default(false),
  })
  .refine((m) => m.min_recovery_price_idr <= m.original_price_idr, {
    message: "Harga minimum tidak boleh melebihi harga normal",
    path: ["min_recovery_price_idr"],
  });
export type MenuCreateBody = z.input<typeof MenuCreateBody>;
/** PATCH /api/v1/merchant/menus/:id → { menu: MenuView } */
export const MenuUpdateBody = z.object({
  menu_name: z.string().trim().min(2).max(150).optional(),
  category: z.enum(MENU_CATEGORIES).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  original_price_idr: z.number().int().min(1000).max(1_000_000).optional(),
  min_recovery_price_idr: z.number().int().min(500).optional(),
  portion_weight_grams: z.number().int().min(10).max(5000).optional(),
  is_mystery_bag: z.boolean().optional(),
  is_active: z.boolean().optional(),
});
export type MenuUpdateBody = z.input<typeof MenuUpdateBody>;

/** POST /api/v1/merchant/surplus/quote-ai — synchronous AI quote before publishing. */
export const QuoteAiBody = z.object({
  menu_id: uuid,
  available_stock: z.number().int().min(1).max(500),
  pickup_end_time: isoDateTime,
});
export type QuoteAiBody = z.input<typeof QuoteAiBody>;
export type EscalationStep = {
  time: string;
  minutes_to_close: number;
  discount_pct: number;
  selling_price_idr: number;
  expected_remaining_stock: number;
};
export type QuoteAiResponse = {
  menu_id: string;
  original_price_idr: number;
  min_recovery_price_idr: number;
  sellout_probability: number; // 0..1
  predicted_surplus_portions: number | null;
  recommended_discount_pct: number;
  recommended_selling_price_idr: number;
  floor_applied: boolean;
  minutes_to_close: number;
  active_users_in_radius: number;
  escalation_schedule: EscalationStep[];
  model_version: string;
  /** Short Indonesian sentences explaining the recommendation. */
  explanation: string[];
};

/** POST /api/v1/merchant/surplus/publish → PublishResponse */
export const PublishBody = z.object({
  menu_id: uuid,
  initial_stock: z.number().int().min(1).max(500),
  pickup_start_time: isoDateTime.optional(), // default: now
  pickup_end_time: isoDateTime,
  auto_discount_enabled: z.boolean().default(true),
  /** Manual price override; when omitted the optimizer's recommendation is used. */
  discount_pct_override: z.number().int().min(0).max(90).optional(),
});
export type PublishBody = z.input<typeof PublishBody>;

export type MerchantBatchView = {
  id: string;
  menu_id: string;
  menu_name: string;
  is_mystery_bag: boolean;
  initial_stock: number;
  available_stock: number;
  reserved_stock: number;
  sold: number;
  original_price_idr: number;
  current_discount_pct: number;
  current_selling_price_idr: number;
  auto_discount_enabled: boolean;
  predicted_sellout_prob: number | null;
  pickup_start_time: string;
  pickup_end_time: string;
  status: BatchStatus;
  last_price_updated_at: string;
  /** Next automatic price step, when auto discount is on. */
  next_escalation: { at: string; discount_pct: number; selling_price_idr: number } | null;
};
export type PublishResponse = { batch: MerchantBatchView; notified_devices: number };

/** PATCH /api/v1/merchant/surplus/:batchId/stock — exactly one of delta / available_stock. */
export const StockPatchBody = z
  .object({
    delta: z.number().int().min(-500).max(500).optional(),
    available_stock: z.number().int().min(0).max(500).optional(),
  })
  .refine((b) => (b.delta === undefined) !== (b.available_stock === undefined), {
    message: "Isi salah satu: delta atau available_stock",
  });
export type StockPatchBody = z.input<typeof StockPatchBody>;
/** PATCH /api/v1/merchant/surplus/:batchId — cancel a batch or toggle auto discount. */
export const BatchPatchBody = z.object({
  status: z.literal("CANCELLED").optional(),
  auto_discount_enabled: z.boolean().optional(),
});
export type BatchPatchBody = z.input<typeof BatchPatchBody>;
export type BatchResponse = { batch: MerchantBatchView };

export type TonightPrediction = {
  target_date: string; // YYYY-MM-DD (WIB)
  predicted_surplus_portions: number;
  sellout_probability_at_50pct: number;
  confidence_score: number;
  peak_hour: string; // "HH:MM"
  model_version: string;
  /** Evening (17-23 WIB) rain forecast in mm that the model used; null when unknown. */
  rain_forecast_mm: number | null;
  per_menu: { menu_id: string; menu_name: string; predicted_surplus_portions: number }[];
};

/** GET /api/v1/merchant/dashboard */
export type MerchantDashboard = {
  merchant: MerchantProfile;
  today: {
    revenue_idr: number;
    orders_completed: number;
    orders_pending_pickup: number;
    portions_sold: number;
    food_saved_grams: number;
    co2_avoided_grams: number;
  };
  active_batches: MerchantBatchView[];
  pending_pickups: OrderDetail[];
  ai_prediction: TonightPrediction | null;
};

/** GET /api/v1/merchant/orders?status&date=YYYY-MM-DD → OrdersResponse */
export const MerchantOrdersQuery = z.object({
  status: z.enum([...ORDER_STATUSES, "ACTIVE"]).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** GET /api/v1/merchant/predictions/insights */
export type InsightsResponse = {
  model_version: string;
  week: {
    date: string;
    day_of_week: number;
    predicted_surplus_portions: number;
    sellout_probability_at_50pct: number;
    confidence_score: number;
  }[];
  /** Historical average per weekday × menu (last 4 weeks). */
  heatmap: {
    day_of_week: number; // 0 = Minggu
    menu_id: string;
    menu_name: string;
    avg_surplus_portions: number;
    avg_leftover_portions: number;
  }[];
  advisories: string[];
};

/** GET /api/v1/merchant/analytics?range_days=30 */
export const AnalyticsQuery = z.object({
  range_days: z.coerce.number().int().min(7).max(90).default(30),
});
export type AnalyticsResponse = {
  range_days: number;
  revenue_recovered_idr: number;
  potential_revenue_idr: number;
  portions_published: number;
  portions_sold: number;
  portions_wasted: number;
  sell_through_rate: number; // 0..1
  food_saved_grams: number;
  co2_avoided_grams: number;
  daily: { date: string; revenue_idr: number; portions_sold: number; portions_wasted: number }[];
  top_menus: { menu_id: string; menu_name: string; portions_sold: number; revenue_idr: number }[];
  subscription: { tier: MerchantTier; expires_at: string | null; price_idr: number };
};

/** POST /api/v1/merchant/subscription/upgrade — simulated Rp 50.000 payment, 30 days. */
export type UpgradeResponse = { merchant: MerchantProfile };

/**
 * GET /api/v1/stream/merchant — merchant SSE. Event name "merchant" with
 * MerchantStreamEvent data; ": ping" every 20 s.
 */
export type MerchantStreamEvent =
  | { type: "order.paid"; order_id: string; order_number: string; at: string }
  | { type: "order.completed"; order_id: string; order_number: string; at: string }
  | { type: "batch.updated"; batch_id: string; available_stock: number; discount_pct: number; status: BatchStatus; at: string };
