import { connection } from "next/server";
import { DEMO_VOUCHERS } from "@/lib/constants";
import type { VouchersResponse } from "@/lib/contracts";
import { handle, ok } from "@/server/http";

/** GET /api/v1/vouchers — public. */
export const GET = handle(async () => {
  await connection();
  return ok<VouchersResponse>({ vouchers: DEMO_VOUCHERS.map((v) => ({ ...v })) });
});
