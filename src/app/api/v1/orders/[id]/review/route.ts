import { connection } from "next/server";
import { getDb } from "@/db";
import { ReviewBody, type OrderResponse } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { reviewOrder } from "@/server/services/orders/orders";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/orders/:id/review — customer, only COMPLETED, once. */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const me = await requireUser();
  const id = parseUuid((await params).id, "Pesanan");
  const input = await parseJson(req, ReviewBody);
  return ok<OrderResponse>({ order: await reviewOrder(getDb(), { orderId: id, userId: me.id, input }) });
});
