import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/client";

/** 4xx responses (validation, auth, not found, conflicts) are never retried. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
