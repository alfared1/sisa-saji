/**
 * Traffic-driven job trigger for serverless hosts. Call `scheduleInlineJobs()` from a
 * route handler: when INLINE_JOBS=true it runs due jobs after the response is sent
 * (next/server `after`), at most once per 30 s per function instance. The DB leases in
 * runDueJobs keep concurrent instances from doing the same work twice.
 */
import "server-only";
import { after } from "next/server";
import { getDb } from "@/db";
import { isInlineJobsEnabled } from "@/lib/env";
import { runDueJobs } from "./serverless";

const MIN_GAP_MS = 30_000;
let lastAttempt = 0;

export function scheduleInlineJobs(): void {
  if (!isInlineJobsEnabled()) return;
  const now = Date.now();
  if (now - lastAttempt < MIN_GAP_MS) return;
  lastAttempt = now;
  after(async () => {
    try {
      await runDueJobs(getDb(), new Date());
    } catch (err) {
      console.error("[jobs] inline run failed", err);
    }
  });
}
