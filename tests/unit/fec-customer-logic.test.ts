import { describe, expect, it } from "vitest";
import { lastMonths } from "@/components/customer/impact/monthly-chart";
import {
  bestVoucher,
  checkoutErrorAction,
  previewTotals,
  voucherEligibility,
} from "@/components/customer/lib/checkout-logic";
import { deriveDiscoverSections, minutesLeft, nextRadius } from "@/components/customer/lib/discover-sections";
import {
  badgeLabel,
  formatDistance,
  mapsDirectionsUrl,
  pickupWindowLabel,
  travelMinutes,
  whatsappUrl,
} from "@/components/customer/lib/format";
import {
  defaultOrderTab,
  groupOrdersByTab,
  parseOrderTab,
  tabForStatus,
} from "@/components/customer/lib/order-status";
import { generatePickupSlots } from "@/components/customer/lib/pickup-slots";
import { cartItemFromBatch, cartPatchFromBatch } from "@/components/customer/lib/queries";
import { patchMerchantDetail, patchNearby } from "@/components/customer/lib/sse-patch";
import type {
  BatchCard,
  BatchStreamEvent,
  MerchantDetail,
  MerchantSummary,
  NearbyResponse,
  OrderDetail,
  OrderStatus,
} from "@/lib/contracts";

const NOW = Date.parse("2026-11-08T13:00:00Z"); // 20.00 WIB

function batch(p: Partial<BatchCard> = {}): BatchCard {
  return {
    batch_id: "b1",
    menu_id: "m1",
    menu_name: "Nasi Gudeg",
    category: "MAKANAN_BERAT",
    description: null,
    image_url: null,
    is_mystery_bag: false,
    portion_weight_grams: 200,
    original_price_idr: 20000,
    selling_price_idr: 10000,
    discount_pct: 50,
    available_stock: 5,
    initial_stock: 8,
    auto_discount_enabled: true,
    pickup_start_time: "2026-11-08T13:00:00.000Z",
    pickup_end_time: "2026-11-08T15:30:00.000Z", // 22.30 WIB
    minutes_to_close: 150,
    merchant_id: "w1",
    merchant_slug: "warung-a",
    merchant_name: "Warung A",
    distance_m: 600,
    ...p,
  };
}

function merchant(batches: BatchCard[], p: Partial<MerchantSummary> = {}): MerchantSummary {
  return {
    id: "w1",
    slug: "warung-a",
    name: "Warung A",
    category: "MAKANAN_BERAT",
    address: "Jl. Kaliurang",
    lat: -7.77,
    lng: 110.37,
    distance_m: 600,
    is_verified: true,
    tier: "PREMIUM",
    rating_avg: 4.5,
    total_reviews: 10,
    logo_url: null,
    is_open: true,
    max_discount_pct: Math.max(...batches.map((b) => b.discount_pct)),
    min_price_idr: Math.min(...batches.map((b) => b.selling_price_idr)),
    total_available_stock: batches.reduce((s, b) => s + b.available_stock, 0),
    closes_at: batches[0]?.pickup_end_time ?? null,
    batches,
    ...p,
  };
}

function ev(p: Partial<BatchStreamEvent> = {}): BatchStreamEvent {
  return {
    batch_id: "b1",
    merchant_id: "w1",
    available_stock: 5,
    discount_pct: 50,
    selling_price_idr: 10000,
    status: "ACTIVE",
    updated_at: "2026-11-08T13:05:00Z",
    ...p,
  };
}

describe("discover sections", () => {
  const closing = batch({ batch_id: "closing", pickup_end_time: "2026-11-08T13:40:00.000Z", minutes_to_close: 40 });
  const hot = batch({ batch_id: "hot", discount_pct: 70, selling_price_idr: 6000 });
  const pricey = batch({ batch_id: "pricey", selling_price_idr: 15000, discount_pct: 40 });
  const soldOut = batch({ batch_id: "soldout", available_stock: 0, selling_price_idr: 5000 });
  const data: NearbyResponse = {
    radius_m: 2000,
    total_batches: 4,
    merchants: [merchant([closing, hot, pricey, soldOut])],
  };

  it("puts closing-soon and ≥60 % deals in the urgent row, soonest first", () => {
    const s = deriveDiscoverSections(data, NOW);
    expect(s.urgent.map((b) => b.batch_id)).toEqual(["closing", "hot"]);
  });

  it("lists batches under Rp 10.000 cheapest first and skips sold-out ones", () => {
    const s = deriveDiscoverSections(data, NOW);
    expect(s.under10k.map((b) => b.batch_id)).toEqual(["hot"]);
    expect(s.totalBatches).toBe(3);
    expect(s.totalPortions).toBe(15);
  });

  it("drops batches already past their pickup end", () => {
    const s = deriveDiscoverSections(data, Date.parse("2026-11-08T14:00:00Z"));
    expect(s.urgent.map((b) => b.batch_id)).toEqual(["hot"]);
  });

  it("sorts sold-out merchants last and handles missing data", () => {
    const out = merchant([soldOut], { id: "w2", total_available_stock: 0 });
    const s = deriveDiscoverSections({ ...data, merchants: [out, merchant([hot])] }, NOW);
    expect(s.merchants.map((m) => m.id)).toEqual(["w1", "w2"]);
    expect(deriveDiscoverSections(undefined, NOW).merchants).toEqual([]);
  });

  it("falls back to server minutes without a clock and suggests a bigger radius", () => {
    expect(minutesLeft(closing, null)).toBe(40);
    expect(nextRadius(2000, [2000, 5000, 10000])).toBe(5000);
    expect(nextRadius(10000, [2000, 5000, 10000])).toBeNull();
  });
});

describe("SSE patching", () => {
  const data: NearbyResponse = { radius_m: 2000, total_batches: 1, merchants: [merchant([batch()])] };

  it("returns the same reference for unknown or unchanged batches", () => {
    expect(patchNearby(data, ev({ batch_id: "zzz" })).data).toBe(data);
    const same = patchNearby(data, ev());
    expect(same.data).toBe(data);
    expect(same.found).toBe(true);
  });

  it("applies a price drop and recomputes merchant aggregates", () => {
    const r = patchNearby(data, ev({ discount_pct: 70, selling_price_idr: 6000, available_stock: 3 }));
    const m = r.data.merchants[0];
    expect(m.batches[0].selling_price_idr).toBe(6000);
    expect(m.max_discount_pct).toBe(70);
    expect(m.min_price_idr).toBe(6000);
    expect(m.total_available_stock).toBe(3);
    expect(r.priceDrop).toMatchObject({ old_price_idr: 10000, new_price_idr: 6000, new_discount_pct: 70 });
  });

  it("does not report a drop when only stock changes", () => {
    expect(patchNearby(data, ev({ available_stock: 1 })).priceDrop).toBeNull();
  });

  it("removes closed batches from discovery but keeps them as sold out on the warung page", () => {
    const closed = ev({ status: "EXPIRED", available_stock: 0 });
    const r = patchNearby(data, closed);
    expect(r.data.merchants[0].batches).toHaveLength(0);
    expect(r.data.total_batches).toBe(0);

    const detail = { ...merchant([batch()]), reviews: [] } as unknown as MerchantDetail;
    const d = patchMerchantDetail(detail, ev({ status: "SOLD_OUT", available_stock: 0 }));
    expect(d.data.batches[0].available_stock).toBe(0);
    expect(d.data.total_available_stock).toBe(0);
  });
});

describe("pickup slots", () => {
  it("offers 15-minute WIB slots from the next boundary, leaving 5 minutes before the deadline", () => {
    const slots = generatePickupSlots({ nowMs: Date.parse("2026-11-08T13:07:00Z"), endIso: "2026-11-08T14:00:00Z" });
    expect(slots.map((s) => s.label)).toEqual(["20.15", "20.30", "20.45"]);
  });

  it("respects a later pickup start, the minimum lead time and the cap", () => {
    const slots = generatePickupSlots({
      nowMs: NOW,
      startIso: "2026-11-08T13:30:00Z",
      endIso: "2026-11-08T14:03:00Z",
    });
    expect(slots.map((s) => s.label)).toEqual(["20.45"]);
    expect(generatePickupSlots({ nowMs: NOW, endIso: "2026-11-09T13:00:00Z", max: 4 })).toHaveLength(4);
    expect(generatePickupSlots({ nowMs: NOW, endIso: null })).toEqual([]);
    expect(generatePickupSlots({ nowMs: NOW, endIso: "2026-11-08T12:00:00Z" })).toEqual([]);
  });
});

describe("checkout logic", () => {
  const items = [
    { quantity: 2, unit_price_idr: 7000, original_price_idr: 14000, portion_weight_grams: 200 },
    { quantity: 1, unit_price_idr: 9000, original_price_idr: 18000, portion_weight_grams: 250 },
  ];

  it("previews totals like the server (fee, voucher, savings, impact)", () => {
    const p = previewTotals({ items, voucher: { discount_idr: 2000, min_subtotal_idr: 10000 } });
    expect(p).toEqual({
      subtotal_original_idr: 46000,
      subtotal_recovery_idr: 23000,
      service_fee_idr: 1500,
      voucher_discount_idr: 2000,
      total_idr: 22500,
      money_saved_idr: 25000,
      food_saved_grams: 650,
      co2_avoided_grams: 1625,
    });
  });

  it("ignores a voucher whose minimum is not met", () => {
    const p = previewTotals({ items: [items[0]], voucher: { discount_idr: 2000, min_subtotal_idr: 20000 } });
    expect(p.voucher_discount_idr).toBe(0);
    expect(voucherEligibility({ min_subtotal_idr: 20000 }, 14000)).toEqual({ eligible: false, shortfall_idr: 6000 });
  });

  it("picks the best eligible voucher", () => {
    const vs = [
      { code: "A", title: "", discount_idr: 2000, min_subtotal_idr: 50000 },
      { code: "B", title: "", discount_idr: 1500, min_subtotal_idr: 8000 },
      { code: "C", title: "", discount_idr: 1000, min_subtotal_idr: 0 },
    ];
    expect(bestVoucher(vs, 10000)?.code).toBe("B");
    expect(bestVoucher(vs, 1000)?.code).toBe("C");
  });

  it("maps checkout API errors to UI reactions", () => {
    expect(checkoutErrorAction("OUT_OF_STOCK", { batch_id: "b1", available_stock: 2 })).toEqual({
      kind: "stock",
      batch_id: "b1",
      available: 2,
    });
    expect(checkoutErrorAction("OUT_OF_STOCK", undefined)).toEqual({ kind: "stock", batch_id: null, available: null });
    expect(checkoutErrorAction("BATCH_CLOSED", null).kind).toBe("closed");
    expect(checkoutErrorAction("DIFFERENT_MERCHANT", null).kind).toBe("different_merchant");
    expect(checkoutErrorAction("VOUCHER_INVALID", null).kind).toBe("voucher");
    expect(checkoutErrorAction("UNAUTHENTICATED", null).kind).toBe("login");
    expect(checkoutErrorAction("INTERNAL_ERROR", null).kind).toBe("generic");
  });

  it("builds cart items capped by stock and the per-line limit", () => {
    expect(cartItemFromBatch(batch({ available_stock: 3 })).max_quantity).toBe(3);
    expect(cartItemFromBatch(batch({ available_stock: 40 })).max_quantity).toBe(10);
    expect(cartPatchFromBatch({ selling_price_idr: 6000, discount_pct: 70, available_stock: 0 })).toEqual({
      unit_price_idr: 6000,
      discount_pct: 70,
      max_quantity: 1,
    });
  });
});

describe("order tabs", () => {
  const o = (status: OrderStatus, id = status) => ({ id, status }) as unknown as OrderDetail;

  it("groups statuses into the four tabs", () => {
    const g = groupOrdersByTab([o("PENDING_PAYMENT"), o("PAID"), o("READY_FOR_PICKUP"), o("COMPLETED"), o("EXPIRED"), o("CANCELLED")]);
    expect(g.unpaid).toHaveLength(1);
    expect(g.ready).toHaveLength(2);
    expect(g.done).toHaveLength(1);
    expect(g.cancelled).toHaveLength(2);
    expect(tabForStatus("EXPIRED")).toBe("cancelled");
  });

  it("opens the most actionable tab by default and validates ?tab", () => {
    expect(defaultOrderTab(groupOrdersByTab([o("COMPLETED"), o("READY_FOR_PICKUP")]))).toBe("ready");
    expect(defaultOrderTab(groupOrdersByTab([o("PENDING_PAYMENT")]))).toBe("unpaid");
    expect(defaultOrderTab(groupOrdersByTab([]))).toBe("done");
    expect(parseOrderTab("cancelled")).toBe("cancelled");
    expect(parseOrderTab("nope")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats distances and travel times", () => {
    expect(formatDistance(455)).toBe("460 m");
    expect(formatDistance(1012)).toBe("1,0 km");
    expect(formatDistance(null)).toBe("");
    expect(travelMinutes(1000)).toBe(13);
    expect(travelMinutes(1000, "motor")).toBe(3);
    expect(travelMinutes(null)).toBeNull();
  });

  it("builds pickup window, maps and WhatsApp links", () => {
    expect(pickupWindowLabel("2026-11-08T13:00:00Z", "2026-11-08T15:30:00Z")).toBe("20.00–22.30 WIB");
    expect(mapsDirectionsUrl(-7.7, 110.3)).toContain("destination=-7.7,110.3");
    expect(whatsappUrl("081234567890", "Halo")).toBe("https://wa.me/6281234567890?text=Halo");
    expect(whatsappUrl("+6281300000001")).toBe("https://wa.me/6281300000001");
  });

  it("labels badge tiers and keeps the last chart months in order", () => {
    expect(badgeLabel("SURPLUS_HERO")).toBe("Surplus Hero");
    expect(badgeLabel("ECO_LEGEND")).toBe("Eco Legend");
    const months = ["2026-05", "2026-11", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month) => ({
      month,
      orders: 1,
      food_saved_grams: 1,
      co2_avoided_grams: 1,
      money_saved_idr: 1,
    }));
    expect(lastMonths(months).map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  });
});

describe("fair-use checkout responses", async () => {
  const { unpaidOrderHref, perBuyerCaps } = await import("@/components/customer/lib/checkout-logic");
  it("links to the unpaid order at the same warung", () => {
    expect(unpaidOrderHref("CONFLICT", { order_id: "abc", order_number: "SS-1" })).toBe("/orders/abc");
    expect(unpaidOrderHref("CONFLICT", { pending_order_ids: ["a", "b"] })).toBe("/orders");
    expect(unpaidOrderHref("CONFLICT", undefined)).toBeNull();
    expect(unpaidOrderHref("OUT_OF_STOCK", { order_id: "abc" })).toBeNull();
  });
  it("reads per-buyer caps from validation details", () => {
    expect(perBuyerCaps("VALIDATION_ERROR", [{ path: "items", batch_id: "b1", max_quantity: 3 }])).toEqual([
      { batch_id: "b1", max_quantity: 3 },
    ]);
    expect(perBuyerCaps("VALIDATION_ERROR", [{ path: "items", message: "x" }])).toEqual([]);
    expect(perBuyerCaps("CONFLICT", [{ batch_id: "b1", max_quantity: 3 }])).toEqual([]);
  });
});
