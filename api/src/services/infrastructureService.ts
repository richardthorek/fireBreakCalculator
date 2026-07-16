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
 * Cache is in-process only (a short TTL keyed by rounded bbox): a corridor is
 * re-queried across the optimizer's passes and by nearby subsequent runs, and
 * OSM ways for a rural area are stable over the lifetime of a warm function
 * host. No blob layer — unlike the quantised veg tiles, corridor bboxes aren't
 * grid-aligned, so cross-user blob hits would be rare and not worth the write.
 */

/** Highway classes that represent reusable broken ground for a fire break —
 *  MUST match the webapp's REUSABLE_HIGHWAYS so proxied and direct results are
 *  the same set. */
const REUSABLE_HIGHWAYS = 'track|path|service|unclassified|road|tertiary|secondary|residential';

const OVERPASS_ENDPOINTS: string[] = (process.env.OVERPASS_URLS
  ? String(process.env.OVERPASS_URLS).split(',').map(s => s.trim()).filter(Boolean)
  : [
      'https://overpass-api.de/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ]);

const UPSTREAM_TIMEOUT_MS = 12_000;
/** In-process cache TTL. OSM ways are stable; a warm host reuses corridors
 *  across passes and nearby runs within this window. */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 200;

export interface InfrastructureTrail {
  name?: string;
  /** OSM highway value, e.g. "track", "path", "service". */
  kind: string;
  coords: { lat: number; lng: number }[];
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

const bboxKey = (s: number, w: number, n: number, e: number) =>
  [s, w, n, e].map(v => v.toFixed(3)).join(',');

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
 * worked). Short-lived in-process cache. Returns `available: false` only after
 * every endpoint failed; never throws.
 */
export async function fetchCorridorInfrastructure(
  south: number,
  west: number,
  north: number,
  east: number
): Promise<InfrastructureResult> {
  const key = bboxKey(south, west, north, east);
  const cached = getCached(key);
  if (cached) return cached;

  const query = `[out:json][timeout:12];way["highway"~"^(${REUSABLE_HIGHWAYS})$"](${south},${west},${north},${east});out geom;`;
  const order = [
    ...OVERPASS_ENDPOINTS.slice(preferredEndpointIndex),
    ...OVERPASS_ENDPOINTS.slice(0, preferredEndpointIndex),
  ];

  for (const url of order) {
    try {
      const json = await queryEndpoint(url, query);
      const trails: InfrastructureTrail[] = (json?.elements ?? [])
        .filter((el: any) => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
        .map((el: any) => ({
          name: el.tags?.name,
          kind: el.tags?.highway ?? 'track',
          coords: el.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon })),
        }));
      const data: InfrastructureResult = { trails, available: true };
      setCached(key, data);
      preferredEndpointIndex = OVERPASS_ENDPOINTS.indexOf(url);
      return data;
    } catch {
      // Transient endpoint failure — move on immediately, don't retry a
      // struggling mirror.
    }
  }
  // Do NOT cache a total failure — a later attempt may succeed once a quota
  // refreshes.
  return { trails: [], available: false };
}

/** Clear the corridor cache (tests). @internal */
export function _clearInfrastructureCache(): void {
  cache.clear();
  preferredEndpointIndex = 0;
}
