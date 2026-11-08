"use client";

/**
 * Keeps the offline tickets bound to the signed-in user: once /auth/me answers
 * (and the persisted store has hydrated), tickets of another user — or of a
 * session that is gone — are wiped. A network error keeps them (offline at the
 * warung is exactly when the ticket is needed).
 */
import { useEffect } from "react";
import { useStoresHydrated } from "@/stores/hydration";
import { useTicketsStore } from "@/stores/tickets";
import { useSession } from "./use-session";

export function useTicketOwnerSync(): void {
  const { user, isLoading, isError } = useSession();
  const hydrated = useStoresHydrated();
  const reconcileOwner = useTicketsStore((s) => s.reconcileOwner);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!hydrated || isLoading || isError) return;
    reconcileOwner(userId);
  }, [hydrated, isLoading, isError, userId, reconcileOwner]);
}
