/**
 * Distilled analysis payload the frontend sends to the AI assistant endpoints.
 * Deliberately compact (not the full TrackAnalysis/VegetationAnalysis
 * objects) — small enough to keep in a prompt, and every field in it is a
 * value the grounding check can verify a model response against.
 */
export interface AssistantEquipmentSummary {
  name: string;
  type: string;
  timeHours: number;
  cost: number;
  compatibilityLevel: string;
}

export interface AssistantInsightSummary {
  severity: string;
  title: string;
  detail: string;
}

export interface AssistantPayload {
  distanceM: number;
  breakWidthM: number;
  maxSlopeDeg: number;
  meanSlopeDeg: number;
  predominantVegetation: string;
  vegetationConfidence: number;
  /** True when any elevation or vegetation sample was estimated/fallback data. */
  estimatedData: boolean;
  difficultyScore: number;
  difficultyLabel: string;
  topEquipment: AssistantEquipmentSummary[];
  insights: AssistantInsightSummary[];
}

export interface AssistantCitation {
  id: string;
  title: string;
  source: string;
}

export interface AssistantResponse {
  /** 'ai' = a validated model response; 'template'/'unavailable' = deterministic fallback. */
  source: 'ai' | 'template' | 'unavailable';
  text: string;
  citations: AssistantCitation[];
}

function isFiniteNumber(v: any): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function isEquipmentSummary(v: any): v is AssistantEquipmentSummary {
  return (
    v &&
    typeof v.name === 'string' &&
    typeof v.type === 'string' &&
    isFiniteNumber(v.timeHours) &&
    isFiniteNumber(v.cost) &&
    typeof v.compatibilityLevel === 'string'
  );
}

function isInsightSummary(v: any): v is AssistantInsightSummary {
  return v && typeof v.severity === 'string' && typeof v.title === 'string' && typeof v.detail === 'string';
}

/**
 * Validates the full shape, including array elements — this is a public,
 * anonymous HTTP endpoint (see assistantBriefing.ts/assistantChat.ts), so the
 * request body is untrusted input at a system boundary. A malformed
 * topEquipment/insights entry that slipped past a shallow check used to reach
 * buildTemplateBriefing() unguarded and crash with an uncaught TypeError.
 * NaN is rejected (not just `typeof === 'number'`) so a garbled upstream
 * value can't silently become `null` when serialized into the model prompt.
 */
export function isAssistantPayload(v: any): v is AssistantPayload {
  return (
    v &&
    isFiniteNumber(v.distanceM) &&
    isFiniteNumber(v.breakWidthM) &&
    isFiniteNumber(v.maxSlopeDeg) &&
    isFiniteNumber(v.meanSlopeDeg) &&
    typeof v.predominantVegetation === 'string' &&
    isFiniteNumber(v.vegetationConfidence) &&
    typeof v.estimatedData === 'boolean' &&
    isFiniteNumber(v.difficultyScore) &&
    typeof v.difficultyLabel === 'string' &&
    Array.isArray(v.topEquipment) &&
    v.topEquipment.every(isEquipmentSummary) &&
    Array.isArray(v.insights) &&
    v.insights.every(isInsightSummary)
  );
}
