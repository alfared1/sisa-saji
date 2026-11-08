import { connection } from "next/server";
import { getDb } from "@/db";
import { VerifyPickupBody, type OrderResponse } from "@/lib/contracts";
import { getPickupQrSecret } from "@/lib/env";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { verifyPickup } from "@/server/services/orders/pickup";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/orders/:id/verify-pickup — merchant; READY_FOR_PICKUP → COMPLETED. */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const id = parseUuid((await params).id, "Pesanan");
  const body = await parseJson(req, VerifyPickupBody);
  const order = await verifyPickup(getDb(), {
    merchantId,
    orderId: id,
    input: body.pickup_code_or_qr_token,
    proofImageUrl: body.proof_image_url,
    pickupQrSecret: getPickupQrSecret(),
  });
  return ok<OrderResponse>({ order });
});
