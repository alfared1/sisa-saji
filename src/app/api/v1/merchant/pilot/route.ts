import { connection } from "next/server";
import { getDb } from "@/db";
import { PilotJoinBody } from "@/lib/contracts";
import { requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { joinPilot } from "@/server/services/merchant/pilot";

/** POST /api/v1/merchant/pilot: join the field pilot with the team's invite code. → MerchantMeResponse */
export const POST = handle(async (req) => {
  await connection();
  const { merchantId } = await requireMerchant();
  const body = await parseJson(req, PilotJoinBody);
  return ok(await joinPilot(getDb(), merchantId, body.code));
});
