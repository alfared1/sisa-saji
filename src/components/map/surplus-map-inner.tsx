"use client";

/**
 * Leaflet implementation of <SurplusMap /> — imported only through
 * next/dynamic({ ssr: false }) because Leaflet touches `window` on import.
 */
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { LocateFixedIcon } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import {
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  pinHtml,
  pinState,
  zoomForRadius,
  type LatLng,
  type SurplusMapMarker,
} from "./types";

export type SurplusMapProps = {
  center: LatLng;
  radiusM: number;
  markers: SurplusMapMarker[];
  onMarkerClick?: (id: string) => void;
  selectedId?: string | null;
  /** Blue "you are here" dot (defaults to nothing). */
  userLocation?: LatLng | null;
  /** Show the "fit to radius" button (default true). */
  showRecenter?: boolean;
  /** Extra top padding (px) kept clear when fitting, e.g. under a floating header. */
  fitPaddingTop?: number;
  /** Extra bottom padding (px) kept clear when fitting, e.g. above a bottom sheet. */
  fitPaddingBottom?: number;
  className?: string;
};

const USER_ICON = L.divIcon({
  className: "ss-user-dot",
  html: '<div class="ss-user-dot__inner"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function FitToRadius({
  center,
  radiusM,
  paddingTop,
  paddingBottom,
  fitKey,
}: {
  center: LatLng;
  radiusM: number;
  paddingTop: number;
  paddingBottom: number;
  fitKey: number;
}) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLng(center.lat, center.lng).toBounds(radiusM * 2);
    map.fitBounds(bounds, {
      paddingTopLeft: [16, paddingTop + 16],
      paddingBottomRight: [16, paddingBottom + 16],
      animate: fitKey > 0,
    });
  }, [map, center.lat, center.lng, radiusM, paddingTop, paddingBottom, fitKey]);
  return null;
}

/** Pans to the selected marker if it is outside the visible area. */
function KeepSelectedVisible({ marker }: { marker: SurplusMapMarker | null }) {
  const map = useMap();
  useEffect(() => {
    if (!marker) return;
    const ll = L.latLng(marker.lat, marker.lng);
    if (!map.getBounds().pad(-0.15).contains(ll)) map.panTo(ll, { animate: true });
  }, [map, marker]);
  return null;
}

function SurplusPinMarker({
  marker,
  selected,
  nowMs,
  onClick,
}: {
  marker: SurplusMapMarker;
  selected: boolean;
  nowMs: number | null;
  onClick?: (id: string) => void;
}) {
  const state = pinState(marker, nowMs);
  const icon = useMemo(
    () =>
      L.divIcon({
        className: cn("ss-pin", `ss-pin--${state}`, selected && "ss-pin--selected"),
        html: pinHtml(marker, state),
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    [marker, state, selected],
  );
  const handlers = useMemo(() => ({ click: () => onClick?.(marker.id) }), [onClick, marker.id]);
  return (
    <Marker
      position={[marker.lat, marker.lng]}
      icon={icon}
      eventHandlers={handlers}
      title={`${marker.name}: diskon ${Math.round(marker.discount_pct)}%, sisa ${marker.stock} porsi`}
      alt={marker.name}
      zIndexOffset={selected ? 1000 : state === "urgent" ? 500 : 0}
      riseOnHover
    />
  );
}

export default function SurplusMapInner({
  center,
  radiusM,
  markers,
  onMarkerClick,
  selectedId = null,
  userLocation = null,
  showRecenter = true,
  fitPaddingTop = 0,
  fitPaddingBottom = 0,
  className,
}: SurplusMapProps) {
  // Re-evaluate pin urgency twice a minute; no per-second re-render needed.
  const nowMs = useNow(30_000);
  const [fitKey, setFitKey] = useState(0);
  const selected = markers.find((m) => m.id === selectedId) ?? null;

  return (
    <div className={cn("relative isolate h-full w-full overflow-hidden", className)}>
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoomForRadius(radiusM)}
        zoomControl={false}
        attributionControl
        className="h-full w-full"
        style={{ minHeight: 240 }}
      >
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} />
        <Circle
          center={[center.lat, center.lng]}
          radius={radiusM}
          pathOptions={{ className: "ss-radius", weight: 2, dashArray: "6 6" }}
          interactive={false}
        />
        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={USER_ICON}
            interactive={false}
            keyboard={false}
            zIndexOffset={-100}
          />
        )}
        {markers.map((m) => (
          <SurplusPinMarker
            key={m.id}
            marker={m}
            selected={m.id === selectedId}
            nowMs={nowMs}
            onClick={onMarkerClick}
          />
        ))}
        <FitToRadius
          center={center}
          radiusM={radiusM}
          paddingTop={fitPaddingTop}
          paddingBottom={fitPaddingBottom}
          fitKey={fitKey}
        />
        <KeepSelectedVisible marker={selected} />
      </MapContainer>

      {showRecenter && (
        <button
          type="button"
          onClick={() => setFitKey((k) => k + 1)}
          className="absolute right-3 z-[500] inline-flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-float ring-1 ring-border transition-transform outline-none active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50"
          style={{ bottom: fitPaddingBottom + 12 }}
          aria-label="Pusatkan peta ke radius pencarian"
        >
          <LocateFixedIcon className="size-5 text-primary" />
        </button>
      )}
    </div>
  );
}
