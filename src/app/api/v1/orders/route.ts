import { connection } from "next/server";
import { getDb } from "@/db";
import { OrderListQuery, type OrdersResponse } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok, parseQuery } from "@/server/http";
import { listCustomerOrders } from "@/server/services/orders/orders";

/** GET /api/v1/orders?status&limit — the customer's own orders, newest first. */
export const GET = handle(async (req) => {
  await connection();
  const me = await requireUser();
  const q = parseQuery(req, OrderListQuery);
  return ok<OrdersResponse>({ orders: await listCustomerOrders(getDb(), me.id, q) });
});
