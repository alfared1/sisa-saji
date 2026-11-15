import { connection } from "next/server";
import { getDb } from "@/db";
import { MerchantTicketCancelBody, type OrderResponse } from "@/lib/contracts";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { cancelOrderByMerchant } from "@/server/services/orders/cancel-request";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/merchant/orders/:id/cancel — the warung cancels an open, unpaid "bayar di
 * warung" ticket ({ reason: "NO_SHOW" | "OUT_OF_STOCK" }; the portions go back to the batch),
 * or a paid online order whose food ran out ({ reason: "OUT_OF_STOCK" }; full refund).
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const id = parseUuid((await params).id, "Pesanan");
  const body = await parseJson(req, MerchantTicketCancelBody);
  const order = await cancelOrderByMerchant(getDb(), { merchantId, orderId: id, reason: body.reason });
  return ok<OrderResponse>({ order });
});
