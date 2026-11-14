/**
 * Loads orders as the API's OrderDetail view (src/lib/contracts).
 * Secrets are viewer-dependent:
 *  - customer: pickup_code / pickup_qr_token once paid; qris_string while unpaid
 *  - merchant: never sees the pickup code or token (it is the customer's proof)
 * merchant.is_demo_data is read at load time (isDemoData()), so a non-pilot warung on a
 * demo deployment can be told apart from a real self-registered one.
 */
import "server-only";
import { inArray, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { merchants, orderItems, orders, reviews, users } from "@/db/schema";
import type { OrderDetail } from "@/lib/contracts";
import { isDemoData } from "@/lib/env";

export type OrderViewer = "customer" | "merchant";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const PAID_STATES = new Set(["PAID", "READY_FOR_PICKUP", "COMPLETED"]);

/** Returns OrderDetail views in the same order as `orderIds` (missing ids are skipped). */
export async function loadOrderDetails(db: DbOrTx, orderIds: string[], viewer: OrderViewer): Promise<OrderDetail[]> {
  if (orderIds.length === 0) return [];

  const rows = await db
    .select({ order: orders, merchant: merchants, customer: users })
    .from(orders)
    .innerJoin(merchants, eq(merchants.id, orders.merchantId))
    .innerJoin(users, eq(users.id, orders.customerId))
    .where(inArray(orders.id, orderIds));

  const items = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
  const demoData = isDemoData();
  const revs = await db.select().from(reviews).where(inArray(reviews.orderId, orderIds));

  const itemsByOrder = new Map<string, (typeof items)[number][]>();
  for (const it of items) {
    const list = itemsByOrder.get(it.orderId) ?? [];
    list.push(it);
    itemsByOrder.set(it.orderId, list);
  }
  const reviewByOrder = new Map(revs.map((r) => [r.orderId, r]));

  const byId = new Map<string, OrderDetail>();
  for (const { order: o, merchant: m, customer: c } of rows) {
    const its = itemsByOrder.get(o.id) ?? [];
    const foodGrams = its.reduce((s, i) => s + i.quantity * i.portionWeightGrams, 0);
    const paid = PAID_STATES.has(o.status);
    const rev = reviewByOrder.get(o.id);
    byId.set(o.id, {
      id: o.id,
      order_number: o.orderNumber,
      status: o.status,
      merchant: {
        id: m.id,
        slug: m.slug,
        name: m.merchantName,
        address: m.address,
        lat: m.latitude,
        lng: m.longitude,
        whatsapp_number: m.whatsappNumber,
        is_pilot: m.isPilot,
        is_demo_data: demoData,
      },
      customer: {
        id: c.id,
        full_name: c.fullName,
        phone_number: viewer === "merchant" && !paid ? null : c.phoneNumber,
      },
      items: its.map((i) => ({
        batch_id: i.surplusBatchId,
        menu_id: i.menuId,
        menu_name: i.menuNameSnapshot,
        quantity: i.quantity,
        unit_original_price_idr: i.unitOriginalPriceIdr,
        unit_selling_price_idr: i.unitSellingPriceIdr,
        discount_pct: i.discountPctApplied,
        portion_weight_grams: i.portionWeightGrams,
        lauk: i.laukChoice,
      })),
      subtotal_original_idr: o.subtotalOriginalIdr,
      subtotal_recovery_idr: o.subtotalRecoveryIdr,
      voucher_discount_idr: o.voucherDiscountIdr,
      platform_commission_idr: o.platformCommissionIdr,
      total_customer_paid_idr: o.totalCustomerPaidIdr,
      net_merchant_payout_idr: o.netMerchantPayoutIdr,
      money_saved_idr: o.subtotalOriginalIdr - o.subtotalRecoveryIdr + o.voucherDiscountIdr,
      uses_own_lunchbox: o.usesOwnLunchbox,
      payment_method: o.paymentMethod,
      payment_expires_at: o.paymentExpiresAt.toISOString(),
      paid_at: iso(o.paidAt),
      scheduled_pickup_time: iso(o.scheduledPickupTime),
      pickup_deadline_at: o.pickupDeadlineAt.toISOString(),
      picked_up_at: iso(o.pickedUpAt),
      pickup_code: viewer === "customer" && paid ? o.pickupCode : null,
      pickup_qr_token: viewer === "customer" && paid ? o.pickupQrToken : null,
      qris_string: viewer === "customer" && o.status === "PENDING_PAYMENT" ? o.qrisDynamicString : null,
      // Credited values once COMPLETED; otherwise the expected impact of this order.
      food_saved_grams: o.status === "COMPLETED" ? o.totalFoodSavedGrams : foodGrams,
      co2_avoided_grams: o.status === "COMPLETED" ? o.totalCo2AvoidedGrams : Math.round(foodGrams * 2.5),
      cancel_reason: o.cancelReason,
      review: rev
        ? {
            rating: rev.rating,
            tags: rev.tags ?? [],
            comment: rev.comment,
            hygiene_rating: rev.hygieneRating,
            portion_full: rev.portionFull,
          }
        : null,
      created_at: o.createdAt.toISOString(),
    });
  }
  return orderIds.map((id) => byId.get(id)).filter((x): x is OrderDetail => Boolean(x));
}
