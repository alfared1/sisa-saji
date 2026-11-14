/**
 * Time-decay escalation job (blueprint §2.3.1, every ESCALATION_INTERVAL_MINUTES).
 *
 * For every ACTIVE batch with auto discount on and stock left, re-run the
 * Dynamic Discount Optimizer with live inputs (active users within 2 km, the
 * merchant's conversion rate). Automatic changes may only RAISE the discount
 * (= lower the price); a lower recommendation is ignored. Each change updates the
 * batch's current price + last_price_updated_at and writes a
 * discount_adjustment_logs row (TIME_DECAY_RULE, or TIME_DECAY_30M_RULE when
 * ≤ 30 minutes to close).
 *
 * "Diskon Kilat": the first time a batch is in the ≤ 30-minute tier with ≥ 5
 * portions left, devices within 1.5 km and subscribers (notify_on_surplus_live)
 * get a push — once per batch, detected via an existing TIME_DECAY_30M_RULE log.
 * When the price cannot drop further (floor / already at 70%), a marker log row
 * with unchanged prices is written so the push is still sent only once.
 */
import "server-only";
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { discountAdjustmentLogs, menus, merchants, surplusBatches } from "@/db/schema";
import { calculateOptimalRecoveryPrice } from "@/lib/pricing/dynamic-discount";
import { DEFAULT_SEARCH_RADIUS_M } from "@/lib/constants";
import { formatClockId, formatIdr, minutesBetween } from "@/lib/time";
import { countActiveUsersNear } from "@/server/services/presence";
import { notifyMerchantAudience } from "@/server/services/merchant/notify";

export { buildEscalationSchedule, nextEscalation, ESCALATION_STEP_MINUTES } from "./schedule";

export const FLASH_RESCUE_RADIUS_M = 1500;
export const FLASH_RESCUE_MIN_STOCK = 5;
export const REASON_TIME_DECAY = "TIME_DECAY_RULE";
export const REASON_TIME_DECAY_30M = "TIME_DECAY_30M_RULE";

export interface EscalationSummary {
  checked: number;
  raised: number;
  flashRescues: number;
  notifiedDevices: number;
}

export async function runEscalation(db: Db, now: Date = new Date()): Promise<EscalationSummary> {
  const rows = await db
    .select({ batch: surplusBatches, menu: menus, merchant: merchants })
    .from(surplusBatches)
    .innerJoin(menus, eq(menus.id, surplusBatches.menuId))
    .innerJoin(merchants, eq(merchants.id, surplusBatches.merchantId))
    .where(
      and(
        eq(surplusBatches.status, "ACTIVE"),
        eq(surplusBatches.autoDiscountEnabled, true),
        gt(surplusBatches.availableStock, 0),
        gt(surplusBatches.pickupEndTime, now),
        // Surprise menus are closed: no price drop or Diskon Kilat push for their leftovers.
        eq(menus.isMysteryBag, false),
        ne(menus.category, "MYSTERY_BAG"),
      ),
    );
  const summary: EscalationSummary = { checked: rows.length, raised: 0, flashRescues: 0, notifiedDevices: 0 };
  if (!rows.length) return summary;

  // Batches that already had their Diskon Kilat (30-minute tier) log.
  const flashed = new Set(
    (
      await db
        .select({ id: discountAdjustmentLogs.surplusBatchId })
        .from(discountAdjustmentLogs)
        .where(
          and(
            inArray(
              discountAdjustmentLogs.surplusBatchId,
              rows.map((r) => r.batch.id),
            ),
            eq(discountAdjustmentLogs.triggerReason, REASON_TIME_DECAY_30M),
          ),
        )
    ).map((r) => r.id),
  );

  const usersByMerchant = new Map<string, number>();
  for (const { batch, menu, merchant } of rows) {
    let users = usersByMerchant.get(merchant.id);
    if (users === undefined) {
      users = await countActiveUsersNear(db, merchant.latitude, merchant.longitude, DEFAULT_SEARCH_RADIUS_M, now);
      usersByMerchant.set(merchant.id, users);
    }
    const minutesToClose = Math.max(0, minutesBetween(now, batch.pickupEndTime));
    const q = calculateOptimalRecoveryPrice({
      originalPriceIdr: batch.originalPriceIdr,
      minRecoveryPriceIdr: Math.min(menu.minRecoveryPriceIdr, batch.originalPriceIdr),
      availableStock: batch.availableStock,
      minutesToClose,
      activeUsersIn2km: users,
      historicalConversionRate: merchant.historicalConversionRate,
    });
    const inFlashTier = minutesToClose <= 30;
    const raise =
      q.recommendedDiscountPct > batch.currentDiscountPct &&
      q.recommendedSellingPriceIdr < batch.currentSellingPriceIdr;
    const needsFlash =
      inFlashTier && batch.availableStock >= FLASH_RESCUE_MIN_STOCK && !flashed.has(batch.id);
    if (!raise && !needsFlash) continue;

    const newPct = raise ? q.recommendedDiscountPct : batch.currentDiscountPct;
    const newPrice = raise ? q.recommendedSellingPriceIdr : batch.currentSellingPriceIdr;
    // updated_at = write time (not the tick start): batches of one tick commit seconds
    // apart (push sends in between), and the SSE cursor follows updated_at.
    const stampedAt = sql`GREATEST(clock_timestamp(), ${now}::timestamptz)`;
    const applied = await db.transaction(async (tx) => {
      // Optimistic guard: skip if the price changed since we read it (merchant edit / parallel run).
      const [updated] = await tx
        .update(surplusBatches)
        .set(
          raise
            ? { currentDiscountPct: newPct, currentSellingPriceIdr: newPrice, lastPriceUpdatedAt: now, updatedAt: stampedAt }
            : { updatedAt: stampedAt },
        )
        .where(
          and(
            eq(surplusBatches.id, batch.id),
            eq(surplusBatches.status, "ACTIVE"),
            eq(surplusBatches.currentDiscountPct, batch.currentDiscountPct),
            eq(surplusBatches.currentSellingPriceIdr, batch.currentSellingPriceIdr),
          ),
        )
        .returning({ id: surplusBatches.id });
      if (!updated) return false;
      await tx.insert(discountAdjustmentLogs).values({
        surplusBatchId: batch.id,
        previousDiscountPct: batch.currentDiscountPct,
        newDiscountPct: newPct,
        previousPriceIdr: batch.currentSellingPriceIdr,
        newPriceIdr: newPrice,
        remainingStock: batch.availableStock,
        minutesToClosing: minutesToClose,
        activeUsersInRadius: users,
        triggerReason: inFlashTier ? REASON_TIME_DECAY_30M : REASON_TIME_DECAY,
        createdAt: now,
      });
      return true;
    });
    if (!applied) continue;
    if (raise) summary.raised++;
    if (inFlashTier) flashed.add(batch.id);

    if (needsFlash) {
      summary.flashRescues++;
      summary.notifiedDevices += await notifyMerchantAudience(db, {
        merchantId: merchant.id,
        point: { lat: merchant.latitude, lng: merchant.longitude },
        subscribers: "notify_on_surplus_live",
        nearbyRadiusM: FLASH_RESCUE_RADIUS_M,
        now,
        payload: {
          title: `Diskon Kilat ${newPct}% di ${merchant.merchantName}`,
          body: `${menu.menuName} tinggal ${batch.availableStock} porsi, sekarang ${formatIdr(newPrice)}. Ambil sebelum ${formatClockId(batch.pickupEndTime)}!`,
          url: `/warung/${merchant.slug}`,
          tag: `flash-${batch.id}`,
        },
      });
    }
  }
  return summary;
}
