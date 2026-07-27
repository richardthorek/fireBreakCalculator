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

  // Unrestricted movement leads, when the simulation ran: "how do they move if
  // we do nothing" is the question the rest of the briefing answers against.
  const m = payload.movement;
  if (m) {
    const spreadPart = m.p10Min !== null && m.p90Min !== null
      ? ` (P10-P90 ${m.p10Min.toFixed(0)}-${m.p90Min.toFixed(0)} min)`
      : '';
    const optimalPart = m.optimalMin !== null
      ? ` The single best computed route is ${m.optimalMin.toFixed(0)} min — real movers are not optimisers.`
      : '';
    lines.push(
      `Unrestricted movement: of ${m.moverCount} simulated movers, ${Math.round(m.arrivedPercent)}% reached the objective, ` +
      `median ${m.medianMin !== null ? m.medianMin.toFixed(0) : '—'} min${spreadPart}. ` +
      `${Math.round(m.crossCountryPercent)}% of that movement was off the road/trail network.${optimalPart}`
    );
  }

  // The counts below mean different things depending on where they came from,
  // and the reader has no other way to tell.
  const evidenceWord = payload.corridorEvidence === 'simulated-movers' ? 'simulated movers' : 'analysed routes';

  if (payload.unconstrained) {
    lines.push(
      `Corridors: UNCONSTRAINED — bands cover ${Math.round(payload.coveragePercent)}% of the area with no real ` +
      'chokepoint. This ground cannot be denied by siting obstacles at points; denial needs observation and fires, or a continuous barrier.'
    );
  } else {
    const top = payload.topCorridors[0];
    if (top) {
      lines.push(
        `Corridors: primary corridor carries ${top.routeCount}/${top.routeTotal} ${evidenceWord} (${top.easeClass}), ` +
        `median ${top.medianTravelMin.toFixed(0)} min, bottleneck ~${top.bottleneckWidthM.toFixed(0)} m ` +
        `(${top.bottleneckAbreast} abreast, ${top.frontage}), ${Math.round(top.goFractionPct)}% GO ground.`
      );
    } else {
      lines.push('Corridors: none could be formed for this profile — objective may be unreachable.');
    }
  }

  // Recommended restrictions: the actionable half.
  const effect = payload.restrictionEffect;
  const restrictions = payload.restrictions ?? [];
  if (restrictions.length > 0) {
    lines.push(
      `Recommended restrictions (${restrictions.length}), in priority order: ` +
      restrictions
        .map((r) => (
          `${r.rank}. ${r.kind === 'road-block' ? 'road block' : 'ground denial'} on ground ` +
          `${Math.round(r.transitPercent)}% of movers used — adds ${r.marginalDelayMin.toFixed(0)} min ` +
          `(cumulative ${r.cumulativeDelayMin.toFixed(0)} min)`
        ))
        .join('; ') + '.'
    );
    if (effect) {
      lines.push(
        `Effect of the whole set: median journey ${effect.baselineMedianMin !== null ? effect.baselineMedianMin.toFixed(0) : '—'} min → ` +
        `${effect.scenarioMedianMin !== null ? effect.scenarioMedianMin.toFixed(0) : '—'} min; ` +
        `arrivals ${Math.round(effect.baselineArrivedPercent)}% → ${Math.round(effect.scenarioArrivedPercent)}%; ` +
        `movement forced off the road network ${Math.round(effect.baselineCrossCountryPercent)}% → ${Math.round(effect.scenarioCrossCountryPercent)}%.`
      );
    }
  } else if (effect?.bypassNote) {
    lines.push(`Recommended restrictions: none. ${effect.bypassNote}`);
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

  // The behaviour model's own caveat, stated wherever its numbers are used.
  if (payload.movement || payload.corridorEvidence === 'simulated-movers') {
    lines.push(
      'Caution: movement figures come from a behaviour model. The terrain is real data; how a mover ' +
      'chooses its next step — road preference, decisiveness, how well it knows the ground — is assumed ' +
      'and unsourced. Use these to compare options, not as a prediction of a real force.'
    );
  }

  lines.push('This is a rapid appreciation, not a tasking — scout and plan in detail before acting on it.');

  return lines.join('\n');
}
