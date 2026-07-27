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

import { buildMobilityGrid } from './mobilityGrid';
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
  cellCount: number;
  reachableCount: number;
  noGoCount: number;
  slowGoCount: number;
  /** The single cheapest origin→objective path this run found — what the
   *  unit-simulation animation follows (docs "Terrain Mobility &
   *  Counter-Mobility": null only if no objective cell was reachable). */
  path: SimPathNode[] | null;
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
}

export async function runMobilityAppreciation(
  origin: PaintedArea,
  objective: PaintedArea,
  options: MobilityAppreciationOptions
): Promise<MobilityAppreciationResult | null> {
  const {
    profileId, nightMode = false, signal, onProgress, onLog, onStage, onPreviewCells,
    moverCount = 240,
    behaviourSpreadId = DEFAULT_BEHAVIOUR_SPREAD_ID,
    simulationSeed = DEFAULT_MOVEMENT_SIM_SEED,
    planRestrictions = true,
  } = options;
  const profile = getMoverProfile(profileId);
  if (!profile) {
    onLog?.(`ERROR — unknown mover profile "${profileId}"`);
    return null;
  }

  onLog?.(`PROFILE ${profile.label.toUpperCase()} · ${profile.confidence.toUpperCase()} CONFIDENCE (${profile.source.slice(0, 72)}${profile.source.length > 72 ? '…' : ''})`);
  onLog?.('LAYING OUT SURVEY GRID OVER AREA OF INTEREST…');
  onStage?.({ key: 'grid', label: 'Laying out survey grid', fraction: 0 });

  let samplingAnnounced = false;
  const grid = await buildMobilityGrid(origin, objective, {
    signal,
    // Sampling owns the first 45% of the run's progress bar; the simulation
    // stages that follow are real work of comparable length, and a bar that
    // sat at 70% for most of the wall-clock time would be a worse lie than no
    // bar at all.
    onProgress: f => {
      onProgress?.((f / 0.7) * 0.45);
      // buildMobilityGrid's own 0.05 mark is where hex layout ends and the
      // elevation/vegetation/trail sampling begins — the long part.
      if (f > 0.05 && !samplingAnnounced) {
        samplingAnnounced = true;
        onStage?.({ key: 'sampling', label: 'Sampling ground — elevation, vegetation, trails', fraction: (f / 0.7) * 0.45 });
      }
    },
  });
  if (!grid || signal?.aborted) {
    if (grid === null) onLog?.('AOI TOO SMALL OR DEGENERATE — ABORTED');
    return null;
  }

  onLog?.(`SAMPLING ${grid.cells.length} CELLS · ORIGIN SEED SET ${grid.originKeys.length} CELLS`);
  if (grid.usedEstimatedData) onLog?.('CAUTION — ONE OR MORE SAMPLES ARE ESTIMATED/FALLBACK DATA (TIER 0)');
  if (!grid.infrastructureAvailable) onLog?.('TRAIL DATA UNAVAILABLE FOR THIS AREA — ROUTING ON TERRAIN + FUEL ONLY');
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

  // Paint the surveyed ground NOW, before the search runs. Same assembly the
  // final render uses, with an empty reachability map — so every cell shows
  // its real terrain classification and nothing shows an arrival time it has
  // not earned yet.
  if (onPreviewCells) {
    onPreviewCells(assembleMobilityResults(grid.cells, grid.hexSize, grid.proj, new Map(), profile));
  }

  onProgress?.(0.46);
  onStage?.({ key: 'search', label: 'Running multi-source search across the grid', fraction: 0.46 });
  onLog?.(`RUNNING MULTI-SOURCE SEARCH — ${profile.label.toUpperCase()}${nightMode ? ' · NIGHT' : ''}…`);

  const { results, path } = await runMobilitySearchInWorker(
    grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode
  );
  if (signal?.aborted) return null;
  onProgress?.(0.5);

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
    onLog?.(`ROUTE FOUND — ${path.length} WAYPOINTS · ETA ${etaMin.toFixed(0)} MIN`);
  } else {
    onLog?.('NO ROUTE FOUND — OBJECTIVE UNREACHABLE FOR THIS PROFILE');
  }

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
    onProgress?.(0.5);
    onStage?.({ key: 'ensemble', label: `Simulating ${moverCount} independent movers over untouched ground`, fraction: 0.5 });
    onLog?.(`SIMULATING ${moverCount} MOVERS — UNRESTRICTED MOVEMENT (BEHAVIOUR MODEL: ${behaviourSpreadId.toUpperCase()})…`);
    const movement = await runMovementEnsembleInWorker(
      grid.cells, grid.hexSize, grid.proj, grid.originKeys, grid.objectiveKeys, profileId, nightMode,
      {
        moverCount,
        spreadId: behaviourSpreadId,
        seed: simulationSeed,
        planRestrictions,
        onProgress: (f, phase) => {
          if (phase === 'ensemble') onProgress?.(0.5 + f * 0.18);
          else onProgress?.(0.75 + f * 0.22);
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

    onProgress?.(0.7);
    onStage?.({ key: 'corridors', label: 'Smoothing simulated movement into corridors', fraction: 0.7 });

    // Corridors from the SIMULATION where one exists, from the optimiser
    // otherwise. Both go through the identical pipeline, so the two views can
    // never drift into disagreeing about what a corridor is.
    if (ensemble && ensemble.tracks.length > 0) {
      corridorField = buildCorridorField(
        grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode, grid.hexSize, grid.proj,
        {
          routesOverride: ensembleTracksToRoutes(ensemble.tracks, grid.cells),
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

    onProgress?.(0.98);
    onStage?.({ key: 'barrier', label: 'Siting the cheapest severing cut', fraction: 0.98 });
    onLog?.('SITING CHEAPEST SEVERING CUT (MAX-FLOW/MIN-CUT)…');
    barrier = computeMinCutBarrier(grid.cells, grid.originKeys, grid.objectiveKeys, profile, nightMode);
    if (barrier) {
      onLog?.(`MIN-CUT — ${barrier.segments.length} SEGMENT(S), CUT VALUE ${barrier.cutValue.toFixed(0)} (UNIT/TRAIL-WEIGHTED, NOT YET REAL VEHICLE CAPACITY)`);
    } else {
      onLog?.('MIN-CUT SKIPPED — NO SEPARATING CUT NEEDED OR FOUND');
    }
  }

  onLog?.(`RESULT — ${reachableCount}/${grid.cells.length} CELLS REACHABLE · ${noGoCount} NO-GO · ${slowGoCount} SLOW-GO`);
  onProgress?.(1);
  onStage?.({ key: 'done', label: 'Appreciation complete', fraction: 1 });

  return {
    results,
    bands,
    profile,
    usedEstimatedData: grid.usedEstimatedData,
    infrastructureAvailable: grid.infrastructureAvailable,
    cellCount: grid.cells.length,
    reachableCount,
    noGoCount,
    slowGoCount,
    path,
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
