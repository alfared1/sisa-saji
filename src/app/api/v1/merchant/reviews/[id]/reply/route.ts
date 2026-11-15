import { connection } from "next/server";
import { getDb } from "@/db";
import { ReviewReplyBody, type ReviewReplyResponse } from "@/lib/contracts";
import { assertDemoUnlocked, requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { replyToReview } from "@/server/services/merchant/reviews";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/v1/merchant/reviews/:id/reply — owner: { reply } (empty removes it). The reply is
 * public under the review, so the shared demo warung is locked (403 DEMO_LOCKED).
 */
export const PUT = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const reviewId = parseUuid((await params).id, "Ulasan");
  const body = await parseJson(req, ReviewReplyBody);
  return ok<ReviewReplyResponse>({ review: await replyToReview(getDb(), { merchantId, reviewId, reply: body.reply }) });
});
