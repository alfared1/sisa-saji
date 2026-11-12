"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheckIcon,
  BarChart3Icon,
  CalendarRangeIcon,
  ChartColumnIcon,
  CloudIcon,
  CrownIcon,
  LeafIcon,
  LightbulbIcon,
  ListOrderedIcon,
  Loader2Icon,
  TargetIcon,
  Trash2Icon,
  TrophyIcon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, errorMessage } from "@/components/common/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { MERCHANT_PREMIUM_PRICE_IDR } from "@/lib/constants";
import type { AnalyticsResponse, InsightsResponse, UpgradeResponse } from "@/lib/contracts";
import { formatKg } from "@/lib/impact";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { percent } from "../lib/logic";
import { merchantKeys, primeMerchantProfile, MERCHANT_ME_QUERY_KEY, useMerchantReady } from "../lib/queries";
import { MerchantPage, MerchantPageHeader, SectionCard, StatTile } from "../ui";
import { DailyPortionsChart, PredictionOutlook, TopMenusBars, WeeklySurplusHeatmap } from "./charts";

const RANGES = [7, 30, 90] as const;

function formatDateId(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
}

function RevenueRecoveredCard({ a }: { a: AnalyticsResponse }) {
  const share = a.potential_revenue_idr > 0 ? a.revenue_recovered_idr / a.potential_revenue_idr : 0;
  return (
    <section aria-label="Pendapatan yang dipulihkan" className="relative overflow-hidden rounded-3xl bg-impact p-5 text-white shadow-card">
      <p className="relative text-sm font-semibold text-white/80">Pendapatan dipulihkan · {a.range_days} hari</p>
      <p className="relative mt-1 text-4xl leading-none font-extrabold tracking-tight tabular-nums">{formatIdr(a.revenue_recovered_idr)}</p>
      <p className="relative mt-2 text-sm text-white/85">
        dari makanan yang hampir terbuang · potensi harga normal <b className="tabular-nums">{formatIdr(a.potential_revenue_idr)}</b>
      </p>
      <div className="relative mt-4">
        <div className="h-2.5 overflow-hidden rounded-full bg-white/20" role="img" aria-label={`${percent(share)} dari nilai normal berhasil dipulihkan`}>
          <div className="h-full rounded-full bg-white" style={{ width: percent(share) }} />
        </div>
        <p className="mt-1.5 text-xs text-white/80">
          <b className="text-white tabular-nums">{percent(share)}</b> nilai normal kembali jadi uang, bukan sampah.
        </p>
      </div>
    </section>
  );
}

function PremiumPlanUpgradeCard({ a }: { a: AnalyticsResponse }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const isPremium = a.subscription.tier === "PREMIUM";
  const price = a.subscription.price_idr || MERCHANT_PREMIUM_PRICE_IDR;
  const upgrade = useMutation({
    mutationFn: () => api.post<UpgradeResponse>("/merchant/subscription/upgrade"),
    onSuccess: ({ merchant }) => {
      primeMerchantProfile(qc, merchant);
      void qc.invalidateQueries({ queryKey: ["merchant", "analytics"] });
      void qc.invalidateQueries({ queryKey: MERCHANT_ME_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: merchantKeys.dashboard });
      setOpen(false);
      toast.success("Selamat! Warungmu kini Mitra Terverifikasi", {
        description: merchant.subscription_expires_at ? `Premium aktif s/d ${formatDateId(merchant.subscription_expires_at)}.` : undefined,
      });
    },
    onError: (err) => toast.error(errorMessage(err, "Upgrade gagal. Coba lagi.")),
  });

  const benefits = [
    { icon: ListOrderedIcon, text: "Tampil lebih dulu di daftar pembeli dalam radius 2 km" },
    { icon: BadgeCheckIcon, text: "Badge “Mitra Terverifikasi” di peta & halaman warung" },
    { icon: ChartColumnIcon, text: "Perkiraan porsi sisa & notifikasi ke pelanggan setia" },
  ];

  return (
    <section id="premium" aria-labelledby="premium-h" className="scroll-mt-20 overflow-hidden rounded-3xl bg-card shadow-card ring-1 ring-deal/30">
      <div className="bg-gradient-to-br from-deal-soft to-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-deal px-2 py-1 text-[11px] font-bold text-deal-foreground">
              <CrownIcon className="size-3.5" aria-hidden /> Premium
            </span>
            <h2 id="premium-h" className="mt-2 text-lg font-extrabold">
              {isPremium ? "Kamu Mitra Terverifikasi" : "Jadi Mitra Terverifikasi"}
            </h2>
          </div>
          <p className="text-right">
            <span className="block text-xl font-extrabold tabular-nums">{formatIdr(price)}</span>
            <span className="text-xs text-muted-foreground">/ bulan</span>
          </p>
        </div>
        <ul className="mt-4 space-y-2.5">
          {benefits.map((b) => (
            <li key={b.text} className="flex items-start gap-2.5 text-sm">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-card text-deal ring-1 ring-deal/20">
                <b.icon className="size-4" aria-hidden />
              </span>
              <span className="pt-0.5">{b.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-border p-5">
        {isPremium ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              <BadgeCheckIcon className="size-5 text-brand-strong" aria-hidden />
              <span>
                Aktif s/d <b>{a.subscription.expires_at ? formatDateId(a.subscription.expires_at) : "-"}</b>
              </span>
            </p>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-card text-sm font-bold ring-1 ring-border hover:bg-muted"
            >
              Perpanjang 30 hari
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-deal text-sm font-extrabold text-deal-foreground shadow-soft outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <CrownIcon className="size-4" /> Upgrade ke Premium
          </button>
        )}
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        icon={<CrownIcon className="size-7" />}
        title={isPremium ? "Perpanjang Premium 30 hari?" : "Upgrade ke Premium?"}
        description={
          <>
            Biaya {formatIdr(price)} untuk 30 hari.
            <span className="mt-2 block rounded-xl bg-warning-soft px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
              Mode demo: pembayaran disimulasikan, tidak ada uang yang ditagih.
            </span>
          </>
        }
        confirmLabel={upgrade.isPending ? "Memproses…" : "Bayar (simulasi)"}
        loading={upgrade.isPending}
        onConfirm={() => upgrade.mutate()}
      />
    </section>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Memuat analitik">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Skeleton className="h-48 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </div>
      <Skeleton className="h-64 rounded-3xl" />
    </div>
  );
}

/** /merchant/analytics — Revenue Recovery & Waste Reduction Insights. */
export function MerchantAnalyticsView() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const ready = useMerchantReady();
  const analytics = useQuery({
    enabled: ready,
    queryKey: merchantKeys.analytics(range),
    queryFn: () => api.get<AnalyticsResponse>("/merchant/analytics", { range_days: range }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const insights = useQuery({
    enabled: ready,
    queryKey: merchantKeys.insights,
    queryFn: () => api.get<InsightsResponse>("/merchant/predictions/insights"),
    staleTime: 5 * 60_000,
  });
  const a = analytics.data;

  return (
    <MerchantPage>
      <MerchantPageHeader
        title="Analitik"
        subtitle="Uang yang dipulihkan, sampah yang dicegah, dan kapan sebaiknya mengurangi produksi."
        actions={
          <div role="radiogroup" aria-label="Rentang waktu" className="inline-flex rounded-full bg-card p-1 ring-1 ring-border">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={range === r}
                onClick={() => setRange(r)}
                className={cn(
                  "inline-flex h-9 min-w-16 items-center justify-center gap-1 rounded-full px-3 text-xs font-bold tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  range === r ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r} hari
              </button>
            ))}
          </div>
        }
      />

      {analytics.isPending ? (
        <AnalyticsSkeleton />
      ) : analytics.isError || !a ? (
        <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} retrying={analytics.isFetching} />
      ) : (
        <div className={cn("space-y-4 transition-opacity lg:space-y-6", analytics.isPlaceholderData && "opacity-60")}>
          {analytics.isFetching && analytics.isPlaceholderData && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground" role="status">
              <Loader2Icon className="size-3.5 animate-spin" /> Memuat {range} hari…
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-6">
            <RevenueRecoveredCard a={a} />
            <div className="grid grid-cols-2 gap-3">
              <StatTile icon={TargetIcon} label="Sell-through" value={percent(a.sell_through_rate)} hint={`${a.portions_sold} dari ${a.portions_published} porsi`} />
              <StatTile icon={Trash2Icon} label="Porsi terbuang" value={a.portions_wasted} hint="tidak laku sampai tutup" tint="urgent" />
              <StatTile icon={LeafIcon} label="Pangan diselamatkan" value={formatKg(a.food_saved_grams)} hint="dari pesanan selesai" tint="brand" />
              <StatTile icon={CloudIcon} label="CO₂e dicegah" value={formatKg(a.co2_avoided_grams)} hint="faktor FAO 2,5×" tint="brand" />
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-6">
            <SectionCard title="Porsi per hari" icon={BarChart3Icon} description="Ketuk batang untuk melihat detail harian.">
              {a.daily.length ? <DailyPortionsChart daily={a.daily} /> : <p className="text-sm text-muted-foreground">Belum ada data.</p>}
            </SectionCard>
            <SectionCard title="Menu terlaris" icon={TrophyIcon}>
              {a.top_menus.length ? <TopMenusBars menus={a.top_menus} /> : <p className="text-sm text-muted-foreground">Belum ada penjualan di rentang ini.</p>}
            </SectionCard>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:mt-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-6">
        <div className="min-w-0 space-y-4 lg:space-y-6">
          <SectionCard
            title="Peta panas surplus mingguan"
            icon={CalendarRangeIcon}
            description="Rata-rata porsi berlebih per hari & menu, 4 minggu terakhir."
          >
            {insights.isPending ? (
              <Skeleton className="h-48 w-full rounded-2xl" />
            ) : insights.isError ? (
              <ErrorState compact error={insights.error} onRetry={() => void insights.refetch()} />
            ) : (
              <WeeklySurplusHeatmap cells={insights.data.heatmap} />
            )}
          </SectionCard>
          <SectionCard title="Perkiraan 7 hari ke depan" icon={ChartColumnIcon} description="Porsi yang kemungkinan tersisa per malam. Persentase menunjukkan seberapa yakin perkiraannya.">
            {insights.isPending ? <Skeleton className="h-32 w-full rounded-2xl" /> : insights.data ? <PredictionOutlook week={insights.data.week} /> : null}
          </SectionCard>
        </div>
        <div className="min-w-0 space-y-4 lg:space-y-6">
          <SectionCard title="Saran produksi" icon={LightbulbIcon}>
            {insights.isPending ? (
              <Skeleton className="h-24 w-full rounded-2xl" />
            ) : insights.data && insights.data.advisories.length ? (
              <ul className="space-y-2">
                {insights.data.advisories.map((t) => (
                  <li key={t} className="flex gap-2.5 rounded-2xl bg-warning-soft/60 p-3 text-sm leading-snug">
                    <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-brand-strong" aria-hidden />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Produksi sudah pas, belum ada saran pengurangan.</p>
            )}
          </SectionCard>
          {a && <PremiumPlanUpgradeCard a={a} />}
        </div>
      </div>
    </MerchantPage>
  );
}
