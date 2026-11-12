import { connection } from "next/server";
import { getDb } from "@/db";
import { StockPatchBody, type BatchResponse } from "@/lib/contracts";
import { DEMO_MAX_BATCH_STOCK, DEMO_MAX_BATCH_STOCK_MESSAGE } from "@/lib/demo-accounts";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { patchBatchStock } from "@/server/services/merchant/surplus";

type Ctx = { params: Promise<{ batchId: string }> };

/** PATCH /api/v1/merchant/surplus/:batchId/stock — { delta } or { available_stock } → BatchResponse */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  const batchId = parseUuid((await params).batchId, "Batch");
  const body = await parseJson(req, StockPatchBody);
  // The demo warung may adjust stock (part of the demo), but the resulting stock stays within the demo batch size.
  const limit = user.is_demo ? { maxAvailable: DEMO_MAX_BATCH_STOCK, message: DEMO_MAX_BATCH_STOCK_MESSAGE } : undefined;
  const data: BatchResponse = { batch: await patchBatchStock(getDb(), merchantId, batchId, body, new Date(), limit) };
  return ok(data);
});
