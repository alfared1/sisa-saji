/** Merchant menu catalogue. Menus are never deleted: deactivate with is_active=false. */
import "server-only";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { menus, type Menu } from "@/db/schema";
import type { MenuCreateBody, MenuUpdateBody, MenuView } from "@/lib/contracts";
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
      isMysteryBag: body.is_mystery_bag,
    })
    .returning();
  return toMenuView(menu);
}

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
  if (body.is_mystery_bag !== undefined) set.isMysteryBag = body.is_mystery_bag;
  if (body.is_active !== undefined) set.isActive = body.is_active;
  if (!Object.keys(set).length) return toMenuView(menu);
  const [updated] = await db.update(menus).set(set).where(eq(menus.id, menu.id)).returning();
  return toMenuView(updated);
}
