import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { menus, merchants, orders, users, type Merchant } from "@/db/schema";
import { DEMO_MERCHANT_SLUG } from "@/db/seed/data";
import { AnalyticsQuery, MerchantOrdersQuery, PublishBody } from "@/lib/contracts";
import { wibDate } from "@/lib/time";
import { getMerchantDashboard, listMerchantOrders } from "@/server/services/merchant/dashboard";
import { getAnalytics, getInsights } from "@/server/services/merchant/insights";
import { pollMerchantEvents } from "@/server/services/merchant/stream";
import { publishSurplus } from "@/server/services/merchant/surplus";
import { reseed, testDb } from "../helpers/db";

const { db, close } = testDb();
let merchant: Merchant;

beforeAll(async () => {
  await reseed(db);
  const [row] = await db
    .select({ merchant: merchants })
    .from(merchants)
    .innerJoin(users, eq(users.id, merchants.ownerUserId))
    .where(eq(users.email, "demo.mitra@sisasaji.test"));
  merchant = row.merchant;
});
afterAll(close);

describe("GET /merchant/dashboard", () => {
  it("returns today's stats, live batches, pending pickups and tonight's AI prediction", async () => {
    const d = await getMerchantDashboard(db, merchant.id);
    expect(d.merchant.id).toBe(merchant.id);
    for (const k of ["revenue_idr", "orders_completed", "orders_pending_pickup", "portions_sold", "food_saved_grams", "co2_avoided_grams"] as const) {
      expect(Number.isInteger(d.today[k])).toBe(true);
      expect(d.today[k]).toBeGreaterThanOrEqual(0);
    }
    expect(d.active_batches.length).toBeGreaterThan(0);
    for (const b of d.active_batches) {
      expect(b.initial_stock).toBe(b.available_stock + b.reserved_stock + b.sold);
      expect(["ACTIVE", "SCHEDULED", "SOLD_OUT"]).toContain(b.status);
    }
    // The demo customer always has a READY_FOR_PICKUP ticket at the demo warung (Teh Euis).
    expect(d.pending_pickups.some((o) => o.status === "READY_FOR_PICKUP")).toBe(true);
    expect(d.today.orders_pending_pickup).toBe(d.pending_pickups.length);
    expect(d.ai_prediction).not.toBeNull();
    expect(d.ai_prediction!.target_date).toBe(wibDate());
    expect(d.ai_prediction!.peak_hour).toMatch(/^\d{2}:\d{2}$/);
    expect(d.ai_prediction!.per_menu.length).toBeGreaterThan(0);
  });
});

describe("GET /merchant/orders", () => {
  it("filters by status (incl. ACTIVE) and WIB date, merchant viewer only", async () => {
    const all = await listMerchantOrders(db, merchant.id, MerchantOrdersQuery.parse({ limit: "200" }));
    expect(all.orders.length).toBeGreaterThan(0);
    expect(all.orders.every((o) => o.merchant.id === merchant.id)).toBe(true);

    const active = await listMerchantOrders(db, merchant.id, MerchantOrdersQuery.parse({ status: "ACTIVE" }));
    expect(active.orders.length).toBeGreaterThan(0);
    expect(active.orders.every((o) => ["PENDING_PAYMENT", "PAID", "READY_FOR_PICKUP"].includes(o.status))).toBe(true);

    const completed = await listMerchantOrders(db, merchant.id, MerchantOrdersQuery.parse({ status: "COMPLETED", limit: "5" }));
    expect(completed.orders.length).toBeLessThanOrEqual(5);
    expect(completed.orders.every((o) => o.status === "COMPLETED")).toBe(true);

    const [oldest] = await db.select().from(orders).where(eq(orders.merchantId, merchant.id)).orderBy(asc(orders.createdAt)).limit(1);
    const day = wibDate(oldest.createdAt);
    const byDate = await listMerchantOrders(db, merchant.id, MerchantOrdersQuery.parse({ date: day, limit: "200" }));
    expect(byDate.orders.length).toBeGreaterThan(0);
    expect(byDate.orders.every((o) => wibDate(new Date(o.created_at)) === day)).toBe(true);
  });
});

describe("GET /merchant/predictions/insights", () => {
  it("returns a 7-day outlook, a weekday × menu heatmap and advisories", async () => {
    const r = await getInsights(db, merchant.id);
    expect(r.week).toHaveLength(7);
    expect(r.week[0].date).toBe(wibDate());
    for (const w of r.week) {
      expect(w.day_of_week).toBeGreaterThanOrEqual(0);
      expect(w.day_of_week).toBeLessThanOrEqual(6);
      expect(w.confidence_score).toBeGreaterThan(0);
    }
    expect(r.heatmap.length).toBeGreaterThan(0);
    for (const h of r.heatmap) expect(h.avg_leftover_portions).toBeLessThanOrEqual(h.avg_surplus_portions);
    expect(r.advisories.length).toBeGreaterThan(0);
    expect(["heuristic-v0", "lgbm-v1"]).toContain(r.model_version);
  });
});

describe("GET /merchant/analytics", () => {
  it("aggregates the last N days consistently", async () => {
    const { range_days } = AnalyticsQuery.parse({});
    const a = await getAnalytics(db, merchant.id, range_days);
    expect(a.range_days).toBe(30);
    expect(a.daily).toHaveLength(30);
    expect(a.portions_published).toBeGreaterThan(0);
    expect(a.portions_sold).toBeLessThanOrEqual(a.portions_published);
    expect(a.sell_through_rate).toBeGreaterThan(0);
    expect(a.sell_through_rate).toBeLessThanOrEqual(1);
    expect(a.revenue_recovered_idr).toBe(a.daily.reduce((s, d) => s + d.revenue_idr, 0));
    expect(a.revenue_recovered_idr).toBeLessThanOrEqual(a.potential_revenue_idr);
    expect(a.top_menus.length).toBeGreaterThan(0);
    expect(a.subscription.price_idr).toBe(50_000);

    const week = await getAnalytics(db, merchant.id, 7);
    expect(week.daily).toHaveLength(7);
    expect(week.portions_published).toBeLessThanOrEqual(a.portions_published);
  });
});

describe("merchant SSE poller", () => {
  it("reports batch changes since the cursor", async () => {
    const since = new Date(Date.now() - 1000);
    const [menu] = await db
      .select()
      .from(menus)
      .where(and(eq(menus.merchantId, merchant.id), eq(menus.isActive, true)))
      .limit(1);
    const { batch } = await publishSurplus(
      db,
      merchant.id,
      PublishBody.parse({ menu_id: menu.id, initial_stock: 4, pickup_end_time: new Date(Date.now() + 90 * 60_000).toISOString() }),
    );
    const events = await pollMerchantEvents(db, merchant.id, since);
    const ev = events.find((e) => e.event.type === "batch.updated" && e.event.batch_id === batch.id);
    expect(ev).toBeDefined();
    expect(ev!.event).toMatchObject({ type: "batch.updated", available_stock: 4, status: "ACTIVE" });

    // Another merchant's changes never leak into this stream.
    const [other] = await db.select().from(merchants).where(eq(merchants.slug, DEMO_MERCHANT_SLUG));
    expect(other.id).toBe(merchant.id);
    const later = await pollMerchantEvents(db, merchant.id, new Date(Date.now() + 60_000));
    expect(later).toEqual([]);
  });
});
