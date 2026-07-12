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
import { logger } from './logger';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

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

/** Build the compact payload the assistant endpoints validate responses against. */
export function buildAssistantPayload(params: {
  distance: number;
  breakWidthMeters: number;
  trackAnalysis: TrackAnalysis | null;
  vegetationAnalysis: VegetationAnalysis | null;
  equipmentResults: { name: string; type: string; time: number; cost: number; compatible: boolean; compatibilityLevel?: string }[];
  assessment: PlanAssessment | null;
}): AssistantPayload {
  const { distance, breakWidthMeters, trackAnalysis, vegetationAnalysis, equipmentResults, assessment } = params;
  const topEquipment: AssistantEquipmentSummary[] = equipmentResults
    .filter((r) => r.compatible && r.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(0, 3)
    .map((r) => ({ name: r.name, type: r.type, timeHours: Math.round(r.time * 10) / 10, cost: Math.round(r.cost), compatibilityLevel: r.compatibilityLevel ?? 'full' }));

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
  };
}

async function postAssistant(path: string, body: unknown): Promise<AssistantResponse | null> {
  try {
    const resp = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

/** Ask a grounded question about the current plan. */
export async function askAssistant(
  payload: AssistantPayload,
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<AssistantResponse | null> {
  return postAssistant('/assistant/chat', { payload, question, history });
}
