/**
 * Deterministic briefing builder for Terrain Mobility & Counter-Mobility
 * results — no AI, pure string formatting from the payload. Mirrors
 * `briefingTemplate.ts`'s role exactly: this is what
 * `assistant/mobility-briefing` returns whenever the model is unconfigured,
 * unreachable, or fails the grounding check, so the endpoint always produces
 * a plain-language commander briefing instead of a dead end. It is also the
 * PRIMARY deliverable for "a commander gets a plain-language briefing, not
 * just panels of numbers" — it works with no model deployed at all.
 */

import { MobilityAssistantPayload } from '../types/mobilityAssistant';

export function buildTemplateMobilityBriefing(payload: MobilityAssistantPayload): string {
  const lines: string[] = [];

  const nightPart = payload.nightMode ? ', night/limited visibility' : '';
  lines.push(
    `Situation: ${payload.moverProfileLabel} (${payload.moverProfileConfidence} confidence${nightPart}). ` +
    `${payload.reachableCount}/${payload.cellCount} cells reachable — ${payload.noGoCount} NO-GO, ${payload.slowGoCount} SLOW-GO.`
  );

  if (payload.unconstrained) {
    lines.push(
      `Movement: UNCONSTRAINED — corridor bands cover ${Math.round(payload.coveragePercent)}% of the area with no real ` +
      'chokepoint. This ground cannot be denied by siting obstacles at points; denial needs observation and fires, or a continuous barrier.'
    );
  } else {
    const top = payload.topCorridors[0];
    if (top) {
      lines.push(
        `Movement: primary corridor carries ${top.routeCount}/${top.routeTotal} analysed routes (${top.easeClass}), ` +
        `median ${top.medianTravelMin.toFixed(0)} min, bottleneck ~${top.bottleneckWidthM.toFixed(0)} m ` +
        `(${top.bottleneckAbreast} abreast, ${top.frontage}), ${Math.round(top.goFractionPct)}% GO ground.`
      );
    } else {
      lines.push('Movement: no corridor could be formed for this profile — objective may be unreachable.');
    }
  }

  if (payload.chokepointCount > 0 || payload.barrierSegmentCount) {
    const chokePart = payload.topChokepointPassCount != null
      ? `top chokepoint crossed by ${payload.topChokepointPassCount} route(s)`
      : `${payload.chokepointCount} chokepoint(s) identified`;
    const barrierPart = payload.barrierSegmentCount
      ? `; cheapest severing cut is ${payload.barrierSegmentCount} segment(s), cut value ${payload.barrierCutValue?.toFixed(0) ?? '—'} (unit/trail-weighted, not vehicle capacity)`
      : '';
    lines.push(`Denial siting: ${chokePart}${barrierPart}.`);
  }

  if (payload.placements.length > 0) {
    const unsafe = payload.placements.filter((p) => !p.egressSafe);
    if (unsafe.length > 0) {
      lines.push(
        `REFUSED: ${unsafe.map((p) => p.measureLabel).join(', ')} would trap friendly egress — do not place without a verified alternate route.`
      );
    }
    for (const p of payload.placements.filter((p) => p.egressSafe)) {
      const bypassPart = p.bypassDelayMin != null ? `, bypass opens it in ${p.bypassDelayMin.toFixed(0)} min` : '';
      lines.push(`Measure ${p.measureLabel}: imposes ${p.delayImposedMin.toFixed(0)} min delay${bypassPart}.`);
    }
  }

  if (payload.estimatedData) {
    lines.push('Caution: part of this appreciation uses estimated/fallback data — verify conditions on the ground.');
  }

  lines.push('This is a rapid appreciation, not a tasking — scout and plan in detail before acting on it.');

  return lines.join('\n');
}
