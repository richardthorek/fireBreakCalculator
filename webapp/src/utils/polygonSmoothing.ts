/**
 * Chaikin corner-cutting for CLOSED polygon rings (docs/ROUTE_INTELLIGENCE.md
 * §28, "Smooth the corridor band's own outline" — the lower-priority
 * remainder of the 2026-07-28 corridor-route-rendering fix). A corridor's
 * outline is a genuine `@turf/union` of its own hex cells — a real dissolved
 * shape, not a drawn approximation — but the hex tessellation still leaves it
 * visibly blocky/crenellated at close zoom. This is a presentation-only
 * smoothing pass over that already-correct geometry, not a re-analysis: the
 * corridor's real extent is what `buildCorridorField` computed, this module
 * only changes how the boundary is DRAWN.
 *
 * Chaikin's algorithm is the standard, well-understood choice here (it
 * converges toward a quadratic B-spline as iterations increase): each edge
 * `(p_i, p_{i+1})` is replaced by two points at 1/4 and 3/4 along it. Unlike
 * `pathRefinement.ts`'s smoothing of an OPEN route (which has two endpoints
 * that must never move, and a "locked" set of trail-snapped vertices that
 * must not blur), a closed ring has neither — every vertex participates
 * equally, cyclically, so the whole boundary rounds off uniformly.
 */
import { LatLng } from '@firebreak/terrain';

/**
 * Smooth one closed ring (GeoJSON convention: first and last coordinates
 * equal). Returns a new ring, still closed. Rings with fewer than 4 points
 * (a triangle plus its closing point — the smallest a real polygon can be)
 * are returned unchanged; there is nothing meaningful to round off.
 */
export function chaikinSmoothRing(ring: LatLng[], iterations: number): LatLng[] {
  if (iterations <= 0 || ring.length < 4) return ring.slice();

  const closed = ring.length > 1 &&
    ring[0].lat === ring[ring.length - 1].lat &&
    ring[0].lng === ring[ring.length - 1].lng;
  let pts = closed ? ring.slice(0, -1) : ring.slice();
  if (pts.length < 3) return ring.slice();

  for (let it = 0; it < iterations; it++) {
    const next: LatLng[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      next.push({ lat: a.lat * 0.75 + b.lat * 0.25, lng: a.lng * 0.75 + b.lng * 0.25 });
      next.push({ lat: a.lat * 0.25 + b.lat * 0.75, lng: a.lng * 0.25 + b.lng * 0.75 });
    }
    pts = next;
  }
  return [...pts, pts[0]];
}

/** GeoJSON coordinate ring, `[lng, lat]` pairs — the raw shape Mapbox/turf
 *  geometries carry, as opposed to this codebase's own `{lat,lng}` objects. */
type GeoRing = [number, number][];

function toLatLngRing(ring: GeoRing): LatLng[] {
  return ring.map(([lng, lat]) => ({ lat, lng }));
}
function toGeoRing(ring: LatLng[]): GeoRing {
  return ring.map(p => [p.lng, p.lat]);
}

/**
 * Smooth every ring of a `Polygon` or `MultiPolygon` geometry — every
 * outer boundary AND any hole, since `@turf/union` can legitimately produce
 * either shape depending on how a corridor's hexes happen to dissolve
 * together. Unrecognised geometry types pass through unchanged rather than
 * throwing, so a smoothing failure degrades to the pre-smoothing look
 * (matches this codebase's own established fallback discipline for corridor
 * rendering — see `MapboxMapView.tsx`'s union try/catch).
 */
export function smoothPolygonGeometry(
  geometry: { type: string; coordinates: unknown },
  iterations: number
): { type: string; coordinates: unknown } {
  if (iterations <= 0) return geometry;
  try {
    if (geometry.type === 'Polygon') {
      const rings = geometry.coordinates as GeoRing[];
      return {
        type: 'Polygon',
        coordinates: rings.map(ring => toGeoRing(chaikinSmoothRing(toLatLngRing(ring), iterations))),
      };
    }
    if (geometry.type === 'MultiPolygon') {
      const polys = geometry.coordinates as GeoRing[][];
      return {
        type: 'MultiPolygon',
        coordinates: polys.map(rings =>
          rings.map(ring => toGeoRing(chaikinSmoothRing(toLatLngRing(ring), iterations)))
        ),
      };
    }
  } catch {
    return geometry;
  }
  return geometry;
}
