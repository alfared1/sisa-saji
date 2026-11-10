"use client";

import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, api } from "@/lib/api/client";
import { shouldRetry } from "@/components/providers/query-client";
import { clearPrivateCaches } from "@/lib/pwa/sw";
import { useTicketsStore } from "@/stores/tickets";
import type { AuthMeResponse, SessionUser } from "@/lib/contracts";

export const SESSION_QUERY_KEY = ["auth", "me"] as const;

const noopSubscribe = () => () => {};
const isClientSnapshot = () => true;
const isServerSnapshot = () => false;

export function fetchSession(): Promise<AuthMeResponse> {
  return api.get<AuthMeResponse>("/auth/me");
}

/** Offline: fail at once (no backoff retries) so "/" can route to the saved ticket. */
export function retrySession(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && error.code === "NETWORK_ERROR") return false;
  return shouldRetry(failureCount, error);
}

/**
 * Removes everything the previous user left on this device: offline pickup
 * tickets (zustand + localStorage) and the service worker's ticket/page caches.
 */
export async function clearUserDeviceData(): Promise<void> {
  useTicketsStore.getState().clear();
  await clearPrivateCaches();
}

/** This device's Web Push endpoint, or null (no SW, no subscription, or unsupported). */
async function currentPushEndpoint(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

export type SessionState = {
  user: SessionUser | null;
  /** True until the first /auth/me response (or error). */
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isLoggedIn: boolean;
  isMerchant: boolean;
  hasWarung: boolean;
  refetch: () => void;
  logout: () => Promise<void>;
  isLoggingOut: boolean;
};

export function useSession(): SessionState {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    staleTime: 60_000,
    retry: retrySession,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Tell the server which push subscription this device holds, so it stops
      // sending the logged-out user's notifications here.
      const pushEndpoint = await currentPushEndpoint();
      return api.post<{ ok: true }>("/auth/logout", pushEndpoint ? { push_endpoint: pushEndpoint } : {});
    },
    onSettled: async () => {
      // Every logout path (customer profile, merchant sidebar, merchant settings).
      await clearUserDeviceData();
      qc.setQueryData<AuthMeResponse>(SESSION_QUERY_KEY, { user: null });
      // Everything user-scoped is stale after logout.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== SESSION_QUERY_KEY[0] });
    },
  });

  // The shell (nav, badges) starts /auth/me before a page segment hydrates, so the
  // answer can already be cached when that segment's first client render runs.
  // Until hydration is over, report what the server rendered (loading, no user),
  // otherwise React throws a hydration mismatch and re-renders the page.
  const hydrated = useSyncExternalStore(noopSubscribe, isClientSnapshot, isServerSnapshot);
  const user = hydrated ? (query.data?.user ?? null) : null;
  return {
    user,
    isLoading: !hydrated || query.isPending,
    isError: hydrated && query.isError,
    error: query.error,
    isLoggedIn: user !== null,
    isMerchant: user?.role === "MERCHANT" || Boolean(user?.merchant_id),
    hasWarung: Boolean(user?.merchant_id),
    refetch: () => void query.refetch(),
    logout: async () => {
      await logoutMutation.mutateAsync().catch(() => undefined);
    },
    isLoggingOut: logoutMutation.isPending,
  };
}

/** Use after OTP verify / profile change to make every screen see the new user. */
export function useSetSessionUser() {
  const qc = useQueryClient();
  return (user: SessionUser | null) => {
    qc.setQueryData<AuthMeResponse>(SESSION_QUERY_KEY, { user });
    void qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  };
}
