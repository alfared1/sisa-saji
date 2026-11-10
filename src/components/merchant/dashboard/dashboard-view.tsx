"use client";

import { useMemo } from "react";
import { BanknoteIcon, ClockIcon, LeafIcon, UtensilsIcon } from "lucide-react";
import { ErrorState } from "@/components/common/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { useSession } from "@/hooks/use-session";
import { formatKg } from "@/lib/impact";
import { formatIdr, wibTime } from "@/lib/time";
import { useMerchantDashboard } from "../lib/queries";
import { useMerchantLive } from "../lib/use-merchant-live";
import { MerchantPage, StatTile } from "../ui";
import { ActiveSurplusBatchList } from "./active-batch-list";
import { AiPredictionAlertCard } from "./ai-prediction-card";
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

      <section aria-label="Ringkasan hari ini">
        <h2 className="sr-only">Ringkasan hari ini</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={BanknoteIcon} label="Pendapatan hari ini" value={formatIdr(t.revenue_idr)} hint={`${t.orders_completed} pesanan selesai`} />
          <StatTile icon={UtensilsIcon} label="Porsi terjual" value={t.portions_sold} hint="porsi surplus terselamatkan" tint="deal" />
          <StatTile
            icon={ClockIcon}
            label="Menunggu diambil"
            value={t.orders_pending_pickup}
            hint={t.orders_pending_pickup ? "Siapkan bungkusnya" : "Antrean kosong"}
            tint={t.orders_pending_pickup ? "urgent" : "amber"}
          />
          <StatTile icon={LeafIcon} label="Pangan diselamatkan" value={formatKg(t.food_saved_grams)} hint={`${formatKg(t.co2_avoided_grams)} CO₂e dicegah`} tint="sky" />
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        <div className="min-w-0 space-y-4 lg:space-y-6">
          <AiPredictionAlertCard prediction={d.ai_prediction} publishedMenuIds={publishedMenuIds} />
          <ActiveSurplusBatchList batches={d.active_batches} />
        </div>
        <IncomingPickupQueue orders={d.pending_pickups} className="lg:sticky lg:top-6" />
      </div>
    </MerchantPage>
  );
}
