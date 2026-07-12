/**
 * Road access & approach direction lookup for the SMEACS briefing.
 * Finds nearest drivable road to plan endpoints (Overpass) + route summary (Mapbox Directions).
 * All failures graceful and explicit (never invents a route).
 * Mirrors infrastructureService.ts patterns: bbox-cached Overpass, graceful available:false.
 */

import { AccessPoint, AccessRouteStep } from '../types/assistant';

export interface AccessRoutingSummary {
  entryPoint?: AccessPoint;
  approachSteps?: AccessRouteStep[];
  available: boolean;
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const FETCH_TIMEOUT_MS = 15000;
const DIRECTIONS_API_BASE = 'https://api.mapbox.com/directions/v5/mapbox/driving';

// Drivable road classes (wider than the optimizer's reusable-trail set)
const DRIVABLE_HIGHWAYS = 'primary|secondary|tertiary|unclassified|residential|track|service';

const bboxCache = new Map<string, AccessRoutingSummary>();

const bboxKey = (s: number, w: number, n: number, e: number) =>
  [s, w, n, e].map((v) => v.toFixed(3)).join(',');

/**
 * Find the nearest drivable road to a point using Overpass.
 * Returns the closest road within ~2 km, or undefined if none found.
 */
async function findNearestRoad(
  lat: number,
  lng: number,
  searchRadiusKm: number = 2,
  signal?: AbortSignal
): Promise<{ coords: { lat: number; lng: number }; roadName?: string; roadKind: string; gapM: number } | undefined> {
  // Query roads near the point
  const delta = searchRadiusKm / 111; // rough lat/lng degree approximation
  const south = lat - delta;
  const north = lat + delta;
  const west = lng - delta;
  const east = lng + delta;

  const query = `[out:json][timeout:12];way["highway"~"^(${DRIVABLE_HIGHWAYS})$"](${south},${west},${north},${east});out geom;`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }

    const elements = json?.elements ?? [];
    if (elements.length === 0) return undefined;

    // Find closest point on any road
    let closest: {
      coords: { lat: number; lng: number };
      roadName?: string;
      roadKind: string;
      gapM: number;
    } | undefined;

    for (const way of elements) {
      if (!way.geometry || !Array.isArray(way.geometry)) continue;

      const roadKind = way.tags?.highway || 'road';
      const roadName = way.tags?.name;

      for (let i = 0; i < way.geometry.length - 1; i++) {
        const p1 = way.geometry[i];
        const p2 = way.geometry[i + 1];

        // Project point onto line segment p1-p2
        const dx = p2.lon - p1.lon;
        const dy = p2.lat - p1.lat;
        const t = Math.max(0, Math.min(1, ((lng - p1.lon) * dx + (lat - p1.lat) * dy) / (dx * dx + dy * dy)));

        const projLng = p1.lon + t * dx;
        const projLat = p1.lat + t * dy;

        const dLng = (projLng - lng) * Math.cos(((lat + projLat) / 2) * (Math.PI / 180));
        const dLat = projLat - lat;
        const gapM = Math.sqrt(dLng * dLng + dLat * dLat) * 111000; // rough m conversion

        if (!closest || gapM < closest.gapM) {
          closest = { coords: { lat: projLat, lng: projLng }, roadName, roadKind, gapM };
        }
      }
    }

    return closest;
  } catch (error: any) {
    console.error('findNearestRoad error:', error?.message);
    return undefined;
  }
}

/**
 * Get approach directions from a start point to an end point using Mapbox Directions API.
 * Returns road names + distances; failures return undefined.
 */
async function getApproachDirections(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  mapboxToken: string,
  signal?: AbortSignal
): Promise<AccessRouteStep[] | undefined> {
  if (!mapboxToken) return undefined;

  const url = `${DIRECTIONS_API_BASE}/${startLng},${startLat};${endLng},${endLat}?access_token=${encodeURIComponent(mapboxToken)}&steps=true&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort);

    let json: any;
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`Directions HTTP ${resp.status}`);
      json = await resp.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }

    if (!json.routes || json.routes.length === 0) return undefined;

    const route = json.routes[0];
    const legs = route.legs || [];
    const steps: AccessRouteStep[] = [];

    for (const leg of legs) {
      for (const step of leg.steps || []) {
        const roadName = step.name || 'unnamed road';
        const distanceM = step.distance || 0;
        steps.push({ roadName, distanceM });
      }
    }

    return steps.length > 0 ? steps : undefined;
  } catch (error: any) {
    console.error('getApproachDirections error:', error?.message);
    return undefined;
  }
}

/**
 * Build an access routing summary for a line (start → end coords).
 * Returns entry point suggestion and approach directions (if available).
 */
export async function buildAccessRoutingSummary(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  mapboxToken: string,
  signal?: AbortSignal
): Promise<AccessRoutingSummary> {
  // Try to find nearest road to each end
  const [startRoad, endRoad] = await Promise.all([
    findNearestRoad(startLat, startLng, 2, signal),
    findNearestRoad(endLat, endLng, 2, signal),
  ]);

  // Pick the closer entry point (or the end if both exist)
  let entryPoint: AccessPoint | undefined;
  if (startRoad && endRoad) {
    const closer = endRoad.gapM < startRoad.gapM ? endRoad : startRoad;
    const forLineEnd = endRoad.gapM < startRoad.gapM ? 'end' : 'start';
    entryPoint = { ...closer, forLineEnd };
  } else if (startRoad) {
    entryPoint = { ...startRoad, forLineEnd: 'start' };
  } else if (endRoad) {
    entryPoint = { ...endRoad, forLineEnd: 'end' };
  }

  // Get approach directions from nearest staging point (nearest town / first road found)
  let approachSteps: AccessRouteStep[] | undefined;
  if (entryPoint) {
    approachSteps = await getApproachDirections(
      entryPoint.coords.lat,
      entryPoint.coords.lng,
      startLat,
      startLng,
      mapboxToken,
      signal
    );
  }

  return {
    entryPoint,
    approachSteps,
    available: !!(entryPoint || approachSteps),
  };
}
