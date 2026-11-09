import { connection } from "next/server";
import { scheduleInlineJobs } from "@/server/jobs/inline";
import { getDb } from "@/db";
import { DiscoverQuery, type MapPinsResponse } from "@/lib/contracts";
import { handle, ok, parseQuery } from "@/server/http";
import { findMapPins } from "@/server/services/discovery/discovery";

/** GET /api/v1/discover/map-pins — public, light payload for the map. */
export const GET = handle(async (req) => {
  await connection();
  scheduleInlineJobs(); // serverless: run due jobs after this response (INLINE_JOBS)
  const q = parseQuery(req, DiscoverQuery);
  return ok<MapPinsResponse>({ pins: await findMapPins(getDb(), q) });
});
