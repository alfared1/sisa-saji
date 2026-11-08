/**
 * Pure navigation/guard decisions for the shells (no React, unit-tested).
 */
export const MERCHANT_ONBOARDING_PATH = "/merchant/onboarding";
export const MERCHANT_HOME_PATH = "/merchant/dashboard";

export const CUSTOMER_TAB_HREFS = ["/discover", "/map", "/orders", "/impact", "/profile"] as const;

/** Routes where the floating cart bar is shown (shopping screens). */
export const CART_BAR_ROUTES: readonly RegExp[] = [/^\/discover$/, /^\/map$/, /^\/warung\/[^/]+$/];

export function isCustomerTabRoot(pathname: string): boolean {
  return CUSTOMER_TAB_HREFS.some((href) => pathname === href);
}

export function showsCartBar(pathname: string): boolean {
  return CART_BAR_ROUTES.some((r) => r.test(pathname));
}

/** Longest matching href wins (so /merchant/orders/scan lights up "Scan", not "Pesanan"). */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}

export type MerchantGuardDecision =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "redirect"; to: string }
  | { kind: "onboarding" }
  | { kind: "shell" };

export function merchantGuardDecision(args: {
  pathname: string;
  isLoading: boolean;
  isError: boolean;
  user: { merchant_id: string | null } | null;
}): MerchantGuardDecision {
  const { pathname, isLoading, isError, user } = args;
  if (isLoading) return { kind: "loading" };
  if (isError) return { kind: "error" };
  const onOnboarding = pathname === MERCHANT_ONBOARDING_PATH || pathname.startsWith(`${MERCHANT_ONBOARDING_PATH}/`);
  if (!user) return { kind: "redirect", to: `/auth/login?role=MERCHANT&next=${encodeURIComponent(pathname)}` };
  if (!user.merchant_id) return onOnboarding ? { kind: "onboarding" } : { kind: "redirect", to: MERCHANT_ONBOARDING_PATH };
  if (onOnboarding) return { kind: "redirect", to: MERCHANT_HOME_PATH };
  return { kind: "shell" };
}
