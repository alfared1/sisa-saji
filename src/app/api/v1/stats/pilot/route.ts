import { connection } from "next/server";
import { getDb } from "@/db";
import type { PilotStats } from "@/lib/contracts";
import { handle, ok } from "@/server/http";
import { getPilotStats } from "@/server/services/merchant/pilot";

/** GET /api/v1/stats/pilot: public, real field-pilot results only (never demo data). */
export const GET = handle(async () => {
  await connection();
  return ok<PilotStats>(await getPilotStats(getDb()));
});
