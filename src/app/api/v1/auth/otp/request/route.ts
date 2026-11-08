import { connection } from "next/server";
import { getDb } from "@/db";
import { OtpRequestBody } from "@/lib/contracts";
import { isOtpDevMode } from "@/lib/env";
import { handle, ok, parseJson } from "@/server/http";
import { requestOtp } from "@/server/services/auth/otp";

/** POST /api/v1/auth/otp/request — public. */
export const POST = handle(async (req) => {
  await connection();
  const body = await parseJson(req, OtpRequestBody);
  const data = await requestOtp(getDb(), body, { devMode: isOtpDevMode() });
  return ok(data);
});
