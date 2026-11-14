"use client";

/**
 * "Notifikasi Jam Lapar" on this device: at most one push per WIB night when a warung within
 * HUNGER_ALERT_RADIUS_M of the chosen point (kos, campus) opens its night discount.
 *
 * The server knows the device by its push subscription, so the status is read with the
 * existing subscription's endpoint (none yet → off). Enabling reuses
 * usePushNotifications().ensureSubscription() (permission, subscribe, location-push), then
 * PUT /push/hunger-alert. "Nanti saja" is remembered per browser in localStorage only.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api/client";
import { HUNGER_ALERT_RADIUS_M } from "@/lib/constants";
import type { HungerAlertBody, HungerAlertEndpointBody, HungerAlertResponse } from "@/lib/contracts";
import { getClientId } from "@/lib/pwa/client-id";
import { getExistingPushSubscription, toSubscriptionInput } from "@/lib/pwa/push";
import { readLocal, writeLocal } from "@/lib/pwa/storage";
import { usePushNotifications } from "./use-push-notifications";

export const hungerAlertKey = ["push", "hunger-alert"] as const;

const DISMISS_KEY = "ss-hunger-dismissed";
const OFF: HungerAlertResponse = { enabled: false, label: null, radius_m: HUNGER_ALERT_RADIUS_M };

/* "Nanti saja": one shared flag for every mounted banner/hook in this tab. */
const dismissListeners = new Set<() => void>();
function readDismissed(): boolean {
  try {
    return readLocal(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
function subscribeDismissed(cb: () => void) {
  dismissListeners.add(cb);
  return () => {
    dismissListeners.delete(cb);
  };
}
function setDismissed(value: boolean) {
  try {
    writeLocal(DISMISS_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked (private mode): the banner simply comes back next visit.
  }
  dismissListeners.forEach((cb) => cb());
}

async function currentEndpoint(): Promise<string | null> {
  const sub = await getExistingPushSubscription();
  return sub?.endpoint ?? null;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? err.message : fallback;
}

export type HungerAlertPoint = { lat: number; lng: number; label: string };

export function useHungerAlert() {
  const push = usePushNotifications();
  const qc = useQueryClient();
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => false);

  const status = useQuery({
    queryKey: hungerAlertKey,
    enabled: push.supported,
    staleTime: 60_000,
    queryFn: async (): Promise<HungerAlertResponse> => {
      const endpoint = await currentEndpoint();
      if (!endpoint) return OFF;
      const body: HungerAlertEndpointBody = { endpoint };
      return api.post<HungerAlertResponse>("/push/hunger-alert/status", body);
    },
  });

  const enable = useMutation({
    mutationFn: async (point: HungerAlertPoint): Promise<HungerAlertResponse | null> => {
      const subscription = await push.ensureSubscription();
      if (!subscription) return null;
      const body: HungerAlertBody = {
        client_id: getClientId(),
        webpush_subscription: subscription,
        enabled: true,
        lat: point.lat,
        lng: point.lng,
        label: point.label.slice(0, 80),
      };
      return api.put<HungerAlertResponse>("/push/hunger-alert", body);
    },
    onSuccess: (res) => {
      if (!res) return;
      qc.setQueryData(hungerAlertKey, res);
      toast.success("Notifikasi Jam Lapar aktif", {
        description: `Sekali semalam, saat warung dalam ${res.radius_m} m buka diskon malam.`,
      });
    },
    onError: (err) => toast.error(errorText(err, "Gagal menyalakan Notifikasi Jam Lapar.")),
  });

  const disable = useMutation({
    mutationFn: async (): Promise<HungerAlertResponse> => {
      const sub = await getExistingPushSubscription();
      const input = sub ? toSubscriptionInput(sub) : null;
      if (!input) return OFF;
      const body: HungerAlertBody = { client_id: getClientId(), webpush_subscription: input, enabled: false };
      return api.put<HungerAlertResponse>("/push/hunger-alert", body);
    },
    onSuccess: (res) => {
      qc.setQueryData(hungerAlertKey, res);
      toast.success("Notifikasi Jam Lapar dimatikan");
    },
    onError: (err) => toast.error(errorText(err, "Gagal mematikan Notifikasi Jam Lapar.")),
  });

  const sendTest = useMutation({
    mutationFn: async (): Promise<{ delivered: boolean }> => {
      const endpoint = await currentEndpoint();
      if (!endpoint) throw new Error("Aktifkan notifikasi di perangkat ini dulu.");
      const body: HungerAlertEndpointBody = { endpoint };
      return api.post<{ delivered: boolean }>("/push/hunger-alert/test", body);
    },
    onSuccess: (res) => {
      if (res.delivered) toast.success("Contoh notifikasi dikirim. Cek notifikasi di perangkat ini.");
      else toast.error("Contoh notifikasi belum sampai. Coba matikan lalu aktifkan lagi.");
    },
    onError: (err) =>
      toast.error(err instanceof ApiClientError || err instanceof Error ? err.message : "Gagal mengirim contoh notifikasi."),
  });

  const dismiss = useCallback(() => setDismissed(true), []);

  const enabled = status.data?.enabled ?? false;
  return {
    supported: push.supported,
    permission: push.permission,
    /** Server status is known (or push is unsupported, which means off). */
    ready: !push.supported || status.isSuccess || status.isError,
    enabled,
    label: status.data?.label ?? null,
    radiusM: status.data?.radius_m ?? HUNGER_ALERT_RADIUS_M,
    dismissed,
    dismiss,
    enable,
    disable,
    sendTest,
  };
}
