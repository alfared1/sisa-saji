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
import { nearestCampus, isHomeRegion } from "@/lib/campuses";
import { CAMPUSES, ESCALATION_INTERVAL_MINUTES } from "@/lib/constants";
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

export interface TopUpOptions {
  /** Live batches every campus hub should keep (default 4). */
  minPerHub?: number;
  /** Live batches every home-region (Bogor) hub should keep (default 10). */
  minPerHomeHub?: number;
  /** Optional overall floor, filled after the per-hub targets (default 0). */
  minLive?: number;
  /** Menus published per warung per call (default 2). */
  perMerchant?: number;
  /** Publish at most this many batches per call: it runs inside a request (default 24). */
  maxPublish?: number;
}

export interface TopUpSummary {
  liveBefore: number;
  published: number;
  /** Batches published per hub id in this call. */
  byHub: Record<string, number>;
}

/** A warung counts for a hub when it is this close to it (the nearest hub wins). */
export const TOP_UP_HUB_RADIUS_M = 15_000;

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const shuffle = <T>(xs: T[]): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};

interface HubState {
  id: string;
  home: boolean;
  target: number;
  live: number;
  /** Open warung with nothing live, shuffled so different warung light up on different visits. */
  candidates: string[];
}

/** Hub that needs food most: lowest live/target ratio, then home region, then biggest gap. */
function neediest(hubs: HubState[], floorReached: boolean): HubState | undefined {
  const open = hubs.filter((h) => h.candidates.length > 0 && (h.live < h.target || !floorReached));
  return open.sort(
    (a, b) =>
      a.live / Math.max(1, a.target) - b.live / Math.max(1, b.target) ||
      Number(b.home) - Number(a.home) ||
      b.target - b.live - (a.target - a.live),
  )[0];
}

/**
 * DEMO_MODE: keeps every campus hub stocked with live food. Each hub (warung grouped by
 * their nearest hub) should have `minPerHub` live batches, Bogor hubs `minPerHomeHub`.
 * Hubs with the lowest live/target ratio are served first, so an empty hub anywhere
 * gets food before a half-full one gets more. Batches go through the normal publish
 * path (optimizer price, INITIAL_PUBLISH log) for open warung with nothing live, with
 * closing times spread 50–170 minutes ahead so every discount tier shows up over time.
 * At most `maxPublish` batches per call; once the targets are met a call publishes
 * nothing (idempotent).
 */
export async function topUpDemoBatches(db: Db, now: Date = new Date(), opts: TopUpOptions = {}): Promise<TopUpSummary> {
  const minPerHub = opts.minPerHub ?? 4;
  const minPerHomeHub = opts.minPerHomeHub ?? 10;
  const minLive = opts.minLive ?? 0;
  const perMerchant = opts.perMerchant ?? 2;
  const maxPublish = opts.maxPublish ?? 24;

  // Live = ACTIVE, has stock, and stays open at least another 20 minutes. A warung
  // with any ACTIVE batch that is not about to close is "busy" and is left alone.
  const soon = new Date(now.getTime() + 20 * MINUTE_MS);
  const perMerchantLive = await db
    .select({
      merchantId: surplusBatches.merchantId,
      live: sql<number>`(COUNT(*) FILTER (WHERE ${surplusBatches.availableStock} > 0))::int`,
    })
    .from(surplusBatches)
    .where(and(eq(surplusBatches.status, "ACTIVE"), gt(surplusBatches.pickupEndTime, soon)))
    .groupBy(surplusBatches.merchantId);
  const liveByMerchant = new Map(perMerchantLive.map((r) => [r.merchantId, r.live]));
  const liveBefore = perMerchantLive.reduce((n, r) => n + r.live, 0);

  const open = await db
    .select({ id: merchants.id, lat: merchants.latitude, lng: merchants.longitude })
    .from(merchants)
    .where(eq(merchants.isOpen, true));

  const hubs = new Map<string, HubState>(
    CAMPUSES.map((c) => {
      const home = isHomeRegion(c.region);
      return [c.id, { id: c.id, home, target: home ? minPerHomeHub : minPerHub, live: 0, candidates: [] }];
    }),
  );
  let openLive = 0;
  for (const m of shuffle(open)) {
    const live = liveByMerchant.get(m.id) ?? 0;
    openLive += live;
    const hub = nearestCampus({ lat: m.lat, lng: m.lng }, TOP_UP_HUB_RADIUS_M);
    if (!hub) continue;
    const state = hubs.get(hub.campus.id)!;
    state.live += live;
    if (!liveByMerchant.has(m.id)) state.candidates.push(m.id);
  }
  const hubList = [...hubs.values()];
  const byHub: Record<string, number> = {};
  if (!neediest(hubList, openLive >= minLive)) return { liveBefore, published: 0, byHub };

  const candidateIds = hubList.flatMap((h) => h.candidates);
  const menuRows = await db
    .select({ id: menus.id, merchantId: menus.merchantId })
    .from(menus)
    .where(and(inArray(menus.merchantId, candidateIds), eq(menus.isActive, true)))
    .orderBy(menus.merchantId, menus.id);

  let published = 0;
  while (published < maxPublish) {
    const hub = neediest(hubList, openLive >= minLive);
    if (!hub) break;
    const merchantId = hub.candidates.shift()!;
    const own = menuRows.filter((m) => m.merchantId === merchantId).slice(0, Math.min(perMerchant, maxPublish - published));
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
        hub.live++;
        openLive++;
        byHub[hub.id] = (byHub[hub.id] ?? 0) + 1;
      } catch (err) {
        console.warn("[jobs] demo top-up publish failed", err instanceof Error ? err.message : err);
      }
    }
  }
  return { liveBefore, published, byHub };
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
