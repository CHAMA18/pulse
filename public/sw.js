/* eslint-disable */
/* ------------------------------------------------------------------ */
/* Pulse service worker — the offline app shell                        */
/* ------------------------------------------------------------------ */
/* Keeps the portal usable without a network: documents and Next.js    */
/* build assets are cached as they are visited, and an offline page    */
/* is precached at install. Firebase and other cross-origin APIs are   */
/* never intercepted — the app handles those with its own outbox.      */

const VERSION = "v4";
const SHELL_CACHE = `pulse-shell-${VERSION}`;
const ASSET_CACHE = `pulse-assets-${VERSION}`;
const PAGE_CACHE = `pulse-pages-${VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, PAGE_CACHE]);
const CACHE_PREFIX = "pulse-";

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
const OFFLINE_URLS = [scopeUrl("offline"), scopeUrl("offline/")];
/** Every static route the app can cold-start from while offline. */
const APP_ROUTE_PATHS = [
  "",
  "pharmacy",
  "dashboard",
  "login",
  "auth",
  "auth/register",
  "offline",
];
const PRECACHE_URLS = [
  scopeUrl("manifest.webmanifest"),
  scopeUrl("brand/pulse-mark.png"),
  scopeUrl("brand/pulse-192.png"),
  scopeUrl("brand/pulse-512.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(new Request(url, { cache: "reload" }));
            if (response && response.ok) await shell.put(url, response);
          } catch {
            /* a missing optional asset must not fail the whole install */
          }
        })
      );

      // Cache each route's document plus the scripts/styles it references, so
      // a cold start works offline without visiting every page first.
      const pages = await caches.open(PAGE_CACHE);
      const assets = await caches.open(ASSET_CACHE);
      await Promise.all(
        APP_ROUTE_PATHS.map((path) =>
          precachePage(path, pages, assets).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(key))
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isAsset(url) {
  return (
    url.pathname.includes("/_next/static/") ||
    /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico|map)$/i.test(url.pathname)
  );
}

async function precachePage(path, pageCache, assetCache) {
  const pageUrl = scopeUrl(path);
  const response = await fetch(new Request(pageUrl, { cache: "reload" }));
  if (!response || !response.ok) return;

  const html = await response.clone().text();
  await pageCache.put(pageUrl, response.clone());
  // Static exports redirect "route" to "route/" — cache the final key too.
  if (response.url && response.url !== pageUrl) {
    await pageCache.put(response.url, response.clone());
  }

  const assetUrls = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g))
    .map((match) => match[1])
    .map((value) => {
      try {
        return new URL(value, pageUrl);
      } catch {
        return null;
      }
    })
    .filter((url) => url && url.origin === self.location.origin && isAsset(url));

  await Promise.all(
    assetUrls.map(async (url) => {
      try {
        if (await assetCache.match(url.href)) return;
        const asset = await fetch(new Request(url.href, { cache: "reload" }));
        if (asset && asset.ok) await assetCache.put(url.href, asset);
      } catch {
        /* optional assets can fail without blocking the install */
      }
    })
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, fallbackToOfflinePage) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    if (fallbackToOfflinePage) {
      for (const url of OFFLINE_URLS) {
        const page = await caches.match(url);
        if (page) return page;
      }
      return new Response(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Offline — Pulse</title></head><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#07030f;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px\"><main><h1 style=\"font-size:22px;margin:0 0 8px\">You&rsquo;re offline</h1><p style=\"margin:0;color:rgba(255,255,255,.7);max-width:22rem;line-height:1.6\">Pulse couldn&rsquo;t load the cached console. Reconnect and try again &mdash; your saved work is still on this device.</p></main></body></html>",
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    throw new Error("Network request failed and nothing was cached.");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGE_CACHE, true));
    return;
  }

  if (isAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // App Router navigations fetch RSC payloads — keep them available offline.
  if (url.searchParams.has("_rsc")) {
    event.respondWith(networkFirst(request, PAGE_CACHE, false));
  }
});
