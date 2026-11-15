import { connection } from "next/server";
import { getDb } from "@/db";
import type { WalletResponse } from "@/lib/contracts";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok } from "@/server/http";
import { getWallet } from "@/server/services/merchant/wallet";

/** GET /api/v1/merchant/wallet — owner: balance, payout account, 30-day history. */
export const GET = handle(async () => {
  await connection();
  const { merchantId } = await requireMerchant();
  return ok<WalletResponse>(await getWallet(getDb(), merchantId), { headers: { "cache-control": "no-store" } });
});
