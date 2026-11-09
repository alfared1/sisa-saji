import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { seedDatabase } from "@/db/seed";
import { getCronSecret, getPickupQrSecret } from "@/lib/env";
import { fail, handle, ok } from "@/server/http";

export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * POST /api/cron/bootstrap — fills an empty production database with the demo dataset
 * (95 warung around 21 campus hubs, 4 weeks of history, tonight's batches, demo accounts). Requires
 * Authorization: Bearer $CRON_SECRET. Refuses when users already exist, unless
 * `?force=1` is passed (which WIPES all data and reseeds).
 * Schema migrations run at build time (see package.json "vercel-build").
 */
export const POST = handle(async (req) => {
  await connection();
  if (!authorized(req)) return fail("UNAUTHENTICATED", "Cron secret tidak valid");
  const db = getDb();
  const force = new URL(req.url).searchParams.get("force") === "1";
  const { rows } = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM users`);
  if ((rows[0]?.n ?? 0) > 0 && !force) {
    return fail("CONFLICT", "Database sudah berisi data. Tambahkan ?force=1 untuk menghapus dan seed ulang.");
  }
  const summary = await seedDatabase(db, { pickupQrSecret: getPickupQrSecret() });
  return ok({ seeded: summary });
});
