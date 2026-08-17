/**
 * Server-side Overpass (OSM) proxy for corridor infrastructure (trails/roads).
 *
 * WHY: the browser used to call the public Overpass endpoints directly. Those
 * instances do NOT send `Access-Control-Allow-Origin` on their error / rate-
 * limited responses (429/504/timeout), so the browser surfaces every such
 * failure as an opaque CORS error and the whole trail lookup fails — which in
 * turn kills the optimizer's trail-reuse discount AND the snap-to-trail path
 * refinement. Proxying through our own origin removes CORS entirely (the
 * browser calls same-origin `/api/infrastructure`; the server → Overpass hop
 * has no CORS), and pools every user behind ONE server IP with a shared cache
 * so the public 2-slot-per-IP quota is spent once per corridor, not once per
 * user.
 *
 * This mirrors the vegetation tile cache's philosophy: the client keeps its
 * direct-to-Overpass fallback for deployments where this endpoint is
 * unreachable (offline/local dev), so the proxy is an accelerator, not a hard
 * dependency.
 *
 * TWO-TIER CACHE (2026-08-17 — live 502s + a client-side Overpass CORS
 * failure surfaced in production, traced to Overpass's own per-IP concurrent-
 * connection quota being tight enough that a handful of simultaneous users
 * can trip it):
 *  L1 — the original in-process `Map`, keyed by rounded bbox+kind. Free,
 *       zero-latency, but private to ONE warm Function instance — under
 *       scale-out or a cold start, a fresh instance starts with an empty L1
 *       and re-pays the upstream cost even for a bbox another instance
 *       already fetched moments ago.
 *  L2 — a blob cache (mirrors vegetationTileService.ts's container pattern),
 *       keyed the same way, SHARED across every instance and surviving cold
 *       starts. A miss on L1 checks L2 before ever touching Overpass; a
 *       result fetched from Overpass populates both. Unlike the quantised veg
 *       tiles, corridor bboxes aren't grid-aligned, so cross-user hits are
 *       "the same or a re-run corridor", not "any overlapping corridor" — a
 *       real but narrower win than the veg cache's, and still exactly the
 *       "many users work the same ground during an incident" case this
 *       exists for. `infracache-expiry` (infra/main.bicep) age-limits L2
 *       independently of L1's own TTL — OSM road/water topology is far more
 *       stable than 7 days, but stale-but-plausible data is a worse failure
 *       mode here than a slightly-too-frequent refetch.
 *
 * CONCURRENCY LIMIT: the per-IP Overpass quota is a CONCURRENT-connection
 * limit, not a rate limit — the fix for tripping it under multi-user load is
 * capping how many outbound Overpass requests this instance has in flight at
 * once, not caching harder (a cache miss storm — many distinct bboxes at
 * once — still floods Overpass even with a perfect cache). `overpassLimiter`
 * below queues requests past `OVERPASS_MAX_CONCURRENT` instead of firing them
 * all at once.
 */

import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';

/** Highway classes that represent reusable broken ground for a fire break —
 *  MUST match the webapp's REUSABLE_HIGHWAYS so proxied and direct results are
 *  the same set. */
const REUSABLE_HIGHWAYS = 'track|path|service|unclassified|road|tertiary|secondary|residential';

/** Highway classes for Terrain Mobility / counter-mobility (docs §35) —
 *  MUST match the webapp's MOBILITY_HIGHWAYS. Deliberately a separate, wider
 *  set from REUSABLE_HIGHWAYS: motorway/trunk/primary aren't realistically
 *  "reusable broken ground" for a fire break, but are exactly the
 *  highest-value roads to identify for movement/denial planning. */
const MOBILITY_HIGHWAYS =
  'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|' +
  'tertiary|tertiary_link|unclassified|residential|living_street|service|track|path|road';

/** Waterway/water-body classes queried for the Terrain Mobility hydrology gate
 *  (docs/ROUTE_INTELLIGENCE.md §34) — linear watercourses plus standing water
 *  bodies. MUST match the webapp's WATER_WATERWAYS/WATER_NATURAL so proxied and
 *  direct results are the same set. Deliberately excludes `ditch`/`drain`
 *  below `canal` in typical width — including them produced too many false
 *  "unfordable" gates on farmland drainage in manual review of sample AOIs. */
const WATER_WATERWAYS = 'river|canal|stream';
const WATER_NATURAL = 'water';

export type InfrastructureKind = 'highway' | 'highway-mobility' | 'water';

const OVERPASS_ENDPOINTS: string[] = (process.env.OVERPASS_URLS
  ? String(process.env.OVERPASS_URLS).split(',').map(s => s.trim()).filter(Boolean)
  : [
      'https://overpass-api.de/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ]);

const UPSTREAM_TIMEOUT_MS = 12_000;
/** In-process (L1) cache TTL. OSM ways are stable; a warm host reuses
 *  corridors across passes and nearby runs within this window. Independent
 *  of the L2 blob cache's own age limit (`infracache-expiry`, infra/main.bicep) —
 *  L1 is deliberately much shorter since it costs nothing to let it expire
 *  often and re-check L2/Overpass. */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;

/**
 * Minimal counting semaphore — caps how many `run()` callbacks are actually
 * executing at once; callers past the cap queue in FIFO order and each one
 * resolves as an earlier slot frees up. No external dependency for something
 * this small (a handful of lines) and this narrowly scoped (module-private,
 * one call site).
 */
class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/** Overpass's public mirrors enforce a CONCURRENT-connection cap per source
 *  IP (commonly ~2), not a request-rate limit — several simultaneous users
 *  each triggering their own corridor fetch is enough to trip it even though
 *  no single user is polling quickly. Queuing past this cap (rather than
 *  firing every request immediately) is the actual fix; caching alone
 *  doesn't help a cache-miss storm across many distinct bboxes at once. */
const OVERPASS_MAX_CONCURRENT = Number(process.env.OVERPASS_MAX_CONCURRENT) || 2;
const overpassLimiter = new Semaphore(OVERPASS_MAX_CONCURRENT);

export interface InfrastructureTrail {
  name?: string;
  /** OSM highway value, e.g. "track", "path", "service". */
  kind: string;
  coords: { lat: number; lng: number }[];
  /** OSM `surface` tag — road-class speed model (docs §35). Undefined when untagged. */
  surface?: string;
  /** OSM `tracktype` tag — only meaningful on `highway=track`. Undefined when untagged. */
  tracktype?: string;
  /** OSM `smoothness` tag. Undefined when untagged. */
  smoothness?: string;
  /** Real inner (island) rings subtracted as holes from this water body's
   *  outer ring (docs §35 "OSM water relations" — full multipolygon
   *  reassembly, 2026-07-28). Only ever populated for `kind === 'water'`
   *  features stitched from a relation with usable `inner` members. MUST
   *  match the webapp's identical field — the webapp's own point-inside-the-
   *  body tests (`distanceToNearestWater`, `roadGraph.ts`'s
   *  `isInAnyWaterBody`) depend on this shape surviving the API round trip
   *  unchanged. */
  holes?: { lat: number; lng: number }[][];
}

export interface InfrastructureResult {
  trails: InfrastructureTrail[];
  /** True when the Overpass query succeeded (zero trails then means genuinely
   *  none mapped, not "couldn't ask"). */
  available: boolean;
}

interface CacheEntry { at: number; data: InfrastructureResult }
const cache = new Map<string, CacheEntry>();

/** Endpoint that last succeeded — tried first next call, so a warm host doesn't
 *  re-pay a rate-limited primary's failure on every corridor. */
let preferredEndpointIndex = 0;

const bboxKey = (s: number, w: number, n: number, e: number, kind: InfrastructureKind) =>
  [kind, s, w, n, e].map(v => typeof v === 'number' ? v.toFixed(3) : v).join(',');

/** Same rounding as `bboxKey`, reshaped into a blob-name-safe path — commas
 *  aren't valid in a blob name, everything else in `bboxKey`'s output already
 *  is. Kept as a distinct function (not a `.replace` on `bboxKey`'s output) so
 *  the L1 key format and the L2 blob-name format can diverge later without
 *  entangling the two. */
const blobKey = (s: number, w: number, n: number, e: number, kind: InfrastructureKind) =>
  `infra/v1/${kind}/${s.toFixed(3)}_${w.toFixed(3)}_${n.toFixed(3)}_${e.toFixed(3)}.json`;

const INFRA_CACHE_CONTAINER = process.env.INFRA_CACHE_CONTAINER || 'infracache';

let infraContainerPromise: Promise<ContainerClient | null> | null = null;

/** Container client from the existing storage connection string — same
 *  connection string the vegetation tile cache and Table Storage clients use
 *  (see tableClient.ts). Returns null when storage isn't configured (local
 *  dev without an emulator/account): every call site below treats that as
 *  "L2 unavailable, fall through to L1/Overpass", never as an error. */
function getInfraContainer(): Promise<ContainerClient | null> {
  if (!infraContainerPromise) {
    infraContainerPromise = (async () => {
      const conn = process.env.TABLES_CONNECTION_STRING;
      if (!conn) return null;
      try {
        const svc = BlobServiceClient.fromConnectionString(conn);
        const container = svc.getContainerClient(INFRA_CACHE_CONTAINER);
        await container.createIfNotExists();
        return container;
      } catch {
        infraContainerPromise = null; // retry next request
        return null;
      }
    })();
  }
  return infraContainerPromise;
}

async function readInfraBlob(container: ContainerClient, name: string): Promise<InfrastructureResult | null> {
  try {
    const blob = container.getBlockBlobClient(name);
    if (!(await blob.exists())) return null;
    const buf = await blob.downloadToBuffer();
    const parsed = JSON.parse(buf.toString('utf-8'));
    if (!Array.isArray(parsed?.trails) || typeof parsed?.available !== 'boolean') return null;
    return parsed as InfrastructureResult;
  } catch {
    // A malformed/unreadable blob must degrade to "L2 miss", never throw —
    // the caller's own Overpass fallback recovers it.
    return null;
  }
}

async function writeInfraBlob(container: ContainerClient, name: string, data: InfrastructureResult): Promise<void> {
  try {
    const bytes = Buffer.from(JSON.stringify(data), 'utf-8');
    await container.getBlockBlobClient(name).uploadData(bytes, {
      blobHTTPHeaders: { blobContentType: 'application/json' },
    });
  } catch {
    // A failed cache write must not fail the request — next caller refetches.
  }
}

function buildQuery(kind: InfrastructureKind, s: number, w: number, n: number, e: number): string {
  if (kind === 'water') {
    return (
      `[out:json][timeout:12];` +
      `(way["waterway"~"^(${WATER_WATERWAYS})$"](${s},${w},${n},${e});` +
      `way["natural"="${WATER_NATURAL}"](${s},${w},${n},${e});` +
      // Multipolygon water bodies (docs §35, "OSM water relations" — real,
      // live-confirmed gap: Lake Tuggeranong and Gungahlin Pond, both in
      // the same Canberra region this project's own test scenarios live in,
      // are mapped as `relation` not `way`). MUST match the webapp's
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
 *  tripping through Overpass's own JSON encoding. MUST match the webapp's
 *  identical constant (`webapp/src/utils/infrastructureService.ts`). */
const RING_JOIN_EPS = 1e-7;

type LatLngPt = { lat: number; lng: number };

function samePoint(a: LatLngPt, b: LatLngPt): boolean {
  return Math.abs(a.lat - b.lat) < RING_JOIN_EPS && Math.abs(a.lng - b.lng) < RING_JOIN_EPS;
}

function isClosedRing(ring: LatLngPt[]): boolean {
  return ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1]);
}

/** Reassemble a relation's same-role way-member fragments into closed
 *  ring(s) — MUST match the webapp's identical `stitchRings`, see that
 *  copy's own doc comment for the full reasoning. */
function stitchRings(fragments: LatLngPt[][]): { closed: LatLngPt[][]; open: LatLngPt[][] } {
  const closed: LatLngPt[][] = [];
  const open: LatLngPt[][] = [];
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

/** Self-contained ray-casting point-in-ring test, used only to decide which
 *  outer ring a stitched hole belongs to — MUST match the webapp's identical
 *  `pointInRing` (that copy also documents why this doesn't need to be the
 *  same implementation the actual point-in-water-body test uses). */
function pointInRing(p: LatLngPt, ring: LatLngPt[]): boolean {
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
 * needed. Full reassembly (2026-07-28, MUST match the webapp's identical
 * logic): `outer`-role fragments are stitched into closed ring(s) via
 * `stitchRings` (previously: each fragment became its own standalone,
 * often-unclosed "water body" — a real under-detection risk for a
 * multi-fragment lake's interior, not just the documented "island
 * over-blocks" direction). `inner`-role fragments are stitched the same way
 * and assigned as holes to whichever stitched outer ring actually contains
 * them (`pointInRing`). An outer fragment that genuinely can't be stitched
 * closed is still emitted as a plain edge feature — the same
 * degraded-but-safe behaviour every fragment got before this fix.
 */
function extractWaterRelationTrails(elements: any[]): InfrastructureTrail[] {
  const out: InfrastructureTrail[] = [];
  for (const el of elements) {
    if (el.type !== 'relation' || el.tags?.natural !== WATER_NATURAL) continue;
    const outerFragments: LatLngPt[][] = [];
    const innerFragments: LatLngPt[][] = [];
    for (const member of el.members ?? []) {
      if (member.type !== 'way' || !Array.isArray(member.geometry) || member.geometry.length < 2) continue;
      const coords: LatLngPt[] = member.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon }));
      if (member.role === 'outer') outerFragments.push(coords);
      else if (member.role === 'inner') innerFragments.push(coords);
    }
    if (outerFragments.length === 0) continue;

    const outer = stitchRings(outerFragments);
    const inner = stitchRings(innerFragments);
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

function getCached(key: string): InfrastructureResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key: string, data: InfrastructureResult): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

async function queryEndpoint(url: string, query: string): Promise<any> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status} from ${new URL(url).host}`);
  return await resp.json();
}

/**
 * Fetch reusable trails/roads within a bounding box (south, west, north, east)
 * via Overpass, trying each endpoint in turn (starting from whichever last
 * worked). Checks the in-process (L1) cache, then the shared blob (L2) cache,
 * before ever calling Overpass; a fresh Overpass result populates both. The
 * actual outbound Overpass call is queued behind `overpassLimiter` so this
 * instance never has more than `OVERPASS_MAX_CONCURRENT` requests in flight —
 * see the module header for why that (not caching harder) is what protects
 * Overpass's concurrent-connection quota under real multi-user load. Returns
 * `available: false` only after every endpoint failed; never throws.
 */
export async function fetchCorridorInfrastructure(
  south: number,
  west: number,
  north: number,
  east: number,
  kind: InfrastructureKind = 'highway'
): Promise<InfrastructureResult> {
  const key = bboxKey(south, west, north, east, kind);
  const cached = getCached(key);
  if (cached) return cached;

  const container = await getInfraContainer();
  if (container) {
    const l2 = await readInfraBlob(container, blobKey(south, west, north, east, kind));
    if (l2) {
      setCached(key, l2);
      return l2;
    }
  }

  const query = buildQuery(kind, south, west, north, east);
  const order = [
    ...OVERPASS_ENDPOINTS.slice(preferredEndpointIndex),
    ...OVERPASS_ENDPOINTS.slice(0, preferredEndpointIndex),
  ];

  for (const url of order) {
    try {
      const json = await overpassLimiter.run(() => queryEndpoint(url, query));
      const trails: InfrastructureTrail[] = (json?.elements ?? [])
        .filter((el: any) => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
        .map((el: any) => ({
          name: el.tags?.name,
          kind: kind === 'water' ? (el.tags?.waterway ?? el.tags?.natural ?? 'water') : (el.tags?.highway ?? 'track'),
          coords: el.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon })),
          surface: el.tags?.surface,
          tracktype: el.tags?.tracktype,
          smoothness: el.tags?.smoothness,
        }));
      if (kind === 'water') trails.push(...extractWaterRelationTrails(json?.elements ?? []));
      const data: InfrastructureResult = { trails, available: true };
      setCached(key, data);
      if (container) await writeInfraBlob(container, blobKey(south, west, north, east, kind), data);
      preferredEndpointIndex = OVERPASS_ENDPOINTS.indexOf(url);
      return data;
    } catch {
      // Transient endpoint failure — move on immediately, don't retry a
      // struggling mirror.
    }
  }
  // Do NOT cache a total failure (either tier) — a later attempt may succeed
  // once a quota refreshes.
  return { trails: [], available: false };
}

/** Clear the corridor cache (tests). @internal */
export function _clearInfrastructureCache(): void {
  cache.clear();
  preferredEndpointIndex = 0;
  infraContainerPromise = null;
}
