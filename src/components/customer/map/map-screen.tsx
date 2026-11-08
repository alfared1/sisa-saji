"use client";

/**
 * /map — NearbyMerchantMapScreen: full-height SurplusMap with the radius circle,
 * discount pins (GET /discover/map-pins), user dot, recentre FAB, swipeable
 * preview sheet on pin tap, and a list toggle.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ListIcon, LocateFixedIcon, Loader2Icon, MapIcon, StoreIcon, UtensilsCrossedIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { ListSkeleton } from "@/components/common/list-skeleton";
import { LocationPill } from "@/components/common/location-pill";
import { MapLoading, SurplusMap, markerFromPin } from "@/components/map/surplus-map";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useGeolocation } from "@/hooks/use-geolocation";
import { api } from "@/lib/api/client";
import type { MapPinsResponse, MerchantSummary } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { useCartStore } from "@/stores/cart";
import { useStoresHydrated } from "@/stores/hydration";
import { RADIUS_OPTIONS, formatRadius, useLocationStore } from "@/stores/location";
import { useNearby } from "../discover/discover-screen";
import { useBatchStream } from "../hooks/use-batch-stream";
import { nextRadius } from "../lib/discover-sections";
import { customerKeys } from "../lib/queries";
import { MerchantCard } from "../merchant-card";
import { useQuickOrder } from "../quick-order/quick-order-sheet";

export function MapScreen() {
  const hydrated = useStoresHydrated();
  const source = useLocationStore((s) => s.source);
  const setRadius = useLocationStore((s) => s.setRadius);
  const { request, isLocating } = useGeolocation();
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  return (
    <div className="relative flex h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] flex-col overflow-hidden">
      {/* Floating header */}
      <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-[600] px-3 pt-3">
        <div className="pointer-events-auto rounded-3xl bg-background/95 p-3 shadow-float ring-1 ring-border backdrop-blur-xl">
          <LocationPill />
          <div className="mt-2.5 flex items-center gap-2">
            <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <span className="relative flex size-2 shrink-0" aria-hidden>
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
                <span className="relative size-2 rounded-full bg-primary" />
              </span>
              <span className="truncate">
                {pins.isPending ? "Memuat pin…" : `${markers.length} warung · ${portions} porsi`}
              </span>
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

      {view === "map" ? (
        <div className="relative flex-1">
          {!hydrated ? (
            <MapLoading className="h-full" />
          ) : (
            <SurplusMap
              center={{ lat: params.lat, lng: params.lng }}
              radiusM={params.radius_m}
              markers={markers}
              selectedId={selectedId}
              onMarkerClick={setSelectedId}
              userLocation={source === "gps" ? { lat: params.lat, lng: params.lng } : null}
              fitPaddingTop={130}
              fitPaddingBottom={hasCart ? 96 : 16}
              className="h-full"
            />
          )}
          {pins.isError && !pins.data && (
            <div className="absolute inset-x-3 bottom-4 z-[600]">
              <ErrorState compact error={pins.error} onRetry={() => void pins.refetch()} className="bg-card shadow-float" />
            </div>
          )}
          {empty && (
            <div className="absolute inset-x-3 bottom-4 z-[600] rounded-3xl bg-card p-4 text-center shadow-float ring-1 ring-border">
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
        <div className="flex-1 overflow-y-auto px-4 pt-36 pb-28">
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

      <Drawer open={selectedId !== null} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DrawerContent className="mx-auto max-w-md rounded-t-3xl">
          <div className="px-4 pt-3 pb-6">
            <DrawerTitle className="sr-only">{selectedPin?.merchant_name ?? "Warung"}</DrawerTitle>
            <DrawerDescription className="sr-only">Pratinjau warung dan menu surplus</DrawerDescription>
            {selected ? (
              <MerchantCard merchant={selected} variant="sheet" className="shadow-none ring-0 p-0 hover:shadow-none" />
            ) : selectedPin ? (
              <MerchantCard
                variant="sheet"
                className="shadow-none ring-0 p-0 hover:shadow-none"
                merchant={{
                  slug: selectedPin.slug,
                  name: selectedPin.merchant_name,
                  category: "MAKANAN_BERAT",
                  address: "",
                  distance_m: selectedPin.distance_m,
                  is_verified: selectedPin.is_verified,
                  rating_avg: 0,
                  total_reviews: 0,
                  logo_url: null,
                  max_discount_pct: selectedPin.max_discount_pct,
                  min_price_idr: 0,
                  total_available_stock: selectedPin.total_available_stock,
                  closes_at: selectedPin.pickup_end_time,
                }}
              />
            ) : null}
            {selected && selected.batches.length > 0 && (
              <ul className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
                {selected.batches
                  .filter((b) => b.available_stock > 0)
                  .map((b) => (
                    <li key={b.batch_id} className="w-40 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          // Close the map preview first so the quick-order sheet is on top.
                          setSelectedId(null);
                          openQuickOrder(b, { disabledLabel: selected.is_open ? undefined : "Warung sedang tutup" });
                        }}
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
            )}
            {selectedPin && (
              <Button asChild className="mt-4 h-12 w-full rounded-full text-base font-bold">
                <Link href={`/warung/${selectedPin.slug}`}>
                  <UtensilsCrossedIcon className="size-4" /> Lihat menu & pesan
                </Link>
              </Button>
            )}
          </div>
        </DrawerContent>
      </Drawer>
      {sheet}
    </div>
  );
}
