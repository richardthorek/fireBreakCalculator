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

export interface LatLng {
  lat: number;
  lng: number;
}

export interface AccessPoint {
  coords: LatLng;
  roadName?: string;
  roadKind: string;
  gapM: number;
  forLineEnd: 'start' | 'end';
}

export interface AccessRouteStep {
  roadName: string;
  distanceM: number;
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
  // SMEACS briefing fields (optional for backwards compatibility)
  startCoords?: LatLng;
  endCoords?: LatLng;
  locality?: string;
  taskedResourceTypes?: string[];
  entryPoint?: AccessPoint;
  approachSteps?: AccessRouteStep[];
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

export interface SmeacsBriefingSection {
  section: 'situation' | 'mission' | 'execution' | 'administration' | 'command' | 'safety';
  heading: string;
  lines: string[];
  userEditable: boolean;
  citations: AssistantCitation[];
}

export interface SmeacsBriefing {
  sections: SmeacsBriefingSection[];
  generatedAt: string;
  dataHonestyCaveat?: string;
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

function isLatLng(v: any): v is LatLng {
  return (
    v &&
    isFiniteNumber(v.lat) &&
    isFiniteNumber(v.lng) &&
    v.lat >= -90 && v.lat <= 90 &&
    v.lng >= -180 && v.lng <= 180
  );
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
  const baseValid =
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
    v.insights.every(isInsightSummary);

  if (!baseValid) return false;

  if (v.startCoords !== undefined && !isLatLng(v.startCoords)) return false;
  if (v.endCoords !== undefined && !isLatLng(v.endCoords)) return false;
  if (v.locality !== undefined && typeof v.locality !== 'string') return false;
  if (v.taskedResourceTypes !== undefined) {
    if (!Array.isArray(v.taskedResourceTypes)) return false;
    if (!v.taskedResourceTypes.every((t: any) => typeof t === 'string')) return false;
  }

  return true;
}
