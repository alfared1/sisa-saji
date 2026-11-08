import { connection } from "next/server";
import { getDb } from "@/db";
import type { GlobalStats } from "@/lib/contracts";
import { handle, ok } from "@/server/http";
import { getGlobalStats } from "@/server/services/profile/profile";

/** GET /api/v1/stats/global — public. */
export const GET = handle(async () => {
  await connection();
  return ok<GlobalStats>(await getGlobalStats(getDb()));
});
