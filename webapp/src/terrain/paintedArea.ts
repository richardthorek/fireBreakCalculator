/**
 * Painted-area AOI — owner feedback (2026-07-26): "selecting the origin and
 * destination areas should be like colouring in cells on the map rather than
 * drawing a line, with options for size of brush that remain consistent as I
 * zoom in and out (so zooming out effectively paints a larger area, zooming
 * in gets more specific)."
 *
 * A painted area is the union of circular "dabs" laid down while the user
 * drags over the map. Each dab's ON-SCREEN radius is fixed (one of the brush
 * sizes below, in pixels) at the moment it's painted, but its GROUND radius
 * is computed from the map's zoom/latitude at that instant — the standard
 * Web Mercator metres-per-pixel relationship — so the same brush paints a
 * bigger real area when zoomed out and a smaller, more precise one zoomed
 * in, exactly as asked. Once painted, a dab's ground radius is fixed (it
 * doesn't resize as the user continues zooming), so the painted area reads
 * as a real, stable patch of ground, not a screen-relative cursor.
 */

import { LatLng } from '../utils/chainage';
import { calculateDistance } from '../utils/slopeCalculation';

export interface PaintDab {
  lat: number;
  lng: number;
  radiusM: number;
}

export type PaintedArea = PaintDab[];

export type BrushSize = 'small' | 'medium' | 'large';

/** On-screen brush radius, pixels — the part that stays constant across zoom. */
export const BRUSH_PIXEL_RADIUS: Record<BrushSize, number> = {
  small: 18,
  medium: 34,
  large: 60,
};

/** Standard Web Mercator ground resolution at a given latitude/zoom
 *  (metres per pixel) — the same formula Mapbox/Google Maps use internally. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** Ground radius, metres, for a brush size painted at the given lat/zoom. */
export function brushRadiusMeters(brush: BrushSize, lat: number, zoom: number): number {
  return BRUSH_PIXEL_RADIUS[brush] * metersPerPixel(lat, zoom);
}

/** Destination point at `bearingDeg` and `distanceM` from `origin` —
 *  standard spherical-earth direct geodesic formula. */
function destinationPoint(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const R = 6371000;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const angularDist = distanceM / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) + Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (((lng2 * 180) / Math.PI + 540) % 360) - 180 };
}

/** Approximate a dab as a closed N-gon polygon in real lat/lng (a circle of
 *  its fixed ground radius) — for map rendering, independent of zoom. */
export function dabToPolygon(dab: PaintDab, steps = 24): LatLng[] {
  const ring: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (360 * i) / steps;
    ring.push(destinationPoint(dab, bearing, dab.radiusM));
  }
  return ring;
}

/** True when `point` falls within ANY dab in the painted area — the
 *  union-of-circles membership test the grid builder uses to decide which
 *  cells count as "in" the origin/objective area. */
export function isInsidePaintedArea(point: LatLng, area: PaintedArea): boolean {
  return area.some(dab => calculateDistance(point.lat, point.lng, dab.lat, dab.lng) <= dab.radiusM);
}

/** Bounding box covering every dab's full circle (not just its centre). */
export function paintedAreaBounds(area: PaintedArea): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (area.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const dab of area) {
    const dLat = dab.radiusM / 111320;
    const dLng = dab.radiusM / (111320 * Math.cos((dab.lat * Math.PI) / 180));
    minLat = Math.min(minLat, dab.lat - dLat);
    maxLat = Math.max(maxLat, dab.lat + dLat);
    minLng = Math.min(minLng, dab.lng - dLng);
    maxLng = Math.max(maxLng, dab.lng + dLng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** A single-dab painted area covering a point with a fixed metre radius —
 *  used by the unit-simulation replan, which needs a small AOI around the
 *  unit's current position without going through the paint UI. */
export function singleDabArea(point: LatLng, radiusM: number): PaintedArea {
  return [{ lat: point.lat, lng: point.lng, radiusM }];
}
