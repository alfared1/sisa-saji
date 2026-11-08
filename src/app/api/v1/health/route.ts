import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * Work overdue by more than this means the worker (`npm run worker`) is not
 * running: its minute jobs close ended batches and expire unpaid checkouts ~every 60 s.
 */
const WORKER_GRACE_MINUTES = 3;

/**
 * GET /api/v1/health — liveness + database/PostGIS check, plus a cheap worker
 * signal derived from work the worker is responsible for:
 *
 *   worker.status            "ok"     = no overdue worker work (also when idle)
 *                            "behind" = ACTIVE batches past pickup_end_time, or
 *                                       PENDING_PAYMENT orders past payment_expires_at,
 *                                       for more than 3 minutes
 *   worker.lastEscalationAt  newest discount log written by the escalation job
 *
 * The fields that existed before (status, database, postgis, activeBatches) are unchanged.
 */
export async function GET() {
  await connection(); // always evaluate at request time (never prerender)
  try {
    const {
      rows: [row],
    } = await getDb().execute<{
      postgis: string;
      active_batches: number;
      overdue_batches: number;
      overdue_orders: number;
      last_escalation_at: string | Date | null;
    }>(sql`
      SELECT postgis_lib_version() AS postgis,
             (SELECT COUNT(*)::int FROM surplus_batches WHERE status = 'ACTIVE') AS active_batches,
             (SELECT COUNT(*)::int FROM surplus_batches
               WHERE status = 'ACTIVE'
                 AND pickup_end_time < NOW() - make_interval(mins => ${WORKER_GRACE_MINUTES})) AS overdue_batches,
             (SELECT COUNT(*)::int FROM orders
               WHERE status = 'PENDING_PAYMENT'
                 AND payment_expires_at < NOW() - make_interval(mins => ${WORKER_GRACE_MINUTES})) AS overdue_orders,
             (SELECT MAX(created_at) FROM discount_adjustment_logs
               WHERE trigger_reason <> 'INITIAL_PUBLISH') AS last_escalation_at`);
    return Response.json({
      success: true,
      data: {
        status: "ok",
        database: "up",
        postgis: row.postgis,
        activeBatches: row.active_batches,
        worker: {
          status: row.overdue_batches > 0 || row.overdue_orders > 0 ? "behind" : "ok",
          overdueBatches: row.overdue_batches,
          overduePendingOrders: row.overdue_orders,
          lastEscalationAt: row.last_escalation_at ? new Date(row.last_escalation_at).toISOString() : null,
        },
      },
    });
  } catch (err) {
    console.error("[health] database check failed", err);
    return Response.json(
      { success: false, error: { code: "DB_UNAVAILABLE", message: "Database is not reachable" } },
      { status: 503 },
    );
  }
}
