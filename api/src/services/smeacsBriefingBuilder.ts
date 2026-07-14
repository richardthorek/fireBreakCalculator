/**
 * SMEACS briefing builder — NSW RFS Issuing Orders format.
 * Deterministic template that always works; AI narration is an optional overlay.
 * Situation / Mission / Execution / Administration & Logistics / Command & Communications / Safety.
 */

import { AssistantPayload, SmeacsBriefing, SmeacsBriefingSection, AssistantCitation } from '../types/assistant';
import { retrieveDoctrine, getDoctrineChunk } from './knowledgeBase';
import { DISCLAIMER_LONG, ENGINE_VERSION, ENGINE_UPDATED } from './provenance';

function fmtDistance(m: number): string {
  const km = m / 1000;
  return km >= 1 ? `${km.toFixed(2)} km` : `${Math.round(m)} m`;
}

function fmtTime(h: number): string {
  return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`;
}

function citationsFromDoctrineIds(ids: string[]): AssistantCitation[] {
  return ids
    .map((id) => getDoctrineChunk(id))
    .filter((chunk) => chunk !== undefined)
    .map((chunk) => ({
      id: chunk!.id,
      title: chunk!.title,
      source: chunk!.source,
    }));
}

export function buildSmeacsBriefing(payload: AssistantPayload): SmeacsBriefing {
  const sections: SmeacsBriefingSection[] = [];
  const allCitations = new Map<string, AssistantCitation>();

  // Situation — locality, distance, width, terrain, fuel, difficulty
  const situationLines: string[] = [];
  const locality = payload.locality || 'location TBD';
  situationLines.push(`General vicinity: ${locality}.`);
  const distStr = fmtDistance(payload.distanceM);
  situationLines.push(
    `Fire break: ${distStr} length, ${payload.breakWidthM} m target width, ${payload.difficultyLabel.toLowerCase()} difficulty (score ${payload.difficultyScore}/100).`
  );
  situationLines.push(
    `Terrain: max slope ${Math.round(payload.maxSlopeDeg)}°, mean ${Math.round(payload.meanSlopeDeg)}°. Predominant fuel: ${payload.predominantVegetation} (${Math.round(payload.vegetationConfidence * 100)}% confidence).`
  );
  if (payload.estimatedData) {
    situationLines.push('⚠️ Part of this analysis uses estimated/fallback data — verify conditions on the ground.');
  }

  sections.push({
    section: 'situation',
    heading: 'Situation',
    lines: situationLines,
    userEditable: false,
    citations: [],
  });

  // Mission — simple template sentence + user-editable objective field
  sections.push({
    section: 'mission',
    heading: 'Mission',
    lines: [
      `Construct ${distStr} fire break, ${payload.breakWidthM} m wide, from grid ref [Start] to grid ref [End].`,
      '— User objective / intent: [CONFIRM AT BRIEFING]',
    ],
    userEditable: true,
    citations: [],
  });

  // Execution — recommended resource, approach, work direction, hazards
  const executionLines: string[] = [];
  if (payload.topEquipment.length > 0) {
    const best = payload.topEquipment[0];
    executionLines.push(`Primary resource: ${best.name} (${best.type}).`);
    executionLines.push(`Estimated time: ${fmtTime(best.timeHours)}.`);
    if (best.cost > 0) {
      executionLines.push(`Estimated cost: $${Math.round(best.cost).toLocaleString()}.`);
    }
  } else {
    executionLines.push('No compatible equipment found — review Equipment tab and select alternatives.');
  }

  // Entry point from access routing (or placeholder if unavailable)
  if (payload.entryPoint) {
    const roadInfo = payload.entryPoint.roadName
      ? `${payload.entryPoint.roadName} (${payload.entryPoint.roadKind})`
      : payload.entryPoint.roadKind;
    const gap = payload.entryPoint.gapM > 0 ? ` — ~${Math.round(payload.entryPoint.gapM)} m gap from line` : '';
    executionLines.push(`Entry point: ${roadInfo}${gap}. OSM-mapped — verify gate access on approach.`);
  } else {
    executionLines.push('Entry point: [Road access data unavailable — confirm nearest road on ground].');
  }

  // Approach directions from Mapbox Directions (or placeholder)
  if (payload.approachSteps && payload.approachSteps.length > 0) {
    const roadSequence = payload.approachSteps.map((step) => `${step.roadName} (~${Math.round(step.distanceM / 1000)} km)`).join(' → ');
    executionLines.push(`Approach: ${roadSequence}. Verify locally and confirm final access conditions.`);
  } else {
    executionLines.push('Approach: [Route guidance unavailable offline — plan access to entry point locally].');
  }

  const criticalInsights = payload.insights.filter((i) => i.severity === 'critical' || i.severity === 'warning');
  if (criticalInsights.length > 0) {
    executionLines.push('Key hazards:');
    for (const insight of criticalInsights) {
      executionLines.push(`  — ${insight.title}: ${insight.detail}`);
    }
  }

  sections.push({
    section: 'execution',
    heading: 'Execution',
    lines: executionLines,
    userEditable: false,
    citations: [],
  });

  // Administration & Logistics — user-editable blanks
  sections.push({
    section: 'administration',
    heading: 'Administration & Logistics',
    lines: [
      'Staging area: [CONFIRM AT BRIEFING]',
      'Fuel and water supply: [CONFIRM AT BRIEFING]',
      'Estimated commencement: [DATE/TIME — CONFIRM AT BRIEFING]',
      'Weather briefing: [Current forecast, fire danger rating — from AFDRS if available]',
    ],
    userEditable: true,
    citations: [],
  });

  // Command & Communications — user-editable, with supervision thresholds
  const commandLines = [
    'Incident Controller / Supervisor: [NAME — CONFIRM AT BRIEFING]',
    'Field Supervisor: [NAME — CONFIRM AT BRIEFING]',
    'Callsigns: [ASSIGN AT BRIEFING]',
    'Primary radio channel: [FREQUENCY — CONFIRM AT BRIEFING]',
  ];

  // Add supervision thresholds if plant are tasked
  const plantTypes = ['dozer', 'grader', 'excavator', 'loader'];
  const plantCount = payload.taskedResourceTypes?.filter((t) =>
    plantTypes.indexOf(t.toLowerCase()) !== -1
  ).length || 0;

  if (plantCount >= 5) {
    commandLines.push('NOTE: ≥5 heavy plant tasked — Plant Operations Manager required in IMT.');
    allCitations.set('rfs-plant-supervision', {
      id: 'rfs-plant-supervision',
      title: 'Supervision ratios for heavy plant on fire operations',
      source: 'NSW RFS Operational Procedure Guide — Heavy Plant',
    });
  } else if (plantCount >= 3) {
    commandLines.push('NOTE: ≥3 heavy plant tasked — Heavy Plant Supervisor required.');
    allCitations.set('rfs-plant-supervision', {
      id: 'rfs-plant-supervision',
      title: 'Supervision ratios for heavy plant on fire operations',
      source: 'NSW RFS Operational Procedure Guide — Heavy Plant',
    });
  }

  sections.push({
    section: 'command',
    heading: 'Command & Communications',
    lines: commandLines,
    userEditable: true,
    citations: Array.from(allCitations.values()),
  });

  // Safety — standard doctrine requirements by equipment type
  const safetyLines: string[] = [];
  const safetyCitationIds = new Set<string>();

  safetyLines.push('Standard safety requirements:');

  // Heavy plant requirements
  if (plantCount > 0) {
    safetyLines.push('  Heavy plant:');
    safetyLines.push('    — ROPS + FOPS + Operator Protection Guarding compliant');
    safetyLines.push('    — Seatbelts worn at all times');
    safetyLines.push('    — Escort firefighting appliance (1 per plant if fire-impact risk exists)');
    safetyLines.push('    — Radio contact: operator, escort, supervisor on primary channel');
    safetyLines.push('    — Adequate work lighting for night operations if required');
    safetyCitationIds.add('rfs-plant-protective-structures');
    safetyCitationIds.add('rfs-escort-appliance');
  }

  // Hand crew requirements
  if (payload.taskedResourceTypes?.some((t) => t.toLowerCase().includes('hand') || t.toLowerCase().includes('crew'))) {
    safetyLines.push('  Hand crews:');
    safetyLines.push('    — PPE: helmet, gloves, eye protection, sturdy footwear');
    safetyLines.push('    — Radio on primary channel; maintain crew cohesion');
    if (payload.maxSlopeDeg > 35) {
      safetyLines.push('    — Slope >35°: exercise extreme caution, establish safety zone below line');
    }
  }

  if (payload.estimatedData) {
    safetyLines.push('  Data quality:');
    safetyLines.push('    — This plan uses estimated/fallback elevation or vegetation data');
    safetyLines.push('    — Ground-truth all conditions before commencing work');
    safetyCitationIds.add('data-honesty-principle');
  }

  safetyLines.push('  All personnel: LACES brief, emergency rally point, abort conditions.');

  const safetyCitations = citationsFromDoctrineIds(Array.from(safetyCitationIds));

  sections.push({
    section: 'safety',
    heading: 'Safety',
    lines: safetyLines,
    userEditable: false,
    citations: safetyCitations,
  });

  const dataHonestyCaveat = payload.estimatedData
    ? '⚠️ This briefing uses estimated/fallback data. Verify all information on the ground before commencing work.'
    : undefined;

  const now = new Date();
  return {
    sections,
    generatedAt: now.toISOString(),
    dataHonestyCaveat,
    // Standing disclaimer — a SMEACS pack looks like an official tasking, so it
    // must always carry the "planning aid, not an order" caveat, estimated data
    // or not.
    disclaimer: DISCLAIMER_LONG,
    provenance: `Fire Break Calculator estimate engine v${ENGINE_VERSION} (${ENGINE_UPDATED}) · generated ${now.toISOString()}`,
  };
}
