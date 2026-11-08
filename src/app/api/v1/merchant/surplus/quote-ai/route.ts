import { connection } from "next/server";
import { getDb } from "@/db";
import { QuoteAiBody, type QuoteAiResponse } from "@/lib/contracts";
import { handle, ok, parseJson } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { quoteSurplus } from "@/server/services/merchant/surplus";

/** POST /api/v1/merchant/surplus/quote-ai → QuoteAiResponse (no writes). */
export const POST = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const body = await parseJson(req, QuoteAiBody);
  const data: QuoteAiResponse = await quoteSurplus(getDb(), merchantId, body);
  return ok(data);
});
