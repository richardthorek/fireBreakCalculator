/**
 * RECOMMENDED RESTRICTIONS — the second half of the question the movement
 * ensemble asks (owner, 2026-07-27):
 *
 *   "I would expect our model to account for an 'unrestricted' set of movement
 *    corridors, and then add in a set of recommended restrictions like road
 *    blocking."
 *
 * So the product has two answers, in this order:
 *
 *   1. UNRESTRICTED — with nothing done, this is how they move. Because the
 *      simulated mover strongly prefers the road/trail network
 *      (movementSimulation.ts note 0), that baseline is usually a road
 *      problem: movement runs along formed surfaces, and the vegetation and
 *      micro-terrain the rest of this mode models barely gets a look in.
 *   2. RESTRICTED — here is a small, ranked set of specific places to deny,
 *      and here is what each one actually bought. Blocking the road is where
 *      the leverage is, precisely because the unrestricted answer says that is
 *      where the movement is.
 *
 * HOW THE RECOMMENDATION IS PRODUCED. Not by scoring a formula — by running
 * the simulation again with the block in place and measuring the difference.
 *
 *   a. Rank candidate edges by how many simulated movers actually crossed
 *      them (`edgeTransit` from the baseline run), preferring edges where both
 *      cells sit on the road/trail network: a road block is cheap, doctrinally
 *      ordinary, and — per the baseline — where the traffic is.
 *   b. Greedily, one at a time: re-run a reduced ensemble with each shortlisted
 *      candidate added to the set already chosen, keep the one that hurts
 *      movement most, and record its MARGINAL effect. Repeat.
 *
 * Greedy, and iterative, for a reason that is the whole point of doing this
 * with a simulation rather than a formula: blocking the best road does not
 * remove that traffic, it MOVES it — onto the next road, and eventually into
 * the bush, where an entirely different set of terrain factors starts to bind.
 * Only re-running the ensemble against the partially-restricted world shows
 * where it went, so each subsequent recommendation is made against the world
 * the previous ones created, never against the untouched baseline.
 *
 * WHAT IT REFUSES TO DO. If the best remaining candidate buys less than
 * `MIN_MEANINGFUL_EFFECT_SECONDS`, planning stops and says so. Terrain that
 * offers a free bypass cannot be denied by blocking points, and padding the
 * list with measures that achieve nothing would be worse than a short list —
 * this is the same finding `corridorField.ts` reports as `unconstrained`,
 * reached from the other direction.
 *
 * HONESTY: every figure here is a difference between two real runs of the same
 * simulation over the same sampled ground. Nothing models what an obstacle
 * "should" do. But those runs are themselves the BEHAVIOUR model, with its
 * assumed parameters (see movementSimulation.ts's honesty boundary), so a
 * delay figure from this module is "delay imposed on simulated movers under
 * this behaviour model" — a planning comparison between options, not a promise
 * about a real adversary. It is also NOT the engineering delay ledger
 * (delayLedger.ts), which prices what it takes to BUILD and BREACH a specific
 * obstacle; these two answer different questions and are deliberately kept
 * apart.
 */

import { LatLng } from '../utils/chainage';
import { MobilityGridCell, runCostToGoSearch } from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { LocalProjection } from '../utils/hexGrid';
import {
  MovementEnsembleResult, createEdgeCostCache, simulateMovementEnsemble, EdgeCostCache,
} from './movementSimulation';

export type RestrictionKind = 'road-block' | 'ground-denial';

export interface RecommendedRestriction {
  id: string;
  /** 1 = recommended first (largest marginal effect). */
  rank: number;
  kind: RestrictionKind;
  /** The two real cell centres the block sits between — never an invented
   *  point along an edge, matching how counter-measure placements already
   *  export (docs §29). */
  fromKey: string;
  toKey: string;
  from: LatLng;
  to: LatLng;
  /** Movers that crossed this edge in the UNRESTRICTED baseline, and that as
   *  a fraction of all movers — why this site was a candidate at all. */
  baselineTransitMovers: number;
  baselineTransitFraction: number;
  /** Extra median journey time this restriction added ON TOP of the ones
   *  ranked above it, seconds. The marginal figure is the honest one: the
   *  second block on the same road usually buys almost nothing. */
  marginalMedianDelaySeconds: number;
  /** Median journey time with this restriction and every higher-ranked one in
   *  place, vs the unrestricted baseline. */
  cumulativeMedianDelaySeconds: number;
  arrivedFractionBefore: number;
  arrivedFractionAfter: number;
  /** Share of simulated movement that was off the road network before and
   *  after. A rising number is the restriction working as intended: it has
   *  pushed movement into ground where vegetation and slope start to bind. */
  crossCountryFractionBefore: number;
  crossCountryFractionAfter: number;
}

export interface RestrictionPlan {
  restrictions: RecommendedRestriction[];
  /** Directed edge keys severed by the full recommended set (both directions
   *  of each blocked pair). */
  blockedEdges: string[];
  /** The ensemble re-run at full mover count with the whole set emplaced —
   *  the "restricted" picture the UI draws alongside the unrestricted one. */
  scenario: MovementEnsembleResult | null;
  baselineMedianSeconds: number | null;
  scenarioMedianSeconds: number | null;
  baselineArrivedFraction: number;
  scenarioArrivedFraction: number;
  baselineCrossCountryFraction: number;
  scenarioCrossCountryFraction: number;
  /** Set when planning stopped early because nothing further was worth doing —
   *  the terrain offers a bypass. Stated, never padded around. */
  bypassNote: string | null;
  /** How many movers each candidate evaluation used (fewer than the headline
   *  run, deliberately — see EVALUATION_MOVER_COUNT). */
  evaluationMoverCount: number;
  /** No road or trail data was available for this AOI, so every candidate is
   *  ground denial by default rather than by analysis. */
  networkUnavailable: boolean;
}

/** How many top-transit edges are evaluated per greedy round. */
const SHORTLIST_SIZE = 8;
/** Movers per candidate evaluation. Lower than the headline ensemble on
 *  purpose: a candidate only has to be RANKED against its rivals here, and the
 *  chosen set is then re-run at full count for the figures actually shown. */
const EVALUATION_MOVER_COUNT = 70;
/** Maximum restrictions recommended. A commander wants a short, actionable
 *  list; a long one is a wish list. */
const MAX_RESTRICTIONS = 4;
/** Below this marginal effect, stop and report the bypass instead. */
const MIN_MEANINGFUL_EFFECT_SECONDS = 120;
/**
 * What a mover that never arrives is worth, in delay-seconds, when ranking
 * candidates. ASSUMED, and needed because the two things a restriction can do
 * — slow movement down, and stop it entirely — have different units. Two hours
 * is well beyond any journey time at these AOI scales, so denial always
 * outranks delay, which is the correct priority for siting an obstacle.
 */
const DENIAL_EQUIVALENT_SECONDS = 7200;

interface EnsembleSummary {
  medianSeconds: number | null;
  arrivedFraction: number;
  crossCountryFraction: number;
}

function summarise(e: MovementEnsembleResult | null): EnsembleSummary {
  if (!e) return { medianSeconds: null, arrivedFraction: 0, crossCountryFraction: 0 };
  return {
    medianSeconds: e.arrivalP50Seconds,
    arrivedFraction: e.moverCount > 0 ? e.arrivedCount / e.moverCount : 0,
    crossCountryFraction: e.crossCountryFraction,
  };
}

/** Composite ranking score: delay imposed, with never-arriving movers counted
 *  at `DENIAL_EQUIVALENT_SECONDS` each. See that constant's note. */
function effectScore(baseline: EnsembleSummary, candidate: EnsembleSummary): number {
  const delay = baseline.medianSeconds !== null && candidate.medianSeconds !== null
    ? candidate.medianSeconds - baseline.medianSeconds
    : 0;
  const denial = Math.max(0, baseline.arrivedFraction - candidate.arrivedFraction);
  return delay + denial * DENIAL_EQUIVALENT_SECONDS;
}

interface Candidate {
  fromKey: string;
  toKey: string;
  from: LatLng;
  to: LatLng;
  kind: RestrictionKind;
  movers: number;
}

/**
 * Collapse the baseline's DIRECTED edge transit into undirected candidate
 * sites, keeping the busiest first. A block severs a stretch of ground in both
 * directions, so the two directions of the same edge are one candidate.
 */
function buildCandidates(
  baseline: MovementEnsembleResult,
  byKey: Map<string, MobilityGridCell>
): Candidate[] {
  const combined = new Map<string, { a: string; b: string; movers: number }>();
  for (const [edgeKey, count] of baseline.edgeTransit) {
    const [a, b] = edgeKey.split('|');
    if (!a || !b) continue;
    const canonical = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = combined.get(canonical);
    if (existing) existing.movers += count;
    else combined.set(canonical, { a, b, movers: count });
  }

  const out: Candidate[] = [];
  for (const { a, b, movers } of combined.values()) {
    const cellA = byKey.get(a);
    const cellB = byKey.get(b);
    if (!cellA || !cellB) continue;
    out.push({
      fromKey: a,
      toKey: b,
      from: cellA.center,
      to: cellB.center,
      kind: cellA.onTrail && cellB.onTrail ? 'road-block' : 'ground-denial',
      movers,
    });
  }

  // Busiest first, road blocks ahead of open-ground denial at comparable
  // traffic — the owner's stated preference and the cheaper measure in the
  // real world. The 1.35 weighting is a ranking preference, not a claim about
  // effect; the effect is then MEASURED by re-simulation regardless.
  return out.sort((x, y) => (y.movers * (y.kind === 'road-block' ? 1.35 : 1))
    - (x.movers * (x.kind === 'road-block' ? 1.35 : 1)));
}

/** Both directions of a candidate edge — a block is not one-way. */
function directedKeys(c: Candidate): [string, string] {
  return [`${c.fromKey}|${c.toKey}`, `${c.toKey}|${c.fromKey}`];
}

export interface RestrictionPlannerOptions {
  moverCount: number;
  spreadId: string;
  seed: number;
  maxRestrictions?: number;
  onProgress?: (fraction: number) => void;
  onLog?: (line: string) => void;
  /** Forwarded to every `simulateMovementEnsemble` re-run this planner makes
   *  (see that option's own doc comment) — kept identical between the
   *  baseline and every candidate/scenario evaluation, so a restriction's
   *  measured effect is never confounded by the known-route bias changing
   *  between runs. */
  preferredRouteKeys?: string[];
}

/**
 * Build the recommended restriction set against an already-computed
 * unrestricted baseline. Pure and synchronous (runs inside the mobility
 * worker); never resamples the ground.
 */
export function planRestrictions(
  cells: MobilityGridCell[],
  originKeys: string[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  hexSize: number,
  proj: LocalProjection,
  baseline: MovementEnsembleResult,
  options: RestrictionPlannerOptions
): RestrictionPlan {
  const maxRestrictions = options.maxRestrictions ?? MAX_RESTRICTIONS;
  const cache: EdgeCostCache = createEdgeCostCache(cells, profile, nightMode);
  const byKey = cache.byKey;
  const baselineSummary = summarise(baseline);
  const networkUnavailable = !cells.some(c => c.onTrail);

  const allCandidates = buildCandidates(baseline, byKey);
  const chosen: RecommendedRestriction[] = [];
  const blocked = new Set<string>();
  /** Cells already committed to a restriction, plus their neighbours — a
   *  second block a single hex further along the same road is the same
   *  obstacle twice, and would report a marginal effect of ~0 while crowding
   *  a genuinely different site off the list. */
  const excludedCells = new Set<string>();

  let runningSummary = baselineSummary;
  let bypassNote: string | null = null;

  const evaluate = (extraBlocked: Set<string>, moverCount: number, seedOffset: number) => {
    const costToGo = runCostToGoSearch(cells, objectiveKeys, profile, nightMode, extraBlocked);
    return simulateMovementEnsemble(cells, originKeys, objectiveKeys, profile, nightMode, hexSize, proj, {
      moverCount,
      spreadId: options.spreadId,
      seed: options.seed + seedOffset,
      keepTrajectories: 0,
      blockedEdges: extraBlocked,
      edgeCache: cache,
      costToGo,
      preferredRouteKeys: options.preferredRouteKeys,
    });
  };

  const totalEvaluations = Math.max(1, maxRestrictions * SHORTLIST_SIZE);
  let evaluationsDone = 0;

  for (let round = 0; round < maxRestrictions; round++) {
    const shortlist = allCandidates
      .filter(c => !excludedCells.has(c.fromKey) && !excludedCells.has(c.toKey))
      .slice(0, SHORTLIST_SIZE);
    if (shortlist.length === 0) break;

    let bestCandidate: Candidate | null = null;
    let bestScore = -Infinity;
    let bestSummary: EnsembleSummary | null = null;

    for (const candidate of shortlist) {
      const trial = new Set(blocked);
      for (const dk of directedKeys(candidate)) trial.add(dk);
      // Vary the seed per evaluation so a candidate is never flattered by
      // happening to reuse the exact mover population that suited it, but keep
      // it deterministic for reproducibility.
      const result = evaluate(trial, EVALUATION_MOVER_COUNT, round * 1000 + evaluationsDone);
      const summary = summarise(result);
      const score = effectScore(runningSummary, summary);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
        bestSummary = summary;
      }
      evaluationsDone++;
      options.onProgress?.(Math.min(1, evaluationsDone / totalEvaluations));
    }

    if (!bestCandidate || !bestSummary) break;

    if (bestScore < MIN_MEANINGFUL_EFFECT_SECONDS) {
      bypassNote = chosen.length === 0
        ? 'No single site is worth blocking: every candidate was bypassed at negligible cost. This ground does not canalise movement — denying it needs observation and fires, or a continuous barrier, not point obstacles.'
        : `Stopped after ${chosen.length} restriction(s): the next-best site added under ${Math.round(MIN_MEANINGFUL_EFFECT_SECONDS / 60)} minutes to the median journey. Movement is bypassing further blocks at negligible cost.`;
      options.onLog?.('RESTRICTION PLANNING STOPPED — NEXT-BEST SITE BUYS EFFECTIVELY NOTHING (BYPASS AVAILABLE)');
      break;
    }

    for (const dk of directedKeys(bestCandidate)) blocked.add(dk);
    excludedCells.add(bestCandidate.fromKey);
    excludedCells.add(bestCandidate.toKey);
    for (const n of cache.neighboursOf(bestCandidate.fromKey)) excludedCells.add(n.key);
    for (const n of cache.neighboursOf(bestCandidate.toKey)) excludedCells.add(n.key);

    const marginalDelay = runningSummary.medianSeconds !== null && bestSummary.medianSeconds !== null
      ? bestSummary.medianSeconds - runningSummary.medianSeconds
      : 0;
    const cumulativeDelay = baselineSummary.medianSeconds !== null && bestSummary.medianSeconds !== null
      ? bestSummary.medianSeconds - baselineSummary.medianSeconds
      : 0;

    chosen.push({
      id: `restriction-${chosen.length + 1}`,
      rank: chosen.length + 1,
      kind: bestCandidate.kind,
      fromKey: bestCandidate.fromKey,
      toKey: bestCandidate.toKey,
      from: bestCandidate.from,
      to: bestCandidate.to,
      baselineTransitMovers: bestCandidate.movers,
      baselineTransitFraction: baseline.moverCount > 0 ? bestCandidate.movers / baseline.moverCount : 0,
      marginalMedianDelaySeconds: marginalDelay,
      cumulativeMedianDelaySeconds: cumulativeDelay,
      arrivedFractionBefore: runningSummary.arrivedFraction,
      arrivedFractionAfter: bestSummary.arrivedFraction,
      crossCountryFractionBefore: runningSummary.crossCountryFraction,
      crossCountryFractionAfter: bestSummary.crossCountryFraction,
    });
    options.onLog?.(
      `RESTRICTION ${chosen.length} — ${bestCandidate.kind === 'road-block' ? 'ROAD BLOCK' : 'GROUND DENIAL'} ` +
      `ON GROUND ${Math.round((bestCandidate.movers / Math.max(1, baseline.moverCount)) * 100)}% OF MOVERS USED · ` +
      `+${Math.round(marginalDelay / 60)} MIN MEDIAN · ` +
      `CROSS-COUNTRY ${Math.round(bestSummary.crossCountryFraction * 100)}% (WAS ${Math.round(runningSummary.crossCountryFraction * 100)}%)`
    );
    runningSummary = bestSummary;
  }

  // Re-run the chosen set at full mover count — the evaluation runs were sized
  // for RANKING, and the figures actually presented should come from a run of
  // the same weight as the baseline they are compared against.
  let scenario: MovementEnsembleResult | null = null;
  if (blocked.size > 0) {
    options.onLog?.(`RE-RUNNING ${options.moverCount} MOVERS WITH ${chosen.length} RESTRICTION(S) EMPLACED…`);
    scenario = evaluate(blocked, options.moverCount, 7777);
  }
  const scenarioSummary = summarise(scenario);

  return {
    restrictions: chosen,
    blockedEdges: [...blocked],
    scenario,
    baselineMedianSeconds: baselineSummary.medianSeconds,
    scenarioMedianSeconds: scenarioSummary.medianSeconds,
    baselineArrivedFraction: baselineSummary.arrivedFraction,
    scenarioArrivedFraction: scenarioSummary.arrivedFraction,
    baselineCrossCountryFraction: baselineSummary.crossCountryFraction,
    scenarioCrossCountryFraction: scenarioSummary.crossCountryFraction,
    bypassNote,
    evaluationMoverCount: EVALUATION_MOVER_COUNT,
    networkUnavailable,
  };
}
