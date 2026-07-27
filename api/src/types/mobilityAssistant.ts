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
    v.placements.every(isPlacementSummary)
  );
}
