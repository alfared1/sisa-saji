"use client";

/**
 * Side effects for the customer app: presence ping (+ push subscription when
 * already granted), "returning visitor" flag for "/", and pruning stale
 * offline tickets.
 */
import { useEffect } from "react";
import { usePresencePing } from "@/hooks/use-presence-ping";
import { useTicketOwnerSync } from "@/hooks/use-ticket-owner-sync";
import { markVisited } from "@/lib/pwa/visitor";
import { useStoresHydrated } from "@/stores/hydration";
import { useTicketsStore } from "@/stores/tickets";

export function CustomerEffects() {
  usePresencePing();
  useTicketOwnerSync();
  const hydrated = useStoresHydrated();
  const pruneExpired = useTicketsStore((s) => s.pruneExpired);

  useEffect(() => {
    markVisited();
  }, []);

  useEffect(() => {
    if (hydrated) pruneExpired(Date.now());
  }, [hydrated, pruneExpired]);

  return null;
}
