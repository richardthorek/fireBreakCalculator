/**
 * Deterministic briefing builder — no AI, pure string formatting from the
 * analysis payload. This is what `assistant/briefing` returns whenever the
 * model is unconfigured, unreachable, or fails the grounding check, so the
 * endpoint always produces something useful instead of a dead end.
 */

import { AssistantPayload } from '../types/assistant';

export function buildTemplateBriefing(payload: AssistantPayload): string {
  const lines: string[] = [];

  const km = payload.distanceM / 1000;
  const lengthStr = km >= 1 ? `${km.toFixed(2)} km` : `${Math.round(payload.distanceM)} m`;
  lines.push(
    `Situation: ${lengthStr} fire break, ${payload.breakWidthM} m wide, ${payload.difficultyLabel.toLowerCase()} difficulty (${payload.difficultyScore}/100).`
  );

  lines.push(
    `Terrain: max slope ${Math.round(payload.maxSlopeDeg)}°, mean ${Math.round(payload.meanSlopeDeg)}°. Predominant fuel: ${payload.predominantVegetation} (${Math.round(payload.vegetationConfidence * 100)}% confidence).`
  );

  const best = payload.topEquipment[0];
  if (best) {
    const costPart = best.cost > 0 ? `, approx $${Math.round(best.cost).toLocaleString()}` : '';
    lines.push(`Recommended: ${best.name} — ${best.timeHours.toFixed(1)} h${costPart}.`);
  } else {
    lines.push('Recommended: no compatible equipment found for this line — check the Equipment tab.');
  }

  if (payload.estimatedData) {
    lines.push('Caution: part of this analysis uses estimated/fallback data — verify conditions on the ground.');
  }

  const topInsight = payload.insights.find((i) => i.severity === 'critical' || i.severity === 'warning');
  if (topInsight) {
    lines.push(`Key finding: ${topInsight.title} — ${topInsight.detail}`);
  }

  return lines.join('\n');
}
