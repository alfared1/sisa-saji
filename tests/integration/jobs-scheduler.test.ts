import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, isNull } from "drizzle-orm";
import { menus, merchants, merchantSurplusPredictions, orders, surplusBatches, users, type Menu, type Merchant } from "@/db/schema";
import { CheckoutBody, PublishBody } from "@/lib/contracts";
import { atWib, wibDate } from "@/lib/time";
import {
  createScheduler,
  hasFreshLgbmPredictions,
  runMerchantReminders,
  runMinuteJobs,
  runPredictionRefresh,
  runProactiveNotifications,
} from "@/server/jobs";
import { checkout } from "@/server/services/orders/checkout";
import { publishSurplus } from "@/server/services/merchant/surplus";
import { getPrediction } from "@/server/services/prediction";
import { shiftDate } from "@/server/services/prediction/heuristic";
import { reseed, testDb } from "../helpers/db";
import { TEST_PICKUP_QR_SECRET } from "../setup/constants";

const { db, close } = testDb();
const MIN = 60_000;
const T0 = new Date();
const at = (m: number) => new Date(T0.getTime() + m * MIN);
let merchant: Merchant;
let menu: Menu;
let customerId: string;

const batch = async (id: string) => (await db.select().from(surplusBatches).where(eq(surplusBatches.id, id)))[0];

beforeAll(async () => {
  await reseed(db, T0);
  const [r] = await db
    .select({ merchant: merchants })
    .from(merchants)
    .innerJoin(users, eq(users.id, merchants.ownerUserId))
    .where(eq(users.email, "demo.mitra@sisasaji.test"));
  merchant = r.merchant;
  [menu] = await db
    .select()
    .from(menus)
    .where(and(eq(menus.merchantId, merchant.id), eq(menus.isActive, true)))
    .orderBy(asc(menus.createdAt))
    .limit(1);
  const [c] = await db.select().from(users).where(eq(users.email, "demo.pembeli@sisasaji.test"));
  customerId = c.id;
});
afterAll(close);

describe("runMinuteJobs", () => {
  it("activates due SCHEDULED batches, expires unpaid checkouts (releasing stock) and closes ended batches", async () => {
    const scheduled = (
      await publishSurplus(
        db,
        merchant.id,
        PublishBody.parse({ menu_id: menu.id, initial_stock: 6, pickup_start_time: at(30).toISOString(), pickup_end_time: at(150).toISOString() }),
        T0,
      )
    ).batch;
    const live = (
      await publishSurplus(db, merchant.id, PublishBody.parse({ menu_id: menu.id, initial_stock: 5, pickup_end_time: at(60).toISOString() }), T0)
    ).batch;
    expect(scheduled.status).toBe("SCHEDULED");

    const order = await checkout(db, {
      userId: customerId,
      pickupQrSecret: TEST_PICKUP_QR_SECRET,
      now: T0,
      input: CheckoutBody.parse({ merchant_id: merchant.id, items: [{ batch_id: live.id, quantity: 2 }] }),
    });
    expect(await batch(live.id)).toMatchObject({ availableStock: 3, reservedStock: 2 });

    // Not due yet.
    let s = await runMinuteJobs(db, at(5));
    expect((await batch(scheduled.id)).status).toBe("SCHEDULED");
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe("PENDING_PAYMENT");

    // 11 min: the 10-minute payment window has lapsed → EXPIRED + stock back via stock.ts.
    s = await runMinuteJobs(db, at(11));
    expect(s.expiredOrders).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0].status).toBe("EXPIRED");
    expect(await batch(live.id)).toMatchObject({ availableStock: 5, reservedStock: 0, status: "ACTIVE" });

    // 31 min: scheduled batch goes live.
    s = await runMinuteJobs(db, at(31));
    expect(s.activatedBatches).toBeGreaterThanOrEqual(1);
    expect((await batch(scheduled.id)).status).toBe("ACTIVE");

    // 61 min: the live batch's window ended with stock left → EXPIRED.
    s = await runMinuteJobs(db, at(61));
    expect(s.closedBatches).toBeGreaterThanOrEqual(1);
    expect((await batch(live.id)).status).toBe("EXPIRED");
    expect((await batch(scheduled.id)).status).toBe("ACTIVE");
  });
});

describe("prediction jobs", () => {
  it("refreshHeuristicPredictions upserts heuristic rows but never overwrites lgbm-v1", async () => {
    const today = wibDate(T0);
    await db
      .update(merchantSurplusPredictions)
      .set({ modelVersion: "lgbm-v1", predictedSurplusPortions: 42.5 })
      .where(
        and(
          eq(merchantSurplusPredictions.merchantId, merchant.id),
          isNull(merchantSurplusPredictions.menuId),
          eq(merchantSurplusPredictions.targetDate, today),
        ),
      );
    const summary = await runPredictionRefresh(db, T0);
    expect(summary.upserted).toBeGreaterThan(0);
    expect(summary.skippedLgbm).toBeGreaterThanOrEqual(1);

    const p = await getPrediction(db, merchant.id, null, today);
    expect(p).toMatchObject({ modelVersion: "lgbm-v1", predictedSurplusPortions: 42.5, source: "stored" });

    const menuP = await getPrediction(db, merchant.id, menu.id, shiftDate(today, 3));
    expect(menuP.modelVersion).toBe("heuristic-v0");
    expect(menuP.source).toBe("stored");
    expect(await hasFreshLgbmPredictions(db, T0)).toBe(true);

    // Beyond the stored horizon the heuristic is computed on the fly.
    const far = await getPrediction(db, merchant.id, menu.id, shiftDate(today, 20));
    expect(far.source).toBe("computed");
    expect(far.modelVersion).toBe("heuristic-v0");
  });

  it("proactive notifications claim qualifying rows exactly once", async () => {
    const today = wibDate(T0);
    await db
      .update(merchantSurplusPredictions)
      .set({ predictedSurplusPortions: 9, confidenceScore: 0.85, proactiveNotifSent: false })
      .where(
        and(
          eq(merchantSurplusPredictions.merchantId, merchant.id),
          isNull(merchantSurplusPredictions.menuId),
          eq(merchantSurplusPredictions.targetDate, today),
        ),
      );
    const first = await runProactiveNotifications(db, T0);
    expect(first.merchants).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(merchantSurplusPredictions)
      .where(
        and(
          eq(merchantSurplusPredictions.merchantId, merchant.id),
          isNull(merchantSurplusPredictions.menuId),
          eq(merchantSurplusPredictions.targetDate, today),
        ),
      );
    expect(row.proactiveNotifSent).toBe(true);
    const second = await runProactiveNotifications(db, T0);
    expect(second.merchants).toBe(0);

    // The heuristic refresh keeps the flag of rows it updates.
    await db.update(merchantSurplusPredictions).set({ modelVersion: "heuristic-v0" }).where(eq(merchantSurplusPredictions.id, row.id));
    await runPredictionRefresh(db, T0);
    const [after] = await db.select().from(merchantSurplusPredictions).where(eq(merchantSurplusPredictions.id, row.id));
    expect(after.proactiveNotifSent).toBe(true);
  });
});

describe("merchant reminders", () => {
  it("reminds open warung ~30 min before their surplus start, once per day, unless already published", async () => {
    const day = shiftDate(wibDate(T0), 3); // no batches published for that day yet
    const now = atWib(day, "19:40"); // default_surplus_start_time 20:00 for the seed warung
    const remembered = new Set<string>();
    const first = await runMerchantReminders(db, now, remembered);
    expect(first.reminded).toBeGreaterThan(0);
    expect(remembered.has(`${merchant.id}:${day}`)).toBe(merchant.defaultSurplusStartTime === "20:00:00");
    const again = await runMerchantReminders(db, now, remembered);
    expect(again.reminded).toBe(0);

    // Too early (2 h before) → nobody whose surplus starts at 20:00 is reminded.
    const earlySet = new Set<string>();
    await runMerchantReminders(db, atWib(day, "18:00"), earlySet);
    expect(earlySet.has(`${merchant.id}:${day}`)).toBe(false);

    // Already published for that day → no reminder.
    const today = wibDate(T0);
    const todaySet = new Set<string>();
    const dueToday = new Date(atWib(today, merchant.defaultSurplusStartTime.slice(0, 5)).getTime() - 20 * MIN);
    await runMerchantReminders(db, dueToday, todaySet);
    expect(todaySet.has(`${merchant.id}:${today}`)).toBe(false);
  });
});

describe("createScheduler", () => {
  it("runs minute + escalation jobs and due calendar jobs once per day", async () => {
    const lines: string[] = [];
    const scheduler = createScheduler({ db, log: (m) => lines.push(m) });
    const day = shiftDate(wibDate(T0), 1);
    const t = atWib(day, "17:35");
    await scheduler.tick(t);
    expect(lines.some((l) => l.startsWith("[job] minute ok"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[job] escalation ok"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[job] prediction-refresh ok"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[job] proactive-notifications ok"))).toBe(true);
    expect(lines.some((l) => l.includes("FAILED"))).toBe(false);

    lines.length = 0;
    await scheduler.tick(new Date(t.getTime() + 30_000)); // 30 s later: nothing is due
    expect(lines).toEqual([]);

    await scheduler.tick(new Date(t.getTime() + 61_000));
    expect(lines.some((l) => l.startsWith("[job] minute ok"))).toBe(true);
    expect(lines.some((l) => l.startsWith("[job] prediction-refresh"))).toBe(false);
    expect(scheduler.calendar.map((c) => c.name)).not.toContain("ml-training"); // no runMl given
  });

  it("an overlapping tick returns the in-flight pass (so shutdown awaits the real work)", async () => {
    const scheduler = createScheduler({ db, log: () => {} });
    const t = atWib(shiftDate(wibDate(T0), 2), "21:00");
    const first = scheduler.tick(t);
    const second = scheduler.tick(new Date(t.getTime() + 30_000));
    expect(second).toBe(first);
    await second;
    expect(scheduler.state.running).toBe(false);
  });

  it("weekly ML training runs in the background (ticks keep going) and stop() aborts it", async () => {
    const lines: string[] = [];
    let aborted = false;
    const scheduler = createScheduler({
      db,
      log: (m) => lines.push(m),
      runMl: (signal) =>
        new Promise<number>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve(1);
          });
        }),
    });
    // A Sunday, 02:05 WIB.
    let day = shiftDate(wibDate(T0), 3);
    while (new Date(`${day}T12:00:00+07:00`).getUTCDay() !== 0) day = shiftDate(day, 1);
    await db.delete(merchantSurplusPredictions).where(eq(merchantSurplusPredictions.modelVersion, "lgbm-v1"));
    const t = atWib(day, "02:05");
    await scheduler.tick(t); // returns although training never finishes on its own
    expect(lines.some((l) => l.startsWith("[job] ml-training ok") && l.includes("background"))).toBe(true);
    expect(scheduler.isMlRunning()).toBe(true);

    lines.length = 0;
    await scheduler.tick(new Date(t.getTime() + 61_000)); // minute jobs are not blocked
    expect(lines.some((l) => l.startsWith("[job] minute ok"))).toBe(true);

    await scheduler.stop();
    expect(aborted).toBe(true);
    expect(scheduler.isMlRunning()).toBe(false);
  });
});
