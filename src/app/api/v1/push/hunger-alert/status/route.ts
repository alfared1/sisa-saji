import { connection } from "next/server";
import { getDb } from "@/db";
import { HungerAlertEndpointBody, type HungerAlertResponse } from "@/lib/contracts";
import { handle, ok, parseJson } from "@/server/http";
import { hungerAlertStatus } from "@/server/services/hunger-alert";

/** POST /api/v1/push/hunger-alert/status — public, by this device's push endpoint. */
export const POST = handle(async (req) => {
  await connection();
  const { endpoint } = await parseJson(req, HungerAlertEndpointBody);
  const data: HungerAlertResponse = await hungerAlertStatus(getDb(), endpoint);
  return ok(data);
});
