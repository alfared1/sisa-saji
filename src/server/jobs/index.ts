/**
 * Background jobs (blueprint §2.2.D / §2.3), run by scripts/worker.ts.
 *
 *   every 1 min   runMinuteJobs        expire unpaid checkouts, close unclaimed paid orders
 *                                       (no-show), activate due SCHEDULED batches, close
 *                                       ended batches, end lapsed premium, prune presence,
 *                                       merchant "publish tonight?" reminders
 *   every 5 min   runEscalationJobs    time-decay discount escalation (+ Diskon Kilat push)
 *   daily 00:15   runPredictionRefresh heuristic-v0 predictions for today..+6
 *   daily 17:30   runProactiveNotifications  AI-prediction push to subscribers
 *   Sun 02:00     weekly ML training (ml/train_predict.py → lgbm-v1)
 *
 * Every job takes (db, now) so tests can drive time. Daily/weekly jobs are
 * idempotent twice over: the scheduler remembers the last run date in memory and
 * the jobs themselves are guarded by data (proactive_notif_sent, a batch already
 * published today, fresh lgbm-v1 rows).
 */
import "server-only";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { merchants, merchantSurplusPredictions } from "@/db/schema";
import { ESCALATION_INTERVAL_MINUTES } from "@/lib/constants";
import { DAY_MS, wibDate, wibDayOfWeek, wibTime } from "@/lib/time";
import { runEscalation, type EscalationSummary } from "@/server/services/escalation";
import { subscriberIds } from "@/server/services/merchant/notify";
import { expireSubscriptions } from "@/server/services/merchant/profile";
import { activateScheduledBatches } from "@/server/services/merchant/surplus";
import { LGBM_MODEL_VERSION, refreshHeuristicPredictions, type RefreshSummary } from "@/server/services/prediction";
import { sendPushToUsers } from "@/server/services/push";
import { closeUnclaimedOrders } from "@/server/services/orders/pickup";
import { prunePresence } from "@/server/services/presence";
import { closeEndedBatches, expirePendingOrders } from "@/server/services/stock";

export const PROACTIVE_MIN_PORTIONS = 5;
export const PROACTIVE_MIN_CONFIDENCE = 0.7;
/** Merchant reminder lead time before default_surplus_start_time. */
export const MERCHANT_REMINDER_LEAD_MINUTES = 30;
export const PREDICTION_HORIZON_DAYS = 7;

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/* ------------------------------------------------------------------ */
/* Minute jobs                                                         */
/* ------------------------------------------------------------------ */

export interface MinuteSummary {
  expiredOrders: number;
  /** Paid orders not collected by deadline + grace (no-show → EXPIRED, warung credited). */
  unclaimedOrders: number;
  activatedBatches: number;
  expiredScheduledBatches: number;
  closedBatches: number;
  expiredSubscriptions: number;
  liveNotifiedDevices: number;
  /** customer_presence rows older than PRESENCE_RETENTION_HOURS deleted. */
  prunedPresence: number;
}

export async function runMinuteJobs(db: Db, now: Date = new Date()): Promise<MinuteSummary> {
  // Order matters: expiring unpaid checkouts first returns their stock, so a batch
  // closed in the same tick is classified SOLD_OUT vs EXPIRED correctly.
  const expiredOrders = await expirePendingOrders(db, now);
  const unclaimedOrders = await closeUnclaimedOrders(db, now);
  const activation = await activateScheduledBatches(db, now);
  const closedBatches = await closeEndedBatches(db, now);
  const expiredSubscriptions = await expireSubscriptions(db, now);
  const prunedPresence = await prunePresence(db, now);
  return {
    expiredOrders,
    unclaimedOrders,
    activatedBatches: activation.activated,
    expiredScheduledBatches: activation.expired,
    closedBatches,
    expiredSubscriptions,
    liveNotifiedDevices: activation.notifiedDevices,
    prunedPresence,
  };
}

/* ------------------------------------------------------------------ */
/* Escalation                                                          */
/* ------------------------------------------------------------------ */

export function runEscalationJobs(db: Db, now: Date = new Date()): Promise<EscalationSummary> {
  return runEscalation(db, now);
}

/* ------------------------------------------------------------------ */
/* Daily: predictions                                                  */
/* ------------------------------------------------------------------ */

export function runPredictionRefresh(db: Db, now: Date = new Date()): Promise<RefreshSummary> {
  return refreshHeuristicPredictions(db, wibDate(now), PREDICTION_HORIZON_DAYS);
}

/* ------------------------------------------------------------------ */
/* Daily 17:30: proactive AI-prediction notifications                  */
/* ------------------------------------------------------------------ */

export interface ProactiveSummary {
  merchants: number;
  notifiedDevices: number;
}

/**
 * Tonight's merchant-level predictions with ≥ 5 portions and confidence ≥ 0.70
 * that were not announced yet: claim (proactive_notif_sent = true) then push to
 * subscribers with notify_on_ai_prediction. Claim-first keeps it at-most-once
 * even if two workers run.
 */
export async function runProactiveNotifications(db: Db, now: Date = new Date()): Promise<ProactiveSummary> {
  const today = wibDate(now);
  const claimed = await db
    .update(merchantSurplusPredictions)
    .set({ proactiveNotifSent: true })
    .where(
      and(
        eq(merchantSurplusPredictions.targetDate, today),
        isNull(merchantSurplusPredictions.menuId),
        eq(merchantSurplusPredictions.proactiveNotifSent, false),
        gte(merchantSurplusPredictions.predictedSurplusPortions, PROACTIVE_MIN_PORTIONS),
        gte(merchantSurplusPredictions.confidenceScore, PROACTIVE_MIN_CONFIDENCE),
      ),
    )
    .returning({
      merchantId: merchantSurplusPredictions.merchantId,
      portions: merchantSurplusPredictions.predictedSurplusPortions,
      peak: merchantSurplusPredictions.predictedPeakSurplusHour,
    });
  const summary: ProactiveSummary = { merchants: claimed.length, notifiedDevices: 0 };
  if (!claimed.length) return summary;

  const info = await db
    .select({ id: merchants.id, name: merchants.merchantName, slug: merchants.slug })
    .from(merchants)
    .where(inArray(merchants.id, claimed.map((c) => c.merchantId)));
  const byId = new Map(info.map((m) => [m.id, m]));
  for (const c of claimed) {
    const m = byId.get(c.merchantId);
    if (!m) continue;
    try {
      const ids = await subscriberIds(db, m.id, "notify_on_ai_prediction");
      summary.notifiedDevices += await sendPushToUsers(db, ids, {
        title: `Prediksi AI: ${m.name} malam ini`,
        body: `Diperkirakan ada ~${Math.round(Number(c.portions))} porsi surplus mulai pukul ${c.peak.slice(0, 5).replace(":", ".")}. Pantau diskonnya di Sisa-Saji!`,
        url: `/warung/${m.slug}`,
        tag: `prediction-${m.id}-${today}`,
      });
    } catch (err) {
      console.warn("[jobs] proactive push failed", err instanceof Error ? err.message : err);
    }
  }
  return summary;
}

/* ------------------------------------------------------------------ */
/* Merchant reminder (~30 min before default_surplus_start_time)       */
/* ------------------------------------------------------------------ */

export interface ReminderSummary {
  reminded: number;
  notifiedDevices: number;
}

/**
 * Open warung whose surplus window starts within the next 30 minutes and that have
 * not published anything today get "Siap publikasikan porsi surplus malam ini?".
 * `remembered` (key merchantId:date) keeps it to one reminder per warung per day.
 */
export async function runMerchantReminders(
  db: Db,
  now: Date = new Date(),
  remembered: Set<string> = new Set(),
): Promise<ReminderSummary> {
  const today = wibDate(now);
  const nowMin = toMinutes(wibTime(now));
  const rows = await db
    .select({
      id: merchants.id,
      ownerUserId: merchants.ownerUserId,
      start: merchants.defaultSurplusStartTime,
      // Explicit alias + qualified outer column: inside select fields drizzle renders
      // column refs unqualified, so `id` would resolve to surplus_batches.id.
      publishedToday: sql<boolean>`EXISTS (
        SELECT 1 FROM surplus_batches sb
        WHERE sb.merchant_id = "merchants"."id"
          AND sb.batch_date = ${today}::date)`,
    })
    .from(merchants)
    .where(eq(merchants.isOpen, true));

  const summary: ReminderSummary = { reminded: 0, notifiedDevices: 0 };
  for (const m of rows) {
    const startMin = toMinutes(m.start);
    const due = nowMin >= startMin - MERCHANT_REMINDER_LEAD_MINUTES && nowMin < startMin;
    const key = `${m.id}:${today}`;
    if (!due || m.publishedToday || remembered.has(key)) continue;
    remembered.add(key);
    summary.reminded++;
    try {
      summary.notifiedDevices += await sendPushToUsers(db, [m.ownerUserId], {
        title: "Siap publikasikan porsi surplus malam ini?",
        body: `Jam surplus Anda mulai pukul ${m.start.slice(0, 5).replace(":", ".")}. Cek prediksi AI lalu publikasikan dalam 1 menit.`,
        url: "/merchant/surplus/new",
        tag: `merchant-reminder-${today}`,
      });
    } catch (err) {
      console.warn("[jobs] merchant reminder failed", err instanceof Error ? err.message : err);
    }
  }
  return summary;
}

/* ------------------------------------------------------------------ */
/* Weekly ML guard                                                     */
/* ------------------------------------------------------------------ */

/** True when lgbm-v1 predictions were written in the last 24 h (training already ran). */
export async function hasFreshLgbmPredictions(db: Db, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - DAY_MS);
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(merchantSurplusPredictions)
    .where(
      and(
        eq(merchantSurplusPredictions.modelVersion, LGBM_MODEL_VERSION),
        gte(merchantSurplusPredictions.createdAt, since),
      ),
    );
  return (row?.n ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

export interface CalendarJob {
  name: string;
  /** "HH:MM" WIB: earliest run time of the day. */
  at: string;
  /** "HH:MM" WIB: no catch-up run at or after this time (optional). */
  until?: string;
  /** 0 = Minggu … 6 = Sabtu; omitted = every day. */
  weekday?: number;
  run: (now: Date) => Promise<unknown>;
}

/** Due when inside [at, until) on the right weekday and not yet run today (WIB). */
export function isCalendarJobDue(job: Pick<CalendarJob, "at" | "until" | "weekday">, now: Date, lastRunDate?: string) {
  const today = wibDate(now);
  if (lastRunDate === today) return false;
  if (job.weekday !== undefined && wibDayOfWeek(today) !== job.weekday) return false;
  const t = toMinutes(wibTime(now));
  if (t < toMinutes(job.at)) return false;
  if (job.until && t >= toMinutes(job.until)) return false;
  return true;
}

export interface SchedulerOptions {
  db: Db;
  log?: (msg: string) => void;
  /**
   * Weekly ML training; omitted = disabled (e.g. no .venv). Resolves to the exit code;
   * must stop (kill Python) when `signal` aborts. Runs in the background, never inside a tick.
   */
  runMl?: (signal: AbortSignal) => Promise<number>;
}

export function createScheduler(opts: SchedulerOptions) {
  const { db } = opts;
  const log = opts.log ?? ((m: string) => console.log(m));
  const state = {
    lastMinuteRun: 0,
    lastEscalationRun: 0,
    lastCalendarRun: new Map<string, string>(),
    remindedMerchants: new Set<string>(),
    running: false,
  };
  /** The tick being executed; returned to overlapping callers so shutdown awaits real work. */
  let inflight: Promise<void> | null = null;
  /** Background ML training (fire-and-track: minute jobs keep running meanwhile). */
  let mlRun: Promise<void> | null = null;
  const mlAbort = new AbortController();

  async function guarded<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    const t0 = Date.now();
    try {
      const result = await fn();
      log(`[job] ${name} ok in ${Date.now() - t0} ms ${JSON.stringify(result)}`);
      return result;
    } catch (err) {
      log(`[job] ${name} FAILED: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      return undefined;
    }
  }

  const calendar: CalendarJob[] = [
    { name: "prediction-refresh", at: "00:15", run: (now) => runPredictionRefresh(db, now) },
    // After ~20:30 the evening's surplus is already live, an AI "heads-up" is pointless.
    { name: "proactive-notifications", at: "17:30", until: "20:30", run: (now) => runProactiveNotifications(db, now) },
  ];
  if (opts.runMl) {
    const runMl = opts.runMl;
    calendar.push({
      name: "ml-training",
      at: "02:00",
      weekday: 0,
      run: async (now) => {
        if (mlRun) return { skipped: "training masih berjalan" };
        if (mlAbort.signal.aborted) return { skipped: "worker berhenti" };
        if (await hasFreshLgbmPredictions(db, now)) return { skipped: "lgbm-v1 sudah diperbarui < 24 jam" };
        mlRun = guarded("ml-training (background)", async () => {
          const exitCode = await runMl(mlAbort.signal);
          if (exitCode !== 0) throw new Error(`ml/train_predict.py exit code ${exitCode}`);
          return { exitCode };
        }).then(
          () => undefined,
          () => undefined,
        );
        void mlRun.finally(() => {
          mlRun = null;
        });
        return { started: "background" };
      },
    });
  }

  /** One scheduler pass; call every ~30 s. An overlapping call returns the running pass. */
  function tick(now: Date = new Date()): Promise<void> {
    if (inflight) return inflight;
    inflight = runTick(now).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function runTick(now: Date) {
    state.running = true;
    try {
      const ms = now.getTime();
      if (ms - state.lastMinuteRun >= 60_000 - 1_000) {
        state.lastMinuteRun = ms;
        await guarded("minute", () => runMinuteJobs(db, now));
        await guarded("merchant-reminders", () => runMerchantReminders(db, now, state.remindedMerchants));
      }
      if (ms - state.lastEscalationRun >= ESCALATION_INTERVAL_MINUTES * 60_000 - 1_000) {
        state.lastEscalationRun = ms;
        await guarded("escalation", () => runEscalationJobs(db, now));
      }
      for (const job of calendar) {
        if (!isCalendarJobDue(job, now, state.lastCalendarRun.get(job.name))) continue;
        state.lastCalendarRun.set(job.name, wibDate(now));
        await guarded(job.name, () => job.run(now));
      }
      // Forget reminder keys of past days.
      const today = wibDate(now);
      for (const k of state.remindedMerchants) if (!k.endsWith(today)) state.remindedMerchants.delete(k);
    } finally {
      state.running = false;
    }
  }

  /** Shutdown: abort ML training (kills Python) and wait for the running pass and training. */
  async function stop() {
    mlAbort.abort();
    await Promise.allSettled([inflight, mlRun]);
  }

  return { tick, stop, state, calendar, isMlRunning: () => mlRun !== null };
}
