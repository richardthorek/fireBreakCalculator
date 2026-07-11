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
} from './hexGrid';
import { logger } from './logger';

export type { LatLng };

/** Cost multipliers per vegetation class (relative effort of building line). */
const VEGETATION_COST: Record<VegetationType, number> = {
  grassland: 1.0,
  lightshrub: 1.2,
  mediumscrub: 1.7,
  heavyforest: 2.6,
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
  /** 0..1 normalized traversal cost — 0 = easiest (green), 1 = hardest (red). */
  costNormalized: number;
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

export interface OptimizeOptions {
  /** Max lateral half-width of the WIDE (pass 1) search corridor, metres.
   *  Defaults to a generous spread — see PASS_CONFIGS. */
  maxOffsetM?: number;
  /** Abort signal for cancelling long optimizations. */
  signal?: AbortSignal;
  /** Progress callback (0..1), smoothed across legs and passes. */
  onProgress?: (fraction: number) => void;
}

/** A sampled point with everything the cost model needs. */
interface SampledNode {
  lat: number;
  lng: number;
  elevation: number;
  vegetation: VegetationType;
  vegEstimated: boolean;
  onTrail: boolean;
}

interface RawHeatmapCell {
  center: LatLng;
  polygon: LatLng[];
  unitCost: number;
  vegetation: VegetationType;
  onTrail: boolean;
  estimated: boolean;
}

/** Vegetation cache keyed at ~100 m — matches the NVIS raster resolution. */
const vegCache = new Map<string, { type: VegetationType; estimated: boolean }>();
const vegKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

async function sampleVegetation(points: LatLng[], signal?: AbortSignal): Promise<{ type: VegetationType; estimated: boolean }[]> {
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
  const [elevRes, vegRes] = await Promise.all([sampleElevationsBatch(points), sampleVegetation(points, signal)]);
  const nodes = points.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    elevation: elevRes.elevations[i],
    vegetation: vegRes[i].type,
    vegEstimated: vegRes[i].estimated,
    onTrail: trails.length > 0 && distanceToNearestTrail(p, trails) <= TRAIL_SNAP_M,
  }));
  return { nodes, estimated: elevRes.estimated || vegRes.some(v => v.estimated) };
}

/** Edge cost between two sampled nodes: metres × slope factor × mean fuel factor,
 *  discounted when the edge follows a mapped trail. */
function edgeCost(a: SampledNode, b: SampledNode): { cost: number; dist: number; slope: number; onTrail: boolean } {
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

/** Simple sparse Dijkstra over a small (≤ ~1500 node) adjacency graph. */
function dijkstra(
  nodes: Map<string, SampledNode>,
  adjacency: Map<string, string[]>,
  startId: string,
  endId: string
): { path: string[]; cost: number } | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(startId, 0);
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

/**
 * Run one search pass: tile the corridor around `guidePath` in hexagons,
 * sample each cell, run Dijkstra from A to B over the hex adjacency graph
 * (with A/B connected directly to every hex within reach, plus a direct
 * A–B fallback edge so a path always exists), and return the cheapest chain.
 */
async function runHexPass(
  A: LatLng,
  B: LatLng,
  guidePath: LatLng[],
  halfWidth: number,
  targetCount: number,
  trails: InfrastructureTrail[],
  signal: AbortSignal | undefined
): Promise<HexPassResult | null> {
  const origin = guidePath[Math.floor(guidePath.length / 2)];
  const proj: LocalProjection = makeProjection(origin);
  const pathLocal = guidePath.map(p => toLocal(proj, p));
  const pathLen = Math.max(1, polylineLengthLocal(pathLocal));

  let size = chooseHexSize(pathLen, halfWidth, targetCount);
  let cellsRaw = generateCorridorHexes(pathLocal, halfWidth, size);
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
  if (signal?.aborted || cellsRaw.length === 0) return null;

  const hexLatLngs = cellsRaw.map(c => toLatLng(proj, c.center));
  const allPoints = [A, B, ...hexLatLngs];
  const [elevRes, vegRes] = await Promise.all([sampleElevationsBatch(allPoints), sampleVegetation(allPoints, signal)]);
  if (signal?.aborted) return null;
  const estimated = elevRes.estimated || vegRes.some(v => v.estimated);

  const idFor = (i: number) => (i === 0 ? 'A' : i === 1 ? 'B' : hexKey(cellsRaw[i - 2].hex));
  const nodeMap = new Map<string, SampledNode>();
  const localById = new Map<string, { x: number; y: number }>();
  allPoints.forEach((p, i) => {
    const id = idFor(i);
    const local = i < 2 ? toLocal(proj, p) : cellsRaw[i - 2].center;
    nodeMap.set(id, {
      lat: p.lat,
      lng: p.lng,
      elevation: elevRes.elevations[i],
      vegetation: vegRes[i].type,
      vegEstimated: vegRes[i].estimated,
      onTrail: trails.length > 0 && distanceToNearestTrail(p, trails) <= TRAIL_SNAP_M,
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

  const result = dijkstra(nodeMap, adjacency, 'A', 'B');
  if (!result) return null;

  const pathNodes = result.path.map(id => nodeMap.get(id)!);

  // Per-hex unit cost (average cost-per-metre over incident edges) drives
  // the heatmap — a genuine terrain+vegetation traversal-difficulty metric,
  // not just a proxy.
  const cells: RawHeatmapCell[] = cellsRaw.map(cell => {
    const id = hexKey(cell.hex);
    const node = nodeMap.get(id)!;
    const neighborIds = (adjacency.get(id) ?? []).filter(nid => nodeMap.has(nid) && nid !== 'A' && nid !== 'B');
    let unitCost = 0.6;
    if (neighborIds.length > 0) {
      let sum = 0;
      for (const nid of neighborIds) {
        const e = edgeCost(node, nodeMap.get(nid)!);
        if (e.dist > 0) sum += e.cost / e.dist;
      }
      unitCost = sum / neighborIds.length;
    }
    const corners = hexCorners(cell.center, size).map(c => toLatLng(proj, c));
    return {
      center: { lat: node.lat, lng: node.lng },
      polygon: [...corners, corners[0]],
      unitCost,
      vegetation: node.vegetation,
      onTrail: node.onTrail,
      estimated: node.vegEstimated,
    };
  });

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
  onLegProgress: (fraction: number) => void
): Promise<LegHexResult> {
  const legLen = calculateDistance(A.lat, A.lng, B.lat, B.lng);
  // Wide by default — aggressive spread so a single run finds what a few
  // manual re-runs used to stumble into.
  const baseHalfWidth = Math.min(
    900,
    Math.max(60, Math.min(options.maxOffsetM ?? Math.min(700, Math.max(150, legLen * 0.45)), legLen * 1.3))
  );

  // One infrastructure fetch per leg (widest corridor bbox), reused by every pass.
  const marginDeg = (baseHalfWidth + 200) / 111320;
  const lats = [A.lat, B.lat];
  const lngs = [A.lng, B.lng];
  const infra = await fetchCorridorInfrastructure(
    Math.min(...lats) - marginDeg,
    Math.min(...lngs) - marginDeg,
    Math.max(...lats) + marginDeg,
    Math.max(...lngs) + marginDeg,
    signal
  );
  const trails = infra.trails;

  let guidePath: LatLng[] = [A, B];
  let best: HexPassResult | null = null;
  let widePassCells: RawHeatmapCell[] = [];
  let usedEstimatedData = false;
  let nodesEvaluated = 0;

  for (let i = 0; i < PASS_CONFIGS.length; i++) {
    if (signal?.aborted) break;
    const cfg = PASS_CONFIGS[i];
    const halfWidth = Math.max(25, baseHalfWidth * cfg.widthFactor);
    const pass = await runHexPass(A, B, guidePath, halfWidth, cfg.targetCount, trails, signal);
    onLegProgress((i + 1) / PASS_CONFIGS.length);
    if (!pass) continue;
    usedEstimatedData = usedEstimatedData || pass.estimated;
    nodesEvaluated += pass.nodesEvaluated;
    if (i === 0) widePassCells = pass.cells;
    if (!best || pass.cost < best.cost) best = pass;
    guidePath = pass.pathNodes.map(n => ({ lat: n.lat, lng: n.lng }));
  }

  const straightPts = interpolateLine(A, B, 60);
  const original = await sampleNodes(straightPts, trails, signal);
  usedEstimatedData = usedEstimatedData || original.estimated;

  if (!best) {
    // Every pass failed (shouldn't happen given the A–B fallback edge, but
    // stay honest and safe): fall back to the straight line as "optimized" too.
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

function normalizeHeatmap(cells: RawHeatmapCell[]): HexHeatmapCell[] {
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
    vegetation: c.vegetation,
    onTrail: c.onTrail,
    estimated: c.estimated,
  }));
}

/**
 * Optimize the route between the user's waypoints.
 *
 * Each leg gets three hex-grid search passes (wide → refine → polish); the
 * cheapest of the three becomes that leg's contribution to the final route.
 */
export async function optimizeRoute(waypoints: LatLng[], options: OptimizeOptions = {}): Promise<OptimizedRouteResult | null> {
  if (waypoints.length < 2) return null;
  const { signal, onProgress } = options;

  const optimizedCoords: LatLng[] = [waypoints[0]];
  const optimizedNodeSeqs: SampledNode[][] = [];
  const originalNodeSeqs: SampledNode[][] = [];
  const rawHeatmapCells: RawHeatmapCell[] = [];
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
      onProgress?.((leg + 1) / (waypoints.length - 1));
      continue;
    }

    const legResult = await optimizeLegHex(A, B, options, signal, frac => {
      onProgress?.((leg + frac) / (waypoints.length - 1));
    });
    if (signal?.aborted) return null;

    usedEstimatedData = usedEstimatedData || legResult.usedEstimatedData;
    infrastructureAvailable = infrastructureAvailable && legResult.infrastructureAvailable;
    nodesEvaluated += legResult.nodesEvaluated;
    rawHeatmapCells.push(...legResult.heatmapCells);
    optimizedNodeSeqs.push(legResult.optimizedNodes);
    originalNodeSeqs.push(legResult.originalNodes);
    for (const n of legResult.optimizedNodes.slice(1)) optimizedCoords.push({ lat: n.lat, lng: n.lng });

    onProgress?.((leg + 1) / (waypoints.length - 1));
  }

  const optimized = pathStats(optimizedNodeSeqs.flat());
  const original = pathStats(originalNodeSeqs.flat());
  const improvement = original.effortScore > 0 ? (original.effortScore - optimized.effortScore) / original.effortScore : 0;

  const simplified = simplifyPath(optimizedCoords, 15);

  return {
    coords: simplified,
    optimized,
    original,
    improvement,
    usedEstimatedData,
    infrastructureAvailable,
    nodesEvaluated,
    heatmap: normalizeHeatmap(rawHeatmapCells),
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
