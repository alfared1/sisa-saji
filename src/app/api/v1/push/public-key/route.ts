import { connection } from "next/server";
import type { PushPublicKeyResponse } from "@/lib/contracts";
import { getVapidKeys } from "@/lib/env";
import { handle, ok } from "@/server/http";

/** GET /api/v1/push/public-key — public. null when Web Push is not configured. */
export const GET = handle(async () => {
  await connection();
  return ok<PushPublicKeyResponse>({ public_key: getVapidKeys()?.publicKey ?? null });
});
