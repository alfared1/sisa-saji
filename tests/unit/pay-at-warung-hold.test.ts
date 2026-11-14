/**
 * "Bayar di warung" hold rules that need no database: when a free hold ends, when it is
 * over, and how the buyer's ticket tells a warung cancellation apart.
 */
import { describe, expect, it } from "vitest";
import {
  buyerCancelText,
  isCancelledByWarung,
  MERCHANT_TICKET_CANCEL_REASONS,
  noShowCancelOpensAt,
  PAY_AT_WARUNG_NO_SHOW_LAST_MINUTES,
  PAY_AT_WARUNG_EXPIRED_REASON,
  PAY_AT_WARUNG_HOLD_MINUTES,
  PAY_AT_WARUNG_MAX_PORTIONS,
} from "@/lib/constants";
import { MerchantTicketCancelBody } from "@/lib/contracts";
import { isHoldOver, payAtWarungHoldEnd } from "@/server/services/orders/hold";

const t0 = new Date("2026-11-12T13:00:00Z"); // 20.00 WIB
const plus = (min: number) => new Date(t0.getTime() + min * 60_000);

describe("payAtWarungHoldEnd", () => {
  it("is a short hold, not the whole evening: 30 minutes for every cash ticket", () => {
    expect(PAY_AT_WARUNG_HOLD_MINUTES).toBe(30);
    expect(payAtWarungHoldEnd(t0, plus(180))).toEqual(plus(30));
  });

  it("never runs past the batch's pickup end", () => {
    expect(payAtWarungHoldEnd(t0, plus(20))).toEqual(plus(20));
    expect(payAtWarungHoldEnd(t0, plus(PAY_AT_WARUNG_HOLD_MINUTES))).toEqual(plus(PAY_AT_WARUNG_HOLD_MINUTES));
  });
});

describe("noShowCancelOpensAt", () => {
  it(`opens "Tidak datang" only in the last ${PAY_AT_WARUNG_NO_SHOW_LAST_MINUTES} minutes of a full hold`, () => {
    expect(noShowCancelOpensAt(t0, plus(60))).toEqual(plus(60 - PAY_AT_WARUNG_NO_SHOW_LAST_MINUTES));
    // A full 30-minute cash hold: from +15 (half of the hold, also the last 15 minutes).
    expect(noShowCancelOpensAt(t0, payAtWarungHoldEnd(t0, plus(180)))).toEqual(plus(15));
  });

  it("never before half of a short hold has passed", () => {
    expect(noShowCancelOpensAt(t0, plus(10))).toEqual(plus(5));
    expect(noShowCancelOpensAt(t0.toISOString(), plus(20).toISOString())).toEqual(plus(10));
  });
});

describe("isHoldOver", () => {
  it("is over exactly at the deadline, with no grace period", () => {
    expect(isHoldOver(plus(60), plus(59))).toBe(false);
    expect(isHoldOver(plus(60), plus(60))).toBe(true);
    expect(isHoldOver(plus(60), plus(61))).toBe(true);
  });
});

describe("ticket cancellation reasons", () => {
  it("tells a warung cancellation apart from the buyer's own or an expiry", () => {
    expect(isCancelledByWarung(MERCHANT_TICKET_CANCEL_REASONS.NO_SHOW.reason)).toBe(true);
    expect(isCancelledByWarung(MERCHANT_TICKET_CANCEL_REASONS.OUT_OF_STOCK.reason)).toBe(true);
    expect(isCancelledByWarung("Dibatalkan oleh pembeli")).toBe(false);
    expect(isCancelledByWarung(PAY_AT_WARUNG_EXPIRED_REASON)).toBe(false);
    expect(isCancelledByWarung(null)).toBe(false);
  });

  it("offers exactly the two reasons the warung can pick, in friendly Indonesian", () => {
    expect(Object.values(MERCHANT_TICKET_CANCEL_REASONS).map((r) => r.label)).toEqual(["Tidak datang", "Stok habis"]);
    expect(MerchantTicketCancelBody.safeParse({ reason: "NO_SHOW" }).success).toBe(true);
    expect(MerchantTicketCancelBody.safeParse({ reason: "OUT_OF_STOCK" }).success).toBe(true);
    expect(MerchantTicketCancelBody.safeParse({ reason: "BOSAN" }).success).toBe(false);
    for (const r of Object.values(MERCHANT_TICKET_CANCEL_REASONS)) expect(r.reason).not.toContain("—");
  });

  it("words the reason for the buyer, saying whether it counts as a no-show", () => {
    expect(buyerCancelText(MERCHANT_TICKET_CANCEL_REASONS.NO_SHOW.reason)).toMatch(/tiketmu.*dihitung sebagai tiket tidak diambil/);
    expect(buyerCancelText(MERCHANT_TICKET_CANCEL_REASONS.OUT_OF_STOCK.reason)).toMatch(/tidak dihitung/);
    expect(buyerCancelText(PAY_AT_WARUNG_EXPIRED_REASON)).toMatch(/^Tiketmu/);
    expect(buyerCancelText("Dibatalkan oleh pembeli")).toBe("Dibatalkan oleh pembeli");
    expect(buyerCancelText(null)).toBeNull();
  });

  it("keeps a ticket small enough that a couple of accounts cannot hold a whole batch", () => {
    expect(PAY_AT_WARUNG_MAX_PORTIONS).toBeGreaterThanOrEqual(1);
    expect(PAY_AT_WARUNG_MAX_PORTIONS).toBeLessThanOrEqual(3);
  });
});
