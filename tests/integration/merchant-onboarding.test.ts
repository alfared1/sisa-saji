import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { menus, merchants, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { MenuCreateBody, MenuUpdateBody, MerchantOnboardingBody, MerchantUpdateBody } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { createMenu, updateMenu } from "@/server/services/merchant/menus";
import {
  getMerchantMe,
  normalizePhone,
  onboardMerchant,
  updateMerchant,
  upgradeSubscription,
  expireSubscriptions,
} from "@/server/services/merchant/profile";
import { DAY_MS } from "@/lib/time";
import { reseed, testDb } from "../helpers/db";

const { db, close } = testDb();

async function newUser(email: string) {
  const [u] = await db.insert(users).values({ fullName: "Pak Budi", email }).returning();
  return u;
}

async function demoMerchant() {
  const [row] = await db
    .select({ merchant: merchants })
    .from(merchants)
    .innerJoin(users, eq(users.id, merchants.ownerUserId))
    .where(eq(users.email, "demo.mitra@sisasaji.test"));
  return row.merchant;
}

async function expectApiError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe(code);
  return err as ApiError;
}

const onboarding = MerchantOnboardingBody.parse({
  merchant_name: "Warung Pak Budi Sendowo",
  address: "Jl. Sendowo No. 12, Sleman",
  lat: -7.7675,
  lng: 110.3768,
  whatsapp_number: "081234567890",
});

beforeAll(async () => {
  await reseed(db);
});
afterAll(close);

describe("normalizePhone", () => {
  it("normalises 08…, 628… and +628… to +628…", () => {
    expect(normalizePhone("081234567890")).toBe("+6281234567890");
    expect(normalizePhone("6281234567890")).toBe("+6281234567890");
    expect(normalizePhone("+6281234567890")).toBe("+6281234567890");
  });
});

describe("merchant onboarding", () => {
  it("creates the warung with a slug, +62 WhatsApp and defaults, and makes the user a MERCHANT", async () => {
    const user = await newUser("budi.onboard@sisasaji.test");
    const res = await onboardMerchant(db, user.id, onboarding);
    expect(res.merchant.slug).toBe("warung-pak-budi-sendowo");
    expect(res.merchant.whatsapp_number).toBe("+6281234567890");
    expect(res.merchant.operational_open_time).toBe("09:00");
    expect(res.merchant.default_surplus_start_time).toBe("20:00");
    expect(res.merchant.subscription_tier).toBe("REGULAR");
    expect(res.merchant.merchant_verified).toBe(false);
    expect(res.menus).toEqual([]);
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u.role).toBe("MERCHANT");
  });

  it("returns 409 CONFLICT when the user already has a warung", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "budi.onboard@sisasaji.test"));
    const err = await expectApiError(onboardMerchant(db, u.id, onboarding), "CONFLICT");
    expect(err.status).toBe(409);
  });

  it("makes the slug unique when the name is taken", async () => {
    const other = await newUser("budi.kembar@sisasaji.test");
    const res = await onboardMerchant(db, other.id, onboarding);
    expect(res.merchant.slug).toBe("warung-pak-budi-sendowo-2");
  });

  it("PATCH /merchant/me updates fields but keeps the slug stable", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "budi.onboard@sisasaji.test"));
    const [m] = await db.select().from(merchants).where(eq(merchants.ownerUserId, u.id));
    const res = await updateMerchant(
      db,
      m.id,
      MerchantUpdateBody.parse({ merchant_name: "Warung Budi Baru", is_open: false, whatsapp_number: "6285700001111", default_surplus_start_time: "19:30" }),
    );
    expect(res.merchant.merchant_name).toBe("Warung Budi Baru");
    expect(res.merchant.slug).toBe("warung-pak-budi-sendowo");
    expect(res.merchant.is_open).toBe(false);
    expect(res.merchant.whatsapp_number).toBe("+6285700001111");
    expect(res.merchant.default_surplus_start_time).toBe("19:30");
  });

  it("GET /merchant/me returns the demo warung with its menus", async () => {
    const m = await demoMerchant();
    const me = await getMerchantMe(db, m.id);
    expect(me.merchant.slug).toBe(DEMO_MERCHANT_SLUG);
    expect(me.menus.length).toBeGreaterThan(0);
    for (const menu of me.menus) {
      expect(menu.min_recovery_price_idr).toBeLessThanOrEqual(menu.original_price_idr);
    }
  });

  it("GET /merchant/me exposes payout details for prefill but only a masked account number", async () => {
    const m = await demoMerchant();
    const me = await getMerchantMe(db, m.id);
    expect(me.merchant.bank_code).toBe(m.bankCode);
    expect(me.merchant.bank_account_holder).toBe(m.bankAccountHolder);
    expect(me.merchant.bank_account_number_masked).toBe(`••••${m.bankAccountNumber!.slice(-4)}`);
    // The full number is write-only: it never appears anywhere in the response.
    expect(JSON.stringify(me)).not.toContain(m.bankAccountNumber!);
    expect(me.merchant).not.toHaveProperty("bank_account_number");
  });

  it("PATCH /merchant/me updates payout details; unset details come back as null", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "budi.onboard@sisasaji.test"));
    const [m] = await db.select().from(merchants).where(eq(merchants.ownerUserId, u.id));
    const before = await getMerchantMe(db, m.id);
    expect(before.merchant.bank_code).toBeNull();
    expect(before.merchant.bank_account_holder).toBeNull();
    expect(before.merchant.bank_account_number_masked).toBeNull();

    const res = await updateMerchant(
      db,
      m.id,
      MerchantUpdateBody.parse({ bank_code: "BRI", bank_account_number: "0123456789", bank_account_holder: "Budi Santoso" }),
    );
    expect(res.merchant.bank_code).toBe("BRI");
    expect(res.merchant.bank_account_holder).toBe("Budi Santoso");
    expect(res.merchant.bank_account_number_masked).toBe("••••6789");
    expect(JSON.stringify(res)).not.toContain("0123456789");
    const [row] = await db.select().from(merchants).where(eq(merchants.id, m.id));
    expect(row.bankAccountNumber).toBe("0123456789");

    // A profile save without a new number (prefilled code + holder only) keeps the stored number.
    const again = await updateMerchant(db, m.id, MerchantUpdateBody.parse({ bank_code: "BRI", bank_account_holder: "Budi S." }));
    expect(again.merchant.bank_account_number_masked).toBe("••••6789");
    expect(again.merchant.bank_account_holder).toBe("Budi S.");
  });
});

describe("merchant menus", () => {
  it("creates a menu with defaults", async () => {
    const m = await demoMerchant();
    const menu = await createMenu(
      db,
      m.id,
      MenuCreateBody.parse({ menu_name: "Nasi Telur Balado", original_price_idr: 15000, min_recovery_price_idr: 5000 }),
    );
    expect(menu).toMatchObject({
      menu_name: "Nasi Telur Balado",
      category: "MAKANAN_BERAT",
      portion_weight_grams: 200,
      is_mystery_bag: false,
      is_active: true,
    });
  });

  it("rejects a floor above the normal price (create via zod, update via service)", async () => {
    expect(MenuCreateBody.safeParse({ menu_name: "X Menu", original_price_idr: 5000, min_recovery_price_idr: 6000 }).success).toBe(false);
    const m = await demoMerchant();
    const [menu] = await db.select().from(menus).where(eq(menus.merchantId, m.id)).limit(1);
    await expectApiError(
      updateMenu(db, m.id, menu.id, MenuUpdateBody.parse({ min_recovery_price_idr: menu.originalPriceIdr + 1000 })),
      "VALIDATION_ERROR",
    );
  });

  it("deactivates (no delete) and only touches its own menus", async () => {
    const m = await demoMerchant();
    const [own] = await db.select().from(menus).where(eq(menus.merchantId, m.id)).limit(1);
    const off = await updateMenu(db, m.id, own.id, MenuUpdateBody.parse({ is_active: false, menu_name: "Menu Lama" }));
    expect(off.is_active).toBe(false);
    expect(off.menu_name).toBe("Menu Lama");
    await updateMenu(db, m.id, own.id, MenuUpdateBody.parse({ is_active: true }));

    const foreignMenu = (await db.select().from(menus)).find((x) => x.merchantId !== m.id)!;
    const err = await expectApiError(updateMenu(db, m.id, foreignMenu.id, MenuUpdateBody.parse({ is_active: false })), "NOT_FOUND");
    expect(err.status).toBe(404);
  });
});

describe("premium subscription (simulated Rp 50.000)", () => {
  it("upgrades to PREMIUM + verified for 30 days and extends an active period", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "budi.kembar@sisasaji.test"));
    const [m] = await db.select().from(merchants).where(eq(merchants.ownerUserId, u.id));
    const now = new Date("2026-11-08T10:00:00Z");
    const first = await upgradeSubscription(db, m.id, now);
    expect(first.price_idr).toBe(50_000);
    expect(first.merchant.subscription_tier).toBe("PREMIUM");
    expect(first.merchant.merchant_verified).toBe(true);
    expect(Date.parse(first.merchant.subscription_expires_at!)).toBe(now.getTime() + 30 * DAY_MS);

    const second = await upgradeSubscription(db, m.id, new Date(now.getTime() + DAY_MS));
    expect(Date.parse(second.merchant.subscription_expires_at!)).toBe(now.getTime() + 60 * DAY_MS);

    // Lapsed periods fall back to REGULAR.
    expect(await expireSubscriptions(db, new Date(now.getTime() + 61 * DAY_MS))).toBeGreaterThanOrEqual(1);
    const me = await getMerchantMe(db, m.id);
    expect(me.merchant.subscription_tier).toBe("REGULAR");
    expect(me.merchant.merchant_verified).toBe(false);
  });
});
