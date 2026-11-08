/**
 * Customer discovery: PostGIS radius search over live surplus batches, map pins,
 * merchant detail, favourites and the SSE change feed.
 *
 * "Live" batch = merchant is_open, batch ACTIVE, available_stock > 0, pickup_end_time > now.
 */
import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "@/db/client";
import { customerMerchantSubscriptions, merchants, reviews, users } from "@/db/schema";
import type {
  BatchCard,
  BatchStatus,
  BatchStreamEvent,
  DiscoverQuery,
  MapPin,
  MenuCategory,
  MerchantDetail,
  MerchantSummary,
  MerchantTier,
  ReviewItem,
  SubscribeBody,
} from "@/lib/contracts";
import { ApiError } from "@/server/http";
import { abbreviateName } from "@/server/services/auth/identifier";

export type DiscoverInput = z.output<typeof DiscoverQuery>;
type SubscribeInput = z.output<typeof SubscribeBody>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LiveRow = {
  batch_id: string;
  menu_id: string;
  menu_name: string;
  category: MenuCategory;
  description: string | null;
  image_url: string | null;
  is_mystery_bag: boolean;
  portion_weight_grams: number;
  original_price_idr: number;
  selling_price_idr: number;
  discount_pct: number;
  available_stock: number;
  initial_stock: number;
  auto_discount_enabled: boolean;
  pickup_start_time: Date | string;
  pickup_end_time: Date | string;
  merchant_id: string;
  merchant_slug: string;
  merchant_name: string;
  merchant_category: MenuCategory;
  address: string;
  lat: number;
  lng: number;
  is_verified: boolean;
  tier: MerchantTier;
  rating_avg: string | number;
  total_reviews: number;
  logo_url: string | null;
  is_open: boolean;
  distance_m: number | string | null;
};

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/** Escapes LIKE wildcards in user input. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function point(lat: number, lng: number): SQL {
  return sql`ST_MakePoint(${lng}, ${lat})::geography`;
}

/** Live batch rows joined with menu & merchant, optionally filtered. */
async function queryLiveRows(
  db: Db,
  opts: {
    now: Date;
    origin?: { lat: number; lng: number };
    radiusM?: number;
    merchantId?: string;
    category?: MenuCategory;
    maxPrice?: number;
    q?: string;
  },
): Promise<LiveRow[]> {
  const conds: SQL[] = [
    sql`m.is_open`,
    sql`b.status = 'ACTIVE'`,
    sql`b.available_stock > 0`,
    sql`b.pickup_end_time > ${opts.now}`,
  ];
  if (opts.origin && opts.radiusM !== undefined) {
    conds.push(sql`ST_DWithin(m.geom, ${point(opts.origin.lat, opts.origin.lng)}, ${opts.radiusM})`);
  }
  if (opts.merchantId) conds.push(sql`m.id = ${opts.merchantId}`);
  if (opts.category) conds.push(sql`mn.category = ${opts.category}`);
  if (opts.maxPrice !== undefined) conds.push(sql`b.current_selling_price_idr <= ${opts.maxPrice}`);
  if (opts.q) {
    const p = likePattern(opts.q);
    conds.push(sql`(mn.menu_name ILIKE ${p} OR m.merchant_name ILIKE ${p})`);
  }
  const distance = opts.origin
    ? sql`ST_Distance(m.geom, ${point(opts.origin.lat, opts.origin.lng)})`
    : sql`NULL::float8`;

  const { rows } = await db.execute<LiveRow>(sql`
    SELECT b.id AS batch_id, mn.id AS menu_id, mn.menu_name, mn.category, mn.description, mn.image_url,
           mn.is_mystery_bag, mn.portion_weight_grams,
           b.original_price_idr, b.current_selling_price_idr AS selling_price_idr,
           b.current_discount_pct AS discount_pct, b.available_stock, b.initial_stock,
           b.auto_discount_enabled, b.pickup_start_time, b.pickup_end_time,
           m.id AS merchant_id, m.slug AS merchant_slug, m.merchant_name, m.merchant_category,
           m.address, m.latitude AS lat, m.longitude AS lng, m.merchant_verified AS is_verified,
           m.subscription_tier AS tier, m.rating_avg, m.total_reviews, m.logo_url, m.is_open,
           ${distance} AS distance_m
    FROM surplus_batches b
    JOIN merchants m ON m.id = b.merchant_id
    JOIN menus mn ON mn.id = b.menu_id
    WHERE ${sql.join(conds, sql` AND `)}`);
  return rows;
}

export function minutesToClose(end: Date, now: Date): number {
  return Math.max(0, Math.floor((end.getTime() - now.getTime()) / 60_000));
}

function roundDistance(d: number | string | null): number | null {
  return d === null || d === undefined ? null : Math.round(Number(d));
}

function toBatchCard(r: LiveRow, now: Date): BatchCard {
  const end = toDate(r.pickup_end_time);
  return {
    batch_id: r.batch_id,
    menu_id: r.menu_id,
    menu_name: r.menu_name,
    category: r.category,
    description: r.description,
    image_url: r.image_url,
    is_mystery_bag: r.is_mystery_bag,
    portion_weight_grams: Number(r.portion_weight_grams),
    original_price_idr: Number(r.original_price_idr),
    selling_price_idr: Number(r.selling_price_idr),
    discount_pct: Number(r.discount_pct),
    available_stock: Number(r.available_stock),
    initial_stock: Number(r.initial_stock),
    auto_discount_enabled: r.auto_discount_enabled,
    pickup_start_time: toDate(r.pickup_start_time).toISOString(),
    pickup_end_time: end.toISOString(),
    minutes_to_close: minutesToClose(end, now),
    merchant_id: r.merchant_id,
    merchant_slug: r.merchant_slug,
    merchant_name: r.merchant_name,
    distance_m: roundDistance(r.distance_m),
  };
}

type MerchantBase = Omit<
  MerchantSummary,
  "max_discount_pct" | "min_price_idr" | "total_available_stock" | "closes_at" | "batches"
>;

function summarize(base: MerchantBase, batches: BatchCard[]): MerchantSummary {
  const sorted = [...batches].sort(
    (a, b) => b.discount_pct - a.discount_pct || a.selling_price_idr - b.selling_price_idr,
  );
  const ends = sorted.map((b) => b.pickup_end_time).sort();
  return {
    ...base,
    max_discount_pct: sorted.reduce((m, b) => Math.max(m, b.discount_pct), 0),
    min_price_idr: sorted.length ? Math.min(...sorted.map((b) => b.selling_price_idr)) : 0,
    total_available_stock: sorted.reduce((s, b) => s + b.available_stock, 0),
    closes_at: ends.length ? ends[ends.length - 1] : null,
    batches: sorted,
  };
}

function groupByMerchant(rows: LiveRow[], now: Date): MerchantSummary[] {
  const groups = new Map<string, { base: MerchantBase; batches: BatchCard[] }>();
  for (const r of rows) {
    let g = groups.get(r.merchant_id);
    if (!g) {
      g = {
        base: {
          id: r.merchant_id,
          slug: r.merchant_slug,
          name: r.merchant_name,
          category: r.merchant_category,
          address: r.address,
          lat: Number(r.lat),
          lng: Number(r.lng),
          distance_m: roundDistance(r.distance_m),
          is_verified: r.is_verified,
          tier: r.tier,
          rating_avg: Number(r.rating_avg),
          total_reviews: Number(r.total_reviews),
          logo_url: r.logo_url,
          is_open: r.is_open,
        },
        batches: [],
      };
      groups.set(r.merchant_id, g);
    }
    g.batches.push(toBatchCard(r, now));
  }
  return [...groups.values()].map((g) => summarize(g.base, g.batches));
}

const earliestEnd = (m: MerchantSummary) =>
  m.batches.reduce((min, b) => (b.pickup_end_time < min ? b.pickup_end_time : min), "9999");
const dist = (m: MerchantSummary) => m.distance_m ?? Number.POSITIVE_INFINITY;
const isPriority = (m: MerchantSummary) => m.tier === "PREMIUM" || m.is_verified;

export function sortMerchants(list: MerchantSummary[], sort: DiscoverInput["sort"]): MerchantSummary[] {
  const byDistance = (a: MerchantSummary, b: MerchantSummary) => dist(a) - dist(b);
  const cmp: Record<DiscoverInput["sort"], (a: MerchantSummary, b: MerchantSummary) => number> = {
    priority_distance: (a, b) => Number(isPriority(b)) - Number(isPriority(a)) || byDistance(a, b),
    distance: byDistance,
    discount: (a, b) => b.max_discount_pct - a.max_discount_pct || byDistance(a, b),
    closing_soon: (a, b) => earliestEnd(a).localeCompare(earliestEnd(b)) || byDistance(a, b),
    price: (a, b) => a.min_price_idr - b.min_price_idr || byDistance(a, b),
  };
  return [...list].sort(cmp[sort]);
}

export async function findNearby(
  db: Db,
  q: DiscoverInput,
  now: Date = new Date(),
): Promise<{ radius_m: number; total_batches: number; merchants: MerchantSummary[] }> {
  const rows = await queryLiveRows(db, {
    now,
    origin: { lat: q.lat, lng: q.lng },
    radiusM: q.radius_m,
    category: q.category,
    maxPrice: q.max_price,
    q: q.q || undefined,
  });
  const list = sortMerchants(groupByMerchant(rows, now), q.sort);
  return { radius_m: q.radius_m, total_batches: rows.length, merchants: list };
}

/** Light payload for map pins. `pickup_end_time` is the soonest closing batch (drives the "hampir tutup" pulse). */
export async function findMapPins(db: Db, q: DiscoverInput, now: Date = new Date()): Promise<MapPin[]> {
  const { merchants: list } = await findNearby(db, q, now);
  return list.map((m) => ({
    merchant_id: m.id,
    slug: m.slug,
    merchant_name: m.name,
    lat: m.lat,
    lng: m.lng,
    distance_m: m.distance_m ?? 0,
    max_discount_pct: m.max_discount_pct,
    total_available_stock: m.total_available_stock,
    pickup_end_time: earliestEnd(m),
    is_verified: m.is_verified,
  }));
}

/** Resolves a slug or uuid to a merchant id (null when not found). */
export async function resolveMerchantId(db: Db, slugOrId: string): Promise<string | null> {
  const where = UUID_RE.test(slugOrId) ? eq(merchants.id, slugOrId) : eq(merchants.slug, slugOrId.toLowerCase());
  const [m] = await db.select({ id: merchants.id }).from(merchants).where(where).limit(1);
  return m?.id ?? null;
}

const hhmm = (t: string) => t.slice(0, 5);

export async function getMerchantDetail(
  db: Db,
  slugOrId: string,
  opts: { lat?: number; lng?: number; userId: string | null; now?: Date },
): Promise<MerchantDetail> {
  const now = opts.now ?? new Date();
  const merchantId = await resolveMerchantId(db, slugOrId);
  if (!merchantId) throw new ApiError("NOT_FOUND", "Warung tidak ditemukan");

  const origin = opts.lat !== undefined && opts.lng !== undefined ? { lat: opts.lat, lng: opts.lng } : undefined;
  const distanceSql = origin ? sql<number>`ST_Distance(${merchants.geom}, ${point(origin.lat, origin.lng)})` : sql<null>`NULL::float8`;
  const [m] = await db
    .select({ merchant: merchants, distance: distanceSql })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!m) throw new ApiError("NOT_FOUND", "Warung tidak ditemukan");
  const mm = m.merchant;

  const rows = mm.isOpen ? await queryLiveRows(db, { now, origin, merchantId }) : [];
  const batches = rows.map((r) => toBatchCard(r, now));

  const revs = await db
    .select({ review: reviews, name: users.fullName })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.customerId))
    .where(eq(reviews.merchantId, merchantId))
    .orderBy(desc(reviews.createdAt))
    .limit(10);
  const reviewItems: ReviewItem[] = revs.map(({ review: r, name }) => ({
    id: r.id,
    rating: r.rating,
    tags: r.tags ?? [],
    comment: r.comment,
    customer_name: abbreviateName(name),
    created_at: r.createdAt.toISOString(),
  }));

  let subscription: MerchantDetail["subscription"] = null;
  if (opts.userId) {
    const [s] = await db
      .select()
      .from(customerMerchantSubscriptions)
      .where(
        and(
          eq(customerMerchantSubscriptions.userId, opts.userId),
          eq(customerMerchantSubscriptions.merchantId, merchantId),
        ),
      )
      .limit(1);
    if (s) subscription = { notify_on_surplus_live: s.notifyOnSurplusLive, notify_on_ai_prediction: s.notifyOnAiPrediction };
  }

  const summary = summarize(
    {
      id: mm.id,
      slug: mm.slug,
      name: mm.merchantName,
      category: mm.merchantCategory,
      address: mm.address,
      lat: mm.latitude,
      lng: mm.longitude,
      distance_m: roundDistance(m.distance),
      is_verified: mm.merchantVerified,
      tier: mm.subscriptionTier,
      rating_avg: Number(mm.ratingAvg),
      total_reviews: mm.totalReviews,
      logo_url: mm.logoUrl,
      is_open: mm.isOpen,
    },
    batches,
  );

  return {
    ...summary,
    description: mm.description,
    banner_url: mm.bannerUrl,
    whatsapp_number: mm.whatsappNumber,
    operational_open_time: hhmm(mm.operationalOpenTime),
    operational_close_time: hhmm(mm.operationalCloseTime),
    reviews: reviewItems,
    subscription,
  };
}

export async function setSubscription(
  db: Db,
  userId: string,
  slugOrId: string,
  input: SubscribeInput,
): Promise<{ subscribed: boolean }> {
  const merchantId = await resolveMerchantId(db, slugOrId);
  if (!merchantId) throw new ApiError("NOT_FOUND", "Warung tidak ditemukan");
  if (!input.subscribed) {
    await db
      .delete(customerMerchantSubscriptions)
      .where(
        and(
          eq(customerMerchantSubscriptions.userId, userId),
          eq(customerMerchantSubscriptions.merchantId, merchantId),
        ),
      );
    return { subscribed: false };
  }
  await db
    .insert(customerMerchantSubscriptions)
    .values({
      userId,
      merchantId,
      notifyOnSurplusLive: input.notify_on_surplus_live,
      notifyOnAiPrediction: input.notify_on_ai_prediction,
    })
    .onConflictDoUpdate({
      target: [customerMerchantSubscriptions.userId, customerMerchantSubscriptions.merchantId],
      set: {
        notifyOnSurplusLive: input.notify_on_surplus_live,
        notifyOnAiPrediction: input.notify_on_ai_prediction,
      },
    });
  return { subscribed: true };
}

/* ------------------------------------------------------------------ */
/* SSE change feed                                                     */
/* ------------------------------------------------------------------ */

export type BatchChanges = {
  events: BatchStreamEvent[];
  /** Pass back as `cursor` next time (Postgres timestamptz text, microsecond precision). */
  cursor: string;
};

/** Batches near a point whose updated_at is after `cursor` (any status, so sell-outs reach the client). */
export async function batchChangesSince(
  db: Db,
  q: { lat: number; lng: number; radius_m: number },
  cursor: string,
  limit = 200,
): Promise<BatchChanges> {
  const { rows } = await db.execute<{
    batch_id: string;
    merchant_id: string;
    available_stock: number;
    discount_pct: number;
    selling_price_idr: number;
    status: BatchStatus;
    updated_at: Date | string;
    cursor: string;
  }>(sql`
    SELECT b.id AS batch_id, b.merchant_id, b.available_stock, b.current_discount_pct AS discount_pct,
           b.current_selling_price_idr AS selling_price_idr, b.status, b.updated_at,
           b.updated_at::text AS cursor
    FROM surplus_batches b
    JOIN merchants m ON m.id = b.merchant_id
    WHERE b.updated_at > ${cursor}::timestamptz
      AND ST_DWithin(m.geom, ${point(q.lat, q.lng)}, ${q.radius_m})
    ORDER BY b.updated_at ASC
    LIMIT ${limit}`);
  return {
    events: rows.map((r) => ({
      batch_id: r.batch_id,
      merchant_id: r.merchant_id,
      available_stock: Number(r.available_stock),
      discount_pct: Number(r.discount_pct),
      selling_price_idr: Number(r.selling_price_idr),
      status: r.status,
      updated_at: toDate(r.updated_at).toISOString(),
    })),
    cursor: rows.length ? rows[rows.length - 1].cursor : cursor,
  };
}

/** Current DB time as a cursor (start of a stream). */
export async function currentCursor(db: Db): Promise<string> {
  const { rows } = await db.execute<{ now: string }>(sql`SELECT now()::text AS now`);
  return rows[0].now;
}

/**
 * Re-read this much before the cursor on every poll. Writers stamp updated_at with
 * an app/tick clock before their transaction commits, so a row can become visible
 * after the cursor has passed its stamp (late commit, equal stamps of one tick).
 */
export const BATCH_STREAM_OVERLAP_MS = 15_000;

export interface BatchStreamState {
  /** Epoch ms; everything up to (cursor − overlap) has been delivered. */
  cursorMs: number;
  /** Event key → updated_at ms of events already sent (pruned past 2 × overlap). */
  seen: Map<string, number>;
}

export function newBatchStreamState(cursor: string | Date): BatchStreamState {
  const ms = typeof cursor === "string" ? Date.parse(cursor.replace(" ", "T")) : cursor.getTime();
  return { cursorMs: Number.isNaN(ms) ? Date.now() : ms, seen: new Map() };
}

/**
 * One SSE poll: overlap window + per-connection dedupe (same pattern as the merchant
 * stream). The cursor advances to the poll's DB start time, not the last row's stamp,
 * so rows sharing a stamp or committing late are still delivered — exactly once.
 */
export async function pollBatchStream(
  db: Db,
  area: { lat: number; lng: number; radius_m: number },
  state: BatchStreamState,
  limit = 200,
): Promise<{ events: BatchStreamEvent[]; cursor: string }> {
  const startedMs = Date.parse((await currentCursor(db)).replace(" ", "T"));
  const since = new Date(state.cursorMs - BATCH_STREAM_OVERLAP_MS).toISOString();
  const changes = await batchChangesSince(db, area, since, limit);
  const events: BatchStreamEvent[] = [];
  let lastMs = state.cursorMs;
  for (const ev of changes.events) {
    const at = Date.parse(ev.updated_at);
    lastMs = Math.max(lastMs, at);
    const key = `${ev.batch_id}|${ev.updated_at}|${ev.available_stock}|${ev.selling_price_idr}|${ev.status}`;
    if (state.seen.has(key)) continue;
    state.seen.set(key, at);
    events.push(ev);
  }
  // A full page may hide more rows: continue from the last row instead of jumping ahead.
  const next = changes.events.length >= limit ? lastMs : Math.max(state.cursorMs, Number.isNaN(startedMs) ? lastMs : startedMs);
  state.cursorMs = next;
  for (const [k, at] of state.seen) if (at < next - 2 * BATCH_STREAM_OVERLAP_MS) state.seen.delete(k);
  return { events, cursor: new Date(next).toISOString() };
}
