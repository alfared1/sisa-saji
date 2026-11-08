/**
 * Service worker helpers (browser only).
 * The SW registers automatically in production, or in development when
 * NEXT_PUBLIC_ENABLE_SW=true. Enabling push registers it on demand.
 */
export const SW_URL = "/sw.js";

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export function isServiceWorkerAutoEnabled(): boolean {
  return process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
  } catch {
    return null;
  }
}

/** Existing registration, or a fresh one (needed before PushManager.subscribe). */
export async function getOrRegisterServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  const reg = await registerServiceWorker();
  if (!reg) return null;
  return navigator.serviceWorker.ready;
}
