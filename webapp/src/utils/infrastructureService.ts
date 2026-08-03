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

import { LatLng } from '@firebreak/terrain';
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
  /** Real inner (island) rings subtracted as holes from this water body's
   *  outer ring (docs §35 "OSM water relations" — full multipolygon
   *  reassembly, 2026-07-28). Only ever populated for `kind === 'water'`
   *  features stitched from a relation with usable `inner` members. Any
   *  consumer doing a point-INSIDE-the-body test (`distanceToNearestWater`,
   *  `roadGraph.ts`'s `isInAnyWaterBody`) must treat a point inside `coords`
   *  but ALSO inside one of these as NOT water — dry ground on a real
   *  island, not the lake. */
  holes?: LatLng[][];
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
  south: number, west: number, north: number, east: number, kind: InfrastructureKind
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

/** Coordinate-equality tolerance for OSM shared-node matching (docs §35
 *  addendum, full multipolygon reassembly, 2026-07-28) — a fraction of a
 *  millimetre at the equator, far tighter than any two genuinely distinct
 *  OSM nodes could collide within, loose enough to absorb float round-
 *  tripping through Overpass's own JSON encoding. MUST match the API's
 *  identical constant (`api/src/services/infrastructureService.ts`). */
const RING_JOIN_EPS = 1e-7;

function samePoint(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < RING_JOIN_EPS && Math.abs(a.lng - b.lng) < RING_JOIN_EPS;
}

function isClosedRing(ring: LatLng[]): boolean {
  return ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1]);
}

/**
 * Reassemble a relation's same-role way-member fragments into closed ring(s)
 * (docs §35 addendum, full multipolygon reassembly, 2026-07-28) — OSM often
 * splits a large lake's outer boundary (or an island's inner ring) across
 * several way members sharing endpoint nodes at their junctions, rather than
 * one single closed way. Matches endpoints in EITHER orientation (a member
 * way's own direction is arbitrary) and chains fragments until each ring
 * closes. Returns `closed`/`open` separately: `open` is whatever couldn't be
 * joined into a closed ring — nothing is ever fabricated into a false
 * closure, so an unstitchable fragment is kept as a real, honest edge
 * feature (the SAME degraded-but-safe behaviour this module used for every
 * fragment before this fix) rather than silently dropped.
 */
function stitchRings(fragments: LatLng[][]): { closed: LatLng[][]; open: LatLng[][] } {
  const closed: LatLng[][] = [];
  const open: LatLng[][] = [];
  const remaining = fragments.filter(f => f.length >= 2).map(f => f.slice());

  while (remaining.length > 0) {
    let current = remaining.shift()!;
    if (isClosedRing(current)) { closed.push(current); continue; }

    let joinedAny = true;
    while (!isClosedRing(current) && joinedAny) {
      joinedAny = false;
      const tail = current[current.length - 1];
      for (let i = 0; i < remaining.length; i++) {
        const frag = remaining[i];
        if (samePoint(tail, frag[0])) {
          current = current.concat(frag.slice(1));
          remaining.splice(i, 1);
          joinedAny = true;
          break;
        }
        if (samePoint(tail, frag[frag.length - 1])) {
          current = current.concat(frag.slice(0, -1).reverse());
          remaining.splice(i, 1);
          joinedAny = true;
          break;
        }
      }
    }
    if (isClosedRing(current)) closed.push(current);
    else open.push(current);
  }
  return { closed, open };
}

/** Self-contained ray-casting point-in-ring test — mirrors `roadGraph.ts`'s
 *  own `pointInPolygon` ("no import dependency" design), used here only to
 *  decide which OUTER ring a stitched hole belongs to (a relation can have
 *  multiple disjoint outer rings, each with its own islands). The actual
 *  point-inside-a-water-body test consumers make (`distanceToNearestWater`)
 *  uses `@turf/boolean-point-in-polygon` against a proper multi-ring
 *  `Polygon`, which already handles holes correctly — this helper is ONLY
 *  for ring-to-ring assignment at extraction time. */
function pointInRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    const intersect = (yi > p.lat) !== (yj > p.lat) &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Multipolygon water bodies come back as `relation` elements, not `way` —
 * confirmed live via Overpass (docs §35 addendum, 2026-07-28): Overpass's
 * `out geom` inlines each member's own node geometry directly on the
 * relation element (`members[].geometry`), no separate recursion query
 * needed. Full reassembly (2026-07-28): `outer`-role fragments are stitched
 * into closed ring(s) via `stitchRings` (previously: each fragment became
 * its own standalone, often-unclosed "water body", which silently skipped
 * the interior point-in-polygon test entirely for any multi-fragment lake —
 * a real under-detection risk for a hard-block gate, not just the documented
 * "island over-blocks" direction). `inner`-role fragments are stitched the
 * same way and assigned as HOLES to whichever stitched outer ring actually
 * contains them (`pointInRing`), so a real island now correctly reads as dry
 * ground rather than being conservatively treated as water. An outer
 * fragment that genuinely can't be stitched closed (a real data-quality
 * edge case) is still emitted as a plain edge feature — the exact same
 * degraded-but-safe behaviour every fragment got before this fix, not a
 * regression for the cases the old code already handled.
 */
function extractWaterRelationTrails(elements: any[]): InfrastructureTrail[] {
  const out: InfrastructureTrail[] = [];
  for (const el of elements) {
    if (el.type !== 'relation' || el.tags?.natural !== WATER_NATURAL) continue;
    const outerFragments: LatLng[][] = [];
    const innerFragments: LatLng[][] = [];
    for (const member of el.members ?? []) {
      if (member.type !== 'way' || !Array.isArray(member.geometry) || member.geometry.length < 2) continue;
      const coords: LatLng[] = member.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon }));
      if (member.role === 'outer') outerFragments.push(coords);
      else if (member.role === 'inner') innerFragments.push(coords);
    }
    if (outerFragments.length === 0) continue;

    const outer = stitchRings(outerFragments);
    const inner = stitchRings(innerFragments);
    // Only a genuinely CLOSED hole ring is a meaningful subtraction — an
    // unstitchable inner fragment contributes nothing as a hole and is
    // dropped (the same "safe to over-block" direction this gate already
    // documented, not a new risk).
    const holeRings = inner.closed;

    for (const outerRing of outer.closed) {
      const holes = holeRings.filter(h => h.length > 0 && pointInRing(h[0], outerRing));
      out.push({
        name: el.tags?.name,
        kind: 'water',
        coords: outerRing,
        holes: holes.length > 0 ? holes : undefined,
      });
    }
    for (const openFragment of outer.open) {
      out.push({ name: el.tags?.name, kind: 'water', coords: openFragment });
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
  // vector tiles don't carry waterway geometry at all, so this never applies
  // to `kind === 'water'`.
  //
  // 2026-07-28: widened to ALSO cover `highway-mobility`, not just the plain
  // `highway` kind — live-tested finding: Overpass being unreachable for an
  // area left `onTrail` false for every cell, so a real, clearly-visible
  // highway along a Lake George shoreline was classified NO-GO end to end
  // (the mapped-road exemption on the hydrology/vegetation gates never
  // fired, because there was no road data to exempt against). The Mapbox
  // tiles were ALREADY loaded and showing that exact road the whole time.
  // Real, honest cost: (mapboxTrails.ts's `MOBILITY_CLASSES`/
  // `MAPBOX_CLASS_TO_OSM_HIGHWAY`) no `surface`/`tracktype`/`smoothness` —
  // Mapbox's schema doesn't carry them — so a way sourced this way gets a
  // highway-class-only speed ceiling, never the full OSM-tag refinement.
  // Strictly better than the alternative this fixes (zero road data at all).
  if ((kind === 'highway' || kind === 'highway-mobility') && localTrailProvider) {
    try {
      const local = localTrailProvider(south, west, north, east, kind);
      if (local && local.length > 0) {
        logger.debug(`Corridor trails from Mapbox tiles: ${local.length} ways`);
        return { trails: local, available: true };
      }
    } catch (e) {
      // Routine, expected fallback (tiles not loaded yet at this zoom/area) —
      // the network path below covers it, so this isn't warning-worthy.
      logger.debug('Local (Mapbox) trail provider failed, falling back to network', e);
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
      // Same-origin proxy failing is an anticipated (if less common) branch of
      // the same graceful-degradation chain — the direct-Overpass fallback
      // below covers it, so this is informational, not a warning.
      logger.info('Infrastructure API proxy unreachable, trying Overpass directly', e);
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
      // One mirror failing and moving to the next is the designed retry
      // behaviour (public Overpass instances are rate-limited/flaky by
      // nature, see this module's own doc comment) — routine, not a warning.
      logger.debug(`Overpass endpoint failed (${new URL(url).host}), trying next`, e);
    }
  }

  // Do NOT cache failures — a later attempt (different endpoint order, or
  // the primary's quota having refreshed) may succeed. Every endpoint failing
  // is a real, terminal outcome for this call (the analysis proceeds with
  // `infrastructureAvailable: false`, honestly flagged to the user) — not an
  // application error, so informational rather than a warning.
  logger.info(`All Overpass endpoints failed for ${kind}; continuing without it`, lastError);
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
  const scanRing = (c: LatLng[]): boolean => {
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
        if (best <= earlyExitThreshold) return true; // caller should stop scanning entirely
      }
    }
    return false;
  };
  for (const trail of trails) {
    if (scanRing(trail.coords)) return best;
    // A real island's own shoreline (docs §35 addendum, full multipolygon
    // reassembly, 2026-07-28) is a genuine water/land boundary too — a point
    // standing near an island's edge is near water exactly as much as one
    // near the lake's own outer shore. Only ever populated on `kind ===
    // 'water'` features (see `InfrastructureTrail.holes`'s own doc comment).
    for (const hole of trail.holes ?? []) {
      if (scanRing(hole)) return best;
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
      // A real island (docs §35 addendum, full multipolygon reassembly,
      // 2026-07-28): `feature.holes`, when present, are genuine inner rings
      // stitched and assigned to THIS outer ring at extraction time
      // (`extractWaterRelationTrails`). A standard multi-ring GeoJSON
      // `Polygon` — `[outer, hole1, hole2, ...]` — already means "outer
      // minus holes" per the spec, so `booleanPointInPolygon` handles this
      // correctly with no extra logic here; a point on a real island
      // reads as OUTSIDE the water body.
      const rings = feature.holes && feature.holes.length > 0
        ? [c, ...feature.holes]
        : [c];
      const inside = booleanPointInPolygon(
        [point.lng, point.lat],
        turfPolygon(rings.map(ring => ring.map(p => [p.lng, p.lat])))
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
