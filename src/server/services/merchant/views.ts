/** DB rows → contract views for the merchant API. */
import "server-only";
import type { Menu, Merchant, SurplusBatch } from "@/db/schema";
import type { MenuView, MerchantBatchPhoto, MerchantBatchView, MerchantProfile } from "@/lib/contracts";
import { photoUploadsLeft } from "@/server/services/batch-photos";
import { buildEscalationSchedule, nextEscalation } from "@/server/services/escalation/schedule";

const hhmm = (t: string) => t.slice(0, 5);

/** "1234566789" → "••••6789"; null/blank → null. The full number never leaves the server. */
export function maskAccountNumber(n: string | null | undefined): string | null {
  const compact = (n ?? "").replace(/\s+/g, "");
  if (!compact) return null;
  return `••••${compact.slice(-4)}`;
}

export function toMerchantProfile(m: Merchant): MerchantProfile {
  return {
    id: m.id,
    slug: m.slug,
    merchant_name: m.merchantName,
    merchant_category: m.merchantCategory,
    description: m.description,
    address: m.address,
    lat: m.latitude,
    lng: m.longitude,
    whatsapp_number: m.whatsappNumber,
    operational_open_time: hhmm(m.operationalOpenTime),
    operational_close_time: hhmm(m.operationalCloseTime),
    default_surplus_start_time: hhmm(m.defaultSurplusStartTime),
    is_open: m.isOpen,
    merchant_verified: m.merchantVerified,
    is_pilot: m.isPilot,
    pilot_joined_at: m.pilotJoinedAt ? m.pilotJoinedAt.toISOString() : null,
    pilot_baseline_leftover_portions: m.pilotBaselineLeftoverPortions,
    subscription_tier: m.subscriptionTier,
    subscription_expires_at: m.subscriptionExpiresAt ? m.subscriptionExpiresAt.toISOString() : null,
    wallet_balance_idr: Number(m.walletBalanceIdr),
    rating_avg: Number(m.ratingAvg),
    total_reviews: m.totalReviews,
    historical_conversion_rate: Number(m.historicalConversionRate),
    logo_url: m.logoUrl,
    banner_url: m.bannerUrl,
    bank_code: m.bankCode?.trim() || null,
    bank_account_holder: m.bankAccountHolder?.trim() || null,
    bank_account_number_masked: maskAccountNumber(m.bankAccountNumber),
  };
}

export function toMenuView(m: Menu): MenuView {
  return {
    id: m.id,
    menu_name: m.menuName,
    category: m.category,
    description: m.description,
    image_url: m.imageUrl,
    original_price_idr: m.originalPriceIdr,
    min_recovery_price_idr: m.minRecoveryPriceIdr,
    portion_weight_grams: m.portionWeightGrams,
    contents: m.contents,
    lauk_options: m.laukOptions,
    is_active: m.isActive,
  };
}

export interface BatchViewContext {
  now: Date;
  activeUsersInRadius: number;
  historicalConversionRate: number;
  /** The owner's view of the batch photo (photoMetaForBatches), when it has one. */
  photo?: MerchantBatchPhoto | null;
}

export function toMerchantBatchView(
  b: SurplusBatch,
  menu: Pick<Menu, "menuName" | "contents" | "laukOptions" | "minRecoveryPriceIdr">,
  ctx: BatchViewContext,
): MerchantBatchView {
  let next: MerchantBatchView["next_escalation"] = null;
  if (b.autoDiscountEnabled && b.status === "ACTIVE" && b.availableStock > 0 && b.pickupEndTime > ctx.now) {
    const current = { discountPct: b.currentDiscountPct, sellingPriceIdr: b.currentSellingPriceIdr };
    const steps = buildEscalationSchedule({
      originalPriceIdr: b.originalPriceIdr,
      minRecoveryPriceIdr: Math.min(menu.minRecoveryPriceIdr, b.originalPriceIdr),
      availableStock: b.availableStock,
      pickupEndTime: b.pickupEndTime,
      now: ctx.now,
      activeUsersInRadius: ctx.activeUsersInRadius,
      historicalConversionRate: ctx.historicalConversionRate,
      current,
    });
    next = nextEscalation(steps, current, ctx.now);
  }
  return {
    id: b.id,
    menu_id: b.menuId,
    menu_name: menu.menuName,
    contents: menu.contents,
    lauk_options: menu.laukOptions,
    lauk_available: b.laukAvailable,
    full_portion: b.fullPortion,
    photo: ctx.photo ?? null,
    photo_uploads_left: photoUploadsLeft(b.photoUploadCount),
    initial_stock: b.initialStock,
    available_stock: b.availableStock,
    reserved_stock: b.reservedStock,
    sold: b.initialStock - b.availableStock - b.reservedStock,
    original_price_idr: b.originalPriceIdr,
    current_discount_pct: b.currentDiscountPct,
    current_selling_price_idr: b.currentSellingPriceIdr,
    auto_discount_enabled: b.autoDiscountEnabled,
    predicted_sellout_prob: b.predictedSelloutProb === null ? null : Number(b.predictedSelloutProb),
    pickup_start_time: b.pickupStartTime.toISOString(),
    pickup_end_time: b.pickupEndTime.toISOString(),
    status: b.status,
    last_price_updated_at: b.lastPriceUpdatedAt.toISOString(),
    next_escalation: next,
  };
}
