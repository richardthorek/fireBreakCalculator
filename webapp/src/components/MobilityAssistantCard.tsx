/**
 * AI briefing card for Terrain Mobility & Counter-Mobility results — the
 * mobility-mode counterpart to `AiAssistantCard.tsx`. Reuses that component's
 * exact CSS classes and source-badge/citation-chip presentation so the two
 * modes read as one product, not two.
 *
 * Deliberately briefing-only, no grounded chat: a one-shot plain-language
 * appreciation directly answers "a commander gets a plain-language briefing,
 * not just panels of numbers" (the corridor/chokepoint/barrier/ledger panels
 * are already the numeric detail underneath it). Open-ended Q&A over the
 * mobility payload is a natural follow-up, not built here — scoped out to
 * keep this pass to what was actually asked for.
 */

import React, { useState } from 'react';
import { Sparkles, FileText, LoaderCircle } from 'lucide-react';
import { AssistantResponse } from '../utils/assistantApi';
import { MobilityAssistantPayload, fetchMobilityBriefing } from '../utils/mobilityAssistantApi';

interface MobilityAssistantCardProps {
  payload: MobilityAssistantPayload | null;
}

type RequestStatus = 'idle' | 'loading' | 'done' | 'error';

const SOURCE_LABEL: Record<AssistantResponse['source'], string> = {
  ai: 'AI-generated — verify on the ground',
  template: 'Template summary (from the analysis, no AI)',
  unavailable: 'No grounded answer available',
};

const SourceBadge: React.FC<{ source: AssistantResponse['source'] }> = ({ source }) => (
  <span className={`ai-source-badge ai-source-${source}`}>{SOURCE_LABEL[source]}</span>
);

const CitationChips: React.FC<{ citations: AssistantResponse['citations'] }> = ({ citations }) => {
  if (citations.length === 0) return null;
  return (
    <div className="ai-citations" aria-label="Cited references">
      {citations.map((c) => (
        <span key={c.id} className="ai-citation-chip" title={c.source}>
          {c.title}
        </span>
      ))}
    </div>
  );
};

export const MobilityAssistantCard: React.FC<MobilityAssistantCardProps> = ({ payload }) => {
  const [status, setStatus] = useState<RequestStatus>('idle');
  const [briefing, setBriefing] = useState<AssistantResponse | null>(null);

  if (!payload) return null;

  const handleBriefing = async () => {
    setStatus('loading');
    const result = await fetchMobilityBriefing(payload);
    if (result) {
      setBriefing(result);
      setStatus('done');
    } else {
      setStatus('error');
    }
  };

  return (
    <div className="ai-assistant-card">
      <div className="ai-assistant-header">
        <Sparkles size={17} strokeWidth={2} aria-hidden />
        <div>
          <h5>AI appreciation briefing</h5>
          <p className="ai-assistant-caption">
            Narrates the corridors/chokepoints/counter-measure results above in plain language and cites doctrine — it never computes its own numbers.
          </p>
        </div>
      </div>

      {status === 'idle' && (
        <button type="button" className="ai-briefing-btn" onClick={handleBriefing}>
          <FileText size={14} strokeWidth={2} aria-hidden /> Generate briefing
        </button>
      )}
      {status === 'loading' && (
        <div className="ai-loading" role="status">
          <LoaderCircle className="ai-spinner" size={15} aria-hidden />
          <span>Drafting appreciation…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="ai-loading">
          <span>Briefing unavailable right now.</span>
          <button type="button" className="ai-briefing-btn" onClick={handleBriefing}>Retry</button>
        </div>
      )}
      {status === 'done' && briefing && (
        <div className="ai-briefing-result">
          <SourceBadge source={briefing.source} />
          <p className="ai-briefing-text">{briefing.text}</p>
          <CitationChips citations={briefing.citations} />
          <button type="button" className="ai-briefing-regenerate" onClick={handleBriefing}>Regenerate</button>
        </div>
      )}
    </div>
  );
};

export default MobilityAssistantCard;
