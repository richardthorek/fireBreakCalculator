/**
 * Painted-area AOI — owner feedback (2026-07-26): "selecting the origin and
 * destination areas should be like colouring in cells on the map rather than
 * drawing a line, with options for size of brush that remain consistent as I
 * zoom in and out (so zooming out effectively paints a larger area, zooming
 * in gets more specific)." Later same day: "add an erase function."
 *
 * A painted area is an ORDERED sequence of paint/erase strokes, each one a
 * circular "dab". Each dab's ON-SCREEN radius is fixed (one of the brush
 * sizes below, in pixels) at the moment it's painted, but its GROUND radius
 * is computed from the map's zoom/latitude at that instant — the standard
 * Web Mercator metres-per-pixel relationship — so the same brush paints a
 * bigger real area when zoomed out and a smaller, more precise one zoomed
 * in. Once painted, a dab's ground radius is fixed (it doesn't resize as the
 * user continues zooming), so the painted area reads as a real, stable patch
 * of ground, not a screen-relative cursor.
 *
 * Strokes are kept in ORDER (not two separate "painted"/"erased" sets)
 * because that's the only model that gives an eraser its expected meaning:
 * erase a mistake, then paint back over the same spot, and it reappears —
 * exactly like any paint/eraser tool. A model that just subtracted a
 * standing "erased" set from a standing "painted" set would get that wrong
 * (the erased spot would never come back). `resolvePaintedAreaGeometry`
 * replays the strokes in order — union on paint, difference on erase — via
 * `@turf/union`/`@turf/difference` rather than a hand-rolled polygon-clip
 * algorithm, for the same correctness reasons docs/ROUTE_INTELLIGENCE.md §17
 * gives for using standard max-flow/min-cut instead of a bespoke
 * construction: this is exactly the kind of computational-geometry code
 * where a subtly-wrong DIY implementation is a real risk.
 */

import type { Polygon, MultiPolygon, Feature } from 'geojson';
import { union } from '@turf/union';
import { difference } from '@turf/difference';
import { polygon as turfPolygon, featureCollection } from '@turf/helpers';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { LatLng } from '../utils/chainage';

export interface PaintDab {
  lat: number;
  lng: number;
  radiusM: number;
}

export type PaintStrokeMode = 'paint' | 'erase';

export interface PaintStroke {
  mode: PaintStrokeMode;
  dab: PaintDab;
}

export type PaintedArea = PaintStroke[];

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

function dabToTurfPolygon(dab: PaintDab) {
  return turfPolygon([dabToPolygon(dab).map(p => [p.lng, p.lat])]);
}

/**
 * Replays every stroke IN ORDER — union on `paint`, difference on `erase` —
 * into the single resolved shape the map renders and the grid builder tests
 * cell membership against. Returns null for an empty area, or when erasing
 * has removed everything painted so far.
 */
export function resolvePaintedAreaGeometry(area: PaintedArea): Polygon | MultiPolygon | null {
  const acc = applyStrokes(null, area);
  return acc ? acc.geometry : null;
}

/**
 * The incremental form: fold `strokes` onto an ALREADY-RESOLVED accumulator
 * and return the new one, so a live drag only pays for the dab it just laid
 * down instead of replaying the whole stroke history.
 *
 * This matters for feel, not just throughput (owner, 2026-07-27: "ensure the
 * painting happens during the drag and not at the end"). Replaying every
 * stroke on every dab makes the work quadratic in stroke count, and since each
 * replay is real polygon-boolean work, a long stroke visibly falls behind the
 * finger — the painted shape then appears to catch up in a lump when the drag
 * stops. The strokes array is append-only during a drag, so the caller can
 * keep the accumulator and extend it, which keeps the cost per dab constant.
 *
 * Returns the accumulator unchanged (`null`) when erasing before anything has
 * been painted — there is nothing to subtract from.
 */
export function applyStrokes(
  acc: Feature<Polygon | MultiPolygon> | null,
  strokes: PaintedArea
): Feature<Polygon | MultiPolygon> | null {
  let current = acc;
  for (const stroke of strokes) {
    const dabPoly = dabToTurfPolygon(stroke.dab);
    if (stroke.mode === 'paint') {
      current = current ? (union(featureCollection([current, dabPoly])) ?? current) : dabPoly;
    } else if (current) {
      current = difference(featureCollection([current, dabPoly]));
    }
  }
  return current;
}

/** True when `point` falls within the resolved (paint-minus-erase) shape.
 *  Callers that test many points against the same area should resolve the
 *  geometry ONCE via `resolvePaintedAreaGeometry` and reuse it here, rather
 *  than re-resolving per point. */
export function isInsideResolvedArea(point: LatLng, geometry: Polygon | MultiPolygon | null): boolean {
  if (!geometry) return false;
  return booleanPointInPolygon([point.lng, point.lat], geometry as any);
}

/** Bounding box covering every dab's full circle (not just its centre).
 *  Deliberately includes erase-stroke dabs too — erasing can only shrink
 *  area already inside the paint bounds, so including them is harmless and
 *  keeps this a cheap, geometry-resolution-free pass over the raw strokes. */
export function paintedAreaBounds(area: PaintedArea): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (area.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const stroke of area) {
    const { dab } = stroke;
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
  return [{ mode: 'paint', dab: { lat: point.lat, lng: point.lng, radiusM } }];
}
