"use client";

/**
 * Web Push opt-in: GET /push/public-key → Notification permission →
 * PushManager.subscribe (VAPID) → PUT /profile/location-push with the
 * subscription + current location + client_id.
 *
 * `ensureSubscription` does the same without the success toast and returns the
 * subscription, so "Notifikasi Jam Lapar" (use-hunger-alert.ts) can reuse it.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, ApiClientError } from "@/lib/api/client";
import type {
  LocationPushBody,
  LocationPushResponse,
  PushPublicKeyResponse,
  WebPushSubscriptionInput,
} from "@/lib/contracts";
import { getClientId } from "@/lib/pwa/client-id";
import {
  getExistingPushSubscription,
  isPushSupported,
  notificationPermission,
  toSubscriptionInput,
  urlBase64ToUint8Array,
} from "@/lib/pwa/push";
import { getOrRegisterServiceWorker } from "@/lib/pwa/sw";
import { useLocationStore } from "@/stores/location";

export type PushPermission = NotificationPermission | "unsupported";

const noopSubscribe = () => () => {};

export function usePushNotifications() {
  // Browser capabilities: false / "default" on the server and during hydration.
  const supported = useSyncExternalStore(noopSubscribe, isPushSupported, () => false);
  const initialPermission = useSyncExternalStore<PushPermission>(noopSubscribe, notificationPermission, () => "default");
  const [permissionOverride, setPermission] = useState<PushPermission | null>(null);
  const permission = permissionOverride ?? initialPermission;
  const [subscribed, setSubscribed] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void getExistingPushSubscription().then((s) => {
      if (!cancelled) setSubscribed(Boolean(s));
    });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  /** Permission + push subscription + location-push registration. Errors are toasted; null on failure. */
  const ensureSubscription = useCallback(async (): Promise<WebPushSubscriptionInput | null> => {
    if (!isPushSupported()) {
      toast.error("Browser ini belum mendukung notifikasi push. Coba pasang aplikasinya dulu.");
      return null;
    }
    setIsSubscribing(true);
    try {
      const { public_key } = await api.get<PushPublicKeyResponse>("/push/public-key");
      if (!public_key) {
        toast.error("Notifikasi belum diaktifkan di server.");
        return null;
      }
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        toast.message("Notifikasi tidak diizinkan", {
          description: "Kamu bisa mengaktifkannya lagi dari pengaturan browser.",
        });
        return null;
      }
      const reg = await getOrRegisterServiceWorker();
      if (!reg) {
        toast.error("Service worker tidak tersedia, notifikasi tidak bisa diaktifkan.");
        return null;
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(public_key),
        }));
      const input = toSubscriptionInput(sub);
      if (!input) throw new Error("Langganan push tidak valid");

      const { lat, lng } = useLocationStore.getState();
      const body: LocationPushBody = { client_id: getClientId(), lat, lng, webpush_subscription: input };
      await api.put<LocationPushResponse>("/profile/location-push", body);
      setSubscribed(true);
      return input;
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Gagal mengaktifkan notifikasi.";
      toast.error(msg);
      return null;
    } finally {
      setIsSubscribing(false);
    }
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    const input = await ensureSubscription();
    if (input) toast.success("Notifikasi aktif! Kami kabari saat ada diskon malam di dekatmu.");
    return input !== null;
  }, [ensureSubscription]);

  return { supported, permission, subscribed, isSubscribing, subscribe, ensureSubscription };
}
