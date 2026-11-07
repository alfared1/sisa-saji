/**
 * Sanity checks for a migrated + seeded database.
 *   npm run db:verify
 * Exits non-zero if any invariant fails.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { CAMPUSES, DEFAULT_SEARCH_RADIUS_M } from "../src/lib/constants";
import { getDatabaseUrl } from "../src/lib/env";
import { calculateOptimalRecoveryPrice } from "../src/lib/pricing/dynamic-discount";

async function main() {
  const { db, pool } = createDb(getDatabaseUrl(), { max: 1 });
  const ugm = CAMPUSES.find((c) => c.id === "ugm")!;
  let failures = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };
  const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) =>
    (await db.execute<T>(q)).rows[0];

  // 0. Pricing engine sanity (integer rounding; 70% must be exactly 70%).
  const q70 = calculateOptimalRecoveryPrice({
    originalPriceIdr: 20000,
    minRecoveryPriceIdr: 3000,
    availableStock: 6,
    minutesToClose: 20,
    activeUsersIn2km: 100,
  });
  check("Rp 20.000 @70% → Rp 6.000", q70.recommendedSellingPriceIdr === 6000 && q70.recommendedDiscountPct === 70);

  // 1. Radius discovery (core geo-query shape from blueprint §2.2.B). Independent of
  //    wall-clock time: the seeded "tonight" batches expire ~2.5 h after seeding.
  const nearby = await db.execute<{ merchant_name: string; distance_m: number; tier: string; active: number; live: number }>(sql`
    SELECT m.merchant_name, ROUND(ST_Distance(m.geom, ST_MakePoint(${ugm.lng}, ${ugm.lat})::geography))::int AS distance_m,
           m.subscription_tier AS tier, COUNT(b.id)::int AS active,
           COUNT(b.id) FILTER (WHERE b.pickup_end_time > NOW())::int AS live
    FROM merchants m
    JOIN surplus_batches b ON b.merchant_id = m.id AND b.status = 'ACTIVE'
    WHERE ST_DWithin(m.geom, ST_MakePoint(${ugm.lng}, ${ugm.lat})::geography, ${DEFAULT_SEARCH_RADIUS_M})
    GROUP BY m.id
    ORDER BY (m.subscription_tier = 'PREMIUM') DESC, distance_m ASC`);
  console.table(nearby.rows);
  check("radius 2 km from UGM returns merchants with active batches", nearby.rows.length >= 10, `${nearby.rows.length} merchants`);
  check("all results within 2 km", nearby.rows.every((r) => r.distance_m <= DEFAULT_SEARCH_RADIUS_M));
  const all = await one<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM merchants`);
  check("far merchants (Seturan, Condongcatur) excluded", nearby.rows.length < all.n);
  const live = nearby.rows.filter((r) => r.live > 0).length;
  if (live === 0) console.log("WARN  tonight's demo batches have expired — run `npm run db:seed` to refresh them");
  else console.log(`INFO  ${live} merchants still have a live pickup window`);

  // 2. geom is generated from lat/lng.
  const drift = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM merchants
    WHERE ST_Distance(geom, ST_MakePoint(longitude, latitude)::geography) > 0.01`);
  check("merchants.geom matches latitude/longitude", drift.n === 0);

  // 3. Money & impact invariants.
  const money = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM orders
    WHERE total_customer_paid_idr <> subtotal_recovery_idr + platform_commission_idr - voucher_discount_idr
       OR net_merchant_payout_idr <> subtotal_recovery_idr`);
  check("order totals follow the money-flow formula", money.n === 0);

  const items = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM orders o
    JOIN (SELECT order_id, SUM(quantity * unit_selling_price_idr) AS s,
                 SUM(quantity * portion_weight_grams) AS g
          FROM order_items GROUP BY order_id) i ON i.order_id = o.id
    WHERE i.s <> o.subtotal_recovery_idr
       OR (o.status = 'COMPLETED' AND i.g <> o.total_food_saved_grams)`);
  check("order_items sum to order subtotal / food grams", items.n === 0);

  const co2 = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM orders
    WHERE total_co2_avoided_grams <> ROUND(total_food_saved_grams * 2.5)`);
  check("CO2e = food × 2.5 (IPCC)", co2.n === 0);

  const impactNonCompleted = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM orders WHERE status <> 'COMPLETED' AND total_food_saved_grams <> 0`);
  check("impact credited only on COMPLETED orders", impactNonCompleted.n === 0);

  const userTotals = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM users u
    LEFT JOIN (SELECT customer_id, SUM(total_food_saved_grams) AS f FROM orders
               WHERE status = 'COMPLETED' GROUP BY customer_id) o ON o.customer_id = u.id
    WHERE u.role = 'CUSTOMER' AND u.total_food_saved_grams <> COALESCE(o.f, 0)`);
  check("user impact totals match completed orders", userTotals.n === 0);

  // 4. Stock invariants: sold portions = sum of paid order items per batch.
  const stock = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM surplus_batches b
    LEFT JOIN (SELECT oi.surplus_batch_id, SUM(oi.quantity) AS q FROM order_items oi
               JOIN orders o ON o.id = oi.order_id
               WHERE o.status IN ('PAID', 'READY_FOR_PICKUP', 'COMPLETED')
               GROUP BY oi.surplus_batch_id) s ON s.surplus_batch_id = b.id
    WHERE b.initial_stock - b.available_stock - b.reserved_stock <> COALESCE(s.q, 0)`);
  check("batch stock = initial − paid order quantities", stock.n === 0);

  const floor = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM surplus_batches b JOIN menus m ON m.id = b.menu_id
    WHERE b.current_selling_price_idr < m.min_recovery_price_idr`);
  check("no batch priced below min_recovery_price_idr", floor.n === 0);

  // 4b. Price audit trail: newest log row equals the batch's current price.
  const logs = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM surplus_batches b
    JOIN LATERAL (SELECT new_discount_pct, new_price_idr, created_at FROM discount_adjustment_logs l
                  WHERE l.surplus_batch_id = b.id ORDER BY created_at DESC LIMIT 1) l ON TRUE
    WHERE l.new_discount_pct <> b.current_discount_pct OR l.new_price_idr <> b.current_selling_price_idr
       OR l.created_at <> b.last_price_updated_at`);
  check("latest discount log matches batch price", logs.n === 0);

  // 4c. Nothing happened in the future (relative to the seed run).
  const future = await one<{ n: number }>(sql`
    SELECT (SELECT COUNT(*) FROM orders o JOIN surplus_batches b ON b.id IN
              (SELECT surplus_batch_id FROM order_items WHERE order_id = o.id)
            WHERE o.picked_up_at > b.updated_at)::int
         + (SELECT COUNT(*) FROM reviews r JOIN orders o ON o.id = r.order_id
            WHERE r.created_at < o.picked_up_at)::int
         + (SELECT COUNT(*) FROM orders WHERE status = 'COMPLETED' AND picked_up_at IS NULL)::int AS n`);
  check("pickups/reviews are not dated in the future", future.n === 0);

  // 5. Demo ticket & tonight's discount spread.
  const demo = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM orders o JOIN users u ON u.id = o.customer_id
    WHERE u.email = 'demo.pembeli@sisasaji.test' AND o.status = 'READY_FOR_PICKUP'`);
  check("demo customer has a pickup ticket tonight", demo.n >= 1);

  const tiers = await db.execute<{ current_discount_pct: number; n: number }>(sql`
    SELECT current_discount_pct, COUNT(*)::int AS n FROM surplus_batches
    WHERE status = 'ACTIVE' GROUP BY 1 ORDER BY 1`);
  console.table(tiers.rows);
  check("tonight shows several discount tiers", tiers.rows.length >= 3);

  const preds = await one<{ n: number }>(sql`
    SELECT COUNT(DISTINCT target_date)::int AS n FROM merchant_surplus_predictions`);
  check("predictions cover 7 days", preds.n === 7);

  await pool.end();
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
