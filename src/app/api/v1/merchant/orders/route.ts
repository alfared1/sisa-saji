import { connection } from "next/server";
import { getDb } from "@/db";
import { MerchantOrdersQuery, type OrdersResponse } from "@/lib/contracts";
import { handle, ok, parseQuery } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { listMerchantOrders } from "@/server/services/merchant/dashboard";

/** GET /api/v1/merchant/orders?status=…|ACTIVE&date=YYYY-MM-DD (WIB)&limit → OrdersResponse */
export const GET = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const query = parseQuery(req, MerchantOrdersQuery);
  const data: OrdersResponse = await listMerchantOrders(getDb(), merchantId, query);
  return ok(data);
});
