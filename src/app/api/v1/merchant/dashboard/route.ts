import { connection } from "next/server";
import { getDb } from "@/db";
import type { MerchantDashboard } from "@/lib/contracts";
import { handle, ok } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { getMerchantDashboard } from "@/server/services/merchant/dashboard";

/** GET /api/v1/merchant/dashboard → MerchantDashboard */
export const GET = handle(async () => {
  await connection();
  const { merchantId } = await requireMerchant();
  const data: MerchantDashboard = await getMerchantDashboard(getDb(), merchantId);
  return ok(data);
});
