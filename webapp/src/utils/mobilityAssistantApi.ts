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

import { MobilityAppreciationResult } from '../terrain/mobilityAppreciation';
import { DelayLedgerEntry } from '../terrain/delayLedger';
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
  goFractionPct: number;
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
  noGoCount: number;
  slowGoCount: number;
  estimatedData: boolean;
  unconstrained: boolean;
  coveragePercent: number;
  topCorridors: MobilityCorridorSummary[];
  chokepointCount: number;
  topChokepointPassCount: number | null;
  barrierSegmentCount: number | null;
  barrierCutValue: number | null;
  placements: MobilityPlacementSummary[];
}

/** Build the compact payload the mobility assistant endpoint validates
 *  responses against, straight from the same results the panels render —
 *  never a second, divergent computation. */
export function buildMobilityAssistantPayload(
  result: MobilityAppreciationResult,
  nightMode: boolean,
  ledger: DelayLedgerEntry[] | null
): MobilityAssistantPayload {
  const cf = result.corridorField;
  return {
    moverProfileLabel: result.profile.label,
    moverProfileConfidence: result.profile.confidence,
    nightMode,
    cellCount: result.cellCount,
    reachableCount: result.reachableCount,
    noGoCount: result.noGoCount,
    slowGoCount: result.slowGoCount,
    estimatedData: result.usedEstimatedData,
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
      goFractionPct: Math.round(c.goFraction * 1000) / 10,
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
