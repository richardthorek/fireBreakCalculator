/**
 * Grid sampling for the Terrain Mobility mode — mirrors areaScan.ts's box
 * scan pattern (same hex machinery, same elevation/vegetation caches, so a
 * mobility run shares cache hits with any prior fire-break analysis or area
 * recon over the same ground) but also resolves trail proximity per cell,
 * which areaScan.ts deliberately skips (terrain+vegetation only, no
 * pathfinding claim). Trail-on cells matter here because they change both
 * speed (road vs cross-country factor) and vegetation passability (already
 * broken ground).
 *
 * Origin/objective areas are PAINTED (docs owner feedback 2026-07-26) — an
 * ordered sequence of paint/erase dabs (paintedArea.ts), not a drawn
 * rectangle — resolved ONCE per area into a single polygon
 * (`resolvePaintedAreaGeometry`) and tested per cell via a real area-overlap
 * fraction (`isPaintedAreaMember`/`paintedOverlapFraction`), not a bbox or
 * centre-point check: painting always tiles at a fixed 100m hex size
 * (paintedArea.ts) while this grid's own hex size is chosen independently
 * for the scale of the area (`chooseHexSize`), so the two tilings essentially
 * never line up — "breaking down or combining cells" (docs owner feedback
 * 2026-07-27), done geometrically rather than by literally re-tiling either
 * grid.
 */

import type { Polygon, MultiPolygon, Feature } from 'geojson';
import { intersect } from '@turf/intersect';
import { area as turfArea } from '@turf/area';
import { polygon as turfPolygon, featureCollection } from '@turf/helpers';
import { LatLng } from '../utils/chainage';
import { calculateDistance } from '../utils/slopeCalculation';
import {
  makeProjection, toLocal, toLatLng, hexKey, chooseHexSize, generateBoxHexes, hexCorners,
  LocalProjection, LocalPoint,
} from '../utils/hexGrid';
import { sampleElevationsCached, sampleVegetation } from '../utils/routeOptimizer';
import {
  fetchCorridorMobilityRoads, fetchCorridorWaterways, distanceToNearestTrail, distanceToNearestWater,
  InfrastructureTrail,
} from '../utils/infrastructureService';
import { MobilityGridCell } from './accumulatedCost';
import { PaintedArea, paintedAreaBounds, resolvePaintedAreaGeometry } from './paintedArea';
import { computeDemDerivatives } from './dataLayers/demDerivatives';
import { fetchSurfaceWaterFrequencyArea, sampleSurfaceWaterFrequencyRaster } from './dataLayers/deaWaterObservationsService';
import { RoadWayTags } from './roadSpeedModel';

// Raised from 1400/1800 (2026-07-26, "think about a larger area"): both
// upstream sampling calls this grid depends on are already area-batched, not
// per-point (sampleVegetation resolves from at most two area requests once
// enough points are uncached; sampleElevationsCached batches misses in one
// call) — the "hundreds of upstream requests" risk that keeps NAFI/DEA point
// queries capped small (docs §10.7, dataLayers/nafiFireHistoryService.ts)
// does not apply here. The search itself is O(cells log cells) in a Web
// Worker, and demDerivatives.ts's per-cell plane fit + one MFD accumulation
// pass are the same order — both stay well under a second at this size.
const TARGET_CELL_COUNT = 2200;
const MAX_HEX_CELLS = 2800;
const TRAIL_SNAP_M = 30;
/** How close a cell (or one of its hex corners — see `waterDistanceM`'s own
 *  doc) has to come to a mapped watercourse to count as "on it" for the
 *  fording gate. Matches `TRAIL_SNAP_M`'s own precedent rather than inventing
 *  a different tolerance for the same class of problem (a linear OSM feature
 *  vs a hex grid). */
const WATER_SNAP_M = 30;

export interface MobilityGridResult {
  cells: MobilityGridCell[];
  hexSize: number;
  proj: LocalProjection;
  /** Cell keys whose centre falls inside the painted origin area — the
   *  multi-source search's super-source seed set. */
  originKeys: string[];
  /** Cell keys whose centre falls inside the painted objective area — the
   *  target set `extractPath` picks the cheapest-reached cell from. */
  objectiveKeys: string[];
  usedEstimatedData: boolean;
  infrastructureAvailable: boolean;
  /** True when EITHER hydrology source (OSM waterway/water-body geometry, DEA
   *  WOfS frequency) returned real data for this AOI — the run log and the
   *  panel both need to say plainly when the water gate had nothing to work
   *  from, the same honesty `infrastructureAvailable` already provides for
   *  trails. */
  hydrologyAvailable: boolean;
  /** The raw OSM waterway/water-body geometry this run fetched (docs §34) —
   *  kept alongside the per-cell derived fields so the map can draw the
   *  ACTUAL mapped river/lake shape as its own reference layer, not just the
   *  hex cells it influenced. Empty when hydrologyAvailable's OSM half
   *  returned nothing (query failed, or genuinely no mapped water here). */
  waterFeatures: InfrastructureTrail[];
  /** The raw OSM `highway-mobility` ways this run fetched (motorway/trunk/
   *  primary included — docs §35) — kept alongside the per-cell `onTrail`
   *  derived fields so a box-free ROAD-GRAPH search (`roadRouteSearch.ts`)
   *  can be built from the SAME fetch, not a second network round-trip.
   *  Empty when infrastructureAvailable is false. */
  roadWays: InfrastructureTrail[];
  /** True when the painted AOI was large enough that the hex size had to be
   *  coarsened (doubled at least once) to stay inside MAX_HEX_CELLS — an
   *  honesty flag, not a silent trade-off: a coarsened grid is still a real
   *  search over real samples, but at lower spatial resolution than the
   *  target, so a narrow gap or a short-radius obstacle may not survive
   *  being averaged into a bigger cell. */
  usedCoarseGrid: boolean;
  /** The pad factor this attempt actually used (docs §35) — honesty field so
   *  the log/UI can say plainly when a run needed a wider-than-default search
   *  to find its route, distinguishing "there is no way" from "the first
   *  attempt wasn't allowed to look far enough" (the exact framing of the
   *  original field report). */
  boundsPadFactor: number;
  /** The actual box this attempt searched, in lat/lng — kept so a failed
   *  attempt's caller (`mobilityAppreciation.ts`'s retry loop) can work out
   *  WHICH edge(s) the reachable frontier actually touched, rather than
   *  growing the box uniformly on the next attempt (owner, 2026-07-27: "if
   *  it still hits the edge then it loads a new tile from the point of
   *  where it hit"). */
  boundsSw: LatLng;
  boundsNe: LatLng;
}

/** Real overlap fraction (0..1) between one hex cell's actual polygon and a
 *  resolved painted-area shape — geodesic area via `@turf/area`/
 *  `@turf/intersect`, not a projected approximation, since both inputs are
 *  already plain lng/lat rings. */
export function paintedOverlapFraction(cellCorners: LatLng[], geom: Polygon | MultiPolygon | null): number {
  if (!geom) return 0;
  const ring = [...cellCorners, cellCorners[0]].map(p => [p.lng, p.lat] as [number, number]);
  const cellPoly = turfPolygon([ring]);
  const cellAreaM2 = turfArea(cellPoly);
  if (cellAreaM2 <= 0) return 0;
  const geomFeature: Feature<Polygon | MultiPolygon> = { type: 'Feature', properties: {}, geometry: geom };
  let intersection;
  try {
    intersection = intersect(featureCollection([cellPoly, geomFeature]));
  } catch {
    return 0;
  }
  if (!intersection) return 0;
  return Math.min(1, turfArea(intersection) / cellAreaM2);
}

/** Minimum area-overlap fraction for an analysis hex to count as part of a
 *  painted area. Low enough that a patch painted off-centre (rather than
 *  dead-centre of the cell) still registers, high enough that a cell merely
 *  brushing the edge of a large painted region doesn't falsely seed the
 *  whole cell as origin/objective. */
export const PAINTED_OVERLAP_THRESHOLD = 0.15;

export function isPaintedAreaMember(cellCorners: LatLng[], geom: Polygon | MultiPolygon | null): boolean {
  return paintedOverlapFraction(cellCorners, geom) >= PAINTED_OVERLAP_THRESHOLD;
}

/** The cell whose centre is closest to `point` — the "never an empty seed
 *  set" fallback below needs an actual NEAREST cell, not an arbitrary array
 *  index. A small brush dab on a coarse (large-AOI) grid can legitimately
 *  clear the 15% overlap threshold on NO cell at all (the painted patch is
 *  smaller than any single analysis hex), and `cells[0]`/`cells[last]` are
 *  whatever `generateBoxHexes` happened to emit first/last — typically a
 *  corner of the bounding box, nowhere near where the user actually
 *  painted. Squared distance only (comparison, not a real length). */
function nearestCellKey(cells: MobilityGridCell[], point: LatLng): string {
  let bestKey = cells[0].key;
  let bestD = Infinity;
  for (const c of cells) {
    const dLat = c.center.lat - point.lat;
    const dLng = c.center.lng - point.lng;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) { bestD = d; bestKey = c.key; }
  }
  return bestKey;
}

/**
 * Build and sample a hex grid covering `origin`, `objective` (padded so the
 * search has room either side to route around obstacles) and everything
 * between them.
 *
 * `boundsPadFactor` (docs §35 — the Lake George defect): the AOI is padded by
 * this fraction of the REAL distance between the origin and objective
 * centroids (not either axis's own incidental span — see the padding code's
 * own comment for the bug that distinction fixes). Defaults to 0.2, but the
 * caller (`mobilityAppreciation.ts`'s escalating retry) passes a LARGER
 * value when a search at a smaller pad found no route, so an obstacle that
 * genuinely needs more room to detour around gets it on retry, instead of
 * every run paying for maximum padding up front. This is a scoped response
 * to §35's root defect — expand-and-retry, not the full lazy-grid/cost-
 * budget/corridor-termination architecture that section also designs (still
 * open, tracked separately) — but it directly fixes the reported mechanism:
 * padding that didn't actually grow with the real scale of the obstacle,
 * regardless of whether a route was found.
 */
/** Minimum absolute padding, metres — floors the degenerate case where
 *  origin and objective are painted close together (spanM near 0) but the
 *  search still needs SOME room to route around a small local obstacle. */
const MIN_PAD_M = 200;

export interface PaddedBounds {
  boundsSw: LatLng;
  boundsNe: LatLng;
}

/**
 * The padded search box for one attempt — a pure, unit-testable function
 * separated out specifically so the padding FORMULA can be tested without
 * going through `buildMobilityGrid`'s network calls.
 *
 * FIELD-CONFIRMED BUG (2026-07-27, live test against the real Lake George):
 * padding used to be `(axis span) * boundsPadFactor` — for a due-EAST
 * crossing, origin and objective sit at nearly the SAME latitude, so
 * `maxLat - minLat` is just the two painted blobs' own thickness (tens to
 * low hundreds of metres), not the scale of the obstacle between them.
 * Multiplying a near-zero number by any factor — 0.2 or 4.0 — stays
 * near-zero: the retry mechanism was scaling the WRONG base quantity and
 * never actually gave the search meaningful north–south room, exactly
 * reproducing the original defect it was built to fix. (Symmetric failure
 * for a due-NORTH/SOUTH crossing, where `maxLng - minLng` would be the
 * near-zero one instead.) The earlier `expandingSearchLakeGeorge.test.ts`
 * proof did not catch this: it built its synthetic grid directly from raw
 * local coordinates, bypassing this function entirely, so it validated
 * "a wide-enough box finds the route" but never validated "does the retry
 * mechanism actually PRODUCE a wide-enough box" — exactly where the bug was.
 *
 * Fix: pad by a fraction of the REAL distance between the origin and
 * objective centroids (haversine, metres), applied EQUALLY to both lat and
 * lng, regardless of which axis the crossing happens to run along. A
 * due-east 25 km crossing at boundsPadFactor=0.2 now gets ~5 km of room on
 * every side (10 km total north–south) — a real, geometry-independent
 * budget, not an accident of which axis the two paint blobs happened to
 * differ on.
 */
export function computePaddedBounds(
  originBounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  objectiveBounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  boundsPadFactor: number
): PaddedBounds | null {
  const minLat = Math.min(originBounds.minLat, objectiveBounds.minLat);
  const maxLat = Math.max(originBounds.maxLat, objectiveBounds.maxLat);
  const minLng = Math.min(originBounds.minLng, objectiveBounds.minLng);
  const maxLng = Math.max(originBounds.maxLng, objectiveBounds.maxLng);
  if (maxLat - minLat < 1e-6 || maxLng - minLng < 1e-6) return null;

  const originCentroid: LatLng = { lat: (originBounds.minLat + originBounds.maxLat) / 2, lng: (originBounds.minLng + originBounds.maxLng) / 2 };
  const objectiveCentroid: LatLng = { lat: (objectiveBounds.minLat + objectiveBounds.maxLat) / 2, lng: (objectiveBounds.minLng + objectiveBounds.maxLng) / 2 };
  const spanM = calculateDistance(originCentroid.lat, originCentroid.lng, objectiveCentroid.lat, objectiveCentroid.lng);

  // A SQUARE box, not independent per-axis padding (owner, 2026-07-27,
  // refining the fix live: "a 'more' square ratio could be a good way to
  // start. So that one axis of loaded data is more similar to the linear
  // distance so we have a proportionate area of data to work with"). Padding
  // each axis by "the same delta" still leaves a due-east crossing's
  // north-south extent far short of its east-west one, because the
  // near-zero own latitude span only gets the delta ADDED to it, never
  // brought up to the same SCALE as the travel distance. Targeting a square
  // side directly fixes that: side = spanM * (1 + 2*boundsPadFactor),
  // centred on the origin/objective midpoint, giving the perpendicular axis
  // genuinely comparable room from the FIRST attempt, not just after a
  // targeted retry.
  const targetSideM = Math.max(spanM * (1 + 2 * boundsPadFactor), MIN_PAD_M * 2);
  const halfSideM = targetSideM / 2;
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const halfLatDeg = halfSideM / 111320;
  const halfLngDeg = halfSideM / (111320 * Math.max(0.05, Math.cos((midLat * Math.PI) / 180)));

  // Never clip below the origin/objective areas' OWN footprint — a large
  // painted blob wider than the target square must still be fully covered.
  return {
    boundsSw: { lat: Math.min(midLat - halfLatDeg, minLat), lng: Math.min(midLng - halfLngDeg, minLng) },
    boundsNe: { lat: Math.max(midLat + halfLatDeg, maxLat), lng: Math.max(midLng + halfLngDeg, maxLng) },
  };
}

/** Real distance (metres) between the origin and objective painted areas'
 *  bounding-box centroids — the SAME base quantity `computePaddedBounds`
 *  scales from. Exported so `mobilityAppreciation.ts`'s retry loop can size
 *  its own growth steps off the identical number, rather than a second,
 *  possibly-inconsistent calculation. */
export function originObjectiveDistanceM(origin: PaintedArea, objective: PaintedArea): number | null {
  const originBounds = paintedAreaBounds(origin);
  const objectiveBounds = paintedAreaBounds(objective);
  if (!originBounds || !objectiveBounds) return null;
  const originCentroid: LatLng = { lat: (originBounds.minLat + originBounds.maxLat) / 2, lng: (originBounds.minLng + originBounds.maxLng) / 2 };
  const objectiveCentroid: LatLng = { lat: (objectiveBounds.minLat + objectiveBounds.maxLat) / 2, lng: (objectiveBounds.minLng + objectiveBounds.maxLng) / 2 };
  return calculateDistance(originCentroid.lat, originCentroid.lng, objectiveCentroid.lat, objectiveCentroid.lng);
}

/** How close to a box edge (as a fraction of that edge's own dimension) a
 *  reachable cell must sit to count as "the frontier touched this edge" —
 *  loose enough to survive hex-grid jitter near the boundary, tight enough
 *  not to count cells that were nowhere near actually being edge-blocked. */
const EDGE_BAND_FRACTION = 0.1;

export interface FrontierEdges {
  north: boolean;
  south: boolean;
  east: boolean;
  west: boolean;
}

/**
 * Which edges of `bounds` the reachable frontier actually touched, from the
 * RESULTS of a failed search attempt over that exact box (owner, 2026-07-27,
 * live-testing the real Lake George: "the path finding didn't continue
 * seeking the destination once it hit an edge... if it still hits the edge
 * then it loads a new tile from the point of where it hit"). Only cells with
 * a finite `timeSeconds` (genuinely reached from the origin) count — a
 * NO-GO/unreached cell sitting at the edge says nothing about whether
 * extending that direction would help; it means the search was stopped by
 * TERRAIN before it ever got there, not by the box.
 */
export function frontierTouchedEdges(
  bounds: PaddedBounds,
  results: { center: LatLng; timeSeconds: number }[]
): FrontierEdges {
  const latSpan = bounds.boundsNe.lat - bounds.boundsSw.lat;
  const lngSpan = bounds.boundsNe.lng - bounds.boundsSw.lng;
  const latBand = latSpan * EDGE_BAND_FRACTION;
  const lngBand = lngSpan * EDGE_BAND_FRACTION;

  const edges: FrontierEdges = { north: false, south: false, east: false, west: false };
  for (const r of results) {
    if (!isFinite(r.timeSeconds)) continue;
    if (r.center.lat >= bounds.boundsNe.lat - latBand) edges.north = true;
    if (r.center.lat <= bounds.boundsSw.lat + latBand) edges.south = true;
    if (r.center.lng >= bounds.boundsNe.lng - lngBand) edges.east = true;
    if (r.center.lng <= bounds.boundsSw.lng + lngBand) edges.west = true;
  }
  return edges;
}

/**
 * The next attempt's box — grows ONLY the edges the frontier actually
 * touched (`frontierTouchedEdges`), by `growM` metres, rather than
 * re-deriving a fresh uniform box from a bigger `boundsPadFactor`. An edge
 * the frontier never reached (blocked by terrain well before the boundary,
 * or simply not the useful direction) gains nothing from being pushed
 * further out, so it is left alone — this is what makes a retry TARGETED
 * (chase the direction the search itself was actually trying to go)
 * instead of an ever-larger square that burns compute/resolution growing
 * directions that were never going to help.
 *
 * Falls back to growing EVERY edge when none were touched at all — a fully
 * terrain-boxed attempt (blocked by immediate water/slope on every side
 * before reaching any boundary) gives no directional hint, so the safest
 * default is the same symmetric growth `computePaddedBounds` itself uses.
 */
export function growBoundsTowardFrontier(
  bounds: PaddedBounds,
  edges: FrontierEdges,
  growM: number
): PaddedBounds {
  const midLat = (bounds.boundsSw.lat + bounds.boundsNe.lat) / 2;
  const growLat = growM / 111320;
  const growLng = growM / (111320 * Math.max(0.05, Math.cos((midLat * Math.PI) / 180)));
  const growAny = edges.north || edges.south || edges.east || edges.west;

  return {
    boundsSw: {
      lat: bounds.boundsSw.lat - (!growAny || edges.south ? growLat : 0),
      lng: bounds.boundsSw.lng - (!growAny || edges.west ? growLng : 0),
    },
    boundsNe: {
      lat: bounds.boundsNe.lat + (!growAny || edges.north ? growLat : 0),
      lng: bounds.boundsNe.lng + (!growAny || edges.east ? growLng : 0),
    },
  };
}

export async function buildMobilityGrid(
  origin: PaintedArea,
  objective: PaintedArea,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    boundsPadFactor?: number;
    /** Bypasses `computePaddedBounds` entirely when supplied — the targeted-
     *  retry path (`mobilityAppreciation.ts`'s `growBoundsTowardFrontier`):
     *  grow the box specifically toward whichever edge the reachable
     *  frontier actually touched on a failed attempt, rather than
     *  re-deriving a fresh symmetric box from `boundsPadFactor`. */
    explicitBounds?: PaddedBounds;
  } = {}
): Promise<MobilityGridResult | null> {
  const { signal, onProgress, boundsPadFactor = 0.2, explicitBounds } = options;

  const originBounds = paintedAreaBounds(origin);
  const objectiveBounds = paintedAreaBounds(objective);
  if (!originBounds || !objectiveBounds) return null;

  // Pad either side so the search has room to route around obstacles rather
  // than being boxed in exactly between the two AOIs — see
  // `computePaddedBounds`'s own doc comment for the bug this formula fixes.
  const padded = explicitBounds ?? computePaddedBounds(originBounds, objectiveBounds, boundsPadFactor);
  if (!padded) return null;
  const { boundsSw, boundsNe } = padded;

  const center: LatLng = { lat: (boundsSw.lat + boundsNe.lat) / 2, lng: (boundsSw.lng + boundsNe.lng) / 2 };
  const proj = makeProjection(center);
  const boxMinLocal = toLocal(proj, boundsSw);
  const boxMaxLocal = toLocal(proj, boundsNe);
  const min: LocalPoint = { x: Math.min(boxMinLocal.x, boxMaxLocal.x), y: Math.min(boxMinLocal.y, boxMaxLocal.y) };
  const max: LocalPoint = { x: Math.max(boxMinLocal.x, boxMaxLocal.x), y: Math.max(boxMinLocal.y, boxMaxLocal.y) };
  const width = max.x - min.x;
  const height = max.y - min.y;
  if (width < 10 || height < 10) return null;

  let size = chooseHexSize(Math.max(width, height), Math.min(width, height) / 2, TARGET_CELL_COUNT);
  let cellsRaw = generateBoxHexes(min, max, size);
  let tries = 0;
  while (cellsRaw.length > MAX_HEX_CELLS && tries < 5) {
    size *= 1.25;
    cellsRaw = generateBoxHexes(min, max, size);
    tries++;
  }
  if (cellsRaw.length < 1) return null;
  if (signal?.aborted) return null;
  onProgress?.(0.05);

  const points = cellsRaw.map(c => toLatLng(proj, c.center));
  // Corner points too — see `waterDistanceM`'s doc comment on why a linear
  // watercourse narrower than the hex is more likely caught this way than by
  // testing cell centres alone. Local coords converted once here, alongside
  // the centres, rather than recomputed per cell in the sampling loop below.
  const cornerPoints = cellsRaw.map(c => hexCorners(c.center, size).map(p => toLatLng(proj, p)));

  const [elevRes, vegRes, infra, waterways, waterFrequencyRaster] = await Promise.all([
    sampleElevationsCached(points),
    sampleVegetation(points, signal, (done, total) => onProgress?.(0.05 + 0.55 * (done / Math.max(1, total))),
      { minLat: boundsSw.lat, minLng: boundsSw.lng, maxLat: boundsNe.lat, maxLng: boundsNe.lng }),
    // 'highway-mobility' (docs §35 — the wider road set, motorway/trunk/
    // primary included), NOT the fire-break optimizer's REUSABLE_HIGHWAYS
    // default: a hex sitting on a motorway is exactly the case a movement/
    // denial appreciation most needs to register as onTrail, and the
    // fire-break "reusable broken ground" set deliberately excludes it. Also
    // carries surface/tracktype/smoothness per way, feeding the road-class
    // speed ceiling below.
    fetchCorridorMobilityRoads(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsNe.lng, signal).catch(() => ({ trails: [], available: false })),
    // Hydrology (docs §34) — two independent sources, batched exactly like
    // everything else here (one request each regardless of grid size, not
    // per-cell): OSM waterway/water-body geometry for a crisp, resolution-
    // independent "is there a mapped watercourse here" answer, and DEA WOfS
    // for a measured (if colour-ramp-approximated) wet-frequency where OSM
    // tagging is sparse. Neither failure blocks the run — a hydrology-blind
    // appreciation degrades to what Pass 1-4 already shipped, flagged via
    // `hydrologyAvailable` rather than silently.
    fetchCorridorWaterways(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsNe.lng, signal).catch(() => ({ trails: [], available: false })),
    fetchSurfaceWaterFrequencyArea(
      { minLat: boundsSw.lat, minLng: boundsSw.lng, maxLat: boundsNe.lat, maxLng: boundsNe.lng }, signal
    ).catch(() => null),
  ]);
  if (signal?.aborted) return null;
  onProgress?.(0.65);

  const cells: MobilityGridCell[] = cellsRaw.map((c, i) => {
    const center = points[i];
    let waterDistanceM = Infinity;
    let inWaterBody = false;
    let nearestWaterwayKind: string | null = null;
    if (waterways.trails.length > 0) {
      // Centre + six hex corners (see the field's own doc comment on why):
      // stop the moment any sample point lands inside/on the water, since
      // nothing can beat 0.
      const samplePoints = [center, ...cornerPoints[i]];
      for (const p of samplePoints) {
        const d = distanceToNearestWater(p, waterways.trails);
        if (d < waterDistanceM) waterDistanceM = d;
        if (waterDistanceM <= 0) break;
      }
      // Any sample point — not just the centre — landing inside a water BODY
      // is enough: a lake's edge clipping a hex corner is still the lake, and
      // a centre-only check missed that cell entirely.
      const waterBodyFeatures = waterways.trails.filter(f => f.kind === 'water');
      if (waterBodyFeatures.length > 0) {
        inWaterBody = samplePoints.some(p => distanceToNearestWater(p, waterBodyFeatures, 0) === 0);
      }
      if (waterDistanceM <= WATER_SNAP_M) {
        // Representative severity label: the nearest LINEAR watercourse class
        // (river/canal/stream) within snap distance of the cell centre. A
        // water BODY doesn't need this — `inWaterBody` already says enough,
        // and `estimateFordingRequirement` in mobilityCost.ts treats a body as
        // maximally severe regardless of a nearby line's class.
        let bestD = Infinity;
        for (const feature of waterways.trails) {
          if (feature.kind === 'water') continue;
          const d = distanceToNearestTrail(center, [feature], WATER_SNAP_M);
          if (d < bestD) { bestD = d; nearestWaterwayKind = feature.kind; }
        }
        if (bestD > WATER_SNAP_M) nearestWaterwayKind = null;
      }
    }
    const waterFrequency = waterFrequencyRaster
      ? sampleSurfaceWaterFrequencyRaster(waterFrequencyRaster, center.lat, center.lng)?.frequency ?? null
      : null;

    // onTrail + the nearest trail's own tags in ONE scan (docs §35) — the
    // road-class speed model (roadSpeedModel.ts) needs surface/tracktype/
    // smoothness, not just "is there a trail here", so this now finds the
    // SAME nearest feature onTrail already needed rather than re-scanning
    // `infra.trails` a second time for it.
    let onTrail = false;
    let nearestTrailTags: RoadWayTags | null = null;
    if (infra.trails.length > 0) {
      let bestD = Infinity;
      for (const feature of infra.trails) {
        const d = distanceToNearestTrail(center, [feature], TRAIL_SNAP_M);
        if (d < bestD) {
          bestD = d;
          nearestTrailTags = { highway: feature.kind, surface: feature.surface, tracktype: feature.tracktype, smoothness: feature.smoothness };
        }
        if (bestD <= 0) break; // nothing can beat 0
      }
      onTrail = bestD <= TRAIL_SNAP_M;
      if (!onTrail) nearestTrailTags = null;
    }

    return {
      key: hexKey(c.hex),
      hex: c.hex,
      center,
      elevation: elevRes.elevations[i],
      vegetation: vegRes[i].type,
      vegEstimated: vegRes[i].estimated,
      onTrail,
      nearestTrailTags,
      crossSlopeDeg: 0, // filled in below once the grid is finalised
      waterDistanceM,
      inWaterBody,
      nearestWaterwayKind,
      waterFrequency,
    };
  });

  // Real cross-slope, not the dormant "always unknown" placeholder Pass 1
  // shipped with (docs §10.7 M3a / §3's own stated scope cut) — computed
  // once here from the elevation grid already in hand, no new network call.
  // `edgeMobilityCost`'s hard side-slope NO-GO gate only ever fires when a
  // real number reaches it; this is what makes that gate live instead of
  // permanently inert.
  const derivatives = computeDemDerivatives(cells);
  for (const cell of cells) {
    cell.crossSlopeDeg = derivatives.get(cell.key)?.crossSlopeDeg ?? 0;
  }

  // Resolve each painted area's paint/erase strokes into one shape ONCE
  // here, rather than per cell — the geometry-boolean-ops replay is real
  // work, membership testing against the already-resolved shape is cheap.
  const originGeom = resolvePaintedAreaGeometry(origin);
  const objectiveGeom = resolvePaintedAreaGeometry(objective);
  const originKeys = cells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], originGeom)).map(c => c.key);
  const objectiveKeys = cells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], objectiveGeom)).map(c => c.key);

  onProgress?.(0.7);

  // Fording depth is always a Tier 0 assumption (estimateFordingRequirement
  // in mobilityCost.ts), so a run whose only estimated ingredient is "this
  // cell needed a fording judgement" must still trip the honesty flag — not
  // just elevation/vegetation fallback.
  const usedHydrologyEstimate = cells.some(
    c => c.inWaterBody || c.nearestWaterwayKind !== null || (c.waterFrequency !== null && c.waterFrequency >= 0.15)
  );

  return {
    cells,
    hexSize: size,
    proj,
    // Never an empty seed set — but the fallback must be the cell NEAREST to
    // where the user actually painted (originBounds/objectiveBounds centroid),
    // not an arbitrary array index, or a tiny brush dab on a coarse grid could
    // silently seed the search from a random corner of the AOI.
    originKeys: originKeys.length > 0 ? originKeys
      : [nearestCellKey(cells, { lat: (originBounds.minLat + originBounds.maxLat) / 2, lng: (originBounds.minLng + originBounds.maxLng) / 2 })],
    objectiveKeys: objectiveKeys.length > 0 ? objectiveKeys
      : [nearestCellKey(cells, { lat: (objectiveBounds.minLat + objectiveBounds.maxLat) / 2, lng: (objectiveBounds.minLng + objectiveBounds.maxLng) / 2 })],
    usedEstimatedData: elevRes.estimated || vegRes.some(v => v.estimated) || usedHydrologyEstimate,
    infrastructureAvailable: infra.available,
    hydrologyAvailable: waterways.available || waterFrequencyRaster !== null,
    waterFeatures: waterways.trails,
    roadWays: infra.trails,
    boundsPadFactor,
    boundsSw,
    boundsNe,
    usedCoarseGrid: tries > 0,
  };
}
