"use client";

/**
 * /discover — DiscoverScreen: sticky location + radius header, search, category
 * chips, ImpactCard, "Hampir Habis & Diskon Tertinggi", "Di Bawah Rp 10.000",
 * "Mitra Terdekat" with sort, live SSE price/stock updates.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowDownUpIcon,
  CheckIcon,
  FlameIcon,
  LocateFixedIcon,
  Loader2Icon,
  RotateCwIcon,
  SearchIcon,
  SearchXIcon,
  StoreIcon,
  WalletIcon,
  XIcon,
} from "lucide-react";
import { CategoryChips } from "@/components/common/category-chips";
import { useAddToCart } from "@/components/common/diff-merchant-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { LocationPill } from "@/components/common/location-pill";
import { ShellHeader } from "@/components/shell/customer-shell";
import { Button } from "@/components/ui/button";
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
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api/client";
import { DISCOVER_SORTS, type MenuCategory, type NearbyResponse } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useStoresHydrated } from "@/stores/hydration";
import { RADIUS_OPTIONS, formatRadius, useLocationStore } from "@/stores/location";
import { SectionHeader } from "../bits";
import { DealTile } from "../deal-tile";
import { useBatchStream } from "../hooks/use-batch-stream";
import { useDebounced } from "../hooks/use-debounced";
import { GuestImpactBanner, ImpactCard } from "../impact-card";
import { MerchantCard } from "../merchant-card";
import { deriveDiscoverSections, nextRadius } from "../lib/discover-sections";
import { customerKeys } from "../lib/queries";

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
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
          <LocateFixedIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Cari surplus paling dekat denganmu</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Izinkan lokasi supaya radius 2 km dihitung dari posisimu. Sekarang kami pakai{" "}
            <b className="text-foreground">{label}</b>.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11 rounded-full font-semibold" onClick={dismiss}>
          Pakai kampus
        </Button>
        <Button
          className="h-11 rounded-full font-bold"
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
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-card px-3 text-xs font-bold ring-1 ring-border outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
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

function DiscoverSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Memuat surplus di sekitarmu">
      <div className="space-y-3">
        <div className="h-5 w-56 animate-pulse rounded-md bg-muted" />
        <ListSkeleton variant="tile" count={3} />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
        <ListSkeleton variant="card" count={3} />
      </div>
    </div>
  );
}

export function DiscoverScreen() {
  const session = useSession();
  const [category, setCategory] = useState<MenuCategory | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim().slice(0, 60), 350);
  const [sort, setSort] = useState<Sort>("priority_distance");
  const { query, params, hydrated } = useNearby({ category, q, sort });
  const setRadius = useLocationStore((s) => s.setRadius);
  const now = useNow(30_000);
  const { addToCart, dialog } = useAddToCart();

  useBatchStream({ lat: params.lat, lng: params.lng, radiusM: params.radius_m, enabled: hydrated });

  const sections = useMemo(() => deriveDiscoverSections(query.data, now), [query.data, now]);
  const loading = !hydrated || (query.isPending && !query.data);
  const filtered = Boolean(category || q);
  const bigger = nextRadius(params.radius_m, RADIUS_OPTIONS);
  const isEmpty = !loading && !query.isError && sections.merchants.length === 0;

  return (
    <>
      <ShellHeader className="pb-0">
        <LocationPill />
        <div className="mt-3 flex items-center gap-2">
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
              placeholder="Cari nasi, gudeg, roti…"
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
        <CategoryChips value={category} onChange={setCategory} className="mt-2 pb-3" />
      </ShellHeader>

      <div className="flex flex-col gap-6 px-4 pt-4 pb-6">
        <GeoPrompt />

        {!filtered &&
          (session.isLoading ? (
            <div className="h-[8.5rem] w-full animate-pulse rounded-3xl bg-muted" />
          ) : session.user ? (
            <ImpactCard name={session.user.full_name} />
          ) : (
            <GuestImpactBanner />
          ))}

        {/* Live status + manual refresh */}
        <div className="-mb-2 flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="relative flex size-2.5 shrink-0" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
              <span className="relative size-2.5 rounded-full bg-primary" />
            </span>
            <span className="truncate">
              {loading
                ? "Mencari surplus di sekitarmu…"
                : `Live · ${sections.totalBatches} menu, ${sections.totalPortions} porsi dalam ${formatRadius(params.radius_m)}`}
            </span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 shrink-0 rounded-full px-3 text-xs font-bold"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="Perbarui daftar"
          >
            <RotateCwIcon className={cn("size-3.5", query.isFetching && "animate-spin")} />
            {query.isFetching ? "Memuat" : "Perbarui"}
          </Button>
        </div>

        {loading ? (
          <DiscoverSkeleton />
        ) : query.isError && !query.data ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
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
                {bigger && (
                  <Button className="h-11 rounded-full px-5 font-bold" onClick={() => setRadius(bigger)}>
                    Perluas ke {formatRadius(bigger)}
                  </Button>
                )}
                {filtered && (
                  <Button
                    variant="ghost"
                    className="h-10 rounded-full"
                    onClick={() => {
                      setSearch("");
                      setCategory(null);
                    }}
                  >
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

            {sections.urgent.length > 0 && (
              <section aria-labelledby="sec-urgent" className="space-y-3">
                <SectionHeader
                  id="sec-urgent"
                  title="Hampir Habis & Diskon Tertinggi"
                  subtitle="Segera tutup atau diskon 60% ke atas"
                  icon={FlameIcon}
                  iconClassName="text-urgent"
                />
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
                  {sections.urgent.map((b) => (
                    <DealTile key={b.batch_id} batch={b} onAdd={addToCart} width="w-52" />
                  ))}
                </div>
              </section>
            )}

            {sections.under10k.length > 0 && (
              <section aria-labelledby="sec-10k" className="space-y-3">
                <SectionHeader
                  id="sec-10k"
                  title="Di Bawah Rp 10.000"
                  subtitle="Makan malam hemat akhir bulan"
                  icon={WalletIcon}
                  iconClassName="text-primary"
                />
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
                  {sections.under10k.map((b) => (
                    <DealTile key={b.batch_id} batch={b} onAdd={addToCart} />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="sec-near" className="space-y-3">
              <SectionHeader
                id="sec-near"
                title="Mitra Terdekat"
                subtitle={`${sections.merchants.length} warung dalam ${formatRadius(params.radius_m)}`}
                icon={StoreIcon}
                iconClassName="text-primary"
                action={<SortMenu value={sort} onChange={setSort} />}
              />
              <div className={cn("space-y-3 transition-opacity", query.isPlaceholderData && "opacity-60")}>
                {sections.merchants.map((m) => (
                  <MerchantCard key={m.id} merchant={m} />
                ))}
              </div>
              {bigger && (
                <button
                  type="button"
                  onClick={() => setRadius(bigger)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted"
                >
                  <CheckIcon className="size-3.5" /> Sudah lihat semua · Perluas ke {formatRadius(bigger)}
                </button>
              )}
            </section>
          </>
        )}
      </div>
      {dialog}
    </>
  );
}
