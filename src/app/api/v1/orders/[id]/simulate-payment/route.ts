import { connection } from "next/server";
import { getDb } from "@/db";
import type { OrderResponse } from "@/lib/contracts";
import { getPaymentProvider, getPaymentWebhookSecret } from "@/lib/env";
import { requireUser } from "@/server/auth/session";
import { ApiError, handle, ok, parseUuid } from "@/server/http";
import { simulatePayment } from "@/server/services/orders/orders";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/orders/:id/simulate-payment — demo only (PAYMENT_PROVIDER=simulator). */
export const POST = handle<Ctx>(async (_req, { params }) => {
  await connection();
  if (getPaymentProvider() !== "simulator") {
    throw new ApiError("NOT_FOUND", "Simulasi pembayaran tidak tersedia");
  }
  const me = await requireUser();
  const id = parseUuid((await params).id, "Pesanan");
  const order = await simulatePayment(getDb(), {
    orderId: id,
    userId: me.id,
    webhookSecret: getPaymentWebhookSecret(),
  });
  return ok<OrderResponse>({ order });
});
