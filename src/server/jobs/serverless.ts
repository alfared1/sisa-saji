/**
 * Job runner for serverless hosts (Vercel), where no long-running `npm run worker`
 * exists. Jobs are triggered by GET /api/cron/tick (Vercel Cron) and, when
 * INLINE_JOBS=true, by traffic on hot endpoints (src/server/jobs/inline.ts).
 *
 * Every job takes a lease in `job_runs` with one conditional UPSERT, so concurrent
 * function instances (or a cron call racing a page view) never run the same job twice.
 * The long-running worker (scripts/worker.ts) keeps its own in-memory schedule and is
 * not affected; running both is safe because the jobs themselves are idempotent.
 */
import "server-only";
import { and, eq, gt, inArray, like, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobRuns, menus, merchants, surplusBatches } from "@/db/schema";
import { ESCALATION_INTERVAL_MINUTES } from "@/lib/constants";
import { isDemoMode } from "@/lib/env";
import { wibDate } from "@/lib/time";
import { publishSurplus } from "@/server/services/merchant/surplus";
import {
  isCalendarJobDue,
  runEscalationJobs,
  runMerchantReminders,
  runMinuteJobs,
  runPredictionRefresh,
  runProactiveNotifications,
} from "./index";

const MINUTE_MS = 60_000;

/**
 * Takes the lease for `name` when its last run is at least `minIntervalMs` old (or it
 * never ran). Returns false when another instance holds it.
 */
export async function acquireLease(db: Db, name: string, now: Date, minIntervalMs: number): Promise<boolean> {
  const threshold = new Date(now.getTime() - minIntervalMs);
  const { rows } = await db.execute<{ name: string }>(sql`
    INSERT INTO job_runs (name, last_run_at, last_status) VALUES (${name}, ${now}, 'running')
    ON CONFLICT (name) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_status = 'running'
    WHERE job_runs.last_run_at <= ${threshold}
    RETURNING name`);
  return rows.length > 0;
}

async function finish(db: Db, name: string, status: "ok" | "failed", summary: unknown) {
  await db
    .update(jobRuns)
    .set({ lastStatus: status, lastSummary: summary as object })
    .where(eq(jobRuns.name, name));
}

type JobResult = { status: "ok" | "failed" | "skipped"; summary?: unknown };

async function runLeased(
  db: Db,
  name: string,
  now: Date,
  minIntervalMs: number,
  fn: () => Promise<unknown>,
): Promise<JobResult> {
  if (!(await acquireLease(db, name, now, minIntervalMs))) return { status: "skipped" };
  try {
    const summary = await fn();
    await finish(db, name, "ok", summary ?? null);
    return { status: "ok", summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] ${name} failed`, err);
    await finish(db, name, "failed", { error: message }).catch(() => undefined);
    return { status: "failed", summary: { error: message } };
  }
}

/* ------------------------------------------------------------------ */
/* Merchant reminders: per-day idempotency stored in job_runs           */
/* ------------------------------------------------------------------ */

async function runMerchantRemindersPersisted(db: Db, now: Date) {
  const today = wibDate(now);
  const prefix = "reminder:";
  const existing = await db
    .select({ name: jobRuns.name })
    .from(jobRuns)
    .where(like(jobRuns.name, `${prefix}%:${today}`));
  const remembered = new Set(existing.map((r) => r.name.slice(prefix.length)));
  const before = new Set(remembered);
  const summary = await runMerchantReminders(db, now, remembered);
  const added = [...remembered].filter((k) => !before.has(k));
  if (added.length) {
    await db
      .insert(jobRuns)
      .values(added.map((k) => ({ name: `${prefix}${k}`, lastRunAt: now, lastStatus: "ok" })))
      .onConflictDoNothing();
  }
  return summary;
}

/* ------------------------------------------------------------------ */
/* Demo mode: keep "tonight" populated                                 */
/* ------------------------------------------------------------------ */

export interface TopUpSummary {
  liveBefore: number;
  published: number;
}

/** Live = ACTIVE, has stock, and stays open at least another 20 minutes. */
async function countLiveBatches(db: Db, now: Date): Promise<number> {
  const soon = new Date(now.getTime() + 20 * MINUTE_MS);
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(surplusBatches)
    .where(
      and(eq(surplusBatches.status, "ACTIVE"), gt(surplusBatches.availableStock, 0), gt(surplusBatches.pickupEndTime, soon)),
    );
  return row?.n ?? 0;
}

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/**
 * When fewer than `minLive` batches are live, publishes fresh batches (through the
 * normal publish path: optimizer price, INITIAL_PUBLISH log) for open warung that have
 * nothing live, until the target is reached. Closing times are spread 50–170 minutes
 * ahead so every discount tier (Hemat → Flash Rescue) shows up over time.
 */
export async function topUpDemoBatches(
  db: Db,
  now: Date = new Date(),
  opts: { minLive?: number; perMerchant?: number } = {},
): Promise<TopUpSummary> {
  const minLive = opts.minLive ?? 18;
  const perMerchant = opts.perMerchant ?? 2;
  const liveBefore = await countLiveBatches(db, now);
  if (liveBefore >= minLive) return { liveBefore, published: 0 };

  const soon = new Date(now.getTime() + 20 * MINUTE_MS);
  const liveMerchantRows = await db
    .selectDistinct({ id: surplusBatches.merchantId })
    .from(surplusBatches)
    .where(and(eq(surplusBatches.status, "ACTIVE"), gt(surplusBatches.pickupEndTime, soon)));
  const busy = new Set(liveMerchantRows.map((r) => r.id));

  const open = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.isOpen, true));
  const candidates = open.map((m) => m.id).filter((id) => !busy.has(id));
  if (!candidates.length) return { liveBefore, published: 0 };

  const menuRows = await db
    .select({ id: menus.id, merchantId: menus.merchantId })
    .from(menus)
    .where(and(inArray(menus.merchantId, candidates), eq(menus.isActive, true)));

  let live = liveBefore;
  let published = 0;
  // Shuffle so different warung light up on different visits.
  for (const merchantId of candidates.sort(() => Math.random() - 0.5)) {
    if (live >= minLive) break;
    const own = menuRows.filter((m) => m.merchantId === merchantId).slice(0, perMerchant);
    for (const menu of own) {
      try {
        await publishSurplus(
          db,
          merchantId,
          {
            menu_id: menu.id,
            initial_stock: randInt(3, 10),
            pickup_end_time: new Date(now.getTime() + randInt(50, 170) * MINUTE_MS).toISOString(),
            auto_discount_enabled: true,
          },
          now,
        );
        published++;
        live++;
      } catch (err) {
        console.warn("[jobs] demo top-up publish failed", err instanceof Error ? err.message : err);
      }
    }
  }
  return { liveBefore, published };
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export type DueJobsSummary = Record<string, JobResult>;

/** Runs every job that is due right now (each behind its own lease). */
export async function runDueJobs(db: Db, now: Date = new Date()): Promise<DueJobsSummary> {
  const out: DueJobsSummary = {};
  out.minute = await runLeased(db, "minute", now, MINUTE_MS - 1_000, () => runMinuteJobs(db, now));
  out.merchantReminders = await runLeased(db, "merchant-reminders", now, MINUTE_MS - 1_000, () =>
    runMerchantRemindersPersisted(db, now),
  );
  if (isDemoMode()) {
    // Before escalation, so fresh batches get their first price check in the same pass.
    out.demoTopUp = await runLeased(db, "demo-top-up", now, 2 * MINUTE_MS - 1_000, () => topUpDemoBatches(db, now));
  }
  out.escalation = await runLeased(db, "escalation", now, ESCALATION_INTERVAL_MINUTES * MINUTE_MS - 1_000, () =>
    runEscalationJobs(db, now),
  );

  // Daily calendar jobs: one lease per WIB day ("name:YYYY-MM-DD", never re-acquired).
  const today = wibDate(now);
  const calendar = [
    { name: "prediction-refresh", at: "00:15", run: () => runPredictionRefresh(db, now) },
    { name: "proactive-notifications", at: "17:30", until: "20:30", run: () => runProactiveNotifications(db, now) },
  ];
  for (const job of calendar) {
    if (!isCalendarJobDue(job, now)) continue;
    // The lease name already carries the WIB date, so 48 h simply means "never again today".
    out[job.name] = await runLeased(db, `${job.name}:${today}`, now, 48 * 60 * MINUTE_MS, job.run);
  }
  return out;
}
