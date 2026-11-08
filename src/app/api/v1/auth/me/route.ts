import { connection } from "next/server";
import type { AuthMeResponse } from "@/lib/contracts";
import { getSessionUser } from "@/server/auth/session";
import { handle, ok } from "@/server/http";

/** GET /api/v1/auth/me — public; user is null when logged out. */
export const GET = handle(async () => {
  await connection();
  const user = await getSessionUser();
  return ok<AuthMeResponse>({ user }, { headers: { "cache-control": "no-store" } });
});
