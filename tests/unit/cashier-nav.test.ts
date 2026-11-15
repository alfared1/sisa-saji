import { describe, expect, it } from "vitest";
import { CASHIER_HOME_PATH, merchantGuardDecision } from "@/components/shell/nav-logic";

const base = { isLoading: false, isError: false };
const cashier = { merchant_id: null, cashier_of: { merchant_id: "w1" } };

describe("merchant guard for a cashier", () => {
  it("opens the counter pages", () => {
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/orders", user: cashier }).kind).toBe("shell");
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/orders/scan", user: cashier }).kind).toBe("shell");
  });
  it("sends every other merchant page, onboarding included, to the pickup queue", () => {
    for (const pathname of ["/merchant/dashboard", "/merchant/saldo", "/merchant/settings", "/merchant/onboarding", "/merchant/menus"]) {
      expect(merchantGuardDecision({ ...base, pathname, user: cashier })).toEqual({ kind: "redirect", to: CASHIER_HOME_PATH });
    }
  });
  it("leaves owners as before", () => {
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/saldo", user: { merchant_id: "w1", cashier_of: null } }).kind).toBe("shell");
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/dashboard", user: { merchant_id: null, cashier_of: null } })).toEqual({
      kind: "redirect",
      to: "/merchant/onboarding",
    });
  });
});
