/**
 * Corridor analysis — Pass 2 (docs/ROUTE_INTELLIGENCE.md §3, §4, §15.2).
 *
 * Two outputs, both built on the SAME multi-source search Pass 1 already
 * ships, never a second/different algorithm:
 *
 *  - k-dissimilar routes: blocking the single best route just pushes traffic
 *    onto the second-best. Get a ranked set of genuinely distinct routes by
 *    iterative penalty — take the best path, penalise its edges, re-run,
 *    repeat. This is the input the chokepoint ranking below needs.
 *  - betweenness chokepoints: for each cell, how many of the top-N routes
 *    pass through it. Cheap once the route set exists, and it's the ground
 *    that "everything funnels through" — the natural siting hint for a
 *    counter-mobility measure, ahead of the more rigorous min-cut in
 *    minCutBarrier.ts.
 */

import { LatLng } from '../utils/chainage';
import {
  MobilityGridCell, runAccumulatedCostSearch, extractPath, AccumulatedCostSearchOptions,
} from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { SimPathNode } from './mobilityWorker';
import { LocalProjection, axialToLocal, hexCorners, toLatLng } from '../utils/hexGrid';

export interface DissimilarRoute {
  keys: string[];
  path: SimPathNode[];
  totalSeconds: number;
}

/** Multiplier applied to an already-used edge's cost on the next search —
 *  high enough that the search genuinely prefers new ground, not just a
 *  cosmetic wiggle around the same line. */
const PENALTY_MULTIPLIER = 6;

/**
 * Up to `k` distinct origin→objective routes via iterative-penalty re-search.
 * Each iteration's route's edges are penalised (accumulating multiplicatively
 * across iterations, so a corridor used by two prior routes is even less
 * attractive to a third) before the next search — the search itself is
 * unchanged, only the edge costs it sees differ.
 */
export function findKDissimilarPaths(
  cells: MobilityGridCell[],
  originKeys: string[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  k = 3
): DissimilarRoute[] {
  const byKey = new Map(cells.map(c => [c.key, c]));
  const edgePenalties = new Map<string, number>();
  const routes: DissimilarRoute[] = [];

  for (let i = 0; i < k; i++) {
    const options: AccumulatedCostSearchOptions = { edgePenalties };
    const reach = runAccumulatedCostSearch(cells, originKeys, profile, nightMode, options);
    const keys = extractPath(reach, objectiveKeys);
    if (!keys) break; // no route found even before further iterations would find one

    // Duplicate-route guard: if this iteration's penalties failed to change
    // the outcome (e.g. a single-track corridor with no alternative), stop
    // rather than report the same route twice under a different rank.
    if (routes.some(r => r.keys.length === keys.length && r.keys.every((key, idx) => key === keys[idx]))) break;

    const totalSeconds = reach.best.get(keys[keys.length - 1])?.timeSeconds ?? 0;
    const path: SimPathNode[] = keys.map(key => {
      const cell = byKey.get(key)!;
      const arrival = reach.best.get(key);
      return { lat: cell.center.lat, lng: cell.center.lng, cumulativeSeconds: arrival ? arrival.timeSeconds : 0 };
    });
    routes.push({ keys, path, totalSeconds });

    for (let j = 1; j < keys.length; j++) {
      const forwardKey = `${keys[j - 1]}|${keys[j]}`;
      const backwardKey = `${keys[j]}|${keys[j - 1]}`;
      edgePenalties.set(forwardKey, (edgePenalties.get(forwardKey) ?? 1) * PENALTY_MULTIPLIER);
      edgePenalties.set(backwardKey, (edgePenalties.get(backwardKey) ?? 1) * PENALTY_MULTIPLIER);
    }
  }

  return routes;
}

export interface ChokepointCell {
  key: string;
  center: LatLng;
  polygon: LatLng[];
  /** How many of the supplied routes pass through this cell. */
  passCount: number;
}

/**
 * Betweenness over a route set: for each cell that appears in at least one
 * route, how many routes cross it. Callers typically keep only the
 * highest-count cells as chokepoint markers.
 */
export function computeChokepoints(
  cells: MobilityGridCell[],
  hexSize: number,
  proj: LocalProjection,
  routes: DissimilarRoute[]
): ChokepointCell[] {
  const byKey = new Map(cells.map(c => [c.key, c]));
  const counts = new Map<string, number>();
  for (const route of routes) {
    const uniqueInRoute = new Set(route.keys);
    for (const key of uniqueInRoute) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: ChokepointCell[] = [];
  for (const [key, passCount] of counts) {
    const cell = byKey.get(key);
    if (!cell) continue;
    const local = axialToLocal(cell.hex, hexSize);
    const polygon = hexCorners(local, hexSize).map(p => toLatLng(proj, p));
    polygon.push(polygon[0]);
    out.push({ key, center: cell.center, polygon, passCount });
  }
  return out.sort((a, b) => b.passCount - a.passCount);
}
