import { describe, expect, it } from "vitest";
import {
  QUICK_ORDER_PARAM,
  clampQuickOrderQty,
  quickOrderBody,
  quickOrderError,
  quickOrderLoginUrl,
  quickOrderMaxQty,
  quickOrderReturnPath,
} from "@/components/customer/quick-order/quick-order-logic";
import { safeNextPath } from "@/app/(public)/auth/auth-flow";

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
});

describe("quick order checkout body", () => {
  it("checks out exactly one batch with QRIS (no cart, no slot)", () => {
    expect(quickOrderBody({ merchant_id: "m-1", batch_id: BATCH_ID }, 2)).toEqual({
      merchant_id: "m-1",
      items: [{ batch_id: BATCH_ID, quantity: 2 }],
      payment_method: "QRIS",
    });
  });

  it("pays at the warung for a pilot warung", () => {
    expect(quickOrderBody({ merchant_id: "m-1", batch_id: BATCH_ID, merchant_is_pilot: true }, 1).payment_method).toBe(
      "BAYAR_DI_WARUNG",
    );
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

  it("BATCH_CLOSED and network errors get Indonesian copy", () => {
    expect(quickOrderError("BATCH_CLOSED", "x", undefined, "Roti")).toMatchObject({ kind: "closed", title: "Roti sudah tutup" });
    expect(quickOrderError("NETWORK_ERROR", "x", undefined, "Roti")).toMatchObject({ kind: "generic", title: "Tidak ada koneksi" });
    expect(quickOrderError("INTERNAL_ERROR", "Server sibuk", undefined, "Roti")).toMatchObject({ kind: "generic", title: "Server sibuk" });
  });
});
