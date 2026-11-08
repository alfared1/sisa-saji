import { connection } from "next/server";
import { getDb } from "@/db";
import { AnalyticsQuery, type AnalyticsResponse } from "@/lib/contracts";
import { handle, ok, parseQuery } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { getAnalytics } from "@/server/services/merchant/insights";

/** GET /api/v1/merchant/analytics?range_days=30 → AnalyticsResponse */
export const GET = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const { range_days } = parseQuery(req, AnalyticsQuery);
  const data: AnalyticsResponse = await getAnalytics(getDb(), merchantId, range_days);
  return ok(data);
});
