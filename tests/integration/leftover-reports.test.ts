/**
 * Nightly leftover reports and the waste reduction in the pilot results: a warung records
 * where the portions that still did not sell went, and /uji-coba compares the thrown-away
 * part with the baseline the owner gave when joining.
 */
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { menus, merchants, surplusBatches } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { LeftoverReportBody } from "@/lib/contracts";
import { DAY_MS, wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import {
  defaultLeftoverDate,
  editableLeftoverDates,
  getLeftoverReport,
  saveLeftoverReport,
  wasteReductionPct,
} from "@/server/services/merchant/leftovers";
import { getPilotStats, joinPilot, setPilotBaseline } from "@/server/services/merchant/pilot";
import { reseed, testDb } from "../helpers/db";

const CODE = "PILOT-SISA-2026";
let db: Db;
let close: () => Promise<void>;
let pilot: typeof merchants.$inferSelect;
let other: typeof merchants.$inferSelect;
const previousCode = process.env.PILOT_INVITE_CODE;
const now = new Date();
const today = wibDate(now);
const yesterday = wibDate(new Date(now.getTime() - DAY_MS));

beforeAll(async () => {
  ({ db, close } = testDb());
  await reseed(db);
  [pilot] = await db.select().from(merchants).where(eq(merchants.slug, "soto-kuning-mang-oyo-dramaga"));
  [other] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
  process.env.PILOT_INVITE_CODE = CODE;
});
afterAll(async () => {
  process.env.PILOT_INVITE_CODE = previousCode;
  await reseed(db); // leave no pilot warung or reports behind for the other suites
  await close();
});

async function expectCode(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
}

const report = (merchantId: string, body: Parameters<typeof LeftoverReportBody.parse>[0]) =>
  saveLeftoverReport(db, merchantId, LeftoverReportBody.parse(body), now);

describe("which night is reported", () => {
  it("only last night and tonight, defaulting to last night before noon WIB", () => {
    const t = new Date("2026-11-12T03:00:00Z"); // 10.00 WIB
    expect(editableLeftoverDates(t)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(defaultLeftoverDate(t)).toBe("2026-11-11");
    expect(defaultLeftoverDate(new Date("2026-11-12T14:00:00Z"))).toBe("2026-11-12"); // 21.00 WIB
  });

  it("refuses older nights", async () => {
    const old = wibDate(new Date(now.getTime() - 3 * DAY_MS));
    await expectCode(getLeftoverReport(db, other.id, old, now), "VALIDATION_ERROR");
    await expectCode(report(other.id, { report_date: old, donated: 0, animal_feed: 0, compost: 0, discarded: 1 }), "VALIDATION_ERROR");
  });
});

describe("recording leftovers", () => {
  it("shows what did not sell in the app, saves the report and lets the warung correct it", async () => {
    const before = await getLeftoverReport(db, other.id, yesterday, now);
    const [menu] = await db.select().from(menus).where(eq(menus.merchantId, other.id)).orderBy(asc(menus.id)).limit(1);
    await db.insert(surplusBatches).values({
      merchantId: other.id,
      menuId: menu.id,
      batchDate: yesterday,
      initialStock: 6,
      availableStock: 4,
      originalPriceIdr: menu.originalPriceIdr,
      currentDiscountPct: 50,
      currentSellingPriceIdr: Math.round(menu.originalPriceIdr / 2),
      pickupStartTime: new Date(now.getTime() - DAY_MS - 3 * 3600_000),
      pickupEndTime: new Date(now.getTime() - DAY_MS),
      status: "EXPIRED",
    });
    const view = await getLeftoverReport(db, other.id, yesterday, now);
    expect(view.unsold_in_app).toBe(before.unsold_in_app + 4);
    expect(view.report).toBeNull();
    expect(view.is_pilot).toBe(false);

    const saved = await report(other.id, { report_date: yesterday, donated: 2, animal_feed: 1, compost: 0, discarded: 1 });
    expect(saved.report).toMatchObject({ donated: 2, animal_feed: 1, compost: 0, discarded: 1 });

    const fixed = await report(other.id, { report_date: yesterday, donated: 3, animal_feed: 1, compost: 0, discarded: 0 });
    expect(fixed.report).toMatchObject({ donated: 3, discarded: 0 });
  });

  it("rejects negative or absurd counts", () => {
    expect(LeftoverReportBody.safeParse({ report_date: today, donated: -1, animal_feed: 0, compost: 0, discarded: 0 }).success).toBe(false);
    expect(LeftoverReportBody.safeParse({ report_date: today, donated: 0, animal_feed: 0, compost: 0, discarded: 501 }).success).toBe(false);
  });
});

describe("waste reduction in the pilot results", () => {
  it("is 1 − thrown away ÷ (baseline × nights)", () => {
    expect(wasteReductionPct(20, 6)).toBe(70);
    expect(wasteReductionPct(10, 12)).toBe(-20);
    expect(wasteReductionPct(0, 3)).toBeNull();
  });

  it("counts only pilot warung, only nights since joining, against the baseline given on joining", async () => {
    // A report from the night before joining, and one from a warung outside the pilot.
    await report(pilot.id, { report_date: yesterday, donated: 0, animal_feed: 0, compost: 0, discarded: 9 });
    await report(other.id, { report_date: today, donated: 0, animal_feed: 0, compost: 0, discarded: 50 });

    const me = await joinPilot(db, pilot.id, CODE, 10, now);
    expect(me.merchant.pilot_baseline_leftover_portions).toBe(10);
    await expectCode(setPilotBaseline(db, pilot.id, 3, now), "CONFLICT");
    await expectCode(setPilotBaseline(db, other.id, 3, now), "FORBIDDEN");

    await report(pilot.id, { report_date: today, donated: 4, animal_feed: 2, compost: 1, discarded: 3 });

    const stats = await getPilotStats(db);
    expect(stats.leftovers).toEqual({
      nights_reported: 1,
      donated: 4,
      animal_feed: 2,
      compost: 1,
      discarded: 3,
      waste_reduction_pct: 70,
    });
    expect(stats.warung.find((w) => w.slug === pilot.slug)).toMatchObject({
      baseline_leftover_portions: 10,
      nights_reported: 1,
      discarded_per_night: 3,
      waste_reduction_pct: 70,
    });
  });

  it("a pilot warung without a baseline reports nights but no reduction until it sets one", async () => {
    await db.update(merchants).set({ pilotBaselineLeftoverPortions: null }).where(eq(merchants.id, pilot.id));
    const stats = await getPilotStats(db);
    expect(stats.leftovers.nights_reported).toBe(1);
    expect(stats.leftovers.waste_reduction_pct).toBeNull();

    await setPilotBaseline(db, pilot.id, 6, now);
    expect((await getPilotStats(db)).leftovers.waste_reduction_pct).toBe(50);
  });
});
