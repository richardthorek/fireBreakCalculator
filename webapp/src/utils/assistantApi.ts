/**
 * Client for the AI assistant endpoints (`/api/assistant/briefing`, `/api/assistant/chat`).
 *
 * Every call degrades gracefully: network failure, non-2xx, or malformed
 * response all resolve to `null` rather than throwing, so the UI can always
 * fall back to "assistant unavailable" without breaking the rest of the
 * Assistant tab (the deterministic rule-based insights never depend on this).
 */

import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { PlanAssessment } from './planInsights';
import { authHeader } from './suiteAuth';
import { logger } from './logger';

const baseUrl = (import.meta as any).env?.VITE_API_BASE_URL || '/api';

export interface AssistantEquipmentSummary {
  name: string;
  type: string;
  timeHours: number;
  cost: number;
  compatibilityLevel: string;
}

export interface AssistantPayload {
  distanceM: number;
  breakWidthM: number;
  maxSlopeDeg: number;
  meanSlopeDeg: number;
  predominantVegetation: string;
  vegetationConfidence: number;
  estimatedData: boolean;
  difficultyScore: number;
  difficultyLabel: string;
  topEquipment: AssistantEquipmentSummary[];
  insights: { severity: string; title: string; detail: string }[];
  // Reality-check context (optional) — must-match pair with
  // api/src/types/assistant.ts. See buildAssistantPayload's threshold for
  // lowConfidenceSegmentCount.
  segmentCount?: number;
  lowConfidenceSegmentCount?: number;
  equipmentCaveats?: string[];
  mobilisationCostIncluded?: boolean;
}

export interface AssistantCitation {
  id: string;
  title: string;
  source: string;
}

export interface AssistantResponse {
  source: 'ai' | 'template' | 'unavailable';
  text: string;
  citations: AssistantCitation[];
}

/** Segments below this confidence are called out by name to the reality-check
 * persona rather than folded into the single overallConfidence average. */
const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** Build the compact payload the assistant endpoints validate responses against. */
export function buildAssistantPayload(params: {
  distance: number;
  breakWidthMeters: number;
  trackAnalysis: TrackAnalysis | null;
  vegetationAnalysis: VegetationAnalysis | null;
  equipmentResults: { id?: string; name: string; type: string; time: number; cost: number; compatible: boolean; compatibilityLevel?: string }[];
  assessment: PlanAssessment | null;
  /** The effective equipment catalogue (with overrides applied) — joined by
   * id against topEquipment so the reality check can quote a tasked item's
   * own sourcing caveat instead of restating a generic warning. */
  equipmentCatalog?: { id: string; standard?: boolean; sourceNote?: string }[];
}): AssistantPayload {
  const { distance, breakWidthMeters, trackAnalysis, vegetationAnalysis, equipmentResults, assessment, equipmentCatalog } = params;
  const topResults = equipmentResults
    .filter((r) => r.compatible && r.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(0, 3);
  const topEquipment: AssistantEquipmentSummary[] = topResults
    .map((r) => ({ name: r.name, type: r.type, timeHours: Math.round(r.time * 10) / 10, cost: Math.round(r.cost), compatibilityLevel: r.compatibilityLevel ?? 'full' }));

  const catalogById = new Map((equipmentCatalog ?? []).map((e) => [e.id, e]));
  const equipmentCaveats = topResults
    .map((r) => (r.id ? catalogById.get(r.id) : undefined))
    .filter((e): e is { id: string; standard?: boolean; sourceNote?: string } => !!e?.standard && !!e.sourceNote)
    .map((e) => e.sourceNote as string);

  const segments = vegetationAnalysis?.segments ?? [];
  const lowConfidenceSegmentCount = segments.filter((s) => (s.confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD).length;

  return {
    distanceM: Math.round(distance),
    breakWidthM: breakWidthMeters,
    maxSlopeDeg: trackAnalysis ? Math.round(trackAnalysis.maxSlope * 10) / 10 : 0,
    meanSlopeDeg: trackAnalysis ? Math.round(trackAnalysis.averageSlope * 10) / 10 : 0,
    predominantVegetation: vegetationAnalysis?.predominantVegetation ?? 'unknown',
    vegetationConfidence: vegetationAnalysis ? Math.round(vegetationAnalysis.overallConfidence * 100) / 100 : 0,
    estimatedData: !!(trackAnalysis?.usedMockElevation || vegetationAnalysis?.usedFallbackData),
    difficultyScore: assessment?.difficultyScore ?? 0,
    difficultyLabel: assessment?.difficultyLabel ?? 'Unknown',
    topEquipment,
    insights: (assessment?.insights ?? []).slice(0, 5).map((i) => ({ severity: i.severity, title: i.title, detail: i.detail })),
    segmentCount: trackAnalysis?.segments.length,
    lowConfidenceSegmentCount,
    equipmentCaveats,
    // Always false today: the cost model has no fixed/variable mobilisation
    // component at all (CALCULATION_REVIEW.md F6, hero-caveat in
    // AnalysisPanel.tsx). Kept explicit rather than assumed by the persona.
    mobilisationCostIncluded: false,
  };
}

// Exported so other assistant payload types — e.g. mobilityAssistantApi.ts's
// Terrain Mobility briefing — can reuse the exact same fetch/degrade contract
// rather than a second copy of this network plumbing.
export async function postAssistant(path: string, body: unknown): Promise<AssistantResponse | null> {
  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as AssistantResponse;
    if (!json || typeof json.text !== 'string' || !Array.isArray(json.citations)) return null;
    return json;
  } catch (e) {
    logger.debug(`Assistant endpoint ${path} unavailable`, e);
    return null;
  }
}

/** Generate a one-shot field briefing from the current analysis. */
export async function fetchBriefing(payload: AssistantPayload): Promise<AssistantResponse | null> {
  return postAssistant('/assistant/briefing', { payload });
}

/**
 * "Col" field reality check — an experienced heavy-plant/hand-crew veteran's
 * grounded sanity check on this plan before it reaches a crew or operator.
 * Same fetch/degrade contract as fetchBriefing; same grounding gate
 * server-side (docs/AI_ASSISTANT.md).
 */
export async function fetchRealityCheck(payload: AssistantPayload): Promise<AssistantResponse | null> {
  return postAssistant('/assistant/reality-check', { payload });
}

/** Ask a grounded question about the current plan. */
export async function askAssistant(
  payload: AssistantPayload,
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<AssistantResponse | null> {
  return postAssistant('/assistant/chat', { payload, question, history });
}
