import { connection } from "next/server";
import { getDb } from "@/db";
import { HungerAlertBody, type HungerAlertResponse } from "@/lib/contracts";
import { getSessionUser } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { saveHungerAlert } from "@/server/services/hunger-alert";

/**
 * PUT /api/v1/push/hunger-alert — public (the push subscription identifies the device).
 * Turns "Notifikasi Jam Lapar" on (with a point, rounded to about 110 m) or off.
 */
export const PUT = handle(async (req) => {
  await connection();
  const body = await parseJson(req, HungerAlertBody);
  const me = await getSessionUser();
  const data: HungerAlertResponse = await saveHungerAlert(getDb(), body, me?.id ?? null);
  return ok(data);
});
