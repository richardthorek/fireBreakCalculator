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
  buildMobilityGrid, MobilityGridResult, originObjectiveDistanceM, frontierTouchedEdges, growBoundsTowardFrontier,
  MobilityFidelity, DEFAULT_MOBILITY_FIDELITY, minDetourPadM,
} from './mobilityGrid';
import { InfrastructureTrail } from '../utils/infrastructureService';
import { LocalProjection } from '../utils/hexGrid';
import { PaintedArea } from './paintedArea';
import { runMobilitySearchInWorker, runMovementEnsembleInWorker } from './mobilityWorkerClient';
import { MovementEnsembleResult, DEFAULT_BEHAVIOUR_SPREAD_ID, DEFAULT_MOVEMENT_SIM_SEED } from './movementSimulation';
import { RestrictionPlan } from './restrictionPlanner';
import {
  MobilityCellResult, IsochroneBand, buildIsochroneBands, DEFAULT_ISOCHRONE_MINUTES,
  MobilityGridCell, assembleMobilityResults,
} from './accumulatedCost';
import { getMoverProfile, MoverProfile } from './moverProfiles';
import { setRoadSpeedOverrides, RoadSpeedOverrides } from './roadSpeedModel';
import { findVehicleRoadRoute, roadRouteToDissimilarRoute, RoadRouteSearchResult } from './roadRouteSearch';
import { SimPathNode } from './mobilityWorker';
import { computeChokepoints, DissimilarRoute, ChokepointCell } from './corridorAnalysis';
import { computeMinCutBarrier, MinCutResult } from './minCutBarrier';
import {
  buildCorridorField, CorridorField, DEFAULT_CORRIDOR_ROUTE_COUNT, ensembleTracksToRoutes,
} from './corridorField';

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
  noGoCount: number;
  slowGoCount: number;
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
  /** docs §35 — true when the hex-grid search needed more than one attempt
   *  (a wider `boundsPadFactor` retry) to find a route, or to conclude there
   *  genuinely isn't one. False means the very first, smallest-padding
   *  attempt already settled it. */
  usedExpandedSearch: boolean;
  /** How many `boundsPadFactor` attempts this run actually made (1..6). */
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
  key: 'grid' | 'sampling' | 'search' | 'ensemble' | 'corridors' | 'chokepoints' | 'barrier' | 'restrictions' | 'done';
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
   *  Governs `buildMobilityGrid`'s cell budget on every attempt (initial AND
   *  targeted retries); does not change the retry count/growth behaviour
   *  itself. */
  fidelity?: MobilityFidelity;
}

export async function runMobilityAppreciation(
  origin: PaintedArea,
  objective: PaintedArea,
  options: MobilityAppreciationOptions
): Promise<MobilityAppreciationResult | null> {
  const {
    profileId, nightMode = false, signal, onProgress: onProgressRaw, onLog, onStage, onPreviewCells, onPartialResult,
    moverCount = 240,
    behaviourSpreadId = DEFAULT_BEHAVIOUR_SPREAD_ID,
    simulationSeed = DEFAULT_MOVEMENT_SIM_SEED,
    planRestrictions = true,
    roadSpeedOverrides,
    fidelity = DEFAULT_MOBILITY_FIDELITY,
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

  // docs §35 — the Lake George defect, and its full fix (2026-07-27,
  // confirmed live against the real Lake George: a first, uniform-only-pad
  // fix still fell short). Owner, after watching that: "I think we need
  // both, a large uniform box covering the origin and destination and then
  // the ability to extend out when we hit edges. We need enough padding so
  // the algorithm can identify the best routes and thus the handful of
  // possible corridors for movement." Two things compose:
  //
  //  1. INITIAL PASS — a generous uniform box, sized off the REAL distance
  //     between origin and objective (`computePaddedBounds`), not either
  //     axis's own incidental span (the earlier bug: a due-east crossing has
  //     almost no north–south span of its own, so padding stayed near-zero
  //     regardless of multiplier). Generous on purpose, per the owner's own
  //     "enough padding to identify a HANDFUL of corridors" requirement, not
  //     just the single cheapest thread through.
  //  2. TARGETED RETRY — if that still finds no route, `frontierTouchedEdges`
  //     reads back WHICH side of the box the reachable frontier actually hit
  //     (genuinely stopped by running out of box, not by terrain), and
  //     `growBoundsTowardFrontier` extends specifically that side for the
  //     next attempt — owner: "if it still hits the edge then it loads a new
  //     [area] from the point of where it hit. Repeat until we get there."
  //     An edge the frontier never reached gains nothing from being pushed
  //     further out, so retries stay targeted instead of an ever-larger
  //     uniform square burning resolution in directions that were never
  //     going to help.
  const INITIAL_PAD_FACTOR = 0.3;
  const MAX_ATTEMPTS = 6;
  const spanM = originObjectiveDistanceM(origin, objective) ?? 1000;

  let grid: MobilityGridResult | null = null;
  let results: MobilityCellResult[] = [];
  let path: SimPathNode[] | null = null;
  let attemptsUsed = 0;
  let noEdgeTouchedStreak = 0; // consecutive attempts genuinely terrain-blocked, not box-limited

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attemptsUsed = i + 1;
    let samplingAnnounced = false;

    const buildOptions: Parameters<typeof buildMobilityGrid>[2] = { signal, fidelity };
    if (grid) {
      // Targeted growth from the PREVIOUS attempt's own box + where its
      // frontier actually got to — not a fresh symmetric box.
      const edges = frontierTouchedEdges({ boundsSw: grid.boundsSw, boundsNe: grid.boundsNe }, results);
      buildOptions.explicitBounds = growBoundsTowardFrontier(
        { boundsSw: grid.boundsSw, boundsNe: grid.boundsNe }, edges, spanM * 0.3
      );
    } else {
      buildOptions.boundsPadFactor = INITIAL_PAD_FACTOR;
      // Profile-scaled detour floor (docs §35 addendum, 2026-07-28 — owner:
      // a 1-2 km hill crossing never considered an equally short detour 1-2
      // km north/south, because the proportional pad above is a fraction of
      // a SHORT direct span and so stays short itself). Only binds on the
      // first attempt — retries already grow from the real search frontier.
      buildOptions.minDetourPadM = minDetourPadM(profile);
    }
    // Sampling owns the first 40% of the run's progress bar; the search
    // that follows now reports its OWN real progress (§35 addendum,
    // 2026-07-27 — see `runAccumulatedCostSearch`'s `onProgress`) into the
    // next 15%, rather than the two of them sharing one silent jump the way
    // they used to. The `onProgress` wrapper above is monotonic, so a RETRY's
    // sampling replaying this same 0..0.40 mapping from its own zero cannot
    // visibly rewind the bar — it just holds at the prior high-water mark
    // until this attempt's real progress catches back up past it.
    buildOptions.onProgress = f => {
      onProgress((f / 0.7) * 0.40);
      // buildMobilityGrid's own 0.05 mark is where hex layout ends and the
      // elevation/vegetation/trail sampling begins — the long part.
      if (f > 0.05 && !samplingAnnounced) {
        samplingAnnounced = true;
        onStage?.({
          key: 'sampling',
          label: i === 0 ? 'Sampling ground — elevation, vegetation, trails' : `Widening the search (attempt ${attemptsUsed}) — resampling`,
          fraction: (f / 0.7) * 0.40,
        });
      }
    };

    const attemptGrid = await buildMobilityGrid(origin, objective, buildOptions);
    if (signal?.aborted) return null;
    if (!attemptGrid) {
      // Degenerate span (near-identical origin/objective points) — no amount
      // of padding fixes this, so there is nothing to gain from retrying.
      if (i === 0) onLog?.('AOI TOO SMALL OR DEGENERATE — ABORTED');
      return null;
    }
    grid = attemptGrid;

    if (i === 0) {
      onLog?.(
        `SAMPLING ${grid.cells.length} CELLS (${fidelity.toUpperCase()} FIDELITY, TARGET ${grid.targetCellCount}) · ` +
        `ORIGIN SEED SET ${grid.originKeys.length} CELLS`
      );
    } else {
      // docs §35 — the targeted-retry response to the Lake George defect: a
      // search that found no route tries again, extended specifically
      // toward whichever edge its own frontier actually reached, rather
      // than concluding "no route" from a box that was never allowed to
      // look far enough. Logged plainly so this is visible, not silent.
      onLog?.(
        `NO ROUTE AT THE PREVIOUS EXTENT — WIDENING THE SEARCH TOWARD WHERE IT WAS STOPPED ` +
        `(ATTEMPT ${attemptsUsed}/${MAX_ATTEMPTS}, ${grid.cells.length} CELLS)`
      );
    }

    // Paint the surveyed ground NOW, before this attempt's search runs — the
    // same assembly the final render uses, with an empty reachability map.
    // On a retry this visibly redraws the WIDER area being surveyed.
    if (onPreviewCells) {
      onPreviewCells(assembleMobilityResults(grid.cells, grid.hexSize, grid.proj, new Map(), profile));
    }

    onProgress(0.40);
    onStage?.({
      key: 'search',
      label: i === 0 ? 'Running multi-source search across the grid' : `Re-running search at wider extent (attempt ${attemptsUsed})`,
      fraction: 0.40,
    });
    if (i === 0) onLog?.(`RUNNING MULTI-SOURCE SEARCH — ${profile.label.toUpperCase()}${nightMode ? ' · NIGHT' : ''}…`);

    // Real, incremental progress through the Dijkstra field build (§35
    // addendum, 2026-07-27) — this call previously reported NOTHING while it
    // ran, the single largest silent stretch in the whole run (owner: "the
    // 'progress' indicator stopped well before the result loaded in with a
    // long 'nothing' time"). `settledFraction` is how much of the grid has
    // actually been reached so far, not decorative motion.
    const outcome = await runMobilitySearchInWorker(
      grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode,
      roadSpeedOverrides,
      settledFraction => onProgress(0.40 + settledFraction * 0.15)
    );
    if (signal?.aborted) return null;
    results = outcome.results;
    path = outcome.path;

    if (path) break; // found it — stop expanding, this is the decisive attempt

    // Two consecutive attempts where the frontier never even reached an
    // edge (blocked by terrain everywhere it could reach, not by running
    // out of box) is real evidence of a genuine enclosure — stop early
    // rather than spending the remaining attempts on growth that has
    // already shown it isn't the limiting factor.
    const edgesThisAttempt = frontierTouchedEdges({ boundsSw: grid.boundsSw, boundsNe: grid.boundsNe }, results);
    const touchedAny = edgesThisAttempt.north || edgesThisAttempt.south || edgesThisAttempt.east || edgesThisAttempt.west;
    noEdgeTouchedStreak = touchedAny ? 0 : noEdgeTouchedStreak + 1;
    if (noEdgeTouchedStreak >= 2) break;
  }
  if (!grid) return null; // unreachable (the loop above always assigns or returns), keeps TS satisfied
  onProgress(0.55);

  const usedExpandedSearch = attemptsUsed > 1;
  if (grid.usedEstimatedData) onLog?.('CAUTION — ONE OR MORE SAMPLES ARE ESTIMATED/FALLBACK DATA (TIER 0)');
  if (!grid.infrastructureAvailable) onLog?.('TRAIL DATA UNAVAILABLE FOR THIS AREA — ROUTING ON TERRAIN + FUEL ONLY');
  // Hydrology (docs §34) — a real, computed count, not a claim: this is what
  // makes "is water actually being considered" answerable by looking at the
  // log rather than taking the model's word for it. Reported for the FINAL
  // (decisive) grid, since a retry resamples a different box.
  if (!grid.hydrologyAvailable) {
    onLog?.('NO WATERWAY/WATER-BODY DATA FOR THIS AREA — HYDROLOGY GATE INACTIVE');
  } else {
    const waterCellCount = grid.cells.filter(
      c => c.inWaterBody || c.nearestWaterwayKind !== null || (c.waterFrequency !== null && c.waterFrequency >= 0.15)
    ).length;
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
  }

  // Converted once, up front, so BOTH the movement ensemble (as a per-step
  // tie-break bias, docs §42 follow-on) and the corridor/chokepoint fusion
  // below (docs §42) can use the identical resolved route — never two
  // independent conversions that could drift apart.
  const roadRouteAsDissimilar = roadRoute ? roadRouteToDissimilarRoute(roadRoute, grid.cells) : null;

  const bands = buildIsochroneBands(results, DEFAULT_ISOCHRONE_MINUTES);
  const reachableCount = results.filter(r => isFinite(r.timeSeconds)).length;
  const noGoCount = results.filter(r => r.trafficability === 'NO-GO').length;
  const slowGoCount = results.filter(r => r.trafficability === 'SLOW-GO').length;

  const fastestBand = bands.find(b => b.cells.length > 0);
  if (fastestBand) {
    onLog?.(`FIRST ARRIVALS WITHIN ${fastestBand.thresholdMinutes} MIN — ${fastestBand.cells.length} CELLS`);
  }
  if (path) {
    const etaMin = path[path.length - 1].cumulativeSeconds / 60;
    onLog?.(
      `ROUTE FOUND — ${path.length} WAYPOINTS · ETA ${etaMin.toFixed(0)} MIN` +
      (usedExpandedSearch ? ` (NEEDED ${attemptsUsed} ATTEMPTS, FINAL PADDING ${grid.boundsPadFactor}×)` : '')
    );
  } else {
    onLog?.(
      `NO ROUTE FOUND AFTER ${attemptsUsed} ATTEMPT(S), UP TO ${grid.boundsPadFactor}× PADDING ` +
      `(${grid.cells.length} CELLS AT WIDEST) — OBJECTIVE GENUINELY UNREACHABLE FOR THIS PROFILE AT THIS SEARCH CEILING, ` +
      `NOT A BOX ARTEFACT AT THIS POINT`
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
    reachableCount, noGoCount, slowGoCount,
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
    cells: grid.cells,
    originKeys: grid.originKeys,
    objectiveKeys: grid.objectiveKeys,
    hexSize: grid.hexSize,
    proj: grid.proj,
  });

  // --- Pass 2 + the simulation (docs §32): corridors, chokepoints, min-cut
  // barrier. Everything except the ensemble/restriction work runs on the main
  // thread — cheap at this grid size relative to the sampling already done.
  let dissimilarRoutes: DissimilarRoute[] = [];
  let chokepoints: ChokepointCell[] = [];
  let barrier: MinCutResult | null = null;
  let corridorField: CorridorField | null = null;
  let optimiserCorridorField: CorridorField | null = null;
  let ensemble: MovementEnsembleResult | null = null;
  let restrictionPlan: RestrictionPlan | null = null;
  let restrictedCorridorField: CorridorField | null = null;
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
      corridorField = buildCorridorField(
        grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode, grid.hexSize, grid.proj,
        {
          routesOverride: roadRouteAsDissimilar ? [...ensembleRoutes, roadRouteAsDissimilar] : ensembleRoutes,
          evidence: 'simulated-movers',
          weightByAttractiveness: false,
        }
      );
    }

    // The optimiser view is still computed: chokepoints and the min-cut below
    // are graph properties of the ROUTE set, and comparing "best routes" with
    // "what movers did" is itself informative.
    onLog?.(`DERIVING UP TO ${DEFAULT_CORRIDOR_ROUTE_COUNT} DISTINCT OPTIMAL ROUTES FOR COMPARISON…`);
    optimiserCorridorField = buildCorridorField(
      grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode, grid.hexSize, grid.proj
    );
    // Re-cluster once more with the real road route folded in, so it counts
    // as its own avenue (or merges into an existing one, if it's genuinely
    // the same ground) rather than being invisible to chokepoint/corridor
    // analysis. Only pays this second (cheap — same small route-set
    // clustering, not a grid search) pass when there's actually a road route
    // to add.
    if (roadRouteAsDissimilar && optimiserCorridorField) {
      onLog?.('FOLDING THE REAL ROAD-NETWORK ROUTE INTO CORRIDOR/CHOKEPOINT ANALYSIS AS A KNOWN-GOOD AVENUE…');
      optimiserCorridorField = buildCorridorField(
        grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode, grid.hexSize, grid.proj,
        { routesOverride: [...optimiserCorridorField.routes, roadRouteAsDissimilar] }
      ) ?? optimiserCorridorField;
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
      for (const c of corridorField.corridors.slice(0, 4)) {
        onLog?.(
          `CORRIDOR ${c.rank} — ${Math.round(c.shareOfRoutes * 100)}% OF ${evidenceLabel} · ${c.easeClass.toUpperCase()} · ` +
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
        restrictedCorridorField = buildCorridorField(
          grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode, grid.hexSize, grid.proj,
          {
            routesOverride: ensembleTracksToRoutes(restrictionPlan.scenario.tracks, grid.cells),
            evidence: 'simulated-movers',
            weightByAttractiveness: false,
          }
        );
      }
    }

    onStage?.({ key: 'chokepoints', label: 'Finding the ground every route funnels through', fraction: 0.97 });
    chokepoints = computeChokepoints(grid.cells, grid.hexSize, grid.proj, dissimilarRoutes).slice(0, 12);
    if (chokepoints.length > 0) {
      onLog?.(`TOP CHOKEPOINT CROSSED BY ${chokepoints[0].passCount}/${dissimilarRoutes.length} ROUTES`);
    }

    onProgress(0.98);
    onStage?.({ key: 'barrier', label: 'Siting the cheapest severing cut', fraction: 0.98 });
    onLog?.('SITING CHEAPEST SEVERING CUT (MAX-FLOW/MIN-CUT)…');
    barrier = computeMinCutBarrier(grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode);
    if (barrier) {
      onLog?.(`MIN-CUT — ${barrier.segments.length} SEGMENT(S), CUT VALUE ${barrier.cutValue.toFixed(0)} (UNIT/ROAD-CLASS-WEIGHTED, NOT YET REAL VEHICLE CAPACITY)`);
    } else {
      onLog?.('MIN-CUT SKIPPED — NO SEPARATING CUT NEEDED OR FOUND');
    }
  }

  onLog?.(`RESULT — ${reachableCount}/${grid.cells.length} CELLS REACHABLE · ${noGoCount} NO-GO · ${slowGoCount} SLOW-GO`);
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
    noGoCount,
    slowGoCount,
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
    cells: grid.cells,
    originKeys: grid.originKeys,
    objectiveKeys: grid.objectiveKeys,
    hexSize: grid.hexSize,
    proj: grid.proj,
  };
}
