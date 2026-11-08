"use client";

/**
 * Browser geolocation → location store, with permission handling and a
 * graceful fallback to the campus location already in the store.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocationStore } from "@/stores/location";

export type GeoStatus = "idle" | "locating" | "granted" | "denied" | "unavailable" | "error";

export type UseGeolocationOptions = {
  /** Request automatically on mount when permission was already granted. */
  autoIfGranted?: boolean;
  /** Show toasts on failure (default true). */
  notify?: boolean;
};

const ERROR_COPY: Record<Exclude<GeoStatus, "idle" | "locating" | "granted">, string> = {
  denied: "Izin lokasi ditolak. Kami pakai lokasi kampus — kamu bisa ganti kapan saja.",
  unavailable: "Perangkat ini tidak mendukung GPS. Pilih lokasi kampus secara manual.",
  error: "Lokasi belum bisa didapat. Coba lagi atau pilih kampus terdekat.",
};

export function getCurrentPosition(timeoutMs = 10_000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 60_000,
    });
  });
}

export function useGeolocation({ autoIfGranted = false, notify = true }: UseGeolocationOptions = {}) {
  const setLocation = useLocationStore((s) => s.setLocation);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const inflight = useRef(false);

  const request = useCallback(async (): Promise<boolean> => {
    if (inflight.current) return false;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      if (notify) toast.error(ERROR_COPY.unavailable);
      return false;
    }
    inflight.current = true;
    setStatus("locating");
    try {
      const pos = await getCurrentPosition();
      setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: "gps" });
      setAccuracyM(Math.round(pos.coords.accuracy));
      setStatus("granted");
      return true;
    } catch (err) {
      const denied =
        typeof err === "object" && err !== null && "code" in err && (err as GeolocationPositionError).code === 1;
      const next: GeoStatus = denied ? "denied" : "error";
      setStatus(next);
      if (notify) toast.error(ERROR_COPY[next]);
      return false;
    } finally {
      inflight.current = false;
    }
  }, [notify, setLocation]);

  useEffect(() => {
    if (!autoIfGranted || typeof navigator === "undefined" || !navigator.permissions) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((p) => {
        if (cancelled) return;
        if (p.state === "granted") void request();
        else if (p.state === "denied") setStatus("denied");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [autoIfGranted, request]);

  return { status, accuracyM, request, isLocating: status === "locating" };
}
