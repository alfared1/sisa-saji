import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { DemoLoginBody, type OtpVerifyResponse } from "@/lib/contracts";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { isDemoData } from "@/lib/env";
import { loadSessionUser, setSessionCookie } from "@/server/auth/session";
import { ApiError, handle, ok, parseJson } from "@/server/http";

/**
 * POST /api/v1/auth/demo: one tap into the seeded demo buyer or demo warung, so a visitor
 * (or a jury member) can try the app without an OTP. Only while the app runs on demo data.
 */
export const POST = handle(async (req) => {
  await connection();
  if (!isDemoData()) throw new ApiError("FORBIDDEN", "Akun demo hanya tersedia di versi demo.");
  const { role } = await parseJson(req, DemoLoginBody);
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, DEMO_ACCOUNTS[role].email));
  const user = row ? await loadSessionUser(row.id) : null;
  if (!user) throw new ApiError("NOT_FOUND", "Akun demo belum tersedia. Jalankan seed data demo dulu.");
  await setSessionCookie(user.id);
  return ok<OtpVerifyResponse>({ user, is_new_user: false });
});
