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

import { LatLng } from './chainage';
import { calculateDistance } from './geo';
import { VegetationType } from './classification';
import {
  LocalProjection, AxialCoord, hexKey, hexNeighbors, hexCorners, axialToLocal, toLatLng,
} from './hexGrid';
import { MoverProfile } from './moverProfiles';
import { RoadWayTags } from './roadSpeedModel';
import {
  TrafficabilityClass, edgeMobilityCost, signedSlopeDegrees, estimateStructureFromVegetation,
  estimateFordingRequirement,
} from './mobilityCost';
import { CellIndex, getCellIndex, toMobilitySample } from './cellIndex';

/**
 * `toMobilitySample` now lives in `cellIndex.ts` (WP2, movement-analysis
 * performance work) — `buildCellIndex` needs to call it and this module needs
 * `MobilityGridCell` (declared below), so it moved to the side of that
 * dependency with no cycle. Re-exported here unchanged so every existing
 * `import { toMobilitySample } from './accumulatedCost'` (`corridorField.ts`,
 * `minCutBarrier.ts`, `movementSimulation.ts`) keeps working. */
export { toMobilitySample };

/** One step of a resolved path through the grid, with elapsed time —
 *  the shape produced by every search in this module and consumed by the
 *  Web Worker boundary (`mobilityWorker.ts` — Worker `self` API, stays
 *  client-side) and the pure route/corridor modules alike. Defined here
 *  rather than in the worker file itself, since it carries no Worker-API
 *  dependency and several pure modules (`corridorAnalysis.ts`,
 *  `mobilityAppreciation.ts`) need it too; `mobilityWorker.ts` re-exports it
 *  for its own webapp-side consumers. */
export interface SimPathNode {
  lat: number;
  lng: number;
  cumulativeSeconds: number;
}

/** Nearest grid cell to `point` (naive linear scan — grids here are small
 *  enough that this is never the bottleneck). Defined here rather than in
 *  `mobilityGrid.ts` (which stays client-side: it orchestrates live network
 *  sampling) since this is pure geometry over an already-built cell array,
 *  and `keyTerrain.ts` needs it too; `mobilityGrid.ts` re-exports it for its
 *  own webapp-side consumers. */
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
  // painted SEVERELY RESTRICTED end to end — the exact narrow,
  // location-specific passable gap this overlay exists to show.
  if (!cell.onTrail && (steepestAbsDeg > profile.maxClimbDeg || cell.crossSlopeDeg > profile.maxSideSlopeDeg)) {
    return { trafficability: 'severely-restricted', estimated: true };
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
  if (vegBlocked) return { trafficability: 'severely-restricted', estimated: true };

  // Hydrology (docs §34) — same fording gate `edgeMobilityCost` applies to a
  // directed edge, applied here to the cell's own ground so the terrain-only
  // mobility-class overlay agrees with what the search would actually do
  // arriving into this cell. Skipped on a mapped trail, matching the
  // vegetation exemption above (a road crossing implies a bridge/ford).
  let ford: ReturnType<typeof estimateFordingRequirement> = null;
  if (!cell.onTrail) ford = estimateFordingRequirement(toMobilitySample(cell));
  if (ford && (profile.fordingDepthM === undefined || ford.assumedDepthM > profile.fordingDepthM)) {
    return { trafficability: 'severely-restricted', estimated: true };
  }

  const climbRatio = steepestAbsDeg / profile.maxClimbDeg;
  const sideRatio = profile.maxSideSlopeDeg > 0 ? cell.crossSlopeDeg / profile.maxSideSlopeDeg : 0;
  const heavyVeg = (cell.vegetation === 'heavyforest' || cell.vegetation === 'mediumscrub') && !cell.onTrail;
  if (climbRatio > 0.85 || sideRatio > 0.85 || heavyVeg || ford) return { trafficability: 'restricted', estimated: true };
  return { trafficability: 'unrestricted', estimated: cell.vegEstimated };
}

// ---------------------------------------------------------------------------
// Binary min-heap (time-ordered) — plain, self-contained, no dependency.
// ---------------------------------------------------------------------------

/**
 * Same binary min-heap as before, holding integer cell INDICES (into a
 * `CellIndex`) rather than string keys — WP2: the search core's own hot loop
 * never needs a key here, only at the `best`/`prev` output boundary. Push/pop
 * mechanics (sift-up, sift-down, swap pattern, tie-break-by-insertion-order)
 * are untouched byte-for-byte from the previous key-based version — only the
 * payload field changed from `key: string` to `index: number` — so equal-cost
 * pops resolve in EXACTLY the same order as before. */
class MinHeap {
  private items: { index: number; priority: number }[] = [];

  get size(): number { return this.items.length; }

  push(index: number, priority: number): void {
    this.items.push({ index, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): { index: number; priority: number } | undefined {
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
  const idx: CellIndex = getCellIndex(cells);
  const n = cells.length;
  const totalCells = Math.max(1, n);

  // Hot-path state as flat TypedArrays, indexed exactly like `idx` — this
  // replaces the `Map<string, ...>` `best` lookups WP2's audit found in the
  // inner loop (waste #2).
  const bestTime = new Float64Array(n).fill(Infinity);
  const bestEstimated = new Uint8Array(n);
  // Presence, tracked SEPARATELY from `bestTime`'s value — NOT "bestTime[i]
  // !== Infinity". The original `Map<string, ...>` checked key PRESENCE
  // (`existing === undefined`) to decide "already settled", regardless of
  // what value was stored. A settled cost CAN legitimately be Infinity: an
  // `edgePenalties` entry of `Infinity` (keyTerrain.ts's candidate-denial
  // mechanism, "an Infinity edge penalty, deliberately unlike every other
  // penalty" — see that module's own header) produces exactly that via
  // `result.timeSeconds * penalty`, since the raw edge cost's `isFinite`
  // check runs BEFORE the penalty multiply, not after. Using `bestTime[i]
  // === Infinity` as the presence sentinel therefore collided with a real,
  // legitimate settled value: a denied cell got re-discovered and re-pushed
  // to `order` on every single visit instead of once, corrupting
  // `settledCount`/the heap and — over enough re-visits, since Infinity
  // priority entries never trip the heap's own staleness check either
  // (`Infinity > Infinity` is false) — growing `order` without bound (the
  // observed live failure: `RangeError: Invalid array length` inside
  // `keyTerrain.ts`'s scoring loop, the exact caller that uses Infinity
  // denial penalties).
  const settled = new Uint8Array(n);
  // `prev` stays a plain string-keyed Map: it's write-only inside the search
  // loop (only ever read afterwards, by `extractPath`), so it was never part
  // of the hot-loop cost this WP targets, and keeping it string-keyed sidesteps
  // needing a second overflow structure for `resumeFrom.prev` entries whose
  // key predates the current (possibly grown) cell set.
  const prev = new Map<string, string>();
  // `resumeFrom` may carry settled cells that AREN'T in this call's `cells`
  // (e.g. a shrinking or disjoint cell set between rounds) — original code
  // still copied them into `best` unconditionally, just never relaxed
  // through them (they never made it onto the heap). Preserved here as a
  // small overflow map, merged back in at the end.
  const overflowBest = new Map<string, { timeSeconds: number; estimated: boolean }>();
  // Records `best`'s FIRST-INSERTION order — the same order the original
  // Map-based implementation produced for free via `Map.set` (a `.set()` on
  // an already-present key never moves it). This matters beyond cosmetics:
  // `runAccumulatedCostSearch`'s own resume path below iterates a prior
  // result's `best` to seed the heap, so insertion order feeds the MinHeap's
  // tie-break-by-insertion-order, which changes which predecessor wins an
  // exact tie (common on uniform-cost terrain) and therefore the
  // reconstructed route. Out-of-grid `resumeFrom` keys are interleaved here
  // in their original relative position (not appended after everything
  // else), exactly matching the original single-Map insertion order.
  const order: string[] = [];
  const heap = new MinHeap();
  let settledCount = 0;

  if (resumeFrom) {
    for (const [key, v] of resumeFrom.best) {
      order.push(key);
      const i = idx.keyToIndex.get(key);
      if (i === undefined) { overflowBest.set(key, v); settledCount++; continue; }
      if (!settled[i]) { settledCount++; settled[i] = 1; }
      bestTime[i] = v.timeSeconds;
      bestEstimated[i] = v.estimated ? 1 : 0;
    }
    for (const [key, p] of resumeFrom.prev) prev.set(key, p);
    // Same iteration order as the original (resumeFrom.best's own insertion
    // order) — matters for tie-break-by-insertion-order in the heap below.
    for (const [key] of resumeFrom.best) {
      const i = idx.keyToIndex.get(key);
      if (i !== undefined) heap.push(i, bestTime[i]);
    }
  } else {
    for (const key of originKeys) {
      const i = idx.keyToIndex.get(key);
      if (i === undefined) continue;
      if (!settled[i]) { settledCount++; order.push(key); settled[i] = 1; }
      bestTime[i] = 0;
      bestEstimated[i] = 0;
      heap.push(i, 0);
    }
  }

  // Convert the caller-supplied string-keyed `edgePenalties` into an
  // index-keyed lookup ONCE per search, rather than building a template
  // string per relaxation in the hot loop below. `edgePenalties` is supplied
  // by exactly the hottest callers (corridorAnalysis.ts's k-dissimilar route
  // loop, keyTerrain.ts's scoring passes), so this conversion cost is paid
  // once per search instead of once per edge. Public signature (string-keyed
  // map) is unchanged; keys that don't resolve in this grid are simply
  // dropped, matching the original `Map.get` returning `undefined` for them.
  let edgePenaltiesByIndex: Map<number, number> | undefined;
  if (edgePenalties) {
    edgePenaltiesByIndex = new Map();
    for (const [key, penalty] of edgePenalties) {
      const sep = key.indexOf('|');
      if (sep === -1) continue;
      const fromIdx = idx.keyToIndex.get(key.slice(0, sep));
      const toIdx = idx.keyToIndex.get(key.slice(sep + 1));
      if (fromIdx === undefined || toIdx === undefined) continue;
      edgePenaltiesByIndex.set(fromIdx * n + toIdx, penalty);
    }
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    if (cur.priority > bestTime[cur.index]) continue; // stale heap entry
    onProgress?.(Math.min(1, settledCount / totalCells));

    const base = cur.index * 6;
    for (let d = 0; d < 6; d++) {
      const nIdx = idx.neighbors[base + d];
      if (nIdx === -1) continue;
      const dist = idx.neighborDistM[base + d];
      const sampleA = idx.samples[cur.index];
      const sampleB = idx.samples[nIdx];
      const result = edgeMobilityCost(profile, sampleA, sampleB, dist, { nightMode, crossSlopeDeg: idx.crossSlopeDeg[cur.index] });
      if (!isFinite(result.timeSeconds)) continue; // NO-GO edge — never relax through it
      const penalty = edgePenaltiesByIndex ? (edgePenaltiesByIndex.get(cur.index * n + nIdx) ?? 1) : 1;
      const candidateTime = bestTime[cur.index] + result.timeSeconds * penalty;
      const hadExisting = settled[nIdx] === 1;
      if (!hadExisting || candidateTime < bestTime[nIdx]) {
        if (!hadExisting) { settledCount++; order.push(idx.indexToKey[nIdx]); settled[nIdx] = 1; }
        const estimated = bestEstimated[cur.index] === 1 || result.estimated;
        bestTime[nIdx] = candidateTime;
        bestEstimated[nIdx] = estimated ? 1 : 0;
        prev.set(idx.indexToKey[nIdx], idx.indexToKey[cur.index]);
        heap.push(nIdx, candidateTime);
      }
    }
  }

  const best = new Map<string, { timeSeconds: number; estimated: boolean }>();
  for (const key of order) {
    const i = idx.keyToIndex.get(key);
    if (i !== undefined) {
      best.set(key, { timeSeconds: bestTime[i], estimated: bestEstimated[i] === 1 });
    } else {
      const v = overflowBest.get(key);
      if (v) best.set(key, v);
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
  const idx: CellIndex = getCellIndex(cells);
  const n = cells.length;

  const bestTime = new Float64Array(n).fill(Infinity);
  // Presence, tracked separately from `bestTime`'s value — see
  // `runAccumulatedCostSearch`'s identical `settled` array for why a
  // `bestTime[i] === Infinity` presence check is unsafe in general (this
  // function has no `edgePenalties` today, so it cannot currently produce a
  // legitimate Infinity-valued settled cost, but the check itself is the
  // same anti-pattern that broke the forward search — fixed here too rather
  // than leaving a latent trap for the next caller/change).
  const settled = new Uint8Array(n);
  const heap = new MinHeap();
  // Tracks `best`'s first-insertion order — see `runAccumulatedCostSearch`'s
  // identical `order` array for why this matters (tie-break-by-insertion-
  // order feeds into any caller that seeds a heap from this result).
  const order: number[] = [];
  for (const key of objectiveKeys) {
    const i = idx.keyToIndex.get(key);
    if (i === undefined) continue;
    if (!settled[i]) { order.push(i); settled[i] = 1; }
    bestTime[i] = 0;
    heap.push(i, 0);
  }

  while (heap.size > 0) {
    const cur = heap.pop()!;
    if (cur.priority > bestTime[cur.index]) continue; // stale heap entry

    const base = cur.index * 6;
    for (let d = 0; d < 6; d++) {
      const nIdx = idx.neighbors[base + d];
      if (nIdx === -1) continue;
      // Directed edge neighbour → cell: the cost of the step that would bring
      // a mover standing at `neighbor` onto `cell` (`cur`), which is the
      // direction the remaining-time field must be built from. `neighborDistM`
      // is stored once as `cell → neighbour` (the forward search's own
      // order); reused here in reverse order because haversine distance is
      // symmetric — see cellIndex.ts's header for the bit-identical proof.
      const dist = idx.neighborDistM[base + d];
      if (blockedEdges?.has(`${idx.indexToKey[nIdx]}|${idx.indexToKey[cur.index]}`)) continue;
      const sampleFrom = idx.samples[nIdx];
      const sampleTo = idx.samples[cur.index];
      const result = edgeMobilityCost(profile, sampleFrom, sampleTo, dist, { nightMode, crossSlopeDeg: idx.crossSlopeDeg[nIdx] });
      if (!isFinite(result.timeSeconds)) continue;
      const candidate = bestTime[cur.index] + result.timeSeconds;
      const existing = settled[nIdx] === 1;
      if (!existing || candidate < bestTime[nIdx]) {
        if (!existing) { order.push(nIdx); settled[nIdx] = 1; }
        bestTime[nIdx] = candidate;
        heap.push(nIdx, candidate);
      }
    }
  }

  const best = new Map<string, number>();
  for (const i of order) best.set(idx.indexToKey[i], bestTime[i]);
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
