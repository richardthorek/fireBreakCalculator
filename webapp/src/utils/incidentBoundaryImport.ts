/**
 * Import an incident perimeter from the existing live fire-boundary feed
 * (`fetchFireBoundaries`, Digital Atlas of Australia NRT — see
 * `docs/GIS_INTEROP.md` §4) instead of hand-drawing it. That feed is
 * national (`state` field covers NSW plus the others already listed there);
 * NSW is surfaced first in the UI per the initial ask, but every state the
 * feed already carries works identically — no NSW-specific code path.
 *
 * The NSW RFS "majorIncidents.json" feed used elsewhere in this app
 * (`liveFeedsService.ts` `parseNsw`) is point-only (no boundary geometry) —
 * it is NOT the source for this feature, even though it was the one named
 * in the original ask. `fetchFireBoundaries()` is the source that actually
 * carries polygons.
 */

import { LatLng } from '@firebreak/terrain';
import { fetchFireBoundaries } from './liveFeedsService';

export interface ImportableFireBoundary {
  id: string;
  name: string;
  state: string;
  areaHa: number | null;
  centroid: LatLng;
  /** Outer ring of the largest polygon part, open (no repeated closing vertex). */
  ring: LatLng[];
}

function ringArea(ring: number[][]): number {
  // Shoelace formula on raw lng/lat — good enough to compare candidate rings
  // by relative size, not a real geodesic area.
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum) / 2;
}

/** Largest outer ring in a Polygon/MultiPolygon geometry, as an open LatLng[]. */
function largestRing(geometry: any): LatLng[] | null {
  if (!geometry) return null;
  const candidateRings: number[][][] =
    geometry.type === 'Polygon' ? [geometry.coordinates?.[0]].filter(Boolean) :
    geometry.type === 'MultiPolygon' ? (geometry.coordinates ?? []).map((poly: number[][][]) => poly?.[0]).filter(Boolean) :
    [];
  if (candidateRings.length === 0) return null;

  let best: number[][] | null = null;
  let bestArea = -1;
  for (const ring of candidateRings) {
    if (!ring || ring.length < 4) continue;
    const area = ringArea(ring);
    if (area > bestArea) { bestArea = area; best = ring; }
  }
  if (!best) return null;

  // Ring is closed (first === last) — drop the repeated closing vertex, the
  // rest of this feature treats perimeters as open vertex lists.
  const open = best.slice(0, -1);
  return open.map(([lng, lat]) => ({ lat, lng }));
}

function centroidOf(ring: LatLng[]): LatLng {
  const sum = ring.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
}

/**
 * Fetch current fire polygons usable as an incident perimeter, nearest-first
 * to `near` when given. Returns [] (never throws) on any upstream failure —
 * the panel falls back to manual drawing, same fallback idiom as elsewhere.
 */
export async function fetchImportableFireBoundaries(near?: LatLng): Promise<ImportableFireBoundary[]> {
  try {
    const result = await fetchFireBoundaries();
    const out: ImportableFireBoundary[] = [];
    for (const feature of result.geojson.features) {
      const ring = largestRing(feature.geometry);
      if (!ring || ring.length < 3) continue;
      const props: any = feature.properties ?? {};
      out.push({
        id: String(props.fire_id ?? out.length),
        name: props.fire_name || 'Unnamed fire',
        state: props.state || 'Unknown',
        areaHa: typeof props.area_ha === 'number' ? props.area_ha : null,
        centroid: centroidOf(ring),
        ring,
      });
    }
    if (near) {
      out.sort((a, b) => {
        const da = (a.centroid.lat - near.lat) ** 2 + (a.centroid.lng - near.lng) ** 2;
        const db = (b.centroid.lat - near.lat) ** 2 + (b.centroid.lng - near.lng) ** 2;
        return da - db;
      });
    }
    return out;
  } catch {
    return [];
  }
}
