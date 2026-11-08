/* Sisa-Saji service worker (hand-written, no build step).
 *
 * Caches:
 *   shell   – precached "/", "/offline", "/discover"
 *   pages   – HTML of visited pages (network-first fallback)
 *   static  – /_next/static, fonts, icons (cache-first; content-hashed;
 *             capped at MAX_STATIC_ENTRIES, oldest first out)
 *   tickets – GET /api/v1/orders/<id> (network-first) so an active pickup
 *             ticket opens offline
 * Every other /api request goes straight to the network and is never cached.
 *
 * Versioning: the app registers /sw.js?v=<build id>. shell/pages/static are
 * named after that build, so each deploy installs a new worker and activate()
 * purges the previous build's caches. Tickets keep a stable name so a pickup
 * ticket survives a deploy. Bump SW_VERSION to invalidate everything.
 *
 * Logout: the page posts {type:"CLEAR_PRIVATE"} (and deletes the caches
 * itself) so no previous user's ticket or page stays on a shared phone.
 *
 * Update flow: a new worker waits until the page posts {type:"SKIP_WAITING"}
 * (the app shows a "Muat ulang" toast); the very first install activates at once.
 */
const SW_VERSION = "v1";
const SW_BUILD = (new URL(self.location.href).searchParams.get("v") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
const BUILD_TAG = SW_BUILD ? `${SW_VERSION}-${SW_BUILD}` : SW_VERSION;
const CACHE = {
  shell: `ss-shell-${BUILD_TAG}`,
  pages: `ss-pages-${BUILD_TAG}`,
  static: `ss-static-${BUILD_TAG}`,
  tickets: `ss-tickets-${SW_VERSION}`,
};
const PRIVATE_CACHE_PREFIXES = ["ss-tickets-", "ss-pages-"];
const PRECACHE_URLS = ["/", "/offline", "/discover"];
const OFFLINE_URL = "/offline";
const MAX_PAGE_ENTRIES = 40;
const MAX_TICKET_ENTRIES = 20;
const MAX_STATIC_ENTRIES = 150;
const ORDER_DETAIL_RE = /^\/api\/v1\/orders\/[0-9a-f-]{36}$/i;
/** /_next/static asset paths referenced in page HTML (script/link tags and the inline RSC payload). */
const STATIC_ASSET_RE = /\/_next\/static\/[A-Za-z0-9_\-./~%]+\.(?:js|css|woff2?)/g;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE.shell);
      const assets = new Set();
      // One failing URL must not abort the whole install.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(new Request(url, { cache: "reload", credentials: "same-origin" }));
            if (!res.ok) return;
            const html = await res.clone().text();
            for (const m of html.matchAll(STATIC_ASSET_RE)) assets.add(m[0]);
            await cache.put(url, res);
          } catch {
            /* offline during install: cached on a later visit */
          }
        }),
      );
      // Also cache the JS/CSS/fonts those pages need, so /offline hydrates without network.
      const staticCache = await caches.open(CACHE.static);
      await Promise.all(
        [...assets].map(async (path) => {
          try {
            if (await staticCache.match(path)) return;
            const res = await fetch(path, { credentials: "same-origin" });
            if (res.ok) await staticCache.put(path, res);
          } catch {
            /* best effort */
          }
        }),
      );
      await trimCache(CACHE.static, MAX_STATIC_ENTRIES);
      // First install: no older worker to replace, activate immediately.
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(Object.values(CACHE));
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("ss-") && !keep.has(n)).map((n) => caches.delete(n)));
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          /* unsupported */
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
  else if (type === "GET_VERSION" && event.ports[0]) event.ports[0].postMessage({ version: BUILD_TAG });
  else if (type === "CLEAR_PRIVATE") {
    // Logout: drop every user-scoped copy (tickets with name/phone/pickup code/QR, page HTML).
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names.filter((n) => PRIVATE_CACHE_PREFIXES.some((p) => n.startsWith(p))).map((n) => caches.delete(n)),
        );
        if (event.ports[0]) event.ports[0].postMessage({ ok: true });
      })(),
    );
  }
});

/* ------------------------------------------------------------------ */
/* Fetch routing                                                       */
/* ------------------------------------------------------------------ */

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never touch React Server Component payloads or dev tooling.
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;
  if (url.pathname.startsWith("/_next/webpack-hmr") || url.pathname.startsWith("/__nextjs")) return;

  if (url.pathname.startsWith("/api/")) {
    if (ORDER_DETAIL_RE.test(url.pathname)) event.respondWith(networkFirstTicket(req));
    return; // all other API calls: network only
  }

  if (req.mode === "navigate") {
    event.respondWith(navigationHandler(event));
    return;
  }

  if (isStaticAsset(url)) event.respondWith(cacheFirst(req, CACHE.static));
});

function isStaticAsset(url) {
  const p = url.pathname;
  return (
    p.startsWith("/_next/static/") ||
    p.startsWith("/icons/") ||
    p === "/icon" ||
    p === "/apple-icon" ||
    p === "/manifest.webmanifest" ||
    /\.(?:woff2?|ttf|otf|png|jpe?g|webp|avif|svg|ico)$/i.test(p)
  );
}

async function navigationHandler(event) {
  const req = event.request;
  try {
    const preloaded = await event.preloadResponse;
    const res = preloaded || (await fetch(req));
    if (res && res.ok && res.type === "basic") {
      const copy = res.clone();
      event.waitUntil(putAndTrim(CACHE.pages, req, copy, MAX_PAGE_ENTRIES));
    }
    return res;
  } catch {
    const cached =
      (await caches.match(req, { cacheName: CACHE.pages })) ||
      (await caches.match(req, { cacheName: CACHE.shell })) ||
      (await caches.match(req, { ignoreSearch: true }));
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response("Kamu sedang offline.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok && (res.type === "basic" || res.type === "default")) {
      // Content-hashed chunks pile up across deploys: keep the cache bounded.
      await putAndTrim(cacheName, req, res.clone(), MAX_STATIC_ENTRIES);
    }
    return res;
  } catch {
    return new Response("", { status: 504 });
  }
}

async function networkFirstTicket(req) {
  try {
    const res = await fetch(req);
    if (res.ok) await putAndTrim(CACHE.tickets, req, res.clone(), MAX_TICKET_ENTRIES);
    else if (res.status === 401 || res.status === 403 || res.status === 404) {
      // Logged out / not yours / gone: drop any stale offline copy.
      const cache = await caches.open(CACHE.tickets);
      await cache.delete(req);
    }
    return res;
  } catch {
    const cached = await caches.match(req, { cacheName: CACHE.tickets });
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("x-sisasaji-offline", "1");
      return new Response(await cached.blob(), { status: cached.status, headers });
    }
    return Response.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Kamu sedang offline dan tiket ini belum tersimpan." } },
      { status: 503 },
    );
  }
}

async function putAndTrim(cacheName, req, res, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(req, res);
    await trimCache(cacheName, maxEntries);
  } catch {
    /* quota exceeded etc. */
  }
}

/** Deletes the oldest entries (insertion order) beyond `maxEntries`. */
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
  } catch {
    /* best effort */
  }
}

/* ------------------------------------------------------------------ */
/* Web Push                                                            */
/* ------------------------------------------------------------------ */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Sisa-Saji";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/discover";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Ada surplus makanan baru di sekitarmu.",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      lang: "id",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      const sameOrigin = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (sameOrigin && "navigate" in sameOrigin) {
        await sameOrigin.focus();
        return sameOrigin.navigate(target);
      }
      return self.clients.openWindow(target);
    })(),
  );
});
