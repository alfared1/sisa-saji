import { connection } from "next/server";
import { getDb } from "@/db";
import { ProfileUpdateBody } from "@/lib/contracts";
import { requireUser } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { updateProfile } from "@/server/services/profile/profile";

/** PATCH /api/v1/profile → { user: SessionUser } */
export const PATCH = handle(async (req) => {
  await connection();
  const me = await requireUser();
  const body = await parseJson(req, ProfileUpdateBody);
  const user = await updateProfile(getDb(), me.id, body);
  return ok({ user });
});
