/**
 * Counter-mobility delay ledger — Terrain Mobility & Counter-Mobility mode,
 * Pass 2 (docs/ROUTE_INTELLIGENCE.md §5, §15.2, §15.4).
 *
 * "The metric is delay per dollar, not 'blocked'. Nothing is impassable;
 * obstacles impose time." Every figure this module reports comes from an
 * actual `runAccumulatedCostSearch` call over the real sampled grid — never
 * a guess — per §15.4's "no fabricated numbers anywhere" standing constraint.
 *
 * THE BYPASS RULE (§5, non-negotiable): a single obstacle's delay figure in
 * isolation is misleading, because the honest answer is usually "they drive
 * around it". So every ledger entry reports delayImposedSeconds ALONGSIDE a
 * separately-computed bypassDelaySeconds — never the delay figure alone.
 * Mechanism: T1 applies the measure's own (large) edgePenaltyMultiplier to
 * the placement edges, which forces the search away from them onto whatever
 * alternate path exists (the "full block" scenario, including a forced
 * detour or, if none exists, an enormous cost). The bypass search instead
 * applies a much smaller multiplier (BYPASS_KNOWN_GROUND_MULTIPLIER) to the
 * SAME edges, representing a mover who knows the ground is covered/risky but
 * still passable and will only detour if that is actually faster. Because
 * the bypass search has more freedom to just push through if detouring costs
 * more, bypassDelaySeconds is often LOWER than delayImposedSeconds — which is
 * exactly docs §5's own example: "this block adds 12 min; the bypass it
 * opens costs them 4 min."
 *
 * THE EGRESS-SAFETY GATE (§5, §15.4 "unconditional" standing constraint):
 * before a measure can be scored as viable, this module checks — using the
 * SAME exhaustive multi-source reachability field already computed for T1 —
 * whether the origin AOI can still reach at least one cell outside the
 * measure's own immediate footprint. If not, the origin's own people would be
 * boxed in by their own barrier; `egressSafe` is set false with a warning and
 * the measure must be refused (not merely flagged) by any UI consuming this
 * ledger. This is a REAL computation over the reachability field the search
 * already produced, never a hardcoded `true`.
 */

import {
  MobilityGridCell,
  runAccumulatedCostSearch,
  AccumulatedCostSearchResult,
  extractPath,
} from './accumulatedCost';
import { MoverProfile } from './moverProfiles';
import { CounterMeasure } from './counterMeasures';
import { hexKey, hexNeighbors } from './hexGrid';

/** Multiplier used for the bypass search — "known covered ground, still
 *  passable but suboptimal" per docs §5's bypass-rule framing. Deliberately
 *  much smaller than any measure's own `edgePenaltyMultiplier`. */
export const BYPASS_KNOWN_GROUND_MULTIPLIER = 2;

/** Finite stand-in for "unreachable" so downstream ranking/UI math never has
 *  to special-case Infinity. Only ever used when a search genuinely finds no
 *  route to any objective cell. */
const NEAR_INFINITE_SECONDS = 1e9;

export interface DelayLedgerEntry {
  measure: CounterMeasure;
  /** T1 - T0: best route time WITH the measure placed, minus the baseline
   *  best route time with no measures. Never negative (floored at 0). */
  delayImposedSeconds: number;
  /**
   * What the mover would do INSTEAD of accepting the full delay — a
   * separately-computed alternate-route time minus T0 (docs §5's mandatory
   * bypass rule). Two special cases, both deliberate (never a casual null):
   *  - Equal to `delayImposedSeconds` when no cheaper bypass exists at all
   *    (the search was forced through the exact same placement edge(s) even
   *    under the measure's own large penalty — there is no alternate
   *    topology to exploit).
   *  - `null` ONLY when the objective is genuinely unreachable for this
   *    profile even at baseline (T0 itself is infinite) — there is no route
   *    to bypass in the first place, so the question is meaningless, not
   *    just expensive.
   */
  bypassDelaySeconds: number | null;
  /** measure.relativeEmplacementEffort, summed across every placement of
   *  this measure (a measure sited "several in depth" costs more). */
  relativeCost: number;
  /** delayImposedSeconds / relativeCost — the ranking metric. 0 when
   *  relativeCost is 0 (shouldn't happen, guarded defensively). */
  delayPerEffortUnit: number;
  /** REAL computed result of the egress-safety gate (see module note) — a
   *  measure with `egressSafe: false` must be refused, not just flagged, by
   *  any consuming UI (docs §5, §15.4). */
  egressSafe: boolean;
  egressWarning: string | null;
  /** True when T1 (with the measure placed) found no finite route at all —
   *  worth flagging distinctly from an ordinary large delay, since it means
   *  every viable route may now be covered by this measure set. Reported
   *  delayImposedSeconds/bypassDelaySeconds still use the finite
   *  NEAR_INFINITE_SECONDS sentinel in this case so ranking math stays safe. */
  objectiveUnreachable?: boolean;
}

interface GroupedPlacement {
  segmentFromKey: string;
  segmentToKey: string;
}

export interface CounterMeasurePlacement {
  measureId: string;
  segmentFromKey: string;
  segmentToKey: string;
}

function minObjectiveTime(
  best: Map<string, { timeSeconds: number; estimated: boolean }>,
  objectiveKeys: string[]
): number {
  let min = Infinity;
  for (const key of objectiveKeys) {
    const r = best.get(key);
    if (r && r.timeSeconds < min) min = r.timeSeconds;
  }
  return min;
}

/**
 * Combined penalty map for an ENTIRE placement set — every measure's own
 * `edgePenaltyMultiplier` applied at its own segments, all at once. This is
 * the "scenario" view the corridor comparison needs (docs §15.2's
 * baseline-vs-scenario item): the per-measure ledger below scores measures
 * one at a time to rank them, but a commander's actual course of action
 * emplaces several together, and their combined effect on the movement
 * picture is not the sum of their individual effects — blocking two of three
 * corridors pushes everything onto the third.
 *
 * Where two placements land on the same edge, multipliers COMPOUND
 * (multiplicatively), matching how `findKDissimilarPaths` already
 * accumulates its own iterative penalties — one consistent convention for
 * "this edge is discouraged by more than one thing".
 */
export function buildScenarioEdgePenalties(
  measures: CounterMeasure[],
  placements: CounterMeasurePlacement[]
): Map<string, number> {
  const byId = new Map(measures.map(m => [m.id, m]));
  const penalties = new Map<string, number>();
  for (const p of placements) {
    const measure = byId.get(p.measureId);
    if (!measure) continue; // unknown id — never invent a penalty for it
    for (const key of [
      `${p.segmentFromKey}|${p.segmentToKey}`,
      `${p.segmentToKey}|${p.segmentFromKey}`,
    ]) {
      penalties.set(key, (penalties.get(key) ?? 1) * measure.edgePenaltyMultiplier);
    }
  }
  return penalties;
}

/** Directed-edge penalty map covering a placement's segment, BOTH
 *  directions — a physical obstacle blocks travel either way. */
function buildEdgePenalties(segs: GroupedPlacement[], multiplier: number): Map<string, number> {
  const penalties = new Map<string, number>();
  for (const s of segs) {
    penalties.set(`${s.segmentFromKey}|${s.segmentToKey}`, multiplier);
    penalties.set(`${s.segmentToKey}|${s.segmentFromKey}`, multiplier);
  }
  return penalties;
}

/** Does the extracted best-path still cross one of this measure's own
 *  placement edges? If so, the search was forced through it even under the
 *  measure's own (large) penalty — proof there is no alternate topology, so
 *  no cheaper bypass exists at all. */
function pathCrossesPlacement(path: string[] | null, segs: GroupedPlacement[]): boolean {
  if (!path || path.length < 2) return false;
  const edgeSet = new Set<string>();
  for (const s of segs) {
    edgeSet.add(`${s.segmentFromKey}|${s.segmentToKey}`);
    edgeSet.add(`${s.segmentToKey}|${s.segmentFromKey}`);
  }
  for (let i = 0; i < path.length - 1; i++) {
    if (edgeSet.has(`${path[i]}|${path[i + 1]}`)) return true;
  }
  return false;
}

/** The measure's own immediate footprint — its placement cells plus their
 *  hex neighbours — used only to define "outside the obstacle's own
 *  vicinity" for the egress-safety check below. */
function placementFootprint(
  cellsByKey: Map<string, MobilityGridCell>,
  segs: GroupedPlacement[]
): Set<string> {
  const footprint = new Set<string>();
  for (const s of segs) {
    footprint.add(s.segmentFromKey);
    footprint.add(s.segmentToKey);
    for (const key of [s.segmentFromKey, s.segmentToKey]) {
      const cell = cellsByKey.get(key);
      if (!cell) continue;
      for (const nHex of hexNeighbors(cell.hex)) footprint.add(hexKey(nHex));
    }
  }
  return footprint;
}

/**
 * REAL computation, not a hardcoded `true`: reuses the exhaustive
 * multi-source reachability field already produced for T1 (the search runs
 * to exhaustion over the whole grid, not just to the objective — see
 * `runAccumulatedCostSearch`'s module note) to ask whether the origin AOI can
 * still reach at least one cell outside the measure's own immediate
 * footprint with the measure in place. If not, the measure would box in the
 * origin's own people and must be refused, per docs §5 / §15.4.
 */
function checkEgressSafety(
  reachBestWithMeasure: Map<string, { timeSeconds: number; estimated: boolean }>,
  originKeys: string[],
  footprint: Set<string>
): { egressSafe: boolean; egressWarning: string | null } {
  const originSet = new Set(originKeys);
  let canReachOutside = false;
  for (const [key, val] of reachBestWithMeasure) {
    if (originSet.has(key)) continue;
    if (footprint.has(key)) continue;
    if (isFinite(val.timeSeconds)) {
      canReachOutside = true;
      break;
    }
  }
  if (!canReachOutside) {
    return {
      egressSafe: false,
      egressWarning:
        'With this measure placed, the origin area has no computed route to any ground ' +
        "outside the obstacle's own immediate footprint — it would trap friendly egress. " +
        'Refused: do not place without a verified alternate egress route.',
    };
  }
  return { egressSafe: true, egressWarning: null };
}

/**
 * Score a set of proposed counter-measure placements against the same
 * area-to-area accumulated-cost search the rest of this mode uses. One
 * ledger entry per distinct `measureId` in `placements` (a measure placed at
 * several segments — e.g. an abatis sited "several in depth", docs §5 — is
 * scored as one combined set, its relativeCost summed across placements).
 *
 * Every field is derived from an actual `runAccumulatedCostSearch` call —
 * never fabricated. See module note for the bypass rule and egress gate.
 */
export function computeDelayLedger(
  cells: MobilityGridCell[],
  originKeys: string[],
  objectiveKeys: string[],
  profile: MoverProfile,
  nightMode: boolean,
  measures: CounterMeasure[],
  placements: CounterMeasurePlacement[]
): DelayLedgerEntry[] {
  const cellsByKey = new Map(cells.map(c => [c.key, c]));
  const measuresById = new Map(measures.map(m => [m.id, m]));

  // T0 — baseline best time, origin AOI -> objective AOI, no measures at all.
  const baseline: AccumulatedCostSearchResult = runAccumulatedCostSearch(cells, originKeys, profile, nightMode);
  const t0 = minObjectiveTime(baseline.best, objectiveKeys);

  const grouped = new Map<string, GroupedPlacement[]>();
  for (const p of placements) {
    const arr = grouped.get(p.measureId) ?? [];
    arr.push({ segmentFromKey: p.segmentFromKey, segmentToKey: p.segmentToKey });
    grouped.set(p.measureId, arr);
  }

  const entries: DelayLedgerEntry[] = [];

  for (const [measureId, segs] of grouped) {
    const measure = measuresById.get(measureId);
    if (!measure) continue; // unknown measure id — never fabricate an entry for it

    const relativeCost = measure.relativeEmplacementEffort * segs.length;

    if (!isFinite(t0)) {
      // Objective is unreachable for this profile even before any measure is
      // placed — there is no baseline route to compare against, so the
      // bypass question is genuinely meaningless (this is the one case
      // `bypassDelaySeconds` is null for, per the field's contract above).
      entries.push({
        measure,
        delayImposedSeconds: 0,
        bypassDelaySeconds: null,
        relativeCost,
        delayPerEffortUnit: 0,
        egressSafe: false,
        egressWarning:
          'Objective is unreachable for this profile even before any measure is placed — ' +
          'no baseline route exists to evaluate delay or egress against.',
        objectiveUnreachable: true,
      });
      continue;
    }

    // T1 — best time WITH this measure's own edgePenaltyMultiplier applied
    // to its placement edges, both directions.
    const blockPenalties = buildEdgePenalties(segs, measure.edgePenaltyMultiplier);
    const blockedSearch = runAccumulatedCostSearch(cells, originKeys, profile, nightMode, {
      edgePenalties: blockPenalties,
    });
    const rawT1 = minObjectiveTime(blockedSearch.best, objectiveKeys);
    const t1Unreachable = !isFinite(rawT1);
    const t1 = t1Unreachable ? NEAR_INFINITE_SECONDS : rawT1;
    const delayImposedSeconds = Math.max(0, t1 - t0);

    // Bypass rule: does the best path under the (near-)blocking penalty
    // still cross this measure's own placement edge? If so, no alternate
    // topology exists at all, so report the same figure rather than a
    // fabricated smaller one.
    const path = extractPath(blockedSearch, objectiveKeys);
    const noAlternateExists = pathCrossesPlacement(path, segs);

    let bypassDelaySeconds: number;
    if (noAlternateExists) {
      bypassDelaySeconds = delayImposedSeconds;
    } else {
      const bypassPenalties = buildEdgePenalties(segs, BYPASS_KNOWN_GROUND_MULTIPLIER);
      const bypassSearch = runAccumulatedCostSearch(cells, originKeys, profile, nightMode, {
        edgePenalties: bypassPenalties,
      });
      const rawBypass = minObjectiveTime(bypassSearch.best, objectiveKeys);
      const bypassTime = isFinite(rawBypass) ? rawBypass : NEAR_INFINITE_SECONDS;
      bypassDelaySeconds = Math.max(0, bypassTime - t0);
    }

    const delayPerEffortUnit = relativeCost > 0 ? delayImposedSeconds / relativeCost : 0;

    const footprint = placementFootprint(cellsByKey, segs);
    const egress = checkEgressSafety(blockedSearch.best, originKeys, footprint);

    entries.push({
      measure,
      delayImposedSeconds,
      bypassDelaySeconds,
      relativeCost,
      delayPerEffortUnit,
      egressSafe: egress.egressSafe,
      egressWarning: egress.egressWarning,
      objectiveUnreachable: t1Unreachable,
    });
  }

  return entries;
}
