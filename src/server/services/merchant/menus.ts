/** Merchant menu catalogue. Menus are never deleted: deactivate with is_active=false. */
import "server-only";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { Db, Tx } from "@/db/client";
import { menus, surplusBatches, type Menu } from "@/db/schema";
import type { MenuCreateBody, MenuUpdateBody, MenuView } from "@/lib/contracts";
import { findItem, normalizeItems } from "@/lib/lauk";
import { ApiError } from "@/server/http";
import { toMenuView } from "./views";

export type MenuCreateInput = z.output<typeof MenuCreateBody>;
export type MenuUpdateInput = z.output<typeof MenuUpdateBody>;

/** The merchant's own menu, or 404 (other merchants' menus are invisible). */
export async function getOwnedMenu(db: Db, merchantId: string, menuId: string): Promise<Menu> {
  const [menu] = await db
    .select()
    .from(menus)
    .where(and(eq(menus.id, menuId), eq(menus.merchantId, merchantId)))
    .limit(1);
  if (!menu) throw new ApiError("NOT_FOUND", "Menu tidak ditemukan");
  return menu;
}

export async function createMenu(db: Db, merchantId: string, body: MenuCreateInput): Promise<MenuView> {
  const [menu] = await db
    .insert(menus)
    .values({
      merchantId,
      menuName: body.menu_name,
      category: body.category,
      description: body.description ?? null,
      imageUrl: body.image_url ?? null,
      originalPriceIdr: body.original_price_idr,
      minRecoveryPriceIdr: body.min_recovery_price_idr,
      portionWeightGrams: body.portion_weight_grams,
      contents: normalizeItems(body.contents),
      laukOptions: normalizeItems(body.lauk_options),
      // Closed surprise items are no longer created (MenuCreateBody refuses them too).
      isMysteryBag: false,
    })
    .returning();
  return toMenuView(menu);
}

const MYSTERY_REMOVED_MESSAGE = "Paket kejutan tidak tersedia lagi. Tulis isi porsinya.";
const CONTENTS_REQUIRED_MESSAGE = "Tulis minimal satu isi porsi";

export async function updateMenu(
  db: Db,
  merchantId: string,
  menuId: string,
  body: MenuUpdateInput,
): Promise<MenuView> {
  const menu = await getOwnedMenu(db, merchantId, menuId);
  const original = body.original_price_idr ?? menu.originalPriceIdr;
  const floor = body.min_recovery_price_idr ?? menu.minRecoveryPriceIdr;
  if (floor > original) {
    throw new ApiError("VALIDATION_ERROR", "Harga minimum tidak boleh melebihi harga normal", [
      { path: "min_recovery_price_idr", message: "Harga minimum tidak boleh melebihi harga normal" },
    ]);
  }
  const set: Partial<typeof menus.$inferInsert> = {};
  if (body.menu_name !== undefined) set.menuName = body.menu_name;
  if (body.category !== undefined) set.category = body.category;
  if (body.description !== undefined) set.description = body.description;
  if (body.image_url !== undefined) set.imageUrl = body.image_url;
  if (body.original_price_idr !== undefined) set.originalPriceIdr = body.original_price_idr;
  if (body.min_recovery_price_idr !== undefined) set.minRecoveryPriceIdr = body.min_recovery_price_idr;
  if (body.portion_weight_grams !== undefined) set.portionWeightGrams = body.portion_weight_grams;
  if (body.contents !== undefined) set.contents = normalizeItems(body.contents);
  if (body.lauk_options !== undefined) set.laukOptions = normalizeItems(body.lauk_options);
  if (body.is_active !== undefined) set.isActive = body.is_active;

  // Menus created before contents existed may stay empty (they can still be published), but
  // an edit that touches the lists may not leave both empty.
  const contents = set.contents ?? menu.contents;
  const laukOptions = set.laukOptions ?? menu.laukOptions;
  const listed = contents.length + laukOptions.length > 0;
  if ((set.contents !== undefined || set.laukOptions !== undefined) && !listed) {
    throw new ApiError("VALIDATION_ERROR", CONTENTS_REQUIRED_MESSAGE, [
      { path: "contents", message: CONTENTS_REQUIRED_MESSAGE },
    ]);
  }
  // An old surprise menu becomes a normal one once it lists its contents and leaves the
  // MYSTERY_BAG category; until then it cannot be switched back on.
  const category = set.category ?? menu.category;
  if (menu.isMysteryBag || menu.category === "MYSTERY_BAG") {
    if (listed && category !== "MYSTERY_BAG") set.isMysteryBag = false;
    else if (set.isActive ?? menu.isActive) {
      throw new ApiError("VALIDATION_ERROR", MYSTERY_REMOVED_MESSAGE, [{ path: "contents", message: MYSTERY_REMOVED_MESSAGE }]);
    }
  }
  if (!Object.keys(set).length) return toMenuView(menu);
  const newLauk = set.laukOptions;
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(menus).set(set).where(eq(menus.id, menu.id)).returning();
    if (newLauk !== undefined) await reconcileLiveLauk(tx, menu.id, menu.laukOptions, newLauk, new Date());
    return row;
  });
  return toMenuView(updated);
}

/**
 * Keeps tonight's lauk of the menu's live batches a subset of its new options (stored in the
 * new casing and order): removed lauk go, lauk still available tonight stay, lauk new to the
 * menu (a fixed typo too) become available, and lauk the warung switched off tonight stay
 * off. When nothing would be left on a menu that still has options, all of them become
 * available. Without this a renamed or removed lauk would stay orderable until the batch
 * ends. updated_at moves so live listeners refetch.
 */
async function reconcileLiveLauk(
  tx: Tx,
  menuId: string,
  previousOptions: readonly string[],
  laukOptions: readonly string[],
  now: Date,
) {
  const live = await tx
    .select({ id: surplusBatches.id, laukAvailable: surplusBatches.laukAvailable })
    .from(surplusBatches)
    .where(
      and(
        eq(surplusBatches.menuId, menuId),
        inArray(surplusBatches.status, ["ACTIVE", "SCHEDULED", "SOLD_OUT"]),
        gt(surplusBatches.pickupEndTime, now),
      ),
    );
  for (const b of live) {
    const kept = laukOptions.filter(
      (option) => findItem(b.laukAvailable, option) !== null || findItem(previousOptions, option) === null,
    );
    const next = kept.length === 0 ? [...laukOptions] : kept;
    if (next.length === b.laukAvailable.length && next.every((v, i) => v === b.laukAvailable[i])) continue;
    await tx.update(surplusBatches).set({ laukAvailable: next, updatedAt: now }).where(eq(surplusBatches.id, b.id));
  }
}
