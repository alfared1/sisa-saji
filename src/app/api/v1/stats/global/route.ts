import { connection } from "next/server";
import { scheduleInlineJobs } from "@/server/jobs/inline";
import { getDb } from "@/db";
import type { GlobalStats } from "@/lib/contracts";
import { isDemoData } from "@/lib/env";
import { handle, ok } from "@/server/http";
import { getGlobalStats } from "@/server/services/profile/profile";

/** GET /api/v1/stats/global: public. */
export const GET = handle(async () => {
  await connection();
  scheduleInlineJobs(); // serverless: run due jobs after this response (INLINE_JOBS)
  const stats = await getGlobalStats(getDb());
  return ok<GlobalStats>({ ...stats, is_demo_data: isDemoData() });
});
