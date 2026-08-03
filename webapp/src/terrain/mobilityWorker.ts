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
 * Four request kinds, discriminated on `kind` (absent = 'search', so any
 * older caller shape keeps working):
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
 *  - 'keyTerrain' — key terrain candidate scoring (OCOKA 4,
 *                 docs/ROUTE_INTELLIGENCE.md §47.1, keyTerrain.ts). Candidate
 *                 GENERATION (`generateKeyTerrainCandidates`) is cheap — no
 *                 search runs — and stays on the main thread per that
 *                 module's own header comment; only the SCORING
 *                 (`scoreKeyTerrainCandidates`, up to
 *                 `MAX_CANDIDATES_EVALUATED × EVALUATION_ROUTE_COUNT` full
 *                 route searches) comes here, for the exact same reason
 *                 'movement' does: CPU-bound, no network I/O, and running it
 *                 on the main thread reproduces the step-41 page-hang
 *                 regression (see keyTerrain.ts's own header). No progress
 *                 reporting for this kind — `scoreKeyTerrainCandidates` has
 *                 no internal progress hook, so this just posts the final
 *                 result once done.
 *  - 'viewshed' — real per-observer line-of-sight tracing (OCOKA 6,
 *                 docs/ROUTE_INTELLIGENCE.md §47/§8, viewshed.ts). Same
 *                 CPU-bound, no-network-I/O shape as 'movement' and
 *                 'keyTerrain' above — see viewshed.ts's own header comment
 *                 (running this on the main thread reproduces the same
 *                 step-41 page-hang regression). Unlike 'keyTerrain' there is
 *                 no separate cheap "candidate generation" phase kept on the
 *                 main thread first: painting an observer is just recording a
 *                 hex key, so the whole computation — one full trace per
 *                 painted observer — happens here. No progress reporting,
 *                 same simplicity call 'keyTerrain' already made. Carries no
 *                 `profileId` / `roadSpeedOverrides` / `proj` — viewshed is
 *                 pure line-of-sight geometry over the sampled grid, with no
 *                 cost/traversal model (`computeViewshedForObserver` never
 *                 takes a `LocalProjection`, and there is nothing here for a
 *                 road-speed override to apply to).
 */

import {
  runAccumulatedCostSearch, assembleMobilityResults, extractPath, MobilityGridCell, AccumulatedCostSearchResult,
} from './accumulatedCost';
import { LocalProjection } from '../utils/hexGrid';
import { getMoverProfile } from './moverProfiles';
import { simulateMovementEnsemble, MovementEnsembleResult } from './movementSimulation';
import { planRestrictions, RestrictionPlan } from './restrictionPlanner';
import { setRoadSpeedOverrides, RoadSpeedOverrides } from './roadSpeedModel';
import { RoadGraph } from './roadGraph';
import { CorridorField } from './corridorField';
import { scoreKeyTerrainCandidates, buildKeyTerrainResult, KeyTerrainCandidate, KeyTerrainResult } from './keyTerrain';
import { computeViewshedForObserver, ObserverViewshed, ViewshedOptions } from './viewshed';

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
  /** Resume a previous search rather than reseeding fresh from `originKeys`
   *  — the lazy tile-ring growth loop (docs §35, `mobilityLazyGrid.ts`):
   *  `cells` on THIS request is the cumulative set after materialising one
   *  more ring of tiles, and this is the `reach` a PRIOR 'search' response
   *  already returned for the smaller set. See
   *  `accumulatedCost.ts#AccumulatedCostSearchOptions.resumeFrom` for why
   *  this is correct (Dijkstra with non-negative edges never needs to revise
   *  a settled distance) rather than just a shortcut. `Map`s structured-clone
   *  natively across the worker boundary, same as `RoadGraph`'s own fields. */
  resumeFrom?: AccumulatedCostSearchResult;
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
  /** Hex keys of the box-free road-graph route, when one was found for this
   *  run (vehicle profiles only) — see `movementSimulation.ts`'s
   *  `preferredRouteKeys` option. Forwarded to both the baseline ensemble and
   *  every restriction-planner re-run below. */
  preferredRouteKeys?: string[];
  /** The road graph itself (docs §42b), for the baseline ensemble's mixed-mode
   *  movement (`movementSimulation.ts`'s `roadMix` machinery) — vehicle
   *  profiles only, when road data was fetched. Deliberately NOT forwarded to
   *  `planRestrictions` below — see `RoadMixState`'s own doc comment for why
   *  mixed-mode is unrestricted-baseline-only. `RoadGraph`'s `nodes`/
   *  `adjacency` are plain `Map`s, which structured-clone natively across the
   *  worker boundary same as every other Map-shaped payload this app already
   *  sends it. */
  roadGraph?: RoadGraph;
}

export interface MobilityKeyTerrainRequest {
  kind: 'keyTerrain';
  requestId: number;
  cells: MobilityGridCell[];
  originKeys: string[];
  objectiveKeys: string[];
  profileId: string;
  nightMode: boolean;
  hexSize: number;
  proj: LocalProjection;
  /** The optimiser (k-cheapest-routes) field this run already computed —
   *  every candidate is scored against IT regardless of which field heads
   *  the UI, per keyTerrain.ts's own header comment ("SCORED AGAINST THE
   *  OPTIMISER FIELD, DELIBERATELY"). */
  baselineField: CorridorField;
  /** Nominated on the main thread by `generateKeyTerrainCandidates` — cheap,
   *  no search runs — and forwarded here unchanged for scoring. */
  candidates: KeyTerrainCandidate[];
  /** Same as `MobilitySearchRequest.roadSpeedOverrides` — see that field's
   *  doc comment. */
  roadSpeedOverrides?: RoadSpeedOverrides;
}

export interface MobilityViewshedRequest {
  kind: 'viewshed';
  requestId: number;
  cells: MobilityGridCell[];
  hexSize: number;
  /** Painted observer cell keys — one trace per key. A key not present in
   *  `cells` resolves to nothing for that observer (see
   *  `MobilityViewshedResponse.observers`'s own doc comment); it is not an
   *  error, since `computeViewshedForObserver` itself treats an unknown key
   *  as a null result rather than throwing. */
  observerKeys: string[];
  /** Same defaulting as `computeViewshedForObserver` itself — absent means
   *  the module's own documented defaults (eye/target height, max range). */
  options?: ViewshedOptions;
}

export type MobilityWorkerRequest =
  | MobilitySearchRequest
  | MobilityMovementRequest
  | MobilityKeyTerrainRequest
  | MobilityViewshedRequest;

export interface MobilitySearchResponse {
  kind: 'search';
  requestId: number;
  results: ReturnType<typeof assembleMobilityResults>;
  path: SimPathNode[] | null;
  /** The full accumulated search state (`best`/`prev`) — returned so the
   *  caller can hand it straight back in as `resumeFrom` on the NEXT request
   *  once it materialises another tile ring, continuing this exact search
   *  rather than restarting it (docs §35, `mobilityLazyGrid.ts`). Callers
   *  that don't need it (every existing 'search' call site, which is
   *  decisive in one shot) simply ignore the field. */
  reach: AccumulatedCostSearchResult;
}

export interface MobilityMovementResponse {
  kind: 'movement';
  requestId: number;
  ensemble: MovementEnsembleResult | null;
  plan: RestrictionPlan | null;
}

export interface MobilityKeyTerrainResponse {
  kind: 'keyTerrain';
  requestId: number;
  /** Null when the profile didn't resolve — same null-safety pattern as the
   *  'movement'/'search' handlers above, not a signal about the candidates
   *  themselves. */
  result: KeyTerrainResult | null;
}

export interface MobilityViewshedResponse {
  kind: 'viewshed';
  requestId: number;
  /** One entry per `observerKeys` entry that resolved to a real cell in
   *  `cells` — an unresolved key is silently dropped, not padded with a
   *  null placeholder, matching `computeViewshedForObserver`'s own
   *  null-on-unknown-key behaviour (there is no per-observer error to carry,
   *  just a shorter list than requested). */
  observers: ObserverViewshed[];
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
  | MobilityKeyTerrainResponse
  | MobilityViewshedResponse
  | MobilityProgressResponse;

const post = (message: MobilityWorkerResponse) => (self as unknown as Worker).postMessage(message);

self.onmessage = (e: MessageEvent<MobilityWorkerRequest>) => {
  const req = e.data;

  // Handled before the shared `roadSpeedOverrides`/`profileId` lines below
  // rather than alongside 'movement'/'keyTerrain' further down: viewshed
  // deliberately carries neither field (module header above; it has no
  // cost/traversal model at all), so `MobilityViewshedRequest` doesn't
  // declare them, and TS won't let a union-typed `req` read a property that
  // one constituent lacks entirely — narrowing it away here first, with an
  // early return, is what makes the two lines just below type-check
  // unchanged for the remaining (all-profiled) request kinds.
  if (req.kind === 'viewshed') {
    const observers: ObserverViewshed[] = [];
    for (const key of req.observerKeys) {
      const observer = computeViewshedForObserver(key, req.cells, req.hexSize, req.options ?? {});
      if (observer) observers.push(observer);
    }
    post({ kind: 'viewshed', requestId: req.requestId, observers });
    return;
  }

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
        preferredRouteKeys: req.preferredRouteKeys,
        roadGraph: req.roadGraph,
        roadSpeedOverrides: req.roadSpeedOverrides,
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
          preferredRouteKeys: req.preferredRouteKeys,
        }
      );
    }

    post({ kind: 'movement', requestId: req.requestId, ensemble, plan });
    return;
  }

  if (req.kind === 'keyTerrain') {
    if (!profile) {
      post({ kind: 'keyTerrain', requestId: req.requestId, result: null });
      return;
    }
    const scored = scoreKeyTerrainCandidates(
      req.cells, req.originKeys, req.objectiveKeys, profile, req.nightMode, req.hexSize, req.proj,
      req.baselineField, req.candidates
    );
    const result = buildKeyTerrainResult(req.candidates, scored);
    post({ kind: 'keyTerrain', requestId: req.requestId, result });
    return;
  }

  if (!profile) {
    post({
      kind: 'search', requestId: req.requestId, results: [], path: null,
      reach: { best: new Map(), prev: new Map() },
    });
    return;
  }
  // Throttled to whole-percent steps, same discipline as the movement
  // ensemble's progress below — a large fine-fidelity grid settles many
  // thousands of cells, and an unthrottled postMessage per cell would cost
  // more in structured-clone overhead than the search itself.
  let lastSearchPercent = -1;
  const reach = runAccumulatedCostSearch(req.cells, req.originKeys, profile, req.nightMode, {
    resumeFrom: req.resumeFrom,
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

  post({ kind: 'search', requestId: req.requestId, results, path, reach });
};
