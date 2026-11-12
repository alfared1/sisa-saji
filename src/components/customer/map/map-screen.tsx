"use client";

/**
 * /map — the surplus map in two scopes (src/stores/map-scope.ts):
 *
 *  - "Seluruh Indonesia" (every visit starts here): every warung nationwide
 *    from GET /discover/map-pins/all, fitted to all of them. Live warung are
 *    discount pins, the rest muted markers; close markers group into count
 *    bubbles at low zoom (tap to zoom in). The list shows hubs per region and a
 *    row picks that hub. Refreshes every 60 s (no SSE).
 *  - "nearby" (after a pick through "Ambil di sekitar": campus / city, GPS, a
 *    point or the radius): the radius circle, live pins from
 *    GET /discover/map-pins kept fresh by the SSE stream, idle warung in the
 *    radius as muted markers, the nearby warung list and the expand-radius
 *    empty state. "Seluruh Indonesia" goes back.
 *
 * Phones: floating header (LocationPill, status, GPS, Peta/Daftar toggle) over
 * a full-height map; pin previews open as a bottom sheet. Laptops (lg+): split
 * view under the desktop top nav, side panel left (controls, legend, list;
 * hovering a nearby row highlights its pin, a tapped pin opens inline), map
 * right. Height on lg+: viewport minus the top nav (4rem + 1px border); `-mb-16`
 * cancels the shell's 4rem bottom spacer so the page itself never scrolls.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  EarthIcon,
  ListIcon,
  LocateFixedIcon,
  Loader2Icon,
  MapIcon,
  MapPinIcon,
  StoreIcon,
  XIcon,
} from "lucide-react";
import { FLASH_RESCUE_MIN_PCT, FLASH_RESCUE_URGENT_MINUTES } from "@/components/common/discount-logic";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { LocationPill } from "@/components/common/location-pill";
import { LocationSheet } from "@/components/common/location-sheet";
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
import { localTimeZone } from "@/lib/campuses";
import type { AllMapPinsResponse, BatchCard, MapPinsResponse, MerchantSummary, WarungMapPin } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { RADIUS_OPTIONS, formatRadius, useLocationStore } from "@/stores/location";
import { useMapScopeStore, type MapScope } from "@/stores/map-scope";
import { RadiusSegmented, RailLabel } from "../discover/desktop-filters";
import { useNearby } from "../discover/discover-screen";
import { useBatchStream } from "../hooks/use-batch-stream";
import { nextRadius } from "../lib/discover-sections";
import { customerKeys } from "../lib/queries";
import { MerchantCard } from "../merchant-card";
import { useQuickOrder } from "../quick-order/quick-order-sheet";
import { HubSummaryList } from "./hub-summary-list";
import type { HubSummary } from "./map-scope";
import { highlightedPinId, mapFitPadding, mapListItemId, showsPreviewSheet } from "./map-layout";
import {
  idleMarkerFromPin,
  idlePinsWithin,
  indonesiaCountText,
  indonesiaMarkers,
  indonesiaStatusText,
  nationalTotals,
  previewName,
  summarizeHubs,
  type PreviewSources,
} from "./map-scope";
import { WarungPreview } from "./warung-preview";

const NO_PINS: WarungMapPin[] = [];

function scrollListItemIntoView(merchantId: string) {
  const el = document.getElementById(mapListItemId(merchantId));
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
}

function LiveDot() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inset-0 animate-ping rounded-full bg-primary/60 motion-reduce:animate-none" />
      <span className="relative size-2 rounded-full bg-primary" />
    </span>
  );
}

/** Legend swatches, drawn like the map markers (see globals.css .ss-group / .ss-idle). */
function GroupSwatch({ idle = false }: { idle?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-card text-[9px] leading-none font-semibold",
        idle
          ? "border-2 border-dashed border-muted-foreground/80 text-muted-foreground"
          : "border-[3px] border-primary text-foreground",
      )}
      aria-hidden
    >
      5
    </span>
  );
}

function IdleSwatch() {
  return (
    <span
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/70 bg-card"
      aria-hidden
    >
      <span className="size-1 rounded-full bg-muted-foreground" />
    </span>
  );
}

function FlashSwatch() {
  return (
    <span className="relative flex size-2.5 shrink-0" aria-hidden>
      <span className="absolute inset-0 animate-ping rounded-full bg-flash-accent/70 motion-reduce:animate-none" />
      <span className="relative size-2.5 rounded-full bg-flash-accent" />
    </span>
  );
}

function MapLegend({ scope }: { scope: MapScope }) {
  return (
    <ul className="space-y-1.5 rounded-2xl bg-muted/60 px-3 py-2.5 text-xs font-semibold text-muted-foreground">
      {scope === "indonesia" && (
        <>
          <li className="flex items-center gap-2">
            <GroupSwatch />
            <span>
              <span className="font-semibold text-foreground">Angka</span> = jumlah warung, klik untuk memperbesar
            </span>
          </li>
          <li className="flex items-center gap-2">
            <GroupSwatch idle />
            <span>
              <span className="font-semibold text-foreground">Garis putus-putus</span> = belum ada yang membuka surplus
            </span>
          </li>
        </>
      )}
      <li className="flex items-center gap-2">
        <span className="flex w-5 shrink-0 justify-center">
          <FlashSwatch />
        </span>
        <span>
          <span className="font-semibold text-flash dark:text-flash-accent">Pin oranye &ldquo;Kilat&rdquo;</span> = diskon{" "}
          {FLASH_RESCUE_MIN_PCT}%+ atau tutup &lt; {FLASH_RESCUE_URGENT_MINUTES} menit (berdenyut)
        </span>
      </li>
      <li className="flex items-center gap-2">
        <span className="flex w-5 shrink-0 justify-center">
          <IdleSwatch />
        </span>
        <span>
          <span className="font-semibold text-foreground">Titik abu-abu</span> = warung belum membuka surplus
        </span>
      </li>
    </ul>
  );
}

/** Floating legend chip over the phone map: the markers of the current scope. */
function PhoneLegendChip({ scope }: { scope: MapScope }) {
  return (
    <ul className="pointer-events-auto mx-auto mt-2 w-fit max-w-full space-y-1 rounded-2xl bg-background/90 px-3 py-1.5 text-[11px] leading-snug font-semibold text-muted-foreground shadow-soft ring-1 ring-border backdrop-blur">
      {scope === "indonesia" ? (
        <li className="flex items-center gap-1.5">
          <GroupSwatch />
          <span>
            <span className="font-semibold text-foreground">Angka</span> = jumlah warung · ketuk untuk memperbesar
          </span>
        </li>
      ) : (
        <li className="flex items-center gap-1.5">
          <span className="flex w-5 shrink-0 justify-center">
            <FlashSwatch />
          </span>
          <span>
            <span className="font-semibold text-flash dark:text-flash-accent">Kilat</span> = diskon {FLASH_RESCUE_MIN_PCT}%+ atau
            tutup &lt; {FLASH_RESCUE_URGENT_MINUTES} menit
          </span>
        </li>
      )}
      <li className="flex items-center gap-1.5">
        <span className="flex w-5 shrink-0 justify-center">
          <IdleSwatch />
        </span>
        <span>
          <span className="font-semibold text-foreground">Abu-abu</span> = belum ada surplus
        </span>
      </li>
    </ul>
  );
}

function ShowAllButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className={cn("h-10 rounded-full bg-card px-4 text-sm font-semibold shadow-soft", className)}
    >
      <EarthIcon className="text-primary" />
      Seluruh Indonesia
    </Button>
  );
}

export function MapScreen() {
  const hydrated = useStoresHydrated();
  const desktop = useMediaQuery(RESPONSIVE_SHEET_DESKTOP_QUERY);
  const source = useLocationStore((s) => s.source);
  const setRadius = useLocationStore((s) => s.setRadius);
  const setCampus = useLocationStore((s) => s.setCampus);
  const scope = useMapScopeStore((s) => s.scope);
  const openMap = useMapScopeStore((s) => s.openMap);
  const closeMap = useMapScopeStore((s) => s.closeMap);
  const showAll = useMapScopeStore((s) => s.showAll);
  const pickLocation = useMapScopeStore((s) => s.pickLocation);
  const visit = useMapScopeStore((s) => s.visits);
  const indonesia = scope === "indonesia";
  const { request, isLocating } = useGeolocation();
  const [view, setView] = useState<"map" | "list">("map");
  // A selection belongs to the scope and visit it was made in; switching scope or
  // coming back to /map (Next keeps the page state alive in between) clears it.
  const [selection, setSelection] = useState<{ id: string; scope: MapScope; visit: number } | null>(null);
  const selectedId = selection?.scope === scope && selection.visit === visit ? selection.id : null;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const hasCart = useCartStore((s) => s.items.length > 0);

  // Every visit (fresh load or client-side navigation back) starts nationwide.
  useEffect(() => {
    openMap();
    return closeMap;
  }, [openMap, closeMap]);

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
  const all = useQuery({
    queryKey: customerKeys.allPins,
    queryFn: () => api.get<AllMapPinsResponse>("/discover/map-pins/all"),
    enabled: hydrated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  // Live SSE only matters for the radius view; the nationwide view polls (above).
  useBatchStream({ lat: params.lat, lng: params.lng, radiusM: params.radius_m, enabled: hydrated && !indonesia });

  const allPins = all.data?.pins ?? NO_PINS;
  const nationwide = useMemo(() => indonesiaMarkers(allPins), [allPins]);
  const totals = useMemo(() => nationalTotals(allPins), [allPins]);
  const regions = useMemo(() => summarizeHubs(allPins, params.radius_m), [allPins, params.radius_m]);
  const hubCount = regions.reduce((sum, r) => sum + r.hubs.length, 0);
  const allById = useMemo(() => new Map(allPins.map((p) => [p.merchant_id, p])), [allPins]);

  const radiusMarkers = useMemo(() => (pins.data?.pins ?? []).map(markerFromPin), [pins.data]);
  const { lat, lng, radius_m: radiusM } = params;
  // The radius pins (SSE-fresh) decide what is live in the radius once they are for this area.
  const radiusPinsCurrent = pins.isSuccess && !pins.isPlaceholderData;
  const nearbyIdle = useMemo(() => {
    const liveIds = radiusPinsCurrent ? new Set(radiusMarkers.map((m) => m.id)) : null;
    return idlePinsWithin(allPins, { lat, lng }, radiusM, liveIds).map(idleMarkerFromPin);
  }, [allPins, radiusMarkers, radiusPinsCurrent, lat, lng, radiusM]);
  const timeZone = localTimeZone({ lat, lng });

  const byId = useMemo(() => new Map((nearby.data?.merchants ?? []).map((m) => [m.id, m])), [nearby.data]);
  // Nationwide previews use the nationwide pin only (no distance from a location the
  // map is not showing); nearby previews prefer the nearby list entry (with menus).
  const sources: PreviewSources = {
    merchant: selectedId && !indonesia ? (byId.get(selectedId) ?? null) : null,
    warung: selectedId ? (allById.get(selectedId) ?? null) : null,
    pin: indonesia ? null : (pins.data?.pins.find((p) => p.merchant_id === selectedId) ?? null),
  };
  const selected = sources.merchant;
  const bigger = nextRadius(params.radius_m, RADIUS_OPTIONS);
  const empty = !indonesia && pins.isSuccess && radiusMarkers.length === 0;
  const portions = radiusMarkers.reduce((s, m) => s + m.stock, 0);
  const allBatches = useMemo(() => (nearby.data?.merchants ?? []).flatMap((m) => m.batches), [nearby.data]);
  const { openQuickOrder, sheet } = useQuickOrder(allBatches);
  const fit = mapFitPadding({ desktop, hasCart });
  const showMap = view === "map" || desktop;
  const allPending = !hydrated || all.isPending;
  const nearbyStatus = pins.isPending ? "Memuat pin…" : `${radiusMarkers.length} warung · ${portions} porsi`;

  const selectPin = (id: string) => {
    setSelection({ id, scope, visit });
    // Desktop nearby: bring the matching row (now expanded into the preview) into view.
    if (desktop && !indonesia) requestAnimationFrame(() => scrollListItemIntoView(id));
  };
  const clearSelection = () => setSelection(null);

  const pickBatch = (merchant: MerchantSummary, b: BatchCard) => {
    // Phones: close the map preview first so the quick-order sheet is on top.
    if (!desktop) clearSelection();
    openQuickOrder(b, { disabledLabel: merchant.is_open ? undefined : "Warung sedang tutup" });
  };

  // A hub row picks its hub with the radius its counts were taken in.
  const pickHub = (h: HubSummary) => {
    setCampus(h.hub.id);
    setRadius(h.radiusM);
    pickLocation();
    setView("map");
  };
  const locateMe = async () => {
    if (await request()) pickLocation();
  };
  const expandRadius = (r: number) => {
    setRadius(r);
    pickLocation();
  };

  // Hover highlights (and pans to) a pin. Ignore it while the list still shows the
  // previous area's rows (placeholder data after a pick), or the map would pan back there.
  const hoverTarget = indonesia || nearby.isPlaceholderData || pins.isPlaceholderData ? null : hoveredId;

  const gpsLabel = source === "gps" && !indonesia ? "GPS aktif" : "Pakai lokasi saya";

  const hubList = allPending ? (
    <ListSkeleton count={4} />
  ) : all.isError && !all.data ? (
    <ErrorState error={all.error} onRetry={() => void all.refetch()} />
  ) : (
    <HubSummaryList regions={regions} onSelect={pickHub} />
  );

  /** Desktop: the picked warung, when it has no expanded row in the list below. */
  const panelPreview =
    selectedId && (indonesia || !selected) ? (
      <div className="mb-4 rounded-3xl bg-card p-3 shadow-card ring-2 ring-primary">
        <div className="-mt-1 mb-1.5 flex items-center justify-between gap-2 pl-1">
          <span className="text-xs font-semibold text-primary">Dipilih di peta</span>
          <button
            type="button"
            onClick={clearSelection}
            className="-mr-1 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={`Tutup pratinjau ${previewName(sources)}`}
          >
            <XIcon className="size-4" aria-hidden />
          </button>
        </div>
        <WarungPreview sources={sources} layout="grid" onPick={pickBatch} />
      </div>
    ) : null;

  return (
    <div
      data-shell-width="full"
      data-map-scope={scope}
      // `isolate` keeps the floating header and map buttons (z-500/600, above Leaflet's panes) under the sheets.
      // Full height minus the tab bar (phones) or top nav (lg+), and minus the demo strip when it shows (--demo-notice-h, see DemoNoticeHeight).
      className="relative isolate flex h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom)-var(--demo-notice-h,0px))] flex-col overflow-hidden lg:-mb-16 lg:h-[calc(100dvh-4rem-1px-var(--demo-notice-h,0px))] lg:flex-row"
    >
      <h1 className="sr-only lg:hidden">Peta surplus</h1>
      {/* Floating header (phones) */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-[600] px-3 pt-3 lg:hidden">
        <div className="pointer-events-auto rounded-3xl bg-background/95 p-3 shadow-float ring-1 ring-border backdrop-blur-xl">
          <LocationPill />
          <div className="mt-2.5 flex items-center gap-2">
            <p
              className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-muted-foreground"
              aria-live="polite"
            >
              <LiveDot />
              {indonesia ? (
                allPending ? (
                  <span className="truncate">Memuat warung…</span>
                ) : (
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-foreground">{indonesiaCountText(totals)}</span>
                    <span className="block truncate">{totals.portions.toLocaleString("id-ID")} porsi live</span>
                  </span>
                )
              ) : (
                <span className="truncate">{nearbyStatus}</span>
              )}
            </p>
            <Button
              variant="outline"
              size="icon-lg"
              className="size-9 shrink-0 rounded-full"
              onClick={() => void locateMe()}
              disabled={isLocating}
              aria-label="Gunakan lokasi saya (GPS)"
              title="Gunakan lokasi saya"
            >
              {isLocating ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <LocateFixedIcon className={cn(source === "gps" && !indonesia && "text-primary")} />
              )}
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
                    "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    view === k ? "bg-card text-foreground shadow-soft" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {view === "map" && <PhoneLegendChip scope={scope} />}
      </div>

      {/* Side panel (lg+) */}
      <aside
        aria-label={indonesia ? "Warung di seluruh Indonesia" : "Daftar warung di peta"}
        className="hidden min-h-0 shrink-0 flex-col border-r border-border/70 bg-background lg:flex lg:w-[400px] xl:w-[420px]"
      >
        <div className="space-y-4 border-b border-border/70 px-5 pt-5 pb-5">
          {!indonesia && (
            <Button
              variant="ghost"
              onClick={showAll}
              className="-ml-2 h-8 rounded-full px-2.5 text-xs font-semibold text-primary hover:text-primary"
            >
              <ArrowLeftIcon /> Seluruh Indonesia
            </Button>
          )}
          <div className={cn("flex items-start justify-between gap-3", !indonesia && "-mt-2")}>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold">Peta surplus</h1>
              <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground" aria-live="polite">
                <LiveDot />
                <span className="truncate">
                  {indonesia
                    ? allPending
                      ? "Memuat warung…"
                      : indonesiaStatusText(totals)
                    : `${nearbyStatus} dalam ${formatRadius(params.radius_m)}`}
                </span>
              </p>
            </div>
            <Button
              variant="outline"
              className="h-9 shrink-0 rounded-full px-3 text-xs font-semibold"
              onClick={() => void locateMe()}
              disabled={isLocating}
            >
              {isLocating ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <LocateFixedIcon className={cn(source === "gps" && !indonesia && "text-primary")} />
              )}
              {gpsLabel}
            </Button>
          </div>
          {indonesia ? (
            <p className="rounded-2xl bg-brand-soft/70 px-3 py-2.5 text-xs leading-relaxed font-medium text-foreground">
              Semua warung mitra Sisa-Saji. Pilih kota di bawah atau pakai lokasimu untuk melihat surplus di
              sekitarnya.
            </p>
          ) : (
            <RadiusSegmented />
          )}
          <MapLegend scope={scope} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-6">
          {panelPreview}

          {indonesia ? (
            <>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <RailLabel>Kota & kampus</RailLabel>
                {!allPending && (
                  <span className="text-xs font-semibold text-muted-foreground tabular-nums">{hubCount} lokasi</span>
                )}
              </div>
              {hubList}
            </>
          ) : (
            <>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <RailLabel>Warung terdekat</RailLabel>
                {nearby.data && (
                  <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                    {nearby.data.merchants.length} warung
                  </span>
                )}
              </div>

              {!hydrated || nearby.isPending ? (
                <ListSkeleton count={4} />
              ) : nearby.isError ? (
                <ErrorState error={nearby.error} onRetry={() => void nearby.refetch()} />
              ) : (nearby.data?.merchants.length ?? 0) === 0 ? (
                <EmptyState
                  icon={StoreIcon}
                  title={`Belum ada surplus dalam ${formatRadius(params.radius_m)}`}
                  description={`Warung biasanya membuka porsi surplus sekitar 20.00 ${timeZone}.`}
                  action={
                    bigger ? (
                      <Button className="h-10 rounded-full px-5 font-semibold" onClick={() => expandRadius(bigger)}>
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
                              <span className="text-xs font-semibold text-primary">
                                Dipilih di peta
                              </span>
                              <button
                                type="button"
                                onClick={clearSelection}
                                className="-mr-1 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                                aria-label={`Tutup pratinjau ${m.name}`}
                              >
                                <XIcon className="size-4" aria-hidden />
                              </button>
                            </div>
                            <WarungPreview
                              sources={{ merchant: m, warung: null, pin: null }}
                              layout="grid"
                              onPick={pickBatch}
                            />
                          </div>
                        ) : (
                          <MerchantCard merchant={m} className={cn(hoveredId === m.id && "ring-primary/50 shadow-card")} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </aside>

      {showMap ? (
        <div className="relative flex-1 lg:min-w-0">
          {!hydrated ? (
            <MapLoading className="h-full" />
          ) : (
            <SurplusMap
              key={visit}
              center={{ lat: params.lat, lng: params.lng }}
              radiusM={indonesia ? null : params.radius_m}
              markers={indonesia ? nationwide.live : radiusMarkers}
              idleMarkers={indonesia ? nationwide.idle : nearbyIdle}
              groupMarkers={indonesia}
              selectedId={highlightedPinId({ desktop, hoveredId: hoverTarget, selectedId })}
              onMarkerClick={selectPin}
              userLocation={source === "gps" ? { lat: params.lat, lng: params.lng } : null}
              fitPaddingTop={fit.top}
              fitPaddingBottom={fit.bottom}
              className="h-full"
            />
          )}
          <div className="absolute left-3 z-[500] lg:hidden" style={{ bottom: fit.bottom + 12 }}>
            {indonesia ? (
              // Phones: the way to narrow down, mirrored by "Seluruh Indonesia" in nearby scope.
              <Button
                variant="outline"
                onClick={() => setLocationSheetOpen(true)}
                className="h-11 rounded-xl bg-card px-4 text-sm font-semibold shadow-float"
              >
                <MapPinIcon className="text-primary" />
                Pilih kota / lokasi
              </Button>
            ) : (
              <ShowAllButton onClick={showAll} className="h-11 shadow-float" />
            )}
          </div>
          {(indonesia ? all.isError && !all.data : pins.isError && !pins.data) && (
            <div className="absolute inset-x-3 bottom-4 z-[600] lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-[26rem] lg:-translate-x-1/2">
              <ErrorState
                compact
                error={indonesia ? all.error : pins.error}
                onRetry={() => void (indonesia ? all.refetch() : pins.refetch())}
                className="bg-card shadow-float"
              />
            </div>
          )}
          {empty && (
            <div
              // Phones: above the "Seluruh Indonesia" / recentre buttons (and the cart bar).
              style={{ "--empty-bottom": `${fit.bottom + 68}px` } as CSSProperties}
              className="absolute inset-x-3 bottom-[var(--empty-bottom)] z-[600] rounded-3xl bg-card p-4 text-center shadow-float ring-1 ring-border lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:w-[26rem] lg:-translate-x-1/2">
              <p className="text-sm font-semibold">Belum ada surplus dalam {formatRadius(params.radius_m)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Warung biasanya membuka porsi surplus sekitar 20.00 {timeZone}.
              </p>
              {bigger && (
                <Button className="mt-3 h-10 rounded-full px-5 font-semibold" onClick={() => expandRadius(bigger)}>
                  Perluas ke {formatRadius(bigger)}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pt-36 pb-28 lg:hidden">
          {indonesia ? (
            <>
              <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                Pilih kota untuk melihat warung dan surplus di sekitarnya.
              </p>
              {hubList}
            </>
          ) : (
            <>
              <ShowAllButton onClick={showAll} className="mb-4" />
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
            </>
          )}
        </div>
      )}

      {/* Pin preview: bottom sheet on phones; on desktop the side panel shows it instead. */}
      <ResponsiveSheet open={showsPreviewSheet({ desktop, selectedId })} onOpenChange={(o) => !o && clearSelection()}>
        <ResponsiveSheetContent className="mx-auto max-w-md rounded-t-3xl">
          <div className="px-4 pt-3 pb-6">
            <ResponsiveSheetTitle className="sr-only">{previewName(sources)}</ResponsiveSheetTitle>
            <ResponsiveSheetDescription className="sr-only">Pratinjau warung dan menu surplus</ResponsiveSheetDescription>
            <WarungPreview sources={sources} layout="row" onPick={pickBatch} />
          </div>
        </ResponsiveSheetContent>
      </ResponsiveSheet>
      {sheet}
      <LocationSheet open={locationSheetOpen} onOpenChange={setLocationSheetOpen} />
    </div>
  );
}
