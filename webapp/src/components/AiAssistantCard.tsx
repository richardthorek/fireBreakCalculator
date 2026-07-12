/**
 * AI assistant card: one-shot field briefing + grounded Q&A over the current
 * plan. Purely additive to the deterministic Plan Assistant — never blocks or
 * replaces the rule-based insight cards, and degrades to a clear
 * "unavailable" state whenever the backend has no model configured or a
 * response fails the grounding check (see docs/AI_ASSISTANT.md).
 *
 * Every AI-sourced answer is visually labelled and never mixed with the
 * deterministic template/unavailable states, so a firefighter always knows
 * which kind of output they're reading.
 */

import React, { useState } from 'react';
import { Sparkles, Send, LoaderCircle, FileText } from 'lucide-react';
import { AssistantPayload, AssistantResponse, fetchBriefing, askAssistant } from '../utils/assistantApi';

interface AiAssistantCardProps {
  payload: AssistantPayload | null;
}

type RequestStatus = 'idle' | 'loading' | 'done' | 'error';

interface ChatTurn {
  question: string;
  response: AssistantResponse;
}

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

export const AiAssistantCard: React.FC<AiAssistantCardProps> = ({ payload }) => {
  const [briefingStatus, setBriefingStatus] = useState<RequestStatus>('idle');
  const [briefing, setBriefing] = useState<AssistantResponse | null>(null);

  const [question, setQuestion] = useState('');
  const [chatStatus, setChatStatus] = useState<RequestStatus>('idle');
  const [turns, setTurns] = useState<ChatTurn[]>([]);

  if (!payload) return null;

  const handleBriefing = async () => {
    setBriefingStatus('loading');
    const result = await fetchBriefing(payload);
    if (result) {
      setBriefing(result);
      setBriefingStatus('done');
    } else {
      setBriefingStatus('error');
    }
  };

  const handleAsk = async () => {
    const q = question.trim();
    if (!q || chatStatus === 'loading') return;
    setChatStatus('loading');
    const history = turns.slice(-3).flatMap((t) => [
      { role: 'user' as const, content: t.question },
      { role: 'assistant' as const, content: t.response.text },
    ]);
    const result = await askAssistant(payload, q, history);
    if (result) {
      setTurns((prev) => [...prev, { question: q, response: result }]);
      setQuestion('');
      setChatStatus('idle');
    } else {
      setChatStatus('error');
    }
  };

  return (
    <div className="ai-assistant-card">
      <div className="ai-assistant-header">
        <Sparkles size={17} strokeWidth={2} aria-hidden />
        <div>
          <h5>AI briefing &amp; questions</h5>
          <p className="ai-assistant-caption">
            Narrates the analysis above in plain language and cites doctrine — it never computes its own numbers.
          </p>
        </div>
      </div>

      {briefingStatus === 'idle' && (
        <button type="button" className="ai-briefing-btn" onClick={handleBriefing}>
          <FileText size={14} strokeWidth={2} aria-hidden /> Generate briefing
        </button>
      )}
      {briefingStatus === 'loading' && (
        <div className="ai-loading" role="status">
          <LoaderCircle className="ai-spinner" size={15} aria-hidden />
          <span>Drafting briefing…</span>
        </div>
      )}
      {briefingStatus === 'error' && (
        <div className="ai-loading">
          <span>Briefing unavailable right now.</span>
          <button type="button" className="ai-briefing-btn" onClick={handleBriefing}>Retry</button>
        </div>
      )}
      {briefingStatus === 'done' && briefing && (
        <div className="ai-briefing-result">
          <SourceBadge source={briefing.source} />
          <p className="ai-briefing-text">{briefing.text}</p>
          <CitationChips citations={briefing.citations} />
          <button type="button" className="ai-briefing-regenerate" onClick={handleBriefing}>Regenerate</button>
        </div>
      )}

      <div className="ai-chat">
        {turns.map((t, i) => (
          <div key={i} className="ai-chat-turn">
            <div className="ai-chat-question">{t.question}</div>
            <div className="ai-chat-answer">
              <SourceBadge source={t.response.source} />
              <p>{t.response.text}</p>
              <CitationChips citations={t.response.citations} />
            </div>
          </div>
        ))}
        <div className="ai-chat-input-row">
          <input
            type="text"
            className="ai-chat-input"
            placeholder="Ask about this plan…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAsk(); }}
            maxLength={500}
            aria-label="Ask the assistant about this plan"
          />
          <button
            type="button"
            className="ai-chat-send"
            onClick={handleAsk}
            disabled={chatStatus === 'loading' || !question.trim()}
            aria-label="Send question"
          >
            {chatStatus === 'loading' ? <LoaderCircle className="ai-spinner" size={15} aria-hidden /> : <Send size={15} strokeWidth={2} aria-hidden />}
          </button>
        </div>
        {chatStatus === 'error' && <div className="ai-chat-error">Couldn't reach the assistant — try again.</div>}
      </div>
    </div>
  );
};

export default AiAssistantCard;
