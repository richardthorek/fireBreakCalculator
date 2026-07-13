/**
 * Corridor route optimizer ("smart pathfinding") — hexagonal multi-pass search.
 *
 * The user's drawn line fixes the waypoints they must connect. Between each
 * consecutive pair the optimizer tiles the surrounding corridor in hexagons
 * (the same style of grid Uber's H3 uses for spatial routing — every cell has
 * 6 equidistant neighbours, so a search over it can bend in any direction at
 * every step instead of only nudging sideways off a straight line) and runs
 * Dijkstra over the hex adjacency graph, costing each edge by distance ×
 * traversal-slope × fuel, discounted where the ground is already broken by a
 * mapped trail.
 *
 * The search runs three automatic passes per leg — wide scan, refine, polish
 * — each narrower and finer than the last, centred on the previous pass's
 * result. This bakes into a single click what used to take a few manual
 * re-runs to stumble into: the wide first pass casts a genuinely broad net
 * (spread further than a cautious single pass would), and the safety net
 * (always keep whichever pass scored lowest effort) means refinement can
 * only match or beat the wide pass, never lose ground to it.
 *
 * Data honesty: the result carries `usedEstimatedData` whenever any sample
 * fell back to non-authoritative sources, and `infrastructureAvailable`
 * false when the trail lookup failed outright (never presented as "no
 * trails exist"). The optimizer proposes; the firefighter disposes — the
 * optimized line is a preview until explicitly applied.
 *
 * The wide (pass-1) hex cells are also returned as a cost-normalised
 * heatmap so the UI can render exactly what the search considered — this
 * doubles as the on-map "scanning" visualization.
 */

import { VegetationType } from '../config/classification';
import { LatLng } from './chainage';
import { calculateDistance, calculateSlope, sampleElevationsBatch } from './slopeCalculation';
import { fetchCorridorInfrastructure, distanceToNearestTrail, InfrastructureTrail } from './infrastructureService';
import { fetchStateVegetation } from './stateVegetationRouter';
import {
  makeProjection, toLocal, toLatLng, hexKey, hexNeighbors, hexCorners,
  chooseHexSize, generateCorridorHexes, polylineLengthLocal, LocalProjection,
  LocalPoint, AxialCoord, distanceToPolylineLocal,
} from './hexGrid';
import { logger } from './logger';

export type { LatLng };

/**
 * Cost multipliers per vegetation class — relative effort of building line
 * through each fuel, as a multiple of flat-grassland effort.
 *
 * Grounded in the production model's fuel SPEED factors (productionModel.ts),
 * inverted to effort-per-metre relative to grassland:
 *   machinery  → 1.0 / 1.25 / 1.82 / 2.86   (grass/light/medium/heavy)
 *   hand crew  → 1.0 / 1.61 / 2.63 / 4.55
 * The earlier weights (1.0/1.2/1.7/2.6) tracked only the machinery end, which
 * under-weighted fuel: heavier vegetation is the primary obstacle a fire break
 * must be cut through, and its influence on route choice was being swamped by
 * slope (whose multiplier ranges far wider). These sit on a machinery↔hand-crew
 * blend so heavy timber reads as the major deterrent it is — the optimizer now
 * works harder to route around heavy fuel, and the same weighting drives the
 * cost heatmap so slope AND fuel visibly combine to make a cell "red".
 */
const VEGETATION_COST: Record<VegetationType, number> = {
  grassland: 1.0,
  lightshrub: 1.4,
  mediumscrub: 2.2,
  heavyforest: 3.8,
};

/** Traversal-slope multiplier. Quadratic ramp with hard penalties at machinery limits. */
const slopeCost = (slopeDeg: number): number => {
  const s = Math.abs(slopeDeg);
  // 0° → 1.0, 10° → ~1.16, 20° → ~1.65, 30° → ~2.46
  let f = 1 + (s / 15) ** 2 * 0.6 + (s / 30) ** 2;
  if (s >= 25) f *= 1.6; // above typical safe dozer operating slope
  if (s >= 45) f *= 3.0; // effectively impassable for machinery
  return f;
};

/**
 * OBJECTIVE (absolute) difficulty severity — a fixed scale independent of
 * whatever else is in the current scan, as opposed to `costNormalized`'s
 * per-scan min/max stretch. That relative scale is genuinely useful for
 * comparing paths WITHIN one corridor, but on its own it means "heavy timber"
 * only reads as difficult if something even worse happens to sit nearby in
 * that particular scan — a flat heavy-forest patch can render green purely
 * because a steep ridge elsewhere stretched the scale. A crew doesn't
 * experience fuel that way: heavy timber is hard to cut through regardless of
 * what else is on the map.
 *
 * Each cell's objective severity is `max(vegSeverity, slopeSeverity)` plus a
 * small bonus when both are elevated (a genuinely compounding combination —
 * steep AND heavy fuel — should read harder than either alone). Because it's
 * a max-based floor, heavy forest's severity value is a GUARANTEED MINIMUM
 * for that cell's colour, however gentle the slope and whatever else the scan
 * contains — this is what "objective" means here.
 *
 * Anchors are fixed, human-meaningful reference points, not fitted constants:
 * - Vegetation severities are proportioned off the same `VEGETATION_COST`
 *   ladder used for actual routing cost, so the two scales agree with each
 *   other; heavy forest's floor (0.55) sits just past the amber stop (0.5) on
 *   the green→amber→red gradient, satisfying "heavy timber is always at
 *   least amber".
 * - Slope severity anchors mirror the SAME safety limits the equipment-
 *   compatibility engine uses (api/src/services/productionModel.ts
 *   `DEFAULT_MAX_SLOPE_DEGREES`): 25° (machinery's default operating limit)
 *   sits at the amber stop, 45° (hand crews' outer limit) sits at red — i.e.
 *   "objective" here means "relative to standard equipment capability", not
 *   to the specific equipment loaded in this deployment. A fully
 *   equipment-aware heatmap (recolouring for whichever resource is selected)
 *   is a larger follow-on, not attempted here.
 */
const VEG_SEVERITY: Record<VegetationType, number> = {
  grassland: 0.0,
  lightshrub: 0.18,
  mediumscrub: 0.38,
  heavyforest: 0.55,
};

/** [slopeDegrees, severity 0..1] anchors; interpolated linearly, clamped at ends. */
const SLOPE_SEVERITY_ANCHORS: [number, number][] = [
  [0, 0.0],
  [10, 0.14],
  [25, 0.5],
  [35, 0.78],
  [45, 1.0],
];

function interpolateSeverity(anchors: [number, number][], x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/** Objective (absolute) difficulty severity 0..1 for a cell's average slope + fuel. */
function objectiveSeverity(avgSlopeDeg: number, veg: VegetationType): number {
  const v = VEG_SEVERITY[veg];
  const s = interpolateSeverity(SLOPE_SEVERITY_ANCHORS, Math.abs(avgSlopeDeg));
  return Math.min(1, Math.max(v, s) + 0.3 * Math.min(v, s));
}

/** Fuel-cost discount when an edge follows a mapped trail — the ground is already broken. */
const TRAIL_FUEL_DISCOUNT = 0.35;
/** A node counts as "on trail" within this distance of a mapped way (metres). */
const TRAIL_SNAP_M = 30;

export interface RouteComparisonStats {
  /** Total length in metres. */
  distance: number;
  /** Max traversal slope encountered (degrees) along the sampled path. */
  maxSlope: number;
  /** Mean traversal slope (degrees), distance-weighted. */
  meanSlope: number;
  /** Metres of path crossing heavy forest. */
  heavyForestDistance: number;
  /** Metres of path with slope ≥ 25°. */
  steepDistance: number;
  /** Metres of path following mapped existing trails/roads. */
  existingTrailDistance: number;
  /** Unitless effort score (distance × slope × fuel multipliers). Lower is better. */
  effortScore: number;
}

/** One hex cell from the widest search pass, coloured by relative traversal cost. */
export interface HexHeatmapCell {
  /** Closed polygon ring (7 points, first = last) for map rendering. */
  polygon: LatLng[];
  center: LatLng;
  /** 0..1 traversal cost normalised to the MIN/MAX of this scan's own cells —
   *  0 = easiest and 1 = hardest ground FOUND IN THIS CORRIDOR. Good for
   *  comparing paths within one scan; a bad idea for judging fuel/slope
   *  severity in absolute terms (see `costNormalizedObjective`). */
  costNormalized: number;
  /** 0..1 ABSOLUTE difficulty severity, independent of anything else in this
   *  scan — heavy forest always sits at least at the amber floor and a 45°+
   *  slope always reads red, regardless of what else is nearby. See
   *  `objectiveSeverity()`. */
  costNormalizedObjective: number;
  vegetation: VegetationType;
  onTrail: boolean;
  /** True when this cell's vegetation sample was estimated/fallback data. */
  estimated: boolean;
}

export interface OptimizedRouteResult {
  /** Ordered coordinates of the optimized line (includes original waypoints). */
  coords: LatLng[];
  /** Stats for the optimized path. */
  optimized: RouteComparisonStats;
  /** Stats for the original (straight-legs) path over the same cost surface. */
  original: RouteComparisonStats;
  /** Percent effort reduction vs the original path (0–1); negative = worse. */
  improvement: number;
  /** True when any elevation or vegetation sample was estimated/fallback data. */
  usedEstimatedData: boolean;
  /** False when the OSM infrastructure lookup failed for any leg — the
   *  optimizer then ran on terrain and fuel only (absence of data ≠ no trails). */
  infrastructureAvailable: boolean;
  /** Number of grid nodes evaluated (diagnostic, summed across all passes). */
  nodesEvaluated: number;
  /** Cost-normalised hex cells from the widest pass — the "what we scanned" heatmap. */
  heatmap: HexHeatmapCell[];
  /** Number of refinement passes run per leg (wide → refine → polish). */
  passesPerLeg: number;
}

export type ScanPhase = 'grid' | 'cells' | 'search' | 'pass' | 'done';

/** One streamed scan-visualization event. `data` shape depends on `phase`:
 *  grid → { cells: HexHeatmapCell[] } (uncoloured, cost 0);
 *  cells → { cells: HexHeatmapCell[] } (coloured, cost-normalised, this pass only);
 *  search → { visited: LatLng[]; bestPath: LatLng[] } (Dijkstra frontier snapshot);
 *  pass/done → no data, just a boundary marker. */
export interface ScanEvent {
  phase: ScanPhase;
  progress: number;
  data?: { cells?: HexHeatmapCell[]; visited?: LatLng[]; bestPath?: LatLng[] };
}

export interface OptimizeOptions {
  /** Max lateral half-width of the WIDE (pass 1) search corridor, metres.
   *  Defaults to a generous spread — see PASS_CONFIGS. */
  maxOffsetM?: number;
  /** Abort signal for cancelling long optimizations. */
  signal?: AbortSignal;
  /** Progress callback: (fraction 0-1, phase name). */
  onProgress?: (fraction: number, phase?: string) => void;
  /** Scan visualization events: grid build-out → cell colouring → live pathfinding. */
  onScanEvent?: (event: ScanEvent) => void;
}

/** A sampled point with everything the cost model needs. */
export interface SampledNode {
  lat: number;
  lng: number;
  elevation: number;
  vegetation: VegetationType;
  vegEstimated: boolean;
  onTrail: boolean;
}

export interface RawHeatmapCell {
  center: LatLng;
  polygon: LatLng[];
  unitCost: number;
  /** Average traversal slope (degrees) over this cell's incident edges —
   *  feeds the fixed-scale objective severity, independent of `unitCost`'s
   *  per-scan stretch. */
  avgSlopeDegrees: number;
  vegetation: VegetationType;
  onTrail: boolean;
  estimated: boolean;
}

/** Vegetation cache keyed at ~100 m — matches the NVIS raster resolution.
 *  Exported (via sampleVegetation) so the area-recon scan (WP6) can share it:
 *  points sampled while scanning a box are cache hits when later pathfinding
 *  crosses the same ground, and vice versa. */
const vegCache = new Map<string, { type: VegetationType; estimated: boolean }>();
const vegKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

/** Elevation cache keyed at ~30 m — finer than vegetation since slope is more
 *  locally variable. Shared between route optimization and area recon so a
 *  scanned box directly speeds up pathfinding through it (and vice versa). */
const ELEV_CACHE_DEG = 30 / 111320;
const elevCache = new Map<string, { value: number; estimated: boolean }>();
const elevKey = (lat: number, lng: number) => `${Math.round(lat / ELEV_CACHE_DEG)},${Math.round(lng / ELEV_CACHE_DEG)}`;

export async function sampleElevationsCached(points: LatLng[]): Promise<{ elevations: number[]; estimated: boolean }> {
  if (points.length === 0) return { elevations: [], estimated: false };
  const results: number[] = new Array(points.length);
  let estimated = false;
  const missingIdx: number[] = [];
  const missingPts: LatLng[] = [];
  points.forEach((p, i) => {
    const cached = elevCache.get(elevKey(p.lat, p.lng));
    if (cached) {
      results[i] = cached.value;
      estimated = estimated || cached.estimated;
    } else {
      missingIdx.push(i);
      missingPts.push(p);
    }
  });
  if (missingPts.length > 0) {
    const res = await sampleElevationsBatch(missingPts);
    missingIdx.forEach((idx, j) => {
      results[idx] = res.elevations[j];
      elevCache.set(elevKey(points[idx].lat, points[idx].lng), { value: res.elevations[j], estimated: res.estimated });
    });
    estimated = estimated || res.estimated;
  }
  return { elevations: results, estimated };
}

export async function sampleVegetation(points: LatLng[], signal?: AbortSignal): Promise<{ type: VegetationType; estimated: boolean }[]> {
  const unique = new Map<string, LatLng>();
  for (const p of points) {
    const k = vegKey(p.lat, p.lng);
    if (!vegCache.has(k) && !unique.has(k)) unique.set(k, p);
  }
  const entries = Array.from(unique.entries());
  const CONCURRENCY = 6;
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      if (signal?.aborted) return;
      const [key, pt] = entries[cursor++];
      try {
        const res = await fetchStateVegetation(pt.lat, pt.lng);
        if (res) {
          vegCache.set(key, { type: res.vegetationType, estimated: false });
        } else {
          // No authoritative data (ocean / outside AU / service down): assume a
          // conservative medium fuel and mark it estimated.
          vegCache.set(key, { type: 'mediumscrub', estimated: true });
        }
      } catch (e) {
        logger.warn('Route optimizer vegetation sample failed', e);
        vegCache.set(key, { type: 'mediumscrub', estimated: true });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return points.map(p => vegCache.get(vegKey(p.lat, p.lng)) ?? { type: 'mediumscrub', estimated: true });
}

/** Sample elevation + vegetation + trail proximity for an arbitrary point set. */
async function sampleNodes(
  points: LatLng[],
  trails: InfrastructureTrail[],
  signal?: AbortSignal
): Promise<{ nodes: SampledNode[]; estimated: boolean }> {
  if (points.length === 0) return { nodes: [], estimated: false };
  const [elevRes, vegRes] = await Promise.all([sampleElevationsCached(points), sampleVegetation(points, signal)]);
  const nodes = points.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    elevation: elevRes.elevations[i],
    vegetation: vegRes[i].type,
    vegEstimated: vegRes[i].estimated,
    onTrail: trails.length > 0 && distanceToNearestTrail(p, trails, TRAIL_SNAP_M) <= TRAIL_SNAP_M,
  }));
  return { nodes, estimated: elevRes.estimated || vegRes.some(v => v.estimated) };
}

/** Edge cost between two sampled nodes: metres × slope factor × mean fuel factor,
 *  discounted when the edge follows a mapped trail. */
export function edgeCost(a: SampledNode, b: SampledNode): { cost: number; dist: number; slope: number; onTrail: boolean } {
  const dist = calculateDistance(a.lat, a.lng, b.lat, b.lng);
  if (dist <= 0) return { cost: 0, dist: 0, slope: 0, onTrail: false };
  const slope = calculateSlope(a.elevation, b.elevation, dist);
  const onTrail = a.onTrail && b.onTrail;
  const veg = ((VEGETATION_COST[a.vegetation] + VEGETATION_COST[b.vegetation]) / 2) * (onTrail ? TRAIL_FUEL_DISCOUNT : 1);
  return { cost: dist * slopeCost(slope) * veg, dist, slope, onTrail };
}

/** Accumulate comparison stats over a sequence of sampled nodes. */
function pathStats(nodes: SampledNode[]): RouteComparisonStats {
  let distance = 0;
  let maxSlope = 0;
  let slopeSum = 0;
  let heavy = 0;
  let steep = 0;
  let trail = 0;
  let effort = 0;
  for (let i = 1; i < nodes.length; i++) {
    const { cost, dist, slope, onTrail } = edgeCost(nodes[i - 1], nodes[i]);
    distance += dist;
    effort += cost;
    slopeSum += slope * dist;
    if (slope > maxSlope) maxSlope = slope;
    if (slope >= 25) steep += dist;
    if (onTrail) trail += dist;
    if (nodes[i].vegetation === 'heavyforest' || nodes[i - 1].vegetation === 'heavyforest') {
      heavy += dist / (nodes[i].vegetation === nodes[i - 1].vegetation ? 1 : 2);
    }
  }
  return {
    distance,
    maxSlope,
    meanSlope: distance > 0 ? slopeSum / distance : 0,
    heavyForestDistance: heavy,
    steepDistance: steep,
    existingTrailDistance: trail,
    effortScore: effort,
  };
}

/** Reconstruct the best path known SO FAR to whichever settled node is
 *  closest to `endId` by tentative distance — used to show a live "current
 *  best guess" path while the search is still running (WP2 streaming). */
function partialPathTo(prev: Map<string, string>, dist: Map<string, number>, visited: Set<string>, startId: string): string[] {
  let closest: string | null = null;
  let closestDist = Infinity;
  for (const id of visited) {
    const d = dist.get(id) ?? Infinity;
    if (d < closestDist) { closestDist = d; closest = id; }
  }
  if (closest === null) return [];
  const path: string[] = [closest];
  let cur = closest;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (p === undefined) break;
    path.unshift(p);
    cur = p;
  }
  return path;
}

/**
 * Sparse Dijkstra over a small (≤ ~1500 node) adjacency graph. Yields to the
 * event loop every ~40 node-pops (negligible overhead at this graph size) so
 * the caller's `onYield` can paint a frontier/partial-path frame — this is
 * what makes the search visibly "crawl" the grid instead of appearing
 * end-of-run-only (WP2).
 */
async function dijkstra(
  nodes: Map<string, SampledNode>,
  adjacency: Map<string, string[]>,
  startId: string,
  endId: string,
  onYield?: (visited: string[], partialPath: string[]) => void
): Promise<{ path: string[]; cost: number } | null> {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(startId, 0);
  let pops = 0;
  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        u = id;
      }
    }
    if (u === null || u === endId) break;
    visited.add(u);
    pops++;
    if (onYield && pops % 40 === 0) {
      onYield(Array.from(visited), partialPathTo(prev, dist, visited, startId));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (const v of adjacency.get(u) ?? []) {
      if (visited.has(v) || !nodes.has(v)) continue;
      const { cost } = edgeCost(nodes.get(u)!, nodes.get(v)!);
      const alt = (dist.get(u) ?? Infinity) + cost;
      if (alt < (dist.get(v) ?? Infinity)) {
        dist.set(v, alt);
        prev.set(v, u);
      }
    }
  }
  if (!dist.has(endId) || dist.get(endId) === Infinity) return null;
  const path: string[] = [endId];
  let cur = endId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (p === undefined) return null;
    path.unshift(p);
    cur = p;
  }
  return { path, cost: dist.get(endId)! };
}

interface HexPassResult {
  pathNodes: SampledNode[];
  cost: number;
  cells: RawHeatmapCell[];
  nodesEvaluated: number;
  estimated: boolean;
}

/** Pre-built hex tiling handed in for the wide pass — WP1's single route-wide
 *  grid, shared across every leg so nothing renders twice at two alignments. */
interface SharedGrid {
  proj: LocalProjection;
  size: number;
  cellsRaw: { hex: AxialCoord; center: LocalPoint }[];
}

/**
 * Run one search pass: tile the corridor around `guidePath` in hexagons
 * (or, when `sharedGrid` is given, filter down from the pre-built route-wide
 * grid instead of building a new one — this is what stops each leg's wide
 * pass from rendering its own misaligned grid), sample each cell, run
 * Dijkstra from A to B over the hex adjacency graph (with A/B connected to
 * every hex within reach — no direct A–B edge; see `optimizeLegHex`'s abort
 * handling and the module doc for why), and return the cheapest chain.
 *
 * When `onScanEvent` is given, streams grid → cells → search events so the
 * UI can show the scan actually happening instead of an end-of-run reveal.
 */
async function runHexPass(
  A: LatLng,
  B: LatLng,
  guidePath: LatLng[],
  halfWidth: number,
  targetCount: number,
  trailsPromise: Promise<InfrastructureTrail[]>,
  signal: AbortSignal | undefined,
  sharedGrid?: SharedGrid,
  onScanEvent?: (event: ScanEvent) => void
): Promise<HexPassResult | null> {
  let proj: LocalProjection;
  let size: number;
  let cellsRaw: { hex: AxialCoord; center: LocalPoint }[];

  if (sharedGrid) {
    proj = sharedGrid.proj;
    size = sharedGrid.size;
    const guideLocal = guidePath.map(p => toLocal(proj, p));
    cellsRaw = sharedGrid.cellsRaw.filter(c => distanceToPolylineLocal(c.center, guideLocal) <= halfWidth);
  } else {
    const origin = guidePath[Math.floor(guidePath.length / 2)];
    proj = makeProjection(origin);
    const pathLocal = guidePath.map(p => toLocal(proj, p));
    const pathLen = Math.max(1, polylineLengthLocal(pathLocal));
    size = chooseHexSize(pathLen, halfWidth, targetCount);
    cellsRaw = generateCorridorHexes(pathLocal, halfWidth, size);
    const MAX_HEX_CELLS = 1000;
    let tries = 0;
    while (cellsRaw.length > MAX_HEX_CELLS && tries < 5) {
      size *= 1.25;
      cellsRaw = generateCorridorHexes(pathLocal, halfWidth, size);
      tries++;
    }
    if (cellsRaw.length < 3) {
      size *= 0.5;
      cellsRaw = generateCorridorHexes(pathLocal, halfWidth, size);
    }
  }
  if (signal?.aborted || cellsRaw.length === 0) return null;

  if (onScanEvent) {
    onScanEvent({
      phase: 'grid',
      progress: 0,
      data: {
        cells: cellsRaw.map(cell => {
          const corners = hexCorners(cell.center, size).map(c => toLatLng(proj, c));
          return {
            center: toLatLng(proj, cell.center),
            polygon: [...corners, corners[0]],
            costNormalized: 0,
            costNormalizedObjective: 0,
            vegetation: 'grassland' as VegetationType,
            onTrail: false,
            estimated: false,
          };
        }),
      },
    });
  }

  const hexLatLngs = cellsRaw.map(c => toLatLng(proj, c.center));
  const allPoints = [A, B, ...hexLatLngs];
  // trailsPromise is only awaited HERE (not before building the hex grid
  // above) so pass 0 overlaps its wait for the corridor's Overpass fetch
  // with its own elevation/vegetation sampling instead of paying both
  // latencies back to back — measured ~500ms off a ~2s single-leg search.
  const [elevRes, vegRes, trails] = await Promise.all([
    sampleElevationsCached(allPoints),
    sampleVegetation(allPoints, signal),
    trailsPromise,
  ]);
  if (signal?.aborted) return null;
  const estimated = elevRes.estimated || vegRes.some(v => v.estimated);

  const idFor = (i: number) => (i === 0 ? 'A' : i === 1 ? 'B' : hexKey(cellsRaw[i - 2].hex));
  const nodeMap = new Map<string, SampledNode>();
  const localById = new Map<string, LocalPoint>();
  allPoints.forEach((p, i) => {
    const id = idFor(i);
    const local = i < 2 ? toLocal(proj, p) : cellsRaw[i - 2].center;
    nodeMap.set(id, {
      lat: p.lat,
      lng: p.lng,
      elevation: elevRes.elevations[i],
      vegetation: vegRes[i].type,
      vegEstimated: vegRes[i].estimated,
      onTrail: trails.length > 0 && distanceToNearestTrail(p, trails, TRAIL_SNAP_M) <= TRAIL_SNAP_M,
    });
    localById.set(id, local);
  });

  const adjacency = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a)!.push(b);
  };
  for (const cell of cellsRaw) {
    const id = hexKey(cell.hex);
    for (const n of hexNeighbors(cell.hex)) {
      const nid = hexKey(n);
      if (nodeMap.has(nid)) addEdge(id, nid);
    }
  }
  // Connect A/B to every hex within reach, so the search picks whichever
  // entry/exit point is genuinely cheapest rather than the nearest one.
  const connectRadius = size * 2.4;
  const aLocal = localById.get('A')!;
  const bLocal = localById.get('B')!;
  let nearestToA: string | null = null, nearestToADist = Infinity;
  let nearestToB: string | null = null, nearestToBDist = Infinity;
  for (const cell of cellsRaw) {
    const id = hexKey(cell.hex);
    const local = localById.get(id)!;
    const dA = Math.hypot(local.x - aLocal.x, local.y - aLocal.y);
    const dB = Math.hypot(local.x - bLocal.x, local.y - bLocal.y);
    if (dA <= connectRadius) { addEdge('A', id); addEdge(id, 'A'); }
    if (dB <= connectRadius) { addEdge('B', id); addEdge(id, 'B'); }
    if (dA < nearestToADist) { nearestToADist = dA; nearestToA = id; }
    if (dB < nearestToBDist) { nearestToBDist = dB; nearestToB = id; }
  }
  // Sparse corridors (hex bigger than the search radius) could leave A or B
  // unconnected — guarantee at least the single nearest hex.
  if ((adjacency.get('A') ?? []).length === 0 && nearestToA) { addEdge('A', nearestToA); addEdge(nearestToA, 'A'); }
  if ((adjacency.get('B') ?? []).length === 0 && nearestToB) { addEdge('B', nearestToB); addEdge(nearestToB, 'B'); }
  // No direct A–B edge: a single hop would cost the terrain by comparing
  // only the two endpoint elevations, silently tunnelling through whatever
  // lies between them (a real risk whenever A and B happen to sit at similar
  // elevation either side of a ridge). If the hex graph genuinely can't
  // connect A to B, the caller treats this pass as failed and falls back to
  // the honestly-resampled straight line instead of a lying shortcut edge.

  // Per-hex unit cost (average cost-per-metre over incident edges) — computed
  // BEFORE the search so the 'cells' scan event can colour the grid in before
  // pathfinding starts (grid → colouring → pathfinding, per WP2).
  const cells: RawHeatmapCell[] = cellsRaw.map(cell => {
    const id = hexKey(cell.hex);
    const node = nodeMap.get(id)!;
    const neighborIds = (adjacency.get(id) ?? []).filter(nid => nodeMap.has(nid) && nid !== 'A' && nid !== 'B');
    let unitCost = 0.6;
    let avgSlopeDegrees = 0;
    if (neighborIds.length > 0) {
      let costSum = 0;
      let slopeSum = 0;
      for (const nid of neighborIds) {
        const e = edgeCost(node, nodeMap.get(nid)!);
        if (e.dist > 0) costSum += e.cost / e.dist;
        slopeSum += e.slope;
      }
      unitCost = costSum / neighborIds.length;
      avgSlopeDegrees = slopeSum / neighborIds.length;
    }
    const corners = hexCorners(cell.center, size).map(c => toLatLng(proj, c));
    return {
      center: { lat: node.lat, lng: node.lng },
      polygon: [...corners, corners[0]],
      unitCost,
      avgSlopeDegrees,
      vegetation: node.vegetation,
      onTrail: node.onTrail,
      estimated: node.vegEstimated,
    };
  });

  if (onScanEvent) {
    onScanEvent({ phase: 'cells', progress: 0.3, data: { cells: normalizeHeatmap(cells) } });
  }

  const result = await dijkstra(nodeMap, adjacency, 'A', 'B', onScanEvent
    ? (visitedIds, partialIds) => {
        onScanEvent({
          phase: 'search',
          progress: 0.3 + 0.7 * Math.min(1, visitedIds.length / Math.max(1, cellsRaw.length)),
          data: {
            bestPath: partialIds
              .map(id => nodeMap.get(id))
              .filter((n): n is SampledNode => !!n)
              .map(n => ({ lat: n.lat, lng: n.lng })),
          },
        });
      }
    : undefined);
  if (!result) return null;

  const pathNodes = result.path.map(id => nodeMap.get(id)!);

  return { pathNodes, cost: result.cost, cells, nodesEvaluated: cellsRaw.length, estimated };
}

/** Wide → refine → polish. Each pass narrows and sharpens around the previous
 *  pass's path; the safety net (lowest-cost-wins) means later passes can only
 *  match or beat the wide pass, never regress below it. */
const PASS_CONFIGS: { widthFactor: number; targetCount: number }[] = [
  { widthFactor: 1.0, targetCount: 650 },
  { widthFactor: 0.32, targetCount: 480 },
  { widthFactor: 0.14, targetCount: 320 },
];

function interpolateLine(A: LatLng, B: LatLng, intervalM: number): LatLng[] {
  const total = calculateDistance(A.lat, A.lng, B.lat, B.lng);
  const n = Math.max(1, Math.round(total / intervalM));
  const pts: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t });
  }
  return pts;
}

interface LegHexResult {
  optimizedNodes: SampledNode[];
  originalNodes: SampledNode[];
  heatmapCells: RawHeatmapCell[];
  usedEstimatedData: boolean;
  infrastructureAvailable: boolean;
  nodesEvaluated: number;
}

async function optimizeLegHex(
  A: LatLng,
  B: LatLng,
  options: OptimizeOptions,
  signal: AbortSignal | undefined,
  sharedGrid: SharedGrid | null,
  onLegProgress: (fraction: number) => void
): Promise<LegHexResult> {
  const { onScanEvent } = options;
  const legLen = calculateDistance(A.lat, A.lng, B.lat, B.lng);
  // Wide by default — aggressive spread so a single run finds what a few
  // manual re-runs used to stumble into.
  const baseHalfWidth = Math.min(
    900,
    Math.max(60, Math.min(options.maxOffsetM ?? Math.min(700, Math.max(150, legLen * 0.45)), legLen * 1.3))
  );

  if (signal?.aborted) {
    // The caller checks signal.aborted immediately after this call and
    // discards the result either way — skip every network round trip rather
    // than spend more data on a result nobody will use. Matters in the
    // field: this app is built for poor/no-reception use, so a cancelled
    // optimize shouldn't keep making requests.
    return { optimizedNodes: [], originalNodes: [], heatmapCells: [], usedEstimatedData: false, infrastructureAvailable: true, nodesEvaluated: 0 };
  }

  // One infrastructure fetch per leg (widest corridor bbox), reused by every
  // pass — NOT awaited here. It's handed to runHexPass as a promise so pass
  // 0's own elevation/vegetation sampling runs concurrently with it instead
  // of waiting for it first; every later pass reuses the same (by then
  // already-resolved) promise for free.
  const marginDeg = (baseHalfWidth + 200) / 111320;
  const lats = [A.lat, B.lat];
  const lngs = [A.lng, B.lng];
  const infraPromise = fetchCorridorInfrastructure(
    Math.min(...lats) - marginDeg,
    Math.min(...lngs) - marginDeg,
    Math.max(...lats) + marginDeg,
    Math.max(...lngs) + marginDeg,
    signal
  );
  const trailsPromise = infraPromise.then(infra => infra.trails);

  // Independent of the hex search itself (only needs A/B/trails, both already
  // in flight) — kicked off alongside the pass loop instead of after it so
  // its latency overlaps the search instead of adding to it.
  const straightPts = interpolateLine(A, B, 60);
  const originalPromise = trailsPromise.then(trails => sampleNodes(straightPts, trails, signal));

  let guidePath: LatLng[] = [A, B];
  let best: HexPassResult | null = null;
  let widePassCells: RawHeatmapCell[] = [];
  let usedEstimatedData = false;
  let nodesEvaluated = 0;

  for (let i = 0; i < PASS_CONFIGS.length; i++) {
    if (signal?.aborted) break;
    const cfg = PASS_CONFIGS[i];
    const halfWidth = Math.max(25, baseHalfWidth * cfg.widthFactor);
    // Only the wide pass (i === 0) uses the shared route-wide grid — WP1.
    // Refine/polish stay per-leg (they're never rendered, so there's nothing
    // to layer), and only the wide pass streams scan events — WP2's
    // "watch it happen" visuals are about the search the user actually sees.
    const pass = await runHexPass(
      A, B, guidePath, halfWidth, cfg.targetCount, trailsPromise, signal,
      i === 0 && sharedGrid ? sharedGrid : undefined,
      i === 0 ? onScanEvent : undefined
    );
    onLegProgress((i + 1) / PASS_CONFIGS.length);
    if (!pass) continue;
    usedEstimatedData = usedEstimatedData || pass.estimated;
    nodesEvaluated += pass.nodesEvaluated;
    if (i === 0) widePassCells = pass.cells;
    if (!best || pass.cost < best.cost) best = pass;
    guidePath = pass.pathNodes.map(n => ({ lat: n.lat, lng: n.lng }));
  }

  // By this point trailsPromise (derived from infraPromise) has already
  // settled — every pass and originalPromise awaited it — so this resolves
  // immediately; it's just how the settled `.available` flag gets back out.
  const [original, infra] = await Promise.all([originalPromise, infraPromise]);
  usedEstimatedData = usedEstimatedData || original.estimated;

  if (!best) {
    // Every pass failed to connect A to B in the hex graph (extremely rare —
    // would need a corridor thinner than the hex size somewhere along it).
    // Fail safe rather than fabricate an "optimized" result: report the
    // straight line as both, so effort/length compare as identical and the
    // UI reads as "no improvement found" rather than lying about one.
    return {
      optimizedNodes: original.nodes,
      originalNodes: original.nodes,
      heatmapCells: [],
      usedEstimatedData,
      infrastructureAvailable: infra.available,
      nodesEvaluated,
    };
  }

  return {
    optimizedNodes: best.pathNodes,
    originalNodes: original.nodes,
    heatmapCells: widePassCells,
    usedEstimatedData,
    infrastructureAvailable: infra.available,
    nodesEvaluated,
  };
}

export function normalizeHeatmap(cells: RawHeatmapCell[]): HexHeatmapCell[] {
  if (cells.length === 0) return [];
  let min = Infinity, max = -Infinity;
  for (const c of cells) {
    if (c.unitCost < min) min = c.unitCost;
    if (c.unitCost > max) max = c.unitCost;
  }
  const span = max - min;
  return cells.map(c => ({
    center: c.center,
    polygon: c.polygon,
    costNormalized: span > 1e-9 ? (c.unitCost - min) / span : 0.5,
    costNormalizedObjective: objectiveSeverity(c.avgSlopeDegrees, c.vegetation),
    vegetation: c.vegetation,
    onTrail: c.onTrail,
    estimated: c.estimated,
  }));
}

/**
 * WP1 — build the one grid the whole route's wide pass shares: a single
 * tangent-plane projection and a single hex size, sized off the widest of
 * every leg's own wide-pass corridor. Each leg's wide pass then filters down
 * from this instead of building its own projection+size, which is what
 * used to produce a second, misaligned grid at every shared waypoint on a
 * multi-leg line.
 */
function buildSharedWideGrid(waypoints: LatLng[], maxOffsetM?: number): SharedGrid | null {
  if (waypoints.length < 2) return null;
  const mid = waypoints[Math.floor(waypoints.length / 2)];
  const proj = makeProjection(mid);
  const pathLocal = waypoints.map(p => toLocal(proj, p));
  const pathLen = Math.max(1, polylineLengthLocal(pathLocal));

  // Same half-width heuristic as a single leg's wide pass (see
  // optimizeLegHex), evaluated per-leg — the shared grid must cover every
  // leg's own wide corridor, so it takes the widest rather than an average.
  let maxHalfWidth = 60;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const legLen = calculateDistance(waypoints[i].lat, waypoints[i].lng, waypoints[i + 1].lat, waypoints[i + 1].lng);
    const hw = Math.min(900, Math.max(60, Math.min(maxOffsetM ?? Math.min(700, Math.max(150, legLen * 0.45)), legLen * 1.3)));
    if (hw > maxHalfWidth) maxHalfWidth = hw;
  }

  let size = chooseHexSize(pathLen, maxHalfWidth, 1500);
  let cellsRaw = generateCorridorHexes(pathLocal, maxHalfWidth, size);
  const MAX_HEX_CELLS = 1500;
  let tries = 0;
  while (cellsRaw.length > MAX_HEX_CELLS && tries < 5) {
    size *= 1.25;
    cellsRaw = generateCorridorHexes(pathLocal, maxHalfWidth, size);
    tries++;
  }
  if (cellsRaw.length < 3) return null;
  return { proj, size, cellsRaw };
}

/**
 * Optimize the route between the user's waypoints.
 *
 * Each leg gets three hex-grid search passes (wide → refine → polish); the
 * cheapest of the three becomes that leg's contribution to the final route.
 * The wide pass draws from one route-wide shared grid (WP1) so a multi-leg
 * line never renders two misaligned heatmaps.
 */
export async function optimizeRoute(waypoints: LatLng[], options: OptimizeOptions = {}): Promise<OptimizedRouteResult | null> {
  if (waypoints.length < 2) return null;
  const { signal, onProgress, onScanEvent } = options;

  const sharedGrid = buildSharedWideGrid(waypoints, options.maxOffsetM);

  const optimizedCoords: LatLng[] = [waypoints[0]];
  const optimizedNodeSeqs: SampledNode[][] = [];
  const originalNodeSeqs: SampledNode[][] = [];
  // Keyed by cell centre so a shared-grid cell straddling two legs' corridors
  // is counted (and rendered) exactly once — the other half of WP1's fix.
  const heatmapByKey = new Map<string, RawHeatmapCell>();
  let usedEstimatedData = false;
  let infrastructureAvailable = true;
  let nodesEvaluated = 0;

  for (let leg = 0; leg < waypoints.length - 1; leg++) {
    if (signal?.aborted) return null;
    const A = waypoints[leg];
    const B = waypoints[leg + 1];
    const legLen = calculateDistance(A.lat, A.lng, B.lat, B.lng);

    // Very short legs are not worth a hex search.
    if (legLen < 120) {
      const sampled = await sampleNodes([A, B], [], signal);
      if (signal?.aborted) return null;
      usedEstimatedData = usedEstimatedData || sampled.estimated;
      optimizedNodeSeqs.push(sampled.nodes);
      originalNodeSeqs.push(sampled.nodes);
      optimizedCoords.push(B);
      onProgress?.((leg + 1) / (waypoints.length - 1), 'terrain');
      continue;
    }

    const legResult = await optimizeLegHex(A, B, options, signal, sharedGrid, frac => {
      onProgress?.((leg + frac) / (waypoints.length - 1), 'search');
    });
    if (signal?.aborted) return null;

    usedEstimatedData = usedEstimatedData || legResult.usedEstimatedData;
    infrastructureAvailable = infrastructureAvailable && legResult.infrastructureAvailable;
    nodesEvaluated += legResult.nodesEvaluated;
    for (const cell of legResult.heatmapCells) {
      const key = `${cell.center.lat.toFixed(6)},${cell.center.lng.toFixed(6)}`;
      if (!heatmapByKey.has(key)) heatmapByKey.set(key, cell);
    }
    optimizedNodeSeqs.push(legResult.optimizedNodes);
    originalNodeSeqs.push(legResult.originalNodes);
    for (const n of legResult.optimizedNodes.slice(1)) optimizedCoords.push({ lat: n.lat, lng: n.lng });

    onProgress?.((leg + 1) / (waypoints.length - 1), 'search');
  }

  const optimized = pathStats(optimizedNodeSeqs.flat());
  const original = pathStats(originalNodeSeqs.flat());
  const improvement = original.effortScore > 0 ? (original.effortScore - optimized.effortScore) / original.effortScore : 0;

  const simplified = simplifyPath(optimizedCoords, 15);

  onScanEvent?.({ phase: 'done', progress: 1 });

  return {
    coords: simplified,
    optimized,
    original,
    improvement,
    usedEstimatedData,
    infrastructureAvailable,
    nodesEvaluated,
    heatmap: normalizeHeatmap(Array.from(heatmapByKey.values())),
    passesPerLeg: PASS_CONFIGS.length,
  };
}

/**
 * Remove intermediate points whose lateral deviation from the line joining
 * their neighbours is under `toleranceM` (a light Douglas-Peucker pass).
 */
export function simplifyPath(coords: LatLng[], toleranceM = 12): LatLng[] {
  if (coords.length <= 2) return coords;
  const keep = new Array(coords.length).fill(false);
  keep[0] = keep[coords.length - 1] = true;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    let worst = -1;
    let worstDist = toleranceM;
    for (let i = lo + 1; i < hi; i++) {
      const d = crossTrackDistance(coords[lo], coords[hi], coords[i]);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/** Approximate perpendicular distance (m) from point p to segment a-b. */
function crossTrackDistance(a: LatLng, b: LatLng, p: LatLng): number {
  // Planar approximation is fine at corridor scale (< a few km).
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((a.lat * Math.PI) / 180);
  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;
  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;
  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = (px * bx + py * by) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Clear the vegetation sample cache (tests / config changes). */
export function _clearOptimizerCaches() {
  vegCache.clear();
}
