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

export function isAssistantPayload(v: any): v is AssistantPayload {
  return (
    v &&
    typeof v.distanceM === 'number' &&
    typeof v.breakWidthM === 'number' &&
    typeof v.maxSlopeDeg === 'number' &&
    typeof v.meanSlopeDeg === 'number' &&
    typeof v.predominantVegetation === 'string' &&
    typeof v.vegetationConfidence === 'number' &&
    typeof v.estimatedData === 'boolean' &&
    typeof v.difficultyScore === 'number' &&
    typeof v.difficultyLabel === 'string' &&
    Array.isArray(v.topEquipment) &&
    Array.isArray(v.insights)
  );
}
