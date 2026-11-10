"use client";

/**
 * "/" — role/visitor router:
 *  merchant session → /merchant/dashboard · returning visitor or logged-in
 *  customer → /discover · first-time guest → /tour (product walkthrough) ·
 *  guest who already finished or skipped the tour → /welcome
 *  offline with a saved pickup ticket → /offline (shows the ticket at once)
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppSplash } from "@/components/shell/app-splash";
import { useSession } from "@/hooks/use-session";
import { hasSeenTour, hasVisited } from "@/lib/pwa/visitor";
import { useTicketsStore } from "@/stores/tickets";

export default function RootRedirectPage() {
  const router = useRouter();
  const { user, isLoading, isError } = useSession();

  useEffect(() => {
    // At the warung without signal: go straight to the saved ticket.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline && Object.keys(useTicketsStore.getState().tickets).length > 0) {
      router.replace("/offline");
      return;
    }
    if (isLoading) return;
    if (!isError && user && (user.role === "MERCHANT" || user.merchant_id)) {
      router.replace("/merchant/dashboard");
    } else if (user || hasVisited()) {
      router.replace("/discover");
    } else {
      router.replace(hasSeenTour() ? "/welcome" : "/tour");
    }
  }, [isLoading, isError, user, router]);

  return <AppSplash label="Menyiapkan Sisa-Saji…" />;
}
