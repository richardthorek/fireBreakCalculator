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

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const FETCH_TIMEOUT_MS = 15000;

/** Highway classes that represent reusable broken ground for a fire break. */
const REUSABLE_HIGHWAYS = 'track|path|service|unclassified|road|tertiary|secondary|residential';

// Cache per rounded bbox so repeated optimizations of the same corridor are free.
const bboxCache = new Map<string, InfrastructureData>();

const bboxKey = (s: number, w: number, n: number, e: number) =>
  [s, w, n, e].map(v => v.toFixed(3)).join(',');

/**
 * Fetch reusable trails/roads within a bounding box (south, west, north, east).
 * Returns `{ available: false }` on any failure — never throws.
 */
export async function fetchCorridorInfrastructure(
  south: number,
  west: number,
  north: number,
  east: number,
  signal?: AbortSignal
): Promise<InfrastructureData> {
  const key = bboxKey(south, west, north, east);
  const cached = bboxCache.get(key);
  if (cached) return cached;

  const query = `[out:json][timeout:12];way["highway"~"^(${REUSABLE_HIGHWAYS})$"](${south},${west},${north},${east});out geom;`;

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort);
    let json: any;
    try {
      const resp = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
      json = await resp.json();
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }

    const trails: InfrastructureTrail[] = (json?.elements ?? [])
      .filter((el: any) => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
      .map((el: any) => ({
        name: el.tags?.name,
        kind: el.tags?.highway ?? 'track',
        coords: el.geometry.map((g: any) => ({ lat: g.lat, lng: g.lon })),
      }));

    const data: InfrastructureData = { trails, available: true };
    bboxCache.set(key, data);
    logger.debug(`Overpass corridor query: ${trails.length} reusable ways`);
    return data;
  } catch (e) {
    // Do NOT cache failures — a later attempt may succeed.
    logger.warn('Overpass infrastructure query failed; optimizing on terrain/fuel only', e);
    return { trails: [], available: false };
  }
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
}
