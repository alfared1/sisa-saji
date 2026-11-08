"use client";

/**
 * Merchant live updates over SSE (/api/v1/stream/merchant):
 *  - order.paid       → toast "Pesanan baru dibayar: SS-…" + refresh dashboard/orders
 *  - order.completed  → refresh
 *  - batch.updated    → patch the batch in the dashboard cache, then refresh
 */
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEventSource, type EventSourceStatus } from "@/hooks/use-event-source";
import { api } from "@/lib/api/client";
import type { MerchantDashboard, MerchantStreamEvent } from "@/lib/contracts";
import { merchantKeys } from "./queries";

const REFRESH_DEBOUNCE_MS = 400;

export function useMerchantLive({ toastOnPaid = true }: { toastOnPaid?: boolean } = {}): { status: EventSourceStatus } {
  const qc = useQueryClient();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
      void qc.invalidateQueries({ queryKey: merchantKeys.ordersAll });
    }, REFRESH_DEBOUNCE_MS);
  }, [qc]);

  const onEvent = useCallback(
    (ev: MerchantStreamEvent) => {
      switch (ev.type) {
        case "order.paid":
          if (toastOnPaid) {
            toast.success(`Pesanan baru dibayar: ${ev.order_number}`, {
              id: `paid-${ev.order_id}`,
              description: "Siapkan pesanannya — pembeli segera datang mengambil.",
              duration: 8000,
              action: { label: "Lihat antrean", onClick: () => router.push("/merchant/orders") },
            });
          }
          break;
        case "batch.updated":
          qc.setQueryData<MerchantDashboard>(merchantKeys.dashboard, (old) =>
            old
              ? {
                  ...old,
                  active_batches: old.active_batches.map((b) =>
                    b.id === ev.batch_id
                      ? { ...b, available_stock: ev.available_stock, current_discount_pct: ev.discount_pct, status: ev.status }
                      : b,
                  ),
                }
              : old,
          );
          break;
        case "order.completed":
          break;
      }
      refresh();
    },
    [qc, refresh, router, toastOnPaid],
  );

  return useEventSource<MerchantStreamEvent>(api.url("/stream/merchant"), "merchant", onEvent);
}
