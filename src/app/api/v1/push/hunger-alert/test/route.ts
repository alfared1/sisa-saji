import { connection } from "next/server";
import { getDb } from "@/db";
import { HungerAlertEndpointBody } from "@/lib/contracts";
import { handle, ok, parseJson } from "@/server/http";
import { sendHungerTest } from "@/server/services/hunger-alert";

/**
 * POST /api/v1/push/hunger-alert/test — public, by this device's push endpoint.
 * "Kirim contoh notifikasi": one sample push to this device only (60 s cooldown, else 429).
 */
export const POST = handle(async (req) => {
  await connection();
  const { endpoint } = await parseJson(req, HungerAlertEndpointBody);
  return ok(await sendHungerTest(getDb(), endpoint));
});
