/**
 * Counter-mobility planner panel — Terrain Mobility & Counter-Mobility mode,
 * Pass 2 (docs/ROUTE_INTELLIGENCE.md §5, §11.5, §15.2, §15.4).
 *
 * Mirrors MobilityPanel.tsx's convention exactly: this component renders,
 * the parent (App.tsx, wired up in a later pass) owns all state and passes
 * it in as props/callbacks. Candidate placement locations are the min-cut
 * siting hint (`MinCutResult.segments`, passed in as `barrierSegments`) —
 * this panel does not resite anything, it only lets the user choose which
 * catalogue measure to place at which already-computed candidate segment,
 * then renders the resulting `DelayLedgerEntry[]` the parent computed via
 * `computeDelayLedger`.
 *
 * THE BYPASS RULE is rendered as non-negotiable UI, not an afterthought:
 * bypass delay is always shown directly adjacent to delay imposed, never
 * behind a click-through, per docs §5's "never show a measure's delay
 * without the bypass it opens" framing.
 *
 * THE EGRESS-SAFETY GATE is a REFUSAL in this UI, not a warning icon: a
 * measure whose `egressSafe` is false has its "Add to plan" action replaced
 * entirely by a refusal banner. Docs §5 / §15.4 are explicit that this gate
 * is unconditional — there is deliberately no override control here.
 */

import React from 'react';
import { COUNTER_MEASURES, CounterMeasure, ObstacleEffect } from '../terrain/counterMeasures';
import { BarrierSegment } from '../terrain/minCutBarrier';
import { DelayLedgerEntry, CounterMeasurePlacement } from '../terrain/delayLedger';
import { CorridorComparison } from '../terrain/corridorField';
import { DataConfidenceBadge } from './DataConfidenceBadge';

export interface CounterMobilityPanelProps {
  /** Defaults to the full built-in catalogue if omitted. */
  measures?: CounterMeasure[];
  /** Candidate barrier locations — typically `MinCutResult.segments` from
   *  `computeMinCutBarrier`, the existing "cheapest place to put a barrier"
   *  siting hint. This panel does not compute siting itself. */
  barrierSegments: BarrierSegment[];
  /** Which candidate segment is currently selected in the placement picker,
   *  index into `barrierSegments`, or null if none chosen yet. Controlled
   *  by the parent so the whole panel stays a plain controlled component. */
  pendingSegmentIndex: number | null;
  onPendingSegmentIndexChange: (index: number | null) => void;
  /** The set of measure placements proposed so far (not yet scored). */
  placements: CounterMeasurePlacement[];
  onPlacementsChange: (next: CounterMeasurePlacement[]) => void;
  /** Ask the parent to run `computeDelayLedger` over the current
   *  `placements` and populate `ledger`. This panel never runs the search
   *  itself — it has no access to the sampled grid/profile. */
  onRunLedger: () => void;
  running: boolean;
  ledger: DelayLedgerEntry[] | null;
  /** Measure ids the caller has already accepted into the working plan —
   *  used only to grey out an already-added row's action. */
  addedMeasureIds: string[];
  onAddToPlan: (measureId: string) => void;
  /** Baseline-vs-scenario corridor diff, computed alongside the ledger — what
   *  the emplaced measure SET does to the movement picture as a whole, which
   *  is not the sum of the per-measure rows above (docs §28). */
  corridorComparison?: CorridorComparison | null;
  /** Which corridor picture the map is currently drawing, and a way to flip
   *  it — the iterative propose → assess → revise loop. */
  corridorView?: 'baseline' | 'scenario';
  onCorridorViewChange?: (view: 'baseline' | 'scenario') => void;
}

const EFFECT_LABEL: Record<ObstacleEffect, string> = {
  disrupt: 'DISRUPT',
  turn: 'TURN',
  fix: 'FIX',
  block: 'BLOCK',
};

const EffectBadge: React.FC<{ effect: ObstacleEffect }> = ({ effect }) => (
  <span className={`cm-effect-badge cm-effect-${effect}`}>{EFFECT_LABEL[effect]}</span>
);

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function segmentLabel(seg: BarrierSegment, index: number): string {
  return `Segment ${index + 1}: ${seg.from.lat.toFixed(4)},${seg.from.lng.toFixed(4)} → ${seg.to.lat.toFixed(4)},${seg.to.lng.toFixed(4)}`;
}

/** Sort viable (egress-safe) entries by delay-per-effort descending — the
 *  ranking metric docs §5 asks for ("rank packages by minutes of delay per
 *  machine-hour / per dollar") — with any refused entries pushed to the
 *  bottom rather than mixed into the ranking. */
function sortLedger(entries: DelayLedgerEntry[]): DelayLedgerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.egressSafe !== b.egressSafe) return a.egressSafe ? -1 : 1;
    return b.delayPerEffortUnit - a.delayPerEffortUnit;
  });
}

export const CounterMobilityPanel: React.FC<CounterMobilityPanelProps> = ({
  measures = COUNTER_MEASURES,
  barrierSegments,
  pendingSegmentIndex,
  onPendingSegmentIndexChange,
  placements,
  onPlacementsChange,
  onRunLedger,
  running,
  ledger,
  addedMeasureIds,
  onAddToPlan,
  corridorComparison = null,
  corridorView = 'baseline',
  onCorridorViewChange,
}) => {
  const measuresById = new Map(measures.map(m => [m.id, m]));
  const canAddPlacement = pendingSegmentIndex !== null && barrierSegments.length > 0;

  const handleAddPlacement = (measureId: string) => {
    if (pendingSegmentIndex === null) return;
    const seg = barrierSegments[pendingSegmentIndex];
    if (!seg) return;
    onPlacementsChange([
      ...placements,
      { measureId, segmentFromKey: seg.fromKey, segmentToKey: seg.toKey },
    ]);
  };

  const handleRemovePlacement = (index: number) => {
    onPlacementsChange(placements.filter((_, i) => i !== index));
  };

  const sortedLedger = ledger ? sortLedger(ledger) : null;

  return (
    <div className="tac-panel mobility-panel">
      <div className="tac-label">COUNTER-MOBILITY PLANNER</div>

      <div className="tac-panel mobility-section">
        <div className="tac-label">CANDIDATE BARRIER SEGMENT</div>
        {barrierSegments.length === 0 ? (
          <div className="mobility-caveat tac-mono">
            NO MIN-CUT SEGMENTS SUPPLIED — RUN THE MOBILITY MIN-CUT FIRST TO SITE CANDIDATES
          </div>
        ) : (
          <select
            className="cm-placement-select tac-mono"
            value={pendingSegmentIndex ?? ''}
            onChange={e =>
              onPendingSegmentIndexChange(e.target.value === '' ? null : Number(e.target.value))
            }
          >
            <option value="">Select candidate segment…</option>
            {barrierSegments.map((seg, i) => (
              <option key={`${seg.fromKey}-${seg.toKey}`} value={i}>
                {segmentLabel(seg, i)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="tac-panel mobility-section">
        <div className="tac-label">MEASURE CATALOGUE</div>
        {measures.map(measure => (
          <div key={measure.id} className="cm-measure-card">
            <div className="cm-measure-header">
              <span className="tac-mono">{measure.label}</span>
              <EffectBadge effect={measure.effect} />
              <DataConfidenceBadge tier={measure.confidence} />
            </div>
            <div className="mobility-profile-notes tac-mono">{measure.notes}</div>
            <div className="mobility-profile-source tac-mono">{measure.source}</div>
            <div className="cm-ledger-figures tac-mono">
              <div>OBSTRUCTION x{measure.edgePenaltyMultiplier >= 1e5 ? 'NEAR-TOTAL' : measure.edgePenaltyMultiplier}</div>
              <div>EFFORT {measure.relativeEmplacementEffort.toFixed(1)} crew-hr equiv.</div>
              <div>{measure.reversible ? 'REVERSIBLE' : 'NOT REVERSIBLE'}</div>
              <div>{measure.geometry.toUpperCase()} GEOMETRY</div>
            </div>
            {measure.legalPrerequisites.length > 0 && (
              <ul className="cm-legal-list tac-mono">
                {measure.legalPrerequisites.map((req, i) => (
                  <li key={i}>{req}</li>
                ))}
              </ul>
            )}
            <button
              className="mobility-aoi-button"
              disabled={!canAddPlacement}
              onClick={() => handleAddPlacement(measure.id)}
            >
              Add placement at selected segment
            </button>
          </div>
        ))}
      </div>

      {placements.length > 0 && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">PLANNED PLACEMENTS</div>
          {placements.map((p, i) => {
            const m = measuresById.get(p.measureId);
            return (
              <div key={i} className="cm-placement-row tac-mono">
                <span>
                  {m ? m.label : p.measureId} @ {p.segmentFromKey} → {p.segmentToKey}
                </span>
                <button className="mobility-clear-button" onClick={() => handleRemovePlacement(i)}>
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mobility-run-row">
        <button
          className="mobility-run-button"
          disabled={placements.length === 0 || running}
          onClick={onRunLedger}
        >
          {running ? 'Computing delay ledger…' : 'Compute delay ledger'}
        </button>
      </div>

      {sortedLedger && sortedLedger.length > 0 && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">DELAY LEDGER</div>
          {sortedLedger.map(entry => {
            const alreadyAdded = addedMeasureIds.includes(entry.measure.id);
            const noCheaperBypass =
              entry.bypassDelaySeconds !== null && entry.bypassDelaySeconds === entry.delayImposedSeconds;
            return (
              <div
                key={entry.measure.id}
                className={`cm-ledger-row${entry.egressSafe ? '' : ' cm-ledger-row--refused'}`}
              >
                <div className="cm-measure-header">
                  <span className="tac-mono">{entry.measure.label}</span>
                  <EffectBadge effect={entry.measure.effect} />
                  <DataConfidenceBadge tier={entry.measure.confidence} />
                </div>
                <div className="cm-ledger-figures tac-mono">
                  <div>
                    DELAY IMPOSED: {formatDuration(entry.delayImposedSeconds)}
                    {entry.objectiveUnreachable && ' (SENTINEL — OBJECTIVE EFFECTIVELY UNREACHABLE)'}
                  </div>
                  <div>
                    BYPASS: {entry.bypassDelaySeconds === null
                      ? 'N/A — OBJECTIVE UNREACHABLE AT BASELINE'
                      : formatDuration(entry.bypassDelaySeconds)}
                    {noCheaperBypass && ' (NO CHEAPER BYPASS FOUND)'}
                  </div>
                  <div>RELATIVE COST: {entry.relativeCost.toFixed(1)} crew-hr equiv.</div>
                  <div>DELAY/EFFORT: {entry.delayPerEffortUnit.toFixed(1)} s/unit</div>
                </div>
                {!entry.egressSafe ? (
                  <div className="cm-refused-banner tac-mono">
                    REFUSED — {entry.egressWarning}
                  </div>
                ) : (
                  <button
                    className="mobility-run-button"
                    disabled={alreadyAdded}
                    onClick={() => onAddToPlan(entry.measure.id)}
                  >
                    {alreadyAdded ? 'Added to plan' : 'Add to plan'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {corridorComparison && (
        <div className="tac-panel mobility-section">
          <div className="tac-label">EFFECT ON MOVEMENT CORRIDORS</div>
          <div className="tac-hint">
            The whole corridor picture, re-derived with every placement above emplaced
            together. This is not the sum of the per-measure delays — blocking two of
            three corridors pushes movement onto the third.
          </div>
          {onCorridorViewChange && (
            <div className="mobility-display-toggle">
              <button
                className={corridorView === 'baseline' ? 'active' : ''}
                onClick={() => onCorridorViewChange('baseline')}
              >
                Baseline
              </button>
              <button
                className={corridorView === 'scenario' ? 'active' : ''}
                onClick={() => onCorridorViewChange('scenario')}
              >
                With measures
              </button>
            </div>
          )}
          <div className="mobility-result-stats tac-mono">
            <div className="cm-effect-collapsed">{corridorComparison.collapsedCount} COLLAPSED</div>
            <div className="cm-effect-degraded">{corridorComparison.degradedCount} DEGRADED</div>
            <div className="cm-effect-displaced">{corridorComparison.displacedIntoCount} DISPLACED INTO</div>
            <div>{corridorComparison.newCorridors.length} NEW</div>
          </div>
          {corridorComparison.effects.map(e => (
            <div key={e.corridorId} className={`cm-corridor-effect cm-corridor-effect--${e.status}`}>
              <div className="corridor-card-head">
                <span className="corridor-rank tac-mono">CORRIDOR {e.rankBefore}</span>
                <span className={`cm-effect-status cm-effect-status--${e.status}`}>
                  {e.status.replace('-', ' ').toUpperCase()}
                </span>
              </div>
              <div className="corridor-figures tac-mono">
                <div>ROUTES {e.routeCountBefore} → {e.routeCountAfter}</div>
                <div>
                  DELAY {isFinite(e.medianDelaySeconds)
                    ? `${e.medianDelaySeconds >= 0 ? '+' : ''}${(e.medianDelaySeconds / 60).toFixed(0)} MIN`
                    : 'IMPASSABLE'}
                </div>
                <div>
                  BOTTLENECK ~{e.bottleneckWidthBeforeM.toFixed(0)} → ~{e.bottleneckWidthAfterM.toFixed(0)} M
                </div>
                <div>{e.easeBefore.toUpperCase()} → {(e.easeAfter ?? 'COLLAPSED').toUpperCase()}</div>
              </div>
            </div>
          ))}
          {corridorComparison.newCorridors.length > 0 && (
            <div className="mobility-caveat tac-mono">
              BYPASS — {corridorComparison.newCorridors.length} CORRIDOR(S) APPEARED ON GROUND THAT
              CARRIED NO MOVEMENT AT BASELINE. THE MEASURES PUSHED TRAFFIC HERE; SITE OBSERVATION
              ACCORDINGLY OR EXPECT TO BE FLANKED.
            </div>
          )}
        </div>
      )}

      <div className="mobility-limitation-panel tac-mono">
        COUNTER-MOBILITY CAVEATS: emplacement effort figures are RELATIVE rankings (a multiple
        of a reference crew-hour unit), not calibrated dollar or hour figures — a real cost
        claim needs the production-model integration this pass gates on. Breach/delay values
        are model estimates over the sampled cost surface, pending a citable operational basis
        (docs §11.5). Doctrine states obstacle effects arise from obstacles AND fires together,
        not obstacles alone — an unobserved barrier is at best DISRUPT; nothing in this
        catalogue is rated BLOCK for exactly that reason. Egress-safety refusals above are
        unconditional and cannot be overridden from this panel.
      </div>
    </div>
  );
};

export default CounterMobilityPanel;
