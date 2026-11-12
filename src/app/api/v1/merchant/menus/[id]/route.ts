import { connection } from "next/server";
import { getDb } from "@/db";
import { MenuUpdateBody, type MenuView } from "@/lib/contracts";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { assertDemoUnlocked, requireMerchant } from "@/server/auth/session";
import { updateMenu } from "@/server/services/merchant/menus";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/merchant/menus/:id → { menu: MenuView }. No delete: deactivate with is_active=false.
 * 403 for the shared demo warung.
 */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const id = parseUuid((await params).id, "Menu");
  const body = await parseJson(req, MenuUpdateBody);
  const menu: MenuView = await updateMenu(getDb(), merchantId, id, body);
  return ok({ menu });
});
