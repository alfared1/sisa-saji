import { connection } from "next/server";
import { getDb } from "@/db";
import type { ImpactSummary } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok } from "@/server/http";
import { getImpactSummary } from "@/server/services/profile/profile";

/** GET /api/v1/profile/impact → ImpactSummary */
export const GET = handle(async () => {
  await connection();
  const me = await requireUser();
  return ok<ImpactSummary>(await getImpactSummary(getDb(), me.id));
});
