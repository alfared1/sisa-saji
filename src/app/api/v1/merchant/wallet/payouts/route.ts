import { connection } from "next/server";
import { getDb } from "@/db";
import { PayoutRequestBody, type PayoutResponse } from "@/lib/contracts";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { requestPayout } from "@/server/services/merchant/wallet";

/**
 * POST /api/v1/merchant/wallet/payouts — owner: { amount_idr } to the profile's account.
 * Simulated (paid at once) on demo data. 400 below the minimum or above the balance,
 * 409 while another payout is processing.
 */
export const POST = handle(async (req) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  const body = await parseJson(req, PayoutRequestBody);
  // The shared demo warung can try it, but its balance stays for the next visitor.
  const data = await requestPayout(getDb(), merchantId, body.amount_idr, new Date(), { sharedDemoAccount: user.is_demo });
  return ok<PayoutResponse>(data, { status: 201 });
});
