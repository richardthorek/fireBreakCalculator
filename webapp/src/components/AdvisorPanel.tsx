/**
 * Plan Assistant panel.
 *
 * The narrative layer over the analyses: ranked insight cards (hazards, fuel
 * pockets, data caveats, crewing strategy) each with a one-tap action, plus the
 * route optimizer — run, compare original vs optimized on real numbers, then
 * apply or dismiss. The assistant only ever explains data the analyses
 * produced; estimated data is always labelled.
 */

import React from 'react';
import { AlertTriangle, AlertOctagon, Lightbulb, Info, Crosshair, Route, Check, X, LoaderCircle } from 'lucide-react';
import { PlanAssessment, PlanInsight } from '../utils/planInsights';
import { OptimizedRouteResult } from '../utils/routeOptimizer';
import { formatChainage } from '../utils/chainage';

export type OptimizerStatus = 'idle' | 'running' | 'done' | 'error';

interface AdvisorPanelProps {
  assessment: PlanAssessment | null;
  hasLine: boolean;
  onLocate?: (startM: number, endM: number) => void;
  /** Route optimizer wiring */
  optimizerStatus: OptimizerStatus;
  optimizerProgress?: number;
  optimizerPhase?: string;
  optimizerResult?: OptimizedRouteResult | null;
  optimizerError?: string | null;
  onOptimize?: () => void;
  onApplyOptimized?: () => void;
  onDismissOptimized?: () => void;
}

const severityIcon = (severity: PlanInsight['severity']) => {
  const props = { size: 16, strokeWidth: 2, 'aria-hidden': true } as const;
  switch (severity) {
    case 'critical': return <AlertOctagon {...props} />;
    case 'warning': return <AlertTriangle {...props} />;
    case 'advice': return <Lightbulb {...props} />;
    default: return <Info {...props} />;
  }
};

const severityLabel: Record<PlanInsight['severity'], string> = {
  critical: 'Critical',
  warning: 'Caution',
  advice: 'Recommendation',
  info: 'Note',
};

/** Phase-aware progress messages: plain language instead of algorithm jargon. */
const phaseMessage = (phase?: string, progress?: number): string => {
  switch (phase) {
    case 'grid': return 'Laying out a survey grid over your corridor…';
    case 'terrain': return 'Reading terrain and vegetation…';
    case 'search':
      if (!progress) return 'Testing possible paths…';
      if (progress < 0.34) return 'Wide scan — exploring broadly…';
      if (progress < 0.67) return 'Refining — narrowing in on the best…';
      return 'Polishing — fine-tuning…';
    default: return 'Optimizing…';
  }
};

const StatDelta: React.FC<{ label: string; before: string; after: string; better: boolean | null }> = ({ label, before, after, better }) => (
  <div className={`optimizer-stat${better === true ? ' better' : better === false ? ' worse' : ''}`}>
    <span className="optimizer-stat-label">{label}</span>
    <span className="optimizer-stat-values">
      <span className="optimizer-stat-before">{before}</span>
      <span className="optimizer-stat-arrow" aria-hidden>→</span>
      <span className="optimizer-stat-after">{after}</span>
    </span>
  </div>
);

export const AdvisorPanel: React.FC<AdvisorPanelProps> = ({
  assessment,
  hasLine,
  onLocate,
  optimizerStatus,
  optimizerProgress = 0,
  optimizerPhase,
  optimizerResult,
  optimizerError,
  onOptimize,
  onApplyOptimized,
  onDismissOptimized,
}) => {
  if (!hasLine) {
    return (
      <div className="advisor-empty">
        <Route size={28} strokeWidth={1.5} aria-hidden />
        <p>Draw a fire-break line and the assistant will assess hazards, fuel pockets and crewing options — and search for a smarter path.</p>
      </div>
    );
  }

  const result = optimizerResult;

  return (
    <div className="advisor-panel">
      {/* Route optimizer card */}
      <div className="optimizer-card">
        <div className="optimizer-card-header">
          <Route size={18} strokeWidth={2} aria-hidden />
          <div>
            <h5>Route optimization</h5>
            <p className="optimizer-caption">
              Searches the corridor around your line for a path that avoids steep ground and heavy timber.
            </p>
          </div>
        </div>

        {optimizerStatus === 'idle' && (
          <button type="button" className="optimizer-run-btn" onClick={onOptimize}>
            Find smarter path
          </button>
        )}

        {optimizerStatus === 'running' && (
          <div className="optimizer-progress" role="status">
            <LoaderCircle className="optimizer-spinner" size={16} aria-hidden />
            <span>{phaseMessage(optimizerPhase, optimizerProgress)} {Math.round(optimizerProgress * 100)}%</span>
          </div>
        )}

        {optimizerStatus === 'error' && (
          <div className="optimizer-error" role="alert">
            {optimizerError || 'Optimization failed — try again.'}
            <button type="button" className="optimizer-run-btn" onClick={onOptimize}>Retry</button>
          </div>
        )}

        {optimizerStatus === 'done' && result && (
          <div className="optimizer-result">
            <div className={`optimizer-verdict${result.improvement > 0.03 ? ' positive' : ''}`}>
              {result.improvement > 0.03
                ? `Found a path ~${Math.round(result.improvement * 100)}% easier to build`
                : result.improvement > -0.001
                  ? 'Your line is already close to optimal in this corridor'
                  : 'This path is slightly harder to build'}
            </div>
            {result.heatmap.length > 0 && (
              <div className="heatmap-legend">
                <span className="heatmap-legend-title">Corridor scan</span>
                <span className="heatmap-legend-gradient" aria-hidden />
                <span className="heatmap-legend-labels">
                  <span>Easy going</span>
                  <span>Steep / heavy fuel</span>
                </span>
              </div>
            )}
            <div className="optimizer-stats">
              <StatDelta
                label="Length"
                before={formatChainage(result.original.distance)}
                after={formatChainage(result.optimized.distance)}
                better={result.optimized.distance <= result.original.distance ? true : null}
              />
              <StatDelta
                label="Max slope"
                before={`${Math.round(result.original.maxSlope)}°`}
                after={`${Math.round(result.optimized.maxSlope)}°`}
                better={result.optimized.maxSlope < result.original.maxSlope ? true : result.optimized.maxSlope > result.original.maxSlope ? false : null}
              />
              <StatDelta
                label="Steep ground"
                before={formatChainage(result.original.steepDistance)}
                after={formatChainage(result.optimized.steepDistance)}
                better={result.optimized.steepDistance < result.original.steepDistance ? true : result.optimized.steepDistance > result.original.steepDistance ? false : null}
              />
              <StatDelta
                label="Heavy timber"
                before={formatChainage(result.original.heavyForestDistance)}
                after={formatChainage(result.optimized.heavyForestDistance)}
                better={result.optimized.heavyForestDistance < result.original.heavyForestDistance ? true : result.optimized.heavyForestDistance > result.original.heavyForestDistance ? false : null}
              />
              {(result.optimized.existingTrailDistance > 0 || result.original.existingTrailDistance > 0) && (
                <StatDelta
                  label="Existing trail used"
                  before={formatChainage(result.original.existingTrailDistance)}
                  after={formatChainage(result.optimized.existingTrailDistance)}
                  better={result.optimized.existingTrailDistance > result.original.existingTrailDistance ? true : result.optimized.existingTrailDistance < result.original.existingTrailDistance ? false : null}
                />
              )}
            </div>
            {result.optimized.existingTrailDistance > 0 && (
              <p className="optimizer-hint">
                Reused trails are OSM-mapped — verify trafficability on the ground before relying on them.
              </p>
            )}
            {!result.infrastructureAvailable && (
              <p className="optimizer-hint">
                Trail data was unavailable — this search used terrain and fuel only, so mapped trails may exist that it couldn't see.
              </p>
            )}
            {result.usedEstimatedData && (
              <div className="optimizer-estimated-note" role="alert">
                ⚠️ Parts of the corridor used estimated data — verify the suggested path on the ground.
              </div>
            )}
            <div className="optimizer-actions">
              {result.coords.length > 0 && (
                <button type="button" className="optimizer-apply-btn" onClick={onApplyOptimized}>
                  <Check size={14} strokeWidth={2.5} aria-hidden /> Apply optimized route
                </button>
              )}
              <button type="button" className="optimizer-dismiss-btn" onClick={onDismissOptimized}>
                <X size={14} strokeWidth={2.5} aria-hidden /> Dismiss
              </button>
            </div>
            <p className="optimizer-hint">The dashed amber line on the map previews the optimized path. Applying it re-runs the full analysis.</p>
          </div>
        )}
      </div>

      {/* Insight cards */}
      {assessment && assessment.insights.length > 0 ? (
        <div className="insight-list">
          {assessment.insights.map(insight => (
            <div key={insight.id} className={`insight-card severity-${insight.severity}`}>
              <div className="insight-card-header">
                <span className="insight-icon">{severityIcon(insight.severity)}</span>
                <span className="insight-severity">{severityLabel[insight.severity]}</span>
                <span className="insight-title">{insight.title}</span>
              </div>
              <p className="insight-detail">{insight.detail}</p>
              <div className="insight-actions">
                {insight.action === 'locate' && insight.chainage && onLocate && (
                  <button
                    type="button"
                    className="insight-action-btn"
                    onClick={() => onLocate(insight.chainage!.startM, insight.chainage!.endM)}
                  >
                    <Crosshair size={13} strokeWidth={2} aria-hidden /> Show on map
                  </button>
                )}
                {insight.action === 'optimize' && onOptimize && optimizerStatus !== 'running' && (
                  <button type="button" className="insight-action-btn" onClick={onOptimize}>
                    <Route size={13} strokeWidth={2} aria-hidden /> Optimize route
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="advisor-empty-insights">Assessment pending — waiting for terrain and vegetation analysis.</div>
      )}
    </div>
  );
};

export default AdvisorPanel;
