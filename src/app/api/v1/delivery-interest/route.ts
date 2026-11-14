import { connection } from "next/server";
import { getDb } from "@/db";
import { DeliveryInterestBody, type DeliveryInterestResponse } from "@/lib/contracts";
import { assertDemoUnlocked, getSessionUser, requireUser } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { getInterest, removeInterest, upsertInterest } from "@/server/services/delivery-interest";

/**
 * "Titip Antar Kolektif" waiting list (display only; self-pickup stays the rule).
 * GET is public: the count, plus the viewer's own kos name when logged in. Never cached.
 */
export const GET = handle(async () => {
  await connection();
  const viewer = await getSessionUser();
  return ok<DeliveryInterestResponse>(await getInterest(getDb(), viewer?.id ?? null));
});

/** POST { kos_name }: register or update the viewer's interest. 403 DEMO_LOCKED for demo accounts. */
export const POST = handle(async (req) => {
  await connection();
  const me = await requireUser();
  assertDemoUnlocked(me);
  const { kos_name } = await parseJson(req, DeliveryInterestBody);
  return ok<DeliveryInterestResponse>(await upsertInterest(getDb(), me.id, kos_name));
});

/** DELETE: withdraw the viewer's interest. */
export const DELETE = handle(async () => {
  await connection();
  const me = await requireUser();
  return ok<DeliveryInterestResponse>(await removeInterest(getDb(), me.id));
});
