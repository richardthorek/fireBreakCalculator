/**
 * Precomputed per-grid index for the Dijkstra search core
 * (`runAccumulatedCostSearch`/`runCostToGoSearch`, `accumulatedCost.ts`) —
 * WP2 of the movement-analysis performance work
 * (docs/ROUTE_INTELLIGENCE.md, profiling audit). A single Terrain Mobility
 * run performs on the order of a hundred full-grid Dijkstra passes over the
 * SAME `MobilityGridCell[]` (one per profile/threshold/restriction-
 * candidate/ensemble-mover evaluation — see the callers of those two search
 * functions in `movementSimulation.ts`, `restrictionPlanner.ts`,
 * `corridorField.ts`, `delayLedger.ts`, `keyTerrain.ts`). Four things were
 * being redone from scratch on EVERY pass even though the underlying grid
 * never changes between them:
 *
 *  1. `hexNeighbors()` allocated a fresh 6-element array of `{q,r}` objects on
 *     every node pop, in every pass.
 *  2. Cell lookup went through `Map<string, ...>` keyed by `"q,r"` template
 *     strings — string construction + hashing in the search's inner loop.
 *  3. `toMobilitySample()` allocated a new object per cell, TWICE per edge
 *     relaxation — the underlying cell data never changes between passes.
 *  4. `calculateDistance` (haversine) was recomputed from scratch for the same
 *     ~6N edges on every one of the ~120 passes.
 *
 * This module computes all four ONCE per grid (`buildCellIndex`, cached by
 * `cells` array identity in `getCellIndex`) and hands the SEARCH CORE flat,
 * integer-indexed `TypedArray` data instead — every one of the callers named
 * above passes the SAME `cells` reference across its repeated calls INTO
 * `runAccumulatedCostSearch`/`runCostToGoSearch`, so the cache turns
 * "rebuilt every search pass" into "built once, read many times" for THOSE
 * two functions specifically. It does NOT (yet) generalise to those callers'
 * OWN separate hot loops outside the search itself — `corridorField.ts`'s
 * trafficability pass, `minCutBarrier.ts`'s graph build, and
 * `movementSimulation.ts`'s own step-scoring loop each still build their own
 * `byKey`/`hexNeighbors`/`toMobilitySample` calls directly, a real
 * follow-up opportunity, not something this module already covers.
 *
 * PURE MECHANICAL SPEEDUP, NOT AN APPROXIMATION: every value here is the exact
 * same value the previous per-pass code computed — same `hexKey`/`NEIGHBOR_DIRS`
 * lookups, same `calculateDistance` haversine call, same `toMobilitySample`
 * projection. Nothing is estimated differently; this only avoids recomputing
 * grid-invariant values on every pass. See `accumulatedCost.ts`'s own header
 * note on the one place this required a documented (and verified) argument to
 * stay bit-identical: `neighborDistM` is stored once per DIRECTED (cell,
 * direction) pair, computed in the `from → to` argument order
 * `runAccumulatedCostSearch` (the forward field) uses; `runCostToGoSearch`
 * (the reversed field) needs the same edge's distance in `to → from` order.
 * Haversine distance is symmetric, and — because IEEE-754 multiplication is
 * exactly commutative and `Math.sin`/`Math.cos` in this runtime preserve exact
 * sign symmetry through the domain-reduction path `calculateDistance` takes —
 * `calculateDistance(a,b) === calculateDistance(b,a)` bit-for-bit, not just
 * mathematically (verified empirically: 100,000 random coordinate pairs at
 * both hex-grid scale and larger, zero mismatches under `Object.is`). Reusing
 * one precomputed value for both directions is therefore lossless, not an
 * approximation — see `searchCoreEquivalence.test.ts` for the trace-level
 * proof against the original per-pass implementation.
 *
 * INVARIANT — stale-index hazard: the cache below keys on `cells` ARRAY
 * IDENTITY, not content, and `samples`/`crossSlopeDeg` are COPIED off the
 * cell objects at build time. Any code that mutates a cell IN PLACE after
 * the array has been indexed (e.g. `mobilityGrid.ts`'s `applyCrossSlope`,
 * which writes `cell.crossSlopeDeg` post-hoc) must call
 * `invalidateCellIndex(cells)` once it is done mutating, or every search
 * that follows will silently read pre-mutation values out of the cached
 * index. Today this is only safe because of caller ORDERING (the mutation
 * happens before the first search over that array) — do not add a new
 * in-place mutator without also calling `invalidateCellIndex`.
 */

import type { MobilityGridCell } from './accumulatedCost';
import { calculateDistance } from './geo';
import { AxialCoord, NEIGHBOR_DIRS, hexKey } from './hexGrid';
import { MobilitySample } from './mobilityCost';

/**
 * Project a grid cell down to the `MobilitySample` shape `edgeMobilityCost`
 * consumes — moved here (from `accumulatedCost.ts`, still re-exported from
 * there for every existing import path) so `buildCellIndex` can call it
 * without a circular module dependency. ONE place that lists every field the
 * cost function reads off a cell, so a field added to either interface can't
 * silently go stale at one call site while every other caller picks it up.
 * Every module that builds an edge's `from`/`to` sample (this file,
 * `accumulatedCost.ts`, `corridorField.ts`, `minCutBarrier.ts`,
 * `movementSimulation.ts`) should call this rather than hand-writing the
 * object literal.
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

export interface CellIndex {
  /** String key ("q,r") -> integer index. Boundary conversion only — never
   *  read in a search's inner loop. */
  keyToIndex: Map<string, number>;
  /** Integer index -> string key ("q,r"). Boundary conversion (building the
   *  output `Map`s, and the rare `edgePenalties`/`blockedEdges` string-keyed
   *  lookups) only. */
  indexToKey: string[];
  /** Neighbour cell index per (cell, direction), flattened `[i*6+d]`, in
   *  EXACTLY `NEIGHBOR_DIRS` order. `-1` where that direction has no sampled
   *  neighbour. */
  neighbors: Int32Array;
  /** Haversine distance (m) for the directed edge `i -> neighbors[i*6+d]`,
   *  computed once. See the module header for why this single value is also
   *  correct for the reversed-order search. */
  neighborDistM: Float64Array;
  /** `toMobilitySample(cells[i])`, computed once — the cell data it derives
   *  from never changes between passes over the same grid. */
  samples: MobilitySample[];
  /** `cells[i].crossSlopeDeg`, flattened for the same reason as `samples`. */
  crossSlopeDeg: Float64Array;
}

/** Build a `CellIndex` from a grid's cell array. Pure, no caching — see
 *  `getCellIndex` for the memoised entry point every search actually calls. */
export function buildCellIndex(cells: MobilityGridCell[]): CellIndex {
  const n = cells.length;
  const keyToIndex = new Map<string, number>();
  const indexToKey: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    keyToIndex.set(cells[i].key, i);
    indexToKey[i] = cells[i].key;
  }

  const neighbors = new Int32Array(n * 6).fill(-1);
  const neighborDistM = new Float64Array(n * 6);
  const samples: MobilitySample[] = new Array(n);
  const crossSlopeDeg = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    samples[i] = toMobilitySample(cell);
    crossSlopeDeg[i] = cell.crossSlopeDeg;
    for (let d = 0; d < 6; d++) {
      const dir = NEIGHBOR_DIRS[d];
      const nHex: AxialCoord = { q: cell.hex.q + dir.q, r: cell.hex.r + dir.r };
      const nIdx = keyToIndex.get(hexKey(nHex));
      if (nIdx === undefined) continue; // stays -1 / 0, matching "no such neighbour in this grid"
      const slot = i * 6 + d;
      neighbors[slot] = nIdx;
      neighborDistM[slot] = calculateDistance(cell.center.lat, cell.center.lng, cells[nIdx].center.lat, cells[nIdx].center.lng);
    }
  }

  return { keyToIndex, indexToKey, neighbors, neighborDistM, samples, crossSlopeDeg };
}

/**
 * Memoised `buildCellIndex`, keyed by `cells` ARRAY IDENTITY (not content —
 * a `WeakMap` so a superseded grid's index is garbage-collected once nothing
 * else references the array). Every real caller (`mobilityWorker.ts`'s
 * 'search'/'movement'/'keyTerrain' handlers, `restrictionPlanner.ts`,
 * `delayLedger.ts`, `corridorField.ts`, `corridorAnalysis.ts`) builds its
 * `cells` array once per grid and passes that SAME reference into every one
 * of its ~120 search calls, so this turns "rebuild the index every pass" into
 * "build it once, reuse it ~120 times" for free, with no change to any
 * caller's signature. A caller that genuinely rebuilds `cells` between calls
 * (a fresh array each time) simply gets a fresh index each time too — never
 * WRONG, just not sped up, exactly like the original per-call `byKey` build
 * it replaces.
 */
const cellIndexCache = new WeakMap<MobilityGridCell[], CellIndex>();

export function getCellIndex(cells: MobilityGridCell[]): CellIndex {
  let idx = cellIndexCache.get(cells);
  if (!idx) {
    idx = buildCellIndex(cells);
    cellIndexCache.set(cells, idx);
  }
  return idx;
}

/**
 * Evict a cached `CellIndex` for this exact `cells` array reference. Call
 * this immediately after any in-place mutation of cells already indexed
 * (see the module header's INVARIANT note) — e.g. `mobilityGrid.ts`'s
 * `applyCrossSlope`, which writes `cell.crossSlopeDeg` after the array may
 * already have been indexed by an earlier search. A no-op when nothing was
 * cached for this array (the common case: index built fresh AFTER the
 * mutation, as every current caller happens to order it). The next
 * `getCellIndex(cells)` call simply rebuilds from the now-current cell data.
 */
export function invalidateCellIndex(cells: MobilityGridCell[]): void {
  cellIndexCache.delete(cells);
}
