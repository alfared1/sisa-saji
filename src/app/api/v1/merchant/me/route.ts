import { connection } from "next/server";
import { getDb } from "@/db";
import { MerchantUpdateBody, type MerchantMeResponse } from "@/lib/contracts";
import { handle, ok, parseJson } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { getMerchantMe, updateMerchant } from "@/server/services/merchant/profile";

/** GET /api/v1/merchant/me → MerchantMeResponse */
export const GET = handle(async () => {
  await connection();
  const { merchantId } = await requireMerchant();
  const data: MerchantMeResponse = await getMerchantMe(getDb(), merchantId);
  return ok(data);
});

/** PATCH /api/v1/merchant/me → MerchantMeResponse (the slug stays stable on rename). */
export const PATCH = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const body = await parseJson(req, MerchantUpdateBody);
  const data: MerchantMeResponse = await updateMerchant(getDb(), merchantId, body);
  return ok(data);
});
