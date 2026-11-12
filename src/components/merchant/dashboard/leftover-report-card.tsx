"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, RecycleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError, api } from "@/lib/api/client";
import {
  LEFTOVER_DESTINATIONS,
  MAX_NIGHTLY_PORTIONS,
  type LeftoverCounts,
  type LeftoverDestination,
  type LeftoverReportView,
} from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { merchantKeys, useMerchantReady } from "../lib/queries";
import { SectionCard, Stepper } from "../ui";

export const LEFTOVER_LABELS: Record<LeftoverDestination, { label: string; hint: string }> = {
  donated: { label: "Dibagikan", hint: "Ke karyawan, tetangga, masjid, atau panti" },
  animal_feed: { label: "Pakan ternak atau maggot", hint: "Untuk ayam, ikan, atau budidaya maggot" },
  compost: { label: "Dikompos", hint: "Diolah jadi pupuk" },
  discarded: { label: "Dibuang", hint: "Masuk tempat sampah" },
};

const EMPTY: LeftoverCounts = { donated: 0, animal_feed: 0, compost: 0, discarded: 0 };

function nightLabel(date: string, dates: string[]): string {
  return date === dates[dates.length - 1] ? "Malam ini" : "Tadi malam";
}

function LeftoverForm({ view, onDate }: { view: LeftoverReportView; onDate: (d: string) => void }) {
  const qc = useQueryClient();
  const [counts, setCounts] = useState<LeftoverCounts>(() => (view.report ? { ...view.report } : EMPTY));
  const total = LEFTOVER_DESTINATIONS.reduce((n, k) => n + counts[k], 0);
  const kept = total - counts.discarded;

  const save = useMutation({
    mutationFn: () => api.put<LeftoverReportView>("/merchant/leftovers", { report_date: view.report_date, ...counts }),
    onSuccess: (res) => {
      qc.setQueryData(merchantKeys.leftovers(res.report_date), res);
      void qc.invalidateQueries({ queryKey: merchantKeys.leftoversAll });
      toast.success("Laporan sisa tersimpan", {
        description: res.is_pilot ? "Masuk ke hasil uji coba." : undefined,
      });
    },
    onError: (err) => toast.error(err instanceof ApiClientError ? err.message : "Gagal menyimpan. Coba lagi."),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Malam yang dilaporkan">
        {view.editable_dates.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={d === view.report_date}
            onClick={() => onDate(d)}
            className={cn(
              "inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              d === view.report_date ? "bg-primary text-primary-foreground ring-primary" : "bg-card ring-border hover:bg-muted",
            )}
          >
            {nightLabel(d, view.editable_dates)}
          </button>
        ))}
      </div>
      {view.unsold_in_app > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Di aplikasi, <b className="text-foreground tabular-nums">{view.unsold_in_app}</b> porsi tidak terjual{" "}
          {nightLabel(view.report_date, view.editable_dates).toLowerCase()}.
        </p>
      )}

      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LEFTOVER_DESTINATIONS.map((k) => (
          <li key={k} className="rounded-2xl bg-muted/50 p-3">
            <p className="text-sm font-semibold">{LEFTOVER_LABELS[k].label}</p>
            <p className="mb-2 text-xs text-muted-foreground">{LEFTOVER_LABELS[k].hint}</p>
            <Stepper
              size="md"
              min={0}
              max={MAX_NIGHTLY_PORTIONS}
              label={`Porsi ${LEFTOVER_LABELS[k].label.toLowerCase()}`}
              unit="porsi"
              value={counts[k]}
              onChange={(v) => setCounts((c) => ({ ...c, [k]: v }))}
            />
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm" aria-live="polite">
        {total === 0 ? (
          "Tidak ada sisa? Simpan dengan angka 0."
        ) : (
          <>
            Total <b className="tabular-nums">{total}</b> porsi, <b className="tabular-nums">{kept}</b> di antaranya tidak terbuang.
          </>
        )}
      </p>
      {view.is_pilot && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {view.baseline_leftover_portions !== null &&
            `Sebelum uji coba, sekitar ${view.baseline_leftover_portions} porsi dibuang per malam. Hasil uji coba membandingkannya dengan angka "Dibuang" di sini. `}
          Laporan ini kamu isi sendiri dan tampil di halaman hasil uji coba sebagai laporan warung.
        </p>
      )}

      <Button type="submit" className="mt-4 h-11 w-full rounded-xl font-semibold sm:w-auto sm:px-5" disabled={save.isPending}>
        {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
        {view.report ? "Perbarui laporan" : "Simpan laporan"}
      </Button>
    </form>
  );
}

/**
 * After closing, where did the portions that still did not sell go? One short report per
 * night. For pilot warung this is what the waste reduction in /uji-coba is measured from.
 */
export function LeftoverReportCard({ className }: { className?: string }) {
  const ready = useMerchantReady();
  const [date, setDate] = useState<string | undefined>(undefined);
  const q = useQuery({
    enabled: ready,
    queryKey: merchantKeys.leftovers(date),
    queryFn: () => api.get<LeftoverReportView>("/merchant/leftovers", date ? { date } : undefined),
    staleTime: 30_000,
  });

  return (
    <SectionCard
      className={className}
      title="Sisa setelah tutup"
      icon={RecycleIcon}
      description="Porsi yang tetap tidak laku ke mana? Catat sekali setiap malam."
    >
      {q.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : q.isError ? (
        <p className="text-sm text-muted-foreground">
          Laporan sisa belum bisa dimuat.{" "}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void q.refetch()}>
            Coba lagi
          </button>
        </p>
      ) : (
        <LeftoverForm key={`${q.data.report_date}:${q.data.report?.updated_at ?? "new"}`} view={q.data} onDate={setDate} />
      )}
    </SectionCard>
  );
}
