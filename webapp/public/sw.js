/* Fire Break Calculator — service worker (runtime caching for field/offline use)
 *
 * No build-time precache manifest (keeps the build tooling simple); instead we
 * cache at runtime so the app, its assets, the map tiles a crew has already
 * viewed, and the equipment list remain available with no signal.
 *
 * Strategies:
 *   - navigations                → network-first, fall back to cached app shell
 *   - same-origin static assets  → stale-while-revalidate
 *   - Mapbox styles/tiles        → cache-first, capped LRU-ish trim
 *   - /api/equipment (GET)       → stale-while-revalidate (usable offline)
 *   - other /api + veg/elevation → network-first, cache fallback
 */

const VERSION = 'v1';
const SHELL_CACHE = `fbc-shell-${VERSION}`;
const ASSET_CACHE = `fbc-assets-${VERSION}`;
const TILE_CACHE = `fbc-tiles-${VERSION}`;
const API_CACHE = `fbc-api-${VERSION}`;
const TILE_MAX_ENTRIES = 600;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(['/', '/index.html'])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.endsWith(`-${VERSION}`) === false && k.startsWith('fbc-'))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // Delete oldest ~10% to avoid trimming on every insert.
  const toDelete = keys.slice(0, Math.max(1, keys.length - maxEntries));
  await Promise.all(toDelete.map((k) => cache.delete(k)));
}

function isMapboxTile(url) {
  return /(^|\.)mapbox\.com$/.test(url.hostname) || url.hostname.includes('tiles.mapbox');
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((resp) => {
      if (resp && resp.ok) cache.put(request, resp.clone());
      return resp;
    })
    .catch(() => cached);
  return cached || network;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline and uncached');
  }
}

async function cacheFirstTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  // Cache opaque (cross-origin) responses too so tiles work offline.
  if (resp && (resp.ok || resp.type === 'opaque')) {
    cache.put(request, resp.clone());
    trimCache(TILE_CACHE, TILE_MAX_ENTRIES);
  }
  return resp;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // App navigations → network-first with app-shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Mapbox styles/tiles/fonts/sprites → cache-first (already-viewed areas offline).
  if (isMapboxTile(url)) {
    event.respondWith(cacheFirstTile(request).catch(() => caches.match(request)));
    return;
  }

  // Equipment list → stale-while-revalidate so it's available offline.
  if (url.pathname.startsWith('/api/equipment')) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // Other API + external data services → network-first, cache fallback.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('environment.nsw.gov.au') || url.hostname.includes('environment.gov.au')) {
    event.respondWith(networkFirst(request, API_CACHE).catch(() => caches.match(request)));
    return;
  }

  // Same-origin static assets → stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }
});
