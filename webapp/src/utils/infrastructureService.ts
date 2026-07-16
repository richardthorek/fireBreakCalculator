/**
 * Existing-infrastructure lookup for the route optimizer (OpenStreetMap via
 * the Overpass API).
 *
 * Fetches mapped trails, tracks and minor roads inside a corridor bounding box
 * so the optimizer can treat already-broken ground as cheap to reuse. Failure
 * is graceful and explicit: when Overpass is unreachable the optimizer runs on
 * terrain and fuel alone and the result says infrastructure data was
 * unavailable — absence of data is never presented as absence of trails.
 *
 * OSM completeness varies in remote areas; consumers must label reused trails
 * as "mapped trail — verify trafficability" (see docs/ROUTE_INTELLIGENCE.md).
 *
 * Resilience: FIRST we try our own backend proxy (`GET /api/infrastructure`),
 * which runs the Overpass query server-side. This is the primary path in a
 * real deployment because the public Overpass instances do NOT send
 * `Access-Control-Allow-Origin` on their error/rate-limited responses, so a
 * browser call that hits a 429/504/timeout is surfaced as an opaque CORS
 * failure and the whole trail lookup dies (field-reported 2026-07-16) — which
 * silently disables both the trail-reuse discount and the snap-to-trail path
 * refinement. The server→Overpass hop has no CORS, and one server IP with a
 * shared cache spends the public 2-slot-per-IP quota once per corridor rather
 * than once per user.
 *
 * If the proxy is unreachable (offline/local-dev deployments without the API),
 * we fall back to calling the public Overpass instances DIRECTLY: the
 * `overpass-api.de` primary enforces a strict 2 concurrent-slot-per-IP quota
 * and is intermittently flaky (transient `406`s with no rate-limit signal), so
 * the direct path fails over through a short list of public mirrors and
 * remembers whichever last worked so subsequent legs skip a struggling primary
 * (confirmed live 2026-07-12: `maps.mail.ru` returns byte-identical results;
 * `overpass.kumi.systems` is IPv6-only). Either way, absence of data is never
 * presented as absence of trails.
 */

import { LatLng } from './chainage';
import { logger } from './logger';

export interface InfrastructureTrail {
  name?: string;
  /** OSM highway/waterway value, e.g. "track", "path", "service". */
  kind: string;
  coords: LatLng[];
}

export interface InfrastructureData {
  trails: InfrastructureTrail[];
  /** True when the query succeeded (so zero trails means genuinely none mapped). */
  available: boolean;
}

/**
 * A synchronous, zero-network trail source — the Mapbox vector tiles already
 * loaded on the map (see mapboxTrails.ts). Registered by the map layer and
 * consulted BEFORE any network call, so a corridor whose road tiles are already
 * loaded resolves instantly and offline. Returns null when it can't answer for
 * this bbox (source/tiles not loaded), so we fall through to the proxy/direct
 * path to disambiguate "no roads" from "not loaded". Defaults to unset →
 * behaviour is exactly the network path (used by tests and non-map callers).
 */
export type LocalTrailProvider = (
  south: number, west: number, north: number, east: number
) => InfrastructureTrail[] | null;

let localTrailProvider: LocalTrailProvider | null = null;
export function setLocalTrailProvider(provider: LocalTrailProvider | null): void {
  localTrailProvider = provider;
}

const env = (import.meta as any).env ?? {};

/** Our own backend Overpass proxy — same-origin, so no CORS, with a shared
 *  server-side cache. Primary path; the direct endpoints below are the
 *  fallback when this isn't deployed. */
const apiBase = (env.VITE_API_BASE_URL as string | undefined) || '/api';
const infraProxyUrl = (s: number, w: number, n: number, e: number) =>
  `${apiBase}/infrastructure?s=${s}&w=${w}&n=${n}&e=${e}`;
/** Set false after the proxy 404s once (endpoint not deployed) so we don't
 *  re-probe it on every leg of a run — go straight to the direct endpoints. */
let proxyAvailable = true;

/** Endpoints tried in order; a working one is remembered across calls this
 *  session so later legs don't re-pay the cost of a rate-limited primary. */
const OVERPASS_ENDPOINTS: string[] = env.VITE_OVERPASS_URLS
  ? String(env.VITE_OVERPASS_URLS).split(',').map((s: string) => s.trim()).filter(Boolean)
  : [
      'https://overpass-api.de/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ];

/** Per-attempt timeout — deliberately shorter than the old single-endpoint
 *  15s so a stuck/overloaded mirror doesn't eat the whole query budget. */
const FETCH_TIMEOUT_MS = 10000;

/** Index of the endpoint that last succeeded; tried first on the next call. */
let preferredEndpointIndex = 0;

/** Highway classes that represent reusable broken ground for a fire break. */
const REUSABLE_HIGHWAYS = 'track|path|service|unclassified|road|tertiary|secondary|residential';

// Cache per rounded bbox so repeated optimizations of the same corridor are free.
const bboxCache = new Map<string, InfrastructureData>();

// In-flight requests per bbox: the optimizer prefetches every leg's corridor
// at the start of a run while each leg later asks for its own — without this,
// those two callers would race past the (success-only) result cache and issue
// the same Overpass query twice, wasting the strict per-IP slot quota.
const bboxInFlight = new Map<string, Promise<InfrastructureData>>();

const bboxKey = (s: number, w: number, n: number, e: number) =>
  [s, w, n, e].map(v => v.toFixed(3)).join(',');

/** One attempt against a single Overpass endpoint. Throws on any failure
 *  (non-2xx status, network error, timeout) — never a silent empty result,
 *  so the caller can distinguish "no trails here" from "couldn't ask". */
async function queryEndpoint(url: string, query: string, signal?: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status} from ${new URL(url).host}`);
    return await resp.json();
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Fetch reusable trails/roads within a bounding box (south, west, north, east).
 * Tries each configured Overpass endpoint in turn (starting from whichever
 * last succeeded), moving on immediately on a transient failure — a
 * rate-limited or flaky mirror is not worth retrying locally, it just wastes
 * the query budget for this leg. Returns `{ available: false }` only after
 * every endpoint has failed; never throws.
 */
export async function fetchCorridorInfrastructure(
  south: number,
  west: number,
  north: number,
  east: number,
  signal?: AbortSignal
): Promise<InfrastructureData> {
  // Zero-network first: the Mapbox road tiles already on the map (same OSM
  // lineage as Overpass, CORS-clean, available offline once cached). Only a
  // NON-EMPTY result is trusted — an empty set can't tell "no roads" from
  // "tiles not loaded", so that case falls through to the network below. Not
  // cached here: it's synchronous and free to recompute, and caching a partial
  // (few-tiles-loaded) answer would lock it in for the session.
  if (localTrailProvider) {
    try {
      const local = localTrailProvider(south, west, north, east);
      if (local && local.length > 0) {
        logger.debug(`Corridor trails from Mapbox tiles: ${local.length} ways`);
        return { trails: local, available: true };
      }
    } catch (e) {
      logger.warn('Local (Mapbox) trail provider failed, falling back to network', e);
    }
  }

  const key = bboxKey(south, west, north, east);
  const cached = bboxCache.get(key);
  if (cached) return cached;
  const inFlight = bboxInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = fetchCorridorUncached(south, west, north, east, key, signal);
  bboxInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    bboxInFlight.delete(key);
  }
}

async function fetchCorridorUncached(
  south: number,
  west: number,
  north: number,
  east: number,
  key: string,
  signal?: AbortSignal
): Promise<InfrastructureData> {
  // Primary: our own backend proxy (same-origin → no CORS, shared cache). Only
  // a genuine "not deployed" signal (404) disables it for the rest of the
  // session; a 502 means the proxy reached Overpass and Overpass failed, so we
  // fall through to the direct endpoints for this call but keep using the proxy
  // next time (its cache/quota-pooling is still the better primary).
  if (proxyAvailable) {
    try {
      const resp = await fetch(infraProxyUrl(south, west, north, east), { signal });
      if (resp.status === 404) {
        proxyAvailable = false; // endpoint not present in this deployment
      } else if (resp.ok) {
        const json = await resp.json();
        const data: InfrastructureData = {
          trails: Array.isArray(json?.trails) ? json.trails : [],
          available: true,
        };
        bboxCache.set(key, data);
        logger.debug(`Overpass corridor via API proxy: ${data.trails.length} reusable ways`);
        return data;
      }
      // Other non-OK (e.g. 502 upstream, 429 rate limit) → try direct below.
    } catch (e) {
      // Network error reaching our own origin — unusual; fall through.
      logger.warn('Infrastructure API proxy unreachable, trying Overpass directly', e);
    }
  }

  const query = `[out:json][timeout:12];way["highway"~"^(${REUSABLE_HIGHWAYS})$"](${south},${west},${north},${east});out geom;`;

  const order = [
    ...OVERPASS_ENDPOINTS.slice(preferredEndpointIndex),
    ...OVERPASS_ENDPOINTS.slice(0, preferredEndpointIndex),
  ];

  let lastError: unknown;
  for (const url of order) {
    if (signal?.aborted) break;
    try {
      const json = await queryEndpoint(url, query, signal);
      const trails: InfrastructureTrail[] = (json?.elements ?? [])
        .filter((el: any) => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
        .map((el: any) => ({
          name: el.tags?.name,
          kind: el.tags?.highway ?? 'track',
          coords: el.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon })),
        }));

      const data: InfrastructureData = { trails, available: true };
      bboxCache.set(key, data);
      preferredEndpointIndex = OVERPASS_ENDPOINTS.indexOf(url);
      logger.debug(`Overpass corridor query via ${new URL(url).host}: ${trails.length} reusable ways`);
      return data;
    } catch (e) {
      lastError = e;
      logger.warn(`Overpass endpoint failed (${new URL(url).host}), trying next`, e);
    }
  }

  // Do NOT cache failures — a later attempt (different endpoint order, or
  // the primary's quota having refreshed) may succeed.
  logger.warn('All Overpass endpoints failed; optimizing on terrain/fuel only', lastError);
  return { trails: [], available: false };
}

/**
 * Minimum planar distance (metres) from a point to any trail polyline.
 * Fine at corridor scale; returns Infinity when there are no trails.
 *
 * `earlyExitThreshold`: both call sites (routeOptimizer.ts) only need to know
 * "is this point within TRAIL_SNAP_M of a trail", not the exact minimum —
 * passing that threshold here lets the scan stop the moment it finds a
 * close-enough segment instead of checking every remaining vertex of every
 * remaining trail. This matters at scale: a wide-corridor optimizer pass can
 * call this once per hex cell (hundreds) against every OSM way Overpass
 * returned for the bbox (which can itself have thousands of vertices).
 */
export function distanceToNearestTrail(point: LatLng, trails: InfrastructureTrail[], earlyExitThreshold = 0): number {
  let best = Infinity;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((point.lat * Math.PI) / 180);
  for (const trail of trails) {
    const c = trail.coords;
    for (let i = 1; i < c.length; i++) {
      const ax = (c[i - 1].lng - point.lng) * mPerDegLng;
      const ay = (c[i - 1].lat - point.lat) * mPerDegLat;
      const bx = (c[i].lng - point.lng) * mPerDegLng;
      const by = (c[i].lat - point.lat) * mPerDegLat;
      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? -(ax * dx + ay * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) {
        best = d;
        if (best <= earlyExitThreshold) return best;
      }
    }
  }
  return best;
}

/** Clear the bbox cache (tests). */
export function _clearInfrastructureCache() {
  bboxCache.clear();
  proxyAvailable = true;
}
