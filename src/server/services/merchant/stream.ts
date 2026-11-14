/**
 * Merchant live feed (GET /api/v1/stream/merchant): polls the DB for this
 * merchant's orders that were paid / completed and batches that changed since a
 * cursor. The route keeps a small window of overlap and dedupes by event key so a
 * write committed during a poll is not lost.
 */
import "server-only";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orders, surplusBatches } from "@/db/schema";
import type { MerchantStreamEvent } from "@/lib/contracts";

export interface KeyedEvent {
  key: string;
  at: number;
  event: MerchantStreamEvent;
}

export async function pollMerchantEvents(db: Db, merchantId: string, since: Date): Promise<KeyedEvent[]> {
  const [paid, completed, batches] = await Promise.all([
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
