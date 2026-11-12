"use client";

/**
 * TanStack Query keys + shared hooks for the merchant app.
 * MERCHANT_ME_QUERY_KEY (shell badge) is owned by the shell; we reuse it.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MERCHANT_ME_QUERY_KEY } from "@/components/shell/merchant-shell";
import { errorMessage } from "@/components/common/error-state";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import type {
  MerchantDashboard,
  MerchantMeResponse,
  MerchantProfile,
  MerchantUpdateBody,
} from "@/lib/contracts";

export { MERCHANT_ME_QUERY_KEY };

export const merchantKeys = {
  all: ["merchant"] as const,
  me: MERCHANT_ME_QUERY_KEY,
  dashboard: ["merchant", "dashboard"] as const,
  orders: (tab: string, date?: string) => ["merchant", "orders", tab, date ?? ""] as const,
  ordersAll: ["merchant", "orders"] as const,
  analytics: (range: number) => ["merchant", "analytics", range] as const,
  insights: ["merchant", "insights"] as const,
  leftoversAll: ["merchant", "leftovers"] as const,
  leftovers: (date?: string) => ["merchant", "leftovers", date ?? ""] as const,
};

/**
 * True once /auth/me confirms the user owns a warung. MerchantGuard renders
 * the page optimistically while the session loads; merchant queries wait for
 * this so a logged-out visitor or a customer without a warung never fires
 * merchant API calls (401/403 console noise) before the guard redirects.
 */
export function useMerchantReady(): boolean {
  const { user } = useSession();
  return Boolean(user?.merchant_id);
}

export function useMerchantMe() {
  const ready = useMerchantReady();
  return useQuery({
    queryKey: MERCHANT_ME_QUERY_KEY,
    queryFn: () => api.get<MerchantMeResponse>("/merchant/me"),
    enabled: ready,
    staleTime: 30_000,
  });
}

export function useMerchantDashboard() {
  const ready = useMerchantReady();
  return useQuery({
    enabled: ready,
    queryKey: merchantKeys.dashboard,
    queryFn: () => api.get<MerchantDashboard>("/merchant/dashboard"),
    staleTime: 10_000,
    // SSE pushes changes; this is only a safety net (e.g. escalation steps).
    refetchInterval: 60_000,
  });
}

/** Writes a fresh MerchantProfile into every cache that shows it. */
export function primeMerchantProfile(qc: QueryClient, merchant: MerchantProfile) {
  qc.setQueryData<MerchantMeResponse>(MERCHANT_ME_QUERY_KEY, (old) => (old ? { ...old, merchant } : old));
  qc.setQueryData<MerchantDashboard>(merchantKeys.dashboard, (old) => (old ? { ...old, merchant } : old));
}

/** PATCH /merchant/me — optimistic for is_open; keeps the shell badge in sync. */
export function useUpdateMerchant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MerchantUpdateBody) => api.patch<MerchantMeResponse>("/merchant/me", body),
    onMutate: async (body) => {
      if (body.is_open === undefined) return {};
      await Promise.all([
        qc.cancelQueries({ queryKey: MERCHANT_ME_QUERY_KEY }),
        qc.cancelQueries({ queryKey: merchantKeys.dashboard }),
      ]);
      const prevMe = qc.getQueryData<MerchantMeResponse>(MERCHANT_ME_QUERY_KEY);
      const prevDash = qc.getQueryData<MerchantDashboard>(merchantKeys.dashboard);
      const isOpen = body.is_open;
      qc.setQueryData<MerchantMeResponse>(MERCHANT_ME_QUERY_KEY, (old) =>
        old ? { ...old, merchant: { ...old.merchant, is_open: isOpen } } : old,
      );
      qc.setQueryData<MerchantDashboard>(merchantKeys.dashboard, (old) =>
        old ? { ...old, merchant: { ...old.merchant, is_open: isOpen } } : old,
      );
      return { prevMe, prevDash };
    },
    onError: (err, _body, ctx) => {
      if (ctx?.prevMe) qc.setQueryData(MERCHANT_ME_QUERY_KEY, ctx.prevMe);
      if (ctx?.prevDash) qc.setQueryData(merchantKeys.dashboard, ctx.prevDash);
      toast.error(errorMessage(err, "Gagal menyimpan perubahan warung."));
    },
    onSuccess: (data) => {
      qc.setQueryData<MerchantMeResponse>(MERCHANT_ME_QUERY_KEY, data);
      primeMerchantProfile(qc, data.merchant);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MERCHANT_ME_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
    },
  });
}
