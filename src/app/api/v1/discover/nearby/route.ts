import { connection } from "next/server";
import { getDb } from "@/db";
import { DiscoverQuery, type NearbyResponse } from "@/lib/contracts";
import { handle, ok, parseQuery } from "@/server/http";
import { findNearby } from "@/server/services/discovery/discovery";

/** GET /api/v1/discover/nearby?lat&lng&radius_m&category&max_price&sort&q — public. */
export const GET = handle(async (req) => {
  await connection();
  const q = parseQuery(req, DiscoverQuery);
  return ok<NearbyResponse>(await findNearby(getDb(), q));
});
