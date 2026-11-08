import { connection } from "next/server";
import { getDb } from "@/db";
import { LocationPushBody, type LocationPushResponse } from "@/lib/contracts";
import { getSessionUser } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { recordLocationPush } from "@/server/services/profile/profile";

/** PUT /api/v1/profile/location-push — public (client_id identifies the device). */
export const PUT = handle(async (req) => {
  await connection();
  const body = await parseJson(req, LocationPushBody);
  const me = await getSessionUser();
  const data: LocationPushResponse = await recordLocationPush(getDb(), { ...body, userId: me?.id ?? null });
  return ok(data);
});
