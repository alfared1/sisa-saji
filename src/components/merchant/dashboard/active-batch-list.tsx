"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  GiftIcon,
  MegaphoneIcon,
  MinusIcon,
  PackageOpenIcon,
  PlusIcon,
  TrendingUpIcon,
  XCircleIcon,
  ZapIcon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { EmptyState } from "@/components/common/empty-state";
import { errorMessage } from "@/components/common/error-state";
import { PriceTag } from "@/components/common/price-tag";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import type { BatchResponse, MerchantBatchView, MerchantDashboard } from "@/lib/contracts";
import { formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";
import { applyStockDelta, escalationLabel, percent, stockSegments, STOCK_MAX } from "../lib/logic";
import { merchantKeys } from "../lib/queries";

const STOCK_MUTATION_KEY = ["merchant", "batch-stock"] as const;

function patchBatchInCache(old: MerchantDashboard | undefined, id: string, fn: (b: MerchantBatchView) => MerchantBatchView) {
  if (!old) return old;
  return { ...old, active_batches: old.active_batches.map((b) => (b.id === id ? fn(b) : b)) };
}

function useBatchMutations() {
  const qc = useQueryClient();

  const stock = useMutation({
    mutationKey: STOCK_MUTATION_KEY,
    mutationFn: ({ id, delta }: { id: string; delta: number }) =>
      api.patch<BatchResponse>(`/merchant/surplus/${id}/stock`, { delta }),
    onMutate: async ({ id, delta }) => {
      await qc.cancelQueries({ queryKey: merchantKeys.dashboard });
      qc.setQueryData<MerchantDashboard>(merchantKeys.dashboard, (old) => patchBatchInCache(old, id, (b) => applyStockDelta(b, delta)));
    },
    onError: (err) => {
      toast.error(errorMessage(err, "Gagal mengubah stok."), { id: "stock-error" });
    },
    onSettled: () => {
      // Only resync after the last tap in a burst, so the optimistic count doesn't flicker.
      if (qc.isMutating({ mutationKey: STOCK_MUTATION_KEY }) <= 1) {
        void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
      }
    },
  });

  const toggleAuto = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<BatchResponse>(`/merchant/surplus/${id}`, { auto_discount_enabled: enabled }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: merchantKeys.dashboard });
      qc.setQueryData<MerchantDashboard>(merchantKeys.dashboard, (old) =>
        patchBatchInCache(old, id, (b) => ({ ...b, auto_discount_enabled: enabled, next_escalation: enabled ? b.next_escalation : null })),
      );
    },
    onSuccess: (res) => {
      qc.setQueryData<MerchantDashboard>(merchantKeys.dashboard, (old) => patchBatchInCache(old, res.batch.id, () => res.batch));
      toast.success(res.batch.auto_discount_enabled ? "Auto-diskon diaktifkan" : "Auto-diskon dimatikan", { id: `auto-${res.batch.id}` });
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal mengubah auto-diskon.")),
    onSettled: () => void qc.invalidateQueries({ queryKey: merchantKeys.dashboard }),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.patch<BatchResponse>(`/merchant/surplus/${id}`, { status: "CANCELLED" }),
    onSuccess: (res) => {
      qc.setQueryData<MerchantDashboard>(merchantKeys.dashboard, (old) =>
        old ? { ...old, active_batches: old.active_batches.filter((b) => b.id !== res.batch.id) } : old,
      );
      toast.success(`Surplus ${res.batch.menu_name} dibatalkan`, { description: "Pesanan yang sudah dibayar tetap bisa diambil." });
    },
    onError: (err) => toast.error(errorMessage(err, "Gagal membatalkan surplus.")),
    onSettled: () => void qc.invalidateQueries({ queryKey: merchantKeys.dashboard }),
  });

  return { stock, toggleAuto, cancel };
}

function StatusPill({ status, startIso }: { status: MerchantBatchView["status"]; startIso: string }) {
  const map: Record<MerchantBatchView["status"], { label: string; cls: string }> = {
    ACTIVE: { label: "Tayang", cls: "bg-success-soft text-primary" },
    SOLD_OUT: { label: "Habis terjual", cls: "bg-deal-soft text-deal" },
    SCHEDULED: { label: `Mulai ${formatClockId(startIso)}`, cls: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" },
    EXPIRED: { label: "Berakhir", cls: "bg-muted text-muted-foreground" },
    CANCELLED: { label: "Dibatalkan", cls: "bg-muted text-muted-foreground" },
  };
  const s = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] leading-none font-bold", s.cls)}>
      {status === "ACTIVE" && <span className="size-1.5 animate-soft-pulse rounded-full bg-primary" aria-hidden />}
      {s.label}
    </span>
  );
}

export function StockBar({ batch }: { batch: MerchantBatchView }) {
  const seg = stockSegments(batch);
  return (
    <div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${batch.sold} terjual, ${batch.reserved_stock} dalam pembayaran, ${batch.available_stock} tersisa dari ${seg.total} porsi`}
      >
        <span className="h-full bg-primary transition-[width] duration-300" style={{ width: `${seg.sold}%` }} />
        <span className="h-full bg-warning transition-[width] duration-300" style={{ width: `${seg.reserved}%` }} />
        <span className="h-full bg-primary/25 transition-[width] duration-300" style={{ width: `${seg.available}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-primary" aria-hidden /> <b className="text-foreground tabular-nums">{batch.sold}</b> terjual
        </span>
        {batch.reserved_stock > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-warning" aria-hidden /> <b className="text-foreground tabular-nums">{batch.reserved_stock}</b> dibayar…
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-primary/25" aria-hidden /> <b className="text-foreground tabular-nums">{batch.available_stock}</b> tersisa
        </span>
      </div>
    </div>
  );
}

function BatchCard({ batch, m }: { batch: MerchantBatchView; m: ReturnType<typeof useBatchMutations> }) {
  const [confirm, setConfirm] = useState(false);
  const closed = batch.status === "EXPIRED" || batch.status === "CANCELLED";
  const esc = batch.auto_discount_enabled ? escalationLabel(batch.next_escalation) : null;

  return (
    <li className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border sm:p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-2xl",
            batch.is_mystery_bag ? "bg-deal-soft text-deal" : "bg-brand-soft text-primary",
          )}
          aria-hidden
        >
          {batch.is_mystery_bag ? <GiftIcon className="size-5" /> : <PackageOpenIcon className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={batch.status} startIso={batch.pickup_start_time} />
            {!closed && <CountdownBadge endIso={batch.pickup_end_time} />}
          </div>
          <h3 className="mt-1.5 text-base leading-snug font-bold">{batch.menu_name}</h3>
          <PriceTag
            className="mt-1"
            original={batch.original_price_idr}
            selling={batch.current_selling_price_idr}
            discountPct={batch.current_discount_pct}
            endIso={closed ? null : batch.pickup_end_time}
          />
        </div>
      </div>

      <div className="mt-4">
        <StockBar batch={batch} />
      </div>

      {esc ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-deal-soft/70 px-3 py-2 text-xs font-semibold text-deal">
          <TrendingUpIcon className="size-4 shrink-0" aria-hidden />
          <span>
            {esc}
            {batch.next_escalation && (
              <span className="font-medium text-foreground/70"> · jadi Rp {batch.next_escalation.selling_price_idr.toLocaleString("id-ID")}</span>
            )}
          </span>
        </p>
      ) : batch.predicted_sellout_prob !== null && !closed ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
          <ZapIcon className="size-4 shrink-0 text-primary" aria-hidden />
          Peluang habis terjual {percent(batch.predicted_sellout_prob)}
        </p>
      ) : null}

      {!closed && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2" role="group" aria-label={`Stok ${batch.menu_name}`}>
            <button
              type="button"
              aria-label={`Kurangi stok ${batch.menu_name}`}
              disabled={batch.available_stock <= 0}
              onClick={() => m.stock.mutate({ id: batch.id, delta: -1 })}
              className="inline-flex size-11 items-center justify-center rounded-2xl bg-card ring-1 ring-border transition-transform outline-none hover:bg-muted active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
            >
              <MinusIcon className="size-5" />
            </button>
            <div className="min-w-14 text-center" aria-live="polite">
              <span className="block text-xl leading-none font-extrabold tabular-nums">{batch.available_stock}</span>
              <span className="text-[10px] font-semibold text-muted-foreground">porsi</span>
            </div>
            <button
              type="button"
              aria-label={`Tambah stok ${batch.menu_name}`}
              disabled={batch.available_stock >= STOCK_MAX}
              onClick={() => m.stock.mutate({ id: batch.id, delta: 1 })}
              className="inline-flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground transition-transform outline-none hover:bg-primary/90 active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
            >
              <PlusIcon className="size-5" />
            </button>
          </div>

          {/* -ml-2 cancels the label's hit-area padding, so on phones (wrapped row) the switch lines up with the stepper. */}
          <div className="-ml-2 flex items-center gap-1">
            <label className="flex h-11 cursor-pointer items-center gap-2 rounded-2xl px-2 text-xs font-semibold">
              <Switch
                checked={batch.auto_discount_enabled}
                onCheckedChange={(v) => m.toggleAuto.mutate({ id: batch.id, enabled: v })}
                aria-label="Auto-diskon"
              />
              Auto-diskon
            </label>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="inline-flex h-11 items-center gap-1.5 rounded-2xl px-3 text-xs font-semibold text-urgent outline-none hover:bg-urgent-soft focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XCircleIcon className="size-4" /> Batalkan
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        destructive
        icon={<XCircleIcon className="size-7" />}
        title={`Batalkan surplus ${batch.menu_name}?`}
        description={
          <>
            Listing langsung hilang dari aplikasi pembeli. {batch.sold > 0 ? `${batch.sold} porsi yang sudah dibayar tetap harus diserahkan.` : ""}
          </>
        }
        confirmLabel="Ya, batalkan"
        cancelLabel="Tidak"
        loading={m.cancel.isPending}
        onConfirm={() => m.cancel.mutate(batch.id, { onSettled: () => setConfirm(false) })}
      />
    </li>
  );
}

/** Blueprint ActiveSurplusBatchList. */
export function ActiveSurplusBatchList({ batches }: { batches: MerchantBatchView[] }) {
  const m = useBatchMutations();
  const sorted = [...batches].sort((a, b) => {
    const rank = (s: MerchantBatchView["status"]) => (s === "ACTIVE" ? 0 : s === "SCHEDULED" ? 1 : s === "SOLD_OUT" ? 2 : 3);
    return rank(a.status) - rank(b.status) || Date.parse(a.pickup_end_time) - Date.parse(b.pickup_end_time);
  });

  return (
    <section aria-labelledby="batches-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="batches-heading" className="text-lg font-extrabold tracking-tight">
          Surplus aktif <span className="text-muted-foreground tabular-nums">({batches.length})</span>
        </h2>
        <Link
          href="/merchant/surplus/new"
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-foreground px-4 text-xs font-bold text-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PlusIcon className="size-4" /> Tambah
        </Link>
      </div>
      {sorted.length === 0 ? (
        <div className="rounded-3xl bg-card ring-1 ring-border">
          <EmptyState
            icon={MegaphoneIcon}
            title="Belum ada surplus yang tayang"
            description="Ada porsi tersisa malam ini? Publikasikan dalam 60 detik, harga diskonnya dihitung otomatis."
          />
        </div>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {sorted.map((b) => (
            <BatchCard key={b.id} batch={b} m={m} />
          ))}
        </ul>
      )}
    </section>
  );
}
