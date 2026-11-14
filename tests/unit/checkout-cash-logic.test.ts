import { describe, expect, it } from "vitest";
import {
  cartLineMax,
  effectivePaymentMethod,
  holdNoteText,
  isCashPayment,
  laukUnavailable,
  lockedToastText,
  perBuyerCaps,
  previewTotals,
  trimToTicketCap,
} from "@/components/customer/lib/checkout-logic";
import {
  PICKUP_TAGS,
  orderLineText,
  payAtWarungAudience,
  reviewAnswerChips,
} from "@/components/customer/lib/order-status";
import { SLOT_MIN_LEAD_MINUTES, generatePickupSlots, pickupEndIso } from "@/components/customer/lib/pickup-slots";
import { PAY_AT_WARUNG_HOLD_MINUTES, PLATFORM_COMMISSION_DEFAULT_IDR } from "@/lib/constants";

const items = [
  { quantity: 2, unit_price_idr: 11_000, original_price_idr: 22_000, portion_weight_grams: 200 },
  { quantity: 1, unit_price_idr: 10_000, original_price_idr: 18_000, portion_weight_grams: 200 },
];
const voucher = { discount_idr: 2_000, min_subtotal_idr: 10_000 };

describe("cash at any warung", () => {
  it("is cash when chosen, or forced by a pilot warung", () => {
    expect(isCashPayment(false, "QRIS")).toBe(false);
    expect(isCashPayment(false, "GOPAY")).toBe(false);
    expect(isCashPayment(false, "BAYAR_DI_WARUNG")).toBe(true);
    expect(isCashPayment(true, "QRIS")).toBe(true);
    expect(effectivePaymentMethod(true, "DANA")).toBe("BAYAR_DI_WARUNG");
    expect(effectivePaymentMethod(false, "DANA")).toBe("DANA");
  });

  it("previewTotals: cash pays no service fee and takes no voucher", () => {
    const p = previewTotals({ items, voucher, method: "BAYAR_DI_WARUNG" });
    expect(p.subtotal_recovery_idr).toBe(32_000);
    expect(p.service_fee_idr).toBe(0);
    expect(p.voucher_discount_idr).toBe(0);
    expect(p.total_idr).toBe(32_000);
    expect(p.money_saved_idr).toBe(62_000 - 32_000);
  });

  it("previewTotals: QRIS and wallets pay the fee and may use a voucher", () => {
    for (const method of ["QRIS", "GOPAY", "DANA"] as const) {
      const p = previewTotals({ items, voucher, method });
      expect(p.service_fee_idr).toBe(PLATFORM_COMMISSION_DEFAULT_IDR);
      expect(p.voucher_discount_idr).toBe(2_000);
      expect(p.total_idr).toBe(32_000 + PLATFORM_COMMISSION_DEFAULT_IDR - 2_000);
    }
  });

  it("previewTotals keeps its old signature (no method = default fee, explicit fee wins)", () => {
    expect(previewTotals({ items, voucher: null }).service_fee_idr).toBe(PLATFORM_COMMISSION_DEFAULT_IDR);
    expect(previewTotals({ items, voucher: null, serviceFeeIdr: 0 }).service_fee_idr).toBe(0);
  });

  it("hold notes and toasts only promise the cash hold on the cash path", () => {
    expect(holdNoteText(true)).toBe(
      `Porsi ditahan ${PAY_AT_WARUNG_HOLD_MINUTES} menit. Datang, tunjukkan QR atau PIN, lalu bayar di warung.`,
    );
    expect(holdNoteText(false)).toBe("Porsi dikunci 10 menit sampai kamu bayar.");
    expect(holdNoteText(false)).not.toContain(String(PAY_AT_WARUNG_HOLD_MINUTES));
    expect(lockedToastText(true)).toBe(`Porsi dikunci ${PAY_AT_WARUNG_HOLD_MINUTES} menit. Tunjukkan kode di warung.`);
    expect(lockedToastText(false)).toBe("Porsi dikunci 10 menit. Selesaikan pembayaran.");
  });
});

describe("pickup slots for a cash ticket", () => {
  const NOW = Date.parse("2026-11-08T13:07:00Z"); // 20.07 WIB
  const batchEnd = "2026-11-08T15:00:00Z"; // 22.00 WIB

  it("ends at the hold end (now + 30 min) for cash, at the batch end otherwise", () => {
    expect(pickupEndIso({ nowMs: NOW, earliestEndIso: batchEnd, cash: false })).toBe(batchEnd);
    expect(pickupEndIso({ nowMs: NOW, earliestEndIso: batchEnd, cash: true })).toBe(
      new Date(NOW + PAY_AT_WARUNG_HOLD_MINUTES * 60_000).toISOString(),
    );
    // Never after the batch end.
    const soon = "2026-11-08T13:20:00Z";
    expect(pickupEndIso({ nowMs: NOW, earliestEndIso: soon, cash: true })).toBe(new Date(soon).toISOString());
    expect(pickupEndIso({ nowMs: NOW, earliestEndIso: null, cash: true })).toBeNull();
    expect(pickupEndIso({ nowMs: NOW, earliestEndIso: "nope", cash: true })).toBeNull();
  });

  it("offers no slot past the cash hold", () => {
    const end = pickupEndIso({ nowMs: NOW, earliestEndIso: batchEnd, cash: true });
    const slots = generatePickupSlots({ nowMs: NOW, endIso: end });
    // 20.07 → hold ends 20.37; slots every 15 min with a 5-minute lead: 20.15, 20.30.
    expect(slots.map((s) => s.label)).toEqual(["20.15", "20.30"]);
    const holdEnd = NOW + PAY_AT_WARUNG_HOLD_MINUTES * 60_000;
    for (const s of slots) expect(Date.parse(s.iso)).toBeLessThanOrEqual(holdEnd - SLOT_MIN_LEAD_MINUTES * 60_000);
    // QRIS keeps the whole evening.
    expect(generatePickupSlots({ nowMs: NOW, endIso: batchEnd }).length).toBeGreaterThan(slots.length);
  });
});

describe("cart lines keyed by batch + lauk", () => {
  const cart = [
    { key: "a|Ayam goreng", batch_id: "a", quantity: 2 },
    { key: "a|Pepes ikan", batch_id: "a", quantity: 1 },
    { key: "b|", batch_id: "b", quantity: 4 },
  ];

  it("cartLineMax shares the batch cap across its lines", () => {
    expect(cartLineMax(cart, "a|Ayam goreng", 5)).toBe(4);
    expect(cartLineMax(cart, "a|Pepes ikan", 5)).toBe(3);
    expect(cartLineMax(cart, "b|", 10)).toBe(10);
    // Never below the line's own quantity, even with a stale cap.
    expect(cartLineMax(cart, "a|Ayam goreng", 2)).toBe(2);
    expect(cartLineMax(cart, "missing", 5)).toBe(0);
  });

  it("trimToTicketCap trims by line key, last lines first", () => {
    expect(trimToTicketCap(cart, 3)).toEqual([{ key: "b|", quantity: 0 }]);
    expect(trimToTicketCap(cart, 2)).toEqual([
      { key: "b|", quantity: 0 },
      { key: "a|Pepes ikan", quantity: 0 },
    ]);
    expect(trimToTicketCap(cart, 6)).toEqual([{ key: "b|", quantity: 3 }]);
    expect(trimToTicketCap(cart, 7)).toEqual([]);
  });
});

describe("checkout errors about lauk", () => {
  it("reads the lauk that ran out and what is left", () => {
    expect(
      laukUnavailable("VALIDATION_ERROR", [
        { path: "items", batch_id: "b-1", lauk: "Ayam goreng", lauk_available: ["Pepes ikan", 3] },
      ]),
    ).toEqual([{ batch_id: "b-1", lauk: "Ayam goreng", lauk_available: ["Pepes ikan"] }]);
  });

  it("ignores other errors and other details", () => {
    expect(laukUnavailable("OUT_OF_STOCK", [{ batch_id: "b-1", lauk: "x", lauk_available: [] }])).toEqual([]);
    expect(laukUnavailable("VALIDATION_ERROR", [{ path: "items", batch_id: "b-1", max_quantity: 3 }])).toEqual([]);
    expect(laukUnavailable("VALIDATION_ERROR", { batch_id: "b-1" })).toEqual([]);
    // …and the per-buyer cap parser ignores lauk details.
    expect(perBuyerCaps("VALIDATION_ERROR", [{ path: "items", batch_id: "b-1", lauk: "x", lauk_available: [] }])).toEqual([]);
  });
});

describe("tickets and reviews", () => {
  it("picks the pay-at-warung copy from is_pilot / is_demo_data, neutral when unknown", () => {
    expect(payAtWarungAudience({ is_pilot: true, is_demo_data: true })).toBe("pilot");
    expect(payAtWarungAudience({ is_pilot: true })).toBe("pilot");
    expect(payAtWarungAudience({ is_pilot: false, is_demo_data: true })).toBe("demo");
    expect(payAtWarungAudience({ is_pilot: false, is_demo_data: false })).toBe("neutral");
    // A ticket cached offline before these fields existed.
    expect(payAtWarungAudience({})).toBe("neutral");
  });

  it("writes order lines with the lauk", () => {
    expect(orderLineText({ quantity: 2, menu_name: "Nasi Timbel", lauk: "Ayam goreng" })).toBe("2× Nasi Timbel (Lauk: Ayam goreng)");
    expect(orderLineText({ quantity: 1, menu_name: "Es Teh", lauk: null })).toBe("1× Es Teh");
    expect(orderLineText({ quantity: 1, menu_name: "Es Teh" })).toBe("1× Es Teh");
  });

  it("shows a review's optional answers only when given", () => {
    expect(reviewAnswerChips({ hygiene_rating: 5, portion_full: true })).toEqual(["Kebersihan 5/5", "Porsi normal"]);
    expect(reviewAnswerChips({ hygiene_rating: null, portion_full: false })).toEqual(["Porsi kurang"]);
    expect(reviewAnswerChips({ hygiene_rating: null, portion_full: null })).toEqual([]);
    expect(reviewAnswerChips({})).toEqual([]);
  });

  it("review tags no longer claim big portions", () => {
    expect(PICKUP_TAGS).toContain("Lauk sesuai pilihan");
    expect(PICKUP_TAGS).not.toContain("Porsi Banyak");
  });
});
