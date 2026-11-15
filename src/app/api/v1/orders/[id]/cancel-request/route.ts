import { connection } from "next/server";
import { getDb } from "@/db";
import { CancelRequestBody, type OrderResponse } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { requestCancel } from "@/server/services/orders/cancel-request";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/orders/:id/cancel-request — customer asks the warung to cancel a paid online
 * order ({ reason, note? }). The warung approves (full refund) or rejects it.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const me = await requireUser();
  const id = parseUuid((await params).id, "Pesanan");
  const body = await parseJson(req, CancelRequestBody);
  const order = await requestCancel(getDb(), { orderId: id, userId: me.id, reason: body.reason, note: body.note });
  return ok<OrderResponse>({ order });
});
