/**
 * OTP login (WhatsApp / email). Only sha256(`${identifier}:${code}`) is stored.
 *
 *  - request: rate limited per identifier (OTP_MAX_REQUESTS_PER_WINDOW / 10 min) and,
 *             when codes are really sent, per client IP and for the whole app
 *             (OTP_MAX_REQUESTS_PER_CLIENT_WINDOW, OTP_MAX_SENDS_PER_HOUR). The limits run
 *             before the real-account check, so that refusal cannot be probed without limit.
 *             Dev mode returns the code (`dev_code`); otherwise it is sent through the
 *             channel's provider (otp-delivery.ts) and a failed send is an error.
 *             Outside dev mode the shared demo numbers are refused (one-tap demo login
 *             only): they look like real numbers and would message a stranger.
 *  - verify:  latest unconsumed code; OTP_MAX_ATTEMPTS wrong tries lock it;
 *             a new account needs full_name (the code is NOT consumed in that case,
 *             so the client can retry with a name); MERCHANT login upgrades a CUSTOMER
 *             (never a shared demo account).
 *  - In dev mode both refuse accounts of real people (real-accounts.ts): an on-screen
 *    code would let anyone who knows their number or email sign in as them.
 */
import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { otpCodes, users } from "@/db/schema";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_REQUESTS_PER_CLIENT_WINDOW,
  OTP_MAX_REQUESTS_PER_WINDOW,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_TTL_SECONDS,
} from "@/lib/constants";
import {
  DEMO_LOGIN_ONLY_REASON,
  REAL_OTP_REQUIRED_REASON,
  type OtpRequestBody,
  type OtpRequestResponse,
  type OtpVerifyBody,
  type SessionUser,
} from "@/lib/contracts";
import { isDemoAccount } from "@/lib/demo-accounts";
import { ApiError } from "@/server/http";
import { toLoginIdentifier, type OtpChannel } from "./identifier";
import { canDeliver, configuredOtpProviders, deliverOtp, type OtpDeliveryDeps, type OtpProviders } from "./otp-delivery";
import { assertDevOtpAllowed, isRealPersonAccount, REAL_OTP_REQUIRED_MESSAGE } from "./real-accounts";
import { sessionUserView } from "./session-user";

export const OTP_RATE_WINDOW_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;

export const DEMO_LOGIN_ONLY_MESSAGE = "Ini akun demo bersama. Masuk lewat tombol akun demo di halaman ini, tanpa kode.";

type OtpRequestInput = z.output<typeof OtpRequestBody>;
type OtpVerifyInput = z.output<typeof OtpVerifyBody>;

export function hashOtp(identifier: string, code: string): string {
  return createHash("sha256").update(`${identifier}:${code}`).digest("hex");
}

/** Per-client key for the rate limit: SHA-256 of the IP address (the address is not stored). */
export function otpClientKey(ip: string | null | undefined): string | null {
  const v = ip?.trim();
  return v ? createHash("sha256").update(`otp-client:${v}`).digest("hex") : null;
}

export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

/** Why no code can be sent on `channel`, pointing to the other channel when it works. */
export function channelUnavailableMessage(channel: OtpChannel, providers: OtpProviders): string {
  if (channel === "WHATSAPP" && canDeliver("EMAIL", providers)) return "Kode lewat WhatsApp belum tersedia. Masuk dengan email dulu.";
  if (channel === "EMAIL" && canDeliver("WHATSAPP", providers)) return "Kode lewat email belum tersedia. Masuk dengan nomor WhatsApp dulu.";
  return "Kode masuk belum bisa dikirim saat ini. Coba lagi nanti.";
}

export async function requestOtp(
  db: Db,
  input: OtpRequestInput,
  opts: { devMode: boolean; now?: Date; delivery?: OtpDeliveryDeps; clientIp?: string | null },
): Promise<OtpRequestResponse> {
  const now = opts.now ?? new Date();
  const id = toLoginIdentifier(input);
  const clientKey = opts.devMode ? null : otpClientKey(opts.clientIp);

  // Shared demo numbers look real: never send them a code (the demo button needs none).
  const asUser = id.kind === "phone" ? { phoneNumber: id.value, email: null } : { email: id.value, phoneNumber: null };
  if (!opts.devMode && isDemoAccount(asUser)) {
    throw new ApiError("FORBIDDEN", DEMO_LOGIN_ONLY_MESSAGE, { reason: DEMO_LOGIN_ONLY_REASON });
  }

  const providers = opts.devMode ? null : (opts.delivery?.providers ?? configuredOtpProviders());
  if (providers && !canDeliver(id.channel, providers)) {
    throw new ApiError("OTP_DELIVERY_FAILED", channelUnavailableMessage(id.channel, providers), { channel: id.channel });
  }

  await assertOtpRateLimits(db, { identifier: id.value, clientKey, realDelivery: !opts.devMode, now });

  if (opts.devMode && (await isRealPersonAccount(db, id))) {
    // Recorded like any request (so it counts towards the limit), with no usable code.
    await db.insert(otpCodes).values({
      identifier: id.value,
      channel: id.channel,
      requestedRole: input.role,
      codeHash: hashOtp(id.value, randomBytes(16).toString("hex")),
      expiresAt: now,
      consumedAt: now,
      createdAt: now,
    });
    throw new ApiError("FORBIDDEN", REAL_OTP_REQUIRED_MESSAGE, { reason: REAL_OTP_REQUIRED_REASON });
  }

  const code = generateOtpCode();
  const [row] = await db.insert(otpCodes).values({
    identifier: id.value,
    channel: id.channel,
    requestedRole: input.role,
    codeHash: hashOtp(id.value, code),
    expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
    clientKey,
    createdAt: now,
  }).returning({ id: otpCodes.id });

  const result = await deliverOtp(
    { channel: id.channel, to: id.value, code, expiresInSeconds: OTP_TTL_SECONDS },
    opts.devMode,
    { ...opts.delivery, providers: providers ?? undefined },
  );
  if (!result.delivered) {
    // Nobody received this code: retire it (it still counts towards the rate limit).
    await db.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, row.id));
    throw new ApiError(
      "OTP_DELIVERY_FAILED",
      id.channel === "WHATSAPP"
        ? "Kode belum terkirim ke WhatsApp. Pastikan nomornya aktif di WhatsApp, lalu coba lagi sebentar lagi."
        : "Kode belum terkirim ke email. Periksa alamatnya, lalu coba lagi sebentar lagi.",
      { channel: id.channel },
    );
  }

  return {
    sent: true,
    channel: id.channel,
    expires_in_seconds: OTP_TTL_SECONDS,
    ...(opts.devMode ? { dev_code: code } : {}),
  };
}

/**
 * Throws RATE_LIMITED when the identifier, or (only when codes are really sent) the client
 * or the whole app, asked for too many codes recently.
 */
async function assertOtpRateLimits(
  db: Db,
  args: { identifier: string; clientKey: string | null; realDelivery: boolean; now: Date },
): Promise<void> {
  const windowStart = new Date(args.now.getTime() - OTP_RATE_WINDOW_MS);
  const [{ n }] = await db
    .select({ n: count() })
    .from(otpCodes)
    .where(and(eq(otpCodes.identifier, args.identifier), gt(otpCodes.createdAt, windowStart)));
  if (n >= OTP_MAX_REQUESTS_PER_WINDOW) {
    throw new ApiError("RATE_LIMITED", "Terlalu banyak permintaan kode. Coba lagi dalam 10 menit.");
  }
  if (!args.realDelivery) return;

  if (args.clientKey) {
    const [{ c }] = await db
      .select({ c: count() })
      .from(otpCodes)
      .where(and(eq(otpCodes.clientKey, args.clientKey), gt(otpCodes.createdAt, windowStart)));
    if (c >= OTP_MAX_REQUESTS_PER_CLIENT_WINDOW) {
      throw new ApiError("RATE_LIMITED", "Terlalu banyak permintaan kode dari perangkat ini. Coba lagi dalam 10 menit.");
    }
  }
  const [{ total }] = await db
    .select({ total: count() })
    .from(otpCodes)
    .where(gt(otpCodes.createdAt, new Date(args.now.getTime() - HOUR_MS)));
  if (total >= OTP_MAX_SENDS_PER_HOUR) {
    throw new ApiError("RATE_LIMITED", "Sedang banyak sekali permintaan kode masuk. Coba lagi beberapa saat lagi.");
  }
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

export type VerifyOtpResult = { user: SessionUser; isNewUser: boolean };

/** `devMode` = codes are shown on screen (OTP_DEV_MODE); then accounts of real people are refused. */
export async function verifyOtp(
  db: Db,
  input: OtpVerifyInput,
  opts: { devMode?: boolean; now?: Date } = {},
): Promise<VerifyOtpResult> {
  const now = opts.now ?? new Date();
  const id = toLoginIdentifier(input);
  // A code requested before the account became a pilot account must not open it either.
  await assertDevOtpAllowed(db, id, opts.devMode ?? false);

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

  // Reserve the attempt atomically BEFORE comparing: a check-then-increment lets
  // parallel guesses all pass the check, exceeding OTP_MAX_ATTEMPTS.
  const [reserved] = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(and(eq(otpCodes.id, otp.id), lt(otpCodes.attempts, OTP_MAX_ATTEMPTS), isNull(otpCodes.consumedAt)))
    .returning({ attempts: otpCodes.attempts });
  if (!reserved) {
    throw new ApiError("OTP_INVALID", "Terlalu banyak percobaan salah. Minta kode baru.", { locked: true });
  }

  if (!sameHash(otp.codeHash, hashOtp(id.value, input.code))) {
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - reserved.attempts);
    throw new ApiError(
      "OTP_INVALID",
      remaining > 0 ? `Kode OTP salah. Sisa ${remaining} percobaan.` : "Kode OTP salah. Minta kode baru.",
      { remaining_attempts: remaining },
    );
  }
  // The right code gives its reserved attempt back (the new-account flow retries it with a name).
  await db
    .update(otpCodes)
    .set({ attempts: sql`GREATEST(${otpCodes.attempts} - 1, 0)` })
    .where(eq(otpCodes.id, otp.id));

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
      if (input.role === "MERCHANT" && existing.role === "CUSTOMER" && !isDemoAccount(existing)) {
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
