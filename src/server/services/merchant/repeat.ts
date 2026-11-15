/**
 * "Pasang lagi menu kemarin": puts yesterday's surplus menus up again in one tap, with the same
 * portions and the same closing time (24 hours later), priced by the usual suggested price.
 * Skipped: menus already live today, inactive menus, and menus whose closing time is too close.
 */
import "server-only";
import { and, desc, eq, gt, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { menus, surplusBatches } from "@/db/schema";
import { PublishBody, type RepeatCandidate, type RepeatPublishResponse } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { ApiError } from "@/server/http";
import { publishSurplus } from "./surplus";

const DAY_MS = 24 * 60 * 60_000;
/** A repeated batch must stay open at least this long. */
const MIN_OPEN_MS = 30 * 60_000;

export async function repeatCandidates(
  db: Db,
  merchantId: string,
  opts: { maxStock?: number; now?: Date } = {},
): Promise<RepeatCandidate[]> {
  const now = opts.now ?? new Date();
  const yesterday = wibDate(new Date(now.getTime() - DAY_MS));
  const [past, live] = await Promise.all([
    db
      .select({
        menuId: surplusBatches.menuId,
        menuName: menus.menuName,
        initialStock: surplusBatches.initialStock,
        pickupEndTime: surplusBatches.pickupEndTime,
      })
      .from(surplusBatches)
      .innerJoin(menus, eq(menus.id, surplusBatches.menuId))
      .where(
        and(
          eq(surplusBatches.merchantId, merchantId),
          eq(surplusBatches.batchDate, yesterday),
          ne(surplusBatches.status, "CANCELLED"),
          eq(menus.isActive, true),
        ),
      )
      .orderBy(desc(surplusBatches.pickupEndTime)),
    db
      .select({ menuId: surplusBatches.menuId })
      .from(surplusBatches)
      .where(
        and(
          eq(surplusBatches.merchantId, merchantId),
          inArray(surplusBatches.status, ["ACTIVE", "SCHEDULED"]),
          gt(surplusBatches.pickupEndTime, now),
        ),
      ),
  ]);
  const liveMenus = new Set(live.map((l) => l.menuId));
  const seen = new Set<string>();
  const out: RepeatCandidate[] = [];
  for (const b of past) {
    if (seen.has(b.menuId) || liveMenus.has(b.menuId)) continue;
    seen.add(b.menuId);
    const end = new Date(b.pickupEndTime.getTime() + DAY_MS);
    if (end.getTime() - now.getTime() < MIN_OPEN_MS) continue;
    out.push({
      menu_id: b.menuId,
      menu_name: b.menuName,
      initial_stock: opts.maxStock ? Math.min(b.initialStock, opts.maxStock) : b.initialStock,
      pickup_end_time: end.toISOString(),
    });
  }
  return out;
}

export async function repeatYesterday(
  db: Db,
  merchantId: string,
  opts: { maxStock?: number; now?: Date } = {},
): Promise<RepeatPublishResponse> {
  const candidates = await repeatCandidates(db, merchantId, opts);
  if (!candidates.length) throw new ApiError("VALIDATION_ERROR", "Tidak ada menu kemarin yang bisa dipasang lagi sekarang.");
  let published = 0;
  const skipped: RepeatPublishResponse["skipped"] = [];
  for (const c of candidates) {
    try {
      await publishSurplus(
        db,
        merchantId,
        PublishBody.parse({ menu_id: c.menu_id, initial_stock: c.initial_stock, pickup_end_time: c.pickup_end_time }),
        opts.now,
      );
      published++;
    } catch (err) {
      skipped.push({ menu_name: c.menu_name, reason: err instanceof ApiError ? err.message : "Gagal dipasang" });
    }
  }
  return { published, skipped };
}
