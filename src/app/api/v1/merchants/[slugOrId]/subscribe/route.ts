import { connection } from "next/server";
import { getDb } from "@/db";
import { SubscribeBody, type SubscribeResponse } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { setSubscription } from "@/server/services/discovery/discovery";

type Ctx = { params: Promise<{ slugOrId: string }> };

/** POST /api/v1/merchants/:id/subscribe — toggle favourite + notifications (slug also accepted). */
export const POST = handle<Ctx>(async (req, { params }) => {
  await connection();
  const me = await requireUser();
  const { slugOrId } = await params;
  const body = await parseJson(req, SubscribeBody);
  return ok<SubscribeResponse>(await setSubscription(getDb(), me.id, decodeURIComponent(slugOrId), body));
});
