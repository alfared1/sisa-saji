import { connection } from "next/server";
import { getDb } from "@/db";
import { PickupLookupBody, type OrderResponse } from "@/lib/contracts";
import { getPickupQrSecret } from "@/lib/env";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { lookupPickup } from "@/server/services/orders/pickup";

/** POST /api/v1/orders/lookup-pickup — merchant; by 4-digit code ("SJ-1234" too) or QR token. */
export const POST = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const body = await parseJson(req, PickupLookupBody);
  const order = await lookupPickup(getDb(), {
    merchantId,
    input: body.pickup_code_or_qr_token,
    pickupQrSecret: getPickupQrSecret(),
  });
  return ok<OrderResponse>({ order });
});
