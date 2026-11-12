/**
 * Nightly leftover reports: after closing, the warung records where the portions that
 * still did not sell went (given away, animal feed or maggot, compost, thrown away).
 * Pilot results compare the thrown-away part with the baseline the owner gave on joining.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { leftoverReports, merchants, surplusBatches, type LeftoverReport } from "@/db/schema";
import type { LeftoverCounts, LeftoverReportBody, LeftoverReportView } from "@/lib/contracts";
import { DAY_MS, wibDate, wibTime } from "@/lib/time";
import { ApiError } from "@/server/http";
import { loadMerchant } from "./profile";

/** Nights a warung may still report or correct: last night and tonight (WIB). */
export function editableLeftoverDates(now: Date = new Date()): string[] {
  return [wibDate(new Date(now.getTime() - DAY_MS)), wibDate(now)];
}

/** Before noon the owner is most likely reporting last night; after noon, tonight. */
export function defaultLeftoverDate(now: Date = new Date()): string {
  const [yesterday, today] = editableLeftoverDates(now);
  return wibTime(now) < "12:00" ? yesterday : today;
}

const counts = (r: LeftoverReport): LeftoverCounts => ({
  donated: r.donatedPortions,
  animal_feed: r.animalFeedPortions,
  compost: r.compostPortions,
  discarded: r.discardedPortions,
});

export async function getLeftoverReport(
  db: Db,
  merchantId: string,
  date: string | undefined,
  now: Date = new Date(),
): Promise<LeftoverReportView> {
  const editable = editableLeftoverDates(now);
  const reportDate = date ?? defaultLeftoverDate(now);
  if (!editable.includes(reportDate)) {
    throw new ApiError("VALIDATION_ERROR", "Laporan sisa hanya untuk tadi malam atau malam ini.", [
      { path: "date", message: "Tanggal di luar jangkauan" },
    ]);
  }
  const merchant = await loadMerchant(db, merchantId);
  const [[unsold], [row]] = await Promise.all([
    db
      .select({ n: sql<number>`COALESCE(SUM(${surplusBatches.availableStock}), 0)::int` })
      .from(surplusBatches)
      .where(and(eq(surplusBatches.merchantId, merchantId), eq(surplusBatches.batchDate, reportDate))),
    db
      .select()
      .from(leftoverReports)
      .where(and(eq(leftoverReports.merchantId, merchantId), eq(leftoverReports.reportDate, reportDate))),
  ]);
  return {
    report_date: reportDate,
    editable_dates: editable,
    unsold_in_app: unsold?.n ?? 0,
    report: row ? { ...counts(row), updated_at: row.updatedAt.toISOString() } : null,
    is_pilot: merchant.isPilot,
    baseline_leftover_portions: merchant.pilotBaselineLeftoverPortions,
  };
}

export async function saveLeftoverReport(
  db: Db,
  merchantId: string,
  body: z.output<typeof LeftoverReportBody>,
  now: Date = new Date(),
): Promise<LeftoverReportView> {
  if (!editableLeftoverDates(now).includes(body.report_date)) {
    throw new ApiError("VALIDATION_ERROR", "Laporan sisa hanya untuk tadi malam atau malam ini.", [
      { path: "report_date", message: "Tanggal di luar jangkauan" },
    ]);
  }
  const values = {
    donatedPortions: body.donated,
    animalFeedPortions: body.animal_feed,
    compostPortions: body.compost,
    discardedPortions: body.discarded,
  };
  await db
    .insert(leftoverReports)
    .values({ merchantId, reportDate: body.report_date, ...values })
    .onConflictDoUpdate({
      target: [leftoverReports.merchantId, leftoverReports.reportDate],
      set: { ...values, updatedAt: now },
    });
  return getLeftoverReport(db, merchantId, body.report_date, now);
}

/** Waste reduction in percent, or null when there is no baseline waste to compare with. */
export function wasteReductionPct(baselinePortionNights: number, discarded: number): number | null {
  if (baselinePortionNights <= 0) return null;
  return Math.round((1 - discarded / baselinePortionNights) * 100);
}

export type PilotLeftoverRow = LeftoverCounts & { merchantId: string; nights: number };

/** Per pilot warung: leftover totals over the nights reported since it joined. */
export async function pilotLeftoverTotals(db: Db): Promise<PilotLeftoverRow[]> {
  const rows = await db
    .select({
      merchantId: leftoverReports.merchantId,
      nights: sql<number>`COUNT(*)::int`,
      donated: sql<number>`COALESCE(SUM(${leftoverReports.donatedPortions}), 0)::int`,
      animal_feed: sql<number>`COALESCE(SUM(${leftoverReports.animalFeedPortions}), 0)::int`,
      compost: sql<number>`COALESCE(SUM(${leftoverReports.compostPortions}), 0)::int`,
      discarded: sql<number>`COALESCE(SUM(${leftoverReports.discardedPortions}), 0)::int`,
    })
    .from(leftoverReports)
    .innerJoin(merchants, eq(merchants.id, leftoverReports.merchantId))
    .where(
      and(
        eq(merchants.isPilot, true),
        sql`${leftoverReports.reportDate} >= (${merchants.pilotJoinedAt} AT TIME ZONE 'Asia/Jakarta')::date`,
      ),
    )
    .groupBy(leftoverReports.merchantId);
  return rows;
}
