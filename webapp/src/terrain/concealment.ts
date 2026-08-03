/**
 * Concealment — OCOKA 7 (docs/ROUTE_INTELLIGENCE.md §47, master_plan.md
 * "Next up"). Real, computed from two independent sources; COVER (protection
 * FROM FIRE) is not attempted here at all and never will be from this data —
 * see the module header's own honesty note below. Doctrine treats cover and
 * concealment as different things and this module refuses to blend them
 * into one score (root CLAUDE.md's OCOKA rules; docs §47's own framing).
 *
 * TWO INDEPENDENT SOURCES, both already-computed products re-used, not new
 * signal invented for this module:
 *
 *   1. **Dead ground (defilade), relative to specified positions.** Doctrine
 *      is explicit that defilade only means something relative to a
 *      position — this module computes it relative to whichever hexes were
 *      painted as OBSERVERS (the exact mechanism OCOKA 6 introduced,
 *      `viewshed.ts`). A cell is dead ground when it sits OUTSIDE the union
 *      of every painted observer's SCREENED visible set
 *      (`ObservationResult.screenedUnionKeys`) — i.e. no specified position
 *      can see it. This is a set complement over an already-computed field,
 *      not a second viewshed trace: OCOKA 6's own output already answers
 *      "what can be seen"; dead ground is just "everything else".
 *   2. **Concealment from vegetation structure.** A cell whose own
 *      vegetation stands tall enough to break line of sight offers
 *      concealment independent of terrain or of any particular observer —
 *      reuses `dataLayers/structureTable.ts`'s `SCREENING_HEIGHT_M` table
 *      OCOKA 6 already built (Specht 1970 / Muir 1977 NVIS structural height
 *      bands), at Muir's own "tall shrubland" threshold (>2 m) as the
 *      concealment cutoff — a stand shorter than that (grassland, low
 *      shrub) does not reliably break a standing person's silhouette.
 *
 * GATE: same as Observation (`oakoc.ts`'s own comment on
 * `OcokaObservationFactor`), NOT `result.path` — defilade only means
 * something relative to specified positions, so this factor is gated on
 * whether any observer was painted, independent of whether origin reached
 * objective. `buildConcealmentResult` is only ever called once an
 * `ObservationResult` already exists (`mobilityAppreciation.ts`).
 *
 * COVER IS NOT COMPUTED, FULL STOP. Protection from direct/indirect fire
 * needs to know what actually stops a projectile at a given point — a rock,
 * a bund, a building, a wall — none of which a bare-earth DEM or a 4-class
 * vegetation taxonomy can see. `coverAssessed: false` is not this module's
 * concern to flip; it lives on `OcokaCoverConcealmentFactor` in `oakoc.ts`
 * as a permanent, independent, machine-readable property, never touched by
 * anything in this file.
 */

import { MobilityGridCell } from './accumulatedCost';
import { ObservationResult } from './viewshed';
import { lookupScreeningHeight } from './dataLayers/structureTable';

/** Muir (1977) NVIS "tall shrubland" threshold (>2 m) — the same figure
 *  `structureTable.ts`'s `SCREENING_HEIGHT_M` rows are already benchmarked
 *  against (see that file's own citation). A stand at or above this height
 *  reliably breaks a standing person's silhouette; below it (grassland, low
 *  shrub) does not. */
const CONCEALMENT_HEIGHT_THRESHOLD_M = 2.0;

export interface ConcealmentResult {
  /** Cells outside every painted observer's SCREENED visible set — hidden
   *  from all specified positions by terrain (dead ground / defilade). */
  deadGroundKeys: Set<string>;
  /** Cells whose OWN vegetation offers concealment regardless of terrain or
   *  observer position — a property of the ground itself. */
  vegetationConcealedKeys: Set<string>;
  /** Union of the two — concealed from the specified positions EITHER by
   *  terrain or by vegetation. The headline figure. */
  concealedKeys: Set<string>;
  /** How many cells this result was computed over — informational, so a
   *  UI/export can report a real fraction rather than a bare count. */
  cellsConsidered: number;
}

/**
 * Assemble both concealment sources into one result. Pure re-derivation —
 * `observation` is already-computed (OCOKA 6), `cells` already-sampled;
 * this function performs one set complement and one threshold filter, no
 * new search or trace.
 */
export function buildConcealmentResult(
  cells: MobilityGridCell[],
  observation: ObservationResult
): ConcealmentResult {
  const deadGroundKeys = new Set(
    cells.filter(c => !observation.screenedUnionKeys.has(c.key)).map(c => c.key)
  );
  const vegetationConcealedKeys = new Set(
    cells.filter(c => lookupScreeningHeight(c.vegetation).heightM >= CONCEALMENT_HEIGHT_THRESHOLD_M).map(c => c.key)
  );
  const concealedKeys = new Set([...deadGroundKeys, ...vegetationConcealedKeys]);
  return { deadGroundKeys, vegetationConcealedKeys, concealedKeys, cellsConsidered: cells.length };
}
