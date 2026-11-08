import { connection } from "next/server";
import { getDb } from "@/db";
import type { UpgradeResponse } from "@/lib/contracts";
import { handle, ok } from "@/server/http";
import { requireMerchant } from "@/server/auth/session";
import { upgradeSubscription } from "@/server/services/merchant/profile";

/**
 * POST /api/v1/merchant/subscription/upgrade — simulated Rp 50.000 payment →
 * PREMIUM + merchant_verified for 30 days (extends an active period).
 */
export const POST = handle(async () => {
  await connection();
  const { merchantId } = await requireMerchant();
  const { merchant, price_idr } = await upgradeSubscription(getDb(), merchantId);
  const data: UpgradeResponse = { merchant };
  return ok(data, { meta: { simulated_payment_idr: price_idr } });
});
