/**
 * Deterministic "Field Reality Check" builder — no AI, pure string formatting
 * from the analysis payload. Returned by `assistant/reality-check` whenever
 * the model is unconfigured, unreachable, or fails the grounding check, so
 * the field-veteran sanity check is available on every deployment — even one
 * with no Azure AI Foundry endpoint configured at all — not just as an AI
 * feature. See docs/AI_ASSISTANT.md §6.
 */

import { AssistantPayload } from '../types/assistant';

export function buildTemplateRealityCheck(payload: AssistantPayload): string {
  const lines: string[] = [];
  const concerns: string[] = [];

  if (payload.estimatedData) {
    concerns.push('part of this line was classified from estimated/fallback data, not a measured source');
  }
  if ((payload.lowConfidenceSegmentCount ?? 0) > 0) {
    const n = payload.lowConfidenceSegmentCount;
    const of = payload.segmentCount ? ` of ${payload.segmentCount}` : '';
    concerns.push(`${n}${of} ground segment${n === 1 ? '' : 's'} came back low-confidence — worth a quick look before committing plant to it`);
  }
  if (payload.equipmentCaveats && payload.equipmentCaveats.length > 0) {
    concerns.push(`the tasked equipment's own sourcing note says: "${payload.equipmentCaveats[0]}"`);
  }
  if (payload.mobilisationCostIncluded === false) {
    concerns.push('the time/cost shown does NOT include getting the resource to site — mobilisation, transport, standby are not costed');
  }

  lines.push(
    concerns.length > 0
      ? `Before this goes to a crew or operator: ${concerns.length} thing${concerns.length === 1 ? '' : 's'} worth a second look.`
      : "Nothing in this plan's own flags raises a concern — still worth a ground check, but no known gap here."
  );
  for (const c of concerns) lines.push(`- ${c}.`);

  const best = payload.topEquipment[0];
  if (best) {
    lines.push(`Recommended resource: ${best.name}, ${best.timeHours.toFixed(1)} h — treat this as a planning figure, calibrate against what actually happens on the ground.`);
  }

  lines.push("This is a template summary, not Col — no AI model was available to give the full field critique this time.");

  return lines.join('\n');
}
