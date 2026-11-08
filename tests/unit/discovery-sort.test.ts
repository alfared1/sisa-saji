import { describe, expect, it } from "vitest";
import type { BatchCard, MerchantSummary } from "@/lib/contracts";
import { minutesToClose, sortMerchants } from "@/server/services/discovery/discovery";

function merchant(
  id: string,
  o: { distance: number; premium?: boolean; verified?: boolean; maxDisc: number; minPrice: number; end: string },
): MerchantSummary {
  const batch = { pickup_end_time: o.end } as BatchCard;
  return {
    id,
    slug: id,
    name: id,
    category: "MAKANAN_BERAT",
    address: "-",
    lat: 0,
    lng: 0,
    distance_m: o.distance,
    is_verified: Boolean(o.verified),
    tier: o.premium ? "PREMIUM" : "REGULAR",
    rating_avg: 5,
    total_reviews: 0,
    logo_url: null,
    is_open: true,
    max_discount_pct: o.maxDisc,
    min_price_idr: o.minPrice,
    total_available_stock: 1,
    closes_at: o.end,
    batches: [batch],
  };
}

const list = [
  merchant("near", { distance: 100, maxDisc: 50, minPrice: 9000, end: "2026-11-08T15:00:00.000Z" }),
  merchant("premium-far", { distance: 1500, premium: true, verified: true, maxDisc: 60, minPrice: 12000, end: "2026-11-08T14:00:00.000Z" }),
  merchant("mid", { distance: 700, maxDisc: 70, minPrice: 6000, end: "2026-11-08T13:30:00.000Z" }),
  merchant("verified-mid", { distance: 900, verified: true, maxDisc: 40, minPrice: 15000, end: "2026-11-08T16:00:00.000Z" }),
];
const ids = (xs: MerchantSummary[]) => xs.map((m) => m.id);

describe("sortMerchants", () => {
  it("priority_distance: PREMIUM/verified first, then by distance", () => {
    expect(ids(sortMerchants(list, "priority_distance"))).toEqual(["verified-mid", "premium-far", "near", "mid"]);
  });
  it("distance", () => {
    expect(ids(sortMerchants(list, "distance"))).toEqual(["near", "mid", "verified-mid", "premium-far"]);
  });
  it("discount: highest max discount first", () => {
    expect(ids(sortMerchants(list, "discount"))).toEqual(["mid", "premium-far", "near", "verified-mid"]);
  });
  it("closing_soon: earliest pickup end first", () => {
    expect(ids(sortMerchants(list, "closing_soon"))).toEqual(["mid", "premium-far", "near", "verified-mid"]);
  });
  it("price: cheapest first", () => {
    expect(ids(sortMerchants(list, "price"))).toEqual(["mid", "near", "premium-far", "verified-mid"]);
  });
  it("does not mutate its input", () => {
    const before = ids(list);
    sortMerchants(list, "price");
    expect(ids(list)).toEqual(before);
  });
});

describe("minutesToClose", () => {
  const now = new Date("2026-11-08T13:00:00Z");
  it("floors whole minutes and never goes negative", () => {
    expect(minutesToClose(new Date("2026-11-08T13:45:59Z"), now)).toBe(45);
    expect(minutesToClose(new Date("2026-11-08T12:00:00Z"), now)).toBe(0);
  });
});
