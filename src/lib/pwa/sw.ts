/**
 * Service worker helpers (browser only).
 * The SW registers automatically in production, or in development when
 * NEXT_PUBLIC_ENABLE_SW=true. Enabling push registers it on demand.
 */
export const SW_URL = "/sw.js";

/**
 * Build id baked in at build time (next.config `env`). Registering
 * /sw.js?v=<build> makes every deploy a new worker — so the "Muat ulang"
 * prompt shows and activate() purges the previous build's page/static caches.
 */
const SW_BUILD = process.env.NEXT_PUBLIC_SW_BUILD ?? "";

export function serviceWorkerUrl(build: string = SW_BUILD): string {
  return build ? `${SW_URL}?v=${encodeURIComponent(build)}` : SW_URL;
}

/** Cache-name prefixes that hold user-specific data (pickup tickets, page HTML). */
export const PRIVATE_CACHE_PREFIXES = ["ss-tickets-", "ss-pages-"] as const;

export function isPrivateCacheName(name: string): boolean {
  return PRIVATE_CACHE_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Deletes every user-scoped SW cache (offline tickets with name, phone,
 * pickup code and QR token; cached pages). Runs on logout. Best effort.
 */
export async function clearPrivateCaches(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE" });
  } catch {
    /* no controller */
  }
  try {
    if (!("caches" in window)) return;
    const names = await caches.keys();
    await Promise.all(names.filter(isPrivateCacheName).map((n) => caches.delete(n)));
  } catch {
    /* storage blocked */
  }
}

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export function isServiceWorkerAutoEnabled(): boolean {
  return process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true";
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  try {
    return await navigator.serviceWorker.register(serviceWorkerUrl(), { scope: "/", updateViaCache: "none" });
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
