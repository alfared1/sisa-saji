import { connection } from "next/server";
import { scheduleInlineJobs } from "@/server/jobs/inline";
import { getDb } from "@/db";
import { AllMapPinsQuery, type AllMapPinsResponse } from "@/lib/contracts";
import { handle, ok, parseQuery } from "@/server/http";
import { findAllMapPins } from "@/server/services/discovery/discovery";

/** GET /api/v1/discover/map-pins/all?lat&lng — public: every warung for the nationwide map. */
export const GET = handle(async (req) => {
  await connection();
  scheduleInlineJobs(); // serverless: run due jobs after this response (INLINE_JOBS)
  const q = parseQuery(req, AllMapPinsQuery);
  return ok<AllMapPinsResponse>(await findAllMapPins(getDb(), q));
});
