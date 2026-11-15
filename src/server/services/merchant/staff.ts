/**
 * Cashier accounts ("Kasir"): the owner adds a cashier by phone number; the cashier logs in by
 * OTP with that number and may only work the counter (pickup queue, scan + verify, buyer chat,
 * live feed), see requirePickupAccess. A number that has no account yet gets one, so the
 * cashier can log in right away. One warung per cashier; an owner cannot be a cashier.
 */
import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, merchantStaff, users } from "@/db/schema";
import { MAX_CASHIERS_PER_WARUNG } from "@/lib/constants";
import type { StaffResponse } from "@/lib/contracts";
import { isDemoAccount } from "@/lib/demo-accounts";
import { ApiError } from "@/server/http";
import { normalizePhone } from "@/server/services/auth/identifier";

export async function listCashiers(db: Db, merchantId: string): Promise<StaffResponse> {
  const rows = await db
    .select({ userId: users.id, fullName: users.fullName, phone: users.phoneNumber, addedAt: merchantStaff.addedAt })
    .from(merchantStaff)
    .innerJoin(users, eq(users.id, merchantStaff.userId))
    .where(eq(merchantStaff.merchantId, merchantId))
    .orderBy(asc(merchantStaff.addedAt));
  return {
    cashiers: rows.map((r) => ({
      user_id: r.userId,
      full_name: r.fullName,
      phone_number: r.phone,
      added_at: r.addedAt.toISOString(),
    })),
    max: MAX_CASHIERS_PER_WARUNG,
  };
}

export async function addCashier(
  db: Db,
  args: { merchantId: string; ownerUserId: string; phoneNumber: string; fullName?: string; now?: Date },
): Promise<StaffResponse> {
  const phone = normalizePhone(args.phoneNumber);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('merchant_staff'), hashtext(${args.merchantId}))`);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(merchantStaff)
      .where(eq(merchantStaff.merchantId, args.merchantId));
    if (n >= MAX_CASHIERS_PER_WARUNG) {
      throw new ApiError("VALIDATION_ERROR", `Paling banyak ${MAX_CASHIERS_PER_WARUNG} kasir per warung.`);
    }

    let [user] = await tx.select().from(users).where(eq(users.phoneNumber, phone)).limit(1);
    if (user && user.id === args.ownerUserId) throw new ApiError("VALIDATION_ERROR", "Itu nomor pemilik warung sendiri.");
    if (user && isDemoAccount(user)) throw new ApiError("VALIDATION_ERROR", "Nomor akun demo tidak bisa jadi kasir.");
    if (user) {
      const [owns] = await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.ownerUserId, user.id)).limit(1);
      if (owns) throw new ApiError("VALIDATION_ERROR", "Nomor ini sudah punya warung sendiri, jadi tidak bisa jadi kasir.");
      const [staff] = await tx
        .select({ merchantId: merchantStaff.merchantId })
        .from(merchantStaff)
        .where(eq(merchantStaff.userId, user.id))
        .limit(1);
      if (staff) {
        throw new ApiError(
          "CONFLICT",
          staff.merchantId === args.merchantId ? "Nomor ini sudah jadi kasir di warungmu." : "Nomor ini sudah jadi kasir di warung lain.",
        );
      }
    } else {
      [user] = await tx
        .insert(users)
        .values({ fullName: args.fullName?.trim() || "Kasir", phoneNumber: phone })
        .returning();
    }
    await tx.insert(merchantStaff).values({ merchantId: args.merchantId, userId: user.id, addedAt: args.now ?? new Date() });
  });
  return listCashiers(db, args.merchantId);
}

export async function removeCashier(db: Db, merchantId: string, userId: string): Promise<StaffResponse> {
  const deleted = await db
    .delete(merchantStaff)
    .where(and(eq(merchantStaff.merchantId, merchantId), eq(merchantStaff.userId, userId)))
    .returning({ userId: merchantStaff.userId });
  if (!deleted.length) throw new ApiError("NOT_FOUND", "Kasir tidak ditemukan");
  return listCashiers(db, merchantId);
}
