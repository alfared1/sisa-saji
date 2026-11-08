import { describe, expect, it } from "vitest";
import {
  estimateSelloutProbability,
  SELLOUT_MAX,
  SELLOUT_MIN,
  type SelloutInput,
} from "@/server/services/prediction/sellout";

const base: SelloutInput = {
  baseRate: 0.6,
  availableStock: 10,
  expectedSurplusPortions: 8,
  discountPct: 50,
  minutesToClose: 120,
  activeUsersInRadius: 20,
};

describe("estimateSelloutProbability", () => {
  it("more discount ⇒ higher probability (monotonic)", () => {
    let prev = 0;
    for (let pct = 0; pct <= 90; pct += 5) {
      const p = estimateSelloutProbability({ ...base, discountPct: pct });
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(estimateSelloutProbability({ ...base, discountPct: 70 })).toBeGreaterThan(
      estimateSelloutProbability({ ...base, discountPct: 50 }),
    );
  });

  it("more stock ⇒ lower probability, more active users ⇒ higher probability", () => {
    const small = estimateSelloutProbability({ ...base, availableStock: 4 });
    const large = estimateSelloutProbability({ ...base, availableStock: 40 });
    expect(small).toBeGreaterThan(large);

    const quiet = estimateSelloutProbability({ ...base, activeUsersInRadius: 0 });
    const busy = estimateSelloutProbability({ ...base, activeUsersInRadius: 80 });
    expect(busy).toBeGreaterThan(quiet);
  });

  it("more time before closing ⇒ higher probability, higher prior ⇒ higher probability", () => {
    expect(estimateSelloutProbability({ ...base, minutesToClose: 150 })).toBeGreaterThan(
      estimateSelloutProbability({ ...base, minutesToClose: 20 }),
    );
    expect(estimateSelloutProbability({ ...base, baseRate: 0.9 })).toBeGreaterThan(
      estimateSelloutProbability({ ...base, baseRate: 0.3 }),
    );
  });

  it("is clamped to 0.02..0.98 and handles unknown expected surplus", () => {
    const hi = estimateSelloutProbability({ ...base, baseRate: 1, discountPct: 90, availableStock: 1, activeUsersInRadius: 500 });
    const lo = estimateSelloutProbability({ ...base, baseRate: 0, discountPct: 0, availableStock: 500, activeUsersInRadius: 0, minutesToClose: 5 });
    expect(hi).toBeLessThanOrEqual(SELLOUT_MAX);
    expect(lo).toBeGreaterThanOrEqual(SELLOUT_MIN);
    const p = estimateSelloutProbability({ ...base, expectedSurplusPortions: null });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
});
