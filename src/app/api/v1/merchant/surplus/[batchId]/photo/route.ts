import { connection } from "next/server";
import { getDb } from "@/db";
import type { BatchPhotoResponse } from "@/lib/contracts";
import { BATCH_PHOTO_MAX_BYTES } from "@/lib/constants";
import { handle, ok, parseUuid, readImageBody } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { removeBatchPhoto, uploadBatchPhoto } from "@/server/services/merchant/surplus";

type Ctx = { params: Promise<{ batchId: string }> };

/**
 * POST /api/v1/merchant/surplus/:batchId/photo — raw JPEG body (Content-Type: image/jpeg,
 * at most BATCH_PHOTO_MAX_BYTES) → BatchPhotoResponse (201). Part of the publish flow, so
 * the demo warung may upload too: its photos are demo_only.
 * 404 foreign batch, 409 BATCH_CLOSED, 413 too large, 415 not a JPEG, 429 RATE_LIMITED.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  const batchId = parseUuid((await params).batchId, "Batch");
  const image = await readImageBody(req, BATCH_PHOTO_MAX_BYTES);
  const data: BatchPhotoResponse = await uploadBatchPhoto(getDb(), merchantId, batchId, {
    bytes: image.bytes,
    contentType: image.contentType,
    demoOnly: user.is_demo,
  });
  return ok(data, { status: 201 });
});

/** DELETE /api/v1/merchant/surplus/:batchId/photo → BatchPhotoResponse (photo null). */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const batchId = parseUuid((await params).batchId, "Batch");
  const data: BatchPhotoResponse = await removeBatchPhoto(getDb(), merchantId, batchId);
  return ok(data);
});
