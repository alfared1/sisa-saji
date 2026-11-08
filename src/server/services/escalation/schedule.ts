/**
 * Escalation schedule simulation for the Dynamic Discount Optimizer (blueprint §2.3.1).
 *
 * Steps: "now", then every 30 minutes counted back from pickup_end
 * (e.g. close 22:00 → 20:30, 21:00, 21:30), so each step lands on a tier boundary
 * of calculateOptimalRecoveryPrice (90 / 60 / 30 minutes to close).
 *
 * Between steps the expected remaining stock declines by the merchant's
 * historical conversion rate per hour: remaining × (1 − CR)^(Δhours).
 *
 * Automatic changes may only RAISE the discount (prices only go down for
 * customers), so the schedule is non-decreasing in discount: when the optimizer
 * would pick a smaller discount (e.g. fewer portions left), the previous step is kept.
 * Every price comes from calculateOptimalRecoveryPrice, so the floor
 * (min_recovery_price_idr) is always respected.
 */
import { calculateOptimalRecoveryPrice } from "@/lib/pricing/dynamic-discount";
import { COLD_START_CONVERSION_RATE } from "@/lib/constants";
import { MINUTE_MS } from "@/lib/time";
import type { EscalationStep } from "@/lib/contracts";

export const ESCALATION_STEP_MINUTES = 30;

export interface ScheduleInput {
  originalPriceIdr: number;
  minRecoveryPriceIdr: number;
  availableStock: number;
  pickupEndTime: Date;
  now: Date;
  activeUsersInRadius: number;
  historicalConversionRate?: number;
  /** Price already live (existing batch); the schedule never goes below this discount. */
  current?: { discountPct: number; sellingPriceIdr: number };
}

export function buildEscalationSchedule(input: ScheduleInput): EscalationStep[] {
  const cr = Math.min(1, Math.max(0, input.historicalConversionRate ?? COLD_START_CONVERSION_RATE));
  const endMs = input.pickupEndTime.getTime();
  if (endMs <= input.now.getTime()) return [];

  const times: Date[] = [input.now];
  const boundaries: Date[] = [];
  for (let k = 1; ; k++) {
    const t = new Date(endMs - k * ESCALATION_STEP_MINUTES * MINUTE_MS);
    if (t.getTime() <= input.now.getTime()) break;
    boundaries.push(t);
  }
  times.push(...boundaries.reverse());

  const steps: EscalationStep[] = [];
  let remaining = input.availableStock;
  let prev = input.current ?? null;
  let prevTime = input.now;
  for (const t of times) {
    const hours = (t.getTime() - prevTime.getTime()) / (60 * MINUTE_MS);
    remaining = remaining * Math.pow(1 - cr, hours);
    prevTime = t;
    const minutesToClose = Math.round((endMs - t.getTime()) / MINUTE_MS);
    const expected = Math.round(remaining);
    const q = calculateOptimalRecoveryPrice({
      originalPriceIdr: input.originalPriceIdr,
      minRecoveryPriceIdr: input.minRecoveryPriceIdr,
      availableStock: Math.max(1, expected),
      minutesToClose,
      activeUsersIn2km: input.activeUsersInRadius,
      historicalConversionRate: cr,
    });
    let discountPct = q.recommendedDiscountPct;
    let price = q.recommendedSellingPriceIdr;
    if (prev && (discountPct < prev.discountPct || price > prev.sellingPriceIdr)) {
      discountPct = prev.discountPct;
      price = prev.sellingPriceIdr;
    }
    steps.push({
      time: t.toISOString(),
      minutes_to_close: minutesToClose,
      discount_pct: discountPct,
      selling_price_idr: price,
      expected_remaining_stock: expected,
    });
    prev = { discountPct, sellingPriceIdr: price };
  }
  return steps;
}

/** First future step that lowers the price below the current one (for MerchantBatchView.next_escalation). */
export function nextEscalation(
  steps: EscalationStep[],
  current: { discountPct: number; sellingPriceIdr: number },
  now: Date,
): { at: string; discount_pct: number; selling_price_idr: number } | null {
  const step = steps.find(
    (s) => Date.parse(s.time) > now.getTime() && s.selling_price_idr < current.sellingPriceIdr,
  );
  return step ? { at: step.time, discount_pct: step.discount_pct, selling_price_idr: step.selling_price_idr } : null;
}
