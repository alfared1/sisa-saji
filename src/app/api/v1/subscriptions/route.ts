import { connection } from "next/server";
import { getDb } from "@/db";
import type { SubscriptionsResponse } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok } from "@/server/http";
import { listSubscriptions } from "@/server/services/profile/profile";

/** GET /api/v1/subscriptions — the customer's favourite warung. */
export const GET = handle(async () => {
  await connection();
  const me = await requireUser();
  return ok<SubscriptionsResponse>({ subscriptions: await listSubscriptions(getDb(), me.id) });
});
