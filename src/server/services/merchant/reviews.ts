/**
 * The warung's reviews ("Ulasan pembeli"): what buyers wrote, the hygiene and portion answers,
 * and the warung's public reply under each review. Buyers are shown by first name only.
 */
import "server-only";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orderItems, orders, reviews, users } from "@/db/schema";
import type { MerchantReviewsResponse, MerchantReviewView } from "@/lib/contracts";
import { ApiError } from "@/server/http";

const LOW_RATING = 3;

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || "Pembeli";
}

async function views(db: Db, rows: { review: typeof reviews.$inferSelect; customer: string; orderNumber: string }[]) {
  const orderIds = rows.map((r) => r.review.orderId);
  const items = orderIds.length
    ? await db
        .select({ orderId: orderItems.orderId, name: orderItems.menuNameSnapshot })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds))
    : [];
  const names = new Map<string, string[]>();
  for (const it of items) {
    const list = names.get(it.orderId) ?? [];
    if (!list.includes(it.name)) list.push(it.name);
    names.set(it.orderId, list);
  }
  return rows.map(
    ({ review: r, customer, orderNumber }): MerchantReviewView => ({
      id: r.id,
      rating: r.rating,
      tags: r.tags ?? [],
      comment: r.comment,
      hygiene_rating: r.hygieneRating,
      portion_full: r.portionFull,
      customer_name: firstName(customer),
      menu_names: names.get(r.orderId) ?? [],
      order_number: orderNumber,
      created_at: r.createdAt.toISOString(),
      reply: r.merchantReply,
      replied_at: r.merchantRepliedAt ? r.merchantRepliedAt.toISOString() : null,
    }),
  );
}

export async function listMerchantReviews(
  db: Db,
  merchantId: string,
  query: { filter: "all" | "unreplied" | "low"; limit: number },
): Promise<MerchantReviewsResponse> {
  const where = and(
    eq(reviews.merchantId, merchantId),
    query.filter === "unreplied" ? isNull(reviews.merchantReply) : undefined,
    query.filter === "low" ? lte(reviews.rating, LOW_RATING) : undefined,
  );
  const [[summary], rows] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        ratingAvg: sql<number | null>`avg(${reviews.rating})::float`,
        hygieneAvg: sql<number | null>`avg(${reviews.hygieneRating})::float`,
        hygieneCount: sql<number>`count(${reviews.hygieneRating})::int`,
        portionFull: sql<number>`count(*) FILTER (WHERE ${reviews.portionFull})::int`,
        portionAnswers: sql<number>`count(${reviews.portionFull})::int`,
        unreplied: sql<number>`count(*) FILTER (WHERE ${reviews.merchantReply} IS NULL)::int`,
      })
      .from(reviews)
      .where(eq(reviews.merchantId, merchantId)),
    db
      .select({ review: reviews, customer: users.fullName, orderNumber: orders.orderNumber })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.customerId))
      .innerJoin(orders, eq(orders.id, reviews.orderId))
      .where(where)
      .orderBy(desc(reviews.createdAt))
      .limit(query.limit),
  ]);
  return {
    summary: {
      count: summary.count,
      rating_avg: summary.ratingAvg,
      hygiene_avg: summary.hygieneAvg,
      hygiene_count: summary.hygieneCount,
      portion_full_share: summary.portionAnswers > 0 ? summary.portionFull / summary.portionAnswers : null,
      portion_answers: summary.portionAnswers,
      unreplied: summary.unreplied,
    },
    reviews: await views(db, rows),
  };
}

/** Sets (or, with an empty text, removes) the warung's reply under one of its reviews. */
export async function replyToReview(
  db: Db,
  args: { merchantId: string; reviewId: string; reply: string; now?: Date },
): Promise<MerchantReviewView> {
  const now = args.now ?? new Date();
  const text = args.reply.trim();
  const [row] = await db
    .update(reviews)
    .set({ merchantReply: text || null, merchantRepliedAt: text ? now : null })
    .where(and(eq(reviews.id, args.reviewId), eq(reviews.merchantId, args.merchantId)))
    .returning();
  if (!row) throw new ApiError("NOT_FOUND", "Ulasan tidak ditemukan");
  const [full] = await db
    .select({ review: reviews, customer: users.fullName, orderNumber: orders.orderNumber })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.customerId))
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(eq(reviews.id, row.id));
  const [view] = await views(db, [full]);
  return view;
}
