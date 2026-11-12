import { connection } from "next/server";
import { getDb } from "@/db";
import { PublishBody, type PublishResponse } from "@/lib/contracts";
import { DEMO_MAX_BATCH_STOCK, DEMO_MAX_BATCH_STOCK_MESSAGE } from "@/lib/demo-accounts";
import { ApiError, handle, ok, parseJson } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { publishSurplus } from "@/server/services/merchant/surplus";

/** POST /api/v1/merchant/surplus/publish → PublishResponse (201) */
export const POST = handle(async (req) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  const body = await parseJson(req, PublishBody);
  if (user.is_demo && body.initial_stock > DEMO_MAX_BATCH_STOCK) {
    throw new ApiError("VALIDATION_ERROR", DEMO_MAX_BATCH_STOCK_MESSAGE, [
      { path: "initial_stock", message: DEMO_MAX_BATCH_STOCK_MESSAGE },
    ]);
  }
  const data: PublishResponse = await publishSurplus(getDb(), merchantId, body);
  return ok(data, { status: 201 });
});
