"use client";

/**
 * Client guard for /merchant/**:
 *  - logged out                   → /auth/login?role=MERCHANT&next=<path>
 *  - logged in, no warung yet     → /merchant/onboarding (rendered without nav)
 *  - has a warung, on onboarding  → /merchant/dashboard
 */
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ErrorState } from "@/components/common/error-state";
import { Logo } from "@/components/common/logo";
import { useSession } from "@/hooks/use-session";
import { AppSplash } from "./app-splash";
import { MerchantShell } from "./merchant-shell";
import { isOnboardingPath, merchantGuardDecision } from "./nav-logic";

export { MERCHANT_ONBOARDING_PATH, merchantGuardDecision } from "./nav-logic";

function OnboardingFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app-backdrop min-h-dvh">
      <header className="safe-top mx-auto flex h-16 w-full max-w-2xl items-center px-4">
        <Logo />
        <span className="ml-2 rounded-md bg-deal-soft px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-deal uppercase">
          Mitra
        </span>
      </header>
      <main id="konten" className="safe-bottom mx-auto w-full max-w-2xl px-4 pb-10">
        {children}
      </main>
    </div>
  );
}

export function MerchantGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/merchant/dashboard";
  const router = useRouter();
  const session = useSession();
  const decision = merchantGuardDecision({
    pathname,
    isLoading: session.isLoading,
    isError: session.isError,
    user: session.user,
  });
  const redirectTo = decision.kind === "redirect" ? decision.to : null;

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  switch (decision.kind) {
    case "loading":
      /*
       * Optimistic frame: the server render (and the first client render) has
       * no session yet. Rendering the page inside its frame — instead of a
       * splash — keeps every merchant segment in the static shell, so
       * navigations are instant and Cache Components can validate them. The
       * API still enforces auth; logged-out visitors are redirected as soon as
       * /auth/me answers.
       */
      return isOnboardingPath(pathname) ? (
        <OnboardingFrame>{children}</OnboardingFrame>
      ) : (
        <MerchantShell user={null}>{children}</MerchantShell>
      );
    case "redirect":
      return <AppSplash label="Mengalihkan…" />;
    case "error":
      return (
        <div className="app-backdrop flex min-h-dvh items-center justify-center px-4">
          <ErrorState error={session.error} onRetry={session.refetch} />
        </div>
      );
    case "onboarding":
      return <OnboardingFrame>{children}</OnboardingFrame>;
    case "shell":
      return <MerchantShell user={session.user}>{children}</MerchantShell>;
  }
}
