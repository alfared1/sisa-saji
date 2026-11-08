import { describe, expect, it } from "vitest";
import { isCalendarJobDue } from "@/server/jobs";
import { atWib } from "@/lib/time";

describe("isCalendarJobDue", () => {
  const daily = { at: "17:30", until: "20:30" };

  it("is due from `at` until `until` (WIB), once per day", () => {
    expect(isCalendarJobDue(daily, atWib("2026-11-12", "17:29"))).toBe(false);
    expect(isCalendarJobDue(daily, atWib("2026-11-12", "17:30"))).toBe(true);
    expect(isCalendarJobDue(daily, atWib("2026-11-12", "19:00"))).toBe(true);
    expect(isCalendarJobDue(daily, atWib("2026-11-12", "20:30"))).toBe(false);
    expect(isCalendarJobDue(daily, atWib("2026-11-12", "18:00"), "2026-11-12")).toBe(false);
    expect(isCalendarJobDue(daily, atWib("2026-11-13", "18:00"), "2026-11-12")).toBe(true);
  });

  it("weekly jobs only run on their weekday (0 = Minggu)", () => {
    const weekly = { at: "02:00", weekday: 0 };
    expect(isCalendarJobDue(weekly, atWib("2026-11-08", "02:05"))).toBe(true); // Sunday
    expect(isCalendarJobDue(weekly, atWib("2026-11-09", "02:05"))).toBe(false); // Monday
    expect(isCalendarJobDue(weekly, atWib("2026-11-08", "01:59"))).toBe(false);
  });
});
