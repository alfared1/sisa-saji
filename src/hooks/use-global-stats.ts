"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { GlobalStats } from "@/lib/contracts";

export const GLOBAL_STATS_QUERY_KEY = ["stats", "global"] as const;

/** GET /stats/global, shared by /welcome, /tentang and the login screen. */
export function useGlobalStats(options: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: GLOBAL_STATS_QUERY_KEY,
    queryFn: () => api.get<GlobalStats>("/stats/global"),
    staleTime: 30_000,
    refetchInterval: options.refetchInterval,
  });
}
