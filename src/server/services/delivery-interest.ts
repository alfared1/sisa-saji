/**
 * "Titip Antar Kolektif" waiting list. Collective delivery does not exist: self-pickup stays
 * the rule, and nothing here touches checkout, totals or orders. One row per user records
 * interest and the kos/asrama name, which is returned only to its author; everyone else
 * sees the count alone. Demo accounts are refused at the route (DEMO_LOCKED) and are also
 * left out of the count here, so a shared account never inflates it.
 */
import "server-only";
import { and, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { deliveryInterests, users } from "@/db/schema";
import type { DeliveryInterestResponse } from "@/lib/contracts";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";

const DEMO_EMAILS = Object.values(DEMO_ACCOUNTS).map((a) => a.email);
/** Stored phone numbers are E.164 (+62…), as in isDemoAccount. */
const DEMO_PHONES = Object.values(DEMO_ACCOUNTS).map((a) => `+62${a.phone.slice(1)}`);

/** Interested accounts, excluding the shared demo accounts. */
async function countInterest(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deliveryInterests)
    .innerJoin(users, eq(users.id, deliveryInterests.userId))
    .where(
      and(
        or(isNull(users.email), notInArray(users.email, DEMO_EMAILS)),
        or(isNull(users.phoneNumber), notInArray(users.phoneNumber, DEMO_PHONES)),
      ),
    );
  return row?.n ?? 0;
}

/** The public count, plus the viewer's own registration when logged in. */
export async function getInterest(db: Db, userId: string | null): Promise<DeliveryInterestResponse> {
  const count = await countInterest(db);
  if (!userId) return { count, mine: null };
  const [row] = await db
    .select({ kosName: deliveryInterests.kosName })
    .from(deliveryInterests)
    .where(eq(deliveryInterests.userId, userId))
    .limit(1);
  return { count, mine: row ? { kos_name: row.kosName } : null };
}

/** Registers or updates the user's interest (one row per user). */
export async function upsertInterest(
  db: Db,
  userId: string,
  kosName: string,
  now: Date = new Date(),
): Promise<DeliveryInterestResponse> {
  await db
    .insert(deliveryInterests)
    .values({ userId, kosName, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: deliveryInterests.userId,
      set: { kosName: sql`excluded.kos_name`, updatedAt: now },
    });
  return getInterest(db, userId);
}

/** Withdraws the user's interest; a no-op when there is none. */
export async function removeInterest(db: Db, userId: string): Promise<DeliveryInterestResponse> {
  await db.delete(deliveryInterests).where(eq(deliveryInterests.userId, userId));
  return getInterest(db, userId);
}
