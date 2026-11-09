"use client";

/**
 * /map — NearbyMerchantMapScreen: full-height SurplusMap with the radius circle,
 * discount pins (GET /discover/map-pins), user dot, recentre FAB, swipeable
 * preview sheet on pin tap, and a list toggle.
 *
 * Laptops (lg+): split view under the desktop top nav. Left, a side panel
 * (location/radius controls, pin legend and a scrollable warung list; hovering
 * or focusing a row highlights its pin); right, the full-height map. Tapping a
 * pin selects its row, scrolls it into view and expands it into the preview
 * (menus + "Lihat menu & pesan"), so no bottom sheet is used on desktop. The
 * phone floating header, Peta/Daftar toggle and list view are `lg:hidden`;
 * the side panel is `hidden lg:flex` (display:none, no duplicates).
 * Height on lg+: viewport minus the top nav (4rem + 1px border); `-mb-16`
 * cancels the shell's 4rem bottom spacer so the page itself never scrolls.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ListIcon, LocateFixedIcon, Loader2Icon, MapIcon, StoreIcon, UtensilsCrossedIcon, XIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { LocationPill } from "@/components/common/location-pill";
import {
  RESPONSIVE_SHEET_DESKTOP_QUERY,
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetDescription,
  ResponsiveSheetTitle,
} from "@/components/common/responsive-sheet";
import { MapLoading, SurplusMap, markerFromPin } from "@/components/map/surplus-map";
import { Button } from "@/components/ui/button";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useMediaQuery } from "@/hooks/use-media-query";
import { api } from "@/lib/api/client";
import type { BatchCard, MapPin, MapPinsResponse, MerchantSummary } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { RADIUS_OPTIONS, formatRadius, useLocationStore } from "@/stores/location";
import { RadiusSegmented, RailLabel } from "../discover/desktop-filters";
import { useNearby } from "../discover/discover-screen";
import { useBatchStream } from "../hooks/use-batch-stream";
import { nextRadius } from "../lib/discover-sections";
import { customerKeys } from "../lib/queries";
import { MerchantCard } from "../merchant-card";
import { useQuickOrder } from "../quick-order/quick-order-sheet";
import { highlightedPinId, mapFitPadding, mapListItemId, showsPreviewSheet } from "./map-layout";

/** Card data for a pin whose warung is not (yet) in the nearby list. */
function merchantFromPin(pin: MapPin) {
  return {
    slug: pin.slug,
    name: pin.merchant_name,
    category: "MAKANAN_BERAT" as const,
    address: "",
    distance_m: pin.distance_m,
    is_verified: pin.is_verified,
    rating_avg: 0,
    total_reviews: 0,
    logo_url: null,
    max_discount_pct: pin.max_discount_pct,
    min_price_idr: 0,
    total_available_stock: pin.total_available_stock,
    closes_at: pin.pickup_end_time,
  };
}

/** Available menus of the previewed warung; each opens quick order. */
function PreviewBatches({
  merchant,
  layout,
  onPick,
}: {
  merchant: MerchantSummary;
  layout: "row" | "grid";
  onPick: (batch: BatchCard) => void;
}) {
  const batches = merchant.batches.filter((b) => b.available_stock > 0);
  if (batches.length === 0) return null;
  return (
    <ul className={layout === "row" ? "no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4" : "mt-3 grid grid-cols-2 gap-2"}>
      {batches.map((b) => (
        <li key={b.batch_id} className={cn(layout === "row" && "w-40 shrink-0")}>
          <button
            type="button"
            onClick={() => onPick(b)}
            className="w-full rounded-2xl bg-muted/70 p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
            aria-label={`Pesan ${b.menu_name}`}
          >
            <p className="line-clamp-1 text-xs font-bold">{b.menu_name}</p>
            <p className="mt-1 text-sm font-extrabold tabular-nums">
              Rp {b.selling_price_idr.toLocaleString("id-ID")}{" "}
              <span className="text-[11px] font-bold text-deal">-{b.discount_pct}%</span>
            </p>
            <p className="text-[11px] text-muted-foreground">Sisa {b.available_stock} porsi</p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function scrollListItemIntoView(merchantId: string) {
  const el = document.getElementById(mapListItemId(merchantId));
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
}

function LiveDot() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
      <span className="relative size-2 rounded-full bg-primary" />
    </span>
  );
}

export function MapScreen() {
  const hydrated = useStoresHydrated();
  const desktop = useMediaQuery(RESPONSIVE_SHEET_DESKTOP_QUERY);
  const source = useLocationStore((s) => s.source);
  const setRadius = useLocationStore((s) => s.setRadius);
  const { request, isLocating } = useGeolocation();
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hasCart = useCartStore((s) => s.items.length > 0);

  const { query: nearby, params } = useNearby({ category: null, q: "", sort: "distance" });
  const pinParams = { lat: params.lat, lng: params.lng, radius_m: params.radius_m };
  const pins = useQuery({
    queryKey: customerKeys.pins(pinParams),
    queryFn: () => api.get<MapPinsResponse>("/discover/map-pins", pinParams),
    enabled: hydrated,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  useBatchStream({ lat: params.lat, lng: params.lng, radiusM: params.radius_m, enabled: hydrated });

  const markers = useMemo(() => (pins.data?.pins ?? []).map(markerFromPin), [pins.data]);
  const byId = useMemo(() => new Map((nearby.data?.merchants ?? []).map((m) => [m.id, m])), [nearby.data]);
  const selectedPin = pins.data?.pins.find((p) => p.merchant_id === selectedId) ?? null;
  const selected: MerchantSummary | null = selectedId ? (byId.get(selectedId) ?? null) : null;
  const bigger = nextRadius(params.radius_m, RADIUS_OPTIONS);
  const empty = pins.isSuccess && markers.length === 0;
  const portions = markers.reduce((s, m) => s + m.stock, 0);
  const allBatches = useMemo(() => (nearby.data?.merchants ?? []).flatMap((m) => m.batches), [nearby.data]);
  const { openQuickOrder, sheet } = useQuickOrder(allBatches);
  const fit = mapFitPadding({ desktop, hasCart });
  const showMap = view === "map" || desktop;
  const statusText = pins.isPending ? "Memuat pin…" : `${markers.length} warung · ${portions} porsi`;

  const selectPin = (id: string) => {
    setSelectedId(id);
    // Desktop: bring the matching row (now expanded into the preview) into view.
    if (desktop) requestAnimationFrame(() => scrollListItemIntoView(id));
  };

  const pickBatch = (merchant: MerchantSummary, b: BatchCard) => {
    // Phones: close the map preview first so the quick-order sheet is on top.
    if (!desktop) setSelectedId(null);
    openQuickOrder(b, { disabledLabel: merchant.is_open ? undefined : "Warung sedang tutup" });
  };

  return (
    <div
      data-shell-width="full"
      className="relative flex h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] flex-col overflow-hidden lg:-mb-16 lg:h-[calc(100dvh-4rem-1px)] lg:flex-row"
    >
      <h1 className="sr-only lg:hidden">Peta surplus</h1>
      {/* Floating header (phones) */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-[600] px-3 pt-3 lg:hidden">
        <div className="pointer-events-auto rounded-3xl bg-background/95 p-3 shadow-float ring-1 ring-border backdrop-blur-xl">
          <LocationPill />
          <div className="mt-2.5 flex items-center gap-2">
            <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <LiveDot />
              <span className="truncate">{statusText}</span>
            </p>
            <Button
              variant="outline"
              size="icon-lg"
              className="size-9 shrink-0 rounded-full"
              onClick={() => void request()}
              disabled={isLocating}
              aria-label="Gunakan lokasi saya (GPS)"
              title="Gunakan lokasi saya"
            >
              {isLocating ? <Loader2Icon className="animate-spin" /> : <LocateFixedIcon className={cn(source === "gps" && "text-primary")} />}
            </Button>
            <div role="radiogroup" aria-label="Tampilan" className="inline-flex rounded-full bg-muted p-0.5">
              {(
                [
                  { k: "map", label: "Peta", Icon: MapIcon },
                  { k: "list", label: "Daftar", Icon: ListIcon },
                ] as const
              ).map(({ k, label, Icon }) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={view === k}
                  onClick={() => setView(k)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-bold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    view === k ? "bg-card text-foreground shadow-soft" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {view === "map" && (
          <p className="pointer-events-auto mx-auto mt-2 w-fit rounded-full bg-background/90 px-3 py-1 text-[11px] font-semibold text-muted-foreground shadow-soft ring-1 ring-border backdrop-blur">
            <span className="font-extrabold text-flash dark:text-flash-accent">Oranye berdenyut (Flash Rescue)</span> = tutup &lt; 45 menit
          </p>
        )}
      </div>

      {/* Side panel (lg+) */}
      <aside
        aria-label="Daftar warung di peta"
        className="hidden min-h-0 shrink-0 flex-col border-r border-border/70 bg-background lg:flex lg:w-[400px] xl:w-[420px]"
      >
        <div className="space-y-4 border-b border-border/70 px-5 pt-6 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight">Peta surplus</h1>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <LiveDot />
                <span className="truncate">
                  {statusText} dalam {formatRadius(params.radius_m)}
                </span>
              </p>
            </div>
            <Button
              variant="outline"
              className="h-9 shrink-0 rounded-full px-3 text-xs font-bold"
              onClick={() => void request()}
              disabled={isLocating}
            >
              {isLocating ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <LocateFixedIcon className={cn(source === "gps" && "text-primary")} />
              )}
              {source === "gps" ? "GPS aktif" : "Pakai lokasi saya"}
            </Button>
          </div>
          <RadiusSegmented />
          <p className="flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
            <span className="relative flex size-2.5 shrink-0" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-flash-accent/70" />
              <span className="relative size-2.5 rounded-full bg-flash-accent" />
            </span>
            <span>
              <span className="font-extrabold text-flash dark:text-flash-accent">Pin oranye berdenyut</span> = Flash Rescue,
              tutup &lt; 45 menit
            </span>
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-6">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <RailLabel>Warung terdekat</RailLabel>
            {nearby.data && (
              <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                {nearby.data.merchants.length} warung
              </span>
            )}
          </div>

          {/* A tapped pin whose warung is not in the list yet still gets a preview. */}
          {selectedPin && !selected && (
            <div className="mb-3 rounded-3xl bg-card p-3 shadow-card ring-2 ring-primary">
              <MerchantCard
                merchant={merchantFromPin(selectedPin)}
                variant="sheet"
                className="p-0 shadow-none ring-0 hover:shadow-none"
              />
            </div>
          )}

          {!hydrated || nearby.isPending ? (
            <ListSkeleton count={4} />
          ) : nearby.isError ? (
            <ErrorState error={nearby.error} onRetry={() => void nearby.refetch()} />
          ) : (nearby.data?.merchants.length ?? 0) === 0 ? (
            <EmptyState
              icon={StoreIcon}
              title={`Belum ada surplus dalam ${formatRadius(params.radius_m)}`}
              description="Warung biasanya membuka porsi surplus sekitar 20.00 WIB."
              action={
                bigger ? (
                  <Button className="h-10 rounded-full px-5 font-bold" onClick={() => setRadius(bigger)}>
                    Perluas ke {formatRadius(bigger)}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-3">
              {nearby.data?.merchants.map((m) => {
                const isSelected = m.id === selectedId;
                return (
                  <li
                    key={m.id}
                    id={mapListItemId(m.id)}
                    onMouseEnter={() => setHoveredId(m.id)}
                    onMouseLeave={() => setHoveredId((h) => (h === m.id ? null : h))}
                    onFocus={() => setHoveredId(m.id)}
                    onBlur={() => setHoveredId((h) => (h === m.id ? null : h))}
                    className="scroll-my-4"
                  >
                    {isSelected ? (
                      <div className="rounded-3xl bg-card p-3 shadow-card ring-2 ring-primary">
                        <div className="-mt-1 mb-1.5 flex items-center justify-between gap-2 pl-1">
                          <span className="text-[11px] font-bold tracking-wide text-primary uppercase">Dipilih di peta</span>
                          <button
                            type="button"
                            onClick={() => setSelectedId(null)}
                            className="-mr-1 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                            aria-label={`Tutup pratinjau ${m.name}`}
                          >
                            <XIcon className="size-4" aria-hidden />
                          </button>
                        </div>
                        <MerchantCard merchant={m} variant="sheet" className="p-0 shadow-none ring-0 hover:shadow-none" />
                        <PreviewBatches merchant={m} layout="grid" onPick={(b) => pickBatch(m, b)} />
                        <Button asChild className="mt-3 h-11 w-full rounded-full font-bold">
                          <Link href={`/warung/${m.slug}`}>
                            <UtensilsCrossedIcon className="size-4" /> Lihat menu & pesan
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <MerchantCard merchant={m} className={cn(hoveredId === m.id && "ring-primary/50 shadow-card")} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {showMap ? (
        <div className="relative flex-1 lg:min-w-0">
          {!hydrated ? (
            <MapLoading className="h-full" />
          ) : (
            <SurplusMap
              center={{ lat: params.lat, lng: params.lng }}
              radiusM={params.radius_m}
              markers={markers}
              selectedId={highlightedPinId({ desktop, hoveredId, selectedId })}
              onMarkerClick={selectPin}
              userLocation={source === "gps" ? { lat: params.lat, lng: params.lng } : null}
              fitPaddingTop={fit.top}
              fitPaddingBottom={fit.bottom}
              className="h-full"
            />
          )}
          {pins.isError && !pins.data && (
            <div className="absolute inset-x-3 bottom-4 z-[600] lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-[26rem] lg:-translate-x-1/2">
              <ErrorState compact error={pins.error} onRetry={() => void pins.refetch()} className="bg-card shadow-float" />
            </div>
          )}
          {empty && (
            <div className="absolute inset-x-3 bottom-4 z-[600] rounded-3xl bg-card p-4 text-center shadow-float ring-1 ring-border lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-[26rem] lg:-translate-x-1/2">
              <p className="text-sm font-bold">Belum ada surplus dalam {formatRadius(params.radius_m)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Warung biasanya membuka porsi surplus sekitar 20.00 WIB.</p>
              {bigger && (
                <Button className="mt-3 h-10 rounded-full px-5 font-bold" onClick={() => setRadius(bigger)}>
                  Perluas ke {formatRadius(bigger)}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pt-36 pb-28 lg:hidden">
          {nearby.isPending ? (
            <ListSkeleton count={4} />
          ) : nearby.isError ? (
            <ErrorState error={nearby.error} onRetry={() => void nearby.refetch()} />
          ) : (nearby.data?.merchants.length ?? 0) === 0 ? (
            <EmptyState icon={StoreIcon} title={`Belum ada surplus dalam ${formatRadius(params.radius_m)}`} />
          ) : (
            <div className="space-y-3">
              {nearby.data?.merchants.map((m) => (
                <MerchantCard key={m.id} merchant={m} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pin preview: bottom sheet on phones; on desktop the side panel row expands instead. */}
      <ResponsiveSheet open={showsPreviewSheet({ desktop, selectedId })} onOpenChange={(o) => !o && setSelectedId(null)}>
        <ResponsiveSheetContent className="mx-auto max-w-md rounded-t-3xl">
          <div className="px-4 pt-3 pb-6">
            <ResponsiveSheetTitle className="sr-only">{selectedPin?.merchant_name ?? "Warung"}</ResponsiveSheetTitle>
            <ResponsiveSheetDescription className="sr-only">Pratinjau warung dan menu surplus</ResponsiveSheetDescription>
            {selected ? (
              <MerchantCard merchant={selected} variant="sheet" className="shadow-none ring-0 p-0 hover:shadow-none" />
            ) : selectedPin ? (
              <MerchantCard
                variant="sheet"
                className="shadow-none ring-0 p-0 hover:shadow-none"
                merchant={merchantFromPin(selectedPin)}
              />
            ) : null}
            {selected && <PreviewBatches merchant={selected} layout="row" onPick={(b) => pickBatch(selected, b)} />}
            {selectedPin && (
              <Button asChild className="mt-4 h-12 w-full rounded-full text-base font-bold">
                <Link href={`/warung/${selectedPin.slug}`}>
                  <UtensilsCrossedIcon className="size-4" /> Lihat menu & pesan
                </Link>
              </Button>
            )}
          </div>
        </ResponsiveSheetContent>
      </ResponsiveSheet>
      {sheet}
    </div>
  );
}
