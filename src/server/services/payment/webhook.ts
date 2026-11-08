/**
 * Payment webhook (gateway → server). The simulator (simulate-payment) signs a body
 * with the same secret and goes through `receivePaymentWebhook` too, so the demo
 * exercises the real code path.
 *
 * Signature: header `x-signature` = hex HMAC-SHA512(raw body, PAYMENT_WEBHOOK_SECRET).
 */
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, orders } from "@/db/schema";
import { PaymentWebhookBody, type OrderStatus } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { abandonPendingOrder, commitReservation } from "@/server/services/stock";
import { isPushEnabled, sendPushToUsers } from "@/server/services/push";

export const LATE_PAYMENT_REASON = "Pembayaran diterima setelah kedaluwarsa — perlu refund";

export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[0-9a-fA-F]{128}$/.test(signature.trim())) return false;
  const given = Buffer.from(signature.trim().toLowerCase(), "hex");
  const expected = Buffer.from(signWebhookBody(rawBody, secret), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function newGatewayRef(): string {
  return `SIM-${randomBytes(8).toString("hex").toUpperCase()}`;
}

export type WebhookOutcome = {
  order_id: string;
  status: OrderStatus;
  /** False when the webhook was a duplicate / no state change happened. */
  changed: boolean;
};

/** Applies a verified webhook body. Idempotent. */
export async function processPaymentWebhook(
  db: Db,
  body: PaymentWebhookBody,
  now: Date = new Date(),
): Promise<WebhookOutcome> {
  const outcome = await db.transaction(async (tx): Promise<WebhookOutcome & { notifyMerchant?: string }> => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, body.order_id)).for("update").limit(1);
    if (!order) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");

    if (order.status !== "PENDING_PAYMENT") {
      if (body.status === "PAID" && (order.status === "EXPIRED" || order.status === "CANCELLED")) {
        if (order.cancelReason !== LATE_PAYMENT_REASON) {
          console.warn(
            `[payment] PAID webhook for ${order.status} order ${order.orderNumber} (ref ${body.gateway_ref}); flagged for refund`,
          );
          await tx
            .update(orders)
            .set({ cancelReason: LATE_PAYMENT_REASON, paymentGatewayRef: body.gateway_ref, updatedAt: now })
            .where(eq(orders.id, order.id));
          return { order_id: order.id, status: order.status, changed: true };
        }
      }
      return { order_id: order.id, status: order.status, changed: false };
    }

    if (body.status === "PAID") {
      if (body.amount_idr !== order.totalCustomerPaidIdr) {
        throw new ApiError("VALIDATION_ERROR", "Jumlah pembayaran tidak sesuai dengan total pesanan", {
          expected_amount_idr: order.totalCustomerPaidIdr,
          received_amount_idr: body.amount_idr,
        });
      }
      await tx
        .update(orders)
        .set({ status: "READY_FOR_PICKUP", paidAt: now, paymentGatewayRef: body.gateway_ref, updatedAt: now })
        .where(eq(orders.id, order.id));
      await commitReservation(tx, order.id, now);
      return { order_id: order.id, status: "READY_FOR_PICKUP", changed: true, notifyMerchant: order.merchantId };
    }

    const target = body.status === "FAILED" ? "CANCELLED" : "EXPIRED";
    const reason = body.status === "FAILED" ? "Pembayaran gagal" : "Pembayaran kedaluwarsa";
    const changed = await abandonPendingOrder(tx, order.id, target, reason, now);
    return { order_id: order.id, status: changed ? target : order.status, changed };
  });

  if (outcome.notifyMerchant && isPushEnabled()) {
    void notifyMerchantPaid(db, outcome.order_id);
  }
  return { order_id: outcome.order_id, status: outcome.status, changed: outcome.changed };
}

async function notifyMerchantPaid(db: Db, orderId: string) {
  try {
    const [row] = await db
      .select({ ownerId: merchants.ownerUserId, orderNumber: orders.orderNumber })
      .from(orders)
      .innerJoin(merchants, eq(merchants.id, orders.merchantId))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row) return;
    await sendPushToUsers(db, [row.ownerId], {
      title: "Pesanan baru dibayar",
      body: `Pesanan ${row.orderNumber} siap diambil pembeli. Siapkan porsinya, ya!`,
      url: "/merchant/dashboard",
      tag: `order-${orderId}`,
    });
  } catch (err) {
    console.warn("[payment] merchant notification failed", err instanceof Error ? err.message : err);
  }
}

/** Verifies the signature, validates the body and applies it — used by the webhook route AND the simulator. */
export async function receivePaymentWebhook(
  db: Db,
  rawBody: string,
  signature: string | null,
  secret: string,
  now: Date = new Date(),
): Promise<WebhookOutcome> {
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    throw new ApiError("INVALID_SIGNATURE", "Signature webhook tidak valid");
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Body webhook harus berupa JSON yang valid");
  }
  const parsed = PaymentWebhookBody.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Body webhook tidak valid",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return processPaymentWebhook(db, parsed.data, now);
}
