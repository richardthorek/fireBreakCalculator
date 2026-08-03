/**
 * Client + payload builder for the Terrain Mobility assistant endpoint
 * (`POST /api/assistant/mobility-briefing`) — the mobility-mode counterpart
 * to `assistantApi.ts`'s fire-break briefing. Reuses that module's
 * `postAssistant` fetch wrapper and `AssistantResponse`/`AssistantCitation`
 * types directly (both are already generic over payload shape), so this file
 * only adds what's actually different: the mobility payload shape and how to
 * build it from a `MobilityAppreciationResult`.
 *
 * Wires the corridor/chokepoint/barrier/counter-measure results through the
 * SAME grounding gate (`aiGrounding.ts`) the fire-break assistant uses — "the
 * model narrates and cites, it never computes" applies identically here. The
 * deterministic template (`api/src/services/mobilityBriefingTemplate.ts`) is
 * what actually delivers "a plain-language briefing, not just panels of
 * numbers": it works with no model deployed at all, same as the fire-break
 * assistant's own template fallback.
 */

import { MobilityAppreciationResult, carriesWaterSignal } from '../terrain/mobilityAppreciation';
import { DelayLedgerEntry } from '../terrain/delayLedger';
import { RoadSpeedOverrides, countActiveRoadSpeedOverrides } from '../terrain/roadSpeedModel';
import { AssistantResponse, postAssistant } from './assistantApi';

export interface MobilityCorridorSummary {
  rank: number;
  easeClass: string;
  routeCount: number;
  routeTotal: number;
  medianTravelMin: number;
  bottleneckWidthM: number;
  bottleneckAbreast: number;
  frontage: string;
  /** Renamed from `goFractionPct` (OCOKA 1, docs/ROUTE_INTELLIGENCE.md §47). */
  unrestrictedFractionPct: number;
}

export interface MobilityPlacementSummary {
  measureId: string;
  measureLabel: string;
  delayImposedMin: number;
  bypassDelayMin: number | null;
  egressSafe: boolean;
}

export interface MobilityAssistantPayload {
  moverProfileLabel: string;
  moverProfileConfidence: string;
  nightMode: boolean;
  cellCount: number;
  reachableCount: number;
  /** Renamed from `noGoCount`/`slowGoCount` (OCOKA 1, docs/ROUTE_INTELLIGENCE.md
   *  §47) to the current MCOO mobility-class vocabulary. The API validator
   *  accepts the legacy keys too, for a cached client posting to a fresh API. */
  severelyRestrictedCount: number;
  restrictedCount: number;
  estimatedData: boolean;
  /** True when either hydrology source (OSM waterway/water-body geometry, DEA
   *  WOfS frequency, docs §34) returned real data for this AOI — mirrors
   *  `MobilityAppreciationResult.hydrologyAvailable`. False means the
   *  water-crossing gate had nothing to check against, stated rather than
   *  silently absent. */
  hydrologyAvailable: boolean;
  /** Cells carrying a water signal (in a standing body, near a mapped
   *  watercourse, or a high DEA wet-frequency) — the SAME query
   *  `mobilityAppreciation.ts`'s own assessment log already computes. */
  waterAffectedCellCount: number;
  /** Subset of the above that sit literally inside a mapped standing water
   *  body (a lake/reservoir), the maximally-severe case. */
  waterBodyCellCount: number;
  unconstrained: boolean;
  coveragePercent: number;
  topCorridors: MobilityCorridorSummary[];
  chokepointCount: number;
  topChokepointPassCount: number | null;
  barrierSegmentCount: number | null;
  barrierCutValue: number | null;
  placements: MobilityPlacementSummary[];
  /** Mirrors the API-side optional block (api/src/types/mobilityAssistant.ts).
   *  Optional there and here for the same reason: a missing figure is reported
   *  as missing, never defaulted into a number. */
  corridorEvidence?: 'optimiser-routes' | 'simulated-movers';
  movement?: MobilityMovementSummary;
  restrictions?: MobilityRestrictionSummary[];
  restrictionEffect?: MobilityRestrictionEffectSummary;
  /** User-edited road-class speeds (docs §35 config UI, step 21) — same
   *  `countActiveRoadSpeedOverrides` single-source-of-truth
   *  `mobilityGisExport.ts`'s export attributes already use. Optional, same
   *  "arrived after the endpoint shipped" reasoning as the movement block
   *  above — an older cached client's payload still validates. */
  roadSpeedOverridesActive?: boolean;
  roadSpeedOverrideCount?: number;
}

export interface MobilityMovementSummary {
  moverCount: number;
  arrivedPercent: number;
  medianMin: number | null;
  p10Min: number | null;
  p90Min: number | null;
  crossCountryPercent: number;
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

const min1 = (seconds: number | null | undefined): number | null =>
  seconds === null || seconds === undefined || !isFinite(seconds)
    ? null
    : Math.round((seconds / 60) * 10) / 10;

const pct1 = (fraction: number): number => Math.round(fraction * 1000) / 10;

/** Build the compact payload the mobility assistant endpoint validates
 *  responses against, straight from the same results the panels render —
 *  never a second, divergent computation. */
export function buildMobilityAssistantPayload(
  result: MobilityAppreciationResult,
  nightMode: boolean,
  ledger: DelayLedgerEntry[] | null,
  roadSpeedOverrides?: RoadSpeedOverrides | null
): MobilityAssistantPayload {
  const cf = result.corridorField;
  const ens = result.ensemble;
  const plan = result.restrictionPlan;
  const roadSpeedOverrideCount = countActiveRoadSpeedOverrides(roadSpeedOverrides);
  return {
    corridorEvidence: cf?.evidence,
    roadSpeedOverridesActive: roadSpeedOverrideCount > 0,
    roadSpeedOverrideCount,
    movement: ens
      ? {
        moverCount: ens.moverCount,
        arrivedPercent: pct1(ens.arrivedCount / Math.max(1, ens.moverCount)),
        medianMin: min1(ens.arrivalP50Seconds),
        p10Min: min1(ens.arrivalP10Seconds),
        p90Min: min1(ens.arrivalP90Seconds),
        crossCountryPercent: pct1(ens.crossCountryFraction),
        optimalMin: min1(ens.optimalSeconds),
        behaviourSpread: ens.spread.label,
      }
      : undefined,
    restrictions: plan
      ? plan.restrictions.map(r => ({
        rank: r.rank,
        kind: r.kind,
        transitPercent: pct1(r.baselineTransitFraction),
        marginalDelayMin: min1(r.marginalMedianDelaySeconds) ?? 0,
        cumulativeDelayMin: min1(r.cumulativeMedianDelaySeconds) ?? 0,
        arrivedPercentAfter: pct1(r.arrivedFractionAfter),
      }))
      : undefined,
    restrictionEffect: plan
      ? {
        baselineMedianMin: min1(plan.baselineMedianSeconds),
        scenarioMedianMin: min1(plan.scenarioMedianSeconds),
        baselineArrivedPercent: pct1(plan.baselineArrivedFraction),
        scenarioArrivedPercent: pct1(plan.scenarioArrivedFraction),
        baselineCrossCountryPercent: pct1(plan.baselineCrossCountryFraction),
        scenarioCrossCountryPercent: pct1(plan.scenarioCrossCountryFraction),
        bypassNote: plan.bypassNote,
      }
      : undefined,
    moverProfileLabel: result.profile.label,
    moverProfileConfidence: result.profile.confidence,
    nightMode,
    cellCount: result.cellCount,
    reachableCount: result.reachableCount,
    severelyRestrictedCount: result.severelyRestrictedCount,
    restrictedCount: result.restrictedCount,
    estimatedData: result.usedEstimatedData,
    hydrologyAvailable: result.hydrologyAvailable,
    waterAffectedCellCount: result.cells.filter(carriesWaterSignal).length,
    waterBodyCellCount: result.cells.filter(c => c.inWaterBody).length,
    unconstrained: cf?.unconstrained ?? false,
    coveragePercent: cf ? Math.round(cf.coverageFraction * 1000) / 10 : 0,
    topCorridors: (cf?.corridors ?? []).slice(0, 3).map((c) => ({
      rank: c.rank,
      easeClass: c.easeClass,
      routeCount: c.routeCount,
      routeTotal: cf?.routes.length ?? 0,
      medianTravelMin: Math.round((c.medianTravelSeconds / 60) * 10) / 10,
      bottleneckWidthM: Math.round(c.bottleneckWidthM),
      bottleneckAbreast: c.bottleneckAbreast,
      frontage: c.frontage,
      unrestrictedFractionPct: Math.round(c.unrestrictedFraction * 1000) / 10,
    })),
    chokepointCount: result.chokepoints.length,
    topChokepointPassCount: result.chokepoints[0]?.passCount ?? null,
    barrierSegmentCount: result.barrier ? result.barrier.segments.length : null,
    barrierCutValue: result.barrier ? Math.round(result.barrier.cutValue) : null,
    placements: (ledger ?? []).map((e) => ({
      measureId: e.measure.id,
      measureLabel: e.measure.label,
      delayImposedMin: Math.round((e.delayImposedSeconds / 60) * 10) / 10,
      bypassDelayMin: e.bypassDelaySeconds != null ? Math.round((e.bypassDelaySeconds / 60) * 10) / 10 : null,
      egressSafe: e.egressSafe,
    })),
  };
}

/** Generate a one-shot plain-language appreciation from the current results. */
export async function fetchMobilityBriefing(payload: MobilityAssistantPayload): Promise<AssistantResponse | null> {
  return postAssistant('/assistant/mobility-briefing', { payload });
}
