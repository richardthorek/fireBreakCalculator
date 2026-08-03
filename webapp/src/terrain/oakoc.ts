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
 *   - **Key terrain, Observation & fields of fire, Cover & concealment** are
 *     the genuine gaps (§47.1) — OCOKA 4/6/7 respectively. They ship here as
 *     explicit `'not-assessed'` placeholders, not omitted, so a reader of the
 *     five-factor product sees all five factors named even where three are
 *     honestly empty. `fieldsOfFireAssessed`/`coverAssessed` are the exact
 *     machine-readable properties §47.2 requires once those factors exist —
 *     shipped `false` now costs nothing and means OCOKA 6/7 have nothing left
 *     to retrofit into export/briefing payloads later.
 *
 * `'not-assessed'` IS A FIRST-CLASS STATE, distinct from "assessed, found
 * nothing" (§47.1's closing note — conflating the two is the fabrication this
 * repo exists to prevent). Obstacles/Avenues use `result.path` — the single
 * cheapest origin→objective route — as the assessed/not-assessed gate,
 * because it is the exact condition `mobilityAppreciation.ts` already gates
 * the whole corridor/chokepoint/min-cut block on: no path means none of that
 * analysis ran at all, which is a different claim from "ran, and found no
 * obstacle/avenue worth reporting" (a real, legitimate outcome when `barrier`
 * or `corridorField` comes back null with `path` non-null).
 */

import { MobilityAppreciationResult } from './mobilityAppreciation';
import { CorridorField } from './corridorField';
import { MinCutResult, RoadMinCutResult } from './minCutBarrier';
import { RestrictionPlan } from './restrictionPlanner';
import { ChokepointCell } from './corridorAnalysis';

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

/** OCOKA 4 (docs §47.1) — candidates ~90% computable from chokepoint/min-cut
 *  machinery already in hand; not yet assembled into a scored, named list. */
export interface OcokaKeyTerrainFactor {
  state: 'not-assessed';
  note: string;
}

/** OCOKA 6 (docs §47.1/§47.2) — needs `viewshed.ts`, not yet built.
 *  `fieldsOfFireAssessed` is the exact machine-readable flag §47.2 requires
 *  once ranges are user-stated; always `false` until OCOKA 6 ships. */
export interface OcokaObservationFactor {
  state: 'not-assessed';
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
      state: 'not-assessed',
      note: 'Key terrain is not yet built (OCOKA 4). Candidates are ~90% computable from the ' +
        'chokepoint and min-cut analysis above, scored by the change each makes when denied — ' +
        'not yet assembled into a named, scored list.',
    },
    observationAndFieldsOfFire: {
      state: 'not-assessed',
      fieldsOfFireAssessed: false,
      note: 'Observation and fields of fire are not yet built (OCOKA 6) — needs a line-of-sight ' +
        'model over the sampled grid. Fields of fire will only ever be computed for a ' +
        'user-stated effective range; a weapon or sensor is never inferred.',
    },
    coverAndConcealment: {
      state: 'not-assessed',
      coverAssessed: false,
      note: 'Concealment is not yet built (OCOKA 7). Cover is not computed at all and will not ' +
        'be: the elevation model is a bare-earth DEM, which cannot see a rock, bund or building.',
    },
  };
}
