/**
 * Multi-source, area-to-area accumulated cost field — Terrain Mobility &
 * Counter-Mobility mode, Pass 1 (docs/ROUTE_INTELLIGENCE.md §3, §15).
 *
 * The whole point of this module is the area-to-area constraint: start and
 * finish are AREAS my people are in / want to reach, not point coordinates.
 * The fix is a small, well-understood change to Dijkstra — seed the queue
 * with EVERY cell inside the origin AOI at cost 0 (a virtual super-source)
 * and run to exhaustion (no target) rather than stopping at a first-arrival
 * point. The result is a genuine cost-to-reach FIELD over the whole grid,
 * which is exactly what isochrone rings are drawn from.
 *
 * Two independent outputs, deliberately kept separate:
 *  - `trafficability` per cell — a DIRECTION-AGNOSTIC terrain property (is
 *    this patch of ground passable for this profile at all), from the
 *    steepest local gradient in any direction. Always computable, no search
 *    needed.
 *  - `timeSeconds` per cell — a REACHABILITY property from the multi-source
 *    search, which DOES use the directional, profile-parameterised edge cost
 *    in mobilityCost.ts (climbing one way is not the same as the other).
 *
 * CROSS-SLOPE (2026-07-26 update): Pass 1 shipped with the search gating on
 * climb-slope and vegetation only — cross-slope was always `null` ("unknown"),
 * so `mobilityCost.ts`'s hard side-slope NO-GO gate never actually fired. Now
 * wired to a real per-cell value (`MobilityGridCell.crossSlopeDeg`, from
 * `dataLayers/demDerivatives.ts`'s local plane fit over the elevation grid
 * already sampled — no new network source). It is still a direction-agnostic
 * "steepest gradient in this cell's worst direction" proxy, not a true
 * per-directed-edge perpendicular-to-travel calculation (that would need a
 * travel-heading-aware lookup this module doesn't build) — stated plainly in
 * that module's own docs, and deliberately the CONSERVATIVE choice: it can
 * only over-estimate roll-over risk in a given direction of travel, never
 * under-estimate it, which is the correct bias for a hard safety gate.
 */

import { LatLng } from '../utils/chainage';
import { calculateDistance } from '../utils/slopeCalculation';
import { VegetationType } from '../config/classification';
import {
  LocalProjection, AxialCoord, hexKey, hexNeighbors, hexCorners, axialToLocal, toLatLng,
} from '../utils/hexGrid';
import { MoverProfile } from './moverProfiles';
import {
  MobilitySample, TrafficabilityClass, edgeMobilityCost, signedSlopeDegrees, estimateStructureFromVegetation,
} from './mobilityCost';

export interface MobilityGridCell {
  key: string;
  hex: AxialCoord;
  center: LatLng;
  elevation: number;
  vegetation: VegetationType;
  vegEstimated: boolean;
  onTrail: boolean;
  /** Direction-agnostic local terrain gradient magnitude, degrees — from
   *  `dataLayers/demDerivatives.ts`'s local plane fit (docs §10.7 M3a, "free
   *  fidelity" from the elevation grid already sampled, no new network
   *  source). An upper-bound proxy for roll-over risk in this cell's WORST
   *  direction, not a true per-directed-edge perpendicular slope — see that
   *  module's own caveat. 0 when the grid is too small for the search to
   *  have wired this in (defensive default, not "flat"). */
  crossSlopeDeg: number;
}

export interface MobilityCellResult {
  key: string;
  center: LatLng;
  polygon: LatLng[];
  /** Seconds to reach this cell from the origin AOI via the cheapest path
   *  found for this profile. Infinity = unreachable. */
  timeSeconds: number;
  /** Terrain-only, direction-agnostic passability (see module note above). */
  trafficability: TrafficabilityClass;
  estimated: boolean;
  dataTier: 0;
}

/** Standard 15/30/60/180-minute isochrone rings — matches the pitch's own
 *  "20 min / 1 hr / 3 hr on foot from here" framing. Callers may re-bucket. */
export const DEFAULT_ISOCHRONE_MINUTES = [15, 30, 60, 120, 180];

export interface IsochroneBand {
  thresholdMinutes: number;
  /** Cells whose arrival time falls in (previous threshold, this threshold]. */
  cells: MobilityCellResult[];
}

// ---------------------------------------------------------------------------
// Terrain-only trafficability (direction-agnostic)
// ---------------------------------------------------------------------------

function classifyCellTerrain(
  cell: MobilityGridCell,
  neighbors: MobilityGridCell[],
  profile: MoverProfile
): { trafficability: TrafficabilityClass; estimated: boolean } {
  let steepestAbsDeg = 0;
  for (const n of neighbors) {
    const dist = calculateDistance(cell.center.lat, cell.center.lng, n.center.lat, n.center.lng);
    if (dist <= 0) continue;
    const s = Math.abs(signedSlopeDegrees(cell.elevation, n.elevation, dist));
    if (s > steepestAbsDeg) steepestAbsDeg = s;
  }

  // Climb uses the steepest-neighbour proxy (direction-agnostic "is this
  // patch of ground rideable in ANY direction"); side-slope now uses the
  // real per-cell plane-fit gradient (crossSlopeDeg, wired in via
  // mobilityGrid.ts/dataLayers/demDerivatives.ts) instead of reusing the
  // same steepest-neighbour number for both purposes, which conflated two
  // different physical failure modes (pitching over vs rolling over).
  if (steepestAbsDeg > profile.maxClimbDeg || cell.crossSlopeDeg > profile.maxSideSlopeDeg) {
    return { trafficability: 'NO-GO', estimated: true };
  }

  const struct = estimateStructureFromVegetation(cell.vegetation);
  let vegBlocked = false;
  if (!cell.onTrail) {
    if (profile.kind === 'wheeled' && struct.gapWidthEstimateM < profile.widthM) vegBlocked = true;
    if (profile.kind === 'tracked') {
      const canOverride = profile.overrideStemDiameterMm !== undefined && struct.stemDiameterMedianMm <= profile.overrideStemDiameterMm;
      if (!canOverride && struct.gapWidthEstimateM < profile.widthM) vegBlocked = true;
    }
  }
  if (vegBlocked) return { trafficability: 'NO-GO', estimated: true };

  const climbRatio = steepestAbsDeg / profile.maxClimbDeg;
  const sideRatio = profile.maxSideSlopeDeg > 0 ? cell.crossSlopeDeg / profile.maxSideSlopeDeg : 0;
  const heavyVeg = (cell.vegetation === 'heavyforest' || cell.vegetation === 'mediumscrub') && !cell.onTrail;
  if (climbRatio > 0.85 || sideRatio > 0.85 || heavyVeg) return { trafficability: 'SLOW-GO', estimated: true };
  return { trafficability: 'GO', estimated: cell.vegEstimated };
}

// ---------------------------------------------------------------------------
// Binary min-heap (time-ordered) — plain, self-contained, no dependency.
// ---------------------------------------------------------------------------

class MinHeap {
  private items: { key: string; priority: number }[] = [];

  get size(): number { return this.items.length; }

  push(key: string, priority: number): void {
    this.items.push({ key, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): { key: string; priority: number } | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < n && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// Multi-source Dijkstra — the area-to-area engine
// ---------------------------------------------------------------------------

/**
 * Pure function: no network, no side effects — safe to run on the main
 * thread OR inside a Web Worker (see mobilityWorker.ts), given already-sampled
 * cells. Seeds every cell in `originKeys` at cost 0 (the super-source) and
 * relaxes outward using the profile's directional edge cost; a cell's
 * `timeSeconds` is the cheapest arrival time from ANYWHERE in the origin AOI,
 * which is the whole point — the caller never has to guess a single entry
 * point.
 */
export interface AccumulatedCostSearchResult {
  best: Map<string, { timeSeconds: number; estimated: boolean }>;
  /** Predecessor cell key on the cheapest path found so far — enables
   *  backtracking a specific route (see `extractPath`) out of the same
   *  reachability field the isochrones are drawn from, rather than running a
   *  second, separate point-to-point search. */
  prev: Map<string, string>;
}

export interface AccumulatedCostSearchOptions {
  /** Multiplicative penalty per DIRECTED edge (keyed `${fromKey}|${toKey}`),
   *  applied to that edge's time cost before relaxation. Used by
   *  corridorAnalysis.ts's k-dissimilar-route search: after extracting the
   *  cheapest path, its edges are penalised and the search re-run, so the
   *  next route is genuinely different rather than a trivial variant. */
  edgePenalties?: Map<string, number>;
}

export function runAccumulatedCostSearch(
  cells: MobilityGridCell[],
  originKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  options: AccumulatedCostSearchOptions = {}
): AccumulatedCostSearchResult {
  const { edgePenalties } = options;
  const byKey = new Map<string, MobilityGridCell>();
  for (const c of cells) byKey.set(c.key, c);

  const best = new Map<string, { timeSeconds: number; estimated: boolean }>();
  const prev = new Map<string, string>();
  const heap = new MinHeap();
  for (const key of originKeys) {
    if (!byKey.has(key)) continue;
    best.set(key, { timeSeconds: 0, estimated: false });
    heap.push(key, 0);
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const known = best.get(cur.key);
    if (!known || cur.priority > known.timeSeconds) continue; // stale heap entry
    const cell = byKey.get(cur.key);
    if (!cell) continue;

    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      const neighbor = byKey.get(nKey);
      if (!neighbor) continue;
      const dist = calculateDistance(cell.center.lat, cell.center.lng, neighbor.center.lat, neighbor.center.lng);
      const sampleA: MobilitySample = { lat: cell.center.lat, lng: cell.center.lng, elevation: cell.elevation, vegetation: cell.vegetation, vegEstimated: cell.vegEstimated, onTrail: cell.onTrail };
      const sampleB: MobilitySample = { lat: neighbor.center.lat, lng: neighbor.center.lng, elevation: neighbor.elevation, vegetation: neighbor.vegetation, vegEstimated: neighbor.vegEstimated, onTrail: neighbor.onTrail };
      const result = edgeMobilityCost(profile, sampleA, sampleB, dist, { nightMode, crossSlopeDeg: cell.crossSlopeDeg });
      if (!isFinite(result.timeSeconds)) continue; // NO-GO edge — never relax through it
      const penalty = edgePenalties?.get(`${cur.key}|${nKey}`) ?? 1;
      const candidateTime = known.timeSeconds + result.timeSeconds * penalty;
      const existing = best.get(nKey);
      if (!existing || candidateTime < existing.timeSeconds) {
        const estimated = known.estimated || result.estimated;
        best.set(nKey, { timeSeconds: candidateTime, estimated });
        prev.set(nKey, cur.key);
        heap.push(nKey, candidateTime);
      }
    }
  }

  return { best, prev };
}

/**
 * Backtrack the cheapest path from anywhere in the origin AOI to the
 * cheapest-reached cell inside `objectiveKeys`, using the predecessor map a
 * search run already produced. Returns ordered cell keys (origin → objective)
 * or null if no objective cell was reachable.
 */
export function extractPath(
  reach: AccumulatedCostSearchResult,
  objectiveKeys: string[]
): string[] | null {
  let bestKey: string | null = null;
  let bestTime = Infinity;
  for (const key of objectiveKeys) {
    const r = reach.best.get(key);
    if (r && r.timeSeconds < bestTime) {
      bestTime = r.timeSeconds;
      bestKey = key;
    }
  }
  if (bestKey === null) return null;

  const path: string[] = [bestKey];
  let cur: string | undefined = bestKey;
  const guard = new Set<string>([cur]);
  while (reach.prev.has(cur)) {
    cur = reach.prev.get(cur)!;
    if (guard.has(cur)) break; // defensive: never loop on a malformed predecessor chain
    guard.add(cur);
    path.push(cur);
  }
  return path.reverse();
}

// ---------------------------------------------------------------------------
// Assembly — grid cells + terrain classification + isochrone banding into
// map-renderable results.
// ---------------------------------------------------------------------------

export function assembleMobilityResults(
  cells: MobilityGridCell[],
  hexSize: number,
  proj: LocalProjection,
  reach: Map<string, { timeSeconds: number; estimated: boolean }>,
  profile: MoverProfile
): MobilityCellResult[] {
  const byKey = new Map<string, MobilityGridCell>();
  for (const c of cells) byKey.set(c.key, c);

  return cells.map(cell => {
    const neighbors = hexNeighbors(cell.hex).map(h => byKey.get(hexKey(h))).filter((c): c is MobilityGridCell => !!c);
    const terrain = classifyCellTerrain(cell, neighbors, profile);
    const arrival = reach.get(cell.key);
    const local = axialToLocal(cell.hex, hexSize);
    const polygon = hexCorners(local, hexSize).map(p => toLatLng(proj, p));
    polygon.push(polygon[0]);
    return {
      key: cell.key,
      center: cell.center,
      polygon,
      timeSeconds: arrival ? arrival.timeSeconds : Infinity,
      trafficability: terrain.trafficability,
      estimated: terrain.estimated || (arrival?.estimated ?? false) || cell.vegEstimated,
      dataTier: 0,
    };
  });
}

/** Bucket results into isochrone bands at the given minute thresholds
 *  (default DEFAULT_ISOCHRONE_MINUTES). Unreachable cells are excluded. */
export function buildIsochroneBands(
  results: MobilityCellResult[],
  thresholdsMinutes: number[] = DEFAULT_ISOCHRONE_MINUTES
): IsochroneBand[] {
  const sorted = [...thresholdsMinutes].sort((a, b) => a - b);
  return sorted.map((thresholdMinutes, i) => {
    const lowerSeconds = i === 0 ? 0 : sorted[i - 1] * 60;
    const upperSeconds = thresholdMinutes * 60;
    const bandCells = results.filter(r => isFinite(r.timeSeconds) && r.timeSeconds > lowerSeconds && r.timeSeconds <= upperSeconds);
    return { thresholdMinutes, cells: bandCells };
  });
}
