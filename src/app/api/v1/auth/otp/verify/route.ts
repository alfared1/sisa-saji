import { connection } from "next/server";
import { getDb } from "@/db";
import { OtpVerifyBody, type OtpVerifyResponse } from "@/lib/contracts";
import { setSessionCookie } from "@/server/auth/session";
import { handle, ok, parseJson } from "@/server/http";
import { verifyOtp } from "@/server/services/auth/otp";

/** POST /api/v1/auth/otp/verify — public. Sets the session cookie. */
export const POST = handle(async (req) => {
  await connection();
  const body = await parseJson(req, OtpVerifyBody);
  const { user, isNewUser } = await verifyOtp(getDb(), body);
  await setSessionCookie(user.id);
  return ok<OtpVerifyResponse>({ user, is_new_user: isNewUser });
});
