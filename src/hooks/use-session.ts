"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { AuthMeResponse, SessionUser } from "@/lib/contracts";

export const SESSION_QUERY_KEY = ["auth", "me"] as const;

export function fetchSession(): Promise<AuthMeResponse> {
  return api.get<AuthMeResponse>("/auth/me");
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
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post<{ ok: true }>("/auth/logout"),
    onSettled: async () => {
      qc.setQueryData<AuthMeResponse>(SESSION_QUERY_KEY, { user: null });
      // Everything user-scoped is stale after logout.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== SESSION_QUERY_KEY[0] });
    },
  });

  const user = query.data?.user ?? null;
  return {
    user,
    isLoading: query.isPending,
    isError: query.isError,
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
