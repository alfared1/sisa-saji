import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { getDb } from "@/db";
import { getCronSecret } from "@/lib/env";
import { runDueJobs } from "@/server/jobs/serverless";
import { fail, handle, ok } from "@/server/http";

/** Calendar jobs + escalation may take a while on a cold database. */
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * GET /api/cron/tick — runs every job that is due (DB-leased, see jobs/serverless.ts).
 * Called by Vercel Cron (Authorization: Bearer $CRON_SECRET) or any external scheduler.
 */
export const GET = handle(async (req) => {
  await connection();
  if (!authorized(req)) return fail("UNAUTHENTICATED", "Cron secret tidak valid");
  const summary = await runDueJobs(getDb(), new Date());
  return ok({ ran_at: new Date().toISOString(), jobs: summary });
});
