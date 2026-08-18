/**
 * "Col" field reality check: an experienced heavy-plant/hand-crew veteran's
 * grounded sanity check on the current plan, run BEFORE it reaches a real
 * crew or operator — the point being that the field veteran's scepticism
 * lives in the tool, not that it needs a Col standing over every desk
 * decision. Same grounding contract and source-badging as AiAssistantCard
 * (never computes its own numbers, always cites, degrades to a deterministic
 * template) — a different persona/framing over the identical guardrails, not
 * a looser one. See docs/AI_ASSISTANT.md §6 and CALCULATION_REVIEW.md.
 */

import React, { useState } from 'react';
import { HardHat, LoaderCircle } from 'lucide-react';
import { AssistantPayload, AssistantResponse, fetchRealityCheck } from '../utils/assistantApi';

interface RealityCheckCardProps {
  payload: AssistantPayload | null;
}

type RequestStatus = 'idle' | 'loading' | 'done' | 'error';

const SOURCE_LABEL: Record<AssistantResponse['source'], string> = {
  ai: "Col — AI critique, grounded in this plan's own data",
  template: 'Template reality check (no AI model — the flags below are still real)',
  unavailable: 'Reality check unavailable',
};

export const RealityCheckCard: React.FC<RealityCheckCardProps> = ({ payload }) => {
  const [status, setStatus] = useState<RequestStatus>('idle');
  const [result, setResult] = useState<AssistantResponse | null>(null);

  if (!payload) return null;

  const flagCount =
    (payload.estimatedData ? 1 : 0) +
    (payload.lowConfidenceSegmentCount ? 1 : 0) +
    (payload.equipmentCaveats?.length ? 1 : 0) +
    (payload.mobilisationCostIncluded === false ? 1 : 0);

  const handleRun = async () => {
    setStatus('loading');
    const r = await fetchRealityCheck(payload);
    if (r) {
      setResult(r);
      setStatus('done');
    } else {
      setStatus('error');
    }
  };

  return (
    <div className="reality-check-card">
      <div className="reality-check-header">
        <HardHat size={17} strokeWidth={2} aria-hidden />
        <div>
          <h5>Field reality check</h5>
          <p className="reality-check-caption">
            A blunt, grounded sanity check on this plan before it reaches a crew or operator — flags what's
            estimated, low-confidence, or unverified in the numbers above. It never computes its own figures.
          </p>
        </div>
      </div>

      {status === 'idle' && (
        <button type="button" className="reality-check-btn" onClick={handleRun}>
          <HardHat size={14} strokeWidth={2} aria-hidden />
          Run reality check{flagCount > 0 ? ` (${flagCount} flag${flagCount === 1 ? '' : 's'} to check)` : ''}
        </button>
      )}
      {status === 'loading' && (
        <div className="reality-check-loading" role="status">
          <LoaderCircle className="ai-spinner" size={15} aria-hidden />
          <span>Checking the plan…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="reality-check-loading">
          <span>Reality check unavailable right now.</span>
          <button type="button" className="reality-check-btn" onClick={handleRun}>Retry</button>
        </div>
      )}
      {status === 'done' && result && (
        <div className="reality-check-result">
          <span className={`ai-source-badge ai-source-${result.source}`}>{SOURCE_LABEL[result.source]}</span>
          <p className="reality-check-text">{result.text}</p>
          {result.citations.length > 0 && (
            <div className="ai-citations" aria-label="Cited references">
              {result.citations.map((c) => (
                <span key={c.id} className="ai-citation-chip" title={c.source}>{c.title}</span>
              ))}
            </div>
          )}
          <button type="button" className="ai-briefing-regenerate" onClick={handleRun}>Re-run</button>
        </div>
      )}
    </div>
  );
};

export default RealityCheckCard;
