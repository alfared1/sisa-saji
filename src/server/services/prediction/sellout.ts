/**
 * Sell-out probability for the pre-publish AI quote (blueprint §2.3.2).
 *
 * A small logistic model, hand-calibrated on the seeded 4-week history:
 *
 *   z = logit(base rate)                      prior: stored prediction's P(sellout @50%)
 *                                             or the merchant's historical conversion rate
 *     + 0.045 × (discount − 50)               deeper discount → more buyers
 *     − 0.7  × ln(stock / expected surplus)   more portions than usual → harder to clear
 *     + 0.55 × clamp(ln((1 + 0.35·U) / (1 + stock)), −2, 2)
 *                                             local demand (active users within 2 km) vs supply
 *     + 0.45 × clamp(ln(minutes / 90), −2, 1) more time on the shelf → more chances to sell
 *
 * The result is clamped to 0.02..0.98. Monotonic: increasing the discount never
 * lowers the probability, more stock never raises it.
 */
export interface SelloutInput {
  /** Prior P(sellout) in 0..1 (prediction row or historical conversion rate). */
  baseRate: number;
  availableStock: number;
  /** Typical surplus portions for this menu tonight (null = unknown). */
  expectedSurplusPortions: number | null;
  discountPct: number;
  minutesToClose: number;
  activeUsersInRadius: number;
}

export const SELLOUT_MIN = 0.02;
export const SELLOUT_MAX = 0.98;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function estimateSelloutProbability(input: SelloutInput): number {
  const stock = Math.max(1, input.availableStock);
  const base = clamp(input.baseRate, 0.05, 0.95);
  let z = logit(base);
  z += 0.045 * (input.discountPct - 50);
  if (input.expectedSurplusPortions !== null && input.expectedSurplusPortions > 0) {
    z -= 0.7 * Math.log(stock / Math.max(1, input.expectedSurplusPortions));
  }
  z += 0.55 * clamp(Math.log((1 + 0.35 * Math.max(0, input.activeUsersInRadius)) / (1 + stock)), -2, 2);
  z += 0.45 * clamp(Math.log(Math.max(1, input.minutesToClose) / 90), -2, 1);
  const p = clamp(sigmoid(z), SELLOUT_MIN, SELLOUT_MAX);
  return Math.round(p * 10_000) / 10_000;
}
