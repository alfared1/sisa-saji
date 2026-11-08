"use client";

/**
 * Live surplus updates: subscribes to GET /stream/batches for an area and
 * patches every cached discovery / warung query + the cart in place.
 * A rising discount shows a "Harga turun!" toast and flashes the card.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useEventSource } from "@/hooks/use-event-source";
import { api } from "@/lib/api/client";
import type { BatchStreamEvent, MerchantDetail, NearbyResponse } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { useCartStore } from "@/stores/cart";
import { cartPatchFromBatch, customerKeys } from "../lib/queries";
import { patchMerchantDetail, patchNearby, type PriceDrop } from "../lib/sse-patch";

/* ---------------- price-drop flash store (module level) ---------------- */

const FLASH_MS = 8000;
const drops = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

function markDrop(batchId: string) {
  drops.set(batchId, Date.now());
  version++;
  listeners.forEach((l) => l());
  setTimeout(() => {
    drops.delete(batchId);
    version++;
    listeners.forEach((l) => l());
  }, FLASH_MS);
}

function subscribeDrops(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** True for a few seconds after this batch's price dropped live. */
export function usePriceDropFlash(batchId: string): boolean {
  useSyncExternalStore(
    subscribeDrops,
    () => version,
    () => 0,
  );
  return drops.has(batchId);
}

/* ------------------------------ the hook ------------------------------ */

export function useBatchStream({
  lat,
  lng,
  radiusM,
  enabled = true,
}: {
  lat: number;
  lng: number;
  radiusM: number;
  enabled?: boolean;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = enabled
    ? api.url("/stream/batches", {
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        radius_m: Math.min(10_000, Math.max(100, Math.round(radiusM))),
      })
    : null;

  const onEvent = useCallback(
    (ev: BatchStreamEvent) => {
      let found = false;
      let drop: PriceDrop | null = null;

      qc.setQueriesData<NearbyResponse>({ queryKey: customerKeys.nearbyAll }, (old) => {
        if (!old) return old;
        const r = patchNearby(old, ev);
        if (r.found) found = true;
        if (r.priceDrop) drop = r.priceDrop;
        return r.data;
      });
      qc.setQueriesData<MerchantDetail>({ queryKey: customerKeys.warungAll }, (old) => {
        if (!old || typeof old !== "object" || !("batches" in old)) return old;
        const r = patchMerchantDetail(old, ev);
        if (r.found) found = true;
        if (r.priceDrop) drop = r.priceDrop;
        return r.data;
      });
      // Pins aggregate stock/discount per warung: cheap to refetch in the background.
      void qc.invalidateQueries({ queryKey: customerKeys.pinsAll, refetchType: "active" });

      // Keep the cart's price / stock cap in sync.
      const cart = useCartStore.getState();
      if (cart.items.some((i) => i.batch_id === ev.batch_id) && ev.status === "ACTIVE") {
        cart.updateItem(
          ev.batch_id,
          cartPatchFromBatch({
            selling_price_idr: ev.selling_price_idr,
            discount_pct: ev.discount_pct,
            available_stock: ev.available_stock,
          }),
        );
      }

      // A batch we have never seen (just published): refetch the feed once things settle.
      if (!found && ev.status === "ACTIVE") {
        if (refetchTimer.current) clearTimeout(refetchTimer.current);
        refetchTimer.current = setTimeout(() => {
          void qc.invalidateQueries({ queryKey: customerKeys.nearbyAll });
          void qc.invalidateQueries({ queryKey: customerKeys.warungAll });
        }, 1500);
      }

      const d = drop as PriceDrop | null;
      if (d) {
        markDrop(d.batch_id);
        toast(`Harga turun! ${d.menu_name}`, {
          id: `drop-${d.batch_id}`,
          description: `${d.merchant_name}: ${formatIdr(d.old_price_idr)} → ${formatIdr(d.new_price_idr)} (-${d.new_discount_pct}%)`,
          action: { label: "Lihat", onClick: () => router.push(`/warung/${d.merchant_slug}`) },
          duration: 6000,
        });
      }
    },
    [qc, router],
  );

  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

  return useEventSource<BatchStreamEvent>(url, "batch", onEvent);
}
