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
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { polygon as turfPolygon } from '@turf/helpers';

export interface InfrastructureTrail {
  name?: string;
  /** OSM highway/waterway value, e.g. "track", "path", "service". */
  kind: string;
  coords: LatLng[];
  /** OSM `surface` tag, e.g. "gravel", "unpaved" — road-class speed model
   *  (terrain/roadSpeedModel.ts, docs §35). Undefined when untagged. */
  surface?: string;
  /** OSM `tracktype` tag, e.g. "grade3" — only meaningful on `highway=track`
   *  ways. Undefined when untagged. */
  tracktype?: string;
  /** OSM `smoothness` tag, e.g. "bad", "impassable". Undefined when untagged. */
  smoothness?: string;
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
const infraProxyUrl = (s: number, w: number, n: number, e: number, kind: InfrastructureKind = 'highway') =>
  `${apiBase}/infrastructure?s=${s}&w=${w}&n=${n}&e=${e}` + (kind === 'highway' ? '' : `&kind=${kind}`);
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

/** Highway classes for Terrain Mobility / counter-mobility (docs §35 —
 *  deliberately a SEPARATE, wider set from REUSABLE_HIGHWAYS rather than
 *  widening it: fire-break reuse and movement/denial planning genuinely want
 *  different answers to "which roads matter here". motorway/trunk/primary
 *  are excluded from the fire-break set (not realistically "reusable broken
 *  ground" to hand-clear alongside) but are exactly the highest-value roads
 *  to identify for an approaching force — the fastest way in is the one most
 *  worth being able to deny. MUST match the API's MOBILITY_HIGHWAYS. */
const MOBILITY_HIGHWAYS =
  'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|' +
  'tertiary|tertiary_link|unclassified|residential|living_street|service|track|path|road';

/** Waterway/water-body classes for the Terrain Mobility hydrology gate (docs
 *  §34) — MUST match the API's WATER_WATERWAYS/WATER_NATURAL so the proxy and
 *  the direct-Overpass fallback return the same set. */
const WATER_WATERWAYS = 'river|canal|stream';
const WATER_NATURAL = 'water';

export type InfrastructureKind = 'highway' | 'highway-mobility' | 'water';

// Cache per rounded bbox so repeated optimizations of the same corridor are free.
const bboxCache = new Map<string, InfrastructureData>();

// In-flight requests per bbox: the optimizer prefetches every leg's corridor
// at the start of a run while each leg later asks for its own — without this,
// those two callers would race past the (success-only) result cache and issue
// the same Overpass query twice, wasting the strict per-IP slot quota.
const bboxInFlight = new Map<string, Promise<InfrastructureData>>();

const bboxKey = (s: number, w: number, n: number, e: number, kind: InfrastructureKind) =>
  [kind, s, w, n, e].map(v => typeof v === 'number' ? v.toFixed(3) : v).join(',');

function buildQuery(kind: InfrastructureKind, s: number, w: number, n: number, e: number): string {
  if (kind === 'water') {
    return (
      `[out:json][timeout:12];` +
      `(way["waterway"~"^(${WATER_WATERWAYS})$"](${s},${w},${n},${e});` +
      `way["natural"="${WATER_NATURAL}"](${s},${w},${n},${e});` +
      // Multipolygon water bodies (docs §35, "OSM water relations" —
      // real, live-confirmed gap: Lake Tuggeranong and Gungahlin Pond, both
      // in the same Canberra region this project's own test scenarios live
      // in, are mapped as `relation` not `way`). MUST match the API's
      // identical addition — see `extractWaterRelationTrails`'s own doc
      // comment for how the response is parsed.
      `relation["natural"="${WATER_NATURAL}"](${s},${w},${n},${e}););` +
      `out geom;`
    );
  }
  const highways = kind === 'highway-mobility' ? MOBILITY_HIGHWAYS : REUSABLE_HIGHWAYS;
  return `[out:json][timeout:12];way["highway"~"^(${highways})$"](${s},${w},${n},${e});out geom;`;
}

/**
 * Multipolygon water bodies come back as `relation` elements, not `way` —
 * confirmed live via Overpass (docs §35 addendum, 2026-07-28): Overpass's
 * `out geom` inlines each member's own node geometry directly on the
 * relation element (`members[].geometry`), no separate recursion query
 * needed. Each `outer`-role member way becomes its own standalone water-body
 * `InfrastructureTrail` — deliberately NOT reassembled into one true ring
 * with `inner` members subtracted as holes (a real, stated scope cut: a
 * multi-part outer ring split across several way members is not
 * re-stitched, and island/inner rings are not excluded). Both directions of
 * that cut are safe for this gate's purpose: at worst an island cell is
 * conservatively treated as water (a false NO-GO, not a false crossing —
 * the safe direction to be wrong in for a hard-block hydrology gate), and a
 * multi-member outer ring still gates correctly member-by-member even if
 * not literally one closed polygon.
 */
function extractWaterRelationTrails(elements: any[]): InfrastructureTrail[] {
  const out: InfrastructureTrail[] = [];
  for (const el of elements) {
    if (el.type !== 'relation' || el.tags?.natural !== WATER_NATURAL) continue;
    for (const member of el.members ?? []) {
      if (member.type !== 'way' || member.role !== 'outer') continue;
      if (!Array.isArray(member.geometry) || member.geometry.length < 2) continue;
      out.push({
        name: el.tags?.name,
        kind: 'water',
        coords: member.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon })),
      });
    }
  }
  return out;
}

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
  signal?: AbortSignal,
  kind: InfrastructureKind = 'highway'
): Promise<InfrastructureData> {
  // Zero-network first: the Mapbox road tiles already on the map (same OSM
  // lineage as Overpass, CORS-clean, available offline once cached). Only a
  // NON-EMPTY result is trusted — an empty set can't tell "no roads" from
  // "tiles not loaded", so that case falls through to the network below. Not
  // cached here: it's synchronous and free to recompute, and caching a partial
  // (few-tiles-loaded) answer would lock it in for the session. Mapbox's own
  // vector tiles don't carry waterway geometry the way they carry roads, and
  // (mapboxTrails.ts) filter to the fire-break REUSABLE_CLASSES set with no
  // surface/tracktype/smoothness tags at all — neither the wider highway set
  // nor the road-speed model's tags survive that path — so this shortcut
  // applies only to the plain 'highway' kind, never 'highway-mobility'.
  if (kind === 'highway' && localTrailProvider) {
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

  const key = bboxKey(south, west, north, east, kind);
  const cached = bboxCache.get(key);
  if (cached) return cached;
  const inFlight = bboxInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = fetchCorridorUncached(south, west, north, east, key, kind, signal);
  bboxInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    bboxInFlight.delete(key);
  }
}

/** Waterway/water-body geometry for the Terrain Mobility hydrology gate (docs
 *  §34) — same proxy, cache and Overpass-failover machinery as
 *  `fetchCorridorInfrastructure`, just a different query. */
export function fetchCorridorWaterways(
  south: number,
  west: number,
  north: number,
  east: number,
  signal?: AbortSignal
): Promise<InfrastructureData> {
  return fetchCorridorInfrastructure(south, west, north, east, signal, 'water');
}

/** Road/track network for Terrain Mobility movement & counter-mobility (docs
 *  §35) — the wider `MOBILITY_HIGHWAYS` set (includes motorway/trunk/primary,
 *  deliberately excluded from the fire-break `REUSABLE_HIGHWAYS` set), each
 *  way carrying `surface`/`tracktype`/`smoothness` for the road-speed model.
 *  Same proxy, cache and Overpass-failover machinery as
 *  `fetchCorridorInfrastructure`, just a different query. */
export function fetchCorridorMobilityRoads(
  south: number,
  west: number,
  north: number,
  east: number,
  signal?: AbortSignal
): Promise<InfrastructureData> {
  return fetchCorridorInfrastructure(south, west, north, east, signal, 'highway-mobility');
}

async function fetchCorridorUncached(
  south: number,
  west: number,
  north: number,
  east: number,
  key: string,
  kind: InfrastructureKind,
  signal?: AbortSignal
): Promise<InfrastructureData> {
  // Primary: our own backend proxy (same-origin → no CORS, shared cache). Only
  // a genuine "not deployed" signal (404) disables it for the rest of the
  // session; a 502 means the proxy reached Overpass and Overpass failed, so we
  // fall through to the direct endpoints for this call but keep using the proxy
  // next time (its cache/quota-pooling is still the better primary).
  if (proxyAvailable) {
    try {
      const resp = await fetch(infraProxyUrl(south, west, north, east, kind), { signal });
      if (resp.status === 404) {
        proxyAvailable = false; // endpoint not present in this deployment
      } else if (resp.ok) {
        const json = await resp.json();
        const data: InfrastructureData = {
          trails: Array.isArray(json?.trails) ? json.trails : [],
          available: true,
        };
        bboxCache.set(key, data);
        logger.debug(`Overpass corridor via API proxy (${kind}): ${data.trails.length} ways`);
        return data;
      }
      // Other non-OK (e.g. 502 upstream, 429 rate limit) → try direct below.
    } catch (e) {
      // Network error reaching our own origin — unusual; fall through.
      logger.warn('Infrastructure API proxy unreachable, trying Overpass directly', e);
    }
  }

  const query = buildQuery(kind, south, west, north, east);

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
          kind: kind === 'water' ? (el.tags?.waterway ?? el.tags?.natural ?? 'water') : (el.tags?.highway ?? 'track'),
          coords: el.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon })),
          // Already present in every `out geom` response — previously read
          // only as far as `kind` above and discarded. Road-speed model
          // (docs §35) needs these for the mobility highway set; harmless
          // (and simplest) to extract unconditionally rather than branch on
          // kind here. Undefined when the way carries no such tag.
          surface: el.tags?.surface,
          tracktype: el.tags?.tracktype,
          smoothness: el.tags?.smoothness,
        }));
      if (kind === 'water') trails.push(...extractWaterRelationTrails(json?.elements ?? []));

      const data: InfrastructureData = { trails, available: true };
      bboxCache.set(key, data);
      preferredEndpointIndex = OVERPASS_ENDPOINTS.indexOf(url);
      logger.debug(`Overpass corridor query via ${new URL(url).host} (${kind}): ${trails.length} ways`);
      return data;
    } catch (e) {
      lastError = e;
      logger.warn(`Overpass endpoint failed (${new URL(url).host}), trying next`, e);
    }
  }

  // Do NOT cache failures — a later attempt (different endpoint order, or
  // the primary's quota having refreshed) may succeed.
  logger.warn(`All Overpass endpoints failed for ${kind}; continuing without it`, lastError);
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

/**
 * Distance (metres) from a point to the nearest water feature, treating
 * `natural=water` ways as filled bodies rather than just their boundary ring.
 *
 * `distanceToNearestTrail` alone is exactly right for a LINEAR watercourse
 * (river/stream/canal — the geometry Overpass returns IS the thing) but wrong
 * for a lake: a closed ring's edge-distance says a point deep in the middle of
 * a large lake is FAR from "the trail", which is backwards for a filled body —
 * a mover standing in the middle of a lake is not near water, it IS water.
 * Point-in-polygon (via the same @turf/boolean-point-in-polygon this project
 * already depends on for painted areas) catches that case; edge-distance alone
 * still covers the (far more common) case of standing near a lake's shore.
 */
export function distanceToNearestWater(point: LatLng, waterFeatures: InfrastructureTrail[], earlyExitThreshold = 0): number {
  const edgeDistance = distanceToNearestTrail(point, waterFeatures, earlyExitThreshold);
  if (edgeDistance <= earlyExitThreshold) return edgeDistance;

  for (const feature of waterFeatures) {
    if (feature.kind !== 'water') continue; // natural=water bodies only — waterway=* lines have no interior
    const c = feature.coords;
    if (c.length < 4) continue; // not enough vertices to be a meaningful closed ring
    const first = c[0], last = c[c.length - 1];
    const closed = Math.abs(first.lat - last.lat) < 1e-7 && Math.abs(first.lng - last.lng) < 1e-7;
    if (!closed) continue; // an unclosed way tagged natural=water is a data-quality edge case, not modelled here
    try {
      const inside = booleanPointInPolygon(
        [point.lng, point.lat],
        turfPolygon([c.map(p => [p.lng, p.lat])])
      );
      if (inside) return 0;
    } catch {
      // Malformed ring (self-intersecting, etc.) — fall back to the edge distance already computed.
    }
  }
  return edgeDistance;
}

/** Clear the bbox cache (tests). */
export function _clearInfrastructureCache() {
  bboxCache.clear();
  proxyAvailable = true;
}
