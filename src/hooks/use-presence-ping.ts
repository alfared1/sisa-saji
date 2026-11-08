"use client";

/**
 * Presence ping: PUT /profile/location-push every 2 minutes while the page is
 * visible (and immediately when the location changes or the tab comes back),
 * attaching the existing push subscription when notifications are granted.
 * The server uses it to count active students in a warung's radius.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { LocationPushBody, LocationPushResponse } from "@/lib/contracts";
import { getClientId } from "@/lib/pwa/client-id";
import { getExistingPushSubscription, toSubscriptionInput } from "@/lib/pwa/push";
import { useStoresHydrated } from "@/stores/hydration";
import { useLocationStore } from "@/stores/location";

export const PRESENCE_PING_INTERVAL_MS = 2 * 60_000;
/** Don't re-ping for focus/visibility changes more often than this. */
const MIN_GAP_MS = 30_000;

export function usePresencePing({ enabled = true }: { enabled?: boolean } = {}) {
  const hydrated = useStoresHydrated();
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const [activeUsers, setActiveUsers] = useState<number | null>(null);
  const lastPing = useRef(0);
  const coords = useRef({ lat, lng });

  useEffect(() => {
    coords.current = { lat, lng };
  }, [lat, lng]);

  useEffect(() => {
    if (!enabled || !hydrated) return;
    let cancelled = false;

    const ping = async (force: boolean) => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastPing.current < MIN_GAP_MS) return;
      lastPing.current = now;
      try {
        const sub = await getExistingPushSubscription();
        const body: LocationPushBody = {
          client_id: getClientId(),
          lat: coords.current.lat,
          lng: coords.current.lng,
          ...(sub ? { webpush_subscription: toSubscriptionInput(sub) ?? undefined } : {}),
        };
        const res = await api.put<LocationPushResponse>("/profile/location-push", body);
        if (!cancelled) setActiveUsers(res.active_users_in_radius);
      } catch {
        /* presence is best-effort */
      }
    };

    void ping(true);
    const timer = setInterval(() => void ping(true), PRESENCE_PING_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void ping(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Re-run (and ping immediately) when the location changes.
  }, [enabled, hydrated, lat, lng]);

  return { activeUsers };
}
