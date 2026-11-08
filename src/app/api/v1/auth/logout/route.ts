import { connection } from "next/server";
import { getDb } from "@/db";
import { LogoutBody } from "@/lib/contracts";
import { clearSessionCookie, getSessionUser } from "@/server/auth/session";
import { handle, ok } from "@/server/http";
import { unlinkPushSubscription } from "@/server/services/push";

/**
 * POST /api/v1/auth/logout → { ok: true }
 * Optional body { push_endpoint }: unlinks this device's push subscription from the
 * account (it keeps anonymous nearby pushes). An empty / invalid body still logs out.
 */
export const POST = handle(async (req) => {
  await connection();
  let endpoint: string | undefined;
  try {
    const parsed = LogoutBody.safeParse(await req.json());
    if (parsed.success) endpoint = parsed.data.push_endpoint;
  } catch {
    // no JSON body: plain logout
  }
  if (endpoint) {
    const me = await getSessionUser();
    if (me) {
      try {
        await unlinkPushSubscription(getDb(), { userId: me.id, endpoint });
      } catch (err) {
        console.warn("[auth] logout: push unlink failed", err instanceof Error ? err.message : err);
      }
    }
  }
  await clearSessionCookie();
  return ok({ ok: true as const });
});
