/**
 * Merchant live feed (GET /api/v1/stream/merchant): polls the DB for this
 * merchant's orders that were paid / completed / asked to be cancelled and batches that changed since a
 * cursor. The route keeps a small window of overlap and dedupes by event key so a
 * write committed during a poll is not lost.
 */
import "server-only";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orderMessages, orders, surplusBatches } from "@/db/schema";
import type { MerchantStreamEvent } from "@/lib/contracts";

export interface KeyedEvent {
  key: string;
  at: number;
  event: MerchantStreamEvent;
}

export async function pollMerchantEvents(db: Db, merchantId: string, since: Date): Promise<KeyedEvent[]> {
  const [paid, completed, cancelRequests, messages, batches] = await Promise.all([
    db
      .select({ id: orders.id, number: orders.orderNumber, at: orders.paidAt })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          isNotNull(orders.paidAt),
          gt(orders.paidAt, since),
          inArray(orders.status, ["PAID", "READY_FOR_PICKUP", "COMPLETED"]),
        ),
      ),
    db
      .select({ id: orders.id, number: orders.orderNumber, at: orders.pickedUpAt })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          eq(orders.status, "COMPLETED"),
          isNotNull(orders.pickedUpAt),
          gt(orders.pickedUpAt, since),
        ),
      ),
    db
      .select({ id: orders.id, number: orders.orderNumber, at: orders.cancelRequestedAt, reason: orders.cancelRequestReason })
      .from(orders)
      .where(
        and(
          eq(orders.merchantId, merchantId),
          eq(orders.cancelRequestStatus, "PENDING"),
          isNotNull(orders.cancelRequestedAt),
          gt(orders.cancelRequestedAt, since),
        ),
      ),
    db
      .select({ id: orderMessages.id, orderId: orders.id, number: orders.orderNumber, body: orderMessages.body, at: orderMessages.createdAt })
      .from(orderMessages)
      .innerJoin(orders, eq(orders.id, orderMessages.orderId))
      .where(and(eq(orders.merchantId, merchantId), eq(orderMessages.sender, "CUSTOMER"), gt(orderMessages.createdAt, since))),
    db
      .select()
      .from(surplusBatches)
      .where(and(eq(surplusBatches.merchantId, merchantId), gt(surplusBatches.updatedAt, since))),
  ]);

  const out: KeyedEvent[] = [];
  for (const o of paid) {
    const at = o.at!;
    out.push({
      key: `paid:${o.id}`,
      at: at.getTime(),
      event: { type: "order.paid", order_id: o.id, order_number: o.number, at: at.toISOString() },
    });
  }
  for (const o of completed) {
    const at = o.at!;
    out.push({
      key: `completed:${o.id}`,
      at: at.getTime(),
      event: { type: "order.completed", order_id: o.id, order_number: o.number, at: at.toISOString() },
    });
  }
  for (const o of cancelRequests) {
    const at = o.at!;
    out.push({
      key: `cancelreq:${o.id}`,
      at: at.getTime(),
      event: {
        type: "order.cancel_requested",
        order_id: o.id,
        order_number: o.number,
        reason: o.reason ?? "",
        at: at.toISOString(),
      },
    });
  }
  for (const m of messages) {
    out.push({
      key: `msg:${m.id}`,
      at: m.at.getTime(),
      event: {
        type: "order.message",
        order_id: m.orderId,
        order_number: m.number,
        message_id: m.id,
        preview: m.body.length > 80 ? `${m.body.slice(0, 77)}…` : m.body,
        at: m.at.toISOString(),
      },
    });
  }
  for (const b of batches) {
    out.push({
      key: `batch:${b.id}:${b.updatedAt.getTime()}`,
      at: b.updatedAt.getTime(),
      event: {
        type: "batch.updated",
        batch_id: b.id,
        available_stock: b.availableStock,
        discount_pct: b.currentDiscountPct,
        status: b.status,
        lauk_available: b.laukAvailable,
        at: b.updatedAt.toISOString(),
      },
    });
  }
  return out.sort((a, b) => a.at - b.at);
}
