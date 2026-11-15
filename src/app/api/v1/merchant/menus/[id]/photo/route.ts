import { connection } from "next/server";
import { getDb } from "@/db";
import { BATCH_PHOTO_MAX_BYTES } from "@/lib/constants";
import type { MenuResponse } from "@/lib/contracts";
import { assertDemoUnlocked, requireMerchant } from "@/server/auth/session";
import { handle, ok, parseUuid, readImageBody } from "@/server/http";
import { removeMenuPhoto, uploadMenuPhoto } from "@/server/services/merchant/menu-photos";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/merchant/menus/:id/photo — owner: raw JPEG body (Content-Type: image/jpeg, at
 * most BATCH_PHOTO_MAX_BYTES) → { menu } (201). Replaces the menu's photo. 403 DEMO_LOCKED for
 * the shared demo warung (its menus are locked), 404 foreign menu, 413/415 bad image, 429 limit.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const menuId = parseUuid((await params).id, "Menu");
  const image = await readImageBody(req, BATCH_PHOTO_MAX_BYTES);
  const menu = await uploadMenuPhoto(getDb(), merchantId, menuId, { bytes: image.bytes, contentType: image.contentType });
  return ok<MenuResponse>({ menu }, { status: 201 });
});

/** DELETE /api/v1/merchant/menus/:id/photo — owner removes the menu's photo → { menu }. */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const menuId = parseUuid((await params).id, "Menu");
  return ok<MenuResponse>({ menu: await removeMenuPhoto(getDb(), merchantId, menuId) });
});
