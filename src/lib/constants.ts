/**
 * Domain & business constants — blueprint_sisa_saji.md "Konstanta Domain & Bisnis".
 * Change values here, not inline in features.
 */

/** Geo-discovery radius (meters). */
export const DEFAULT_SEARCH_RADIUS_M = 2000;
export const MAX_SEARCH_RADIUS_M = 10000;
export const EXPANDED_RADIUS_OPTIONS_M = [2000, 5000, 10000] as const;

/** Main surplus interception window (merchant local time). */
export const SURPLUS_WINDOW_START = "20:00";
export const SURPLUS_WINDOW_END = "23:00";

/** Platform service fee per successful transaction (IDR). */
export const PLATFORM_COMMISSION_MIN_IDR = 1000;
export const PLATFORM_COMMISSION_MAX_IDR = 2000;
export const PLATFORM_COMMISSION_DEFAULT_IDR = 1500;

/** Merchant premium subscription (priority ranking + verified badge). */
export const MERCHANT_PREMIUM_PRICE_IDR = 50_000;

/** Environmental impact factors. */
export const DEFAULT_PORTION_WEIGHT_GRAMS = 200;
/** IPCC: 2.5 kg CO2e per 1 kg food waste avoided. */
export const CO2E_PER_KG_FOOD = 2.5;
/** One mature tree absorbs ~22.24 kg CO2 per year (proposal ratio 912 t ≈ 41,000 trees). */
export const CO2_KG_PER_TREE_YEAR = 22.24;

/** Checkout. */
export const PAYMENT_TTL_SECONDS = 600; // 10-minute stock lock / QRIS validity
export const PICKUP_CODE_LENGTH = 4;
export const PICKUP_CODE_PREFIX = "SJ-";

/** Dynamic Discount Optimizer bounds. */
export const DISCOUNT_BASELINE_PCT = 50;
export const DISCOUNT_MIN_PCT = 40;
export const DISCOUNT_MAX_PCT = 75;
export const PRICE_ROUNDING_IDR = 500;
/** Conversion rate assumed for merchants without history (cold start). */
export const COLD_START_CONVERSION_RATE = 0.65;

/** Loyalty badge thresholds (grams of food saved). */
export const BADGE_TIERS = [
  { tier: "SURPLUS_ROOKIE", minFoodSavedGrams: 0 },
  { tier: "SURPLUS_SAVER", minFoodSavedGrams: 2_000 },
  { tier: "SURPLUS_HERO", minFoodSavedGrams: 5_000 },
] as const;

export const APP_TIMEZONE = "Asia/Jakarta";

/** Quick-pick campus locations (approximate campus centroids). */
export const CAMPUSES = [
  { id: "ugm", name: "UGM Yogyakarta", lat: -7.7713, lng: 110.3775 },
  { id: "uny", name: "UNY Yogyakarta", lat: -7.7756, lng: 110.3866 },
  { id: "itb", name: "ITB Bandung", lat: -6.8915, lng: 107.6107 },
  { id: "ub", name: "UB Malang", lat: -7.9526, lng: 112.6145 },
  { id: "ui", name: "UI Depok", lat: -6.3628, lng: 106.8269 },
  { id: "ipb", name: "IPB Bogor", lat: -6.5568, lng: 106.7313 },
] as const;

export type CampusId = (typeof CAMPUSES)[number]["id"];

/** OTP login. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
/** Max OTP requests per identifier per 10 minutes. */
export const OTP_MAX_REQUESTS_PER_WINDOW = 5;

/** Presence: a device counts as "active" for this long after its last ping. */
export const PRESENCE_ACTIVE_MINUTES = 30;

/** Dynamic Discount Optimizer worker cadence (blueprint: every 5 minutes). */
export const ESCALATION_INTERVAL_MINUTES = 5;

/** Demo vouchers (platform-funded). Replace with a vouchers table when needed. */
export const DEMO_VOUCHERS = [
  { code: "HEMAT2K", title: "Potongan Rp 2.000 (min. Rp 10.000)", discount_idr: 2000, min_subtotal_idr: 10000 },
  { code: "MAHASISWA", title: "Potongan Rp 1.000 untuk mahasiswa", discount_idr: 1000, min_subtotal_idr: 0 },
  { code: "BAWABEKAL", title: "Potongan Rp 1.500 bawa wadah sendiri", discount_idr: 1500, min_subtotal_idr: 8000 },
] as const;
