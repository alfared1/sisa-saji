import { connection } from "next/server";
import { clearSessionCookie } from "@/server/auth/session";
import { handle, ok } from "@/server/http";

/** POST /api/v1/auth/logout → { ok: true } */
export const POST = handle(async () => {
  await connection();
  await clearSessionCookie();
  return ok({ ok: true as const });
});
