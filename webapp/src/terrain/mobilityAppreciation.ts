/**
 * Top-level orchestration for one "terrain appreciation" run. Emits real,
 * computed log lines as it goes — every line corresponds to an actual number
 * from this run, never decorative theatre (docs §13.2).
 *
 * THE SHAPE OF A RUN (owner, 2026-07-27: the movement simulation "should be
 * the crux of the recommendations and the ultimate pathways through"):
 *
 *   1. Sample the grid (elevation, vegetation, trails, cross-slope).
 *   2. Multi-source cost field + the single cheapest route. This is the
 *      OPTIMISER's answer — kept, because it is the right substrate for the
 *      chokepoint/min-cut analysis and because "the best case" is a useful
 *      figure to compare against. It is no longer the headline.
 *   3. UNRESTRICTED MOVEMENT — an ensemble of independent, road-preferring,
 *      imperfectly-informed movers (movementSimulation.ts). This is what the
 *      corridors are now built from: bands showing where movers ACTUALLY went,
 *      at their real observed frequency, rather than where the k cheapest
 *      routes ran.
 *   4. RECOMMENDED RESTRICTIONS — a short, ranked set of places to deny,
 *      each one chosen by re-running the ensemble against the world the
 *      previous ones created (restrictionPlanner.ts), plus the restricted
 *      movement picture that results.
 *   5. Chokepoints and the min-cut barrier, unchanged, over the optimiser's
 *      route set — the graph-theoretic complement to the simulated answer.
 *
 * The optimiser-derived corridor field is still computed and kept
 * (`optimiserCorridorField`) so the two views can be compared honestly, but
 * `corridorField` — the one every downstream consumer already reads: the map,
 * the panel, the GIS export, the AI narrative — is the simulated one whenever
 * the ensemble produced anything.
 */

import {
  carriesWaterSignal, LocalProjection, PaintedArea, MovementEnsembleResult, DEFAULT_BEHAVIOUR_SPREAD_ID,
  DEFAULT_MOVEMENT_SIM_SEED, RestrictionPlan, MobilityCellResult, IsochroneBand, buildIsochroneBands,
  DEFAULT_ISOCHRONE_MINUTES, MobilityGridCell, getMoverProfile, MoverProfile, setRoadSpeedOverrides,
  RoadSpeedOverrides, computeChokepoints, DissimilarRoute, ChokepointCell, MinCutResult,
  RoadMinCutResult, KeyTerrainResult, generateKeyTerrainCandidates, ObservationResult,
  buildObservationResult, ConcealmentResult, buildConcealmentResult, buildRoadGraph, nodesWithin, RoadGraph, RoadWay,
  WaterBodyPolygon, CorridorField, DEFAULT_CORRIDOR_ROUTE_COUNT, ensembleTracksToRoutes, TransitCell,
} from '@firebreak/terrain';
import { MobilityGridResult, MobilityFidelity, DEFAULT_MOBILITY_FIDELITY, minDetourPadM } from './mobilityGrid';
import { runLazyMobilitySearch } from './mobilityLazyGrid';
import { InfrastructureTrail } from '../utils/infrastructureService';
import {
  runMovementEnsembleInWorker, runKeyTerrainScoringInWorker, runViewshedInWorker, runCorridorFieldInWorker,
  runMinCutInWorker,
} from './mobilityWorkerClient';
import { yieldToMain } from './asyncUtils';
import {
  findVehicleRoadRoute, roadRouteToDissimilarRoute, RoadRouteSearchResult, ROAD_ACCESS_SNAP_M, areaCentroid,
  findEarlyVehicleRoadRoutePreview,
} from './roadRouteSearch';
import { SimPathNode } from './mobilityWorker';

/** Moved to `accumulatedCost.ts` (see its own doc comment on why — corridor
 *  risk scoring needed it without a circular import) — re-exported here so
 *  every existing caller (`mobilityGisExport.ts`, `mobilityAssistantApi.ts`)
 *  keeps working from the same import path. */
export { carriesWaterSignal };

/** Hard cap on painted observer hexes actually traced (OCOKA 6) — each is a
 *  full grid-wide viewshed (`viewshed.ts`'s own header: MUST run in the
 *  worker, CPU-bound). A user painting a long ridge line of dabs must not
 *  turn into dozens of full re-traces in a single run; matches the same
 *  "protect the run from an unbounded input" discipline
 *  `keyTerrain.ts`'s `MAX_CANDIDATES_EVALUATED` already uses. */
const MAX_OBSERVERS_EVALUATED = 8;

export interface MobilityAppreciationResult {
  results: MobilityCellResult[];
  bands: IsochroneBand[];
  profile: MoverProfile;
  usedEstimatedData: boolean;
  infrastructureAvailable: boolean;
  /** True when EITHER hydrology source (OSM waterway/water-body geometry, DEA
   *  WOfS frequency) returned real data for this AOI (docs §34). False means
   *  the fording gate had nothing to work from — stated, not silently absent. */
  hydrologyAvailable: boolean;
  /** The raw OSM waterway/water-body geometry this run fetched (docs §34) —
   *  for drawing the actual mapped river/lake shape on the map, not just the
   *  hex cells it influenced. */
  waterFeatures: InfrastructureTrail[];
  /** The raw OSM road/track geometry this run fetched (docs §35's
   *  `highway-mobility` set) — kept alongside `waterFeatures` for the SAME
   *  reason: presentation-layer route smoothing (`pathRefinement.ts`'s
   *  snap-to-trail step, reused for corridor representative routes, docs
   *  §28 addendum 2026-07-28) needs the actual road LINE geometry, not just
   *  the per-cell `onTrail` boolean the search itself used. */
  roadWays: InfrastructureTrail[];
  cellCount: number;
  reachableCount: number;
  /** Renamed from `noGoCount`/`slowGoCount` (OCOKA 1, docs/ROUTE_INTELLIGENCE.md
   *  §47) to the current MCOO mobility-class vocabulary. `mobilityTelemetry.ts`'s
   *  WIRE field names stay `noGoCount`/`slowGoCount` deliberately — that's an
   *  existing analytics time series in Table Storage, and renaming it there
   *  would split the series; the mapping happens explicitly at the telemetry
   *  recording boundary instead. */
  severelyRestrictedCount: number;
  restrictedCount: number;
  /** The single cheapest origin→objective path this run found — what the
   *  unit-simulation animation follows (docs "Terrain Mobility &
   *  Counter-Mobility": null only if no objective cell was reachable). */
  path: SimPathNode[] | null;
  /** The box-free ROAD-NETWORK route between the two painted areas (docs
   *  §35 Slice A, `roadRouteSearch.ts`) — computed independently of the
   *  hex-grid search above and the padded box it still runs inside. Null for
   *  non-vehicle profiles, when no road data was fetched, or when the road
   *  network genuinely doesn't connect the two areas. This is what actually
   *  answers a Lake-George-shaped "no route" for vehicles: the hex-grid
   *  `path` above can still legitimately be null in that case while this
   *  isn't. */
  roadRoute: RoadRouteSearchResult | null;
  /** docs §35 — true when the hex-grid search needed more than one lazy
   *  tile-materialisation round (`mobilityLazyGrid.ts`) to find a route, or
   *  to conclude there genuinely isn't one. False means the initial tile
   *  footprint already settled it — the common case, and the one that costs
   *  exactly what a single fixed-box search always did. */
  usedExpandedSearch: boolean;
  /** How many tile-materialisation rounds this run actually used. */
  searchAttempts: number;
  /** Analysis depth this run used (docs §35) — surfaced so the panel can
   *  show the current setting and a "re-run at finer resolution" control. */
  fidelity: MobilityFidelity;
  /** The cell count `computeCellBudget` targeted for the decisive attempt —
   *  paired with `cellCount` (the actual count, which can differ slightly
   *  after `chooseHexSize` rounds to a real hex tiling). */
  targetCellCount: number;
  /** The genuinely distinct origin→objective routes this run analysed. These
   *  are the ANALYSIS substrate; `corridorField` below is what gets
   *  presented (owner 2026-07-26: "use the individual pathways to analyse,
   *  corridors for likely results"). */
  dissimilarRoutes: DissimilarRoute[];
  /** Smoothed movement-density field segmented into ranked corridors — the
   *  presentation-layer answer to "where will they move", replacing a single
   *  confident polyline with bands whose fuzzy edges are the honest
   *  statement of what Tier 0/1 data can resolve (docs §10, §27). Null when
   *  no route existed to form a corridor from. */
  corridorField: CorridorField | null;
  /** The optimiser-derived corridor field (k cheapest routes), kept alongside
   *  the simulated one so "where the best routes are" and "where movers
   *  actually went" can be compared rather than conflated. Equal to
   *  `corridorField` when no ensemble was produced. */
  optimiserCorridorField: CorridorField | null;
  /** UNRESTRICTED movement — the ensemble of simulated movers over untouched
   *  ground (docs §32). Null if the objective was unreachable. */
  ensemble: MovementEnsembleResult | null;
  /** The recommended restriction set and the movement picture that results
   *  from emplacing it (docs §32). Null when no ensemble ran. */
  restrictionPlan: RestrictionPlan | null;
  /** Corridors re-derived from the RESTRICTED ensemble — "and this is where
   *  they go once those restrictions are in". Null when no restriction was
   *  worth recommending. */
  restrictedCorridorField: CorridorField | null;
  /** Pass 2 — top chokepoint cells (highest route-crossing count first). */
  chokepoints: ChokepointCell[];
  /** Pass 2 — cheapest severing cut for this profile (null if the objective
   *  was already unreachable, since there is nothing left to sever). */
  barrier: MinCutResult | null;
  /** Road-network-EXACT min-cut (docs §42b) — the cheapest set of REAL road
   *  segments (not whole hexes) that severs the road network specifically,
   *  computed directly over the road graph's own nodes/edges. Vehicle
   *  profiles only, null when no road data connects the two areas or nothing
   *  needs severing. A genuinely more precise ANSWER for the road/vehicle
   *  case alongside `barrier` above (which still covers off-road ground the
   *  same profile could also use) — not a replacement for it. */
  roadNetworkBarrier: RoadMinCutResult | null;
  /** OCOKA 4 (docs/ROUTE_INTELLIGENCE.md §47.1) — candidates from chokepoints/
   *  min-cut/corridor-bottleneck ground, each scored by a real re-run with it
   *  denied. Null when no path existed to score against (matches every other
   *  post-search product's null-on-unreachable convention), or when a path
   *  existed but nominated zero candidates (an honest, if unlikely, empty
   *  field). See `terrain/keyTerrain.ts`. */
  keyTerrain: KeyTerrainResult | null;
  /** OCOKA 6 (docs/ROUTE_INTELLIGENCE.md §47/§8) — real line-of-sight from
   *  every painted OBSERVER hex, screened (vegetation-canopy-aware) and
   *  bare-earth surfaces both computed. Null whenever no observer was
   *  painted for this run (the ordinary case — Observation is optional,
   *  additional analysis, not gated on path the way Obstacles/Avenues/Key
   *  terrain are) — see `oakoc.ts`'s `OcokaObservationFactor` for how this
   *  becomes the real Observation and fields of fire factor.
   *  `fieldsOfFireAssessed` stays `false` regardless: fields of fire needs a
   *  user-stated effective range, which this stage does not yet collect. */
  observation: ObservationResult | null;
  /** OCOKA 7 (docs/ROUTE_INTELLIGENCE.md §47) — concealment from dead ground
   *  (relative to the SAME painted observers `observation` is keyed on) and
   *  from vegetation structure. Null under the identical condition
   *  `observation` is null (no observer painted — defilade only means
   *  something relative to a specified position) — `terrain/concealment.ts`
   *  is only ever called once `observation` already exists. Cover
   *  (protection from fire) is NOT part of this field at all: it is not
   *  computed, full stop, and `oakoc.ts`'s `coverAssessed: false` says so
   *  independently of whatever this field holds. */
  concealment: ConcealmentResult | null;
  /** The exact sampled grid this run searched over — kept so a later
   *  counter-mobility ledger (`computeDelayLedger`) can be scored against the
   *  SAME cells the min-cut `barrier.segments` are keyed to, rather than
   *  resampling (which risks a different hex layout for a near-identical
   *  bounds calculation). */
  cells: MobilityGridCell[];
  originKeys: string[];
  objectiveKeys: string[];
  /** Grid geometry, kept alongside `cells` so a counter-measure scenario can
   *  re-derive corridors over the IDENTICAL grid rather than resampling (a
   *  fresh sample could land a different hex layout and make the before/after
   *  comparison meaningless). */
  hexSize: number;
  proj: LocalProjection;
}

/** A named phase of the run, for progress UI. `fraction` is overall run
 *  progress at the moment the phase STARTED — the same 0..1 scale `onProgress`
 *  reports, so a bar and a label can be driven from one clock without drifting
 *  apart. */
export interface MobilityStage {
  key: 'grid' | 'sampling' | 'search' | 'ensemble' | 'corridors' | 'chokepoints' | 'barrier' | 'restrictions' | 'keyTerrain' | 'observation' | 'done';
  label: string;
  fraction: number;
}

export interface MobilityAppreciationOptions {
  profileId: string;
  nightMode?: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  onLog?: (line: string) => void;
  /** Phase changes, in plain English — the run takes tens of seconds and was
   *  reported as "a long process of churn with no visual update" (owner,
   *  2026-07-27). */
  onStage?: (stage: MobilityStage) => void;
  /** How many simulated movers the unrestricted ensemble uses. */
  moverCount?: number;
  /** Which behaviour population to draw movers from (BEHAVIOUR_SPREADS). */
  behaviourSpreadId?: string;
  /** Seeded for reproducibility — same inputs, same seed, same ensemble. */
  simulationSeed?: number;
  /** Derive and evaluate a recommended restriction set. Default true. */
  planRestrictions?: boolean;
  /**
   * Fires ONCE, as soon as the grid has been sampled and classified but before
   * the search has run — terrain-only GO/SLOW-GO/NO-GO with no arrival times
   * yet. Lets the map paint the surveyed ground while the rest of the analysis
   * is still working, so the wait shows real intermediate output rather than a
   * spinner. These are genuine classified cells, not a placeholder: every one
   * is the same `assembleMobilityResults` output the final render uses, with
   * `timeSeconds` legitimately Infinity because nothing has been reached yet.
   */
  onPreviewCells?: (cells: MobilityCellResult[]) => void;
  /**
   * Fires ONCE, right after the multi-source search settles — the real
   * reachability field (arrival time per cell, GO/SLOW-GO/NO-GO) and the
   * single cheapest origin→objective route, exactly as `results`/`bands`/
   * `path` appear in the final return value. This is well before the
   * movement ensemble, corridors, chokepoints and min-cut barrier finish —
   * those can add tens of seconds more on a large or fine-fidelity grid, and
   * previously NOTHING new appeared on the map in that whole span (owner:
   * "the map [should start] getting visual results being loaded as it
   * happens. I'd love to see pathways snaking across the landscape from the
   * get go rather than waiting for the end."). The object passed here has
   * the exact shape of the final result, with every field the later stages
   * haven't computed yet left in its honest "nothing yet" state
   * (`corridorField`/`ensemble`/`restrictionPlan`/`barrier`: null,
   * `chokepoints`/`dissimilarRoutes`: empty) — never fabricated placeholder
   * corridors, just real data surfaced as soon as it exists.
   */
  onPartialResult?: (partial: MobilityAppreciationResult) => void;
  /**
   * Fires REPEATEDLY (unlike every other `onX` callback here, which fires
   * once) — a real interim transit-cell snapshot from the baseline mover
   * ensemble as movers complete, throttled to roughly every 250ms
   * (`movementSimulation.ts`'s `onPartialTracks`, WP4 streaming work). This
   * is what lets corridors visibly thicken on the map DURING the ensemble
   * run, rather than only appearing once `onPartialResult`'s search-only
   * field is later replaced by the final result. `moversDone` is honest —
   * "this many movers have been simulated so far", not a claim about
   * `moverCount`'s eventual total — so a caller wanting a fraction divides
   * by the `moverCount` it itself requested. Omit for no streaming.
   */
  onEnsembleProgress?: (cells: TransitCell[], moversDone: number) => void;
  /**
   * Fires ONCE, as soon as the box-free vehicle road route (docs §35 Slice A)
   * resolves — typically a couple of seconds in, well before `onPartialResult`
   * (which waits on the ENTIRE hex-grid sampling + multi-source search
   * pipeline, tens of seconds on a large or fine-fidelity AOI). The road route
   * has never actually depended on that pipeline — it only ever needed the
   * road network fetch, one of several already-parallel fetches inside
   * `buildMobilityGrid` — but was previously computed AFTER the whole grid
   * settled purely because of where the code happened to sit (docs §38: "the
   * genuine remainder of the original 'instant road result while the area
   * analysis runs' ask"). This fires an INDEPENDENT, early fetch for the same
   * first-attempt bounding box `buildMobilityGrid` will also request — the
   * existing bbox result/in-flight cache (`infrastructureService.ts`)
   * collapses the two into one real network round trip, not a duplicate.
   * A PREVIEW, not a replacement: `MobilityAppreciationResult.roadRoute` (via
   * `onPartialResult`/the final return) remains the authoritative figure,
   * computed from the grid's ACTUAL final extent — on the rare run that
   * needed extra lazy-grid tile-growth rounds beyond the initial footprint,
   * this preview and the authoritative route can differ; the authoritative
   * one always supersedes it. Vehicle profiles only, and only when a road
   * route was actually found.
   */
  onRoadRoute?: (route: RoadRouteSearchResult) => void;
  /** User-edited road-class speeds (docs §35 config UI). Set into this
   *  thread's own roadSpeedModel.ts module instance at the top of this run,
   *  and forwarded into the worker (a separate module instance — see
   *  roadSpeedModel.ts's own doc comment) on every worker call this run
   *  makes. Main-thread cost evaluation (corridorField.ts, minCutBarrier.ts,
   *  corridorAnalysis.ts, the road-route search) picks it up from the
   *  same set-once call — no threading required beyond this one option. */
  roadSpeedOverrides?: RoadSpeedOverrides;
  /** Analysis depth (docs §35, owner: "let the user select a scale of
   *  something like 'quick' to 'fine'"). Defaults to 'standard' — matches
   *  the original fixed cell budget exactly for a typical short-range run.
   *  Governs the lazy grid's initial footprint AND per-round cell/tile
   *  ceilings (`mobilityLazyGrid.ts`); does not change the tile-growth
   *  behaviour itself. */
  fidelity?: MobilityFidelity;
  /** docs §35 design point 2 — the α multiplier on the best-found cost C*
   *  that bounds how far the lazy grid grows while still looking for a
   *  second/third avenue (`mobilityLazyGrid.ts`). Design default 2.0,
   *  "user-adjustable" per the owner's own framing — this is the plumbing
   *  for that control; no UI is wired to it yet. */
  corridorBudgetAlpha?: number;
  /** Painted OBSERVER area (OCOKA 6, docs/ROUTE_INTELLIGENCE.md §47/§8) —
   *  optional. Each painted hex becomes its own candidate observation post;
   *  see `viewshed.ts` for what gets computed from it and `oakoc.ts` for how
   *  it becomes the real Observation and fields of fire factor. Absent or
   *  empty is the ordinary case (most runs paint no observer at all), not an
   *  error — Observation simply stays 'not-assessed' for that run. */
  observerPaint?: PaintedArea;
}

export async function runMobilityAppreciation(
  origin: PaintedArea,
  objective: PaintedArea,
  options: MobilityAppreciationOptions
): Promise<MobilityAppreciationResult | null> {
  const {
    profileId, nightMode = false, signal, onProgress: onProgressRaw, onLog, onStage, onPreviewCells, onPartialResult,
    onRoadRoute, onEnsembleProgress,
    moverCount = 240,
    behaviourSpreadId = DEFAULT_BEHAVIOUR_SPREAD_ID,
    simulationSeed = DEFAULT_MOVEMENT_SIM_SEED,
    planRestrictions = true,
    roadSpeedOverrides,
    fidelity = DEFAULT_MOBILITY_FIDELITY,
    corridorBudgetAlpha,
    observerPaint,
  } = options;
  // Progress across this run is assembled from several sources that don't
  // know about each other — a retry's own sampling pass, the worker's search
  // progress, the ensemble/restrictions phases the SAME worker call streams
  // back before it resolves — and reconciling their exact numeric handoffs
  // by hand proved fragile: a stale/lower value from one source landing
  // after a higher one from another visibly moved the bar BACKWARD (found
  // this session: the ensemble worker call's own 'restrictions' phase can
  // already report up to ~0.97 internally before the outer code's next
  // scripted checkpoint, which used to unconditionally send a lower 0.7).
  // This guard is the one place that discipline is enforced, so no call site
  // below has to re-derive it: report a value going backward NEVER reaches
  // the caller — the bar holds at its high-water mark instead of lying about
  // work being undone.
  let highWaterProgress = 0;
  const onProgress = (fraction: number) => {
    if (fraction <= highWaterProgress) return;
    highWaterProgress = fraction;
    onProgressRaw?.(fraction);
  };
  const profile = getMoverProfile(profileId);
  if (!profile) {
    onLog?.(`ERROR — unknown mover profile "${profileId}"`);
    return null;
  }
  // Set once, here, before any main-thread cost evaluation this run makes —
  // see roadSpeedModel.ts's own doc comment on why the worker call sites
  // below must ALSO forward this explicitly (a Worker is a separate module
  // instance; this call is invisible to it).
  setRoadSpeedOverrides(roadSpeedOverrides ?? null);
  if (roadSpeedOverrides) {
    onLog?.('USING USER-EDITED ROAD-CLASS SPEEDS — SEE CONFIG PANEL FOR WHICH CLASSES WERE OVERRIDDEN');
  }

  onLog?.(`PROFILE ${profile.label.toUpperCase()} · ${profile.confidence.toUpperCase()} CONFIDENCE (${profile.source.slice(0, 72)}${profile.source.length > 72 ? '…' : ''})`);
  onLog?.('LAYING OUT SURVEY GRID OVER AREA OF INTEREST…');
  onStage?.({ key: 'grid', label: 'Laying out survey grid', fraction: 0 });

  // docs §35 — the Lake George defect's full fix: lazy tile materialisation
  // under the search's own frontier (`mobilityLazyGrid.ts`), superseding the
  // earlier "rebuild the whole grid at a bigger guessed pad factor" retry
  // this function used to run here. `INITIAL_PAD_FACTOR` MUST match the
  // lazy module's own identical constant — both size the SAME initial
  // footprint from the SAME `computePaddedBounds` math, which is what lets
  // `findEarlyVehicleRoadRoutePreview` below (a genuinely separate, earlier
  // fetch) share one real network round trip with it via
  // `infrastructureService.ts`'s bbox cache instead of paying for two.
  const INITIAL_PAD_FACTOR = 0.3;

  // Road-route decoupling (docs §38's stated remainder, closed 2026-07-28):
  // fire the box-free vehicle road route EARLY, independent of the hex-grid
  // pipeline below — see `findEarlyVehicleRoadRoutePreview`'s own doc comment.
  // Deliberately NOT awaited: it races the retry loop and calls `onRoadRoute`
  // the moment it resolves, typically seconds in rather than tens of seconds.
  // `INITIAL_PAD_FACTOR`/`minDetourPadM(profile)` here MUST match attempt 0's
  // own values below exactly, or the bbox cache in `infrastructureService.ts`
  // can't collapse this into the same network request the grid pipeline makes.
  if (onRoadRoute) {
    findEarlyVehicleRoadRoutePreview(origin, objective, profile, INITIAL_PAD_FACTOR, minDetourPadM(profile), roadSpeedOverrides, signal)
      .then(early => {
        if (signal?.aborted || !early) return;
        onLog?.(
          `EARLY ROAD-NETWORK ROUTE PREVIEW — ${(early.totalDistanceM / 1000).toFixed(1)} KM, ` +
          `${(early.totalSeconds / 60).toFixed(0)} MIN (WHILE THE FULL AREA ANALYSIS IS STILL RUNNING)`
        );
        onRoadRoute(early);
      })
      .catch(() => { /* best-effort preview only — the authoritative roadRoute below never depends on this */ });
  }

  // Lazy tile materialisation under the search's own A* frontier (docs §35,
  // `mobilityLazyGrid.ts`) — grows the grid organically, one ring of tiles at
  // a time, resuming the SAME search rather than rebuilding everything from
  // scratch at a bigger guessed box. One round (the common case) costs
  // exactly what the old fixed-box first attempt did; only a genuinely
  // Lake-George-shaped run pays for more, and only for the new ground.
  let samplingAnnounced = false;
  const lazy = await runLazyMobilitySearch(origin, objective, {
    signal, fidelity, profileId, nightMode, roadSpeedOverrides, alpha: corridorBudgetAlpha, observerPaint,
    onProgress: f => {
      onProgress(f * 0.55);
      if (f > 0.02 && !samplingAnnounced) {
        samplingAnnounced = true;
        onStage?.({ key: 'sampling', label: 'Sampling ground — elevation, vegetation, trails', fraction: f * 0.55 });
      }
    },
    onLog,
    onRoundStart: (round, materializedSoFar) => {
      if (round === 1) {
        onStage?.({ key: 'sampling', label: 'Sampling ground — elevation, vegetation, trails', fraction: 0 });
      } else {
        onLog?.(`WIDENING THE SEARCH — MATERIALISING MORE GROUND TOWARD THE REACHABLE FRONTIER (ROUND ${round}, ${materializedSoFar} CELLS SO FAR)`);
        onStage?.({ key: 'search', label: `Widening the search (round ${round})`, fraction: highWaterProgress });
      }
    },
    onPreviewCells,
  });
  if (signal?.aborted) return null;
  if (!lazy) {
    onLog?.('AOI TOO SMALL OR DEGENERATE — ABORTED');
    return null;
  }
  const { grid, results, path, roundsUsed, hitCeiling, costStarSeconds, corridorCountAtStop } = lazy;
  onProgress(0.55);

  onLog?.(
    `SAMPLED ${grid.cells.length} CELLS (${fidelity.toUpperCase()} FIDELITY, TARGET ${grid.targetCellCount}) · ` +
    `ORIGIN SEED SET ${grid.originKeys.length} CELLS · SEARCHED ${profile.label.toUpperCase()}${nightMode ? ' · NIGHT' : ''}` +
    (roundsUsed > 1 ? ` · ${roundsUsed} TILE-GROWTH ROUNDS` : '')
  );
  if (!path && hitCeiling) {
    onLog?.('SEARCH CEILING REACHED WHILE WIDENING — STOPPING GROWTH HERE, SEE RESULT BELOW');
  }
  // docs §35 remainder — the α·C*/corridor-count stop rule's own honesty
  // line: says plainly whether the search found its target 2–5 avenues, hit
  // the travel-time budget first, or hit the hard ceiling first — the same
  // "there is no way" vs "I wasn't allowed to look far enough" distinction
  // §35's original Lake George fix established, now applied to CORRIDOR
  // count rather than just route existence.
  if (path && costStarSeconds !== null) {
    if (corridorCountAtStop >= 2) {
      onLog?.(`${corridorCountAtStop} DISTINCT AVENUE(S) CONFIRMED WITHIN THE α×C* TRAVEL-TIME BUDGET (C* = ${(costStarSeconds / 60).toFixed(0)} MIN)`);
    } else if (hitCeiling) {
      onLog?.(`ONLY ${corridorCountAtStop} AVENUE FOUND BEFORE THE SEARCH CEILING — MAY BE MORE, NOT YET RULED OUT`);
    } else {
      onLog?.(`ONLY ${corridorCountAtStop} AVENUE FOUND — THE α×C* BUDGET (${(costStarSeconds / 60).toFixed(0)} MIN × α) GENUINELY RAN OUT OF NEW GROUND, NOT A CEILING ARTEFACT`);
    }
  }

  const usedExpandedSearch = roundsUsed > 1;
  const attemptsUsed = roundsUsed;
  if (grid.usedEstimatedData) onLog?.('CAUTION — ONE OR MORE SAMPLES ARE ESTIMATED/FALLBACK DATA (TIER 0)');
  if (!grid.infrastructureAvailable) onLog?.('TRAIL DATA UNAVAILABLE FOR THIS AREA — ROUTING ON TERRAIN + FUEL ONLY');
  // Hydrology (docs §34) — a real, computed count, not a claim: this is what
  // makes "is water actually being considered" answerable by looking at the
  // log rather than taking the model's word for it. Reported for the FINAL
  // (decisive) grid, since a retry resamples a different box.
  if (!grid.hydrologyAvailable) {
    onLog?.('NO WATERWAY/WATER-BODY DATA FOR THIS AREA — HYDROLOGY GATE INACTIVE');
  } else {
    const waterCellCount = grid.cells.filter(carriesWaterSignal).length;
    if (waterCellCount > 0) {
      const bodyCount = grid.cells.filter(c => c.inWaterBody).length;
      onLog?.(
        `HYDROLOGY — ${waterCellCount}/${grid.cells.length} CELLS CARRY A WATER SIGNAL` +
        (bodyCount > 0 ? ` (${bodyCount} STANDING WATER BODY)` : '')
      );
    } else {
      onLog?.('HYDROLOGY — NO WATERCOURSES OR WATER BODIES DETECTED IN THIS AREA');
    }
  }
  if (grid.usedCoarseGrid) {
    onLog?.('CAUTION — AOI IS LARGE, GRID COARSENED TO STAY WITHIN COMPUTE BUDGET (RESOLUTION REDUCED)');
  }
  // Edge case, stated plainly rather than left to look like a bug: a
  // painted origin and objective that overlap or touch share at least one
  // cell, so the cheapest route between them is genuinely ~0 seconds — the
  // search is correct, the AOIs are just not disjoint.
  const overlapKeys = grid.originKeys.filter(k => grid.objectiveKeys.includes(k));
  if (overlapKeys.length > 0) {
    onLog?.(`ORIGIN AND OBJECTIVE OVERLAP — ${overlapKeys.length} SHARED CELL(S), ROUTE IS TRIVIAL BY DESIGN`);
  }

  // Box-free ROAD-NETWORK route (docs §35 Slice A) — independent of the
  // hex-grid search above and the padded box it still runs inside. Vehicle
  // profiles only (roadRouteSearch.ts's own gate); cheap enough to run
  // synchronously on the main thread (a handful of OSM ways, not a grid).
  let roadRoute: RoadRouteSearchResult | null = null;
  // Built once, alongside `roadRoute`, for reuse by BOTH the ensemble's
  // mixed-mode movement (docs §42b — real road-graph edges, not just
  // hex-quantized steps) and the road-network-exact min-cut below. Kept as a
  // SEPARATE build from the one `findVehicleRoadRoute` makes internally
  // (rather than refactoring that tested function's signature) — cheap (no
  // network I/O, just iterating already-fetched ways), and keeps this new
  // wiring isolated from the existing, proven road-route search path.
  let mixedRoadGraph: RoadGraph | null = null;
  if (profile.speedModel === 'vehicle-gradient') {
    roadRoute = findVehicleRoadRoute(origin, objective, grid.roadWays, profile, roadSpeedOverrides, grid.waterFeatures);
    if (roadRoute) {
      onLog?.(
        `ROAD-NETWORK ROUTE (VEHICLE, BOX-FREE) — ${(roadRoute.totalDistanceM / 1000).toFixed(1)} KM VIA ` +
        `${roadRoute.wayNames.length > 0 ? roadRoute.wayNames.slice(0, 3).join(', ') : 'UNNAMED WAYS'} · ` +
        `${(roadRoute.totalSeconds / 60).toFixed(0)} MIN ROAD-NETWORK ACCESS TO ROAD-NETWORK ACCESS ` +
        `(EXCLUDES OFF-ROAD LEGS TO/FROM THE PAINTED AREAS)`
      );
    } else if (grid.roadWays.length > 0) {
      onLog?.('NO ROAD-NETWORK ROUTE FOUND BETWEEN THE PAINTED AREAS (NO NEARBY ROAD, OR THE NETWORK DOES NOT CONNECT THEM)');
    }
    if (grid.roadWays.length > 0) {
      const waterBodies: WaterBodyPolygon[] = grid.waterFeatures
        .filter(f => f.kind === 'water')
        .map(f => ({ coords: f.coords, holes: f.holes }));
      const built = buildRoadGraph(grid.roadWays as RoadWay[], waterBodies);
      if (built.wayCount > 0) mixedRoadGraph = built;
    }
  }

  // Converted once, up front, so BOTH the movement ensemble (as a per-step
  // tie-break bias, docs §42 follow-on) and the corridor/chokepoint fusion
  // below (docs §42) can use the identical resolved route — never two
  // independent conversions that could drift apart.
  const roadRouteAsDissimilar = roadRoute ? roadRouteToDissimilarRoute(roadRoute, grid.cells) : null;

  const bands = buildIsochroneBands(results, DEFAULT_ISOCHRONE_MINUTES);
  const reachableCount = results.filter(r => isFinite(r.timeSeconds)).length;
  const severelyRestrictedCount = results.filter(r => r.trafficability === 'severely-restricted').length;
  const restrictedCount = results.filter(r => r.trafficability === 'restricted').length;

  const fastestBand = bands.find(b => b.cells.length > 0);
  if (fastestBand) {
    onLog?.(`FIRST ARRIVALS WITHIN ${fastestBand.thresholdMinutes} MIN — ${fastestBand.cells.length} CELLS`);
  }
  if (path) {
    const etaMin = path[path.length - 1].cumulativeSeconds / 60;
    onLog?.(
      `ROUTE FOUND — ${path.length} WAYPOINTS · ETA ${etaMin.toFixed(0)} MIN` +
      (usedExpandedSearch ? ` (NEEDED ${attemptsUsed} TILE-GROWTH ROUNDS, ${grid.cells.length} CELLS)` : '')
    );
  } else if (hitCeiling) {
    onLog?.(
      `NO ROUTE FOUND — STOPPED AFTER ${attemptsUsed} ROUND(S) AT THE SEARCH CEILING ` +
      `(${grid.cells.length} CELLS) — THE FRONTIER WAS STILL FINDING NEW GROUND TO EXPLORE, NOT YET PROVEN UNREACHABLE`
    );
  } else {
    onLog?.(
      `NO ROUTE FOUND AFTER ${attemptsUsed} ROUND(S) ` +
      `(${grid.cells.length} CELLS) — THE REACHABLE FRONTIER RAN OUT OF NEW GROUND TO GROW INTO, ` +
      `OBJECTIVE GENUINELY UNREACHABLE FOR THIS PROFILE, NOT A BOX ARTEFACT`
    );
  }

  // Surface the real reachability field and cheapest route NOW — everything
  // below (the movement ensemble, corridors, chokepoints, min-cut barrier)
  // can add tens of seconds more on a large or fine-fidelity grid, and until
  // this call existed NOTHING new reached the map in that whole span (owner:
  // "the map [should start] getting visual results being loaded as it
  // happens... pathways snaking across the landscape from the get go rather
  // than waiting for the end"). Every field below this point is still in its
  // honest "nothing yet" state — not fabricated, just not computed yet.
  onPartialResult?.({
    results, bands, profile,
    usedEstimatedData: grid.usedEstimatedData,
    infrastructureAvailable: grid.infrastructureAvailable,
    hydrologyAvailable: grid.hydrologyAvailable,
    waterFeatures: grid.waterFeatures,
    roadWays: grid.roadWays,
    cellCount: grid.cells.length,
    reachableCount, severelyRestrictedCount, restrictedCount,
    path, roadRoute, usedExpandedSearch,
    searchAttempts: attemptsUsed,
    fidelity: grid.fidelity,
    targetCellCount: grid.targetCellCount,
    dissimilarRoutes: [],
    corridorField: null,
    optimiserCorridorField: null,
    ensemble: null,
    restrictionPlan: null,
    restrictedCorridorField: null,
    chokepoints: [],
    barrier: null,
    roadNetworkBarrier: null,
    observation: null,
    concealment: null,
    keyTerrain: null,
    cells: grid.cells,
    originKeys: grid.originKeys,
    objectiveKeys: grid.objectiveKeys,
    hexSize: grid.hexSize,
    proj: grid.proj,
  });

  // --- Pass 2 + the simulation (docs §32): corridors, chokepoints, min-cut
  // barrier. Movement ensemble/restrictions, corridor-field construction and
  // the min-cut solves all run in the Web Worker (WP3, movement-analysis
  // performance work) — each `buildCorridorField` call is itself up to
  // several full Dijkstra searches, and Edmonds-Karp min-cut is the single
  // most CPU-bound phase this mode runs; running any of them synchronously
  // here reproduces the page-hang regression (docs §41). Only genuinely
  // cheap, O(N)-or-better work (chokepoints, key-terrain candidate
  // nomination) stays on the main thread, each preceded by a `yieldToMain()`
  // so the browser can paint what the worker call just delivered first.
  let dissimilarRoutes: DissimilarRoute[] = [];
  let chokepoints: ChokepointCell[] = [];
  let barrier: MinCutResult | null = null;
  let roadNetworkBarrier: RoadMinCutResult | null = null;
  let corridorField: CorridorField | null = null;
  let optimiserCorridorField: CorridorField | null = null;
  let ensemble: MovementEnsembleResult | null = null;
  let restrictionPlan: RestrictionPlan | null = null;
  let restrictedCorridorField: CorridorField | null = null;
  let keyTerrain: KeyTerrainResult | null = null;
  let observation: ObservationResult | null = null;
  let concealment: ConcealmentResult | null = null;
  if (path) {
    // --- UNRESTRICTED MOVEMENT: the headline answer. Simulated movers, not
    // solved routes. This is what the corridors are built from.
    onProgress(0.55);
    onStage?.({ key: 'ensemble', label: `Simulating ${moverCount} independent movers over untouched ground`, fraction: 0.55 });
    onLog?.(`SIMULATING ${moverCount} MOVERS — UNRESTRICTED MOVEMENT (BEHAVIOUR MODEL: ${behaviourSpreadId.toUpperCase()})…`);
    const movement = await runMovementEnsembleInWorker(
      grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode,
      {
        moverCount,
        spreadId: behaviourSpreadId,
        seed: simulationSeed,
        planRestrictions,
        roadSpeedOverrides,
        preferredRouteKeys: roadRouteAsDissimilar?.keys,
        // Mixed-mode movement (docs §42b) — the baseline ensemble only; never
        // forwarded to planRestrictions internally (mobilityWorker.ts), by
        // design (see RoadMixState's own doc comment on why).
        roadGraph: mixedRoadGraph ?? undefined,
        // NOTE: `planRestrictions` runs INSIDE this same worker call, after
        // the ensemble, before the response posts back — so BOTH phases'
        // progress (ensemble then restrictions) can already have reported up
        // to their own ceilings by the time this `await` resolves, well
        // before the `onStage`/`onProgress` calls that follow it below. The
        // monotonic `onProgress` wrapper (see its own comment near the top
        // of this function) is what keeps that from showing as a rewind.
        onProgress: (f, phase) => {
          if (phase === 'ensemble') onProgress(0.55 + f * 0.17);
          else onProgress(0.72 + f * 0.23);
        },
        onLog: line => onLog?.(line),
        onPartialTracks: onEnsembleProgress,
      }
    );
    if (signal?.aborted) return null;
    ensemble = movement.ensemble;
    restrictionPlan = movement.plan;

    if (ensemble) {
      const arrivedPct = Math.round((ensemble.arrivedCount / Math.max(1, ensemble.moverCount)) * 100);
      onLog?.(
        `${ensemble.arrivedCount}/${ensemble.moverCount} MOVERS REACHED THE OBJECTIVE (${arrivedPct}%) · ` +
        `MEDIAN ${ensemble.arrivalP50Seconds !== null ? (ensemble.arrivalP50Seconds / 60).toFixed(0) : '—'} MIN ` +
        `(P10 ${ensemble.arrivalP10Seconds !== null ? (ensemble.arrivalP10Seconds / 60).toFixed(0) : '—'} / ` +
        `P90 ${ensemble.arrivalP90Seconds !== null ? (ensemble.arrivalP90Seconds / 60).toFixed(0) : '—'})`
      );
      if (ensemble.optimalSeconds !== null && ensemble.arrivalP50Seconds !== null) {
        const overhead = ensemble.arrivalP50Seconds / Math.max(1, ensemble.optimalSeconds);
        onLog?.(
          `OPTIMISER'S BEST CASE ${(ensemble.optimalSeconds / 60).toFixed(0)} MIN — ` +
          `SIMULATED MEDIAN IS ${overhead.toFixed(2)}× THAT (REAL MOVERS ARE NOT OPTIMISERS)`
        );
      }
      onLog?.(
        `${Math.round(ensemble.crossCountryFraction * 100)}% OF SIMULATED MOVEMENT WAS OFF THE ROAD/TRAIL NETWORK` +
        (grid.infrastructureAvailable ? '' : ' (NO TRAIL DATA — EVERYTHING COUNTS AS CROSS-COUNTRY)')
      );
      if (ensemble.lostCount > 0) {
        onLog?.(`${ensemble.lostCount} MOVER(S) NEVER ARRIVED — DEAD-ENDED OR RAN OUT OF STEPS`);
      }
    }

    // No onProgress call here: by this point the ensemble/restrictions
    // progress reported inside the await above may already sit anywhere up
    // to ~0.95 (or as low as ~0.72 if no restriction was worth evaluating) —
    // there is no single honest constant for "corridors are starting" that
    // is right in both cases, and the monotonic wrapper would just discard a
    // wrong guess anyway. The stage label is still useful on its own.
    onStage?.({ key: 'corridors', label: 'Smoothing simulated movement into corridors', fraction: highWaterProgress });

    // Corridors from the SIMULATION where one exists, from the optimiser
    // otherwise. Both go through the identical pipeline, so the two views can
    // never drift into disagreeing about what a corridor is.
    if (ensemble && ensemble.tracks.length > 0) {
      const ensembleRoutes = ensembleTracksToRoutes(ensemble.tracks, grid.cells);
      corridorField = await runCorridorFieldInWorker(
        grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode,
        {
          routesOverride: roadRouteAsDissimilar ? [...ensembleRoutes, roadRouteAsDissimilar] : ensembleRoutes,
          evidence: 'simulated-movers',
          weightByAttractiveness: false,
        },
        roadSpeedOverrides
      );
      if (signal?.aborted) return null;
    }

    // The optimiser view is still computed: chokepoints and the min-cut below
    // are graph properties of the ROUTE set, and comparing "best routes" with
    // "what movers did" is itself informative.
    onLog?.(`DERIVING UP TO ${DEFAULT_CORRIDOR_ROUTE_COUNT} DISTINCT OPTIMAL ROUTES FOR COMPARISON…`);
    optimiserCorridorField = await runCorridorFieldInWorker(
      grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode,
      undefined, roadSpeedOverrides
    );
    if (signal?.aborted) return null;
    // Re-cluster once more with the real road route folded in, so it counts
    // as its own avenue (or merges into an existing one, if it's genuinely
    // the same ground) rather than being invisible to chokepoint/corridor
    // analysis. Only pays this second (cheap — same small route-set
    // clustering, not a grid search) pass when there's actually a road route
    // to add.
    if (roadRouteAsDissimilar && optimiserCorridorField) {
      onLog?.('FOLDING THE REAL ROAD-NETWORK ROUTE INTO CORRIDOR/CHOKEPOINT ANALYSIS AS A KNOWN-GOOD AVENUE…');
      const withRoadRoute = await runCorridorFieldInWorker(
        grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode,
        { routesOverride: [...optimiserCorridorField.routes, roadRouteAsDissimilar] },
        roadSpeedOverrides
      );
      if (signal?.aborted) return null;
      optimiserCorridorField = withRoadRoute ?? optimiserCorridorField;
    }
    dissimilarRoutes = optimiserCorridorField?.routes ?? [];
    if (!corridorField) corridorField = optimiserCorridorField;

    if (corridorField) {
      const evidenceLabel = corridorField.evidence === 'simulated-movers' ? 'SIMULATED MOVERS' : 'OPTIMAL ROUTES';
      onLog?.(
        `${corridorField.corridors.length} CORRIDOR(S) FORMED FROM ${evidenceLabel} · ` +
        `${corridorField.routedCellCount} CELLS ACTUALLY CROSSED, ${corridorField.cellCount} IN BAND AFTER SMOOTHING`
      );
      if (corridorField.unconstrained) {
        onLog?.(
          `MOVEMENT UNCONSTRAINED — BANDS COVER ${Math.round(corridorField.coverageFraction * 100)}% OF THE AREA. ` +
          'THIS GROUND DOES NOT CANALISE MOVEMENT: THERE ARE NO REAL CHOKEPOINTS TO DENY.'
        );
      }
      // docs §35 remainder (owner: "we should be seeing a 'most likely' and
      // 'most risky' type of option to inform our planning") — MOST LIKELY
      // is simply rank 1 (already the busiest corridor); MOST RISKY is
      // whichever corridor's own computed `riskScore` is highest (terrain
      // hazard + water crossings + how hard it pinches — see
      // `Corridor.riskScore`'s own doc comment for the exact formula). The
      // two commonly point at DIFFERENT corridors — the busiest is usually
      // busiest BECAUSE it's easiest — and that divergence is the actual
      // planning value here, not a coincidence to smooth over.
      const riskiest = corridorField.corridors.find(c => c.id === corridorField!.mostRiskyCorridorId);
      if (riskiest && corridorField.mostRiskyCorridorId !== corridorField.mostLikelyCorridorId) {
        onLog?.(
          `MOST LIKELY: CORRIDOR ${corridorField.corridors[0]?.rank ?? 1} · MOST RISKY: CORRIDOR ${riskiest.rank} ` +
          `(${Math.round(riskiest.riskScore * 100)}% RISK — ${Math.round((riskiest.restrictedFraction + riskiest.severelyRestrictedFraction) * 100)}% RESTRICTED/SEVERELY RESTRICTED, ` +
          `${Math.round(riskiest.waterCrossingFraction * 100)}% WATER SIGNAL, PINCH RATIO ${riskiest.pinchRatio.toFixed(2)})`
        );
      } else if (riskiest) {
        onLog?.(`ONLY ONE CORRIDOR FOUND — IT IS BOTH THE MOST LIKELY AND THE ONLY OPTION TO PLAN AROUND`);
      }
      for (const c of corridorField.corridors.slice(0, 4)) {
        const picks = [
          c.id === corridorField.mostLikelyCorridorId ? 'MOST LIKELY' : null,
          c.id === corridorField.mostRiskyCorridorId ? 'MOST RISKY' : null,
        ].filter((p): p is string => p !== null);
        onLog?.(
          `CORRIDOR ${c.rank}${picks.length > 0 ? ` [${picks.join(' + ')}]` : ''} — ` +
          `${Math.round(c.shareOfRoutes * 100)}% OF ${evidenceLabel} · ${c.easeClass.toUpperCase()} · ` +
          `BOTTLENECK ~${c.bottleneckWidthM.toFixed(0)} M (${c.bottleneckAbreast} ABREAST) · ` +
          `MEDIAN ${(c.medianTravelSeconds / 60).toFixed(0)} MIN`
        );
      }
    }

    // --- RESTRICTED MOVEMENT: corridors re-derived from the ensemble that was
    // re-run with the recommended restrictions emplaced.
    if (restrictionPlan) {
      onStage?.({ key: 'restrictions', label: 'Evaluating where to deny movement', fraction: 0.75 });
      if (restrictionPlan.restrictions.length > 0) {
        onLog?.(
          `${restrictionPlan.restrictions.length} RESTRICTION(S) RECOMMENDED — MEDIAN JOURNEY ` +
          `${restrictionPlan.baselineMedianSeconds !== null ? (restrictionPlan.baselineMedianSeconds / 60).toFixed(0) : '—'} MIN → ` +
          `${restrictionPlan.scenarioMedianSeconds !== null ? (restrictionPlan.scenarioMedianSeconds / 60).toFixed(0) : '—'} MIN · ` +
          `ARRIVALS ${Math.round(restrictionPlan.baselineArrivedFraction * 100)}% → ${Math.round(restrictionPlan.scenarioArrivedFraction * 100)}%`
        );
      }
      if (restrictionPlan.bypassNote) onLog?.(restrictionPlan.bypassNote.toUpperCase());
      if (restrictionPlan.scenario && restrictionPlan.scenario.tracks.length > 0) {
        restrictedCorridorField = await runCorridorFieldInWorker(
          grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode,
          {
            routesOverride: ensembleTracksToRoutes(restrictionPlan.scenario.tracks, grid.cells),
            evidence: 'simulated-movers',
            weightByAttractiveness: false,
          },
          roadSpeedOverrides
        );
        if (signal?.aborted) return null;
      }
    }

    // Cheap, main-thread work (corridorAnalysis.ts's own header: O(K·N),
    // negligible next to the worker phases around it) — yield first so the
    // browser can paint whatever the corridor-field worker calls above just
    // delivered before this chunk of synchronous work runs.
    await yieldToMain();
    onStage?.({ key: 'chokepoints', label: 'Finding the ground every route funnels through', fraction: 0.97 });
    chokepoints = computeChokepoints(grid.cells, grid.hexSize, grid.proj, dissimilarRoutes).slice(0, 12);
    if (chokepoints.length > 0) {
      onLog?.(`TOP CHOKEPOINT CROSSED BY ${chokepoints[0].passCount}/${dissimilarRoutes.length} ROUTES`);
    }

    onProgress(0.98);
    onStage?.({ key: 'barrier', label: 'Siting the cheapest severing cut', fraction: 0.98 });
    onLog?.('SITING CHEAPEST SEVERING CUT (MAX-FLOW/MIN-CUT)…');
    // Road-network-EXACT min-cut (docs §42b) — a SEPARATE max-flow problem
    // run directly over the road graph's own nodes/edges (see
    // computeRoadNetworkMinCut's own header for why this is not a rewrite of
    // the hex cut above). Vehicle profiles only, and only when road data
    // connects both painted areas — matching `findVehicleRoadRoute`'s own
    // gating exactly, since this answers the same "is there a road-network
    // path here at all" question the route search already had to resolve.
    // Computed in the SAME worker request as the hex cut (docs §47.4: the
    // two are independent of each other, "Hex vs road min-cut — 2-way,
    // free") rather than as two separate round trips.
    let roadOriginNodeIds: string[] | undefined;
    let roadObjectiveNodeIds: string[] | undefined;
    if (mixedRoadGraph) {
      const originPoint = areaCentroid(origin);
      const objectivePoint = areaCentroid(objective);
      const originNodes = originPoint ? nodesWithin(mixedRoadGraph, originPoint, ROAD_ACCESS_SNAP_M) : [];
      const objectiveNodes = objectivePoint ? nodesWithin(mixedRoadGraph, objectivePoint, ROAD_ACCESS_SNAP_M) : [];
      if (originNodes.length > 0 && objectiveNodes.length > 0) {
        roadOriginNodeIds = originNodes.map(n => n.id);
        roadObjectiveNodeIds = objectiveNodes.map(n => n.id);
      }
    }
    const minCutResult = await runMinCutInWorker(
      grid.cells, grid.originKeys, grid.objectiveKeys, profileId, nightMode, roadSpeedOverrides,
      mixedRoadGraph ?? undefined, roadOriginNodeIds, roadObjectiveNodeIds
    );
    if (signal?.aborted) return null;
    barrier = minCutResult.barrier;
    roadNetworkBarrier = minCutResult.roadNetworkBarrier;
    if (barrier) {
      onLog?.(`MIN-CUT — ${barrier.segments.length} SEGMENT(S), CUT VALUE ${barrier.cutValue.toFixed(0)} (UNIT/ROAD-CLASS-WEIGHTED, NOT YET REAL VEHICLE CAPACITY)`);
    } else {
      onLog?.('MIN-CUT SKIPPED — NO SEPARATING CUT NEEDED OR FOUND');
    }
    if (roadNetworkBarrier) {
      onLog?.(
        `ROAD-NETWORK MIN-CUT — ${roadNetworkBarrier.segments.length} EXACT ROAD SEGMENT(S), ` +
        `CUT VALUE ${roadNetworkBarrier.cutValue.toFixed(0)} (ROAD-CLASS-WEIGHTED, RESOLUTION = REAL ROAD VERTICES, NOT HEXES)`
      );
    }

    // Key terrain (OCOKA 4, docs/ROUTE_INTELLIGENCE.md §47.1) — candidates
    // nominated from the chokepoint/min-cut/corridor-bottleneck products just
    // computed above, cheap on the main thread; scoring is the expensive part
    // and runs in the worker (keyTerrain.ts's own header explains why both
    // halves are split this way). Scored against `optimiserCorridorField`,
    // deliberately, per that module's header — never the (possibly absent,
    // possibly simulated-mover) `corridorField`. Yield first — same reasoning
    // as the chokepoints yield above, this sits right after the min-cut
    // worker call resolved.
    await yieldToMain();
    if (optimiserCorridorField) {
      const keyTerrainCandidates = generateKeyTerrainCandidates(
        grid.cells, chokepoints, barrier, roadNetworkBarrier, optimiserCorridorField
      );
      if (keyTerrainCandidates.length > 0) {
        onStage?.({ key: 'keyTerrain', label: 'Scoring key terrain candidates', fraction: 0.99 });
        onLog?.(`SCORING ${keyTerrainCandidates.length} KEY TERRAIN CANDIDATE(S)…`);
        keyTerrain = await runKeyTerrainScoringInWorker(
          grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode,
          optimiserCorridorField, keyTerrainCandidates, roadSpeedOverrides
        );
        if (signal?.aborted) return null;
        if (keyTerrain) {
          const decisiveCount = keyTerrain.candidates.filter(c => c.decisiveCandidate).length;
          onLog?.(
            `KEY TERRAIN — ${keyTerrain.candidatesConsidered} CANDIDATE(S) CONSIDERED, ${keyTerrain.candidates.length} SCORED` +
            (decisiveCount > 0 ? `, ${decisiveCount} CANDIDATE DECISIVE (REQUIRES CONFIRMATION)` : '')
          );
        }
      }
    }
  }

  // Observation and fields of fire (OCOKA 6, docs/ROUTE_INTELLIGENCE.md
  // §47/§8) — deliberately OUTSIDE the `if (path)` block above: unlike
  // Obstacles/Avenues/Key terrain, viewshed is a standalone geometric
  // computation over the sampled grid and never depended on origin
  // reaching objective at all. Gated only on whether the user painted an
  // observer — the ordinary case is nobody did, and that is simply
  // "nothing to compute", not a failure (see `ObservationResult`'s own
  // null-when-no-observer convention downstream in `oakoc.ts`).
  if (grid.observerKeys.length > 0) {
    // Hard cap, same "protect the run from an unbounded input" discipline
    // `keyTerrain.ts`'s MAX_CANDIDATES_EVALUATED already uses — each
    // observer is a full grid-wide trace (viewshed.ts's own header), so a
    // user painting a long ridge line of dabs must not turn into dozens of
    // full re-traces in one run.
    const observerKeys = grid.observerKeys.slice(0, MAX_OBSERVERS_EVALUATED);
    onStage?.({ key: 'observation', label: `Tracing line of sight from ${observerKeys.length} observer(s)`, fraction: 0.99 });
    onLog?.(`TRACING LINE OF SIGHT FROM ${observerKeys.length} OBSERVER(S)…`);
    const observers = await runViewshedInWorker(grid.cells, grid.hexSize, observerKeys);
    if (signal?.aborted) return null;
    observation = buildObservationResult(observers, optimiserCorridorField);
    if (observation.corridorCoverageFraction !== null) {
      onLog?.(`OBSERVATION — ${Math.round(observation.corridorCoverageFraction * 100)}% OF THE HEADLINE CORRIDOR(S) SEEN BY AT LEAST ONE OBSERVER`);
    } else {
      onLog?.(`OBSERVATION — ${observation.screenedUnionKeys.size} CELL(S) SEEN BY AT LEAST ONE OBSERVER`);
    }

    // Concealment (OCOKA 7, docs/ROUTE_INTELLIGENCE.md §47) — only ever
    // computed once `observation` is real: defilade only means something
    // relative to specified positions (the same painted observers), and
    // dead ground is a set complement over `observation`'s own union, not a
    // second trace (see `concealment.ts`'s own header).
    concealment = buildConcealmentResult(grid.cells, observation);
    onLog?.(
      `CONCEALMENT — ${concealment.concealedKeys.size}/${concealment.cellsConsidered} CELL(S) CONCEALED FROM ` +
      `EVERY PAINTED OBSERVER (${concealment.deadGroundKeys.size} DEAD GROUND, ${concealment.vegetationConcealedKeys.size} BY VEGETATION)`
    );
  }

  onLog?.(`RESULT — ${reachableCount}/${grid.cells.length} CELLS REACHABLE · ${severelyRestrictedCount} SEVERELY RESTRICTED · ${restrictedCount} RESTRICTED`);
  onProgress(1);
  onStage?.({ key: 'done', label: 'Appreciation complete', fraction: 1 });

  return {
    results,
    bands,
    profile,
    usedEstimatedData: grid.usedEstimatedData,
    infrastructureAvailable: grid.infrastructureAvailable,
    hydrologyAvailable: grid.hydrologyAvailable,
    waterFeatures: grid.waterFeatures,
    roadWays: grid.roadWays,
    cellCount: grid.cells.length,
    reachableCount,
    severelyRestrictedCount,
    restrictedCount,
    path,
    roadRoute,
    usedExpandedSearch,
    searchAttempts: attemptsUsed,
    fidelity: grid.fidelity,
    targetCellCount: grid.targetCellCount,
    dissimilarRoutes,
    corridorField,
    optimiserCorridorField,
    ensemble,
    restrictionPlan,
    restrictedCorridorField,
    chokepoints,
    barrier,
    roadNetworkBarrier,
    keyTerrain,
    observation,
    concealment,
    cells: grid.cells,
    originKeys: grid.originKeys,
    objectiveKeys: grid.objectiveKeys,
    hexSize: grid.hexSize,
    proj: grid.proj,
  };
}
