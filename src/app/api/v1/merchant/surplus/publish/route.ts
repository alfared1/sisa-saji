import { connection } from "next/server";
import { getDb } from "@/db";
import { PublishBody, type PublishResponse } from "@/lib/contracts";
import { handle, ok, parseJson } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { publishSurplus } from "@/server/services/merchant/surplus";

/** POST /api/v1/merchant/surplus/publish → PublishResponse (201) */
export const POST = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const body = await parseJson(req, PublishBody);
  const data: PublishResponse = await publishSurplus(getDb(), merchantId, body);
  return ok(data, { status: 201 });
});
