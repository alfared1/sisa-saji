"use client";

/**
 * <SurplusMap center radiusM markers onMarkerClick selectedId userLocation />
 *
 * Client-only Leaflet map (OpenStreetMap tiles) with the search-radius circle,
 * a "you are here" dot and DivIcon pins ("-60%" + "Sisa 3") coloured by
 * urgency — red & pulsing when < 45 minutes to close.
 */
import dynamic from "next/dynamic";
import { MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SurplusMapProps } from "./surplus-map-inner";

export type { SurplusMapProps } from "./surplus-map-inner";
export { markerFromMerchant, markerFromPin, type LatLng, type SurplusMapMarker } from "./types";

export function MapLoading({ className, label = "Memuat peta…" }: { className?: string; label?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-60 w-full flex-col items-center justify-center gap-2 bg-muted text-sm text-muted-foreground",
        className,
      )}
      aria-busy="true"
    >
      <MapIcon className="size-6 animate-soft-pulse text-primary" aria-hidden />
      {label}
    </div>
  );
}

const SurplusMapInner = dynamic(() => import("./surplus-map-inner"), {
  ssr: false,
  loading: () => <MapLoading />,
});

export function SurplusMap(props: SurplusMapProps) {
  return <SurplusMapInner {...props} />;
}
