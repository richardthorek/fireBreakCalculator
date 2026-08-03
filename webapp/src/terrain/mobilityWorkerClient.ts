/**
 * Main-thread client for mobilityWorker.ts. Spawns one worker lazily, reused
 * across runs (module-level singleton — mirrors the pattern of the module-
 * level caches elsewhere in this codebase), and exposes a Promise-based API
 * so callers don't deal with postMessage/onmessage correlation directly.
 *
 * Progress messages are routed to a per-request callback rather than resolving
 * the promise, so a long run (the movement ensemble) can drive a progress bar
 * without the caller subscribing to the worker itself.
 */

import {
  AccumulatedCostSearchResult, MobilityCellResult, MobilityGridCell, LocalProjection, MovementEnsembleResult,
  RestrictionPlan, RoadSpeedOverrides, RoadGraph, CorridorField, KeyTerrainCandidate, KeyTerrainResult,
  ObserverViewshed, ViewshedOptions,
} from '@firebreak/terrain';
import {
  MobilityWorkerRequest, MobilityWorkerResponse, SimPathNode,
} from './mobilityWorker';

let worker: Worker | null = null;
let nextRequestId = 1;

interface PendingEntry {
  resolve: (response: MobilityWorkerResponse) => void;
  onProgress?: (fraction: number, phase: 'search' | 'ensemble' | 'restrictions' | 'rerun', log?: string) => void;
}
const pending = new Map<number, PendingEntry>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./mobilityWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<MobilityWorkerResponse>) => {
    const entry = pending.get(e.data.requestId);
    if (!entry) return;
    if (e.data.kind === 'progress') {
      entry.onProgress?.(e.data.fraction, e.data.phase, e.data.log);
      return;
    }
    pending.delete(e.data.requestId);
    entry.resolve(e.data);
  };
  return worker;
}

export interface MobilitySearchOutcome {
  results: MobilityCellResult[];
  path: SimPathNode[] | null;
  /** The full accumulated search state — pass straight back in as
   *  `resumeFrom` on the next call over a grown cell set to CONTINUE this
   *  search rather than restart it (docs §35, `mobilityLazyGrid.ts`). Every
   *  existing call site that only needs one decisive call simply ignores it. */
  reach: AccumulatedCostSearchResult;
}

export function runMobilitySearchInWorker(
  cells: MobilityGridCell[],
  hexSize: number,
  proj: LocalProjection,
  originKeys: string[],
  objectiveKeys: string[],
  profileId: string,
  nightMode: boolean,
  roadSpeedOverrides?: RoadSpeedOverrides,
  /** Real, incremental progress through the Dijkstra field build (§35
   *  addendum, 2026-07-27) — the fraction of the grid settled so far, NOT a
   *  placeholder. Previously this call reported nothing at all while it ran. */
  onProgress?: (fraction: number) => void,
  /** Resume a previous call's search rather than reseeding from
   *  `originKeys` — see `MobilitySearchOutcome.reach`'s doc comment. */
  resumeFrom?: AccumulatedCostSearchResult
): Promise<MobilitySearchOutcome> {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise(resolve => {
    pending.set(requestId, {
      resolve: response => {
        if (response.kind !== 'search') { resolve({ results: [], path: null, reach: { best: new Map(), prev: new Map() } }); return; }
        resolve({ results: response.results, path: response.path, reach: response.reach });
      },
      onProgress: (fraction, phase) => {
        if (phase === 'search') onProgress?.(fraction);
      },
    });
    const request: MobilityWorkerRequest = {
      kind: 'search', requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode,
      roadSpeedOverrides, resumeFrom,
    };
    w.postMessage(request);
  });
}

export interface MovementEnsembleRequestOptions {
  moverCount: number;
  spreadId: string;
  seed: number;
  /** Also derive and evaluate the recommended restriction set. */
  planRestrictions: boolean;
  maxRestrictions?: number;
  roadSpeedOverrides?: RoadSpeedOverrides;
  onProgress?: (fraction: number, phase: 'ensemble' | 'restrictions' | 'rerun') => void;
  onLog?: (line: string) => void;
  /** Hex keys of the box-free road-graph route, when one was found for this
   *  run — see `movementSimulation.ts`'s `preferredRouteKeys` option. */
  preferredRouteKeys?: string[];
  /** The road graph itself, for the baseline ensemble's mixed-mode movement
   *  (docs §42b) — see `MobilityMovementRequest.roadGraph`'s doc comment for
   *  why this is unrestricted-baseline-only by construction. */
  roadGraph?: RoadGraph;
}

export interface MovementEnsembleOutcome {
  ensemble: MovementEnsembleResult | null;
  plan: RestrictionPlan | null;
}

/** Run the probabilistic movement ensemble (movementSimulation.ts) — and,
 *  optionally, the restriction planner built on it — in the worker, over cells
 *  the caller has ALREADY sampled. This never resamples. */
export function runMovementEnsembleInWorker(
  cells: MobilityGridCell[],
  hexSize: number,
  proj: LocalProjection,
  originKeys: string[],
  objectiveKeys: string[],
  profileId: string,
  nightMode: boolean,
  options: MovementEnsembleRequestOptions
): Promise<MovementEnsembleOutcome> {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise(resolve => {
    pending.set(requestId, {
      resolve: response => resolve(
        response.kind === 'movement'
          ? { ensemble: response.ensemble, plan: response.plan }
          : { ensemble: null, plan: null }
      ),
      onProgress: (fraction, phase, log) => {
        if (log) options.onLog?.(log);
        // A 'movement' request's own worker branch never emits phase
        // 'search' (that's exclusive to 'search' requests) — this guard
        // exists purely so the shared `PendingEntry` type, which now also
        // carries 'search' for the OTHER request kind, still type-checks.
        else if (phase !== 'search') options.onProgress?.(fraction, phase);
      },
    });
    const request: MobilityWorkerRequest = {
      kind: 'movement', requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode,
      moverCount: options.moverCount, spreadId: options.spreadId, seed: options.seed,
      planRestrictions: options.planRestrictions, maxRestrictions: options.maxRestrictions,
      roadSpeedOverrides: options.roadSpeedOverrides,
      preferredRouteKeys: options.preferredRouteKeys,
      roadGraph: options.roadGraph,
    };
    w.postMessage(request);
  });
}

/** Score key terrain candidates (OCOKA 4, docs/ROUTE_INTELLIGENCE.md §47.1,
 *  keyTerrain.ts) in the worker — `scoreKeyTerrainCandidates` is up to
 *  `MAX_CANDIDATES_EVALUATED × EVALUATION_ROUTE_COUNT` full route searches,
 *  the same CPU-bound shape `runMovementEnsembleInWorker` above exists to
 *  keep off the main thread (see `keyTerrain.ts`'s own header and
 *  `mobilityWorker.ts`'s 'keyTerrain' branch). Candidate GENERATION
 *  (`generateKeyTerrainCandidates`) is cheap and stays on the main thread —
 *  callers pass its already-nominated `candidates` in here unchanged. */
export function runKeyTerrainScoringInWorker(
  cells: MobilityGridCell[],
  hexSize: number,
  proj: LocalProjection,
  originKeys: string[],
  objectiveKeys: string[],
  profileId: string,
  nightMode: boolean,
  baselineField: CorridorField,
  candidates: KeyTerrainCandidate[],
  roadSpeedOverrides?: RoadSpeedOverrides
): Promise<KeyTerrainResult | null> {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise(resolve => {
    pending.set(requestId, {
      resolve: response => resolve(response.kind === 'keyTerrain' ? response.result : null),
    });
    const request: MobilityWorkerRequest = {
      kind: 'keyTerrain', requestId, cells, hexSize, proj, originKeys, objectiveKeys, profileId, nightMode,
      baselineField, candidates, roadSpeedOverrides,
    };
    w.postMessage(request);
  });
}

/** Trace real per-observer line-of-sight (OCOKA 6, docs/ROUTE_INTELLIGENCE.md
 *  §47/§8, viewshed.ts) in the worker — `computeViewshedForObserver` runs a
 *  full front-to-back trace to every in-range cell for each painted observer,
 *  the same CPU-bound, no-network-I/O shape `runMovementEnsembleInWorker` and
 *  `runKeyTerrainScoringInWorker` above already exist to keep off the main
 *  thread (see viewshed.ts's own header: running this on the main thread
 *  reproduces the same step-41 page-hang regression). Unlike key terrain
 *  there is no separate cheap "candidate generation" step that stays on the
 *  main thread first — painting an observer is just recording the hex key
 *  the user clicked, nothing to generate beyond that, so this call IS the
 *  whole computation; `observerKeys` crosses into the worker as-is. Resolves
 *  to an empty array (not null) on a kind mismatch — this answer is
 *  inherently a list, one entry per observer that resolved to a real cell,
 *  so there is no singular "whole request failed" null the way
 *  `runKeyTerrainScoringInWorker`'s one-result call has; an empty list is
 *  the correct, only sensible empty case. */
export function runViewshedInWorker(
  cells: MobilityGridCell[],
  hexSize: number,
  observerKeys: string[],
  options?: ViewshedOptions
): Promise<ObserverViewshed[]> {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise(resolve => {
    pending.set(requestId, {
      resolve: response => resolve(response.kind === 'viewshed' ? response.observers : []),
    });
    const request: MobilityWorkerRequest = {
      kind: 'viewshed', requestId, cells, hexSize, observerKeys, options,
    };
    w.postMessage(request);
  });
}
