import { describe, expect, it } from "vitest";
import { createPickupToken, verifyPickupToken } from "@/lib/pickup-token";
import { parsePickupInput } from "@/server/services/orders/pickup";
import { findVoucher } from "@/server/services/orders/checkout";

const ORDER_ID = "3f2b8c1e-7a6d-4e2f-9b1a-0c5d6e7f8a9b";
const SECRET = "unit-test-pickup-secret-0123456789abcdef";

describe("parsePickupInput", () => {
  it.each(["1234", "SJ-1234", "sj-1234", "SJ1234", " SJ-1234 ", "12 34"])("%s is a 4-digit code", (raw) => {
    expect(parsePickupInput(raw)).toEqual({ kind: "code", code: "1234" });
  });

  it("keeps leading zeros", () => {
    expect(parsePickupInput("SJ-0042")).toEqual({ kind: "code", code: "0042" });
  });

  it("treats a QR token as a token and extracts the order id", () => {
    const token = createPickupToken(ORDER_ID, "1234", SECRET);
    expect(parsePickupInput(token)).toEqual({ kind: "token", token, orderId: ORDER_ID });
  });

  it("garbage is a token without an order id", () => {
    expect(parsePickupInput("12345")).toMatchObject({ kind: "token", orderId: null });
    expect(parsePickupInput("not-a-uuid.sig")).toMatchObject({ kind: "token", orderId: null });
  });
});

describe("pickup token", () => {
  it("verifies only with the right code and secret", () => {
    const token = createPickupToken(ORDER_ID, "1234", SECRET);
    expect(verifyPickupToken(token, "1234", SECRET)).toBe(ORDER_ID);
    expect(verifyPickupToken(token, "1235", SECRET)).toBeNull();
    expect(verifyPickupToken(token, "1234", "other-secret")).toBeNull();
    const otherOrder = token.replace(ORDER_ID, "00000000-0000-4000-8000-000000000000");
    expect(verifyPickupToken(otherOrder, "1234", SECRET)).toBeNull();
  });
});

describe("findVoucher", () => {
  it("returns null without a code and matches case-insensitively", () => {
    expect(findVoucher(undefined)).toBeNull();
    expect(findVoucher("hemat2k")?.discount_idr).toBe(2000);
  });
  it("unknown codes are VOUCHER_INVALID", () => {
    expect(() => findVoucher("GRATIS100")).toThrow(expect.objectContaining({ code: "VOUCHER_INVALID" }));
  });
});
