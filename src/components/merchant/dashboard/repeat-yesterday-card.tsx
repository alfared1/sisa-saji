"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { errorMessage } from "@/components/common/error-state";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import type { RepeatPreviewResponse, RepeatPublishResponse } from "@/lib/contracts";
import { formatClockId } from "@/lib/time";
import { merchantKeys, useMerchantReady } from "../lib/queries";

/**
 * "Pasang lagi menu kemarin": one tap puts yesterday's menus up again (same portions, same
 * closing time, suggested price). Hidden when there is nothing to repeat.
 */
export function RepeatYesterdayCard() {
  const qc = useQueryClient();
  const ready = useMerchantReady();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({
    queryKey: merchantKeys.repeat,
    queryFn: () => api.get<RepeatPreviewResponse>("/merchant/surplus/repeat"),
    enabled: ready,
    staleTime: 60_000,
  });
  const go = useMutation({
    mutationFn: () => api.post<RepeatPublishResponse>("/merchant/surplus/repeat"),
    onSuccess: (res) => {
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
      void qc.invalidateQueries({ queryKey: merchantKeys.repeat });
      toast.success(`${res.published} menu tayang lagi`, {
        description: res.skipped.length ? `Dilewati: ${res.skipped.map((s) => `${s.menu_name} (${s.reason})`).join("; ")}` : undefined,
      });
    },
    onError: (err) => {
      setConfirm(false);
      toast.error(errorMessage(err, "Gagal memasang menu."));
    },
  });

  const list = q.data?.candidates ?? [];
  if (list.length === 0) return null;
  const portions = list.reduce((s, c) => s + c.initial_stock, 0);

  return (
    <section aria-label="Pasang lagi menu kemarin" className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Pasang lagi menu kemarin?</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {list.map((c) => c.menu_name).join(", ")} · {portions} porsi
          </p>
        </div>
        <Button className="h-11 rounded-xl px-5 font-semibold" onClick={() => setConfirm(true)}>
          Pasang lagi
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(o) => !go.isPending && setConfirm(o)}
        title={`Pasang lagi ${list.length} menu?`}
        description={
          <span className="block space-y-1">
            {list.map((c) => (
              <span key={c.menu_id} className="block">
                {c.menu_name}: {c.initial_stock} porsi, sampai jam {formatClockId(c.pickup_end_time)}
              </span>
            ))}
            <span className="block pt-1">Harganya pakai saran harga, dan diskon naik otomatis menjelang tutup.</span>
          </span>
        }
        confirmLabel="Ya, pasang"
        cancelLabel="Nanti"
        loading={go.isPending}
        onConfirm={() => go.mutate()}
      />
    </section>
  );
}
