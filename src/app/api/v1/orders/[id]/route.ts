import { connection } from "next/server";
import { scheduleInlineJobs } from "@/server/jobs/inline";
import { getDb } from "@/db";
import type { OrderResponse } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok, parseUuid } from "@/server/http";
import { getOrderForViewer } from "@/server/services/orders/orders";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/orders/:id — customer owner or the order's merchant. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await connection();
  scheduleInlineJobs(); // serverless: run due jobs after this response (INLINE_JOBS)
  const me = await requireUser();
  const id = parseUuid((await params).id, "Pesanan");
  const order = await getOrderForViewer(getDb(), id, { userId: me.id, merchantId: me.merchant_id });
  return ok<OrderResponse>({ order }, { headers: { "cache-control": "no-store" } });
});
