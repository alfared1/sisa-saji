import { describe, expect, it } from "vitest";
import { isCalendarJobDue } from "@/server/jobs";
import { HUNGER_ALERT_HOUR, HUNGER_ALERT_WINDOW_START, HUNGER_DIGEST_UNTIL } from "@/lib/constants";
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

describe("hunger-hour window", () => {
  it("runs from 20.00 until 21.30 WIB, matching the 'Jam Lapar (20.00 WIB)' label", () => {
    const job = { at: HUNGER_ALERT_HOUR, until: HUNGER_DIGEST_UNTIL };
    expect(HUNGER_ALERT_HOUR).toBe("20:00");
    expect(HUNGER_ALERT_WINDOW_START).toBe(HUNGER_ALERT_HOUR);
    expect(isCalendarJobDue(job, atWib("2026-11-12", "19:59"))).toBe(false);
    expect(isCalendarJobDue(job, atWib("2026-11-12", "20:00"))).toBe(true);
    // Vercel Hobby fires the 13:00 UTC cron sometime between 20:00 and 20:59 WIB.
    expect(isCalendarJobDue(job, atWib("2026-11-12", "20:59"))).toBe(true);
    expect(isCalendarJobDue(job, atWib("2026-11-12", "21:29"))).toBe(true);
    expect(isCalendarJobDue(job, atWib("2026-11-12", "21:30"))).toBe(false);
  });
});
