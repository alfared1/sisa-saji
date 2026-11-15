import { connection } from "next/server";
import { getDb } from "@/db";
import { MerchantReviewsQuery, type MerchantReviewsResponse } from "@/lib/contracts";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok, parseQuery } from "@/server/http";
import { listMerchantReviews } from "@/server/services/merchant/reviews";

/** GET /api/v1/merchant/reviews?filter=all|unreplied|low — owner. */
export const GET = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const q = parseQuery(req, MerchantReviewsQuery);
  return ok<MerchantReviewsResponse>(await listMerchantReviews(getDb(), merchantId, q));
});
