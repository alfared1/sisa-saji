import { connection } from "next/server";
import { getDb } from "@/db";
import type { OrderResponse } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok, parseUuid } from "@/server/http";
import { cancelOrder } from "@/server/services/orders/orders";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/orders/:id/cancel — customer, only PENDING_PAYMENT. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  await connection();
  const me = await requireUser();
  const id = parseUuid((await params).id, "Pesanan");
  return ok<OrderResponse>({ order: await cancelOrder(getDb(), id, me.id) });
});
