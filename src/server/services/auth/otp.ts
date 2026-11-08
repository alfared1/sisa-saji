/**
 * OTP login (WhatsApp / email). Only sha256(`${identifier}:${code}`) is stored.
 *
 *  - request: rate limited per identifier (OTP_MAX_REQUESTS_PER_WINDOW / 10 min)
 *  - verify:  latest unconsumed code; OTP_MAX_ATTEMPTS wrong tries lock it;
 *             a new account needs full_name (the code is NOT consumed in that case,
 *             so the client can retry with a name); MERCHANT login upgrades a CUSTOMER.
 */
import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { otpCodes, users } from "@/db/schema";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_TTL_SECONDS,
} from "@/lib/constants";
import type { OtpRequestBody, OtpRequestResponse, OtpVerifyBody, SessionUser } from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { toLoginIdentifier } from "./identifier";
import { deliverOtp } from "./otp-delivery";
import { sessionUserView } from "./session-user";

export const OTP_RATE_WINDOW_MS = 10 * 60_000;

type OtpRequestInput = z.output<typeof OtpRequestBody>;
type OtpVerifyInput = z.output<typeof OtpVerifyBody>;

export function hashOtp(identifier: string, code: string): string {
  return createHash("sha256").update(`${identifier}:${code}`).digest("hex");
}

export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

export async function requestOtp(
  db: Db,
  input: OtpRequestInput,
  opts: { devMode: boolean; now?: Date },
): Promise<OtpRequestResponse> {
  const now = opts.now ?? new Date();
  const id = toLoginIdentifier(input);

  const [{ n }] = await db
    .select({ n: count() })
    .from(otpCodes)
    .where(and(eq(otpCodes.identifier, id.value), gt(otpCodes.createdAt, new Date(now.getTime() - OTP_RATE_WINDOW_MS))));
  if (n >= OTP_MAX_REQUESTS_PER_WINDOW) {
    throw new ApiError("RATE_LIMITED", "Terlalu banyak permintaan kode. Coba lagi dalam 10 menit.");
  }

  const code = generateOtpCode();
  await db.insert(otpCodes).values({
    identifier: id.value,
    channel: id.channel,
    requestedRole: input.role,
    codeHash: hashOtp(id.value, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
    createdAt: now,
  });

  await deliverOtp({ channel: id.channel, to: id.value, code, expiresInSeconds: OTP_TTL_SECONDS }, opts.devMode);

  return {
    sent: true,
    channel: id.channel,
    expires_in_seconds: OTP_TTL_SECONDS,
    ...(opts.devMode ? { dev_code: code } : {}),
  };
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export type VerifyOtpResult = { user: SessionUser; isNewUser: boolean };

export async function verifyOtp(db: Db, input: OtpVerifyInput, now: Date = new Date()): Promise<VerifyOtpResult> {
  const id = toLoginIdentifier(input);

  const [otp] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.identifier, id.value), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (!otp) throw new ApiError("OTP_INVALID", "Kode OTP tidak valid. Minta kode baru.");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError("OTP_INVALID", "Terlalu banyak percobaan salah. Minta kode baru.", { locked: true });
  }
  if (otp.expiresAt <= now) throw new ApiError("OTP_EXPIRED", "Kode OTP sudah kedaluwarsa. Minta kode baru.");

  if (!sameHash(otp.codeHash, hashOtp(id.value, input.code))) {
    const [row] = await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, otp.id))
      .returning({ attempts: otpCodes.attempts });
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - (row?.attempts ?? OTP_MAX_ATTEMPTS));
    throw new ApiError(
      "OTP_INVALID",
      remaining > 0 ? `Kode OTP salah. Sisa ${remaining} percobaan.` : "Kode OTP salah. Minta kode baru.",
      { remaining_attempts: remaining },
    );
  }

  const identityWhere = id.kind === "phone" ? eq(users.phoneNumber, id.value) : eq(users.email, id.value);

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(identityWhere).limit(1);
    if (!existing && !input.full_name) {
      // Do not consume the code: the client asks for a name and retries.
      throw new ApiError("VALIDATION_ERROR", "Nama lengkap wajib diisi untuk akun baru", [
        { path: "full_name", message: "Nama lengkap wajib diisi untuk akun baru" },
      ]);
    }

    const [consumed] = await tx
      .update(otpCodes)
      .set({ consumedAt: now })
      .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.consumedAt)))
      .returning({ id: otpCodes.id });
    if (!consumed) throw new ApiError("OTP_INVALID", "Kode OTP sudah dipakai. Minta kode baru.");

    if (existing) {
      if (input.role === "MERCHANT" && existing.role === "CUSTOMER") {
        await tx.update(users).set({ role: "MERCHANT", updatedAt: now }).where(eq(users.id, existing.id));
      }
      return { userId: existing.id, isNewUser: false };
    }

    const [created] = await tx
      .insert(users)
      .values({
        role: input.role,
        fullName: input.full_name!,
        phoneNumber: id.kind === "phone" ? id.value : null,
        email: id.kind === "email" ? id.value : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id });
    return { userId: created.id, isNewUser: true };
  });

  const user = await sessionUserView(db, result.userId);
  if (!user) throw new ApiError("INTERNAL_ERROR", "Akun tidak dapat dimuat");
  return { user, isNewUser: result.isNewUser };
}
