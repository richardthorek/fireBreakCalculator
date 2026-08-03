/**
 * OCOKA five-factor assembly (OCOKA 3, docs/ROUTE_INTELLIGENCE.md §47.1/§47.2,
 * master_plan.md "Next up" — OCOKA programme). Observation and fields of
 * fire · Cover and concealment · Obstacles · Key terrain · Avenues of
 * approach, the terrain-appreciation vocabulary the Australian Army currently
 * teaches (§47.0 — corrected from an initial, wrong US-doctrine read).
 *
 * ASSEMBLY ONLY. This module computes almost nothing new — it re-labels and
 * re-groups products a run already produced under the OCOKA vocabulary, so
 * the analysis reads as one recognised terrain appreciation instead of a list
 * of bespoke analytics (§47.1's audit):
 *
 *   - **Obstacles** were already computed, just unnamed: EXISTING (natural +
 *     cultural terrain barriers the ground itself presents) is `barrier`
 *     (hex min-cut) and, for vehicle profiles with connected road data,
 *     `roadNetworkBarrier` (the road-network-exact min-cut) — both severing
 *     cuts derived FROM the terrain, never emplaced. REINFORCING (deliberately
 *     emplaced counter-mobility measures) is `restrictionPlan` — each
 *     recommendation there is already a real re-run of the movement ensemble
 *     with a candidate block in place (restrictionPlanner.ts), not a formula.
 *     User-PLACED measures (as opposed to recommended ones) stay in
 *     `CounterMobilityPanel.tsx`/`delayLedger.ts`, which already owns that
 *     job — duplicating them here would be a second, divergent obstacle list.
 *   - **Avenues of approach** were already computed as `corridorField` (and,
 *     once a restriction plan ran, `restrictedCorridorField` for "where they
 *     go once denied"). Doctrine distinguishes a mobility corridor (this
 *     product's `Corridor`) from an avenue of approach, which GROUPS mutually
 *     supporting corridors — deliberately **not built here**: grouping
 *     corridors honestly needs a real adjacency/support test, which is new
 *     computation this stage doesn't do. Until that lands, each corridor is
 *     presented directly as its own avenue-equivalent band, which is the
 *     conservative reading (never claims two corridors support each other
 *     when that hasn't been tested).
 *   - **Key terrain** (OCOKA 4, docs §47.1) is now real: `terrain/keyTerrain.ts`
 *     nominates candidates from the chokepoint/min-cut/corridor-bottleneck
 *     machinery above and scores each by a real re-run with that ground
 *     denied. This module still only assembles — it re-labels
 *     `MobilityAppreciationResult.keyTerrain` under the OCOKA factor shape,
 *     same as every other factor here. See `OcokaKeyTerrainFactor` below for
 *     the two-reason-for-null subtlety this factor carries that
 *     Obstacles/Avenues don't.
 *   - **Observation** (OCOKA 6, docs §47.1) is now real: `terrain/viewshed.ts`
 *     traces real line-of-sight from every painted observer hex. Its
 *     `state` gate is deliberately DIFFERENT from every other factor here —
 *     not `result.path`, but simply whether an observer was painted at all
 *     (viewshed never depended on origin reaching objective). Fields of fire
 *     — a weapon/sensor-range-bound relevance question layered on top of raw
 *     visibility — remains the one genuine gap within this factor:
 *     `fieldsOfFireAssessed` stays `false` until a future stage collects a
 *     user-stated effective range.
 *   - **Cover & concealment** is the remaining genuine gap (§47.1) — OCOKA 7.
 *     It ships here as an explicit `'not-assessed'` placeholder, not omitted,
 *     so a reader of the five-factor product sees all five factors named
 *     even where one is honestly empty. `coverAssessed` is the exact
 *     machine-readable property §47.2 requires once that factor exists —
 *     shipped `false` now costs nothing and means OCOKA 7 has nothing left
 *     to retrofit into export/briefing payloads later.
 *
 * `'not-assessed'` IS A FIRST-CLASS STATE, distinct from "assessed, found
 * nothing" (§47.1's closing note — conflating the two is the fabrication this
 * repo exists to prevent). Obstacles/Avenues/Key terrain use `result.path` —
 * the single cheapest origin→objective route — as the assessed/not-assessed
 * gate, because it is the exact condition `mobilityAppreciation.ts` already
 * gates the whole corridor/chokepoint/min-cut block (and, downstream of it,
 * key terrain scoring) on: no path means none of that analysis ran at all,
 * which is a different claim from "ran, and found no obstacle/avenue/key
 * terrain candidate worth reporting" (a real, legitimate outcome when
 * `barrier`, `corridorField` or `keyTerrain` comes back null/empty with
 * `path` non-null — for key terrain specifically, a path existed but the
 * chokepoint/min-cut/corridor-bottleneck machinery nominated zero candidates
 * to score, a genuinely rare but honest case over very open terrain).
 * Observation is the one factor that does NOT use this gate — see
 * `OcokaObservationFactor`'s own doc comment for why its `state` is keyed on
 * whether an observer was painted, not on `path`.
 */

import { MobilityAppreciationResult } from './mobilityAppreciation';
import { CorridorField } from './corridorField';
import { MinCutResult, RoadMinCutResult } from './minCutBarrier';
import { RestrictionPlan } from './restrictionPlanner';
import { ChokepointCell } from './corridorAnalysis';
import { KeyTerrainResult } from './keyTerrain';
import { ObservationResult } from './viewshed';

export type OcokaAssessmentState = 'assessed' | 'not-assessed';

export interface OcokaObstaclesFactor {
  state: OcokaAssessmentState;
  existing: {
    /** Hex-grid min-cut — the cheapest severing cut over cross-country
     *  ground, null when nothing needed severing (a real finding, only
     *  possible when `state` is `'assessed'`). */
    barrier: MinCutResult | null;
    /** Road-network-exact min-cut (docs §42b) — vehicle profiles only, null
     *  when no road data connected both painted areas or nothing on the
     *  network needed severing. */
    roadNetworkBarrier: RoadMinCutResult | null;
    /** Betweenness-ranked cells every analysed route funnels through — the
     *  ground existing obstacles are sited against. */
    chokepoints: ChokepointCell[];
  };
  reinforcing: {
    /** The recommended emplaced-measure set, each entry a real re-run of the
     *  movement ensemble with that block in place — not a formula. Null when
     *  no ensemble ran (same `state` gate) or the ensemble never produced
     *  candidates worth recommending. */
    plan: RestrictionPlan | null;
  };
}

export interface OcokaAvenuesOfApproachFactor {
  state: OcokaAssessmentState;
  /** The UNRESTRICTED movement picture — where movers actually go, or the
   *  optimiser's cheapest routes, over untouched ground. */
  unrestricted: CorridorField | null;
  /** The picture once the recommended reinforcing obstacles above are
   *  emplaced — "and this is where they go once those restrictions are in".
   *  Null when no restriction plan ran or none was worth recommending. */
  restricted: CorridorField | null;
}

/**
 * OCOKA 4 (docs §47.1) — scored key-terrain candidates from `terrain/keyTerrain.ts`.
 * Same `assessed`/`not-assessed` gate as Obstacles/Avenues (`result.path`), but
 * `result` can be `null` for TWO different reasons the panel must tell apart:
 *
 *   1. `state === 'not-assessed'` — the objective was unreachable, so the whole
 *      corridor/chokepoint/min-cut block never ran, and key terrain never had
 *      candidates to nominate from. Same "no analysis ran" claim Obstacles/
 *      Avenues make in their own `'not-assessed'` state — `result` is null here
 *      as a consequence, not a separate condition worth its own flag.
 *   2. `state === 'assessed'` with `result === null` — the objective WAS
 *      reachable and the worker DID run, but `generateKeyTerrainCandidates`
 *      nominated zero candidates from the chokepoint/min-cut/corridor-
 *      bottleneck machinery (`mobilityAppreciation.ts` skips the worker call
 *      entirely in that case rather than round-tripping an empty request).
 *      Genuinely rare — it takes very open terrain with no chokepoint,
 *      min-cut or corridor bottleneck worth naming — but a real, legitimate
 *      outcome, never rendered the same as reason 1 above. The renderer
 *      (`OakocPanel.tsx`) is what disambiguates: branch on `state`, then on
 *      `result === null` vs
 *      `result.candidates.length === 0`, never assume one implies the other.
 */
export interface OcokaKeyTerrainFactor {
  state: OcokaAssessmentState;
  result: KeyTerrainResult | null;
}

/**
 * OCOKA 6 (docs §47.1/§47.2) — real line-of-sight from painted observers
 * (`terrain/viewshed.ts`). UNLIKE Obstacles/Avenues/Key terrain, this
 * factor's `state` gate is NOT `result.path` — a viewshed never depended on
 * origin reaching objective, it is a standalone geometric trace from
 * whichever hexes were painted as observers. `state === 'not-assessed'`
 * here means "no observer was painted this run" — the ordinary case, since
 * Observation is optional additional analysis most runs don't add — never
 * "objective unreachable". `result` is only ever null when `state` is
 * `'not-assessed'`: no two-reason-for-null subtlety the way Key terrain has
 * (`OcokaKeyTerrainFactor`'s own comment), because viewshed has no separate
 * worker-wiring staging gap left to close.
 *
 * `fieldsOfFireAssessed` stays permanently `false` regardless of `state`:
 * fields of fire is a real, narrower, weapon/sensor-range-bound question
 * (`viewshed.ts`'s own header, point 2) this stage does not yet collect a
 * user-stated range for — a genuine remaining gap, tracked separately from
 * whether Observation itself ran this run.
 */
export interface OcokaObservationFactor {
  state: OcokaAssessmentState;
  result: ObservationResult | null;
  fieldsOfFireAssessed: false;
  note: string;
}

/** OCOKA 7 (docs §47.1/§47.2) — cover (protection from fire) cannot be
 *  computed from a bare-earth DEM at all; concealment needs vegetation
 *  structure + dead ground, not yet built. `coverAssessed` is the exact
 *  machine-readable flag §47.2 requires to survive leaving the app; always
 *  `false` until OCOKA 7 ships. */
export interface OcokaCoverConcealmentFactor {
  state: 'not-assessed';
  coverAssessed: false;
  note: string;
}

export interface OcokaAppreciation {
  obstacles: OcokaObstaclesFactor;
  avenuesOfApproach: OcokaAvenuesOfApproachFactor;
  keyTerrain: OcokaKeyTerrainFactor;
  observationAndFieldsOfFire: OcokaObservationFactor;
  coverAndConcealment: OcokaCoverConcealmentFactor;
}

/**
 * Re-present one completed `MobilityAppreciationResult` under the five OCOKA
 * factors. Pure assembly — every value here already exists on `result`; this
 * function only groups and labels it. See the module header for the
 * `state` gate and for what is deliberately NOT built yet.
 */
export function buildOcokaAppreciation(result: MobilityAppreciationResult): OcokaAppreciation {
  const assessed: OcokaAssessmentState = result.path !== null ? 'assessed' : 'not-assessed';

  return {
    obstacles: {
      state: assessed,
      existing: {
        barrier: result.barrier,
        roadNetworkBarrier: result.roadNetworkBarrier,
        chokepoints: result.chokepoints,
      },
      reinforcing: {
        plan: result.restrictionPlan,
      },
    },
    avenuesOfApproach: {
      state: assessed,
      unrestricted: result.corridorField,
      restricted: result.restrictedCorridorField,
    },
    keyTerrain: {
      state: assessed,
      // Same source, same reasoning, as `state` itself: when `assessed` is
      // 'not-assessed' the whole block never ran and `result.keyTerrain` is
      // null as a consequence; when `assessed` is 'assessed', a null here is
      // the separate, staging-only gap documented on `OcokaKeyTerrainFactor`
      // above — either way, passing the field straight through is honest,
      // because it never claims more than `mobilityAppreciation.ts` computed.
      result: result.keyTerrain,
    },
    observationAndFieldsOfFire: {
      state: result.observation !== null ? 'assessed' : 'not-assessed',
      result: result.observation,
      fieldsOfFireAssessed: false,
      note: result.observation !== null
        ? 'Fields of fire are not yet computed: that needs a user-stated effective range, which ' +
          'this stage does not yet collect. A weapon or sensor is never inferred.'
        : 'No observer was painted for this run — Observation is optional additional analysis, ' +
          'not gated on the origin/objective search. Paint an observer hex to see real line of ' +
          'sight from it. Fields of fire will only ever be computed for a user-stated effective ' +
          'range even once painted; a weapon or sensor is never inferred.',
    },
    coverAndConcealment: {
      state: 'not-assessed',
      coverAssessed: false,
      note: 'Concealment is not yet built (OCOKA 7). Cover is not computed at all and will not ' +
        'be: the elevation model is a bare-earth DEM, which cannot see a rock, bund or building.',
    },
  };
}
