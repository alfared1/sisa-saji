"use client";

/**
 * <LocationPickerMap value onChange /> — draggable pin (tap the map to move it)
 * + "Gunakan lokasi saya", for merchant onboarding / profile.
 */
import dynamic from "next/dynamic";
import { MapLoading } from "./surplus-map";
import type { LocationPickerMapProps } from "./location-picker-map-inner";

export type { LocationPickerMapProps } from "./location-picker-map-inner";

const Inner = dynamic(() => import("./location-picker-map-inner"), {
  ssr: false,
  loading: () => <MapLoading className="h-72 rounded-2xl" />,
});

export function LocationPickerMap(props: LocationPickerMapProps) {
  return <Inner {...props} />;
}
