import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { menus, merchants, surplusBatches, users } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { MenuCreateBody, MenuUpdateBody, MerchantOnboardingBody, MerchantUpdateBody, PublishBody } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { createMenu, updateMenu } from "@/server/services/merchant/menus";
import { publishSurplus } from "@/server/services/merchant/surplus";
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
  const MENU = { menu_name: "Nasi Telur Balado", original_price_idr: 15000, min_recovery_price_idr: 5000 };
  /** A listed menu of the demo warung (old surprise menus are skipped). */
  async function ownListedMenu(merchantId: string) {
    const [own] = await db
      .select()
      .from(menus)
      .where(and(eq(menus.merchantId, merchantId), eq(menus.isMysteryBag, false), ne(menus.category, "MYSTERY_BAG")))
      .limit(1);
    return own;
  }

  it("creates a menu with defaults and normalised contents and lauk", async () => {
    const m = await demoMerchant();
    const menu = await createMenu(
      db,
      m.id,
      MenuCreateBody.parse({
        ...MENU,
        contents: [" Nasi putih ", "Telur   balado", "Sambal"],
        lauk_options: ["Tempe orek", "Perkedel"],
      }),
    );
    expect(menu).toMatchObject({
      menu_name: "Nasi Telur Balado",
      category: "MAKANAN_BERAT",
      portion_weight_grams: 200,
      contents: ["Nasi putih", "Telur balado", "Sambal"],
      lauk_options: ["Tempe orek", "Perkedel"],
      is_active: true,
    });
    const [row] = await db.select().from(menus).where(eq(menus.id, menu.id));
    expect(row.isMysteryBag).toBe(false);
    // Lauk only (no fixed contents) is a listed menu too.
    expect(MenuCreateBody.safeParse({ ...MENU, lauk_options: ["Ayam goreng"] }).success).toBe(true);
  });

  it("requires contents for a new menu and refuses surprise menus and repeats", async () => {
    const issue = (body: Record<string, unknown>) => {
      const r = MenuCreateBody.safeParse({ ...MENU, contents: ["Nasi putih"], ...body });
      expect(r.success).toBe(false);
      return r.error?.issues[0]?.message;
    };
    expect(issue({ contents: [] })).toBe("Tulis minimal satu isi porsi");
    expect(issue({ category: "MYSTERY_BAG" })).toBe("Paket kejutan tidak tersedia lagi. Tulis isi porsinya.");
    expect(issue({ is_mystery_bag: true })).toBe("Paket kejutan tidak tersedia lagi. Tulis isi porsinya.");
    expect(issue({ contents: ["Nasi putih", "nasi PUTIH"] })).toBe("Ada isi yang sama dua kali");
    expect(issue({ lauk_options: Array.from({ length: 9 }, (_, i) => `Lauk ${i}`) })).toBe("Paling banyak 8 pilihan lauk");
    expect(issue({ contents: ["x".repeat(41)] })).toBe("Maksimal 40 karakter");
    expect(MenuUpdateBody.safeParse({ category: "MYSTERY_BAG" }).success).toBe(false);
    expect(MenuUpdateBody.safeParse({ is_mystery_bag: true }).success).toBe(false);
  });

  it("an edit may not leave a menu without contents and lauk", async () => {
    const m = await demoMerchant();
    const menu = await createMenu(db, m.id, MenuCreateBody.parse({ ...MENU, contents: ["Nasi putih"] }));
    await expectApiError(updateMenu(db, m.id, menu.id, MenuUpdateBody.parse({ contents: [] })), "VALIDATION_ERROR");
    const swapped = await updateMenu(db, m.id, menu.id, MenuUpdateBody.parse({ contents: [], lauk_options: ["Ayam goreng"] }));
    expect(swapped).toMatchObject({ contents: [], lauk_options: ["Ayam goreng"] });
  });

  it("editing the lauk options keeps tonight's lauk of live batches a subset of them", async () => {
    const m = await demoMerchant();
    const menu = await createMenu(
      db,
      m.id,
      MenuCreateBody.parse({ ...MENU, contents: ["Nasi putih"], lauk_options: ["Ayam gorng", "Tempe orek", "Perkedel"] }),
    );
    const { batch } = await publishSurplus(
      db,
      m.id,
      PublishBody.parse({
        menu_id: menu.id,
        initial_stock: 5,
        pickup_end_time: new Date(Date.now() + 120 * 60_000).toISOString(),
        lauk_available: ["Ayam gorng", "Tempe orek"],
      }),
    );
    const tonight = async () =>
      (await db.select({ lauk: surplusBatches.laukAvailable }).from(surplusBatches).where(eq(surplusBatches.id, batch.id)))[0]
        .lauk;

    // A fixed typo is a new lauk (available); "Perkedel", switched off tonight, stays off.
    await updateMenu(db, m.id, menu.id, MenuUpdateBody.parse({ lauk_options: ["Ayam goreng", "Tempe orek", "Perkedel"] }));
    expect(await tonight()).toEqual(["Ayam goreng", "Tempe orek"]);
    // Removing every lauk that was left tonight opens the remaining options instead of none.
    await updateMenu(db, m.id, menu.id, MenuUpdateBody.parse({ lauk_options: ["Perkedel"] }));
    expect(await tonight()).toEqual(["Perkedel"]);
    // A fixed menu (no lauk) leaves no lauk to pick.
    await updateMenu(db, m.id, menu.id, MenuUpdateBody.parse({ lauk_options: [] }));
    expect(await tonight()).toEqual([]);
  });

  it("an old surprise menu stays off until it lists its contents in a normal category", async () => {
    const m = await demoMerchant();
    const [old] = await db
      .insert(menus)
      .values({
        merchantId: m.id,
        menuName: "Paket lama",
        category: "MYSTERY_BAG",
        isMysteryBag: true,
        isActive: false,
        originalPriceIdr: 20000,
        minRecoveryPriceIdr: 10000,
      })
      .returning();
    await expectApiError(updateMenu(db, m.id, old.id, MenuUpdateBody.parse({ is_active: true })), "VALIDATION_ERROR");
    const renamed = await updateMenu(db, m.id, old.id, MenuUpdateBody.parse({ menu_name: "Paket Nasi Liwet" }));
    expect(renamed.is_active).toBe(false);
    const listed = await updateMenu(
      db,
      m.id,
      old.id,
      MenuUpdateBody.parse({ category: "MAKANAN_BERAT", contents: ["Nasi liwet", "Ayam suwir"], is_active: true }),
    );
    expect(listed).toMatchObject({ category: "MAKANAN_BERAT", is_active: true, contents: ["Nasi liwet", "Ayam suwir"] });
    const [row] = await db.select().from(menus).where(eq(menus.id, old.id));
    expect(row.isMysteryBag).toBe(false);
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
    const own = await ownListedMenu(m.id);
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
