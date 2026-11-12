import { connection } from "next/server";
import { getDb } from "@/db";
import { PilotBaselineBody, PilotJoinBody, type PilotAvailability } from "@/lib/contracts";
import { assertDemoUnlocked, requireMerchant } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { getPilotAvailability, joinPilot, setPilotBaseline } from "@/server/services/merchant/pilot";

/** GET /api/v1/merchant/pilot: whether this warung can join the pilot right now. → PilotAvailability */
export const GET = handle(async () => {
  await connection();
  const { merchantId } = await requireMerchant();
  return ok<PilotAvailability>(await getPilotAvailability(getDb(), merchantId));
});

/**
 * POST /api/v1/merchant/pilot: join the field pilot with the team's invite code. → MerchantMeResponse
 * 403 for demo accounts (DEMO_LOCKED) and while login codes are shown on screen (REAL_OTP_REQUIRED).
 */
export const POST = handle(async (req) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const body = await parseJson(req, PilotJoinBody);
  return ok(await joinPilot(getDb(), merchantId, body.code, body.baseline_leftover_portions));
});

/** PATCH /api/v1/merchant/pilot: set the thrown-away baseline once, if it is still empty. → MerchantMeResponse */
export const PATCH = handle(async (req) => {
  await connection();
  const { user, merchantId } = await requireMerchant();
  assertDemoUnlocked(user);
  const body = await parseJson(req, PilotBaselineBody);
  return ok(await setPilotBaseline(getDb(), merchantId, body.baseline_leftover_portions));
});
