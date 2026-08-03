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
  LocalProjection, LocalPoint, AxialCoord,
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
import { MoverProfile } from './moverProfiles';

// Historical fixed values (2026-07-26, "think about a larger area"), now the
// 'standard' fidelity tier's baseline at CELL_BUDGET_REFERENCE_DISTANCE_M —
// see `computeCellBudget` below for why a fixed constant regardless of AOI
// size stopped being the right model.
const TARGET_CELL_COUNT = 2200;
const MAX_HEX_CELLS = 2800;
const TRAIL_SNAP_M = 30;
/** How close a cell (or one of its hex corners — see `waterDistanceM`'s own
 *  doc) has to come to a mapped watercourse to count as "on it" for the
 *  fording gate. Matches `TRAIL_SNAP_M`'s own precedent rather than inventing
 *  a different tolerance for the same class of problem (a linear OSM feature
 *  vs a hex grid). */
const WATER_SNAP_M = 30;

/**
 * Analysis-depth control (docs §35, owner 2026-07-27: "work out a sensible
 * scaling of the cell budget for distance noting big areas should take
 * longer. Let the user select a scale of something like 'quick' to 'fine'
 * for analysis depth. Processing half the country for a few minutes is
 * perfectly acceptable once we have the data locally.").
 *
 * "Once we have the data locally" is worth being explicit about: the ENTIRE
 * search this budget governs — the multi-source Dijkstra, the k-dissimilar
 * route search, the movement ensemble, chokepoints, min-cut — runs in
 * `mobilityWorker.ts`, a Web Worker in the user's OWN browser tab. Only the
 * source DATA (elevation/vegetation/roads/water) is fetched over the
 * network; the graph search itself never leaves the device. A heavier
 * 'fine' run at long range costs that one user's own session — their tab
 * may become less responsive while it runs (the existing progress channel,
 * §33, is what makes that wait legible) — not shared backend capacity.
 */
export type MobilityFidelity = 'quick' | 'standard' | 'fine';

export const DEFAULT_MOBILITY_FIDELITY: MobilityFidelity = 'standard';

/** Distance below which the cell budget is just the tier's own base — a
 *  typical local analysis (a few km) behaves identically regardless of
 *  fidelity; the scaling below only kicks in for genuinely large areas. */
const CELL_BUDGET_REFERENCE_DISTANCE_M = 10_000; // 10 km

interface FidelityTier {
  /** Cell target at/below the reference distance. 'standard' matches the
   *  original fixed TARGET_CELL_COUNT exactly, so existing short-range
   *  behaviour is unchanged by adding this control. */
  baseTargetCellCount: number;
  /** How aggressively the target grows with distance beyond the reference
   *  — multiplies the (sqrt-scaled) growth term; see `computeCellBudget`. */
  growthRate: number;
  /** Hard ceiling on cell count regardless of distance — the actual bound
   *  on worst-case runtime. This is what makes a country-scale 'fine' run a
   *  deliberate, bounded choice (owner's own "a few minutes is acceptable")
   *  rather than an unbounded accident. */
  hardCeiling: number;
}

const FIDELITY_TIERS: Record<MobilityFidelity, FidelityTier> = {
  quick: { baseTargetCellCount: 900, growthRate: 0.6, hardCeiling: 5_000 },
  standard: { baseTargetCellCount: TARGET_CELL_COUNT, growthRate: 1.0, hardCeiling: 12_000 },
  fine: { baseTargetCellCount: 4_000, growthRate: 2.2, hardCeiling: 50_000 },
};

export interface CellBudget {
  targetCellCount: number;
  maxHexCells: number;
}

/**
 * The cell budget for one attempt, scaling with the REAL distance between
 * origin and objective. Growth is SUB-LINEAR (sqrt of the distance ratio)
 * on purpose — a naive linear or area-proportional (~distance²) scaling
 * would demand millions of cells at continental range, which no browser tab
 * can search in "a few minutes"; sqrt growth keeps the budget increasing
 * meaningfully with distance while `hardCeiling` still bounds the worst
 * case per tier. Below `CELL_BUDGET_REFERENCE_DISTANCE_M`, `fidelity` still
 * matters (each tier's own `baseTargetCellCount` differs — 'fine' is
 * genuinely higher-resolution even locally, not just "scales up more"),
 * just not the distance term.
 */
export function computeCellBudget(spanM: number, fidelity: MobilityFidelity): CellBudget {
  const tier = FIDELITY_TIERS[fidelity];
  const distanceRatio = Math.max(1, spanM / CELL_BUDGET_REFERENCE_DISTANCE_M);
  const scaled = tier.baseTargetCellCount * (1 + (Math.sqrt(distanceRatio) - 1) * tier.growthRate);
  const targetCellCount = Math.min(Math.round(scaled), tier.hardCeiling);
  // Keeps the ~1.27x headroom the original TARGET_CELL_COUNT/MAX_HEX_CELLS
  // pair had (2800/2200), so the existing coarsening loop in
  // `buildMobilityGrid` has the same relative slack it always did.
  const maxHexCells = Math.min(Math.round(targetCellCount * 1.27), tier.hardCeiling);
  return { targetCellCount, maxHexCells };
}

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
  /** Analysis depth this attempt actually used (docs §35) — honesty field so
   *  the log/UI can say plainly which trade-off was in effect, and so a
   *  "re-run at finer resolution" control can show the CURRENT setting. */
  fidelity: MobilityFidelity;
  /** The cell target `computeCellBudget` resolved `fidelity` and the real
   *  origin<->objective distance into for this attempt. */
  targetCellCount: number;
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
export function nearestCellKey(cells: MobilityGridCell[], point: LatLng): string {
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

/**
 * Owner-reported defect, small AOIs (2026-07-28): moving ~1-2 km around one
 * side of a hill to the other never considered an equally short detour 1-2 km
 * to the north or south, because the box above is sized PROPORTIONALLY to the
 * direct span — a short trip gets proportionately short padding, regardless
 * of whether a genuinely better route sits just outside it. The search itself
 * is fine (the multi-source Dijkstra already finds the cheapest path within
 * whatever cells it's given); the box just never contained the better path's
 * cells in the first place.
 *
 * Fix: an ADDITIONAL floor on top of the proportional term, sized by how far
 * THIS mover could reasonably travel in a bounded time budget — not a flat
 * distance, because a vehicle can cover far more ground in the same time as a
 * foot mover and should get proportionately more search room for the
 * identical trip (owner: "anything that would be a path within 1 or 2 hours
 * — so 'foot' would be quite constrained compared to vehicles").
 *
 * BOUNDED, not literal (revised same day, live-tested): an initial "literal
 * 1-2 hours, no cap" version inflated a vehicle profile's box to ~120 km wide
 * for the exact 1.25 km ridge-crossing case this fix targets — no cell
 * budget can keep hex resolution fine over that much area, and the owner's
 * own follow-up report ("the whole ridge is red instead... these narrow
 * location-specific pathways are the entire point of this app") makes clear
 * that resolution, not detour coverage at any distance, is the actual
 * priority. 15 minutes keeps the floor generous relative to the REPORTED
 * scenario (a foot profile at 5 km/h covers ~1.25 km in 15 min — almost
 * exactly the owner's own "1-2 km" framing) while bounding how far the box
 * can grow for a fast profile. A genuinely far-away ROAD-based detour for
 * vehicle profiles is still covered independently by the box-free road-graph
 * search (`roadRouteSearch.ts`, Slice A) — full fidelity, no hex coarsening,
 * because it searches the real road network directly rather than a
 * tessellated grid. This floor is specifically for the cross-country/
 * terrain-driven case that search doesn't cover.
 */
const DETOUR_TIME_BUDGET_SECONDS = 15 * 60; // 15 minutes

/** Extra room (metres, each side of the direct span) a `profile` should get
 *  purely from its own sourced road speed — see `DETOUR_TIME_BUDGET_SECONDS`'s
 *  doc comment above for why this is time-based rather than a flat number. */
export function minDetourPadM(profile: Pick<MoverProfile, 'roadSpeedKmh'>): number {
  return ((profile.roadSpeedKmh * 1000) / 3600) * DETOUR_TIME_BUDGET_SECONDS;
}

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
  boundsPadFactor: number,
  /** See `minDetourPadM()`'s doc comment above — extra room (metres, each
   *  side) floored by the mover profile's own travel speed rather than the
   *  direct span, so a short trip still gets a profile-appropriate detour
   *  allowance. Defaults to 0 (no change) for callers that don't have a
   *  profile in scope, matching every pre-existing call site/test. Named
   *  distinctly from the `minDetourPadM()` helper above (same concept, this
   *  is the resolved metres value a caller passes in) to avoid shadowing it. */
  detourPadM = 0
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
  const targetSideM = Math.max(
    spanM * (1 + 2 * boundsPadFactor),
    // Profile-scaled detour floor (see `minDetourPadM()`'s doc comment) — only
    // binds when the direct span is short enough that the proportional term
    // above wouldn't otherwise give this mover a reasonable amount of room.
    spanM + 2 * detourPadM,
    MIN_PAD_M * 2
  );
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

export interface FetchBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface SampledCells {
  cells: MobilityGridCell[];
  usedEstimatedData: boolean;
  infrastructureAvailable: boolean;
  hydrologyAvailable: boolean;
  waterFeatures: InfrastructureTrail[];
  roadWays: InfrastructureTrail[];
}

/**
 * Sample elevation/vegetation/road/water for exactly the given hexes and
 * assemble them into `MobilityGridCell`s — the batched-fetch core
 * `buildMobilityGrid` has always used, pulled out so `mobilityLazyGrid.ts`
 * can call the IDENTICAL sampling logic per newly-materialised tile (docs
 * §35, "eager coarse tiles, lazy fine cells") instead of re-deriving a
 * second copy that risks drifting from this one. `fetchBounds` scopes the
 * area-batched calls (vegetation/roads/water) to just the hexes being
 * sampled this call — for a single whole-box call (`buildMobilityGrid`
 * itself) that's the padded box; for one lazy-grid round it's just the new
 * tile ring's own bounds, so a round only pays network cost for the ground
 * it actually just added.
 *
 * Deliberately does NOT compute `crossSlopeDeg` (left at 0, the same
 * "unknown" default the interface already documents) — that needs the
 * neighbour-plane fit over whatever the FULL currently-materialised set is
 * at the moment it runs, not just this batch, so callers apply
 * `applyCrossSlope` themselves afterward over their own accumulated cells.
 */
export async function sampleCellsForHexes(
  hexesRaw: { hex: AxialCoord; center: LocalPoint }[],
  proj: LocalProjection,
  size: number,
  fetchBounds: FetchBounds,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void
): Promise<SampledCells | null> {
  if (hexesRaw.length < 1) return { cells: [], usedEstimatedData: false, infrastructureAvailable: true, hydrologyAvailable: true, waterFeatures: [], roadWays: [] };
  if (signal?.aborted) return null;

  const points = hexesRaw.map(c => toLatLng(proj, c.center));
  // Corner points too — see `waterDistanceM`'s doc comment on why a linear
  // watercourse narrower than the hex is more likely caught this way than by
  // testing cell centres alone. Local coords converted once here, alongside
  // the centres, rather than recomputed per cell in the sampling loop below.
  const cornerPoints = hexesRaw.map(c => hexCorners(c.center, size).map(p => toLatLng(proj, p)));

  const [elevRes, vegRes, infra, waterways, waterFrequencyRaster] = await Promise.all([
    sampleElevationsCached(points),
    sampleVegetation(points, signal, (done, total) => onProgress?.(0.05 + 0.55 * (done / Math.max(1, total))),
      fetchBounds),
    // 'highway-mobility' (docs §35 — the wider road set, motorway/trunk/
    // primary included), NOT the fire-break optimizer's REUSABLE_HIGHWAYS
    // default: a hex sitting on a motorway is exactly the case a movement/
    // denial appreciation most needs to register as onTrail, and the
    // fire-break "reusable broken ground" set deliberately excludes it. Also
    // carries surface/tracktype/smoothness per way, feeding the road-class
    // speed ceiling below.
    fetchCorridorMobilityRoads(fetchBounds.minLat, fetchBounds.minLng, fetchBounds.maxLat, fetchBounds.maxLng, signal).catch(() => ({ trails: [], available: false })),
    // Hydrology (docs §34) — two independent sources, batched exactly like
    // everything else here (one request each regardless of grid size, not
    // per-cell): OSM waterway/water-body geometry for a crisp, resolution-
    // independent "is there a mapped watercourse here" answer, and DEA WOfS
    // for a measured (if colour-ramp-approximated) wet-frequency where OSM
    // tagging is sparse. Neither failure blocks the run — a hydrology-blind
    // appreciation degrades to what Pass 1-4 already shipped, flagged via
    // `hydrologyAvailable` rather than silently.
    fetchCorridorWaterways(fetchBounds.minLat, fetchBounds.minLng, fetchBounds.maxLat, fetchBounds.maxLng, signal).catch(() => ({ trails: [], available: false })),
    fetchSurfaceWaterFrequencyArea(fetchBounds, signal).catch(() => null),
  ]);
  if (signal?.aborted) return null;
  onProgress?.(0.65);

  const cells: MobilityGridCell[] = hexesRaw.map((c, i) => {
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
      crossSlopeDeg: 0, // filled in by applyCrossSlope() once the caller's accumulated grid is finalised
      waterDistanceM,
      inWaterBody,
      nearestWaterwayKind,
      waterFrequency,
    };
  });

  // Fording depth is always a Tier 0 assumption (estimateFordingRequirement
  // in mobilityCost.ts), so a run whose only estimated ingredient is "this
  // cell needed a fording judgement" must still trip the honesty flag — not
  // just elevation/vegetation fallback.
  const usedHydrologyEstimate = cells.some(
    c => c.inWaterBody || c.nearestWaterwayKind !== null || (c.waterFrequency !== null && c.waterFrequency >= 0.15)
  );

  return {
    cells,
    usedEstimatedData: elevRes.estimated || vegRes.some(v => v.estimated) || usedHydrologyEstimate,
    infrastructureAvailable: infra.available,
    hydrologyAvailable: waterways.available || waterFrequencyRaster !== null,
    waterFeatures: waterways.trails,
    roadWays: infra.trails,
  };
}

/**
 * Real cross-slope, not the dormant "always unknown" placeholder Pass 1
 * shipped with (docs §10.7 M3a / §3's own stated scope cut) — computed from
 * the elevation grid already in hand, no new network call. `edgeMobilityCost`'s
 * hard side-slope NO-GO gate only ever fires when a real number reaches it;
 * this is what makes that gate live instead of permanently inert. Mutates
 * `cells` in place (matches `buildMobilityGrid`'s own prior behaviour) —
 * `mobilityLazyGrid.ts` calls this over its WHOLE accumulated cell set after
 * every round, not just the newly-materialised batch, since a cell's plane
 * fit depends on its neighbours regardless of which round fetched them.
 */
export function applyCrossSlope(cells: MobilityGridCell[]): void {
  const derivatives = computeDemDerivatives(cells);
  for (const cell of cells) {
    cell.crossSlopeDeg = derivatives.get(cell.key)?.crossSlopeDeg ?? 0;
  }
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
    /** Analysis depth (docs §35) — defaults to 'standard', matching the
     *  original fixed cell budget exactly for a typical short-range run.
     *  See `computeCellBudget`'s own doc comment. */
    fidelity?: MobilityFidelity;
    /** Profile-scaled detour floor, metres each side — see `minDetourPadM()`'s
     *  doc comment. Ignored when `explicitBounds` is supplied (that path
     *  bypasses `computePaddedBounds` entirely already). Defaults to 0. */
    minDetourPadM?: number;
  } = {}
): Promise<MobilityGridResult | null> {
  const {
    signal, onProgress, boundsPadFactor = 0.2, explicitBounds, fidelity = DEFAULT_MOBILITY_FIDELITY,
    minDetourPadM: detourPadM = 0,
  } = options;

  const originBounds = paintedAreaBounds(origin);
  const objectiveBounds = paintedAreaBounds(objective);
  if (!originBounds || !objectiveBounds) return null;

  // Pad either side so the search has room to route around obstacles rather
  // than being boxed in exactly between the two AOIs — see
  // `computePaddedBounds`'s own doc comment for the bug this formula fixes.
  const padded = explicitBounds ?? computePaddedBounds(originBounds, objectiveBounds, boundsPadFactor, detourPadM);
  if (!padded) return null;
  const { boundsSw, boundsNe } = padded;

  // Cell budget scales with the REAL SIZE OF THE SEARCHED BOX and the
  // caller's chosen fidelity (docs §35) — NOT a fixed constant regardless of
  // AOI size, which either wasted resolution on small areas or silently
  // coarsened large ones into unusably big hexes with no user control over
  // the trade-off.
  //
  // FIELD-CONFIRMED REGRESSION (2026-07-28, live test after the profile-
  // scaled detour-pad fix, §39): this used to be the raw origin<->objective
  // distance, ignoring padding entirely. A vehicle profile's detour floor can
  // make the ACTUAL box several times wider than that raw distance — the
  // same fixed cell budget then had to stretch over a much bigger area,
  // ballooning hex size everywhere, including right along the direct route.
  // Reported live: "the whole 'ridge' is red instead" of showing the real,
  // narrow paved-road gap through it — exactly this effect, the hex grown
  // too coarse to resolve a location-specific gap. Fixed by deriving the
  // budget from the FINAL padded box's own dimensions (works identically
  // whether the box came from `boundsPadFactor`, the detour floor, or a
  // frontier-growth retry's `explicitBounds` — all three already land in
  // `boundsSw`/`boundsNe` by this point) rather than re-deriving a stale,
  // pre-padding distance.
  const boxWidthM = calculateDistance(boundsSw.lat, boundsSw.lng, boundsSw.lat, boundsNe.lng);
  const boxHeightM = calculateDistance(boundsSw.lat, boundsSw.lng, boundsNe.lat, boundsSw.lng);
  const spanMForBudget = Math.max(boxWidthM, boxHeightM);
  const { targetCellCount, maxHexCells } = computeCellBudget(spanMForBudget, fidelity);

  const center: LatLng = { lat: (boundsSw.lat + boundsNe.lat) / 2, lng: (boundsSw.lng + boundsNe.lng) / 2 };
  const proj = makeProjection(center);
  const boxMinLocal = toLocal(proj, boundsSw);
  const boxMaxLocal = toLocal(proj, boundsNe);
  const min: LocalPoint = { x: Math.min(boxMinLocal.x, boxMaxLocal.x), y: Math.min(boxMinLocal.y, boxMaxLocal.y) };
  const max: LocalPoint = { x: Math.max(boxMinLocal.x, boxMaxLocal.x), y: Math.max(boxMinLocal.y, boxMaxLocal.y) };
  const width = max.x - min.x;
  const height = max.y - min.y;
  if (width < 10 || height < 10) return null;

  let size = chooseHexSize(Math.max(width, height), Math.min(width, height) / 2, targetCellCount);
  let cellsRaw = generateBoxHexes(min, max, size);
  let tries = 0;
  while (cellsRaw.length > maxHexCells && tries < 5) {
    size *= 1.25;
    cellsRaw = generateBoxHexes(min, max, size);
    tries++;
  }
  if (cellsRaw.length < 1) return null;
  if (signal?.aborted) return null;
  onProgress?.(0.05);

  const sampled = await sampleCellsForHexes(
    cellsRaw, proj, size,
    { minLat: boundsSw.lat, minLng: boundsSw.lng, maxLat: boundsNe.lat, maxLng: boundsNe.lng },
    signal, onProgress
  );
  if (!sampled) return null;
  const { cells, usedEstimatedData, infrastructureAvailable, hydrologyAvailable, waterFeatures, roadWays } = sampled;

  applyCrossSlope(cells);

  // Corner points, recomputed from `cellsRaw` (same order `cells` was built
  // in) purely for origin/objective membership testing below — cheap, pure
  // geometry, no network call, so recomputing here rather than threading
  // `sampleCellsForHexes`'s internal copy back out keeps that helper's
  // return shape focused on what callers outside this module actually need.
  const cornerPoints = cellsRaw.map(c => hexCorners(c.center, size).map(p => toLatLng(proj, p)));

  // Resolve each painted area's paint/erase strokes into one shape ONCE
  // here, rather than per cell — the geometry-boolean-ops replay is real
  // work, membership testing against the already-resolved shape is cheap.
  const originGeom = resolvePaintedAreaGeometry(origin);
  const objectiveGeom = resolvePaintedAreaGeometry(objective);
  const originKeys = cells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], originGeom)).map(c => c.key);
  const objectiveKeys = cells.filter((_, i) => isPaintedAreaMember(cornerPoints[i], objectiveGeom)).map(c => c.key);

  onProgress?.(0.7);

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
    usedEstimatedData,
    infrastructureAvailable,
    hydrologyAvailable,
    waterFeatures,
    roadWays,
    boundsPadFactor,
    boundsSw,
    boundsNe,
    fidelity,
    targetCellCount,
    usedCoarseGrid: tries > 0,
  };
}
