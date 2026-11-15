import { connection } from "next/server";
import { getDb } from "@/db";
import { CancelRequestDecisionBody, type OrderResponse } from "@/lib/contracts";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { respondToCancelRequest } from "@/server/services/orders/cancel-request";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/merchant/orders/:id/cancel-request — the warung answers the buyer's pending
 * cancel request: { decision: "APPROVE" } or { decision: "REJECT", note }.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const id = parseUuid((await params).id, "Pesanan");
  const body = await parseJson(req, CancelRequestDecisionBody);
  const order = await respondToCancelRequest(getDb(), { merchantId, orderId: id, decision: body.decision, note: body.note });
  return ok<OrderResponse>({ order });
});
