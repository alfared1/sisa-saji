"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, CloudIcon, LeafIcon, SparklesIcon, WalletIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import type { GlobalStats, ImpactSummary } from "@/lib/contracts";
import { formatKg } from "@/lib/impact";
import { formatIdr } from "@/lib/time";

/** "Rp 616,5 rb" — fits the narrow stat tile; the full amount is in the title. */
export function formatIdrCompact(amount: number): string {
  if (Math.abs(amount) < 100_000) return formatIdr(amount);
  return `Rp ${new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(amount)}`;
}
import { badgeLabel, firstName, formatDecimal } from "./lib/format";
import { customerKeys } from "./lib/queries";

export function useImpactSummary(enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.impact,
    queryFn: () => api.get<ImpactSummary>("/profile/impact"),
    enabled,
    staleTime: 60_000,
  });
}

export function useGlobalStats(enabled = true) {
  return useQuery({
    queryKey: customerKeys.globalStats,
    queryFn: () => api.get<GlobalStats>("/stats/global"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Personal ImpactCard (logged in) — "Kamu telah menyelamatkan …". */
export function ImpactCard({ name }: { name: string }) {
  const q = useImpactSummary(true);
  if (q.isPending) return <Skeleton className="h-[8.5rem] w-full rounded-3xl" />;
  if (q.isError || !q.data) return null;
  const d = q.data;
  const fresh = d.completed_orders === 0;

  return (
    <Link
      href="/impact"
      className="group relative block overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-brand-strong p-4 text-primary-foreground shadow-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="absolute -top-10 -right-8 size-36 rounded-full bg-white/10" aria-hidden />
      <span className="absolute -bottom-14 left-1/3 size-32 rounded-full bg-white/5" aria-hidden />
      <div className="relative flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-primary-foreground/85">
          Dampak {firstName(name) || "kamu"} · <span className="font-extrabold">{badgeLabel(d.badge_tier)}</span>
        </p>
        <ChevronRightIcon className="size-4 opacity-80 transition-transform group-hover:translate-x-0.5" />
      </div>
      {fresh ? (
        <p className="relative mt-2 text-[15px] leading-snug font-bold">
          Selamatkan porsi pertamamu malam ini — tiap porsi mencegah ±0,5 kg emisi CO₂e.
        </p>
      ) : (
        <p className="relative mt-2 text-[15px] leading-snug font-bold">
          Kamu telah menyelamatkan <span className="whitespace-nowrap">{formatKg(d.total_food_saved_grams)}</span> makanan
          & mencegah <span className="whitespace-nowrap">{formatKg(d.total_co2_avoided_grams)}</span> emisi CO₂e
        </p>
      )}
      {/* Equal thirds on phones; in the 300–320 px desktop rail each tile takes its value's width, so "Rp 826,5 rb" fits. */}
      <div className="relative mt-3 grid grid-cols-3 gap-2 text-center lg:flex">
        {[
          { icon: LeafIcon, value: formatKg(d.total_food_saved_grams), label: "pangan" },
          { icon: CloudIcon, value: formatKg(d.total_co2_avoided_grams), label: "CO₂e" },
          { icon: WalletIcon, value: formatIdrCompact(d.total_money_saved_idr), full: formatIdr(d.total_money_saved_idr), label: "dihemat" },
        ].map((s) => (
          <div key={s.label} className="min-w-0 rounded-2xl bg-white/12 px-1.5 py-2 ring-1 ring-white/15 lg:flex-auto lg:px-1">
            <s.icon className="mx-auto size-4 opacity-90" aria-hidden />
            <p className="mt-1 truncate text-sm font-extrabold tabular-nums" title={"full" in s ? s.full : undefined}>
              {s.value}
            </p>
            <p className="text-[10px] text-primary-foreground/80">{s.label}</p>
          </div>
        ))}
      </div>
    </Link>
  );
}

/** Logged-out banner with platform totals. */
export function GuestImpactBanner() {
  const stats = useGlobalStats();
  const s = stats.data;
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-deal to-urgent p-4 text-deal-foreground shadow-card">
      <span className="absolute -top-8 -right-6 size-32 rounded-full bg-white/12" aria-hidden />
      <div className="relative flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/20">
          <SparklesIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] leading-snug font-extrabold">Selamatkan makanan, hemat uang</p>
          <p className="mt-0.5 text-xs leading-relaxed text-deal-foreground/90">
            Porsi surplus warung sekitar kampus, diskon 50–70% menjelang tutup.
          </p>
        </div>
      </div>
      <div className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
        {s ? (
          <>
            <span>
              <b className="text-sm font-extrabold tabular-nums">{formatDecimal(s.total_food_saved_grams / 1000, 0)} kg</b>{" "}
              pangan terselamatkan
            </span>
            <span>
              <b className="text-sm font-extrabold tabular-nums">{s.active_merchants}</b> warung mitra
            </span>
          </>
        ) : (
          <Skeleton className="h-4 w-48 bg-white/25" />
        )}
      </div>
    </div>
  );
}
