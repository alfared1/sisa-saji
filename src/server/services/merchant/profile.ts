/** Merchant onboarding, profile and premium subscription. */
import "server-only";
import { and, asc, desc, eq, like, lte, or } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { menus, merchants, users, type Merchant } from "@/db/schema";
import type { MerchantMeResponse, MerchantProfile } from "@/lib/contracts";
import type { MerchantOnboardingBody, MerchantUpdateBody } from "@/lib/contracts";
import { MERCHANT_PREMIUM_PRICE_IDR } from "@/lib/constants";
import { DAY_MS } from "@/lib/time";
import { ApiError } from "@/server/http";
import type { DbOrTx } from "@/server/services/stock";
import { toMenuView, toMerchantProfile } from "./views";

/** Parsed (defaults applied) request bodies. */
export type OnboardingInput = z.output<typeof MerchantOnboardingBody>;
export type MerchantUpdateInput = z.output<typeof MerchantUpdateBody>;

export const PREMIUM_PERIOD_DAYS = 30;

/** 08xx / 628xx / +628xx → +628xx. */
export function normalizePhone(raw: string): string {
  const digits = raw.trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("+62")) return digits;
  if (digits.startsWith("62")) return `+${digits}`;
  if (digits.startsWith("0")) return `+62${digits.slice(1)}`;
  return digits;
}

export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
  return s || "warung";
}

/** Unique slug: "warung-x", then "warung-x-2", "warung-x-3", … */
export async function uniqueSlug(db: DbOrTx, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set(
    (
      await db
        .select({ slug: merchants.slug })
        .from(merchants)
        .where(or(eq(merchants.slug, base), like(merchants.slug, `${base}-%`)))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const toTime = (hhmm: string) => `${hhmm}:00`;

export async function loadMerchant(db: Db, merchantId: string): Promise<Merchant> {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!m) throw new ApiError("MERCHANT_REQUIRED", "Warung tidak ditemukan", undefined, 404);
  return m;
}

export async function getMerchantMe(db: Db, merchantId: string): Promise<MerchantMeResponse> {
  const merchant = await loadMerchant(db, merchantId);
  const list = await db
    .select()
    .from(menus)
    .where(eq(menus.merchantId, merchantId))
    .orderBy(desc(menus.isActive), asc(menus.createdAt));
  return { merchant: toMerchantProfile(merchant), menus: list.map(toMenuView) };
}

/** Creates the warung for a logged-in user and makes them a MERCHANT (ADMIN keeps its role). */
export async function onboardMerchant(db: Db, userId: string, body: OnboardingInput): Promise<MerchantMeResponse> {
  const merchantId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.ownerUserId, userId))
      .limit(1);
    if (existing) throw new ApiError("CONFLICT", "Akun ini sudah memiliki warung");
    const [user] = await tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new ApiError("UNAUTHENTICATED", "Silakan masuk terlebih dahulu");

    const slug = await uniqueSlug(tx, body.merchant_name);
    const [created] = await tx
      .insert(merchants)
      .values({
        ownerUserId: userId,
        merchantName: body.merchant_name,
        slug,
        merchantCategory: body.merchant_category,
        description: body.description ?? null,
        address: body.address,
        whatsappNumber: normalizePhone(body.whatsapp_number),
        latitude: body.lat,
        longitude: body.lng,
        operationalOpenTime: toTime(body.operational_open_time),
        operationalCloseTime: toTime(body.operational_close_time),
        defaultSurplusStartTime: toTime(body.default_surplus_start_time),
        bankCode: body.bank_code ?? null,
        bankAccountNumber: body.bank_account_number ?? null,
        bankAccountHolder: body.bank_account_holder ?? null,
      })
      .returning({ id: merchants.id });
    if (user.role === "CUSTOMER") {
      await tx.update(users).set({ role: "MERCHANT" }).where(eq(users.id, userId));
    }
    return created.id;
  });
  return getMerchantMe(db, merchantId);
}

export async function updateMerchant(db: Db, merchantId: string, body: MerchantUpdateInput): Promise<MerchantMeResponse> {
  const set: Partial<typeof merchants.$inferInsert> = {};
  if (body.merchant_name !== undefined) set.merchantName = body.merchant_name; // slug stays stable
  if (body.merchant_category !== undefined) set.merchantCategory = body.merchant_category;
  if (body.description !== undefined) set.description = body.description;
  if (body.address !== undefined) set.address = body.address;
  if (body.lat !== undefined) set.latitude = body.lat;
  if (body.lng !== undefined) set.longitude = body.lng;
  if (body.whatsapp_number !== undefined) set.whatsappNumber = normalizePhone(body.whatsapp_number);
  if (body.operational_open_time !== undefined) set.operationalOpenTime = toTime(body.operational_open_time);
  if (body.operational_close_time !== undefined) set.operationalCloseTime = toTime(body.operational_close_time);
  if (body.default_surplus_start_time !== undefined) {
    set.defaultSurplusStartTime = toTime(body.default_surplus_start_time);
  }
  if (body.bank_code !== undefined) set.bankCode = body.bank_code;
  if (body.bank_account_number !== undefined) set.bankAccountNumber = body.bank_account_number;
  if (body.bank_account_holder !== undefined) set.bankAccountHolder = body.bank_account_holder;
  if (body.is_open !== undefined) set.isOpen = body.is_open;
  if (Object.keys(set).length) {
    await db.update(merchants).set(set).where(eq(merchants.id, merchantId));
  }
  return getMerchantMe(db, merchantId);
}

/**
 * Simulated Rp 50.000 payment → PREMIUM + "Mitra Terverifikasi" for 30 days.
 * An active premium period is extended by 30 days from its current end.
 */
export async function upgradeSubscription(
  db: Db,
  merchantId: string,
  now: Date = new Date(),
): Promise<{ merchant: MerchantProfile; price_idr: number }> {
  const m = await loadMerchant(db, merchantId);
  const activeUntil =
    m.subscriptionTier === "PREMIUM" && m.subscriptionExpiresAt && m.subscriptionExpiresAt > now
      ? m.subscriptionExpiresAt
      : now;
  const [updated] = await db
    .update(merchants)
    .set({
      subscriptionTier: "PREMIUM",
      merchantVerified: true,
      subscriptionExpiresAt: new Date(activeUntil.getTime() + PREMIUM_PERIOD_DAYS * DAY_MS),
      updatedAt: now,
    })
    .where(eq(merchants.id, merchantId))
    .returning();
  return { merchant: toMerchantProfile(updated), price_idr: MERCHANT_PREMIUM_PRICE_IDR };
}

/** Job: premium periods that ran out fall back to REGULAR (and lose the verified badge). */
export async function expireSubscriptions(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(merchants)
    .set({ subscriptionTier: "REGULAR", merchantVerified: false, updatedAt: now })
    .where(and(eq(merchants.subscriptionTier, "PREMIUM"), lte(merchants.subscriptionExpiresAt, now)))
    .returning({ id: merchants.id });
  return rows.length;
}

