"use client";

/**
 * /impact — LoyaltyScreen + FavoriteScreen: EcoHeroBadgeProgress, totals,
 * MonthlyImpactChart, push opt-in and PredictiveSubscriptionList.
 */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AwardIcon,
  BellOffIcon,
  BellRingIcon,
  BrainCircuitIcon,
  CloudIcon,
  HeartIcon,
  LeafIcon,
  Loader2Icon,
  RadioIcon,
  SproutIcon,
  StoreIcon,
  TreesIcon,
  TrophyIcon,
  WalletIcon,
} from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { ShellHeader } from "@/components/shell/customer-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import { BADGE_TIERS } from "@/lib/constants";
import type { ImpactSummary, SubscribeBody, SubscriptionItem, SubscriptionsResponse } from "@/lib/contracts";
import { formatKg } from "@/lib/impact";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { LoginCta, SectionHeader, TabTitle } from "../bits";
import { useImpactSummary } from "../impact-card";
import { badgeLabel, formatDecimal } from "../lib/format";
import { customerKeys } from "../lib/queries";
import { MonthlyImpactChart } from "./monthly-chart";

const TIER_ICONS = [SproutIcon, AwardIcon, TrophyIcon] as const;

function EcoHeroBadgeProgress({ d }: { d: ImpactSummary }) {
  const currentIdx = Math.max(0, BADGE_TIERS.findIndex((t) => t.tier === d.badge_tier));
  const next = d.next_badge;
  const remaining = next ? Math.max(0, next.min_food_saved_grams - d.total_food_saved_grams) : 0;
  const CurrentIcon = TIER_ICONS[currentIdx] ?? SproutIcon;
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-primary via-brand-strong to-emerald-900 p-5 text-white shadow-float lg:col-span-5 lg:flex lg:flex-col lg:self-start lg:p-6 xl:justify-between xl:self-stretch">
      <span className="absolute -top-14 -right-10 size-48 rounded-full bg-white/10" aria-hidden />
      <div className="relative flex items-center gap-3">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
          <CurrentIcon className="size-7" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/80">Level kamu</p>
          <p className="text-2xl leading-tight font-extrabold">{badgeLabel(d.badge_tier)}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xl font-extrabold tabular-nums">{d.loyalty_points.toLocaleString("id-ID")}</p>
          <p className="text-[11px] text-white/80">poin</p>
        </div>
      </div>

      <div className="relative mt-5">
        <div className="flex justify-between text-[11px] font-semibold text-white/80">
          {BADGE_TIERS.map((t, i) => {
            const Icon = TIER_ICONS[i];
            return (
              <span key={t.tier} className={cn("flex items-center gap-1", i <= currentIdx && "text-white")}>
                <Icon className="size-3.5" /> {badgeLabel(t.tier).replace("Surplus ", "")}
              </span>
            );
          })}
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/20"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={next ? Math.round(next.progress_pct) : 100}
          aria-label={next ? `Progres menuju ${badgeLabel(next.tier)}` : "Level tertinggi tercapai"}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-lime-300 to-amber-300 transition-[width] duration-700"
            style={{ width: `${next ? Math.min(100, Math.max(3, next.progress_pct)) : 100}%` }}
          />
        </div>
        <p className="mt-2 text-xs font-semibold text-white/90">
          {next
            ? `Selamatkan ${formatKg(remaining)} lagi untuk jadi ${badgeLabel(next.tier)}`
            : "Kamu sudah Surplus Hero — terima kasih sudah jadi pahlawan pangan!"}
        </p>
      </div>
    </section>
  );
}

function Totals({ d }: { d: ImpactSummary }) {
  const tiles = [
    { icon: LeafIcon, value: formatKg(d.total_food_saved_grams), label: "pangan diselamatkan", tint: "bg-brand-soft text-primary" },
    {
      icon: CloudIcon,
      value: formatKg(d.total_co2_avoided_grams),
      label: "emisi CO₂e dicegah",
      tint: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
    },
    { icon: WalletIcon, value: formatIdr(d.total_money_saved_idr), label: "uang dihemat", tint: "bg-deal-soft text-deal" },
    {
      icon: TreesIcon,
      value: `${formatDecimal(d.tree_equivalent, 2)} pohon`,
      label: "setara serapan setahun",
      tint: "bg-warning-soft text-amber-700 dark:text-amber-300",
    },
  ];
  return (
    <section aria-label="Total dampak" className="grid grid-cols-2 gap-2.5 lg:col-span-7 lg:gap-4 xl:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-3xl bg-card p-3.5 shadow-soft ring-1 ring-border lg:p-4">
          <span className={cn("inline-flex size-9 items-center justify-center rounded-xl", t.tint)}>
            <t.icon className="size-4.5" />
          </span>
          <p className="mt-2 truncate text-lg font-extrabold tabular-nums">{t.value}</p>
          <p className="text-xs text-muted-foreground">{t.label}</p>
        </div>
      ))}
      <p className="col-span-2 text-center text-xs text-muted-foreground lg:text-left xl:col-span-4">
        Dari <b className="text-foreground">{d.completed_orders}</b> pesanan selesai · faktor IPCC 2,5 kg CO₂e per kg pangan
      </p>
    </section>
  );
}

export function PushOptIn() {
  const push = usePushNotifications();
  if (!push.supported) return null;
  const on = push.subscribed && push.permission === "granted";
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
      <span
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-2xl",
          on ? "bg-brand-soft text-primary" : "bg-deal-soft text-deal",
        )}
      >
        {on ? <BellRingIcon className="size-5" /> : <BellOffIcon className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{on ? "Notifikasi aktif" : "Aktifkan notifikasi"}</p>
        <p className="text-xs leading-snug text-muted-foreground">
          {push.permission === "denied"
            ? "Notifikasi diblokir. Izinkan lewat pengaturan browser."
            : on
              ? "Kami kabari saat warung favoritmu membuka surplus."
              : "Dapat kabar saat ada surplus atau prediksi AI di warung favoritmu."}
        </p>
      </div>
      {!on && push.permission !== "denied" && (
        <Button className="h-10 shrink-0 rounded-full px-4 font-bold" onClick={() => void push.subscribe()} disabled={push.isSubscribing}>
          {push.isSubscribing ? <Loader2Icon className="animate-spin" /> : "Aktifkan"}
        </Button>
      )}
    </div>
  );
}

function SubscriptionRow({ s }: { s: SubscriptionItem }) {
  const qc = useQueryClient();
  const key = customerKeys.subscriptions;
  const m = useMutation({
    mutationFn: (body: SubscribeBody) => api.post(`/merchants/${s.merchant_id}/subscribe`, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<SubscriptionsResponse>(key);
      qc.setQueryData<SubscriptionsResponse>(key, (old) =>
        old
          ? {
              subscriptions: body.subscribed
                ? old.subscriptions.map((x) =>
                    x.merchant_id === s.merchant_id
                      ? {
                          ...x,
                          notify_on_surplus_live: body.notify_on_surplus_live ?? x.notify_on_surplus_live,
                          notify_on_ai_prediction: body.notify_on_ai_prediction ?? x.notify_on_ai_prediction,
                        }
                      : x,
                  )
                : old.subscriptions.filter((x) => x.merchant_id !== s.merchant_id),
            }
          : old,
      );
      return { prev };
    },
    onError: (err, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(err instanceof ApiClientError ? err.message : "Gagal menyimpan pengaturan.");
    },
    onSuccess: (_d, body) => {
      if (!body.subscribed) toast(`Berhenti mengikuti ${s.merchant_name}`);
      void qc.invalidateQueries({ queryKey: customerKeys.warung(s.merchant_slug) });
    },
  });

  const update = (patch: Partial<Pick<SubscriptionItem, "notify_on_surplus_live" | "notify_on_ai_prediction">>) =>
    m.mutate({
      subscribed: true,
      notify_on_surplus_live: patch.notify_on_surplus_live ?? s.notify_on_surplus_live,
      notify_on_ai_prediction: patch.notify_on_ai_prediction ?? s.notify_on_ai_prediction,
    });

  return (
    <li className="rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-primary">
          <StoreIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={`/warung/${s.merchant_slug}`} className="block truncate text-[15px] font-bold hover:underline">
            {s.merchant_name}
          </Link>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {s.has_live_batches && (
              <span className="inline-flex items-center gap-1 rounded-full bg-urgent-soft px-2 py-0.5 text-[11px] font-bold text-urgent">
                <RadioIcon className="size-3 animate-soft-pulse" /> Surplus live sekarang
              </span>
            )}
            {s.predicted_surplus_portions !== null && s.predicted_surplus_portions > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                <BrainCircuitIcon className="size-3" /> Malam ini diprediksi ~{s.predicted_surplus_portions} porsi
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-lg"
          className="size-10 shrink-0 rounded-full text-urgent hover:bg-urgent-soft hover:text-urgent"
          aria-label={`Berhenti mengikuti ${s.merchant_name}`}
          onClick={() => m.mutate({ subscribed: false })}
        >
          <HeartIcon className="size-5 fill-current" />
        </Button>
      </div>
      <div className="mt-3 divide-y divide-border rounded-2xl bg-muted/60">
        <label className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 text-sm">
          <span>
            <span className="block font-semibold">Saat surplus dibuka</span>
            <span className="block text-xs text-muted-foreground">Notifikasi begitu warung publikasi porsi</span>
          </span>
          <Switch
            checked={s.notify_on_surplus_live}
            onCheckedChange={(v) => update({ notify_on_surplus_live: v })}
            aria-label={`Notifikasi surplus ${s.merchant_name}`}
          />
        </label>
        <label className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 text-sm">
          <span>
            <span className="block font-semibold">Ingatkan dari prediksi AI</span>
            <span className="block text-xs text-muted-foreground">Mis. “malam Jumat biasanya sisa ~8 porsi”</span>
          </span>
          <Switch
            checked={s.notify_on_ai_prediction}
            onCheckedChange={(v) => update({ notify_on_ai_prediction: v })}
            aria-label={`Notifikasi prediksi AI ${s.merchant_name}`}
          />
        </label>
      </div>
    </li>
  );
}

function PredictiveSubscriptionList() {
  const q = useQuery({
    queryKey: customerKeys.subscriptions,
    queryFn: () => api.get<SubscriptionsResponse>("/subscriptions"),
    staleTime: 30_000,
  });
  return (
    <section aria-labelledby="fav-title" className="space-y-3">
      <SectionHeader
        id="fav-title"
        title="Warung Favorit & Prediksi"
        subtitle="Diingatkan saat warung favorit diprediksi punya surplus"
        icon={HeartIcon}
        iconClassName="text-urgent"
      />
      {q.isPending ? (
        <ListSkeleton variant="row" count={2} />
      ) : q.isError ? (
        <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.subscriptions.length === 0 ? (
        <EmptyState
          icon={HeartIcon}
          className="rounded-3xl bg-card py-8 ring-1 ring-border"
          title="Belum ada warung favorit"
          description="Tekan “Ingatkan” di halaman warung untuk dapat kabar saat surplusnya dibuka."
          action={
            <Button asChild variant="outline" className="h-10 rounded-full px-5 font-bold">
              <Link href="/discover">Jelajahi warung</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {q.data.subscriptions.map((s) => (
            <SubscriptionRow key={s.merchant_id} s={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ImpactScreen() {
  const session = useSession();
  const loggedIn = Boolean(session.user);
  const q = useImpactSummary(loggedIn);
  const [metric, setMetric] = useState<"food" | "co2" | "money">("food");

  return (
    <>
      <ShellHeader>
        <TabTitle title="Dampak" subtitle="Makanan yang kamu selamatkan" />
      </ShellHeader>
      <div
        className={cn(
          "flex flex-col gap-5 px-4 pt-4 pb-6",
          // lg+: dashboard grid (badge + stat cards, then wide chart beside the favourites column).
          loggedIn && q.data && "lg:grid lg:grid-cols-12 lg:items-start lg:gap-6 lg:pt-6",
        )}
      >
        {session.isLoading ? (
          <Skeleton className="h-44 w-full rounded-3xl" />
        ) : !loggedIn ? (
          <LoginCta
            title="Lihat dampakmu"
            description="Masuk untuk melacak kg makanan yang kamu selamatkan, emisi CO₂e yang dicegah, dan naik level jadi Surplus Hero."
            next="/impact"
            icon={<LeafIcon className="size-9 text-primary" />}
          />
        ) : q.isPending ? (
          <>
            <Skeleton className="h-44 w-full rounded-3xl" />
            <div className="grid grid-cols-2 gap-2.5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-3xl" />
              ))}
            </div>
            <Skeleton className="h-56 w-full rounded-3xl" />
          </>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        ) : (
          <>
            <EcoHeroBadgeProgress d={q.data} />
            <Totals d={q.data} />
            <div className="contents lg:block lg:col-span-7 xl:col-span-8">
              <MonthlyImpactChart monthly={q.data.monthly} metric={metric} onMetricChange={setMetric} />
            </div>
            <div className="contents lg:sticky lg:top-20 lg:col-span-5 lg:flex lg:flex-col lg:gap-5 xl:col-span-4">
              <PushOptIn />
              <PredictiveSubscriptionList />
            </div>
          </>
        )}
      </div>
    </>
  );
}
