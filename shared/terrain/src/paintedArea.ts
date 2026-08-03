/**
 * Painted-area AOI — owner feedback (2026-07-26): "selecting the origin and
 * destination areas should be like colouring in cells on the map rather than
 * drawing a line, with options for size of brush that remain consistent as I
 * zoom in and out (so zooming out effectively paints a larger area, zooming
 * in gets more specific)." Later same day: "add an erase function."
 *
 * REWORKED 2026-07-27 (owner: "instead of the currently very large arbitrary
 * circle shapes... make the small paint a single 100m hex. Medium is 10 and
 * large is 100. Xl is 1000!" — followed by "ensure the hex grid is the SAME
 * hex grid for analysis and the target painting"). Painting is now REAL
 * DISCRETE HEX CELLS, not a circle approximation: every dab stamps a compact
 * cluster of N hexes (`BRUSH_HEX_COUNT`) at a fixed `PAINT_HEX_SIZE_M`
 * circumradius, using the EXACT SAME hex math (`../utils/hexGrid.ts` —
 * `axialToLocal`/`hexCorners`/`hexSpiral`) the mobility ANALYSIS grid uses,
 * not a second, independently-invented hex implementation.
 *
 * "Same hex grid" does NOT (yet) mean the same SIZE as the analysis grid:
 * the analysis grid's size is chosen AFTER painting finishes
 * (`chooseHexSize`, adapted to the painted AOI's extent to stay inside the
 * ~2200–2800 cell compute budget), so a single shared size is circular until
 * §35 Slice B's lazy grid removes the need to pre-materialise the whole
 * analysis grid up front. Owner's resolution: paint at the fixed brush sizes
 * below now; once the analysis grid's own size is chosen, RECONCILE the
 * painted hex geometry onto it by area overlap — "breaking down or combining
 * cells" — rather than a naive centre-point test (see `mobilityGrid.ts`'s
 * `originKeys`/`objectiveKeys` construction, which does this reconciliation
 * against the polygon this module resolves).
 *
 * ANCHORING: a global, single, fixed hex tiling would DISTORT badly across
 * Australia's real latitude range (`toLocal`'s metres-per-degree-longitude
 * conversion is only locally accurate near its own anchor latitude — a hex
 * grid anchored at, say, -25° would read roughly 20–25% too narrow east-west
 * by the time you're painting near Tasmania or the Cape). Each PaintedArea
 * (one continuous origin or objective blob) instead anchors its OWN local
 * projection at its FIRST dab's click point — every subsequent dab in that
 * same area reuses that anchor (carried on each dab, so the geometry
 * functions stay pure and self-contained) so hexes within one blob tile
 * consistently against each other and stay locally accurate near where the
 * user is actually painting.
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
 * where a subtly-wrong DIY implementation is a real risk. `@turf/union`
 * (v7+) accepts a whole FeatureCollection of N polygons in one call — used
 * here to union a dab's up-to-1000 hex cells in a single pass rather than
 * 1000 sequential pairwise unions.
 */

import type { Polygon, MultiPolygon, Feature } from 'geojson';
import { union } from '@turf/union';
import { difference } from '@turf/difference';
import { polygon as turfPolygon, featureCollection } from '@turf/helpers';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { LatLng } from './chainage';
import {
  AxialCoord, makeProjection, toLocal, toLatLng, axialToLocal, localToAxial, hexCorners, hexSpiral,
  HEX_AREA_FACTOR,
} from './hexGrid';

export type BrushSize = 'small' | 'medium' | 'large' | 'xl';

/** Fixed circumradius, metres, for every painting hex regardless of brush
 *  size — brush size changes CELL COUNT (below), not hex size. Matches the
 *  owner's own "100m hex" spec exactly. */
export const PAINT_HEX_SIZE_M = 100;

/** Hex cells stamped per dab, by brush size — an order-of-magnitude jump per
 *  step (owner: "small paint a single 100m hex. Medium is 10 and large is
 *  100. Xl is 1000!"), not the old zoom-relative pixel radii. */
export const BRUSH_HEX_COUNT: Record<BrushSize, number> = {
  small: 1,
  medium: 10,
  large: 100,
  xl: 1000,
};

/** One painting hex's area, m² — for anything that needs to reason about
 *  ground coverage (e.g. `singleDabArea`'s equivalent-area approximation)
 *  without duplicating the circumradius→area formula. */
export const PAINT_HEX_AREA_M2 = HEX_AREA_FACTOR * PAINT_HEX_SIZE_M * PAINT_HEX_SIZE_M;

/** Equivalent-area circle radius (metres) for a brush size's hex count —
 *  NOT a precise shape (a hex spiral is hexagon-ish, not circular), only an
 *  approximate ground "radius" for anything that just needs a reasonable
 *  size: the on-screen brush cursor, the drag-throttle distance, bbox
 *  padding. Geometry that needs to be exact uses the real hex cells
 *  directly (`dabToTurfPolygon`), never this. */
export function brushApproxRadiusM(brush: BrushSize): number {
  return Math.sqrt((BRUSH_HEX_COUNT[brush] * PAINT_HEX_AREA_M2) / Math.PI);
}

/** Standard Web Mercator ground resolution at a given latitude/zoom (metres
 *  per pixel) — the same formula Mapbox/Google Maps use internally. Used to
 *  convert a brush's FIXED ground size into an on-screen pixel size at the
 *  map's current zoom (the cursor now genuinely grows when zooming in and
 *  shrinks zooming out, the correct behaviour for a real-world-fixed brush —
 *  the inverse of the old fixed-pixel/zoom-relative brush this replaced). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

export interface PaintDab {
  /** The point this dab's local hex projection is anchored on — see the
   *  module header's ANCHORING note. Every dab within one continuous
   *  PaintedArea carries the SAME anchor (its area's first dab's), so their
   *  axial coordinates tile against each other consistently. */
  anchor: LatLng;
  /** Hex cells this dab stamps, axial coordinates relative to `anchor`. */
  hexes: AxialCoord[];
}

export type PaintStrokeMode = 'paint' | 'erase';

export interface PaintStroke {
  mode: PaintStrokeMode;
  dab: PaintDab;
}

export type PaintedArea = PaintStroke[];

/**
 * Build one dab: `brush`'s hex count, stamped as a compact spiral
 * (`hexSpiral`) centred on `clickPoint`. `existingArea` supplies the anchor
 * — its first dab's, if any; this click becomes the anchor when the area is
 * still empty (the very first stroke of a new origin/objective blob).
 */
export function createHexDab(
  existingArea: PaintedArea,
  clickPoint: LatLng,
  brush: BrushSize
): PaintDab {
  const anchor = existingArea.length > 0 ? existingArea[0].dab.anchor : clickPoint;
  const proj = makeProjection(anchor);
  const centerHex = localToAxial(toLocal(proj, clickPoint), PAINT_HEX_SIZE_M);
  const hexes = hexSpiral(centerHex, BRUSH_HEX_COUNT[brush]);
  return { anchor, hexes };
}

/** One dab's hex cells as real lat/lng polygons, unioned into one shape —
 *  ONE `@turf/union` call over the whole collection (not pairwise), so an
 *  XL (1000-hex) dab costs one union pass, not a thousand. */
function dabToTurfPolygon(dab: PaintDab) {
  const proj = makeProjection(dab.anchor);
  const polygons = dab.hexes.map(hex => {
    const center = axialToLocal(hex, PAINT_HEX_SIZE_M);
    const ring = hexCorners(center, PAINT_HEX_SIZE_M).map(p => toLatLng(proj, p));
    ring.push(ring[0]);
    return turfPolygon([ring.map(p => [p.lng, p.lat])]);
  });
  if (polygons.length === 1) return polygons[0];
  return union(featureCollection(polygons)) ?? polygons[0];
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

/** Bounding box covering every dab's hex cluster (not just its centre).
 *  Deliberately includes erase-stroke dabs too — erasing can only shrink
 *  area already inside the paint bounds, so including them is harmless and
 *  keeps this a cheap, geometry-resolution-free pass over the raw strokes.
 *  Uses `brushApproxRadiusM`-style equivalent-area sizing (from the dab's
 *  actual hex count, not a fixed brush lookup) — deliberately generous, since
 *  this only ever pads a search bbox, never drives exact geometry. */
export function paintedAreaBounds(area: PaintedArea): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (area.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const stroke of area) {
    const { dab } = stroke;
    const extentM = Math.sqrt((dab.hexes.length * PAINT_HEX_AREA_M2) / Math.PI);
    const dLat = extentM / 111320;
    const dLng = extentM / (111320 * Math.cos((dab.anchor.lat * Math.PI) / 180));
    minLat = Math.min(minLat, dab.anchor.lat - dLat);
    maxLat = Math.max(maxLat, dab.anchor.lat + dLat);
    minLng = Math.min(minLng, dab.anchor.lng - dLng);
    maxLng = Math.max(maxLng, dab.anchor.lng + dLng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** A single-dab painted area covering a point with approximately `radiusM`
 *  of ground coverage — used by the unit-simulation replan, which needs a
 *  small AOI around the unit's current position without going through the
 *  paint UI. Hex count is the smallest that covers a circle of `radiusM`
 *  (area-equivalent, not a precise circle — a hex spiral is a hexagon-ish
 *  cluster, not a true circle, which is a fine approximation at this use
 *  site's scale). */
export function singleDabArea(point: LatLng, radiusM: number): PaintedArea {
  const targetAreaM2 = Math.PI * radiusM * radiusM;
  const hexCount = Math.max(1, Math.ceil(targetAreaM2 / PAINT_HEX_AREA_M2));
  const proj = makeProjection(point);
  const centerHex = localToAxial(toLocal(proj, point), PAINT_HEX_SIZE_M);
  const hexes = hexSpiral(centerHex, hexCount);
  return [{ mode: 'paint', dab: { anchor: point, hexes } }];
}
