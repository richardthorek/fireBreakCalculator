/**
 * Web Worker: runs the CPU-bound parts of Terrain Mobility off the main
 * thread. docs/ROUTE_INTELLIGENCE.md §8 flags that an AOI-wide exhaustive
 * search flips the earlier (correct, for the corridor case) decision to skip
 * a worker — there, network I/O was the whole cost and Dijkstra over ≤1500
 * nodes was milliseconds; here the search runs to exhaustion with no target,
 * over a grid sized for a whole area of interest, so CPU is the part worth
 * moving off the UI thread. Sampling (network calls) still happens on the
 * main thread, using the same caches as the fire-break optimizer — only the
 * already-sampled, serialisable cell array crosses into the worker.
 *
 * Two request kinds, discriminated on `kind` (absent = 'search', so any older
 * caller shape keeps working):
 *
 *  - 'search'   — the multi-source accumulated-cost field, plus the single
 *                 cheapest origin→objective path backtracked from the SAME
 *                 search (`extractPath`), so the deterministic route is
 *                 exactly the one the isochrone field itself computed.
 *  - 'movement' — the probabilistic movement ensemble (movementSimulation.ts)
 *                 AND, on the same already-costed grid, the recommended
 *                 restriction set derived from it (restrictionPlanner.ts).
 *                 Kept as ONE request on purpose: the planner re-runs the
 *                 ensemble many times over the identical grid, and doing that
 *                 behind a single call lets one edge-cost cache serve every
 *                 run instead of shipping cells across the boundary per
 *                 evaluation. Emits progress messages throughout, so the UI
 *                 can show the field building rather than freezing.
 */

import { runAccumulatedCostSearch, assembleMobilityResults, extractPath, MobilityGridCell } from './accumulatedCost';
import { LocalProjection } from '../utils/hexGrid';
import { getMoverProfile } from './moverProfiles';
import { simulateMovementEnsemble, MovementEnsembleResult } from './movementSimulation';
import { planRestrictions, RestrictionPlan } from './restrictionPlanner';
import { setRoadSpeedOverrides, RoadSpeedOverrides } from './roadSpeedModel';

export interface SimPathNode {
  lat: number;
  lng: number;
  cumulativeSeconds: number;
}

export interface MobilitySearchRequest {
  kind?: 'search';
  requestId: number;
  cells: MobilityGridCell[];
  hexSize: number;
  proj: LocalProjection;
  originKeys: string[];
  objectiveKeys: string[];
  profileId: string;
  nightMode: boolean;
  /** User-edited road-class speeds (docs §35 config UI) — set into THIS
   *  worker's own module instance of roadSpeedModel.ts on every request (see
   *  that module's own doc comment on why: a Worker shares no memory with
   *  the main thread that set it). Undefined/absent means "no overrides". */
  roadSpeedOverrides?: RoadSpeedOverrides;
}

export interface MobilityMovementRequest {
  kind: 'movement';
  requestId: number;
  cells: MobilityGridCell[];
  hexSize: number;
  proj: LocalProjection;
  originKeys: string[];
  objectiveKeys: string[];
  profileId: string;
  nightMode: boolean;
  moverCount: number;
  spreadId: string;
  seed: number;
  /** Also derive the recommended restriction set from the baseline ensemble
   *  and re-run it with those restrictions emplaced. */
  planRestrictions: boolean;
  maxRestrictions?: number;
  /** Same as `MobilitySearchRequest.roadSpeedOverrides` — see that field's
   *  doc comment. */
  roadSpeedOverrides?: RoadSpeedOverrides;
}

export type MobilityWorkerRequest = MobilitySearchRequest | MobilityMovementRequest;

export interface MobilitySearchResponse {
  kind: 'search';
  requestId: number;
  results: ReturnType<typeof assembleMobilityResults>;
  path: SimPathNode[] | null;
}

export interface MobilityMovementResponse {
  kind: 'movement';
  requestId: number;
  ensemble: MovementEnsembleResult | null;
  plan: RestrictionPlan | null;
}

export interface MobilityProgressResponse {
  kind: 'progress';
  requestId: number;
  fraction: number;
  /** Which sub-phase the fraction belongs to, so the UI can label it.
   *  'search' — the multi-source Dijkstra field build (§35 addendum,
   *  2026-07-27: this search previously reported nothing while it ran,
   *  a real dead zone in the progress bar). */
  phase: 'search' | 'ensemble' | 'restrictions' | 'rerun';
  /** Log lines the planner produced, forwarded so the assessment log shows
   *  real intermediate findings during a long run rather than nothing. */
  log?: string;
}

export type MobilityWorkerResponse =
  | MobilitySearchResponse
  | MobilityMovementResponse
  | MobilityProgressResponse;

const post = (message: MobilityWorkerResponse) => (self as unknown as Worker).postMessage(message);

self.onmessage = (e: MessageEvent<MobilityWorkerRequest>) => {
  const req = e.data;
  // Set once per request, before any cost-model call this request will make
  // — see roadSpeedModel.ts's own doc comment on why this can't just be set
  // once from the main thread (the worker has no shared memory with it).
  setRoadSpeedOverrides(req.roadSpeedOverrides ?? null);
  const profile = getMoverProfile(req.profileId);

  if (req.kind === 'movement') {
    if (!profile) {
      post({ kind: 'movement', requestId: req.requestId, ensemble: null, plan: null });
      return;
    }
    // Progress is throttled to whole percent — an unthrottled postMessage per
    // mover would cost more in structured-clone overhead than the simulation.
    let lastPercent = -1;
    const throttledProgress = (phase: 'ensemble' | 'restrictions' | 'rerun') => (f: number) => {
      const percent = Math.floor(f * 100);
      if (percent === lastPercent) return;
      lastPercent = percent;
      post({ kind: 'progress', requestId: req.requestId, fraction: f, phase });
    };

    const ensemble = simulateMovementEnsemble(
      req.cells, req.originKeys, req.objectiveKeys, profile, req.nightMode, req.hexSize, req.proj,
      {
        moverCount: req.moverCount,
        spreadId: req.spreadId,
        seed: req.seed,
        onProgress: throttledProgress('ensemble'),
      }
    );

    let plan: RestrictionPlan | null = null;
    if (ensemble && req.planRestrictions) {
      lastPercent = -1;
      plan = planRestrictions(
        req.cells, req.originKeys, req.objectiveKeys, profile, req.nightMode, req.hexSize, req.proj, ensemble,
        {
          moverCount: req.moverCount,
          spreadId: req.spreadId,
          seed: req.seed,
          maxRestrictions: req.maxRestrictions,
          onProgress: throttledProgress('restrictions'),
          onLog: line => post({ kind: 'progress', requestId: req.requestId, fraction: 1, phase: 'restrictions', log: line }),
        }
      );
    }

    post({ kind: 'movement', requestId: req.requestId, ensemble, plan });
    return;
  }

  if (!profile) {
    post({ kind: 'search', requestId: req.requestId, results: [], path: null });
    return;
  }
  // Throttled to whole-percent steps, same discipline as the movement
  // ensemble's progress below — a large fine-fidelity grid settles many
  // thousands of cells, and an unthrottled postMessage per cell would cost
  // more in structured-clone overhead than the search itself.
  let lastSearchPercent = -1;
  const reach = runAccumulatedCostSearch(req.cells, req.originKeys, profile, req.nightMode, {
    onProgress: f => {
      const percent = Math.floor(f * 100);
      if (percent === lastSearchPercent) return;
      lastSearchPercent = percent;
      post({ kind: 'progress', requestId: req.requestId, fraction: f, phase: 'search' });
    },
  });
  const results = assembleMobilityResults(req.cells, req.hexSize, req.proj, reach.best, profile);

  const pathKeys = extractPath(reach, req.objectiveKeys);
  let path: SimPathNode[] | null = null;
  if (pathKeys) {
    const byKey = new Map(req.cells.map(c => [c.key, c]));
    path = pathKeys.map(key => {
      const cell = byKey.get(key)!;
      const arrival = reach.best.get(key);
      return { lat: cell.center.lat, lng: cell.center.lng, cumulativeSeconds: arrival ? arrival.timeSeconds : 0 };
    });
  }

  post({ kind: 'search', requestId: req.requestId, results, path });
};
