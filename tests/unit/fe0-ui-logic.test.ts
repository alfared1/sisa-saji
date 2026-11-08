import { describe, expect, it } from "vitest";
import {
  cooldownRemaining,
  isFullNameRequired,
  maskIdentifier,
  newOtpFlow,
  normalisePhoneInput,
  parseRole,
  postLoginPath,
  safeNextPath,
} from "@/app/(public)/auth/auth-flow";
import { markerFromPin, pinHtml, pinState, zoomForRadius } from "@/components/map/types";
import { shouldRetry } from "@/components/providers/query-client";
import {
  activeNavHref,
  isCustomerTabRoot,
  merchantGuardDecision,
  showsCartBar,
} from "@/components/shell/nav-logic";
import { computeCountdown } from "@/hooks/use-countdown";
import { ApiClientError } from "@/lib/api/client";
import { OtpRequestBody } from "@/lib/contracts";

const NOW = Date.parse("2026-11-08T13:00:00.000Z");
const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();

describe("computeCountdown", () => {
  it("is not ready without a clock (SSR) or a valid target", () => {
    expect(computeCountdown(inMin(10), null)).toMatchObject({ ready: false, label: "--:--:--" });
    expect(computeCountdown("nope", NOW).ready).toBe(false);
  });

  it("formats HH:MM:SS and flags urgency under 45 minutes", () => {
    const c = computeCountdown(new Date(NOW + (83 * 60 + 45) * 1000).toISOString(), NOW);
    expect(c).toMatchObject({ label: "01:23:45", hours: 1, minutes: 23, seconds: 45, totalMinutes: 83, isUrgent: false });
    expect(computeCountdown(inMin(44), NOW).isUrgent).toBe(true);
    expect(computeCountdown(inMin(45), NOW).isUrgent).toBe(false);
  });

  it("is over at or after the target", () => {
    expect(computeCountdown(inMin(-3), NOW)).toMatchObject({ isOver: true, isUrgent: false, label: "00:00:00" });
  });
});

describe("map pins", () => {
  const base = { discount_pct: 60, stock: 3, closes_at: inMin(120) };

  it("derives urgency colour state", () => {
    expect(pinState(base, NOW)).toBe("hot");
    expect(pinState({ ...base, discount_pct: 45 }, NOW)).toBe("deal");
    expect(pinState({ ...base, discount_pct: 20 }, NOW)).toBe("normal");
    expect(pinState({ ...base, closes_at: inMin(30) }, NOW)).toBe("urgent");
    expect(pinState({ ...base, closes_at: inMin(-1) }, NOW)).toBe("closed");
    expect(pinState({ ...base, stock: 0 }, NOW)).toBe("closed");
    expect(pinState({ ...base, closes_at: inMin(30) }, null)).toBe("hot");
  });

  it("renders '-60%' + 'Sisa 3' and escapes merchant names", () => {
    const html = pinHtml(
      { id: "x", lat: 0, lng: 0, name: `<b>"Bu Sri"</b>`, discount_pct: 60, stock: 3, closes_at: null },
      "urgent",
    );
    expect(html).toContain("-60%");
    expect(html).toContain("Sisa 3");
    expect(html).toContain("var(--urgent)");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;&quot;Bu Sri&quot;");
  });

  it("maps contract pins and picks a zoom for the radius", () => {
    const m = markerFromPin({
      merchant_id: "id1",
      slug: "s",
      merchant_name: "W",
      lat: -7.7,
      lng: 110.3,
      distance_m: 400,
      max_discount_pct: 55,
      total_available_stock: 4,
      pickup_end_time: inMin(60),
      is_verified: true,
    });
    expect(m).toMatchObject({ id: "id1", discount_pct: 55, stock: 4, is_verified: true });
    expect(zoomForRadius(2000)).toBe(14);
    expect(zoomForRadius(10000)).toBe(12);
  });
});

describe("auth flow helpers", () => {
  it("accepts only same-origin next paths", () => {
    expect(safeNextPath("/merchant/dashboard")).toBe("/merchant/dashboard");
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("/auth/verify")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });

  it("routes after login: next first, then role defaults", () => {
    const customer = { role: "CUSTOMER" as const, merchant_id: null };
    const merchant = { role: "MERCHANT" as const, merchant_id: "m1" };
    const newMerchant = { role: "MERCHANT" as const, merchant_id: null };
    expect(postLoginPath(customer, "CUSTOMER", "/orders")).toBe("/orders");
    expect(postLoginPath(customer, "CUSTOMER", null)).toBe("/discover");
    expect(postLoginPath(merchant, "CUSTOMER", null)).toBe("/merchant/dashboard");
    expect(postLoginPath(newMerchant, "MERCHANT", null)).toBe("/merchant/onboarding");
    expect(postLoginPath(customer, "MERCHANT", null)).toBe("/merchant/onboarding");
  });

  it("normalises phone input so it passes the contract schema", () => {
    const phone = normalisePhoneInput("0812-3456 7890");
    expect(phone).toBe("081234567890");
    expect(OtpRequestBody.safeParse({ phone_number: phone }).success).toBe(true);
  });

  it("masks identifiers and parses roles", () => {
    expect(maskIdentifier("081234567890", "phone")).toBe("0812****7890");
    expect(maskIdentifier("raka@ugm.ac.id", "email")).toBe("ra**@ugm.ac.id");
    expect(parseRole("merchant")).toBe("MERCHANT");
    expect(parseRole("x")).toBe("CUSTOMER");
  });

  it("detects the 'full_name required' validation error", () => {
    expect(isFullNameRequired("VALIDATION_ERROR", [{ path: "full_name", message: "x" }])).toBe(true);
    expect(isFullNameRequired("VALIDATION_ERROR", [{ path: ["full_name"], message: "x" }])).toBe(true);
    expect(isFullNameRequired("VALIDATION_ERROR", undefined, "Nama lengkap wajib diisi")).toBe(true);
    expect(isFullNameRequired("VALIDATION_ERROR", [{ path: ["code"], message: "x" }])).toBe(false);
    expect(isFullNameRequired("OTP_INVALID", [{ path: "full_name" }])).toBe(false);
  });

  it("computes the 60 s resend cooldown", () => {
    const flow = newOtpFlow({ identifier: "0812", kind: "phone", role: "CUSTOMER", channel: "WHATSAPP", dev_code: null }, NOW);
    expect(cooldownRemaining(flow.sent_at, NOW + 1_000)).toBe(59);
    expect(cooldownRemaining(flow.sent_at, NOW + 60_000)).toBe(0);
    expect(cooldownRemaining(null, NOW)).toBe(0);
  });
});

describe("shell navigation + merchant guard", () => {
  it("highlights the most specific merchant nav item", () => {
    const hrefs = ["/merchant/dashboard", "/merchant/orders", "/merchant/orders/scan"];
    expect(activeNavHref("/merchant/orders/scan", hrefs)).toBe("/merchant/orders/scan");
    expect(activeNavHref("/merchant/orders/123", hrefs)).toBe("/merchant/orders");
    expect(activeNavHref("/merchant/ordersX", hrefs)).toBeNull();
  });

  it("shows tabs only on tab roots and the cart bar on shopping screens", () => {
    expect(isCustomerTabRoot("/discover")).toBe(true);
    expect(isCustomerTabRoot("/orders/abc")).toBe(false);
    expect(showsCartBar("/warung/bu-sri")).toBe(true);
    expect(showsCartBar("/checkout")).toBe(false);
  });

  it("guards /merchant routes", () => {
    const base = { isLoading: false, isError: false };
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/menus", isLoading: true, user: null }).kind).toBe("loading");
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/menus", user: null })).toEqual({
      kind: "redirect",
      to: "/auth/login?role=MERCHANT&next=%2Fmerchant%2Fmenus",
    });
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/menus", user: { merchant_id: null } })).toEqual({
      kind: "redirect",
      to: "/merchant/onboarding",
    });
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/onboarding", user: { merchant_id: null } }).kind).toBe(
      "onboarding",
    );
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/onboarding", user: { merchant_id: "m" } })).toEqual({
      kind: "redirect",
      to: "/merchant/dashboard",
    });
    expect(merchantGuardDecision({ ...base, pathname: "/merchant/dashboard", user: { merchant_id: "m" } }).kind).toBe("shell");
  });
});

describe("query retry policy", () => {
  it("never retries 4xx and retries other failures twice", () => {
    expect(shouldRetry(0, new ApiClientError("NOT_FOUND", "x", 404))).toBe(false);
    expect(shouldRetry(0, new ApiClientError("UNAUTHENTICATED", "x", 401))).toBe(false);
    expect(shouldRetry(0, new ApiClientError("INTERNAL_ERROR", "x", 500))).toBe(true);
    expect(shouldRetry(1, new ApiClientError("NETWORK_ERROR", "x", 0))).toBe(true);
    expect(shouldRetry(2, new Error("x"))).toBe(false);
  });
});
