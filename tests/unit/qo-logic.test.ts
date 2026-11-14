import { describe, expect, it } from "vitest";
import {
  QUICK_ORDER_PARAM,
  clampQuickOrderQty,
  quickOrderBody,
  quickOrderError,
  quickOrderIsCash,
  quickOrderLoginUrl,
  quickOrderMaxQty,
  quickOrderReturnPath,
} from "@/components/customer/quick-order/quick-order-logic";
import { safeNextPath } from "@/app/(public)/auth/auth-flow";
import { ticketLineMax, trimToTicketCap } from "@/components/customer/lib/checkout-logic";
import { PAY_AT_WARUNG_MAX_PORTIONS } from "@/lib/constants";

const BATCH_ID = "3f1c2a4e-1111-4222-8333-944455556666";

describe("quick order stepper bounds", () => {
  it("caps at min(available, 10) and never below 1", () => {
    expect(quickOrderMaxQty(4)).toBe(4);
    expect(quickOrderMaxQty(25)).toBe(10);
    expect(quickOrderMaxQty(0)).toBe(1);
  });

  it("clamps the stepper value into 1..max", () => {
    expect(clampQuickOrderQty(0, 4)).toBe(1);
    expect(clampQuickOrderQty(3, 4)).toBe(3);
    expect(clampQuickOrderQty(9, 4)).toBe(4);
    expect(clampQuickOrderQty(15, 30)).toBe(10);
  });

  it("caps a cash (bayar-di-warung) ticket at PAY_AT_WARUNG_MAX_PORTIONS", () => {
    expect(quickOrderMaxQty(25, true)).toBe(PAY_AT_WARUNG_MAX_PORTIONS);
    expect(quickOrderMaxQty(2, true)).toBe(2);
    expect(clampQuickOrderQty(8, 25, true)).toBe(PAY_AT_WARUNG_MAX_PORTIONS);
  });

  it("is cash whenever the buyer picks cash or the warung is a pilot warung", () => {
    expect(quickOrderIsCash({ merchant_is_pilot: false }, "QRIS")).toBe(false);
    expect(quickOrderIsCash({ merchant_is_pilot: false }, "BAYAR_DI_WARUNG")).toBe(true);
    expect(quickOrderIsCash({ merchant_is_pilot: true }, "QRIS")).toBe(true);
    expect(quickOrderIsCash({}, "QRIS")).toBe(false);
  });

  it("caps at 3 whenever cash, at any warung", () => {
    const cash = quickOrderIsCash({ merchant_is_pilot: false }, "BAYAR_DI_WARUNG");
    expect(quickOrderMaxQty(25, cash)).toBe(PAY_AT_WARUNG_MAX_PORTIONS);
    expect(clampQuickOrderQty(5, 25, quickOrderIsCash({ merchant_is_pilot: false }, "QRIS"))).toBe(5);
  });
});

describe("bayar-di-warung ticket cap in the cart (by line key)", () => {
  // The same batch on two lines (two lauk) counts as two lines towards the ticket.
  const cart = [
    { key: "a|Ayam goreng", quantity: 2 },
    { key: "a|Pepes ikan", quantity: 1 },
    { key: "b|", quantity: 1 },
  ];
  it("counts every other line towards the per-ticket cap", () => {
    expect(ticketLineMax(cart, "a|Ayam goreng", 10, 3)).toBe(1);
    expect(ticketLineMax(cart, "b|", 10, 3)).toBe(0);
    expect(ticketLineMax([{ key: "a|", quantity: 1 }], "a|", 10, 3)).toBe(3);
    expect(ticketLineMax([{ key: "a|", quantity: 1 }], "a|", 2, 3)).toBe(2);
  });

  it("trims the last lines first down to the cap", () => {
    expect(trimToTicketCap(cart, 3)).toEqual([{ key: "b|", quantity: 0 }]);
    expect(trimToTicketCap(cart, 1)).toEqual([
      { key: "b|", quantity: 0 },
      { key: "a|Pepes ikan", quantity: 0 },
      { key: "a|Ayam goreng", quantity: 1 },
    ]);
    expect(trimToTicketCap(cart, 4)).toEqual([]);
  });
});

describe("quick order checkout body", () => {
  it("checks out exactly one batch with QRIS by default (no cart, no slot, no lauk)", () => {
    expect(quickOrderBody({ merchant_id: "m-1", batch_id: BATCH_ID }, 2)).toEqual({
      merchant_id: "m-1",
      items: [{ batch_id: BATCH_ID, quantity: 2 }],
      payment_method: "QRIS",
    });
  });

  it("sends the chosen lauk and payment method", () => {
    expect(quickOrderBody({ merchant_id: "m-1", batch_id: BATCH_ID }, 1, { method: "BAYAR_DI_WARUNG", lauk: "Ayam goreng" })).toEqual({
      merchant_id: "m-1",
      items: [{ batch_id: BATCH_ID, quantity: 1, lauk: "Ayam goreng" }],
      payment_method: "BAYAR_DI_WARUNG",
    });
    expect(quickOrderBody({ merchant_id: "m-1", batch_id: BATCH_ID }, 1, { method: "QRIS", lauk: null }).items).toEqual([
      { batch_id: BATCH_ID, quantity: 1 },
    ]);
  });

  it("pays at the warung for a pilot warung, whatever was picked", () => {
    expect(quickOrderBody({ merchant_id: "m-1", batch_id: BATCH_ID, merchant_is_pilot: true }, 1).payment_method).toBe(
      "BAYAR_DI_WARUNG",
    );
    expect(
      quickOrderBody({ merchant_id: "m-1", batch_id: BATCH_ID, merchant_is_pilot: true }, 1, { method: "QRIS" }).payment_method,
    ).toBe("BAYAR_DI_WARUNG");
  });
});

describe("logged-out return path", () => {
  it("returns to the warung with ?order=<batchId>", () => {
    expect(QUICK_ORDER_PARAM).toBe("order");
    expect(quickOrderReturnPath("warung-bu-sri-pogung", BATCH_ID)).toBe(
      `/warung/warung-bu-sri-pogung?order=${BATCH_ID}`,
    );
  });

  it("URL-encodes the next param and it survives safeNextPath", () => {
    const url = quickOrderLoginUrl("warung-bu-sri-pogung", BATCH_ID);
    expect(url).toBe(`/auth/login?next=${encodeURIComponent(`/warung/warung-bu-sri-pogung?order=${BATCH_ID}`)}`);
    const next = new URL(url, "http://x").searchParams.get("next");
    expect(safeNextPath(next)).toBe(`/warung/warung-bu-sri-pogung?order=${BATCH_ID}`);
  });
});

describe("quick order error mapping", () => {
  it("UNAUTHENTICATED sends to login", () => {
    expect(quickOrderError("UNAUTHENTICATED", "x", undefined, "Nasi Gudeg")).toEqual({ kind: "login" });
  });

  it("OUT_OF_STOCK with some stock left lowers the quantity", () => {
    const e = quickOrderError("OUT_OF_STOCK", "x", { available_stock: 2 }, "Nasi Gudeg");
    expect(e).toMatchObject({ kind: "stock", available: 2 });
    expect(e.kind === "stock" && e.title).toContain("tinggal 2 porsi");
  });

  it("OUT_OF_STOCK with nothing left says it is gone", () => {
    const e = quickOrderError("OUT_OF_STOCK", "x", { available_stock: 0 }, "Nasi Gudeg");
    expect(e).toMatchObject({ kind: "stock", available: 0 });
    expect(e.kind === "stock" && e.title).toContain("sudah habis");
  });

  it("VALIDATION_ERROR for a lauk that ran out keeps the sheet open with the lauk left", () => {
    const e = quickOrderError(
      "VALIDATION_ERROR",
      "Lauk Ayam goreng sudah habis. Pilih lauk lain, ya.",
      [{ path: "items", batch_id: BATCH_ID, lauk: "Ayam goreng", lauk_available: ["Pepes ikan"] }],
      "Nasi Timbel",
    );
    expect(e).toEqual({
      kind: "lauk",
      lauk_available: ["Pepes ikan"],
      title: "Lauk Ayam goreng sudah habis. Pilih lauk lain, ya.",
      description: "Pilihan lauk sudah diperbarui.",
    });
    // Other validation errors (e.g. the per-buyer cap) stay generic.
    expect(
      quickOrderError("VALIDATION_ERROR", "Maksimal 3 porsi", [{ path: "items", batch_id: BATCH_ID, max_quantity: 3 }], "Roti"),
    ).toMatchObject({ kind: "generic", title: "Maksimal 3 porsi" });
  });

  it("BATCH_CLOSED and network errors get Indonesian copy", () => {
    expect(quickOrderError("BATCH_CLOSED", "x", undefined, "Roti")).toMatchObject({ kind: "closed", title: "Roti sudah tutup" });
    expect(quickOrderError("NETWORK_ERROR", "x", undefined, "Roti")).toMatchObject({ kind: "generic", title: "Tidak ada koneksi" });
    expect(quickOrderError("INTERNAL_ERROR", "Server sibuk", undefined, "Roti")).toMatchObject({ kind: "generic", title: "Server sibuk" });
  });
});
