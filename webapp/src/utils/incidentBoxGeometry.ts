/**
 * Incident box geometry primitives: classify a drawn fire-perimeter
 * polygon's vertices by wind sector (head/flank/rear), and offset them
 * outward by a per-sector standoff distance.
 *
 * The standoff DISTANCE itself is not decided here — see
 * `incidentBoxPlanner.ts`, which solves it from the user's own rate-of-spread
 * input and the existing production-time engine ("rate of spread + build
 * time = minimum distance", the owner's own framing). This module only knows
 * geometry: given a perimeter and a distance per sector, produce the ring.
 * Kept separate and pure (no network/async) so it's cheaply unit-testable.
 */

import { LatLng } from '@firebreak/terrain';

export type BoxSector = 'head' | 'leftFlank' | 'rightFlank' | 'rear';

export interface SectorVertex {
  sourcePoint: LatLng;
  sector: BoxSector;
  /** Outward bearing from the perimeter centroid through this vertex, 0-360. */
  outwardBearingDeg: number;
  /** Signed angle (-180, 180] of this vertex off the downwind bearing; sign gives left/right. */
  signedAngleOffDownwindDeg: number;
}

export interface WindLike {
  /** Compass bearing wind is blowing FROM, 0-360 (meteorological convention). */
  directionFromDeg: number;
}

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number { return (deg * Math.PI) / 180; }
function toDeg(rad: number): number { return (rad * 180) / Math.PI; }
function normalizeBearing(deg: number): number { return ((deg % 360) + 360) % 360; }
function normalizeLng(deg: number): number {
  let d = deg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/** Great-circle bearing from A to B, degrees 0-360. */
export function bearingBetween(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeBearing(toDeg(Math.atan2(y, x)));
}

/** Destination point from `origin`, travelling `distanceM` along `bearingDeg`. */
export function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const angularDist = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) + Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: toDeg(lat2), lng: normalizeLng(toDeg(lng2)) };
}

export function centroidOf(points: LatLng[]): LatLng {
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/** Smallest signed angular difference (-180, 180] from a to b. */
function angleDiffSigned(a: number, b: number): number {
  let diff = ((b - a + 180) % 360) - 180;
  if (diff < -180) diff += 360;
  return diff;
}

function sectorFor(signedAngleOffDownwindDeg: number): BoxSector {
  const abs = Math.abs(signedAngleOffDownwindDeg);
  if (abs <= 30) return 'head';
  if (abs >= 150) return 'rear';
  return signedAngleOffDownwindDeg > 0 ? 'rightFlank' : 'leftFlank';
}

/** Bearing the fire is being pushed TOWARD — wind direction + 180. */
export function downwindBearing(wind: WindLike): number {
  return normalizeBearing(wind.directionFromDeg + 180);
}

/** Classify each perimeter vertex into a wind sector. Perimeter need not be closed. */
export function classifySectors(perimeter: LatLng[], wind: WindLike): SectorVertex[] {
  const centroid = centroidOf(perimeter);
  const downwind = downwindBearing(wind);
  return perimeter.map(sourcePoint => {
    const outwardBearingDeg = bearingBetween(centroid, sourcePoint);
    const signedAngleOffDownwindDeg = angleDiffSigned(downwind, outwardBearingDeg);
    return { sourcePoint, sector: sectorFor(signedAngleOffDownwindDeg), outwardBearingDeg, signedAngleOffDownwindDeg };
  });
}

/** Offset each classified vertex outward by its sector's distance, producing the box ring. */
export function offsetBySector(
  vertices: SectorVertex[],
  distanceMBySector: Record<BoxSector, number>
): { point: LatLng; vertex: SectorVertex; offsetM: number }[] {
  return vertices.map(vertex => {
    const offsetM = Math.max(0, distanceMBySector[vertex.sector] ?? 0);
    const point = destinationPoint(vertex.sourcePoint, vertex.outwardBearingDeg, offsetM);
    return { point, vertex, offsetM };
  });
}

/** Closed-ring [lng, lat] coordinates for map rendering / GeoJSON, from offset points. */
export function toClosedRing(points: LatLng[]): [number, number][] {
  const ring: [number, number][] = points.map(p => [p.lng, p.lat]);
  if (ring.length > 0) ring.push(ring[0]);
  return ring;
}
