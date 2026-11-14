"use client";

/**
 * /discover — DiscoverScreen: sticky location + radius header, search, category
 * chips, quick filters ("< 500 m", "< 1 km", "Harga ≤ Rp 12.000", "Diskon ≥ 30%"),
 * ImpactCard, the Jam Lapar notification banner, "Hampir Habis & Diskon Tertinggi",
 * "Harga ceban, maksimal Rp 12.000", "Mitra Terdekat" with sort, live SSE
 * price/stock/lauk updates.
 *
 * Search, a category or a quick filter switch the sections to "Menu yang Cocok"
 * (the matching menus themselves) above the matching warung. Quick filters run on
 * the client over the radius already loaded; the quick-order sheet keeps the
 * unfiltered list, so a batch opened from elsewhere still finds its data.
 *
 * Laptops (lg+): two areas. The ShellHeader becomes a sticky left rail card
 * (search, wrapped category chips, sort, radius, impact card, map shortcut);
 * the main column shows the live status row and the sections as grids instead
 * of carousels (capped to full rows: 9 at 3 columns, 8 at 4). Desktop-only copies (sort/radius radios, rail impact card) are
 * `hidden lg:*`, their phone counterparts `lg:hidden` (display:none, so no
 * duplicates for screen readers or Playwright).
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowDownUpIcon,
  ChevronRightIcon,
  FlameIcon,
  LocateFixedIcon,
  Loader2Icon,
  MapIcon,
  RotateCwIcon,
  SearchIcon,
  SearchXIcon,
  StoreIcon,
  SlidersHorizontalIcon,
  TicketIcon,
  WalletIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { CategoryChips } from "@/components/common/category-chips";
import { useAddToCart } from "@/components/common/diff-merchant-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { LocationPill } from "@/components/common/location-pill";
import { ShellHeader } from "@/components/shell/customer-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useNow } from "@/hooks/use-now";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, api } from "@/lib/api/client";
import { CEBAN_MAX_PRICE_IDR } from "@/lib/constants";
import { BUYER_MENU_CATEGORIES, DISCOVER_SORTS, type MenuCategory, type NearbyResponse } from "@/lib/contracts";
import { formatIdr } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useStoresHydrated } from "@/stores/hydration";
import { useTicketsStore } from "@/stores/tickets";
import { RADIUS_OPTIONS, formatRadius, useLocationStore } from "@/stores/location";
import { SectionHeader } from "../bits";
import { DealTile } from "../deal-tile";
import { useBatchStream } from "../hooks/use-batch-stream";
import { useDebounced } from "../hooks/use-debounced";
import { GuestImpactBanner, ImpactCard } from "../impact-card";
import { MerchantCard } from "../merchant-card";
import {
  HOT_DISCOUNT_PCT,
  NO_QUICK_FILTERS,
  applyQuickFilters,
  deriveDiscoverSections,
  hasQuickFilters,
  nextRadius,
  quickFilterCriteria,
  quickFilterDistanceM,
  type QuickFilterState,
} from "../lib/discover-sections";
import { cartMerchantFromBatch, customerKeys } from "../lib/queries";
import { DynamicPriceMenuCard } from "../menu-card";
import { HungerAlertBanner } from "../notifications/hunger-alert-banner";
import { RadiusSegmented, RailLabel, SegmentedRadio } from "./desktop-filters";
import { QuickFilters } from "./quick-filters";
import { useQuickOrder } from "../quick-order/quick-order-sheet";

type Sort = (typeof DISCOVER_SORTS)[number];
const SORT_LABELS: Record<Sort, string> = {
  priority_distance: "Rekomendasi",
  distance: "Terdekat",
  discount: "Diskon terbesar",
  closing_soon: "Segera tutup",
  price: "Termurah",
};

const GEO_DISMISS_KEY = "ss-geo-prompt-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(GEO_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function useNearby(filters: { category: MenuCategory | null; q: string; sort: Sort }) {
  const hydrated = useStoresHydrated();
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const radius = useLocationStore((s) => s.radius_m);
  const params = {
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
    radius_m: radius,
    category: filters.category,
    q: filters.q,
    sort: filters.sort,
  };
  const query = useQuery({
    queryKey: customerKeys.nearby(params),
    queryFn: () =>
      api.get<NearbyResponse>("/discover/nearby", {
        lat: params.lat,
        lng: params.lng,
        radius_m: params.radius_m,
        category: params.category ?? undefined,
        q: params.q || undefined,
        sort: params.sort,
      }),
    enabled: hydrated,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return { query, params, hydrated };
}

function GeoPrompt() {
  const source = useLocationStore((s) => s.source);
  const label = useLocationStore((s) => s.label);
  const hydrated = useStoresHydrated();
  const { request, isLocating, status } = useGeolocation({ autoIfGranted: true });
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const id = requestAnimationFrame(() => setDismissed(readDismissed()));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!hydrated || dismissed || source === "gps" || status === "denied" || status === "granted") return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(GEO_DISMISS_KEY, "1");
    } catch {
      /* storage blocked */
    }
  };

  return (
    <div className="animate-float-up rounded-3xl bg-card p-4 shadow-soft ring-1 ring-border">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-strong">
          <LocateFixedIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Cari surplus paling dekat denganmu</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Izinkan lokasi supaya radius 2 km dihitung dari posisimu. Sekarang kami pakai{" "}
            <b className="text-foreground">{label}</b>.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11 rounded-xl font-semibold" onClick={dismiss}>
          Pakai kampus
        </Button>
        <Button
          className="h-11 rounded-xl font-semibold"
          disabled={isLocating}
          onClick={async () => {
            if (await request()) dismiss();
          }}
        >
          {isLocating ? <Loader2Icon className="animate-spin" /> : <LocateFixedIcon />}
          Izinkan lokasi
        </Button>
      </div>
    </div>
  );
}

function SortMenu({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-card px-3 text-xs font-semibold ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Urutkan: ${SORT_LABELS[value]}`}
      >
        <ArrowDownUpIcon className="size-3.5" />
        {SORT_LABELS[value]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 rounded-xl">
        <DropdownMenuLabel>Urutkan warung</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as Sort)}>
          {DISCOVER_SORTS.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {SORT_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ImpactSlot() {
  const session = useSession();
  // Same element as ImpactCard's own loading skeleton, so SSR (session loading) and a
  // client that already has the session (card still loading) hydrate identically.
  if (session.isLoading) return <Skeleton className="h-[8.5rem] w-full rounded-3xl" />;
  return session.user ? <ImpactCard name={session.user.full_name} /> : <GuestImpactBanner />;
}

/** lg+ rail extras: sort, radius, impact card, map shortcut. */
function DesktopRail({ sort, onSort }: { sort: Sort; onSort: (s: Sort) => void }) {
  return (
    <div className="hidden lg:mt-5 lg:block lg:space-y-5 lg:pb-2">
      <div className="space-y-2">
        <RailLabel>Urutkan warung</RailLabel>
        <SegmentedRadio
          label="Urutkan warung"
          value={sort}
          options={DISCOVER_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
          onChange={onSort}
        />
      </div>
      <RadiusSegmented />
      <ImpactSlot />
      <Link
        href="/map"
        className="group flex items-center gap-3 rounded-2xl bg-brand-soft/70 p-3 ring-1 ring-primary/15 transition-colors outline-none hover:bg-brand-soft focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-soft">
          <MapIcon className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Lihat di peta</span>
          <span className="block text-xs text-muted-foreground">Semua warung surplus di sekitarmu</span>
        </span>
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </div>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat surplus di sekitarmu">
      <div className="space-y-3">
        <div className="h-5 w-56 animate-pulse rounded-md bg-muted" />
        <ListSkeleton variant="tile" count={3} className="lg:grid lg:grid-cols-3 lg:gap-4 lg:[&>*]:w-auto" />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
        <ListSkeleton variant="card" count={4} className="lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0" />
      </div>
    </div>
  );
}

/**
 * Offline (e.g. at the warung with no signal, PWA opened from the home
 * screen): the saved pickup ticket is what matters, not an empty feed.
 */
function OfflineTicketBanner({ offline }: { offline: boolean }) {
  const hydrated = useStoresHydrated();
  const ticketCount = useTicketsStore((s) => Object.keys(s.tickets).length);
  if (!offline || !hydrated || ticketCount === 0) return null;
  return (
    <Link
      href="/offline"
      className="flex items-center gap-3 rounded-3xl bg-deal-soft p-4 text-left shadow-soft ring-1 ring-deal/30 transition-colors hover:bg-deal-soft/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-card text-deal">
        <TicketIcon className="size-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Kamu sedang offline</span>
        <span className="block text-xs text-muted-foreground">
          {ticketCount === 1 ? "1 tiket pengambilan tersimpan" : `${ticketCount} tiket pengambilan tersimpan`} dan tetap
          bisa ditunjukkan ke warung.
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-deal px-3 py-1.5 text-xs font-semibold text-deal-foreground">Lihat tiket</span>
    </Link>
  );
}

export function DiscoverScreen() {
  const [category, setCategory] = useState<MenuCategory | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim().slice(0, 60), 350);
  const [sort, setSort] = useState<Sort>("priority_distance");
  const [quick, setQuick] = useState<QuickFilterState>(NO_QUICK_FILTERS);
  const { query, params, hydrated } = useNearby({ category, q, sort });
  const setRadius = useLocationStore((s) => s.setRadius);
  const now = useNow(30_000);
  const { addToCart, dialog } = useAddToCart();

  useBatchStream({ lat: params.lat, lng: params.lng, radiusM: params.radius_m, enabled: hydrated });

  const quickOn = hasQuickFilters(quick);
  const quickDistanceM = quickFilterDistanceM(quick);
  const shown = useMemo(() => applyQuickFilters(query.data, quickFilterCriteria(quick)), [query.data, quick]);
  const sections = useMemo(() => deriveDiscoverSections(shown, now), [shown, now]);
  const matchBatches = useMemo(() => (shown?.merchants ?? []).flatMap((m) => m.batches), [shown]);
  // The sheet gets every loaded batch, not only the ones the quick filters keep.
  const allBatches = useMemo(() => (query.data?.merchants ?? []).flatMap((m) => m.batches), [query.data]);
  // Quick order (≤ 3 steps): tap a card → sheet → "Kunci Porsi Sekarang" → QRIS.
  const { openQuickOrder, sheet } = useQuickOrder(allBatches);
  const loading = !hydrated || (query.isPending && !query.data);
  const filtered = Boolean(category || q);
  const showMatches = filtered || quickOn;
  const bigger = nextRadius(params.radius_m, RADIUS_OPTIONS);
  // A wider radius cannot add warung closer than the active distance chip.
  const offerBigger = quickDistanceM === null ? bigger : null;
  const scopeLabel = formatRadius(quickDistanceM ?? params.radius_m);
  const serverEmpty = (query.data?.merchants.length ?? 0) === 0;
  const isEmpty = !loading && !query.isError && sections.merchants.length === 0;
  const quickEmpty = isEmpty && quickOn && !serverEmpty;
  const clearFilters = () => {
    setSearch("");
    setCategory(null);
    setQuick(NO_QUICK_FILTERS);
  };
  const online = useOnline();
  const offline =
    !online || (query.isError && query.error instanceof ApiClientError && query.error.code === "NETWORK_ERROR");

  return (
    <div className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-4 lg:pb-10 xl:grid-cols-[320px_minmax(0,1fr)]">
      <ShellHeader className="pb-0 lg:sticky lg:top-20 lg:z-10 lg:mt-4 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-width:thin] lg:rounded-3xl lg:bg-card lg:shadow-soft lg:ring-1 lg:ring-border lg:[&>div]:py-5">
        <h1 className="sr-only lg:not-sr-only lg:mb-4 lg:text-lg! lg:font-bold">Cari makanan surplus</h1>
        <LocationPill className="lg:hidden" />
        <div className="mt-3 flex items-center gap-2 lg:mt-0">
          <label className="relative flex h-11 min-w-0 flex-1 items-center">
            <span className="sr-only">Cari menu atau warung</span>
            <SearchIcon className="pointer-events-none absolute left-3.5 size-4 text-muted-foreground" aria-hidden />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={search}
              maxLength={60}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nasi, soto, roti…"
              className="h-11 w-full rounded-2xl bg-muted/80 pr-10 pl-10 text-sm font-medium ring-1 ring-transparent transition outline-none placeholder:text-muted-foreground focus:bg-card focus:ring-ring/60 [&::-webkit-search-cancel-button]:hidden"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-1 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                aria-label="Hapus pencarian"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </label>
        </div>
        <div className="hidden lg:mt-5 lg:mb-2 lg:block">
          <RailLabel>Kategori</RailLabel>
        </div>
        <CategoryChips
          value={category}
          onChange={setCategory}
          categories={BUYER_MENU_CATEGORIES}
          className="mt-2 lg:mx-0 lg:mt-0 lg:flex-wrap lg:gap-1.5 lg:overflow-visible lg:px-0"
        />
        <div className="hidden lg:mt-5 lg:mb-2 lg:block">
          <RailLabel>Filter cepat</RailLabel>
        </div>
        <QuickFilters
          value={quick}
          onChange={setQuick}
          className="pb-3 lg:mx-0 lg:flex-wrap lg:gap-1.5 lg:overflow-visible lg:px-0 lg:pb-0"
        />
        <DesktopRail sort={sort} onSort={setSort} />
      </ShellHeader>

      <div className="flex min-w-0 flex-col gap-6 px-4 pt-4 pb-6 lg:gap-8 lg:pt-6">
        <OfflineTicketBanner offline={offline} />
        <GeoPrompt />

        {!showMatches && (
          <div className="lg:hidden">
            <ImpactSlot />
          </div>
        )}

        {/* Live status + manual refresh */}
        <div className="-mb-2 flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            {offline ? (
              <WifiOffIcon className="size-3.5 shrink-0 text-urgent" aria-hidden />
            ) : (
              <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
            )}
            <span className="truncate">
              {offline
                ? "Offline · daftar belum bisa diperbarui"
                : loading
                  ? "Mencari surplus di sekitarmu…"
                  : `Live · ${sections.totalBatches} menu, ${sections.totalPortions} porsi dalam ${scopeLabel}`}
            </span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-3 h-9 shrink-0 rounded-full px-3 text-xs font-semibold"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Perbarui daftar"
          >
            <RotateCwIcon className={cn("size-3.5", query.isFetching && "animate-spin")} />
            {query.isFetching ? "Memuat" : "Perbarui"}
          </Button>
        </div>

        <HungerAlertBanner />

        {loading ? (
          <DiscoverSkeleton />
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : quickEmpty ? (
          <EmptyState
            icon={SlidersHorizontalIcon}
            title="Belum ada menu yang cocok dengan filter cepat"
            description={
              quickDistanceM !== null
                ? `Belum ada surplus dalam ${formatRadius(quickDistanceM)} yang sesuai. Coba lepas salah satu filter.`
                : "Coba lepas salah satu filter, atau perluas radius pencarian."
            }
            action={
              <div className="flex flex-col items-center gap-2">
                <Button className="h-11 rounded-xl px-5 font-semibold" onClick={() => setQuick(NO_QUICK_FILTERS)}>
                  Hapus filter cepat
                </Button>
                {offerBigger !== null && (
                  <Button variant="ghost" className="h-10 rounded-full" onClick={() => setRadius(offerBigger)}>
                    Perluas ke {formatRadius(offerBigger)}
                  </Button>
                )}
              </div>
            }
          />
        ) : isEmpty ? (
          <EmptyState
            icon={filtered ? SearchXIcon : StoreIcon}
            title={filtered ? "Tidak ada yang cocok" : `Belum ada surplus dalam ${formatRadius(params.radius_m)}`}
            description={
              filtered
                ? "Coba kata kunci atau kategori lain, atau perluas radius pencarian."
                : "Warung biasanya mulai membuka porsi surplus sekitar 20.00 WIB. Coba perluas radius pencarianmu."
            }
            action={
              <div className="flex flex-col items-center gap-2">
                {offerBigger !== null && (
                  <Button className="h-11 rounded-xl px-5 font-semibold" onClick={() => setRadius(offerBigger)}>
                    Perluas ke {formatRadius(offerBigger)}
                  </Button>
                )}
                {(filtered || quickOn) && (
                  <Button variant="ghost" className="h-10 rounded-full" onClick={clearFilters}>
                    Hapus filter
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <>
            {query.isError && (
              <ErrorState compact error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
            )}

            {/* Search / category / quick filter: show the matching menus themselves (tap →
                quick order), not only the warung cards they belong to. */}
            {showMatches && matchBatches.length > 0 && (
              <section aria-labelledby="sec-match" className="space-y-3">
                <SectionHeader
                  id="sec-match"
                  title="Menu yang Cocok"
                  subtitle={`${matchBatches.length} menu ${q ? `untuk “${q}”` : category ? "di kategori ini" : "sesuai filter cepat"}`}
                  icon={SearchIcon}
                  iconClassName="text-primary"
                />
                <div
                  className={cn(
                    "space-y-3 transition-opacity lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0",
                    query.isPlaceholderData && "opacity-60",
                  )}
                >
                  {matchBatches.map((b) => (
                    <DynamicPriceMenuCard
                      key={b.batch_id}
                      batch={b}
                      merchant={cartMerchantFromBatch(b)}
                      showMerchant
                      onAdd={addToCart}
                      onOpenDetail={() => openQuickOrder(b)}
                    />
                  ))}
                </div>
              </section>
            )}

            {!showMatches && sections.urgent.length > 0 && (
              <section aria-labelledby="sec-urgent" className="space-y-3">
                <SectionHeader
                  id="sec-urgent"
                  title="Hampir Habis & Diskon Tertinggi"
                  subtitle={`Segera tutup atau diskon ${HOT_DISCOUNT_PCT}% ke atas`}
                  icon={FlameIcon}
                  iconClassName="text-urgent"
                />
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0 xl:grid-cols-4 lg:[&>*:nth-child(n+10)]:hidden xl:[&>*:nth-child(n+9)]:hidden">
                  {sections.urgent.map((b) => (
                    <DealTile
                      key={b.batch_id}
                      batch={b}
                      onAdd={addToCart}
                      onOpenDetail={() => openQuickOrder(b)}
                      width="w-52 lg:w-auto"
                    />
                  ))}
                </div>
              </section>
            )}

            {!showMatches && sections.ceban.length > 0 && (
              <section aria-labelledby="sec-ceban" className="space-y-3">
                <SectionHeader
                  id="sec-ceban"
                  title={`Harga ceban, maksimal ${formatIdr(CEBAN_MAX_PRICE_IDR)}`}
                  subtitle="Makan malam hemat akhir bulan"
                  icon={WalletIcon}
                  iconClassName="text-primary"
                />
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0 xl:grid-cols-4 lg:[&>*:nth-child(n+10)]:hidden xl:[&>*:nth-child(n+9)]:hidden">
                  {sections.ceban.map((b) => (
                    <DealTile
                      key={b.batch_id}
                      batch={b}
                      onAdd={addToCart}
                      onOpenDetail={() => openQuickOrder(b)}
                      width="w-48 lg:w-auto"
                    />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="sec-near" className="space-y-3">
              <SectionHeader
                id="sec-near"
                title="Mitra Terdekat"
                subtitle={`${sections.merchants.length} warung dalam ${scopeLabel}`}
                icon={StoreIcon}
                iconClassName="text-primary"
                action={
                  <div className="shrink-0 lg:hidden">
                    <SortMenu value={sort} onChange={setSort} />
                  </div>
                }
              />
              <div
                className={cn(
                  "space-y-3 transition-opacity lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0",
                  query.isPlaceholderData && "opacity-60",
                )}
              >
                {sections.merchants.map((m) => (
                  <MerchantCard key={m.id} merchant={m} />
                ))}
              </div>
              {offerBigger !== null && (
                <button
                  type="button"
                  onClick={() => setRadius(offerBigger)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                >
                  Sudah lihat semua · Perluas ke {formatRadius(offerBigger)}
                </button>
              )}
            </section>
          </>
        )}
      </div>
      {dialog}
      {sheet}
    </div>
  );
}
