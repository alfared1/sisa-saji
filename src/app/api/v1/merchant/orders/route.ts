import { connection } from "next/server";
import { getDb } from "@/db";
import { MerchantOrdersQuery, type OrdersResponse } from "@/lib/contracts";
import { handle, ok, parseQuery } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { listMerchantOrders } from "@/server/services/merchant/dashboard";
import { expireLapsedHolds } from "@/server/services/orders/hold";

/** GET /api/v1/merchant/orders?status=…|ACTIVE&date=YYYY-MM-DD (WIB)&limit → OrdersResponse */
export const GET = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const query = parseQuery(req, MerchantOrdersQuery);
  const db = getDb();
  // Lapsed "bayar di warung" tickets leave the queue even when no job has run yet.
  await expireLapsedHolds(db, { merchantId }, new Date());
  const data: OrdersResponse = await listMerchantOrders(db, merchantId, query);
  return ok(data);
});
