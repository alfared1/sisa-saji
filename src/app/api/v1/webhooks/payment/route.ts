import { connection } from "next/server";
import { getDb } from "@/db";
import { getPaymentWebhookSecret } from "@/lib/env";
import { handle, ok } from "@/server/http";
import { receivePaymentWebhook } from "@/server/services/payment/webhook";

/**
 * POST /api/v1/webhooks/payment — payment gateway → server.
 * Header `x-signature`: hex HMAC-SHA512 of the raw body. Idempotent.
 */
export const POST = handle(async (req) => {
  await connection();
  const raw = await req.text();
  const outcome = await receivePaymentWebhook(
    getDb(),
    raw,
    req.headers.get("x-signature"),
    getPaymentWebhookSecret(),
  );
  return ok({ received: true as const, ...outcome });
});
