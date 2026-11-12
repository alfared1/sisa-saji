import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db";
import { PilotDataPresentError, seedDatabase } from "@/db/seed";
import { getCronSecret, getPickupQrSecret, isDemoMode } from "@/lib/env";
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
 * `?force=1` is passed (which WIPES all data and reseeds), and force only works on a
 * demo deployment (DEMO_MODE=true). Real pilot warung are kept safe: with pilot data
 * present it refuses unless `&wipe_pilot=1` is passed as well.
 * Schema migrations run at build time (see package.json "vercel-build").
 */
export const POST = handle(async (req) => {
  await connection();
  if (!authorized(req)) return fail("UNAUTHENTICATED", "Cron secret tidak valid");
  const db = getDb();
  const params = new URL(req.url).searchParams;
  const force = params.get("force") === "1";
  const { rows } = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM users`);
  if ((rows[0]?.n ?? 0) > 0) {
    if (!force) return fail("CONFLICT", "Database sudah berisi data. Tambahkan ?force=1 untuk menghapus dan seed ulang.");
    if (!isDemoMode()) return fail("FORBIDDEN", "Seed ulang paksa hanya untuk deployment demo (DEMO_MODE=true).");
  }
  try {
    const summary = await seedDatabase(db, {
      pickupQrSecret: getPickupQrSecret(),
      allowPilotWipe: params.get("wipe_pilot") === "1",
    });
    return ok({ seeded: summary });
  } catch (err) {
    if (err instanceof PilotDataPresentError) return fail("CONFLICT", err.message);
    throw err;
  }
});
