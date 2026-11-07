import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/** GET /api/v1/health — liveness + database/PostGIS check. */
export async function GET() {
  await connection(); // always evaluate at request time (never prerender)
  try {
    const {
      rows: [row],
    } = await getDb().execute<{ postgis: string; active_batches: number }>(sql`
      SELECT postgis_lib_version() AS postgis,
             (SELECT COUNT(*)::int FROM surplus_batches WHERE status = 'ACTIVE') AS active_batches`);
    return Response.json({
      success: true,
      data: { status: "ok", database: "up", postgis: row.postgis, activeBatches: row.active_batches },
    });
  } catch (err) {
    console.error("[health] database check failed", err);
    return Response.json(
      { success: false, error: { code: "DB_UNAVAILABLE", message: "Database is not reachable" } },
      { status: 503 },
    );
  }
}
