import { connection } from "next/server";
import { getDb } from "@/db";
import { MenuCreateBody, type MenuView } from "@/lib/contracts";
import { handle, ok, parseJson } from "@/server/http";
import { assertDemoUnlocked, requireMerchant } from "@/server/auth/session";
import { createMenu } from "@/server/services/merchant/menus";

/** POST /api/v1/merchant/menus → { menu: MenuView } (201). 403 for the shared demo warung. */
export const POST = handle(async (req) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const body = await parseJson(req, MenuCreateBody);
  const menu: MenuView = await createMenu(getDb(), merchantId, body);
  return ok({ menu }, { status: 201 });
});
