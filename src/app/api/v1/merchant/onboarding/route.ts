import { connection } from "next/server";
import { getDb } from "@/db";
import { MerchantOnboardingBody, type MerchantMeResponse } from "@/lib/contracts";
import { handle, ok, parseJson } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { onboardMerchant } from "@/server/services/merchant/profile";

/**
 * POST /api/v1/merchant/onboarding — logged-in user without a warung.
 * Creates the warung (unique slug, WhatsApp normalised to +62…), sets role MERCHANT.
 * → MerchantMeResponse (201); 409 CONFLICT when the user already has one.
 */
export const POST = handle(async (req) => {
  await connection();
  const user = await requireUser();
  const body = await parseJson(req, MerchantOnboardingBody);
  const data: MerchantMeResponse = await onboardMerchant(getDb(), user.id, body);
  return ok(data, { status: 201 });
});
