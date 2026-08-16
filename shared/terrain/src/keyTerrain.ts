/**
 * Key terrain (OCOKA 4, docs/ROUTE_INTELLIGENCE.md §47.1) — "the one missing
 * factor that is nearly free": candidates from ground this run has already
 * identified as significant (chokepoints, the hex min-cut, the road-network
 * min-cut, each corridor's own bottleneck — `Corridor.bottleneckCellKeys`),
 * each SCORED by a real re-run of the search with that ground denied,
 * compared against the baseline via `compareCorridorFields`. No invented
 * signal: every candidate is nominated from a product this run already
 * computed, and every score is a difference between two real searches.
 *
 * DOCTRINE, STATED PLAINLY (root CLAUDE.md's honesty rule applies here as
 * much as anywhere): key terrain is "any locality, or area, the seizure or
 * retention of which affords a marked advantage to either combatant"
 * (ATP 2-01.3) — a definition about ADVANTAGE RELATIVE TO A MISSION. This
 * tool has no mission. It cannot know what a commander is trying to achieve,
 * so it cannot actually determine advantage — only measure "how much does
 * denying this ground change the movement picture", which is a real,
 * useful, but STRICTLY NARROWER question. `KeyTerrainResult.missionCaveat`
 * carries this into export/UI/briefing verbatim rather than leaving it as
 * prose that could quietly drop off along the way.
 *
 * DECISIVE TERRAIN gets the same restraint doubled: doctrine reserves it for
 * ground the commander DESIGNATES, never derives from a map. This module
 * computes a real predicate — did denying this candidate's ground make the
 * objective fully unreachable by every analysed route (`afterField === null`)
 * — but that predicate is exposed only as `decisiveCandidate: boolean`, a
 * flag requiring confirmation, never as an assertion that the ground IS
 * decisive. Every caller (OakocPanel.tsx, export, briefing) must keep that
 * framing; do not upgrade the flag's wording to a claim.
 *
 * SCORED AGAINST THE OPTIMISER FIELD, DELIBERATELY. The headline
 * `corridorField` a run shows can be the SIMULATED-MOVER field
 * (`movementSimulation.ts`), which is expensive to reproduce per candidate
 * (a full ensemble run, not a handful of searches). `optimiserCorridorField`
 * — the k-cheapest-routes field — is always computed regardless of which one
 * heads the UI (`mobilityAppreciation.ts`'s own doc comment), so every
 * candidate here is scored against IT, at a reduced route count
 * (`EVALUATION_ROUTE_COUNT`, mirroring `restrictionPlanner.ts`'s identical
 * evaluation-vs-headline reduction). This is a real, stated methodology
 * choice — "how much would denying this change the CHEAPEST-ROUTE picture",
 * not "...the modelled-behaviour picture" — never blended or left ambiguous.
 *
 * MUST NOT RUN ON THE MAIN THREAD. `scoreKeyTerrainCandidates` runs up to
 * `MAX_CANDIDATES_EVALUATED × EVALUATION_ROUTE_COUNT` full searches — this is
 * exactly the CPU-bound, no-network-I/O shape `mobilityWorker.ts`'s own
 * header explains the Worker reversal for, and running it synchronously here
 * reproduces step 41's page-hang regression (docs §41). This module's two
 * exported functions are pure and synchronous ON PURPOSE so the SAME code
 * runs unchanged inside the Worker — `mobilityWorker.ts` imports and calls
 * them directly, never a second implementation.
 */

import { LatLng } from './chainage';
import { MobilityGridCell, nearestCellKey } from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { LocalProjection, hexNeighbors, hexKey } from './hexGrid';
import { ChokepointCell } from './corridorAnalysis';
import { MinCutResult } from './minCutBarrier';
import { RoadMinCutResult } from './minCutBarrier';
import {
  Corridor, CorridorField, buildCorridorField, compareCorridorFields, CorridorComparison,
} from './corridorField';

export type KeyTerrainCandidateSource = 'chokepoint' | 'hex-min-cut' | 'road-min-cut' | 'corridor-bottleneck';

export interface KeyTerrainCandidate {
  id: string;
  source: KeyTerrainCandidateSource;
  /** Hex cells this candidate's ground occupies. Denial is modelled as
   *  controlling EVERY one of these cells — every edge touching any of them
   *  is penalised, both directions (see `denialEdgePenalties`). */
  cellKeys: string[];
  /** Simple arithmetic mean of the member cells' centres — a marker
   *  location, not a geodesic centroid; fine for placing a label, not a
   *  survey point (same honesty tier as every other UI/export marker this
   *  mode places from cell centres). */
  center: LatLng;
  /** Real, already-computed figures this candidate was nominated FROM —
   *  informational provenance only, plays no part in the score. */
  provenance: {
    chokepointPassCount?: number;
    minCutSegmentIndex?: number;
    roadWayName?: string;
    corridorId?: string;
    corridorRank?: number;
  };
}

export interface ScoredKeyTerrainCandidate extends KeyTerrainCandidate {
  /** 1 = the ground whose denial changes the movement picture most. */
  rank: number;
  /** The real re-run diff this candidate earned — see `compareCorridorFields`. */
  comparison: CorridorComparison;
  /** Ranking-only composite over `comparison`'s own real counts — this
   *  product's own engineering judgement over computed deltas, same honesty
   *  framing as `Corridor.riskScore`/`CorridorField.mostRiskyCorridorId`; see
   *  `impactScoreOf`'s own comment for the formula. Not a doctrinal figure,
   *  not validated against any incident data. */
  impactScore: number;
  /** A computed PREDICATE — see this module's header for why it is exposed
   *  only as a flag requiring confirmation, never an assertion. */
  decisiveCandidate: boolean;
}

export interface KeyTerrainResult {
  candidates: ScoredKeyTerrainCandidate[];
  /** How many candidates were generated before the evaluation cap — so the
   *  UI/export can say "N considered, top M scored" rather than implying the
   *  shortlist was the whole field. */
  candidatesConsidered: number;
  /** How many routes each candidate's re-run used (`EVALUATION_ROUTE_COUNT`)
   *  — carried into the result for the same reason
   *  `RestrictionPlan.evaluationMoverCount` is: a reduced-fidelity figure
   *  must say so wherever it travels, not just in this module's own comment. */
  evaluationRouteCount: number;
  /** See this module's header — always present, always this exact text. */
  missionCaveat: string;
}

export const KEY_TERRAIN_MISSION_CAVEAT =
  'Key terrain is doctrinally defined relative to a mission, which this tool is not given. These ' +
  'candidates measure how much denying each piece of ground changes the movement picture — a real ' +
  'but narrower question than "does controlling it confer advantage". A commander assesses that ' +
  'against the actual mission.';

/**
 * A TRUE hard block, deliberately unlike every other `edgePenalties` user in
 * this mode. `counterMeasures.ts` keeps its multipliers finite ON PURPOSE —
 * "no entry here is rated `block`", because a real physical obstacle in that
 * catalogue is always breachable given time. Key terrain asks a genuinely
 * different, more absolute question: "if this ground were fully controlled
 * — not merely obstructed — what happens to movement". Dijkstra with a
 * finite multiplier will always still FIND a route if literally any is
 * physically possible, however costly, so a finite penalty can never make
 * `decisiveCandidate` mean anything (proven while writing `keyTerrain.test.ts`:
 * even a 1e6 multiplier over the sole gap in a hard-blocked water barrier
 * still returned a route). `Infinity` here is honest, not a shortcut: it is
 * the same "excluded from the graph" treatment `travel.blocked` already gets
 * elsewhere (`minCutBarrier.ts`, `roadRouting.ts`), just expressed through
 * the penalty map instead of a second mechanism.
 */
const DENIAL_PENALTY_MULTIPLIER = Infinity;

/** How many chokepoint cells, by pass count, become candidates. */
const CHOKEPOINT_CANDIDATE_COUNT = 6;
/** How many top-ranked corridors contribute their own bottleneck as a
 *  candidate — deliberately small: a corridor ranked 5th carries little
 *  weight in the movement picture, so denying its bottleneck rarely changes
 *  much, and evaluating it anyway would just spend budget on a candidate
 *  unlikely to survive the cap below. */
const CORRIDOR_BOTTLENECK_CANDIDATE_COUNT = 3;
/** Hard cap on candidates actually re-run and scored — each evaluation is a
 *  real search, see this module's header on cost. Exported so a pooled
 *  caller (WP4, movement-analysis performance work — see
 *  `mobilityWorkerPool.ts`) can pre-slice to this SAME cap before splitting
 *  candidates across workers; each worker's own `scoreKeyTerrainCandidates`
 *  call also applies this cap independently, so failing to pre-slice would
 *  let a pooled run evaluate up to `poolSize × MAX_CANDIDATES_EVALUATED`
 *  candidates instead of this one bound. */
export const MAX_CANDIDATES_EVALUATED = 10;
/** Routes per candidate re-run, reduced from `DEFAULT_CORRIDOR_ROUTE_COUNT`
 *  (14) the same way `restrictionPlanner.ts`'s `EVALUATION_MOVER_COUNT` is
 *  reduced from its headline ensemble — a candidate only needs to be RANKED
 *  against its rivals, not rendered at full fidelity. Exported so a pooled
 *  caller (`mobilityWorkerPool.ts`) building its own `KeyTerrainResult` from
 *  merged worker responses reports the same value `buildKeyTerrainResult`
 *  would have. */
export const EVALUATION_ROUTE_COUNT = 6;

function meanCenter(cells: MobilityGridCell[], keys: string[]): LatLng {
  const byKey = new Map(cells.map(c => [c.key, c]));
  const pts = keys.map(k => byKey.get(k)?.center).filter((p): p is LatLng => !!p);
  if (pts.length === 0) return { lat: 0, lng: 0 };
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  };
}

/** Canonical string for a candidate's cell set, for dedup — order-independent. */
function cellSetKey(cellKeys: string[]): string {
  return [...cellKeys].sort().join(',');
}

/**
 * Nominate candidates from four already-computed products (docs §47.1's
 * audit: "~90% computable from chokepoint/min-cut machinery already in
 * hand"). Pure, cheap (no search runs here) — safe to call on the main
 * thread; only `scoreKeyTerrainCandidates` below needs the Worker.
 */
export function generateKeyTerrainCandidates(
  cells: MobilityGridCell[],
  chokepoints: ChokepointCell[],
  barrier: MinCutResult | null,
  roadNetworkBarrier: RoadMinCutResult | null,
  corridorField: CorridorField | null
): KeyTerrainCandidate[] {
  const candidates: KeyTerrainCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: KeyTerrainCandidate) => {
    const k = cellSetKey(c.cellKeys);
    if (c.cellKeys.length === 0 || seen.has(k)) return; // dedup: same ground already nominated
    seen.add(k);
    candidates.push(c);
  };

  // Chokepoints first — they carry the richest provenance (a real route-pass
  // count), so when the SAME ground is also a min-cut segment or a corridor
  // bottleneck, the chokepoint's telling of it wins the dedup above.
  for (const cp of [...chokepoints].sort((a, b) => b.passCount - a.passCount).slice(0, CHOKEPOINT_CANDIDATE_COUNT)) {
    add({
      id: `chokepoint-${cp.key}`,
      source: 'chokepoint',
      cellKeys: [cp.key],
      center: cp.center,
      provenance: { chokepointPassCount: cp.passCount },
    });
  }

  (barrier?.segments ?? []).forEach((seg, i) => {
    const cellKeys = [seg.fromKey, seg.toKey];
    add({
      id: `hexmincut-${i}`,
      source: 'hex-min-cut',
      cellKeys,
      center: meanCenter(cells, cellKeys),
      provenance: { minCutSegmentIndex: i },
    });
  });

  (roadNetworkBarrier?.segments ?? []).forEach((seg, i) => {
    const cellKeys = [...new Set([
      nearestCellKey(cells, seg.from),
      nearestCellKey(cells, seg.to),
    ])];
    add({
      id: `roadmincut-${i}`,
      source: 'road-min-cut',
      cellKeys,
      center: meanCenter(cells, cellKeys),
      provenance: { minCutSegmentIndex: i, roadWayName: seg.wayName },
    });
  });

  for (const corridor of [...(corridorField?.corridors ?? [])].sort((a, b) => a.rank - b.rank).slice(0, CORRIDOR_BOTTLENECK_CANDIDATE_COUNT)) {
    add({
      id: `bottleneck-${corridor.id}`,
      source: 'corridor-bottleneck',
      cellKeys: corridor.bottleneckCellKeys,
      center: meanCenter(cells, corridor.bottleneckCellKeys),
      provenance: { corridorId: corridor.id, corridorRank: corridor.rank },
    });
  }

  return candidates;
}

/** Penalise every edge touching any of `deniedKeys`, both directions — same
 *  edge-key format (`${from}|${to}`) and same "multiply the existing
 *  penalty" composition every other scenario in this mode already uses
 *  (`delayLedger.ts#buildScenarioEdgePenalties`). */
function denialEdgePenalties(cells: MobilityGridCell[], deniedKeys: string[]): Map<string, number> {
  const byKey = new Map(cells.map(c => [c.key, c]));
  const penalties = new Map<string, number>();
  for (const key of deniedKeys) {
    const cell = byKey.get(key);
    if (!cell) continue;
    for (const nHex of hexNeighbors(cell.hex)) {
      const nKey = hexKey(nHex);
      if (!byKey.has(nKey)) continue;
      for (const edge of [`${key}|${nKey}`, `${nKey}|${key}`]) {
        penalties.set(edge, (penalties.get(edge) ?? 1) * DENIAL_PENALTY_MULTIPLIER);
      }
    }
  }
  return penalties;
}

/** Ranking-only composite over `CorridorComparison`'s own real counts.
 *  Collapse weighs most (an avenue that stops existing is the strongest
 *  possible statement); degrade and displacement weigh less — both are real
 *  effects but neither removes an avenue outright. Normalised by the
 *  baseline's own corridor count so a run with many corridors doesn't
 *  automatically outscore one with few. */
function impactScoreOf(comparison: CorridorComparison, baselineCorridorCount: number): number {
  const denom = Math.max(1, baselineCorridorCount);
  return (
    comparison.collapsedCount * 1.0 +
    comparison.degradedCount * 0.5 +
    comparison.displacedIntoCount * 0.25
  ) / denom;
}

/**
 * Score every candidate (up to `MAX_CANDIDATES_EVALUATED`) by re-running the
 * search with it denied and diffing against `baselineField` — the REAL work
 * this module's header warns must not run on the main thread.
 */
export function scoreKeyTerrainCandidates(
  cells: MobilityGridCell[],
  originKeys: string[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  hexSize: number,
  proj: LocalProjection,
  baselineField: CorridorField,
  candidates: KeyTerrainCandidate[]
): ScoredKeyTerrainCandidate[] {
  const evaluated = candidates.slice(0, MAX_CANDIDATES_EVALUATED);
  const baselineCorridorCount = baselineField.corridors.length;

  const scored = evaluated.map((candidate): Omit<ScoredKeyTerrainCandidate, 'rank'> => {
    const penalties = denialEdgePenalties(cells, candidate.cellKeys);
    const afterField = buildCorridorField(cells, originKeys, objectiveKeys, profile, nightMode, hexSize, proj, {
      edgePenalties: penalties,
      routeCount: EVALUATION_ROUTE_COUNT,
      evidence: 'optimiser-routes',
      weightByAttractiveness: true,
    });
    const comparison = compareCorridorFields(baselineField, afterField);
    return {
      ...candidate,
      comparison,
      impactScore: impactScoreOf(comparison, baselineCorridorCount),
      decisiveCandidate: afterField === null,
    };
  });

  return scored
    .sort((a, b) => b.impactScore - a.impactScore)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

export function buildKeyTerrainResult(
  candidates: KeyTerrainCandidate[],
  scored: ScoredKeyTerrainCandidate[]
): KeyTerrainResult {
  return {
    candidates: scored,
    candidatesConsidered: candidates.length,
    evaluationRouteCount: EVALUATION_ROUTE_COUNT,
    missionCaveat: KEY_TERRAIN_MISSION_CAVEAT,
  };
}
