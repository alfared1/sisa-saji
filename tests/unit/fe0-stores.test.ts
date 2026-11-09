import { beforeEach, describe, expect, it } from "vitest";
import type { OrderDetail } from "@/lib/contracts";
import { CAMPUSES } from "@/lib/constants";
import {
  type CartItem,
  selectCartCount,
  selectCartEarliestEnd,
  selectCartFoodGrams,
  selectCartSavings,
  selectCartSubtotal,
  useCartStore,
} from "@/stores/cart";
import { DEFAULT_LOCATION, formatRadius, useLocationStore } from "@/stores/location";
import { selectTicketList, useTicketsStore } from "@/stores/tickets";

const A = { id: "m-a", slug: "warung-a", name: "Warung A" };
const B = { id: "m-b", slug: "warung-b", name: "Warung B" };

function item(batch: string, over: Partial<CartItem> = {}): CartItem {
  return {
    batch_id: batch,
    menu_id: `menu-${batch}`,
    menu_name: `Menu ${batch}`,
    quantity: 1,
    unit_price_idr: 8000,
    original_price_idr: 20000,
    discount_pct: 60,
    max_quantity: 3,
    portion_weight_grams: 250,
    pickup_end_time: "2026-11-08T15:30:00.000Z",
    ...over,
  };
}

describe("cart store (single-merchant guardrail)", () => {
  beforeEach(() => useCartStore.getState().clear());

  it("adds items and merges quantities of the same batch, clamped to max_quantity", () => {
    const s = useCartStore.getState();
    expect(s.addItem(A, item("b1"))).toBe("added");
    expect(s.addItem(A, item("b1", { quantity: 5 }))).toBe("added");
    const { items, merchant } = useCartStore.getState();
    expect(merchant).toEqual(A);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it("refuses an item from a different merchant without replacing the cart", () => {
    const s = useCartStore.getState();
    s.addItem(A, item("b1"));
    expect(s.addItem(B, item("b2"))).toBe("different_merchant");
    const state = useCartStore.getState();
    expect(state.merchant?.id).toBe("m-a");
    expect(state.items.map((i) => i.batch_id)).toEqual(["b1"]);
  });

  it("replaceCart swaps merchant and items", () => {
    const s = useCartStore.getState();
    s.addItem(A, item("b1"));
    s.replaceCart(B, item("b2", { quantity: 2 }));
    const state = useCartStore.getState();
    expect(state.merchant?.id).toBe("m-b");
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ batch_id: "b2", quantity: 2 });
  });

  it("setQuantity clamps to 1..max_quantity and removeItem clears the merchant when empty", () => {
    const s = useCartStore.getState();
    s.addItem(A, item("b1"));
    s.setQuantity("b1", 99);
    expect(useCartStore.getState().items[0].quantity).toBe(3);
    s.setQuantity("b1", 0);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
    s.removeItem("b1");
    expect(useCartStore.getState()).toMatchObject({ merchant: null, items: [] });
  });

  it("computes count, subtotal, savings, food grams and the binding deadline", () => {
    const s = useCartStore.getState();
    s.addItem(A, item("b1", { quantity: 2 }));
    s.addItem(A, item("b2", { unit_price_idr: 5000, original_price_idr: 10000, pickup_end_time: "2026-11-08T14:00:00.000Z" }));
    const state = useCartStore.getState();
    expect(selectCartCount(state)).toBe(3);
    expect(selectCartSubtotal(state)).toBe(2 * 8000 + 5000);
    expect(selectCartSavings(state)).toBe(2 * 12000 + 5000);
    expect(selectCartFoodGrams(state)).toBe(750);
    expect(selectCartEarliestEnd(state)).toBe("2026-11-08T14:00:00.000Z");
  });
});

describe("location store", () => {
  beforeEach(() => useLocationStore.getState().reset());

  it("defaults to IPB Dramaga, Bogor with a 2 km radius", () => {
    const s = useLocationStore.getState();
    expect(CAMPUSES[0].id).toBe("ipb");
    expect(s).toMatchObject({ lat: CAMPUSES[0].lat, lng: CAMPUSES[0].lng, campus_id: "ipb", source: "campus" });
    expect(s.label).toBe("IPB Dramaga, Bogor");
    expect(s.label).toBe(DEFAULT_LOCATION.label);
    expect(s.radius_m).toBe(2000);
  });

  it("moves a never-chosen v1 default (UGM) to the new default, keeps a chosen location", () => {
    const migrate = useLocationStore.persist.getOptions().migrate!;
    const ugm = CAMPUSES.find((c) => c.id === "ugm")!;
    const oldDefault = { lat: ugm.lat, lng: ugm.lng, label: ugm.name, source: "campus", campus_id: "ugm", updated_at: null, radius_m: 5000 };
    expect(migrate(oldDefault, 1)).toMatchObject({ ...DEFAULT_LOCATION, radius_m: 5000 });
    const chosen = { ...oldDefault, updated_at: "2026-11-01T10:00:00.000Z" };
    expect(migrate(chosen, 1)).toEqual(chosen);
  });

  it("refreshes a chosen v1 campus label renamed since (IPB Bogor → IPB Dramaga, Bogor)", () => {
    const migrate = useLocationStore.persist.getOptions().migrate!;
    const ipb = CAMPUSES.find((c) => c.id === "ipb")!;
    const chosenIpb = { lat: ipb.lat, lng: ipb.lng, label: "IPB Bogor", source: "campus", campus_id: "ipb", updated_at: "2026-11-01T10:00:00.000Z", radius_m: 2000 };
    expect(migrate(chosenIpb, 1)).toEqual({ ...chosenIpb, label: "IPB Dramaga, Bogor" });
    // A manually picked point keeps its own label.
    const manual = { ...chosenIpb, source: "manual", campus_id: null, label: "Titik pilihan" };
    expect(migrate(manual, 1)).toEqual(manual);
  });

  it("only accepts the allowed radius options", () => {
    useLocationStore.getState().setRadius(5000);
    expect(useLocationStore.getState().radius_m).toBe(5000);
    useLocationStore.getState().setRadius(3000);
    expect(useLocationStore.getState().radius_m).toBe(2000);
  });

  it("switches between gps and campus sources", () => {
    useLocationStore.getState().setLocation({ lat: -7.78, lng: 110.38, source: "gps" });
    expect(useLocationStore.getState()).toMatchObject({ source: "gps", campus_id: null, label: "Lokasi kamu saat ini" });
    useLocationStore.getState().setCampus("itb");
    expect(useLocationStore.getState()).toMatchObject({ source: "campus", campus_id: "itb", label: "ITB Bandung" });
  });

  it("formats radius labels", () => {
    expect(formatRadius(2000)).toBe("2 km");
    expect(formatRadius(500)).toBe("500 m");
  });
});

describe("tickets store (offline pickup passes)", () => {
  const order = (id: string, status: OrderDetail["status"], deadline: string) =>
    ({ id, status, pickup_deadline_at: deadline }) as OrderDetail;

  beforeEach(() => useTicketsStore.getState().clear());

  it("keeps READY_FOR_PICKUP orders and drops them on any other status", () => {
    const s = useTicketsStore.getState();
    s.syncOrder(order("o1", "READY_FOR_PICKUP", "2026-11-08T15:00:00.000Z"));
    s.syncOrder(order("o2", "PAID", "2026-11-08T15:00:00.000Z"));
    expect(Object.keys(useTicketsStore.getState().tickets)).toEqual(["o1"]);
    s.syncOrder(order("o1", "COMPLETED", "2026-11-08T15:00:00.000Z"));
    expect(useTicketsStore.getState().tickets).toEqual({});
  });

  it("prunes tickets past their deadline + grace and sorts by deadline", () => {
    const s = useTicketsStore.getState();
    s.syncOrder(order("late", "READY_FOR_PICKUP", "2026-11-08T16:00:00.000Z"));
    s.syncOrder(order("early", "READY_FOR_PICKUP", "2026-11-08T15:00:00.000Z"));
    s.syncOrder(order("old", "READY_FOR_PICKUP", "2026-11-08T10:00:00.000Z"));
    expect(selectTicketList(useTicketsStore.getState()).map((t) => t.order.id)).toEqual(["old", "early", "late"]);
    s.pruneExpired(Date.parse("2026-11-08T12:00:00.000Z"), 60);
    expect(selectTicketList(useTicketsStore.getState()).map((t) => t.order.id)).toEqual(["early", "late"]);
  });
});
