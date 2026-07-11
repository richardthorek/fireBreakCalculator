/**
 * Corridor route optimizer ("smart pathfinding").
 *
 * The user's drawn line fixes the waypoints they must connect. Between each
 * consecutive pair of waypoints this module searches a lateral corridor for a
 * lower-cost path: it lays a lattice of candidate stations perpendicular to the
 * straight leg, samples real slope (DEM, batched) and vegetation (NVIS/NSW,
 * cached) at every candidate node, and runs a dynamic program over the lattice
 * to find the cheapest way through — steering around pockets of heavy timber
 * and steep ground while never abandoning the user's chosen corridor.
 *
 * Data honesty: the result carries `usedEstimatedData` whenever any sample fell
 * back to non-authoritative sources, and the UI must keep flagging that. The
 * optimizer proposes; the firefighter disposes — the optimized line is a
 * preview until explicitly applied.
 */

import { VegetationType } from '../config/classification';
import { calculateDistance, calculateSlope, sampleElevationsBatch } from './slopeCalculation';
import { fetchStateVegetation } from './stateVegetationRouter';
import { fetchCorridorInfrastructure, distanceToNearestTrail, InfrastructureTrail } from './infrastructureService';
import { logger } from './logger';

export interface LatLng {
  lat: number;
  lng: number;
}

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
  /** Number of grid nodes evaluated (diagnostic). */
  nodesEvaluated: number;
}

export interface OptimizeOptions {
  /** Max lateral deviation from the straight leg, metres. Default adapts to leg length. */
  maxOffsetM?: number;
  /** Abort signal for cancelling long optimizations. */
  signal?: AbortSignal;
  /** Progress callback (0..1). */
  onProgress?: (fraction: number) => void;
}

interface GridNode {
  lat: number;
  lng: number;
  elevation: number;
  vegetation: VegetationType;
  vegEstimated: boolean;
  /** Within TRAIL_SNAP_M of a mapped trail/road. */
  onTrail: boolean;
}

/** Vegetation cache keyed at ~100 m — matches the NVIS raster resolution. */
const vegCache = new Map<string, { type: VegetationType; estimated: boolean }>();
const vegKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`;

async function sampleVegetation(points: LatLng[], signal?: AbortSignal): Promise<{ type: VegetationType; estimated: boolean }[]> {
  // Deduplicate by cache key first so a dense grid costs few real queries.
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

/** Destination point given start, bearing (deg) and distance (m). */
function destination(origin: LatLng, bearingDeg: number, distanceM: number): LatLng {
  const R = 6371000;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const dr = distanceM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

/** Initial bearing from a to b in degrees. */
function bearing(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Edge cost between two sampled nodes: metres × slope factor × mean fuel factor,
 *  with the fuel factor discounted when the edge follows a mapped trail. */
function edgeCost(a: GridNode, b: GridNode): { cost: number; dist: number; slope: number; onTrail: boolean } {
  const dist = calculateDistance(a.lat, a.lng, b.lat, b.lng);
  if (dist <= 0) return { cost: 0, dist: 0, slope: 0, onTrail: false };
  const slope = calculateSlope(a.elevation, b.elevation, dist);
  const onTrail = a.onTrail && b.onTrail;
  const veg = ((VEGETATION_COST[a.vegetation] + VEGETATION_COST[b.vegetation]) / 2) * (onTrail ? TRAIL_FUEL_DISCOUNT : 1);
  return { cost: dist * slopeCost(slope) * veg, dist, slope, onTrail };
}

/** Accumulate comparison stats over a path of sampled nodes. */
function pathStats(nodes: GridNode[]): RouteComparisonStats {
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
    if (nodes[i].vegetation === 'heavyforest' || nodes[i - 1].vegetation === 'heavyforest') heavy += dist / (nodes[i].vegetation === nodes[i - 1].vegetation ? 1 : 2);
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

/**
 * Optimize the route between the user's waypoints.
 *
 * Each leg gets a lattice of `stations × offsets` candidate nodes; a dynamic
 * program finds the cheapest chain from waypoint to waypoint, allowing limited
 * lateral movement per step so the path stays buildable (no hairpins).
 */
export async function optimizeRoute(waypoints: LatLng[], options: OptimizeOptions = {}): Promise<OptimizedRouteResult | null> {
  if (waypoints.length < 2) return null;
  const { signal, onProgress } = options;

  const optimizedCoords: LatLng[] = [waypoints[0]];
  const optimizedNodes: GridNode[][] = [];
  const originalNodes: GridNode[][] = [];
  let usedEstimatedData = false;
  let infrastructureAvailable = true;
  let nodesEvaluated = 0;

  for (let leg = 0; leg < waypoints.length - 1; leg++) {
    if (signal?.aborted) return null;
    const A = waypoints[leg];
    const B = waypoints[leg + 1];
    const legLen = calculateDistance(A.lat, A.lng, B.lat, B.lng);

    // Very short legs are not worth optimizing.
    if (legLen < 120) {
      const nodes = await buildStraightNodes([A, B], signal);
      if (!nodes) return null;
      usedEstimatedData = usedEstimatedData || nodes.estimated;
      optimizedNodes.push(nodes.nodes);
      originalNodes.push(nodes.nodes);
      optimizedCoords.push(B);
      onProgress?.((leg + 1) / (waypoints.length - 1));
      continue;
    }

    // Lattice geometry: stations along the leg, lateral offsets across it.
    // Station count is capped so the corridor never needs more than ~250
    // vegetation cells per leg (each ~100 m NVIS cell is one cached query).
    const MAX_STATIONS = 26;
    const stationSpacing = Math.max(60, Math.min(150, legLen / 30));
    const nStations = Math.max(2, Math.min(MAX_STATIONS, Math.round(legLen / stationSpacing)));
    const maxOffset = options.maxOffsetM ?? Math.min(400, Math.max(80, legLen * 0.3));
    const OFFSET_STEPS = 4; // offsets: -4..+4 → 9 lanes
    const offsetSpacing = maxOffset / OFFSET_STEPS;
    const legBearing = bearing(A, B);
    const perpBearing = (legBearing + 90) % 360;

    // Build the grid. Station 0 = A (single node), station nStations = B (single node).
    const grid: LatLng[][] = [];
    grid.push([A]);
    for (let s = 1; s < nStations; s++) {
      const t = s / nStations;
      const center: LatLng = { lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t };
      const row: LatLng[] = [];
      for (let o = -OFFSET_STEPS; o <= OFFSET_STEPS; o++) {
        row.push(o === 0 ? center : destination(center, perpBearing, o * offsetSpacing));
      }
      grid.push(row);
    }
    grid.push([B]);

    // Sample the whole grid: one elevation batch + cached vegetation lookups
    // + one Overpass query for reusable trails in the corridor bbox.
    const flat: LatLng[] = grid.flat();
    const margin = 0.002; // ~200 m
    const lats = flat.map(p => p.lat);
    const lngs = flat.map(p => p.lng);
    const [elevRes, vegRes, infraRes] = await Promise.all([
      sampleElevationsBatch(flat),
      sampleVegetation(flat, signal),
      fetchCorridorInfrastructure(
        Math.min(...lats) - margin,
        Math.min(...lngs) - margin,
        Math.max(...lats) + margin,
        Math.max(...lngs) + margin,
        signal
      ),
    ]);
    if (signal?.aborted) return null;
    usedEstimatedData = usedEstimatedData || elevRes.estimated || vegRes.some(v => v.estimated);
    infrastructureAvailable = infrastructureAvailable && infraRes.available;
    const trails: InfrastructureTrail[] = infraRes.trails;

    const nodeGrid: GridNode[][] = [];
    let idx = 0;
    for (const row of grid) {
      const nodeRow: GridNode[] = row.map(p => {
        const n: GridNode = {
          lat: p.lat,
          lng: p.lng,
          elevation: elevRes.elevations[idx],
          vegetation: vegRes[idx].type,
          vegEstimated: vegRes[idx].estimated,
          onTrail: trails.length > 0 && distanceToNearestTrail(p, trails) <= TRAIL_SNAP_M,
        };
        idx++;
        return n;
      });
      nodeGrid.push(nodeRow);
      nodesEvaluated += nodeRow.length;
    }

    // Dynamic program across stations. Limit lateral movement to ±2 lanes per
    // step so the line stays sweeping rather than zig-zagging.
    const MAX_LANE_SHIFT = 2;
    let costs = nodeGrid[0].map(() => 0);
    let backPointers: number[][] = [];
    for (let s = 1; s < nodeGrid.length; s++) {
      const prevRow = nodeGrid[s - 1];
      const row = nodeGrid[s];
      const rowCosts = new Array(row.length).fill(Infinity);
      const rowBack = new Array(row.length).fill(0);
      for (let j = 0; j < row.length; j++) {
        for (let i = 0; i < prevRow.length; i++) {
          // Lane-shift constraint only applies between full lattice rows.
          if (prevRow.length > 1 && row.length > 1 && Math.abs(i - j) > MAX_LANE_SHIFT) continue;
          if (!isFinite(costs[i])) continue;
          const { cost } = edgeCost(prevRow[i], row[j]);
          const total = costs[i] + cost;
          if (total < rowCosts[j]) {
            rowCosts[j] = total;
            rowBack[j] = i;
          }
        }
      }
      costs = rowCosts;
      backPointers.push(rowBack);
    }

    // Trace back the cheapest chain.
    const chain: number[] = [0]; // last station has a single node (B)
    for (let s = backPointers.length - 1; s >= 0; s--) {
      chain.unshift(backPointers[s][chain[0]]);
    }
    const legPath: GridNode[] = chain.map((laneIdx, s) => nodeGrid[s][laneIdx]);
    optimizedNodes.push(legPath);
    for (let s = 1; s < legPath.length; s++) {
      optimizedCoords.push({ lat: legPath[s].lat, lng: legPath[s].lng });
    }

    // Original straight leg over the same surface = the centre lane.
    const straight: GridNode[] = nodeGrid.map(row => row[Math.floor(row.length / 2)]);
    originalNodes.push(straight);

    onProgress?.((leg + 1) / (waypoints.length - 1));
  }

  const optimized = pathStats(optimizedNodes.flat());
  const original = pathStats(originalNodes.flat());
  const improvement = original.effortScore > 0 ? (original.effortScore - optimized.effortScore) / original.effortScore : 0;

  // Simplify: drop nearly-collinear intermediate points so the applied line is clean.
  const simplified = simplifyPath(optimizedCoords);

  return {
    coords: simplified,
    optimized,
    original,
    improvement,
    usedEstimatedData,
    infrastructureAvailable,
    nodesEvaluated,
  };
}

/** Sample a straight (short) leg so its stats join the comparison. */
async function buildStraightNodes(
  coords: LatLng[],
  signal?: AbortSignal
): Promise<{ nodes: GridNode[]; estimated: boolean } | null> {
  const [elevRes, vegRes] = await Promise.all([sampleElevationsBatch(coords), sampleVegetation(coords, signal)]);
  if (signal?.aborted) return null;
  const nodes = coords.map((p, i) => ({
    lat: p.lat,
    lng: p.lng,
    elevation: elevRes.elevations[i],
    vegetation: vegRes[i].type,
    vegEstimated: vegRes[i].estimated,
    // Short legs skip the corridor search; trail lookup is skipped with them.
    onTrail: false,
  }));
  return { nodes, estimated: elevRes.estimated || vegRes.some(v => v.estimated) };
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
