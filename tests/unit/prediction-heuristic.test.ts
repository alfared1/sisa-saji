import { describe, expect, it } from "vitest";
import {
  combineMenuEstimates,
  heuristicForMenu,
  sameWeekdayDates,
  shiftDate,
  type HistoryBatch,
} from "@/server/services/prediction/heuristic";
import { wibDayOfWeek } from "@/lib/time";

// 2026-11-12 is a Thursday (Kamis).
const TARGET = "2026-11-12";
const b = (batchDate: string, initialStock: number, status = "EXPIRED", menuId = "m1"): HistoryBatch => ({
  menuId,
  batchDate,
  initialStock,
  status,
});

describe("heuristic date helpers", () => {
  it("shifts calendar dates without timezone drift", () => {
    expect(shiftDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("lists the same weekday of the previous 4 weeks, newest first", () => {
    const dates = sameWeekdayDates(TARGET);
    expect(dates).toEqual(["2026-11-05", "2026-10-29", "2026-10-22", "2026-10-15"]);
    for (const d of dates) expect(wibDayOfWeek(d)).toBe(wibDayOfWeek(TARGET));
  });
});

describe("heuristicForMenu", () => {
  it("averages closed same-weekday batches of the last 4 weeks", () => {
    const est = heuristicForMenu(
      [b("2026-11-05", 8, "SOLD_OUT"), b("2026-10-29", 6), b("2026-10-22", 10), b("2026-10-15", 4, "SOLD_OUT")],
      TARGET,
    );
    expect(est.predictedSurplusPortions).toBe(7);
    expect(est.observations).toBe(4);
    // Laplace smoothing: (2 sold out + 1) / (4 + 2)
    expect(est.selloutProbabilityAt50pct).toBeCloseTo(0.5, 4);
    expect(est.confidenceScore).toBeGreaterThan(0.9);
  });

  it("ignores other weekdays, open/cancelled batches, data older than 4 weeks and the target day itself", () => {
    const est = heuristicForMenu(
      [
        b("2026-11-05", 6),
        b("2026-11-04", 50), // Wednesday
        b("2026-10-29", 99, "ACTIVE"),
        b("2026-10-29", 99, "CANCELLED"),
        b("2026-10-08", 99), // 5 weeks back
        b(TARGET, 99), // same day (not history yet)
      ],
      TARGET,
    );
    expect(est.observations).toBe(1);
    expect(est.predictedSurplusPortions).toBe(6);
    expect(est.selloutProbabilityAt50pct).toBeCloseTo(1 / 3, 4);
  });

  it("confidence grows with the number of observations", () => {
    const one = heuristicForMenu([b("2026-11-05", 6)], TARGET);
    const three = heuristicForMenu([b("2026-11-05", 6), b("2026-10-29", 6), b("2026-10-22", 6)], TARGET);
    expect(three.confidenceScore).toBeGreaterThan(one.confidenceScore);
  });

  it("falls back to the 4-week mean (low confidence) without same-weekday data, and 0 for new menus", () => {
    const fallback = heuristicForMenu([b("2026-11-04", 4), b("2026-11-03", 8)], TARGET);
    expect(fallback.observations).toBe(0);
    expect(fallback.predictedSurplusPortions).toBe(6);
    expect(fallback.confidenceScore).toBeLessThan(0.5);

    const empty = heuristicForMenu([], TARGET);
    expect(empty.predictedSurplusPortions).toBe(0);
    expect(empty.selloutProbabilityAt50pct).toBe(0.5);
  });
});

describe("combineMenuEstimates", () => {
  it("sums portions and averages probability/confidence for the merchant-level row", () => {
    const c = combineMenuEstimates([
      { predictedSurplusPortions: 4, selloutProbabilityAt50pct: 0.4, confidenceScore: 0.8, observations: 3 },
      { predictedSurplusPortions: 6.5, selloutProbabilityAt50pct: 0.6, confidenceScore: 0.6, observations: 2 },
    ]);
    expect(c.predictedSurplusPortions).toBe(10.5);
    expect(c.selloutProbabilityAt50pct).toBeCloseTo(0.5, 4);
    expect(c.confidenceScore).toBeCloseTo(0.7, 4);
    expect(c.observations).toBe(5);
  });
});
