"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { ErrorState } from "@/components/common/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { useSession } from "@/hooks/use-session";
import { formatKg } from "@/lib/impact";
import { formatIdr, wibTime } from "@/lib/time";
import { useMerchantDashboard } from "../lib/queries";
import { useMerchantLive } from "../lib/use-merchant-live";
import { cn } from "@/lib/utils";
import type { MerchantDashboard } from "@/lib/contracts";
import { MerchantPage } from "../ui";
import { ActiveSurplusBatchList } from "./active-batch-list";
import { AiPredictionAlertCard } from "./ai-prediction-card";
import { LeftoverReportCard } from "./leftover-report-card";
import { RepeatYesterdayCard } from "./repeat-yesterday-card";
import { IncomingPickupQueue } from "./pickup-queue";
import { StoreStatusHeader, greetingFor } from "./store-status-header";

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Memuat dasbor">
      <Skeleton className="h-36 w-full rounded-3xl lg:h-24" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Skeleton className="h-56 rounded-3xl" />
          <Skeleton className="h-52 rounded-3xl" />
        </div>
        <Skeleton className="h-72 rounded-3xl" />
      </div>
    </div>
  );
}

/**
 * "Ringkasan hari ini": one number leads (portions sold out of those put up tonight, with a bar),
 * then money recovered and food saved. Money is orange with the plate line, like every price.
 */
function TodaySummary({ today: t }: { today: MerchantDashboard["today"] }) {
  const total = Math.max(t.portions_published, t.portions_sold);
  const pct = total > 0 ? Math.round((t.portions_sold / total) * 100) : 0;
  return (
    <section aria-labelledby="ringkasan-heading" className="space-y-3">
      <h2 id="ringkasan-heading" className="text-lg font-bold">
        Ringkasan hari ini
      </h2>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
          <p className="text-sm text-muted-foreground">Porsi terjual</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl leading-none font-extrabold tabular-nums">{t.portions_sold}</span>
            {total > 0 && <span className="text-base font-semibold text-muted-foreground tabular-nums">dari {total}</span>}
          </p>
          {total > 0 ? (
            <div
              role="progressbar"
              aria-label="Porsi terjual dari porsi yang dipasang hari ini"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={t.portions_sold}
              className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Belum ada porsi yang dipasang hari ini.</p>
          )}
          {t.orders_pending_pickup > 0 && (
            <p className="mt-2 text-xs font-semibold text-foreground/80">{t.orders_pending_pickup} pesanan menunggu diambil</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:contents">
          <div className="min-w-0 rounded-2xl bg-card p-4 ring-1 ring-border">
            <p className="text-sm leading-tight text-muted-foreground">Pendapatan dipulihkan</p>
            <p className="mt-1.5 truncate text-xl font-extrabold text-deal tabular-nums sm:text-2xl">{formatIdr(t.revenue_idr)}</p>
            <span aria-hidden className="mt-1 block h-[3px] w-7 rounded-full bg-plate" />
            <p className="mt-1.5 text-xs text-muted-foreground">{t.orders_completed} pesanan selesai</p>
          </div>
          <div className="min-w-0 rounded-2xl bg-card p-4 ring-1 ring-border">
            <p className="text-sm leading-tight text-muted-foreground">Pangan terselamatkan</p>
            <p className="mt-1.5 truncate text-xl font-extrabold tabular-nums sm:text-2xl">{formatKg(t.food_saved_grams)}</p>
            <p className="mt-2.5 text-xs text-muted-foreground">{formatKg(t.co2_avoided_grams)} CO₂e dicegah</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** /merchant/dashboard — Merchant Command Center. */
export function MerchantDashboardView() {
  const dash = useMerchantDashboard();
  const live = useMerchantLive();
  const { user } = useSession();
  const now = useNow(60_000);
  const greeting = greetingFor(now === null ? 19 : Number(wibTime(new Date(now)).slice(0, 2)));

  const publishedMenuIds = useMemo(
    () => new Set((dash.data?.active_batches ?? []).filter((b) => b.status === "ACTIVE" || b.status === "SCHEDULED").map((b) => b.menu_id)),
    [dash.data?.active_batches],
  );

  if (dash.isPending) {
    return (
      <MerchantPage>
        <DashboardSkeleton />
      </MerchantPage>
    );
  }
  if (dash.isError) {
    return (
      <MerchantPage>
        <ErrorState error={dash.error} onRetry={() => void dash.refetch()} retrying={dash.isFetching} />
      </MerchantPage>
    );
  }

  const d = dash.data;
  const t = d.today;

  return (
    <MerchantPage className="space-y-4 lg:space-y-6">
      <StoreStatusHeader merchant={d.merchant} ownerName={user?.full_name ?? "Mitra"} greeting={greeting} liveStatus={live.status} />

      <TodaySummary today={t} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        <div className="min-w-0 space-y-4 lg:space-y-6">
          <RepeatYesterdayCard />
          <AiPredictionAlertCard prediction={d.ai_prediction} publishedMenuIds={publishedMenuIds} />
          <ActiveSurplusBatchList batches={d.active_batches} isPilot={d.merchant.is_pilot} />
          <LeftoverReportCard />
        </div>
        {/* Phones: when buyers are waiting, the queue and Scan come first (one column). */}
        <IncomingPickupQueue
          orders={d.pending_pickups}
          className={cn("lg:sticky lg:top-6", d.pending_pickups.length > 0 && "order-first lg:order-none")}
        />
      </div>

      {/* Phones: publishing is always one thumb away, just above the tabs. */}
      <div aria-hidden className="h-16 lg:hidden" />
      <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur-xl lg:hidden">
        <Link
          href="/merchant/surplus/new"
          className="mx-auto flex h-12 max-w-2xl items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground outline-none active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PlusIcon className="size-5" aria-hidden /> Publikasikan surplus
        </Link>
      </div>
    </MerchantPage>
  );
}
