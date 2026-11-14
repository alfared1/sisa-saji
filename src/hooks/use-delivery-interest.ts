"use client";

/**
 * "Titip Antar Kolektif" waiting list (GET/POST/DELETE /api/v1/delivery-interest).
 * Collective delivery does not exist yet: this only shows how many buyers want it and lets a
 * logged-in, non-demo buyer register their kos or asrama. Nothing here touches checkout.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { DeliveryInterestBody, DeliveryInterestResponse } from "@/lib/contracts";

export const DELIVERY_INTEREST_KEY = ["delivery-interest"] as const;

/** `userId` keys the cache per account, since `mine` belongs to the session. */
export function useDeliveryInterest(opts: { userId?: string | null; enabled?: boolean } = {}) {
  const qc = useQueryClient();
  const key = [...DELIVERY_INTEREST_KEY, opts.userId ?? "guest"] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<DeliveryInterestResponse>("/delivery-interest"),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
  const onData = (data: DeliveryInterestResponse) => qc.setQueryData(key, data);

  const register = useMutation({
    mutationFn: (body: DeliveryInterestBody) => api.post<DeliveryInterestResponse>("/delivery-interest", body),
    onSuccess: onData,
  });
  const cancel = useMutation({
    mutationFn: () => api.del<DeliveryInterestResponse>("/delivery-interest"),
    onSuccess: onData,
  });

  return { query, data: query.data ?? null, register, cancel };
}
