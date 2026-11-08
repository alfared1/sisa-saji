import { describe, expect, it } from "vitest";
import { buildEscalationSchedule, nextEscalation, type ScheduleInput } from "@/server/services/escalation/schedule";

const NOW = new Date("2026-11-12T13:00:00Z"); // 20:00 WIB
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

const base: ScheduleInput = {
  originalPriceIdr: 20000,
  minRecoveryPriceIdr: 6000,
  availableStock: 12,
  pickupEndTime: at(150), // 22:30 WIB
  now: NOW,
  activeUsersInRadius: 20,
  historicalConversionRate: 0.65,
};

function expectMonotonic(steps: ReturnType<typeof buildEscalationSchedule>) {
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i].discount_pct).toBeGreaterThanOrEqual(steps[i - 1].discount_pct);
    expect(steps[i].selling_price_idr).toBeLessThanOrEqual(steps[i - 1].selling_price_idr);
    expect(Date.parse(steps[i].time)).toBeGreaterThan(Date.parse(steps[i - 1].time));
  }
}

describe("buildEscalationSchedule", () => {
  it("starts now, then every 30 minutes counted back from closing", () => {
    const steps = buildEscalationSchedule(base);
    expect(steps[0].time).toBe(NOW.toISOString());
    expect(steps.map((s) => s.minutes_to_close)).toEqual([150, 120, 90, 60, 30]);
  });

  it("discounts are non-decreasing and prices non-increasing", () => {
    for (const stock of [1, 3, 5, 8, 12, 40]) {
      for (const users of [0, 10, 200]) {
        for (const cr of [0.3, 0.65, 0.9]) {
          const steps = buildEscalationSchedule({ ...base, availableStock: stock, activeUsersInRadius: users, historicalConversionRate: cr });
          expectMonotonic(steps);
        }
      }
    }
  });

  it("escalates from the 50% baseline towards 70% near closing", () => {
    const steps = buildEscalationSchedule({ ...base, availableStock: 30, historicalConversionRate: 0.2 });
    expect(steps[0].discount_pct).toBeGreaterThanOrEqual(50);
    expect(steps[steps.length - 1].discount_pct).toBeGreaterThanOrEqual(70);
  });

  it("never goes below the floor price", () => {
    const steps = buildEscalationSchedule({ ...base, minRecoveryPriceIdr: 9000, availableStock: 30 });
    for (const s of steps) expect(s.selling_price_idr).toBeGreaterThanOrEqual(9000);
    expect(steps[steps.length - 1].selling_price_idr).toBe(9000);
  });

  it("expected remaining stock declines with the conversion rate", () => {
    const steps = buildEscalationSchedule({ ...base, availableStock: 40, historicalConversionRate: 0.5 });
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].expected_remaining_stock).toBeLessThanOrEqual(steps[i - 1].expected_remaining_stock);
    }
    expect(steps[steps.length - 1].expected_remaining_stock).toBeLessThan(40);
  });

  it("never schedules below the price that is already live", () => {
    const steps = buildEscalationSchedule({ ...base, current: { discountPct: 65, sellingPriceIdr: 7000 } });
    for (const s of steps) {
      expect(s.discount_pct).toBeGreaterThanOrEqual(65);
      expect(s.selling_price_idr).toBeLessThanOrEqual(7000);
    }
  });

  it("is empty after closing", () => {
    expect(buildEscalationSchedule({ ...base, pickupEndTime: at(-1) })).toEqual([]);
  });
});

describe("nextEscalation", () => {
  it("returns the first future step that lowers the price", () => {
    const steps = buildEscalationSchedule({ ...base, availableStock: 30 });
    const current = { discountPct: steps[0].discount_pct, sellingPriceIdr: steps[0].selling_price_idr };
    const next = nextEscalation(steps, current, NOW);
    expect(next).not.toBeNull();
    expect(Date.parse(next!.at)).toBeGreaterThan(NOW.getTime());
    expect(next!.selling_price_idr).toBeLessThan(current.sellingPriceIdr);
  });

  it("returns null when nothing cheaper is scheduled", () => {
    const steps = buildEscalationSchedule(base);
    expect(nextEscalation(steps, { discountPct: 90, sellingPriceIdr: 2000 }, NOW)).toBeNull();
  });
});
