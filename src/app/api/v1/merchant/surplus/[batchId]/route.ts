import { connection } from "next/server";
import { getDb } from "@/db";
import { BatchPatchBody, type BatchResponse } from "@/lib/contracts";
import { handle, ok, parseJson, parseUuid } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { patchBatch } from "@/server/services/merchant/surplus";

type Ctx = { params: Promise<{ batchId: string }> };

/**
 * PATCH /api/v1/merchant/surplus/:batchId — { status: "CANCELLED" } (only when
 * reserved_stock = 0; paid orders stay valid) and/or { auto_discount_enabled }.
 */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const batchId = parseUuid((await params).batchId, "Batch");
  const body = await parseJson(req, BatchPatchBody);
  const data: BatchResponse = { batch: await patchBatch(getDb(), merchantId, batchId, body) };
  return ok(data);
});
