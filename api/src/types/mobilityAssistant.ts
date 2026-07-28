/**
 * Distilled payload for the Terrain Mobility & Counter-Mobility assistant
 * endpoint — the mobility-mode counterpart to `assistant.ts`'s
 * `AssistantPayload`. Same design rule: compact, prompt-sized, and every
 * field in it is a value `validateGroundedResponse` can verify a model
 * response against (see `aiGrounding.ts` — it operates on any payload shape,
 * not just the fire-break one).
 */

export interface MobilityCorridorSummary {
  rank: number;
  easeClass: string;
  routeCount: number;
  routeTotal: number;
  medianTravelMin: number;
  bottleneckWidthM: number;
  bottleneckAbreast: number;
  frontage: string;
  goFractionPct: number;
}

export interface MobilityPlacementSummary {
  measureId: string;
  measureLabel: string;
  delayImposedMin: number;
  /** null only when the objective was unreachable even at baseline — the
   *  bypass question was genuinely meaningless, not merely expensive (mirrors
   *  `DelayLedgerEntry.bypassDelaySeconds`'s own contract). */
  bypassDelayMin: number | null;
  egressSafe: boolean;
}

export interface MobilityAssistantPayload {
  moverProfileLabel: string;
  moverProfileConfidence: string;
  nightMode: boolean;
  cellCount: number;
  reachableCount: number;
  noGoCount: number;
  slowGoCount: number;
  /** True when any sampled cell used estimated/fallback data. */
  estimatedData: boolean;
  /** True when the AOI does not canalise movement — corridors/chokepoints
   *  are a weak description of it (see corridorField.ts's own module note). */
  unconstrained: boolean;
  /** Corridor bands' share of the sampled AOI, 0-100. */
  coveragePercent: number;
  /** Top corridors by weighted movement carried, most first. */
  topCorridors: MobilityCorridorSummary[];
  chokepointCount: number;
  topChokepointPassCount: number | null;
  barrierSegmentCount: number | null;
  barrierCutValue: number | null;
  /** Proposed counter-measures already scored against the delay ledger. */
  placements: MobilityPlacementSummary[];

  // --- Probabilistic movement (webapp docs §32) ------------------------------
  // All optional so an older client's payload still validates: these fields
  // arrived after the endpoint shipped, and the contract's own rule is that a
  // missing figure is reported as missing, never defaulted into a number.
  /** What the corridor counts above are counts OF. 'simulated-movers' means a
   *  behaviour model with ASSUMED parameters produced them — the narration
   *  must say so rather than presenting them as measured or optimal. */
  corridorEvidence?: 'optimiser-routes' | 'simulated-movers';
  movement?: MobilityMovementSummary;
  restrictions?: MobilityRestrictionSummary[];
  restrictionEffect?: MobilityRestrictionEffectSummary;
}

/** The unrestricted movement ensemble, as a distribution rather than one ETA. */
export interface MobilityMovementSummary {
  moverCount: number;
  arrivedPercent: number;
  medianMin: number | null;
  p10Min: number | null;
  p90Min: number | null;
  /** Share of simulated movement off the road/trail network, 0-100. */
  crossCountryPercent: number;
  /** The optimiser's single best route, for comparison. */
  optimalMin: number | null;
  behaviourSpread: string;
}

export interface MobilityRestrictionSummary {
  rank: number;
  kind: string;
  transitPercent: number;
  marginalDelayMin: number;
  cumulativeDelayMin: number;
  arrivedPercentAfter: number;
}

export interface MobilityRestrictionEffectSummary {
  baselineMedianMin: number | null;
  scenarioMedianMin: number | null;
  baselineArrivedPercent: number;
  scenarioArrivedPercent: number;
  baselineCrossCountryPercent: number;
  scenarioCrossCountryPercent: number;
  bypassNote: string | null;
}

function isFiniteNumber(v: any): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function isCorridorSummary(v: any): v is MobilityCorridorSummary {
  return (
    v &&
    isFiniteNumber(v.rank) &&
    typeof v.easeClass === 'string' &&
    isFiniteNumber(v.routeCount) &&
    isFiniteNumber(v.routeTotal) &&
    isFiniteNumber(v.medianTravelMin) &&
    isFiniteNumber(v.bottleneckWidthM) &&
    isFiniteNumber(v.bottleneckAbreast) &&
    typeof v.frontage === 'string' &&
    isFiniteNumber(v.goFractionPct)
  );
}

function isPlacementSummary(v: any): v is MobilityPlacementSummary {
  return (
    v &&
    typeof v.measureId === 'string' &&
    typeof v.measureLabel === 'string' &&
    isFiniteNumber(v.delayImposedMin) &&
    (v.bypassDelayMin === null || isFiniteNumber(v.bypassDelayMin)) &&
    typeof v.egressSafe === 'boolean'
  );
}

/**
 * Validates the full shape, including array elements — this is a public,
 * anonymous HTTP endpoint (`assistantMobilityBriefing.ts`), so the request
 * body is untrusted input at a system boundary, same rule as
 * `isAssistantPayload` in `assistant.ts`.
 */
export function isMobilityAssistantPayload(v: any): v is MobilityAssistantPayload {
  return !!(
    v &&
    typeof v.moverProfileLabel === 'string' &&
    typeof v.moverProfileConfidence === 'string' &&
    typeof v.nightMode === 'boolean' &&
    isFiniteNumber(v.cellCount) &&
    isFiniteNumber(v.reachableCount) &&
    isFiniteNumber(v.noGoCount) &&
    isFiniteNumber(v.slowGoCount) &&
    typeof v.estimatedData === 'boolean' &&
    typeof v.unconstrained === 'boolean' &&
    isFiniteNumber(v.coveragePercent) &&
    Array.isArray(v.topCorridors) &&
    v.topCorridors.every(isCorridorSummary) &&
    isFiniteNumber(v.chokepointCount) &&
    (v.topChokepointPassCount === null || isFiniteNumber(v.topChokepointPassCount)) &&
    (v.barrierSegmentCount === null || isFiniteNumber(v.barrierSegmentCount)) &&
    (v.barrierCutValue === null || isFiniteNumber(v.barrierCutValue)) &&
    Array.isArray(v.placements) &&
    v.placements.every(isPlacementSummary) &&
    // Optional blocks: absent is valid; present must be well-formed. Anything
    // half-formed is rejected rather than partially narrated.
    (v.corridorEvidence === undefined || v.corridorEvidence === 'optimiser-routes' || v.corridorEvidence === 'simulated-movers') &&
    (v.movement === undefined || isMovementSummary(v.movement)) &&
    (v.restrictions === undefined || (Array.isArray(v.restrictions) && v.restrictions.every(isRestrictionSummary))) &&
    (v.restrictionEffect === undefined || isRestrictionEffectSummary(v.restrictionEffect))
  );
}

function isNullableFiniteNumber(v: any): boolean {
  return v === null || isFiniteNumber(v);
}

function isMovementSummary(v: any): boolean {
  return !!(
    v &&
    isFiniteNumber(v.moverCount) &&
    isFiniteNumber(v.arrivedPercent) &&
    isNullableFiniteNumber(v.medianMin) &&
    isNullableFiniteNumber(v.p10Min) &&
    isNullableFiniteNumber(v.p90Min) &&
    isFiniteNumber(v.crossCountryPercent) &&
    isNullableFiniteNumber(v.optimalMin) &&
    typeof v.behaviourSpread === 'string'
  );
}

function isRestrictionSummary(v: any): boolean {
  return !!(
    v &&
    isFiniteNumber(v.rank) &&
    typeof v.kind === 'string' &&
    isFiniteNumber(v.transitPercent) &&
    isFiniteNumber(v.marginalDelayMin) &&
    isFiniteNumber(v.cumulativeDelayMin) &&
    isFiniteNumber(v.arrivedPercentAfter)
  );
}

function isRestrictionEffectSummary(v: any): boolean {
  return !!(
    v &&
    isNullableFiniteNumber(v.baselineMedianMin) &&
    isNullableFiniteNumber(v.scenarioMedianMin) &&
    isFiniteNumber(v.baselineArrivedPercent) &&
    isFiniteNumber(v.scenarioArrivedPercent) &&
    isFiniteNumber(v.baselineCrossCountryPercent) &&
    isFiniteNumber(v.scenarioCrossCountryPercent) &&
    (v.bypassNote === null || typeof v.bypassNote === 'string')
  );
}
