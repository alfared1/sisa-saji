"use client";

/**
 * Leaflet implementation of <SurplusMap /> — imported only through
 * next/dynamic({ ssr: false }) because Leaflet touches `window` on import.
 *
 * Two framings:
 *  - radius (radiusM is a number): dashed search circle, fitted to the radius.
 *  - all markers (radiusM null): no circle, fitted to every marker (the
 *    nationwide map); `groupMarkers` turns close markers into count bubbles
 *    below CLUSTER_MAX_ZOOM, and tapping a bubble zooms in on its members.
 */
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { LocateFixedIcon, Maximize2Icon } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import {
  CLUSTER_MAX_ZOOM,
  boundsOfPoints,
  clusterPoints,
  groupCaption,
  groupSizePx,
  placeCaptions,
  type ClusterPoint,
  type PixelView,
  type GroupCaption,
  type LatLngBoundsTuple,
  type MarkerGroup,
} from "./cluster";
import {
  IDLE_HTML,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  groupClassName,
  groupHtml,
  groupLabel,
  idleClassName,
  idleLabel,
  pinBadge,
  pinClassName,
  pinHtml,
  pinLabel,
  pinState,
  zoomForRadius,
  type IdleMapMarker,
  type LatLng,
  type SurplusMapMarker,
} from "./types";

export type SurplusMapProps = {
  center: LatLng;
  /** Search radius in meters (circle + fit). null: no circle, fit every marker instead. */
  radiusM: number | null;
  markers: SurplusMapMarker[];
  /** Warung without live surplus, drawn as small muted markers under the pins. */
  idleMarkers?: IdleMapMarker[];
  /** Group close markers into count bubbles below CLUSTER_MAX_ZOOM. */
  groupMarkers?: boolean;
  /** Called with the warung id for pins and idle markers. */
  onMarkerClick?: (id: string) => void;
  selectedId?: string | null;
  /** Blue "you are here" dot (defaults to nothing). */
  userLocation?: LatLng | null;
  /** Show the "fit again" button (default true). */
  showRecenter?: boolean;
  /** Extra top padding (px) kept clear when fitting, e.g. under a floating header. */
  fitPaddingTop?: number;
  /** Extra bottom padding (px) kept clear when fitting, e.g. above a bottom sheet. */
  fitPaddingBottom?: number;
  className?: string;
};

/** Initial view of the all-markers framing until the data arrives: Indonesia. */
const INDONESIA_VIEW = { center: [-2.5, 118] as [number, number], zoom: 4 };

const USER_ICON = L.divIcon({
  className: "ss-user-dot",
  html: '<div class="ss-user-dot__inner"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const NO_IDLE: IdleMapMarker[] = [];

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type FitPadding = { paddingTop: number; paddingBottom: number };

function fitOptions({ paddingTop, paddingBottom }: FitPadding, animate: boolean): L.FitBoundsOptions {
  return {
    paddingTopLeft: [16, paddingTop + 16],
    paddingBottomRight: [16, paddingBottom + 16],
    animate: animate && !prefersReducedMotion(),
  };
}

function FitToRadius({
  center,
  radiusM,
  paddingTop,
  paddingBottom,
  fitKey,
}: FitPadding & { center: LatLng; radiusM: number; fitKey: number }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLng(center.lat, center.lng).toBounds(radiusM * 2);
    map.fitBounds(bounds, fitOptions({ paddingTop, paddingBottom }, fitKey > 0));
  }, [map, center.lat, center.lng, radiusM, paddingTop, paddingBottom, fitKey]);
  return null;
}

/**
 * Fits every marker. Keyed on the rounded bounds, so a background refetch with
 * the same warung keeps the user's pan/zoom; only new bounds or the button refit.
 */
function FitToBounds({
  bounds,
  paddingTop,
  paddingBottom,
  fitKey,
}: FitPadding & { bounds: LatLngBoundsTuple | null; fitKey: number }) {
  const map = useMap();
  const key = bounds ? bounds.flat().map((v) => v.toFixed(3)).join(",") : "";
  useEffect(() => {
    if (!key) return;
    const [s, w, n, e] = key.split(",").map(Number);
    map.fitBounds(
      [
        [s, w],
        [n, e],
      ],
      { ...fitOptions({ paddingTop, paddingBottom }, fitKey > 0), maxZoom: CLUSTER_MAX_ZOOM },
    );
  }, [map, key, paddingTop, paddingBottom, fitKey]);
  return null;
}

/** Pans to the selected marker if it is outside the visible area. */
function KeepSelectedVisible({ point }: { point: LatLng | null }) {
  const map = useMap();
  const lat = point?.lat;
  const lng = point?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    const ll = L.latLng(lat, lng);
    if (!map.getBounds().pad(-0.15).contains(ll)) map.panTo(ll, { animate: !prefersReducedMotion() });
  }, [map, lat, lng]);
  return null;
}

/**
 * Leaflet keyboard markers are role="button" divs: keep their accessible name
 * current, and tag them with `key` (the warung id, or a group's first member)
 * so keyboard focus can follow a group into the markers it splits into.
 */
function useMarkerLabel(label: string, key: string) {
  const ref = useRef<L.Marker>(null);
  useEffect(() => {
    const el = ref.current?.getElement();
    if (!el) return;
    el.setAttribute("aria-label", label);
    el.setAttribute("title", label);
    el.dataset.markerKey = key;
  });
  return ref;
}

/**
 * Click plus Enter / Space. Leaflet makes markers focusable buttons but only
 * turns Enter into an action for markers with a popup, so keys are handled here.
 */
function activationHandlers(action: (viaKeyboard: boolean) => void): L.LeafletEventHandlerFnMap {
  return {
    click: () => action(false),
    keydown: (e) => {
      const ev = (e as L.LeafletKeyboardEvent).originalEvent;
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      action(true);
    },
  };
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
  const badge = pinBadge(marker, nowMs);
  const variant = badge?.variant ?? null;
  const pulse = badge?.pulse ?? false;
  const icon = useMemo(() => {
    // Rebuilt only when the visible state changes (variant / pulse), not every tick.
    const b = pinBadge(marker, nowMs);
    return L.divIcon({
      className: pinClassName(state, b, selected),
      html: pinHtml(marker, state, b),
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nowMs only matters through state/variant/pulse
  }, [marker, state, variant, pulse, selected]);
  const handlers = useMemo(() => activationHandlers(() => onClick?.(marker.id)), [onClick, marker.id]);
  const label = pinLabel(marker, badge);
  const ref = useMarkerLabel(label, marker.id);
  return (
    <Marker
      ref={ref}
      position={[marker.lat, marker.lng]}
      icon={icon}
      eventHandlers={handlers}
      title={label}
      alt={marker.name}
      zIndexOffset={selected ? 1000 : pulse ? 500 : 0}
      riseOnHover
    />
  );
}

function IdleMarker({
  marker,
  selected,
  onClick,
}: {
  marker: IdleMapMarker;
  selected: boolean;
  onClick?: (id: string) => void;
}) {
  const icon = useMemo(
    () => L.divIcon({ className: idleClassName(selected), html: IDLE_HTML, iconSize: [0, 0], iconAnchor: [0, 0] }),
    [selected],
  );
  const handlers = useMemo(() => activationHandlers(() => onClick?.(marker.id)), [onClick, marker.id]);
  const label = idleLabel(marker.name);
  const ref = useMarkerLabel(label, marker.id);
  return (
    <Marker
      ref={ref}
      position={[marker.lat, marker.lng]}
      icon={icon}
      eventHandlers={handlers}
      title={label}
      alt={marker.name}
      // Live pins always draw above idle warung; a selected idle one comes forward.
      zIndexOffset={selected ? 1000 : -1000}
      riseOnHover
    />
  );
}

/** After a keyboard zoom into a group: focus one of its markers, or the map when none is drawn. */
function focusGroupMembers(map: L.Map, memberIds: ReadonlySet<string>) {
  const container = map.getContainer();
  const markers = container.querySelectorAll<HTMLElement>(".leaflet-marker-icon[data-marker-key]");
  const target = [...markers].find((el) => memberIds.has(el.dataset.markerKey ?? ""));
  (target ?? container).focus({ preventScroll: true });
}

function GroupMarker({
  group,
  zoom,
  caption,
  onZoomIn,
  paddingTop,
  paddingBottom,
}: FitPadding & {
  group: MarkerGroup;
  zoom: number;
  caption: GroupCaption | undefined;
  onZoomIn: (message: string) => void;
}) {
  const map = useMap();
  const count = group.points.length;
  const size = groupSizePx(count, zoom);
  const captionText = caption?.text;
  const captionPlacement = caption?.placement;
  const icon = useMemo(
    () =>
      L.divIcon({
        className: groupClassName(group.live),
        html: groupHtml(
          count,
          size,
          captionText && captionPlacement ? { text: captionText, placement: captionPlacement } : null,
        ),
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    [count, group.live, size, captionText, captionPlacement],
  );
  // The label names the area even when its caption did not fit on the map.
  const area = groupCaption(group.areas);
  const handlers = useMemo(
    () =>
      activationHandlers((viaKeyboard) => {
        if (viaKeyboard) {
          // The bubble disappears once it splits: move focus into what it split into.
          const members = new Set(group.points.map((p) => p.id));
          map.once("moveend", () =>
            requestAnimationFrame(() => requestAnimationFrame(() => focusGroupMembers(map, members))),
          );
        }
        onZoomIn(`Peta diperbesar${area ? ` ke ${area}` : ""}: ${count} warung.`);
        map.fitBounds(group.bounds, {
          ...fitOptions({ paddingTop: paddingTop + 24, paddingBottom: paddingBottom + 24 }, true),
          // Grouping stops at CLUSTER_MAX_ZOOM, so even warung on one spot split up there.
          maxZoom: CLUSTER_MAX_ZOOM,
        });
      }),
    [map, group.bounds, group.points, paddingTop, paddingBottom, onZoomIn, area, count],
  );
  const label = groupLabel(count, group.live, area || undefined);
  const ref = useMarkerLabel(label, group.points[0]?.id ?? group.id);
  return (
    <Marker
      ref={ref}
      position={[group.lat, group.lng]}
      icon={icon}
      eventHandlers={handlers}
      title={label}
      zIndexOffset={200}
      riseOnHover
    />
  );
}

function useZoom(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  return zoom;
}

/**
 * The visible map in world pixels, minus `insetTop` (a floating header) and a
 * small margin, so captions are placed where they can be read. Updates on pan.
 */
function usePixelView(insetTop: number): PixelView {
  const map = useMap();
  const read = () => {
    const b = map.getPixelBounds();
    const m = 4;
    return { x0: b.min!.x + m, y0: b.min!.y + insetTop + m, x1: b.max!.x - m, y1: b.max!.y - m };
  };
  const [view, setView] = useState<PixelView>(read);
  useMapEvents({ moveend: () => setView(read()), resize: () => setView(read()) });
  return view;
}

/** Live pins + idle markers, grouped into count bubbles at low zoom. */
function GroupedMarkers({
  markers,
  idleMarkers,
  selectedId,
  nowMs,
  onMarkerClick,
  onZoomIn,
  paddingTop,
  paddingBottom,
}: FitPadding & {
  markers: SurplusMapMarker[];
  idleMarkers: IdleMapMarker[];
  selectedId: string | null;
  nowMs: number | null;
  onMarkerClick?: (id: string) => void;
  onZoomIn: (message: string) => void;
}) {
  const zoom = useZoom();
  const view = usePixelView(paddingTop);
  const { items, live, idle } = useMemo(() => {
    const points: ClusterPoint[] = [
      ...markers.map((m) => ({ id: m.id, lat: m.lat, lng: m.lng, live: true, area: m.area })),
      ...idleMarkers.map((m) => ({ id: m.id, lat: m.lat, lng: m.lng, live: false, area: m.area })),
    ];
    return {
      items: clusterPoints(points, zoom),
      live: new Map(markers.map((m) => [m.id, m])),
      idle: new Map(idleMarkers.map((m) => [m.id, m])),
    };
  }, [markers, idleMarkers, zoom]);
  // Re-placed on pan too, so a caption never runs off the edge of the map.
  const captions = useMemo(() => placeCaptions(items, zoom, view), [items, zoom, view]);

  return (
    <>
      {items.map((item) => {
        if (item.kind === "group") {
          return (
            <GroupMarker
              key={item.group.id}
              group={item.group}
              zoom={zoom}
              caption={captions.get(item.group.id)}
              onZoomIn={onZoomIn}
              paddingTop={paddingTop}
              paddingBottom={paddingBottom}
            />
          );
        }
        const id = item.point.id;
        const pin = live.get(id);
        if (pin) {
          return (
            <SurplusPinMarker key={id} marker={pin} selected={id === selectedId} nowMs={nowMs} onClick={onMarkerClick} />
          );
        }
        const idleMarker = idle.get(id);
        return idleMarker ? (
          <IdleMarker key={id} marker={idleMarker} selected={id === selectedId} onClick={onMarkerClick} />
        ) : null;
      })}
    </>
  );
}

export default function SurplusMapInner({
  center,
  radiusM,
  markers,
  idleMarkers = NO_IDLE,
  groupMarkers = false,
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
  /** Announced to screen readers when a group bubble zooms the map in. */
  const [announcement, setAnnouncement] = useState("");
  const selected =
    markers.find((m) => m.id === selectedId) ?? idleMarkers.find((m) => m.id === selectedId) ?? null;
  const allBounds = useMemo(
    () => (radiusM === null ? boundsOfPoints([...markers, ...idleMarkers]) : null),
    [radiusM, markers, idleMarkers],
  );
  const padding = { paddingTop: fitPaddingTop, paddingBottom: fitPaddingBottom };
  const initial =
    radiusM === null
      ? INDONESIA_VIEW
      : { center: [center.lat, center.lng] as [number, number], zoom: zoomForRadius(radiusM) };

  return (
    <div className={cn("relative isolate h-full w-full overflow-hidden", className)}>
      <MapContainer
        center={initial.center}
        zoom={initial.zoom}
        // Fractional zoom so fitBounds can make the radius circle fill a phone screen.
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={120}
        zoomControl={false}
        attributionControl
        className="h-full w-full"
        style={{ minHeight: 240 }}
      >
        <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} />
        {radiusM !== null && (
          <Circle
            center={[center.lat, center.lng]}
            radius={radiusM}
            // className must be a constructor option: react-leaflet applies pathOptions with setStyle(), which skips it.
            className="ss-radius"
            pathOptions={{ weight: 2, dashArray: "6 6" }}
            interactive={false}
          />
        )}
        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={USER_ICON}
            interactive={false}
            keyboard={false}
            zIndexOffset={-100}
          />
        )}
        {groupMarkers ? (
          <GroupedMarkers
            markers={markers}
            idleMarkers={idleMarkers}
            selectedId={selectedId}
            nowMs={nowMs}
            onMarkerClick={onMarkerClick}
            onZoomIn={setAnnouncement}
            {...padding}
          />
        ) : (
          <>
            {idleMarkers.map((m) => (
              <IdleMarker key={m.id} marker={m} selected={m.id === selectedId} onClick={onMarkerClick} />
            ))}
            {markers.map((m) => (
              <SurplusPinMarker
                key={m.id}
                marker={m}
                selected={m.id === selectedId}
                nowMs={nowMs}
                onClick={onMarkerClick}
              />
            ))}
          </>
        )}
        {radiusM !== null ? (
          <FitToRadius center={center} radiusM={radiusM} fitKey={fitKey} {...padding} />
        ) : (
          <FitToBounds bounds={allBounds} fitKey={fitKey} {...padding} />
        )}
        <KeepSelectedVisible point={selected} />
      </MapContainer>

      {showRecenter && (
        <button
          type="button"
          onClick={() => setFitKey((k) => k + 1)}
          className="absolute right-3 z-[500] inline-flex size-11 items-center justify-center rounded-full bg-card text-foreground shadow-float ring-1 ring-border transition-transform outline-none active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50"
          style={{ bottom: fitPaddingBottom + 12 }}
          aria-label={radiusM === null ? "Tampilkan semua warung di peta" : "Pusatkan peta ke radius pencarian"}
          title={radiusM === null ? "Lihat semua warung" : "Pusatkan ke radius"}
        >
          {/* The crosshair only where the button recentres on a location; the nationwide refit is "see all". */}
          {radiusM === null ? (
            <Maximize2Icon className="size-5 text-primary" aria-hidden />
          ) : (
            <LocateFixedIcon className="size-5 text-primary" aria-hidden />
          )}
        </button>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
