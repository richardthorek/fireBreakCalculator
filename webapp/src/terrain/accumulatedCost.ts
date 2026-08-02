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
import { RoadWayTags } from './roadSpeedModel';
import {
  MobilitySample, TrafficabilityClass, edgeMobilityCost, signedSlopeDegrees, estimateStructureFromVegetation,
  estimateFordingRequirement,
} from './mobilityCost';

export interface MobilityGridCell {
  key: string;
  hex: AxialCoord;
  center: LatLng;
  elevation: number;
  vegetation: VegetationType;
  vegEstimated: boolean;
  onTrail: boolean;
  /** Tags of the nearest trail/road within snap distance (docs §35) — same
   *  feature `onTrail` itself is derived from, found in the same scan. Feeds
   *  the road-class speed ceiling (`roadSpeedModel.ts`) so an onTrail hex's
   *  speed bonus reflects what kind of road it actually is (a motorway and a
   *  grade-5 track are not the same "onTrail"), rather than a flat bonus.
   *  `null` when `onTrail` is false, or when the trail data source didn't
   *  reach this cell. */
  nearestTrailTags: RoadWayTags | null;
  /** Direction-agnostic local terrain gradient magnitude, degrees — from
   *  `dataLayers/demDerivatives.ts`'s local plane fit (docs §10.7 M3a, "free
   *  fidelity" from the elevation grid already sampled, no new network
   *  source). An upper-bound proxy for roll-over risk in this cell's WORST
   *  direction, not a true per-directed-edge perpendicular slope — see that
   *  module's own caveat. 0 when the grid is too small for the search to
   *  have wired this in (defensive default, not "flat"). */
  crossSlopeDeg: number;

  // --- Hydrology (docs §34) ---------------------------------------------
  /** Distance to the nearest mapped water feature, metres — sampled at the
   *  cell's centre AND its six hex corners (not centre alone, unlike
   *  `onTrail`'s single-point test), keeping the minimum. A linear
   *  watercourse narrower than the hex is more likely to clip a corner than
   *  land exactly on the centre, so this catches more real crossings than a
   *  centre-only test at the same grid resolution — see mobilityGrid.ts.
   *  `Infinity` when no watercourse/water-body data reached this cell
   *  (Overpass unavailable) or none was found nearby. */
  waterDistanceM: number;
  /** True when the cell's own CENTRE falls inside a mapped `natural=water`
   *  body (point-in-polygon, not proximity) — the direct "this ground IS
   *  water" case, always the most severe regardless of `waterDistanceM`. */
  inWaterBody: boolean;
  /** OSM class of the nearest watercourse within snap distance
   *  (`river`/`canal`/`stream`), or null when nothing is in range. Feeds the
   *  fording-severity gate in `mobilityCost.ts`. */
  nearestWaterwayKind: string | null;
  /** DEA Water Observations multi-year wet-frequency (0..1) at this cell,
   *  from the area-raster colour-ramp reconstruction
   *  (`dataLayers/deaWaterObservationsService.ts`) — null when unavailable
   *  (fetch failed, outside DEA's technical extent, or the pixel matched no
   *  ramp colour). Never fabricated as 0; absence is absence. */
  waterFrequency: number | null;
}

/** A cell carries a real water signal — in a standing body, near a mapped
 *  watercourse, or a high DEA WOfS wet-frequency (docs §34). The single
 *  source of truth for "does this cell count as hydrology-affected" — the
 *  run's own assessment log, the GIS export (`mobilityGisExport.ts`), the AI
 *  briefing payload (`mobilityAssistantApi.ts`) and per-corridor risk scoring
 *  (`corridorField.ts`) all call this SAME function rather than each tuning
 *  their own threshold, so none of them can quietly disagree about what
 *  counts. Lives here (not `mobilityAppreciation.ts`, which originally
 *  defined it) so `corridorField.ts` — a lower-level module
 *  `mobilityAppreciation.ts` itself imports — can use it without a circular
 *  import; re-exported from `mobilityAppreciation.ts` for every existing
 *  caller's import path. */
export const carriesWaterSignal = (c: Pick<MobilityGridCell, 'inWaterBody' | 'nearestWaterwayKind' | 'waterFrequency'>): boolean =>
  c.inWaterBody || c.nearestWaterwayKind !== null || (c.waterFrequency !== null && c.waterFrequency >= 0.15);

/**
 * Project a grid cell down to the `MobilitySample` shape `edgeMobilityCost`
 * consumes — ONE place that lists every field the cost function reads off a
 * cell, so a field added to either interface (this is where the hydrology
 * fields landed) can't silently go stale at one call site while every other
 * caller picks it up. Every module that builds an edge's `from`/`to` sample
 * (this file, corridorField.ts, minCutBarrier.ts, movementSimulation.ts)
 * should call this rather than hand-writing the object literal.
 */
export function toMobilitySample(cell: MobilityGridCell): MobilitySample {
  return {
    lat: cell.center.lat,
    lng: cell.center.lng,
    elevation: cell.elevation,
    vegetation: cell.vegetation,
    vegEstimated: cell.vegEstimated,
    onTrail: cell.onTrail,
    nearestTrailTags: cell.nearestTrailTags,
    waterDistanceM: cell.waterDistanceM,
    inWaterBody: cell.inWaterBody,
    nearestWaterwayKind: cell.nearestWaterwayKind,
    waterFrequency: cell.waterFrequency,
  };
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
  //
  // Skipped on a mapped trail (2026-07-28, live-tested) — see
  // `edgeMobilityCost`'s identical exemption in mobilityCost.ts for the full
  // reasoning: a real road is engineered (cut/fill) to manage its own grade,
  // so hex-averaged raw DEM slope is a worse estimate of driveability than
  // trusting the mapped road exists. Without this, a highway along a Lake
  // George shoreline shelf and a paved road descending a steep ridge both
  // painted NO-GO end to end — the exact narrow, location-specific passable
  // gap this overlay exists to show.
  if (!cell.onTrail && (steepestAbsDeg > profile.maxClimbDeg || cell.crossSlopeDeg > profile.maxSideSlopeDeg)) {
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

  // Hydrology (docs §34) — same fording gate `edgeMobilityCost` applies to a
  // directed edge, applied here to the cell's own ground so the terrain-only
  // GO/SLOW-GO/NO-GO overlay agrees with what the search would actually do
  // arriving into this cell. Skipped on a mapped trail, matching the
  // vegetation exemption above (a road crossing implies a bridge/ford).
  let ford: ReturnType<typeof estimateFordingRequirement> = null;
  if (!cell.onTrail) ford = estimateFordingRequirement(toMobilitySample(cell));
  if (ford && (profile.fordingDepthM === undefined || ford.assumedDepthM > profile.fordingDepthM)) {
    return { trafficability: 'NO-GO', estimated: true };
  }

  const climbRatio = steepestAbsDeg / profile.maxClimbDeg;
  const sideRatio = profile.maxSideSlopeDeg > 0 ? cell.crossSlopeDeg / profile.maxSideSlopeDeg : 0;
  const heavyVeg = (cell.vegetation === 'heavyforest' || cell.vegetation === 'mediumscrub') && !cell.onTrail;
  if (climbRatio > 0.85 || sideRatio > 0.85 || heavyVeg || ford) return { trafficability: 'SLOW-GO', estimated: true };
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
  /** Called as the search settles more cells — `settledFraction` is
   *  `best.size / cells.length`, a real, monotonically non-decreasing proxy
   *  for how much of the grid has been reached so far (Dijkstra can't know
   *  an exact pop-count total up front the way a bounded loop can, so this
   *  is the honest substitute — the same "how much of the graph is settled"
   *  measure isochrone tools commonly report progress against). Added
   *  because this search previously reported NOTHING while it ran — a real,
   *  reproducible dead zone in the Terrain Mobility progress bar (owner:
   *  "the 'progress' indicator stopped well before the result loaded in
   *  with a long 'nothing' time"). The caller is responsible for throttling
   *  how often it forwards this on (e.g. to whole-percent steps) if it's
   *  wired to something with per-call overhead, such as a Worker
   *  `postMessage` — this function itself only pays a cheap `Map.size` read
   *  per relaxed cell, so calling it unconditionally here is not the cost
   *  problem. */
  onProgress?: (settledFraction: number) => void;
  /**
   * Resume a previous search rather than reseeding fresh from `originKeys` —
   * the lazy tile-ring growth loop (docs §35 "the design", point 1: "delete
   * the box"). `mobilityLazyGrid.ts` materialises new tiles when the
   * reachable frontier runs off the edge of what's currently fetched, then
   * calls this again over the GROWN cell set; without `resumeFrom` that would
   * have to restart Dijkstra from scratch, discarding every already-settled
   * distance. Passing the previous call's own result back in here instead
   * seeds `best`/`prev` from it and pushes every already-settled cell onto
   * the heap at its recorded cost — correct because Dijkstra with
   * non-negative edges never needs to revise a settled distance once a cell
   * is popped, so priming from a prior settlement is equivalent to having
   * relaxed through those cells "for real" in one longer run. Already-settled
   * cells immediately re-fail the `candidateTime < existing.timeSeconds`
   * check on relaxation (no-op); the only real work is relaxing into
   * genuinely NEW cells the grown set just added. `originKeys` is ignored
   * when this is supplied.
   */
  resumeFrom?: AccumulatedCostSearchResult;
}

export function runAccumulatedCostSearch(
  cells: MobilityGridCell[],
  originKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  options: AccumulatedCostSearchOptions = {}
): AccumulatedCostSearchResult {
  const { edgePenalties, onProgress, resumeFrom } = options;
  const byKey = new Map<string, MobilityGridCell>();
  for (const c of cells) byKey.set(c.key, c);
  const totalCells = Math.max(1, cells.length);

  const best = new Map<string, { timeSeconds: number; estimated: boolean }>();
  const prev = new Map<string, string>();
  const heap = new MinHeap();
  if (resumeFrom) {
    for (const [key, v] of resumeFrom.best) best.set(key, v);
    for (const [key, p] of resumeFrom.prev) prev.set(key, p);
    for (const [key, v] of best) {
      if (byKey.has(key)) heap.push(key, v.timeSeconds);
    }
  } else {
    for (const key of originKeys) {
      if (!byKey.has(key)) continue;
      best.set(key, { timeSeconds: 0, estimated: false });
      heap.push(key, 0);
    }
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const known = best.get(cur.key);
    if (!known || cur.priority > known.timeSeconds) continue; // stale heap entry
    const cell = byKey.get(cur.key);
    if (!cell) continue;
    onProgress?.(Math.min(1, best.size / totalCells));

    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      const neighbor = byKey.get(nKey);
      if (!neighbor) continue;
      const dist = calculateDistance(cell.center.lat, cell.center.lng, neighbor.center.lat, neighbor.center.lng);
      const sampleA: MobilitySample = toMobilitySample(cell);
      const sampleB: MobilitySample = toMobilitySample(neighbor);
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
 * The SAME engine run backwards: seconds remaining from every cell TO the
 * objective AOI, rather than from the origin AOI to every cell.
 *
 * This is not a convenience wrapper — the edge cost is directional (climbing
 * out of a gully is not the reverse of dropping into it), so "time to get
 * there from here" genuinely cannot be read off the forward field. Seeding at
 * `objectiveKeys` and relaxing each popped cell's PREDECESSORS (cost of the
 * edge u→v, not v→u) is the correct reversal.
 *
 * Used by movementSimulation.ts as the mover's "cost-to-go": the thing a unit
 * is implicitly steering by when it decides which cell to step into next.
 * Cells the objective cannot be reached from are simply absent from the map
 * (not zero, not a large number) — callers decide what an unreachable
 * lookahead means for them.
 */
export function runCostToGoSearch(
  cells: MobilityGridCell[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  /** Directed edges (`${fromKey}|${toKey}`) that are severed outright — an
   *  emplaced restriction (a road block, a blown culvert). Excluded from this
   *  field exactly as a NO-GO edge is, so a mover who KNOWS about the block
   *  routes around it, while a mover who does not still drives up to it and
   *  has to turn around (movementSimulation.ts enforces the block itself). */
  blockedEdges?: Set<string>
): Map<string, number> {
  const byKey = new Map<string, MobilityGridCell>();
  for (const c of cells) byKey.set(c.key, c);

  const best = new Map<string, number>();
  const heap = new MinHeap();
  for (const key of objectiveKeys) {
    if (!byKey.has(key)) continue;
    best.set(key, 0);
    heap.push(key, 0);
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    const known = best.get(cur.key);
    if (known === undefined || cur.priority > known) continue; // stale heap entry
    const cell = byKey.get(cur.key);
    if (!cell) continue;

    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      const neighbor = byKey.get(nKey);
      if (!neighbor) continue;
      const dist = calculateDistance(neighbor.center.lat, neighbor.center.lng, cell.center.lat, cell.center.lng);
      // Directed edge neighbour → cell: the cost of the step that would bring
      // a mover standing at `neighbor` onto `cell`, which is the direction the
      // remaining-time field must be built from.
      const sampleFrom: MobilitySample = toMobilitySample(neighbor);
      const sampleTo: MobilitySample = toMobilitySample(cell);
      if (blockedEdges?.has(`${nKey}|${cur.key}`)) continue;
      const result = edgeMobilityCost(profile, sampleFrom, sampleTo, dist, { nightMode, crossSlopeDeg: neighbor.crossSlopeDeg });
      if (!isFinite(result.timeSeconds)) continue;
      const candidate = known + result.timeSeconds;
      const existing = best.get(nKey);
      if (existing === undefined || candidate < existing) {
        best.set(nKey, candidate);
        heap.push(nKey, candidate);
      }
    }
  }

  return best;
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
