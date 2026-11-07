/**
 * Order money & impact math, shared by checkout (Phase 3) and the seeder.
 *
 * Money flow (blueprint §1.1.B.4):
 *   customer pays = recovery subtotal + platform fee − voucher
 *   merchant gets = recovery subtotal (vouchers are platform-funded)
 *   platform keeps = platform fee − voucher
 */
import { PLATFORM_COMMISSION_DEFAULT_IDR } from "@/lib/constants";
import { co2GramsFromFoodGrams } from "@/lib/impact";

export interface OrderLineInput {
  quantity: number;
  unitOriginalPriceIdr: number;
  unitSellingPriceIdr: number;
  portionWeightGrams: number;
}

export interface OrderTotals {
  subtotalOriginalIdr: number;
  subtotalRecoveryIdr: number;
  voucherDiscountIdr: number;
  platformCommissionIdr: number;
  totalCustomerPaidIdr: number;
  netMerchantPayoutIdr: number;
  /** What the customer saved versus normal prices. */
  moneySavedIdr: number;
  totalFoodSavedGrams: number;
  totalCo2AvoidedGrams: number;
}

export function computeOrderTotals(
  lines: OrderLineInput[],
  opts: { voucherDiscountIdr?: number; platformCommissionIdr?: number } = {},
): OrderTotals {
  if (lines.length === 0) throw new Error("Order must contain at least one item");
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error("Invalid quantity");
  }

  const subtotalOriginalIdr = lines.reduce((s, l) => s + l.quantity * l.unitOriginalPriceIdr, 0);
  const subtotalRecoveryIdr = lines.reduce((s, l) => s + l.quantity * l.unitSellingPriceIdr, 0);
  const platformCommissionIdr = opts.platformCommissionIdr ?? PLATFORM_COMMISSION_DEFAULT_IDR;
  // A voucher can cover at most the recovery subtotal (the fee is always paid).
  const voucherDiscountIdr = Math.min(Math.max(0, opts.voucherDiscountIdr ?? 0), subtotalRecoveryIdr);
  const totalFoodSavedGrams = lines.reduce((s, l) => s + l.quantity * l.portionWeightGrams, 0);

  return {
    subtotalOriginalIdr,
    subtotalRecoveryIdr,
    voucherDiscountIdr,
    platformCommissionIdr,
    totalCustomerPaidIdr: subtotalRecoveryIdr + platformCommissionIdr - voucherDiscountIdr,
    netMerchantPayoutIdr: subtotalRecoveryIdr,
    moneySavedIdr: subtotalOriginalIdr - subtotalRecoveryIdr + voucherDiscountIdr,
    totalFoodSavedGrams,
    totalCo2AvoidedGrams: co2GramsFromFoodGrams(totalFoodSavedGrams),
  };
}
