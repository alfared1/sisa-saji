import { connection } from "next/server";
import { getDb } from "@/db";
import type { StaffResponse } from "@/lib/contracts";
import { assertDemoUnlocked, requireMerchant } from "@/server/auth/session";
import { handle, ok, parseUuid } from "@/server/http";
import { removeCashier } from "@/server/services/merchant/staff";

type Ctx = { params: Promise<{ userId: string }> };

/** DELETE /api/v1/merchant/staff/:userId — owner removes a cashier (their access ends at once). */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const userId = parseUuid((await params).userId, "Kasir");
  return ok<StaffResponse>(await removeCashier(getDb(), merchantId, userId));
});
