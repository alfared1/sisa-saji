/**
 * Field pilot: real warung join with the team's invite code (PILOT_INVITE_CODE).
 * Pilot warung are paid at the counter (see orders/checkout.ts) and only their
 * verified pickups and leftover reports feed the public pilot results (getPilotStats),
 * never demo data. Joining needs real OTP delivery (see joinPilot).
 */
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, gte, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, orderItems, orders, users } from "@/db/schema";
import type { MerchantMeResponse, PilotAvailability, PilotStats } from "@/lib/contracts";
import { DEMO_LOCKED_MESSAGE, DEMO_LOCKED_REASON, isDemoAccount } from "@/lib/demo-accounts";
import { getPilotInviteCode, isRealOtpDelivery } from "@/lib/env";
import { ApiError } from "@/server/http";
import { getMerchantMe, loadMerchant } from "@/server/services/merchant/profile";
import { pilotLeftoverTotals, wasteReductionPct } from "./leftovers";

/** `error.details.reason` when joining is refused because login codes are still shown on screen. */
export const PILOT_REAL_OTP_REQUIRED = "REAL_OTP_REQUIRED";

function sameCode(given: string, expected: string): boolean {
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(expected.trim().toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ownerIsDemoAccount(db: Db, ownerUserId: string): Promise<boolean> {
  const [owner] = await db
    .select({ email: users.email, phoneNumber: users.phoneNumber })
    .from(users)
    .where(eq(users.id, ownerUserId))
    .limit(1);
  return owner ? isDemoAccount(owner) : false;
}

/** What the settings card needs to show the join form, or why it cannot. */
export async function getPilotAvailability(db: Db, merchantId: string): Promise<PilotAvailability> {
  const m = await loadMerchant(db, merchantId);
  return {
    invite_open: Boolean(getPilotInviteCode()),
    real_otp_delivery: isRealOtpDelivery(),
    demo_locked: await ownerIsDemoAccount(db, m.ownerUserId),
  };
}

/**
 * Joins the pilot. `baselineLeftoverPortions` is the owner's estimate of portions usually
 * THROWN AWAY per night before Sisa-Saji (self-reported); the nightly reports' discarded
 * portions are compared with it.
 *
 * Refused while login codes are shown on screen (OTP_DEV_MODE, no WhatsApp/email provider):
 * a real warung's account would then be open to anyone who knows its phone number. Also
 * refused for the shared demo accounts.
 */
export async function joinPilot(
  db: Db,
  merchantId: string,
  code: string,
  baselineLeftoverPortions: number | null = null,
  now: Date = new Date(),
): Promise<MerchantMeResponse> {
  const expected = getPilotInviteCode();
  if (!expected) throw new ApiError("FORBIDDEN", "Uji coba belum dibuka.");
  const m = await loadMerchant(db, merchantId);
  if (!m.isPilot) {
    if (await ownerIsDemoAccount(db, m.ownerUserId)) {
      throw new ApiError("FORBIDDEN", DEMO_LOCKED_MESSAGE, { reason: DEMO_LOCKED_REASON });
    }
    if (!isRealOtpDelivery()) {
      throw new ApiError(
        "FORBIDDEN",
        "Uji coba lapangan butuh kode masuk lewat WhatsApp/email asli. Selama kode masuk masih tampil di layar, warung sungguhan belum bisa bergabung supaya akunnya aman.",
        { reason: PILOT_REAL_OTP_REQUIRED },
      );
    }
    if (!sameCode(code, expected)) throw new ApiError("VALIDATION_ERROR", "Kode undangan uji coba tidak cocok.", [
      { path: "code", message: "Kode tidak cocok" },
    ]);
    await db
      .update(merchants)
      .set({ isPilot: true, pilotJoinedAt: now, pilotBaselineLeftoverPortions: baselineLeftoverPortions, updatedAt: now })
      .where(eq(merchants.id, merchantId));
  }
  return getMerchantMe(db, merchantId);
}

/**
 * Sets the baseline (portions usually thrown away per night before the pilot) for a pilot
 * warung that has none yet. It cannot be changed afterwards.
 */
export async function setPilotBaseline(db: Db, merchantId: string, portions: number, now: Date = new Date()): Promise<MerchantMeResponse> {
  const m = await loadMerchant(db, merchantId);
  if (!m.isPilot) throw new ApiError("FORBIDDEN", "Warungmu belum ikut uji coba.");
  if (m.pilotBaselineLeftoverPortions !== null) {
    throw new ApiError("CONFLICT", "Angka porsi dibuang sebelum uji coba sudah diisi dan tidak bisa diubah.");
  }
  await db.update(merchants).set({ pilotBaselineLeftoverPortions: portions, updatedAt: now }).where(eq(merchants.id, merchantId));
  return getMerchantMe(db, merchantId);
}

/**
 * Completed orders at pilot warung placed after the warung joined the pilot (anything
 * older is demo history), minus orders an owner placed at their own warung.
 */
const realPilotOrder = and(
  eq(merchants.isPilot, true),
  eq(orders.status, "COMPLETED"),
  gte(orders.createdAt, merchants.pilotJoinedAt),
  ne(orders.customerId, merchants.ownerUserId),
);

export async function getPilotStats(db: Db): Promise<PilotStats> {
  const pilots = await db
    .select({
      id: merchants.id,
      name: merchants.merchantName,
      slug: merchants.slug,
      joinedAt: merchants.pilotJoinedAt,
      baseline: merchants.pilotBaselineLeftoverPortions,
    })
    .from(merchants)
    .where(eq(merchants.isPilot, true))
    .orderBy(asc(merchants.pilotJoinedAt));

  const perOrder = db
    .select({
      merchantId: orders.merchantId,
      customerId: orders.customerId,
      pickedUpAt: orders.pickedUpAt,
      food: orders.totalFoodSavedGrams,
      co2: orders.totalCo2AvoidedGrams,
      saved: sql<number>`${orders.subtotalOriginalIdr} - ${orders.subtotalRecoveryIdr} + ${orders.voucherDiscountIdr}`.as("saved"),
      revenue: orders.subtotalRecoveryIdr,
      portions: sql<number>`(SELECT COALESCE(SUM(${orderItems.quantity}), 0) FROM ${orderItems} WHERE ${orderItems.orderId} = ${orders.id})`.as(
        "portions",
      ),
    })
    .from(orders)
    .innerJoin(merchants, eq(merchants.id, orders.merchantId))
    .where(realPilotOrder)
    .as("po");

  const [t] = await db
    .select({
      orders: sql<number>`COUNT(*)::int`,
      portions: sql<number>`COALESCE(SUM(${perOrder.portions}), 0)::int`,
      food: sql<number>`COALESCE(SUM(${perOrder.food}), 0)::bigint`,
      co2: sql<number>`COALESCE(SUM(${perOrder.co2}), 0)::bigint`,
      saved: sql<number>`COALESCE(SUM(${perOrder.saved}), 0)::bigint`,
      revenue: sql<number>`COALESCE(SUM(${perOrder.revenue}), 0)::bigint`,
      buyers: sql<number>`COUNT(DISTINCT ${perOrder.customerId})::int`,
    })
    .from(perOrder);

  const byWarung = await db
    .select({
      merchantId: perOrder.merchantId,
      orders: sql<number>`COUNT(*)::int`,
      portions: sql<number>`COALESCE(SUM(${perOrder.portions}), 0)::int`,
      food: sql<number>`COALESCE(SUM(${perOrder.food}), 0)::bigint`,
    })
    .from(perOrder)
    .groupBy(perOrder.merchantId);
  const stat = new Map(byWarung.map((r) => [r.merchantId, r]));

  const day = sql<string>`to_char(${perOrder.pickedUpAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;
  const daily = await db
    .select({
      date: day,
      portions: sql<number>`COALESCE(SUM(${perOrder.portions}), 0)::int`,
      food: sql<number>`COALESCE(SUM(${perOrder.food}), 0)::bigint`,
    })
    .from(perOrder)
    .groupBy(day)
    .orderBy(day);

  const leftoverRows = await pilotLeftoverTotals(db);
  const leftover = new Map(leftoverRows.map((r) => [r.merchantId, r]));
  const sum = (key: "donated" | "animal_feed" | "compost" | "discarded" | "nights") =>
    leftoverRows.reduce((acc, r) => acc + r[key], 0);
  // Waste reduction only over warung that gave a baseline, so both sides cover the same nights.
  // Like for like: the baseline is portions usually thrown away per night, compared with the
  // portions reported as discarded (not with everything left over).
  let baselineNights = 0;
  let discardedWithBaseline = 0;
  for (const p of pilots) {
    const l = leftover.get(p.id);
    if (p.baseline === null || !l) continue;
    baselineNights += p.baseline * l.nights;
    discardedWithBaseline += l.discarded;
  }

  return {
    started_at: pilots.find((p) => p.joinedAt)?.joinedAt?.toISOString() ?? null,
    warung_count: pilots.length,
    orders_completed: t?.orders ?? 0,
    portions_rescued: t?.portions ?? 0,
    food_saved_grams: Number(t?.food ?? 0),
    co2_avoided_grams: Number(t?.co2 ?? 0),
    money_saved_idr: Number(t?.saved ?? 0),
    warung_revenue_idr: Number(t?.revenue ?? 0),
    unique_buyers: t?.buyers ?? 0,
    leftovers: {
      nights_reported: sum("nights"),
      donated: sum("donated"),
      animal_feed: sum("animal_feed"),
      compost: sum("compost"),
      discarded: sum("discarded"),
      waste_reduction_pct: wasteReductionPct(baselineNights, discardedWithBaseline),
    },
    warung: pilots.map((p) => {
      const s = stat.get(p.id);
      const l = leftover.get(p.id);
      const nights = l?.nights ?? 0;
      return {
        name: p.name,
        slug: p.slug,
        joined_at: (p.joinedAt ?? new Date(0)).toISOString(),
        orders_completed: s?.orders ?? 0,
        portions_rescued: s?.portions ?? 0,
        food_saved_grams: Number(s?.food ?? 0),
        baseline_leftover_portions: p.baseline,
        nights_reported: nights,
        discarded_per_night: l && nights > 0 ? Math.round((l.discarded / nights) * 10) / 10 : null,
        waste_reduction_pct: p.baseline !== null && l ? wasteReductionPct(p.baseline * nights, l.discarded) : null,
      };
    }),
    daily: daily.map((d) => ({ date: d.date, portions_rescued: d.portions, food_saved_grams: Number(d.food) })),
  };
}
