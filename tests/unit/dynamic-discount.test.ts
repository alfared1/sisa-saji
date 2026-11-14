import { describe, expect, it } from "vitest";
import { calculateOptimalRecoveryPrice } from "@/lib/pricing/dynamic-discount";
import { EVENING_CARD_QUOTE, EVENING_EXAMPLE, EVENING_TIMELINE } from "@/lib/pricing/evening-example";

const base = {
  originalPriceIdr: 20000,
  minRecoveryPriceIdr: 6000,
  availableStock: 10,
  minutesToClose: 120,
  activeUsersIn2km: 30,
  historicalConversionRate: 0.65,
};

describe("calculateOptimalRecoveryPrice", () => {
  it("starts at the 50% baseline two hours before closing", () => {
    const q = calculateOptimalRecoveryPrice(base);
    expect(q.recommendedDiscountPct).toBe(50);
    expect(q.recommendedSellingPriceIdr).toBe(10000);
  });

  it("escalates to exactly 70% in the last 30 minutes with ≥5 portions (integer rounding)", () => {
    const q = calculateOptimalRecoveryPrice({ ...base, minRecoveryPriceIdr: 3000, minutesToClose: 20, availableStock: 6 });
    expect(q.recommendedDiscountPct).toBe(70);
    expect(q.recommendedSellingPriceIdr).toBe(6000);
  });

  it("never prices below the merchant floor", () => {
    const q = calculateOptimalRecoveryPrice({ ...base, minRecoveryPriceIdr: 9000, minutesToClose: 10 });
    expect(q.recommendedSellingPriceIdr).toBe(9000);
    expect(q.floorApplied).toBe(true);
  });
});

describe("EVENING_EXAMPLE (welcome and login illustration)", () => {
  it("is a Rp 22.000 menu with a Rp 10.000 floor, priced 11.000 / 10.000 / 10.000 through the evening", () => {
    expect(EVENING_EXAMPLE).toEqual({ name: "Nasi Timbel + Lauk Pilihan", priceIdr: 22000, floorIdr: 10000 });
    expect(EVENING_TIMELINE.map((s) => s.quote.recommendedSellingPriceIdr)).toEqual([11000, 10000, 10000]);
    expect(EVENING_TIMELINE[2].text).toBe("Diskon menjelang tutup, tidak pernah di bawah harga lantai warung.");
    for (const s of EVENING_TIMELINE) expect(s.quote.recommendedSellingPriceIdr).toBeGreaterThanOrEqual(10000);
    expect(EVENING_CARD_QUOTE.recommendedSellingPriceIdr).toBeGreaterThanOrEqual(10000);
  });
});
