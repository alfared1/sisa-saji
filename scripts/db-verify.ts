/**
 * Sanity checks for a migrated + seeded database.
 *   npm run db:verify
 * Exits non-zero if any invariant fails.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { DEMO_MERCHANT_SLUG, SEED_MERCHANTS } from "../src/db/seed/data";
import { CAMPUSES, DEFAULT_SEARCH_RADIUS_M } from "../src/lib/constants";
import { getDatabaseUrl } from "../src/lib/env";
import { calculateOptimalRecoveryPrice } from "../src/lib/pricing/dynamic-discount";

async function main() {
  const { db, pool } = createDb(getDatabaseUrl(), { max: 1 });
  // The app's default search point: IPB Dramaga, Bogor (the platform's home base).
  const home = CAMPUSES[0];
  /** IPB-area warung ~3.7 / ~4.7 km from campus: outside 2 km, inside 5 km. */
  const FAR = ["nasi-timbel-ceu-iyah-sindang-barang", "laksa-asinan-bu-nining-loji"];
  const BOGOR_HUBS = new Set<string>(["ipb", "bogor", "cibinong"]);
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
  const nearby = await db.execute<{ merchant_name: string; slug: string; distance_m: number; tier: string; active: number; live: number }>(sql`
    SELECT m.merchant_name, m.slug, ROUND(ST_Distance(m.geom, ST_MakePoint(${home.lng}, ${home.lat})::geography))::int AS distance_m,
           m.subscription_tier AS tier, COUNT(b.id)::int AS active,
           COUNT(b.id) FILTER (WHERE b.pickup_end_time > NOW())::int AS live
    FROM merchants m
    JOIN surplus_batches b ON b.merchant_id = m.id AND b.status = 'ACTIVE'
    WHERE ST_DWithin(m.geom, ST_MakePoint(${home.lng}, ${home.lat})::geography, ${DEFAULT_SEARCH_RADIUS_M})
    GROUP BY m.id
    ORDER BY (m.subscription_tier = 'PREMIUM') DESC, distance_m ASC`);
  console.table(nearby.rows);
  check(
    `radius 2 km from ${home.name} returns merchants with active batches`,
    nearby.rows.length >= 10,
    `${nearby.rows.length} merchants`,
  );
  check("all results within 2 km", nearby.rows.every((r) => r.distance_m <= DEFAULT_SEARCH_RADIUS_M));
  check("far merchants (Sindang Barang, Loji) excluded", FAR.every((slug) => !nearby.rows.some((r) => r.slug === slug)));
  const far = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM merchants
    WHERE slug IN (${sql.join(FAR.map((f) => sql`${f}`), sql`, `)})
      AND ST_DWithin(geom, ST_MakePoint(${home.lng}, ${home.lat})::geography, 5000)`);
  check("…but inside the 5 km expanded radius", far.n === FAR.length);
  const live = nearby.rows.filter((r) => r.live > 0).length;
  if (live === 0) console.log("WARN  tonight's demo batches have expired — run `npm run db:seed` to refresh them");
  else console.log(`INFO  ${live} merchants still have a live pickup window`);

  // 1b. Every campus hub has warung with active batches tonight.
  const hubs = await db.execute<{ id: string; merchants: number; active: number }>(sql`
    SELECT h.id, COUNT(DISTINCT m.id)::int AS merchants, COUNT(b.id)::int AS active
    FROM (VALUES ${sql.join(
      CAMPUSES.map((c) => sql`(${c.id}, ${c.lng}::float8, ${c.lat}::float8)`),
      sql`, `,
    )}) AS h(id, lng, lat)
    LEFT JOIN merchants m ON ST_DWithin(m.geom, ST_MakePoint(h.lng, h.lat)::geography, 6000)
    LEFT JOIN surplus_batches b ON b.merchant_id = m.id AND b.status = 'ACTIVE'
    GROUP BY h.id`);
  const empty = hubs.rows.filter((h) => h.merchants === 0 || h.active === 0).map((h) => h.id);
  check(`all ${CAMPUSES.length} campus hubs have warung with active batches`, empty.length === 0, empty.join(", "));

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
  check("CO2e = food × 2.5 (FAO 2013)", co2.n === 0);

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
    SELECT COUNT(*)::int AS n FROM orders o
    JOIN users u ON u.id = o.customer_id
    JOIN merchants m ON m.id = o.merchant_id
    WHERE u.email = 'demo.pembeli@sisasaji.test' AND o.status = 'READY_FOR_PICKUP'
      AND m.slug = ${DEMO_MERCHANT_SLUG}`);
  check("demo customer has a pickup ticket tonight at the demo warung", demo.n >= 1);

  const tiers = await db.execute<{ current_discount_pct: number; n: number }>(sql`
    SELECT current_discount_pct, COUNT(*)::int AS n FROM surplus_batches
    WHERE status = 'ACTIVE' GROUP BY 1 ORDER BY 1`);
  console.table(tiers.rows);
  check("tonight shows several discount tiers", tiers.rows.length >= 3);

  const preds = await one<{ n: number }>(sql`
    SELECT COUNT(DISTINCT target_date)::int AS n FROM merchant_surplus_predictions`);
  check("predictions cover 7 days", preds.n === 7);

  // 6. Transparent menus (no surprise items) and lauk. Pilot warung are real data and
  //    may still have older menus without contents, so they are left out here.
  const mystery = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM menus
    WHERE is_active AND (is_mystery_bag OR category = 'MYSTERY_BAG')`);
  check("no active surprise (mystery) menus", mystery.n === 0, `${mystery.n} found`);

  const noContents = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM menus mn JOIN merchants m ON m.id = mn.merchant_id
    WHERE NOT m.is_pilot AND cardinality(mn.contents) = 0 AND cardinality(mn.lauk_options) = 0`);
  check("every seed menu lists its contents or lauk options", noContents.n === 0, `${noContents.n} without`);

  const laukSubset = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM surplus_batches b JOIN menus mn ON mn.id = b.menu_id
    WHERE NOT (b.lauk_available <@ mn.lauk_options)`);
  check("every batch's lauk_available is a subset of its menu's lauk options", laukSubset.n === 0);

  const laukChoice = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM order_items oi JOIN surplus_batches b ON b.id = oi.surplus_batch_id
    WHERE oi.lauk_choice IS NOT NULL AND NOT (oi.lauk_choice = ANY (b.lauk_available))`);
  check("every ordered lauk was available in its batch", laukChoice.n === 0);

  // 7. Prices: the Rp 10.000 floor, the Bogor price band, and a real discount tonight.
  const seedPrices = await one<{ floor_over: number; sell_under: number; low_disc: number; min_disc: number | null }>(sql`
    SELECT
      (SELECT COUNT(*) FROM menus mn JOIN merchants m ON m.id = mn.merchant_id
        WHERE NOT m.is_pilot AND mn.min_recovery_price_idr > 10000)::int AS floor_over,
      (SELECT COUNT(*) FROM surplus_batches b JOIN merchants m ON m.id = b.merchant_id
        WHERE NOT m.is_pilot AND b.status = 'ACTIVE' AND b.current_selling_price_idr < 10000)::int AS sell_under,
      (SELECT COUNT(*) FROM surplus_batches b JOIN merchants m ON m.id = b.merchant_id
        WHERE NOT m.is_pilot AND b.status = 'ACTIVE' AND b.current_discount_pct < 35)::int AS low_disc,
      (SELECT MIN(b.current_discount_pct) FROM surplus_batches b JOIN merchants m ON m.id = b.merchant_id
        WHERE NOT m.is_pilot AND b.status = 'ACTIVE')::int AS min_disc`);
  check("every seed floor price is at most Rp 10.000", seedPrices.floor_over === 0, `${seedPrices.floor_over} above`);
  check("every active seed selling price is at least Rp 10.000", seedPrices.sell_under === 0, `${seedPrices.sell_under} below`);
  check(
    "every active seed batch is discounted at least 35%",
    seedPrices.low_disc === 0,
    `min ${seedPrices.min_disc ?? "-"}%, ${seedPrices.low_disc} below 35%`,
  );

  const bogorSlugs = SEED_MERCHANTS.filter((m) => BOGOR_HUBS.has(m.hub)).map((m) => m.slug);
  const bogorBand = await one<{ n: number; total: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE mn.original_price_idr NOT BETWEEN 18000 AND 25000)::int AS n,
           COUNT(*)::int AS total
    FROM menus mn JOIN merchants m ON m.id = mn.merchant_id
    WHERE m.slug IN (${sql.join(bogorSlugs.map((s) => sql`${s}`), sql`, `)})`);
  check(
    "Bogor-hub menus cost Rp 18.000 to 25.000",
    bogorBand.total > 0 && bogorBand.n === 0,
    `${bogorBand.n} of ${bogorBand.total} outside`,
  );

  const midPriced = await one<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM surplus_batches b JOIN merchants m ON m.id = b.merchant_id
    WHERE b.status = 'ACTIVE' AND b.current_selling_price_idr BETWEEN 11000 AND 12500
      AND ST_DWithin(m.geom, ST_MakePoint(${home.lng}, ${home.lat})::geography, 5000)`);
  check(
    "some active prices within 5 km of IPB are Rp 11.000 to 12.500 (not all at the floor)",
    midPriced.n >= 1,
    `${midPriced.n} batches`,
  );

  // 8. Walking distance: warung with active batches within 500 m / 1 km of IPB Dramaga.
  const walk = await one<{ m500: number; m1000: number }>(sql`
    SELECT COUNT(DISTINCT m.id) FILTER (WHERE ST_DWithin(m.geom, ST_MakePoint(${home.lng}, ${home.lat})::geography, 500))::int AS m500,
           COUNT(DISTINCT m.id)::int AS m1000
    FROM merchants m JOIN surplus_batches b ON b.merchant_id = m.id AND b.status = 'ACTIVE'
    WHERE ST_DWithin(m.geom, ST_MakePoint(${home.lng}, ${home.lat})::geography, 1000)`);
  check(`>= 5 warung with active batches within 500 m of ${home.name}`, walk.m500 >= 5, `${walk.m500}`);
  check(`>= 8 warung with active batches within 1 km of ${home.name}`, walk.m1000 >= 8, `${walk.m1000}`);

  // 9. Things only real people create: the seed must not invent them.
  const invented = await one<{ photos: number; interests: number; alerts: number }>(sql`
    SELECT (SELECT COUNT(*) FROM batch_photos)::int AS photos,
           (SELECT COUNT(*) FROM delivery_interests)::int AS interests,
           (SELECT COUNT(*) FROM push_subscriptions WHERE hunger_alert_enabled)::int AS alerts`);
  check(
    "no seeded batch photos, delivery interests or hunger alerts",
    invented.photos === 0 && invented.interests === 0 && invented.alerts === 0,
    `${invented.photos} / ${invented.interests} / ${invented.alerts}`,
  );

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
