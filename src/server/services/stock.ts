/**
 * Stock reservation core (replaces the blueprint's Redis Lua lock).
 *
 * Invariant per batch:  initial_stock = available_stock + reserved_stock + sold
 *   - checkout:      available -= q, reserved += q   (atomic conditional UPDATE)
 *   - payment OK:    reserved -= q                   (portions become "sold")
 *   - cancel/expire: reserved -= q, available += q
 * A batch with available = 0 and reserved = 0 becomes SOLD_OUT.
 *
 * All functions taking `tx` must run inside a transaction (db.transaction).
 */
import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orderItems, orders, surplusBatches } from "@/db/schema";
import { ApiError } from "@/server/http";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export interface ReserveItem {
  batchId: string;
  quantity: number;
}

/**
 * Reserves stock for every item or throws (caller's transaction rolls back).
 * Items are locked in batch-id order to avoid deadlocks between concurrent checkouts.
 */
export async function reserveItems(tx: Tx, merchantId: string, items: ReserveItem[], now: Date = new Date()) {
  const merged = new Map<string, number>();
  for (const it of items) merged.set(it.batchId, (merged.get(it.batchId) ?? 0) + it.quantity);
  const sorted = [...merged.entries()].sort(([a], [b]) => a.localeCompare(b));

  const reserved: (typeof surplusBatches.$inferSelect)[] = [];
  for (const [batchId, quantity] of sorted) {
    const [row] = await tx
      .update(surplusBatches)
      .set({
        availableStock: sql`${surplusBatches.availableStock} - ${quantity}`,
        reservedStock: sql`${surplusBatches.reservedStock} + ${quantity}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(surplusBatches.id, batchId),
          eq(surplusBatches.merchantId, merchantId),
          eq(surplusBatches.status, "ACTIVE"),
          sql`${surplusBatches.availableStock} >= ${quantity}`,
          sql`${surplusBatches.pickupEndTime} > ${now}`,
        ),
      )
      .returning();
    if (row) {
      reserved.push(row);
      continue;
    }
    // Explain why the reservation failed.
    const [batch] = await tx.select().from(surplusBatches).where(eq(surplusBatches.id, batchId)).limit(1);
    if (!batch) throw new ApiError("NOT_FOUND", "Menu surplus tidak ditemukan");
    if (batch.merchantId !== merchantId) {
      throw new ApiError("DIFFERENT_MERCHANT", "Semua item harus dari warung yang sama");
    }
    if (batch.status !== "ACTIVE" || batch.pickupEndTime <= now) {
      throw new ApiError("BATCH_CLOSED", "Menu ini sudah tidak tersedia (warung sudah tutup)");
    }
    throw new ApiError("OUT_OF_STOCK", `Stok tidak cukup, tersisa ${batch.availableStock} porsi`, {
      batch_id: batchId,
      available_stock: batch.availableStock,
    });
  }
  return reserved;
}

async function itemsOf(tx: DbOrTx, orderId: string) {
  return tx
    .select({ batchId: orderItems.surplusBatchId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
}

/** Marks SOLD_OUT any ACTIVE batch with nothing left to sell or pending. */
async function markSoldOut(tx: DbOrTx, batchIds: string[], now: Date) {
  if (!batchIds.length) return;
  await tx
    .update(surplusBatches)
    .set({ status: "SOLD_OUT", updatedAt: now })
    .where(
      and(
        inArray(surplusBatches.id, batchIds),
        eq(surplusBatches.status, "ACTIVE"),
        eq(surplusBatches.availableStock, 0),
        eq(surplusBatches.reservedStock, 0),
      ),
    );
}

/** Payment succeeded: reserved portions become sold. */
export async function commitReservation(tx: Tx, orderId: string, now: Date = new Date()) {
  const items = await itemsOf(tx, orderId);
  for (const it of items) {
    await tx
      .update(surplusBatches)
      .set({ reservedStock: sql`${surplusBatches.reservedStock} - ${it.quantity}`, updatedAt: now })
      .where(eq(surplusBatches.id, it.batchId));
  }
  await markSoldOut(tx, items.map((i) => i.batchId), now);
}

/** Checkout abandoned (cancel/expiry/failed payment): return portions to the shelf. */
export async function releaseReservation(tx: Tx, orderId: string, now: Date = new Date()) {
  const items = await itemsOf(tx, orderId);
  for (const it of items) {
    await tx
      .update(surplusBatches)
      .set({
        reservedStock: sql`${surplusBatches.reservedStock} - ${it.quantity}`,
        availableStock: sql`${surplusBatches.availableStock} + ${it.quantity}`,
        updatedAt: now,
      })
      .where(eq(surplusBatches.id, it.batchId));
  }
}

/**
 * Moves a PENDING_PAYMENT order to CANCELLED/EXPIRED and releases its stock.
 * Returns false when the order was no longer pending (idempotent).
 */
export async function abandonPendingOrder(
  tx: Tx,
  orderId: string,
  status: "CANCELLED" | "EXPIRED",
  reason: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [updated] = await tx
    .update(orders)
    .set({ status, cancelReason: reason, updatedAt: now })
    .where(and(eq(orders.id, orderId), eq(orders.status, "PENDING_PAYMENT")))
    .returning({ id: orders.id });
  if (!updated) return false;
  await releaseReservation(tx, orderId, now);
  return true;
}

/** Job: expire unpaid checkouts past payment_expires_at. Returns the number expired. */
export async function expirePendingOrders(db: Db, now: Date = new Date()): Promise<number> {
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "PENDING_PAYMENT"), lte(orders.paymentExpiresAt, now)))
    .orderBy(asc(orders.paymentExpiresAt))
    .limit(500);
  let count = 0;
  for (const { id } of stale) {
    const done = await db.transaction((tx) =>
      abandonPendingOrder(tx, id, "EXPIRED", "Pembayaran tidak diselesaikan dalam 10 menit", now),
    );
    if (done) count++;
  }
  return count;
}

/** Job: close ACTIVE batches whose pickup window has ended. Returns the number closed. */
export async function closeEndedBatches(db: Db, now: Date = new Date()): Promise<number> {
  const closed = await db
    .update(surplusBatches)
    .set({
      status: sql`CASE WHEN ${surplusBatches.availableStock} = 0 AND ${surplusBatches.reservedStock} = 0
                       THEN 'SOLD_OUT'::batch_status ELSE 'EXPIRED'::batch_status END`,
      updatedAt: now,
    })
    .where(and(eq(surplusBatches.status, "ACTIVE"), lte(surplusBatches.pickupEndTime, now)))
    .returning({ id: surplusBatches.id });
  return closed.length;
}
