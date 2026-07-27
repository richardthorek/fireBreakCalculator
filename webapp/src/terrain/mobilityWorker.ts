/**
 * Web Worker: runs the multi-source accumulated-cost search off the main
 * thread. docs/ROUTE_INTELLIGENCE.md §8 flags that an AOI-wide exhaustive
 * search flips the earlier (correct, for the corridor case) decision to skip
 * a worker — there, network I/O was the whole cost and Dijkstra over ≤1500
 * nodes was milliseconds; here the search runs to exhaustion with no target,
 * over a grid sized for a whole area of interest, so CPU is the part worth
 * moving off the UI thread. Sampling (network calls) still happens on the
 * main thread, using the same caches as the fire-break optimizer — only the
 * already-sampled, serialisable cell array crosses into the worker.
 *
 * Also backtracks the single cheapest origin→objective path from the SAME
 * search (`extractPath`) — this is what the unit-simulation "moving icon"
 * animation follows, so the animated path is exactly the one the isochrone
 * field itself computed, not a second/different search.
 */

import { runAccumulatedCostSearch, assembleMobilityResults, extractPath, MobilityGridCell } from './accumulatedCost';
import { LocalProjection } from '../utils/hexGrid';
import { getMoverProfile } from './moverProfiles';

export interface SimPathNode {
  lat: number;
  lng: number;
  cumulativeSeconds: number;
}

export interface MobilityWorkerRequest {
  requestId: number;
  cells: MobilityGridCell[];
  hexSize: number;
  proj: LocalProjection;
  originKeys: string[];
  objectiveKeys: string[];
  profileId: string;
  nightMode: boolean;
}

export interface MobilityWorkerResponse {
  requestId: number;
  results: ReturnType<typeof assembleMobilityResults>;
  path: SimPathNode[] | null;
}

self.onmessage = (e: MessageEvent<MobilityWorkerRequest>) => {
  const { requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode } = e.data;
  const profile = getMoverProfile(profileId);
  if (!profile) {
    (self as unknown as Worker).postMessage({ requestId, results: [], path: null } satisfies MobilityWorkerResponse);
    return;
  }
  const reach = runAccumulatedCostSearch(cells, originKeys, profile, nightMode);
  const results = assembleMobilityResults(cells, hexSize, proj, reach.best, profile);

  const pathKeys = extractPath(reach, objectiveKeys);
  let path: SimPathNode[] | null = null;
  if (pathKeys) {
    const byKey = new Map(cells.map(c => [c.key, c]));
    path = pathKeys.map(key => {
      const cell = byKey.get(key)!;
      const arrival = reach.best.get(key);
      return { lat: cell.center.lat, lng: cell.center.lng, cumulativeSeconds: arrival ? arrival.timeSeconds : 0 };
    });
  }

  (self as unknown as Worker).postMessage({ requestId, results, path } satisfies MobilityWorkerResponse);
};
