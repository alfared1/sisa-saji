import { connection } from "next/server";
import { getDb } from "@/db";
import { CheckoutBody, type CheckoutResponse } from "@/lib/contracts";
import { getPickupQrSecret } from "@/lib/env";
import { requireUser } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { checkout } from "@/server/services/orders/checkout";

/** POST /api/v1/orders/checkout — reserves stock for PAYMENT_TTL_SECONDS and returns the QRIS. */
export const POST = handle(async (req) => {
  await connection();
  const me = await requireUser();
  const input = await parseJson(req, CheckoutBody);
  const order = await checkout(getDb(), { userId: me.id, input, pickupQrSecret: getPickupQrSecret() });
  return ok<CheckoutResponse>({ order }, { status: 201 });
});
