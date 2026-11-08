import { connection } from "next/server";
import { getDb } from "@/db";
import { StockPatchBody, type BatchResponse } from "@/lib/contracts";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { patchBatchStock } from "@/server/services/merchant/surplus";

type Ctx = { params: Promise<{ batchId: string }> };

/** PATCH /api/v1/merchant/surplus/:batchId/stock — { delta } or { available_stock } → BatchResponse */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const batchId = parseUuid((await params).batchId, "Batch");
  const body = await parseJson(req, StockPatchBody);
  const data: BatchResponse = { batch: await patchBatchStock(getDb(), merchantId, batchId, body) };
  return ok(data);
});
