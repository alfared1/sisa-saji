/**
 * Dynamic Discount Optimizer — blueprint_sisa_saji.md §2.3.1.
 *
 * Pure, deterministic rule engine. Phase 1 uses it to seed realistic prices;
 * Phase 2 wires it to the quote-ai endpoint and the 5-minute escalation worker
 * and adds unit tests.
 */
import {
  COLD_START_CONVERSION_RATE,
  DISCOUNT_BASELINE_PCT,
  DISCOUNT_MAX_PCT,
  DISCOUNT_MIN_PCT,
  PRICE_ROUNDING_IDR,
} from "@/lib/constants";

export interface DiscountContext {
  originalPriceIdr: number;
  minRecoveryPriceIdr: number;
  availableStock: number;
  minutesToClose: number;
  activeUsersIn2km: number;
  /** 0.0–1.0; use COLD_START_CONVERSION_RATE (0.65) for merchants without history. */
  historicalConversionRate?: number;
}

export interface DiscountQuote {
  recommendedDiscountPct: number;
  recommendedSellingPriceIdr: number;
  /** Discount picked by the rules before the floor price was enforced. */
  ruleDiscountPct: number;
  /** True when min_recovery_price_idr raised the price above the rule result. */
  floorApplied: boolean;
}

export function calculateOptimalRecoveryPrice(ctx: DiscountContext): DiscountQuote {
  const conversionRate = ctx.historicalConversionRate ?? COLD_START_CONVERSION_RATE;
  let discountPct = DISCOUNT_BASELINE_PCT; // 2 jam sebelum tutup dengan ≥10 porsi = 50%

  // 1. Time-to-close & remaining-stock thresholds (proposal rule).
  if (ctx.minutesToClose <= 30 && ctx.availableStock >= 5) {
    discountPct = 70;
  } else if (ctx.minutesToClose <= 30 && ctx.availableStock >= 1) {
    discountPct = 65;
  } else if (ctx.minutesToClose <= 60 && ctx.availableStock >= 5) {
    discountPct = 60;
  } else if (ctx.minutesToClose <= 90 && ctx.availableStock >= 8) {
    discountPct = 55;
  }

  // 2. Local demand & historical conversion adjustment.
  const demandRatio = ctx.activeUsersIn2km / Math.max(1, ctx.availableStock * 3);
  if (demandRatio < 0.8 && conversionRate < 0.5) {
    discountPct = Math.min(DISCOUNT_MAX_PCT, discountPct + 5); // area sepi → dorong konversi
  } else if (demandRatio > 2.5 && conversionRate > 0.8 && ctx.minutesToClose > 90) {
    discountPct = Math.max(DISCOUNT_MIN_PCT, discountPct - 5); // demand tinggi → jaga margin
  }

  // 3. Round up to nearest Rp 500, never below the merchant's floor price.
  // Integer math: `1 - 0.7` is 0.30000000000000004 in floating point, which would
  // push e.g. Rp 20.000 @70% up a whole Rp 500 step (6.500 instead of 6.000).
  const roundedPrice =
    Math.ceil((ctx.originalPriceIdr * (100 - discountPct)) / (100 * PRICE_ROUNDING_IDR)) *
    PRICE_ROUNDING_IDR;
  const finalPrice = Math.min(
    ctx.originalPriceIdr,
    Math.max(ctx.minRecoveryPriceIdr, roundedPrice),
  );
  const effectiveDiscountPct = Math.round((1 - finalPrice / ctx.originalPriceIdr) * 100);

  return {
    recommendedDiscountPct: effectiveDiscountPct,
    recommendedSellingPriceIdr: finalPrice,
    ruleDiscountPct: discountPct,
    floorApplied: finalPrice > roundedPrice,
  };
}
