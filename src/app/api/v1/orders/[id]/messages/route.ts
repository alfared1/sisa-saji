import { connection } from "next/server";
import { getDb } from "@/db";
import {
  OrderMessagesQuery,
  SendOrderMessageBody,
  type OrderMessageResponse,
  type OrderMessagesResponse,
} from "@/lib/contracts";
import { pickupMerchantId, requireUser } from "@/server/auth/session";
import { handle, ok, parseJson, parseQuery, parseUuid } from "@/server/http";
import { listOrderMessages, sendOrderMessage } from "@/server/services/orders/chat";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/orders/:id/messages — the order's buyer or warung; marks the other side's messages read. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await connection();
  const me = await requireUser();
  const id = parseUuid((await params).id, "Pesanan");
  const q = parseQuery(req, OrderMessagesQuery);
  const res = await listOrderMessages(getDb(), id, { userId: me.id, merchantId: pickupMerchantId(me), as: q.as });
  return ok<OrderMessagesResponse>(res, { headers: { "cache-control": "no-store" } });
});

/** POST /api/v1/orders/:id/messages — { body } while the order waits to be collected. */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const me = await requireUser();
  const id = parseUuid((await params).id, "Pesanan");
  const body = await parseJson(req, SendOrderMessageBody);
  const message = await sendOrderMessage(getDb(), {
    orderId: id,
    viewer: { userId: me.id, merchantId: pickupMerchantId(me), as: body.as },
    body: body.body,
  });
  return ok<OrderMessageResponse>({ message }, { status: 201 });
});
