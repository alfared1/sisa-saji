import { describe, expect, it } from "vitest";
import {
  activeCustomerHref,
  isCustomerTabRoot,
  loginHrefFor,
  showsCartBar,
  showsDesktopCartButton,
  showsDesktopLoginButton,
} from "@/components/shell/nav-logic";

describe("activeCustomerHref (desktop top nav)", () => {
  it("lights the tab for its root and deeper pages", () => {
    expect(activeCustomerHref("/discover")).toBe("/discover");
    expect(activeCustomerHref("/orders")).toBe("/orders");
    expect(activeCustomerHref("/orders/7f1c2a")).toBe("/orders");
    expect(activeCustomerHref("/profile")).toBe("/profile");
  });

  it("lights nothing for pages outside the tabs", () => {
    expect(activeCustomerHref("/warung/gudeg-yu-djum")).toBeNull();
    expect(activeCustomerHref("/checkout")).toBeNull();
    expect(activeCustomerHref("/ordersx")).toBeNull();
    expect(activeCustomerHref("/")).toBeNull();
  });
});

describe("showsDesktopCartButton", () => {
  it("needs a hydrated, non-empty cart", () => {
    expect(showsDesktopCartButton({ pathname: "/discover", hydrated: false, count: 2 })).toBe(false);
    expect(showsDesktopCartButton({ pathname: "/discover", hydrated: true, count: 0 })).toBe(false);
    expect(showsDesktopCartButton({ pathname: "/discover", hydrated: true, count: 1 })).toBe(true);
  });

  it("shows on every customer page except checkout", () => {
    expect(showsDesktopCartButton({ pathname: "/orders/abc", hydrated: true, count: 1 })).toBe(true);
    expect(showsDesktopCartButton({ pathname: "/profile", hydrated: true, count: 1 })).toBe(true);
    expect(showsDesktopCartButton({ pathname: "/checkout", hydrated: true, count: 1 })).toBe(false);
  });
});

describe("showsDesktopLoginButton", () => {
  it("waits for hydration and the session answer", () => {
    expect(showsDesktopLoginButton({ hydrated: false, isLoading: false, loggedIn: false })).toBe(false);
    expect(showsDesktopLoginButton({ hydrated: true, isLoading: true, loggedIn: false })).toBe(false);
    expect(showsDesktopLoginButton({ hydrated: true, isLoading: false, loggedIn: true })).toBe(false);
    expect(showsDesktopLoginButton({ hydrated: true, isLoading: false, loggedIn: false })).toBe(true);
  });
});

describe("loginHrefFor", () => {
  it("returns to the current page after login", () => {
    expect(loginHrefFor("/warung/gudeg-yu-djum")).toBe("/auth/login?next=%2Fwarung%2Fgudeg-yu-djum");
    expect(loginHrefFor("/")).toBe("/auth/login");
    expect(loginHrefFor("")).toBe("/auth/login");
  });
});

describe("phone chrome rules are unchanged", () => {
  it("bottom tabs on the five roots, cart bar on shopping screens", () => {
    expect(isCustomerTabRoot("/discover")).toBe(true);
    expect(isCustomerTabRoot("/orders/abc")).toBe(false);
    expect(showsCartBar("/warung/abc")).toBe(true);
    expect(showsCartBar("/checkout")).toBe(false);
  });
});
