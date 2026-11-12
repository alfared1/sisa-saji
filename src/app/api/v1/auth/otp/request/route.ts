import { connection } from "next/server";
import { getDb } from "@/db";
import { OtpRequestBody } from "@/lib/contracts";
import { isOtpDevMode } from "@/lib/env";
import { handle, ok, parseJson } from "@/server/http";
import { requestOtp } from "@/server/services/auth/otp";

/**
 * Client IP for the per-client OTP limit. On Vercel both headers are set by the platform
 * (a client cannot forge them); elsewhere they are best effort.
 */
function clientIp(req: Request): string | null {
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

/** POST /api/v1/auth/otp/request — public. */
export const POST = handle(async (req) => {
  await connection();
  const body = await parseJson(req, OtpRequestBody);
  const data = await requestOtp(getDb(), body, { devMode: isOtpDevMode(), clientIp: clientIp(req) });
  return ok(data);
});
