"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Loader2Icon, LocateFixedIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getCurrentPosition } from "@/hooks/use-geolocation";
import { CAMPUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { OSM_ATTRIBUTION, OSM_TILE_URL, type LatLng } from "./types";

export type LocationPickerMapProps = {
  value: LatLng | null;
  onChange: (value: LatLng) => void;
  /** Used when `value` is null (defaults to UGM). */
  fallbackCenter?: LatLng;
  className?: string;
  /** Map height (default 18rem). */
  heightClassName?: string;
};

const DROP_PIN = L.divIcon({
  className: "ss-drop-pin",
  html:
    '<svg width="40" height="52" viewBox="0 0 40 52" aria-hidden="true">' +
    '<ellipse cx="20" cy="49" rx="7" ry="2.5" fill="rgba(0,0,0,.22)"/>' +
    '<path d="M20 2C10.6 2 3 9.4 3 18.6 3 31 20 47 20 47s17-16 17-28.4C37 9.4 29.4 2 20 2z" fill="var(--primary)" stroke="white" stroke-width="3"/>' +
    '<circle cx="20" cy="18.5" r="6.5" fill="white"/></svg>',
  iconSize: [40, 52],
  iconAnchor: [20, 48],
});

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function ClickToMove({ onPick }: { onPick: (v: LatLng) => void }) {
  useMapEvents({
    click: (e) => onPick({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) }),
  });
  return null;
}

function FollowValue({ value }: { value: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (!value) return;
    const ll = L.latLng(value.lat, value.lng);
    if (!map.getBounds().pad(-0.2).contains(ll)) map.setView(ll, Math.max(map.getZoom(), 16), { animate: true });
  }, [map, value]);
  return null;
}

export default function LocationPickerMapInner({
  value,
  onChange,
  fallbackCenter = { lat: CAMPUSES[0].lat, lng: CAMPUSES[0].lng },
  className,
  heightClassName = "h-72",
}: LocationPickerMapProps) {
  const [locating, setLocating] = useState(false);
  const initial = value ?? fallbackCenter;
  const handlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng();
        onChange({ lat: round6(ll.lat), lng: round6(ll.lng) });
      },
    }),
    [onChange],
  );

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      onChange({ lat: round6(pos.coords.latitude), lng: round6(pos.coords.longitude) });
      toast.success("Pin dipindah ke lokasimu. Geser pin bila belum tepat.");
    } catch (err) {
      const denied =
        typeof err === "object" && err !== null && "code" in err && (err as GeolocationPositionError).code === 1;
      toast.error(
        denied
          ? "Izin lokasi ditolak. Geser pin secara manual ke titik warung."
          : "Lokasi belum bisa didapat. Geser pin secara manual.",
      );
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className={cn("relative isolate overflow-hidden rounded-2xl ring-1 ring-border", heightClassName)}>
        <MapContainer center={[initial.lat, initial.lng]} zoom={value ? 17 : 15} className="h-full w-full">
          <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              icon={DROP_PIN}
              draggable
              autoPan
              eventHandlers={handlers}
              title="Titik warung (geser untuk memindahkan)"
            />
          )}
          <ClickToMove onPick={onChange} />
          <FollowValue value={value} />
        </MapContainer>
        {!value && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] rounded-xl bg-card/95 px-3 py-2 text-center text-xs font-medium shadow-card ring-1 ring-border">
            Ketuk peta untuk menaruh pin lokasi warung
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" className="h-10 rounded-full px-4" onClick={useMyLocation} disabled={locating}>
          {locating ? <Loader2Icon className="animate-spin" /> : <LocateFixedIcon className="text-primary" />}
          Gunakan lokasi saya
        </Button>
        {value && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          </span>
        )}
      </div>
    </div>
  );
}
