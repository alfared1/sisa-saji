"use client";

/**
 * /warung/[slug] — MerchantScreen + MenuScreen: banner (verified, rating,
 * distance, pickup window, closing countdown), favourite/notify toggle,
 * live DynamicPriceMenuCards, directions/WhatsApp, reviews.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BellIcon,
  BellRingIcon,
  ClockIcon,
  FootprintsIcon,
  HandPlatterIcon,
  MapPinIcon,
  MessageCircleIcon,
  MoonIcon,
  NavigationIcon,
  Share2Icon,
  StarIcon,
  StoreIcon,
  UtensilsCrossedIcon,
} from "lucide-react";
import { CountdownBadge } from "@/components/common/countdown-badge";
import { useAddToCart } from "@/components/common/diff-merchant-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifiedBadge } from "@/components/common/verified-badge";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import { MENU_CATEGORY_LABELS, type MerchantDetail, type SubscribeBody, type SubscribeResponse } from "@/lib/contracts";
import { formatClockId } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useStoresHydrated } from "@/stores/hydration";
import { useLocationStore } from "@/stores/location";
import { RatingStars, SectionHeader } from "../bits";
import { FoodThumb } from "../food-thumb";
import { useBatchStream } from "../hooks/use-batch-stream";
import { formatDateId, formatDistance, formatRating, mapsDirectionsUrl, travelMinutes, whatsappUrl } from "../lib/format";
import { cartMerchantOf, customerKeys } from "../lib/queries";
import { DynamicPriceMenuCard } from "../menu-card";
import { useQuickOrder } from "../quick-order/quick-order-sheet";

function useMerchantDetail(slug: string) {
  const hydrated = useStoresHydrated();
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  return useQuery({
    queryKey: customerKeys.warung(slug),
    queryFn: () => api.get<MerchantDetail>(`/merchants/${encodeURIComponent(slug)}`, { lat, lng }),
    enabled: hydrated,
    staleTime: 20_000,
    refetchInterval: 60_000,
    retry: (count, err) => !(err instanceof ApiClientError && err.status === 404) && count < 2,
  });
}

function MerchantSkeleton() {
  return (
    <div className="space-y-4 px-4 pt-2" aria-busy="true" aria-label="Memuat warung">
      <Skeleton className="h-40 w-full rounded-3xl lg:h-64" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
      <ListSkeleton count={3} />
    </div>
  );
}

function SubscribeButton({ merchant }: { merchant: MerchantDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const session = useSession();
  const subscribed = merchant.subscription !== null;
  const key = customerKeys.warung(merchant.slug);

  const mutation = useMutation({
    mutationFn: (body: SubscribeBody) => api.post<SubscribeResponse>(`/merchants/${merchant.id}/subscribe`, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MerchantDetail>(key);
      qc.setQueryData<MerchantDetail>(key, (old) =>
        old
          ? {
              ...old,
              subscription: body.subscribed ? { notify_on_surplus_live: true, notify_on_ai_prediction: true } : null,
            }
          : old,
      );
      return { prev };
    },
    onError: (err, _b, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(err instanceof ApiClientError ? err.message : "Gagal menyimpan. Coba lagi.");
    },
    onSuccess: (res) => {
      toast.success(
        res.subscribed ? `${merchant.name} jadi favorit` : `Berhenti mengikuti ${merchant.name}`,
        res.subscribed ? { description: "Kami kabari saat warung ini membuka porsi surplus." } : undefined,
      );
      void qc.invalidateQueries({ queryKey: customerKeys.subscriptions });
    },
  });

  return (
    <Button
      variant={subscribed ? "secondary" : "outline"}
      className={cn("h-10 rounded-full px-3.5 font-bold", subscribed && "text-primary")}
      aria-pressed={subscribed}
      disabled={mutation.isPending || session.isLoading}
      onClick={() => {
        if (!session.user) {
          toast.message("Masuk dulu untuk mengikuti warung ini");
          router.push(`/auth/login?next=${encodeURIComponent(`/warung/${merchant.slug}`)}`);
          return;
        }
        mutation.mutate({ subscribed: !subscribed, notify_on_surplus_live: true, notify_on_ai_prediction: true });
      }}
    >
      {subscribed ? <BellRingIcon className="size-4" /> : <BellIcon className="size-4" />}
      {subscribed ? "Diikuti" : "Ingatkan"}
    </Button>
  );
}

export function MerchantScreen({ slug, openBatchId = null }: { slug: string; openBatchId?: string | null }) {
  const q = useMerchantDetail(slug);
  const m = q.data;
  const router = useRouter();
  const [showAllReviews, setShowAllReviews] = useState(false);
  const { addToCart, dialog } = useAddToCart();
  const { openQuickOrder, sheet } = useQuickOrder(m?.batches);
  const closedLabel = m && !m.is_open ? "Warung sedang tutup" : undefined;

  // ?order=<batchId> (back from login after a quick order): reopen that menu's
  // sheet once the warung is loaded, then strip the param from the URL.
  const handledOrder = useRef<string | null>(null);
  useEffect(() => {
    if (!openBatchId || !m || handledOrder.current === openBatchId) return;
    const batch = m.batches.find((b) => b.batch_id === openBatchId);
    const id = requestAnimationFrame(() => {
      handledOrder.current = openBatchId;
      if (batch) openQuickOrder(batch, { disabledLabel: m.is_open ? undefined : "Warung sedang tutup" });
      else toast.error("Menu ini sudah tidak tersedia", { description: "Pilih menu surplus lain di warung ini." });
      router.replace(`/warung/${encodeURIComponent(m.slug)}`, { scroll: false });
    });
    return () => cancelAnimationFrame(id);
  }, [openBatchId, m, openQuickOrder, router]);

  useBatchStream({ lat: m?.lat ?? 0, lng: m?.lng ?? 0, radiusM: 300, enabled: Boolean(m) });

  const window_ = useMemo(() => {
    if (!m || m.batches.length === 0) return null;
    const starts = m.batches.map((b) => b.pickup_start_time).sort();
    const ends = m.batches.map((b) => b.pickup_end_time).sort();
    return { start: starts[0], end: ends[ends.length - 1] };
  }, [m]);

  const sortedBatches = useMemo(
    () =>
      m
        ? [...m.batches].sort(
            (a, b) =>
              Number(b.available_stock > 0) - Number(a.available_stock > 0) || b.discount_pct - a.discount_pct,
          )
        : [],
    [m],
  );

  const share = async () => {
    if (!m) return;
    const url = `${window.location.origin}/warung/${m.slug}`;
    const text = `${m.name} lagi buka porsi surplus diskon s/d ${m.max_discount_pct}% di Sisa-Saji`;
    try {
      if (navigator.share) await navigator.share({ title: m.name, text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast.success("Tautan warung disalin");
      }
    } catch {
      /* dismissed */
    }
  };

  if (q.isError && !m) {
    const notFound = q.error instanceof ApiClientError && q.error.status === 404;
    return (
      <>
        <PageHeader title="Warung" backHref="/discover" />
        {notFound ? (
          <EmptyState
            icon={StoreIcon}
            title="Warung tidak ditemukan"
            description="Mungkin tautannya salah atau warung ini sudah tidak aktif."
            action={
              <Button asChild className="h-11 rounded-full px-5 font-bold">
                <Link href="/discover">Cari warung lain</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )}
      </>
    );
  }

  const live = sortedBatches.filter((b) => b.available_stock > 0).length;
  const walk = travelMinutes(m?.distance_m);

  return (
    <>
      <PageHeader
        title={m?.name ?? "Memuat warung…"}
        subtitle={m ? MENU_CATEGORY_LABELS[m.category] : undefined}
        backHref="/discover"
        actions={
          m && (
            <Button variant="ghost" size="icon-lg" className="size-10 rounded-full" onClick={share} aria-label="Bagikan warung">
              <Share2Icon className="size-5" />
            </Button>
          )
        }
      />

      {!m ? (
        <MerchantSkeleton />
      ) : (
        <div
          className={cn(
            "flex flex-col gap-5 px-4 pt-3 pb-8",
            // lg+: full-width hero, then a sticky info column beside the menu + reviews.
            "lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:gap-y-6 lg:pt-2 lg:pb-12",
            "xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-x-10",
          )}
        >
          {/* ---------- Banner ---------- */}
          {/* lg+: `contents` makes the photo and the info card separate grid items. */}
          <section className="overflow-hidden rounded-3xl bg-card shadow-card ring-1 ring-border lg:contents">
            <FoodThumb
              category={m.category}
              imageUrl={m.banner_url}
              alt={`Foto ${m.name}`}
              className="h-32 w-full lg:col-span-2 lg:h-60 lg:rounded-3xl lg:shadow-card lg:ring-1 lg:ring-border xl:h-72"
              iconClassName="size-12 lg:size-20"
            >
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent" />
              {window_ && m.is_open && (
                <CountdownBadge
                  endIso={window_.end}
                  variant="solid"
                  prefix="Tutup dalam"
                  className="absolute right-3 bottom-3 px-2.5 py-1.5 shadow-card lg:right-5 lg:bottom-5"
                />
              )}
            </FoodThumb>
            <div className="p-4 lg:sticky lg:top-20 lg:rounded-3xl lg:bg-card lg:p-5 lg:shadow-card lg:ring-1 lg:ring-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* The sticky PageHeader already carries the page's h1 (same name). */}
                  <h2 className="text-xl leading-tight font-extrabold">{m.name}</h2>
                  {m.is_verified && <VerifiedBadge label="Toko Terverifikasi" className="mt-1.5" />}
                </div>
                <SubscribeButton merchant={m} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1 font-bold">
                  <StarIcon className="size-4 fill-amber-400 text-amber-400" aria-hidden />
                  {formatRating(m.rating_avg)}
                </span>
                <span className="text-muted-foreground">({m.total_reviews} ulasan)</span>
                {m.distance_m !== null && (
                  <>
                    <span className="text-muted-foreground" aria-hidden>
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <FootprintsIcon className="size-3.5" aria-hidden />
                      {formatDistance(m.distance_m)}
                      {walk !== null && ` · ${walk} mnt jalan kaki`}
                    </span>
                  </>
                )}
              </div>
              <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <MapPinIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {m.address}
              </p>
              {m.description && <p className="mt-2 text-sm leading-relaxed text-foreground/80">{m.description}</p>}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-brand-soft/70 p-3">
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-secondary-foreground">
                    <ClockIcon className="size-3.5" /> Jam ambil
                  </p>
                  <p className="mt-0.5 text-sm font-extrabold tabular-nums">
                    {window_
                      ? `${formatClockId(window_.start)}–${formatClockId(window_.end)} WIB`
                      : `${m.operational_open_time.replace(":", ".")}–${m.operational_close_time.replace(":", ".")} WIB`}
                  </p>
                </div>
                <div className="rounded-2xl bg-deal-soft/70 p-3">
                  <p className="flex items-center gap-1 text-[11px] font-semibold text-deal">
                    <HandPlatterIcon className="size-3.5" /> Pengambilan
                  </p>
                  <p className="mt-0.5 text-sm font-extrabold">Ambil sendiri</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button asChild variant="outline" className="h-11 rounded-full font-bold">
                  <a href={mapsDirectionsUrl(m.lat, m.lng)} target="_blank" rel="noreferrer">
                    <NavigationIcon className="size-4 text-primary" /> Petunjuk Arah
                  </a>
                </Button>
                <Button asChild variant="outline" className="h-11 rounded-full font-bold">
                  <a
                    href={whatsappUrl(m.whatsapp_number, `Halo ${m.name}, saya lihat porsi surplus di Sisa-Saji.`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MessageCircleIcon className="size-4 text-emerald-600" /> WhatsApp
                  </a>
                </Button>
              </div>
            </div>
          </section>

          <div className="flex min-w-0 flex-col gap-5 lg:gap-8">
            {!m.is_open && (
              <div className="flex items-start gap-3 rounded-2xl bg-muted p-4" role="status">
                <MoonIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-bold">Warung sedang tutup</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Ikuti warung ini supaya kamu dapat notifikasi saat porsi surplus dibuka lagi.
                  </p>
                </div>
              </div>
            )}

            {/* ---------- Menu ---------- */}
            <section aria-labelledby="menu-title" className="space-y-3">
              <SectionHeader
                id="menu-title"
                title="Menu Surplus Malam Ini"
                subtitle={
                  sortedBatches.length
                    ? `${live} menu tersedia · harga & stok diperbarui langsung`
                    : "Belum ada porsi surplus yang dibuka"
                }
                icon={UtensilsCrossedIcon}
                iconClassName="text-primary"
              />
              {sortedBatches.length === 0 ? (
                <EmptyState
                  icon={MoonIcon}
                  className="rounded-3xl bg-card py-10 ring-1 ring-border"
                  title="Belum ada surplus"
                  description="Warung ini biasanya membuka porsi surplus menjelang tutup. Tekan “Ingatkan” supaya tidak ketinggalan."
                />
              ) : (
                <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
                  {sortedBatches.map((b) => (
                    <DynamicPriceMenuCard
                      key={b.batch_id}
                      batch={b}
                      merchant={cartMerchantOf(m)}
                      disabled={!m.is_open}
                      onAdd={addToCart}
                      onOpenDetail={() => openQuickOrder(b, { disabledLabel: closedLabel })}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* ---------- Reviews ---------- */}
            <section aria-labelledby="review-title" className="space-y-3">
              <SectionHeader
                id="review-title"
                title="Ulasan Pembeli"
                icon={StarIcon}
                iconClassName="text-amber-500"
                action={
                  <span className="text-xs font-semibold text-muted-foreground">
                    {formatRating(m.rating_avg)} / 5 · {m.total_reviews} ulasan
                  </span>
                }
              />
              {m.reviews.length === 0 ? (
                <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground ring-1 ring-border">
                  Belum ada ulasan. Jadilah yang pertama setelah mengambil pesananmu!
                </p>
              ) : (
                <ul className="space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
                  {(showAllReviews ? m.reviews : m.reviews.slice(0, 3)).map((r) => (
                    <li key={r.id} className="rounded-2xl bg-card p-3.5 ring-1 ring-border">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold text-primary">
                            {r.customer_name.charAt(0)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold">{r.customer_name}</p>
                            <RatingStars value={r.rating} />
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateId(r.created_at)}</span>
                      </div>
                      {r.comment && <p className="mt-2 text-sm leading-relaxed text-foreground/85">{r.comment}</p>}
                      {r.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {r.tags.map((t) => (
                            <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/75">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                  {m.reviews.length > 3 && (
                    <li className="lg:col-span-2">
                      <Button
                        variant="ghost"
                        className="h-11 w-full rounded-full font-bold"
                        onClick={() => setShowAllReviews((v) => !v)}
                        aria-expanded={showAllReviews}
                      >
                        {showAllReviews ? "Tampilkan lebih sedikit" : `Lihat ${m.reviews.length - 3} ulasan lainnya`}
                      </Button>
                    </li>
                  )}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
      {dialog}
      {sheet}
    </>
  );
}
