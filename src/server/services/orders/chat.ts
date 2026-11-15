/**
 * Order chat: the buyer and the warung talk about one order inside the app ("sudah di depan",
 * "pesanan sudah siap") instead of leaving for WhatsApp.
 *
 *   who      = the order's buyer and the warung that owns the order; nobody else (404).
 *   when     = messages can be sent while the order waits to be collected (PAID /
 *              READY_FOR_PICKUP, including open "bayar di warung" tickets); afterwards the chat
 *              stays readable.
 *   limits   = 1–ORDER_CHAT_MAX_LENGTH characters, ORDER_CHAT_RATE_LIMIT messages per sender per
 *              order per ORDER_CHAT_RATE_WINDOW_MINUTES (429 RATE_LIMITED).
 *   read     = opening the chat marks the other side's messages read; OrderDetail carries the
 *              viewer's unread count, and the warung's live stream announces buyer messages.
 *   notify   = a web push to the other side (collapsed per order by its tag).
 */
import "server-only";
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, orderMessages, orders } from "@/db/schema";
import { ORDER_CHAT_RATE_LIMIT, ORDER_CHAT_RATE_WINDOW_MINUTES } from "@/lib/constants";
import type { MessageSender, OrderMessage, OrderMessagesResponse } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { isPushEnabled, sendPushToUsers } from "@/server/services/push";

const OPEN_STATUSES = new Set(["PAID", "READY_FOR_PICKUP"]);
const HISTORY_LIMIT = 200;

export type ChatViewer = { userId: string; merchantId: string | null; as?: "customer" | "merchant" };

async function participant(db: Db, orderId: string, viewer: ChatViewer) {
  const [o] = await db
    .select({
      id: orders.id,
      status: orders.status,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      merchantId: orders.merchantId,
      ownerUserId: merchants.ownerUserId,
      merchantName: merchants.merchantName,
    })
    .from(orders)
    .innerJoin(merchants, eq(merchants.id, orders.merchantId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!o) throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  const isBuyer = o.customerId === viewer.userId;
  const isWarung = viewer.merchantId !== null && o.merchantId === viewer.merchantId;
  let as: MessageSender;
  if (isBuyer && isWarung) as = viewer.as === "merchant" ? "MERCHANT" : "CUSTOMER";
  else if (isBuyer) as = "CUSTOMER";
  else if (isWarung) as = "MERCHANT";
  else throw new ApiError("NOT_FOUND", "Pesanan tidak ditemukan");
  return { order: o, as };
}

function view(m: typeof orderMessages.$inferSelect, viewer: MessageSender): OrderMessage {
  return {
    id: m.id,
    sender: m.sender,
    body: m.body,
    created_at: m.createdAt.toISOString(),
    read_at: m.readAt ? m.readAt.toISOString() : null,
    mine: m.sender === viewer,
  };
}

/** Oldest first; marks the other side's unread messages as read. */
export async function listOrderMessages(
  db: Db,
  orderId: string,
  viewer: ChatViewer,
  now: Date = new Date(),
): Promise<OrderMessagesResponse> {
  const { order, as } = await participant(db, orderId, viewer);
  await db
    .update(orderMessages)
    .set({ readAt: now })
    .where(and(eq(orderMessages.orderId, order.id), ne(orderMessages.sender, as), isNull(orderMessages.readAt)));
  const rows = await db
    .select()
    .from(orderMessages)
    .where(eq(orderMessages.orderId, order.id))
    .orderBy(asc(orderMessages.createdAt), asc(orderMessages.id))
    .limit(HISTORY_LIMIT);
  return { messages: rows.map((m) => view(m, as)), can_send: OPEN_STATUSES.has(order.status), viewer: as };
}

export async function sendOrderMessage(
  db: Db,
  args: { orderId: string; viewer: ChatViewer; body: string; now?: Date },
): Promise<OrderMessage> {
  const now = args.now ?? new Date();
  const { order, as } = await participant(db, args.orderId, args.viewer);
  if (!OPEN_STATUSES.has(order.status)) {
    throw new ApiError("ORDER_STATE_CONFLICT", "Chat ditutup karena pesanan ini sudah selesai atau batal.");
  }
  const body = args.body.trim();
  if (!body) throw new ApiError("VALIDATION_ERROR", "Tulis pesannya dulu", [{ path: "body", message: "Tulis pesannya dulu" }]);

  const since = new Date(now.getTime() - ORDER_CHAT_RATE_WINDOW_MINUTES * 60_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orderMessages)
    .where(and(eq(orderMessages.orderId, order.id), eq(orderMessages.sender, as), gt(orderMessages.createdAt, since)));
  if (n >= ORDER_CHAT_RATE_LIMIT) {
    throw new ApiError("RATE_LIMITED", "Terlalu banyak pesan. Tunggu sebentar sebelum mengirim lagi.", {
      retry_after_minutes: ORDER_CHAT_RATE_WINDOW_MINUTES,
    });
  }

  const [row] = await db
    .insert(orderMessages)
    .values({ orderId: order.id, sender: as, senderUserId: args.viewer.userId, body, createdAt: now })
    .returning();

  if (isPushEnabled()) {
    const toBuyer = as === "MERCHANT";
    void sendPushToUsers(db, [toBuyer ? order.customerId : order.ownerUserId], {
      title: toBuyer ? `Pesan dari ${order.merchantName}` : `Pesan dari pembeli · ${order.orderNumber}`,
      body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      url: toBuyer ? `/orders/${order.id}?chat=1` : `/merchant/orders?chat=${order.id}`,
      tag: `chat-${order.id}`,
    }).catch((err) => console.warn("[chat] push failed", err instanceof Error ? err.message : err));
  }
  return view(row, as);
}
