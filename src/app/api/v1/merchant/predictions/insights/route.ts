import { connection } from "next/server";
import { getDb } from "@/db";
import type { InsightsResponse } from "@/lib/contracts";
import { handle, ok } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { getInsights } from "@/server/services/merchant/insights";

/** GET /api/v1/merchant/predictions/insights → InsightsResponse */
export const GET = handle(async () => {
  await connection();
  const { merchantId } = await requireMerchant();
  const data: InsightsResponse = await getInsights(getDb(), merchantId);
  return ok(data);
});
