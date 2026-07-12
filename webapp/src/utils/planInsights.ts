/**
 * Plan Assistant insight engine.
 *
 * Deterministic, rule-based interpretation of the terrain + vegetation +
 * equipment analyses into ranked, actionable insights: steep pinch points,
 * heavy-fuel pockets, data-confidence caveats and a recommended crewing
 * strategy. Everything is derived from the same analyses the estimates use —
 * the assistant explains the data, it never invents it.
 */

import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { formatChainageRange } from './chainage';

export type InsightSeverity = 'critical' | 'warning' | 'advice' | 'info';

export interface PlanInsight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Along-line location this insight refers to, when it is localized. */
  chainage?: { startM: number; endM: number };
  /** Optional one-tap action the UI can offer. */
  action?: 'locate' | 'optimize';
}

/** Minimal view of an equipment calculation result (frontend or backend shape). */
export interface EquipmentResultLike {
  id: string;
  name: string;
  type: string;
  time: number;
  cost: number;
  compatible: boolean;
  compatibilityLevel?: string;
  note?: string;
  drops?: number;
}

export interface PlanAssessment {
  insights: PlanInsight[];
  /** 0–100 relative construction difficulty for this line. */
  difficultyScore: number;
  difficultyLabel: 'Low' | 'Moderate' | 'High' | 'Extreme';
}

const isMachinery = (r: EquipmentResultLike) => r.type.toLowerCase() === 'machinery';
const isAircraft = (r: EquipmentResultLike) => r.type.toLowerCase() === 'aircraft';
const isHandCrew = (r: EquipmentResultLike) => r.type.toLowerCase() === 'handcrew';

interface Run {
  startM: number;
  endM: number;
  maxSlope?: number;
  label?: string;
}

/** Find contiguous chainage runs of track segments matching a predicate. */
function findSlopeRuns(track: TrackAnalysis, predicate: (category: string) => boolean): Run[] {
  const runs: Run[] = [];
  let cursor = 0;
  let current: Run | null = null;
  for (const seg of track.segments) {
    const start = cursor;
    const end = cursor + seg.distance;
    if (predicate(seg.category)) {
      if (current) {
        current.endM = end;
        current.maxSlope = Math.max(current.maxSlope ?? 0, seg.slope);
      } else {
        current = { startM: start, endM: end, maxSlope: seg.slope };
      }
    } else if (current) {
      runs.push(current);
      current = null;
    }
    cursor = end;
  }
  if (current) runs.push(current);
  return runs;
}

/** Find contiguous chainage runs of a vegetation type. */
function findVegetationRuns(veg: VegetationAnalysis, type: string): Run[] {
  const runs: Run[] = [];
  let cursor = 0;
  let current: Run | null = null;
  for (const seg of veg.segments) {
    const start = cursor;
    const end = cursor + seg.distance;
    if (seg.vegetationType === type) {
      if (current) {
        current.endM = end;
      } else {
        current = { startM: start, endM: end, label: seg.displayLabel };
      }
    } else if (current) {
      runs.push(current);
      current = null;
    }
    cursor = end;
  }
  if (current) runs.push(current);
  return runs;
}

const fmtKm = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const fmtHours = (h: number) => (h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`);

/**
 * Build the full plan assessment. All inputs are optional-safe: with only a
 * distance available the assistant simply says less.
 */
export function buildPlanAssessment(params: {
  distance: number;
  trackAnalysis: TrackAnalysis | null;
  vegetationAnalysis: VegetationAnalysis | null;
  equipmentResults: EquipmentResultLike[];
  breakWidthMeters: number;
}): PlanAssessment {
  const { distance, trackAnalysis, vegetationAnalysis, equipmentResults, breakWidthMeters } = params;
  const insights: PlanInsight[] = [];

  // ---- Terrain hazards -----------------------------------------------------
  if (trackAnalysis) {
    const verySteepRuns = findSlopeRuns(trackAnalysis, c => c === 'very_steep');
    for (const run of verySteepRuns.sort((a, b) => (b.endM - b.startM) - (a.endM - a.startM)).slice(0, 3)) {
      insights.push({
        id: `very-steep-${Math.round(run.startM)}`,
        severity: 'critical',
        title: `Very steep section at ${formatChainageRange(run.startM, run.endM)}`,
        detail: `${fmtKm(run.endM - run.startM)} exceeds 45° (max ${Math.round(run.maxSlope ?? 0)}°). This is beyond safe machinery limits — plan hand crews with anchored footing, or realign the route around it.`,
        chainage: { startM: run.startM, endM: run.endM },
        action: 'locate',
      });
    }

    const steepRuns = findSlopeRuns(trackAnalysis, c => c === 'steep');
    for (const run of steepRuns.sort((a, b) => (b.endM - b.startM) - (a.endM - a.startM)).slice(0, 3)) {
      insights.push({
        id: `steep-${Math.round(run.startM)}`,
        severity: 'warning',
        title: `Steep pinch point at ${formatChainageRange(run.startM, run.endM)}`,
        detail: `${fmtKm(run.endM - run.startM)} of 25–45° slope (max ${Math.round(run.maxSlope ?? 0)}°). Most dozers are slope-limited here — expect slower rates, winch assist, or a hand-crew tie-in for this section.`,
        chainage: { startM: run.startM, endM: run.endM },
        action: 'locate',
      });
    }
  }

  // ---- Fuel pockets ----------------------------------------------------------
  if (vegetationAnalysis) {
    const heavyRuns = findVegetationRuns(vegetationAnalysis, 'heavyforest')
      .filter(r => r.endM - r.startM >= 150)
      .sort((a, b) => (b.endM - b.startM) - (a.endM - a.startM))
      .slice(0, 3);
    for (const run of heavyRuns) {
      insights.push({
        id: `heavy-fuel-${Math.round(run.startM)}`,
        severity: 'warning',
        title: `Heavy timber pocket at ${formatChainageRange(run.startM, run.endM)}`,
        detail: `${fmtKm(run.endM - run.startM)} of heavy forest${run.label ? ` (${run.label})` : ''}. Clearing rates roughly halve in this fuel — consider re-routing around the pocket or staging heavier machinery for it.`,
        chainage: { startM: run.startM, endM: run.endM },
        action: 'locate',
      });
    }
  }

  // ---- Anchor points -----------------------------------------------------------
  // A break that ends in continuous fuel can be outflanked. Flag ends that
  // terminate in medium scrub or heavy forest so the planner anchors them to a
  // road, waterway or cleared ground.
  if (vegetationAnalysis && vegetationAnalysis.segments.length > 0 && distance > 400) {
    const continuousFuel = (t: string) => t === 'heavyforest' || t === 'mediumscrub';
    const firstSeg = vegetationAnalysis.segments[0];
    const lastSeg = vegetationAnalysis.segments[vegetationAnalysis.segments.length - 1];
    const endChecks: { id: string; label: string; type: string; startM: number; endM: number }[] = [];
    if (continuousFuel(firstSeg.vegetationType)) {
      endChecks.push({ id: 'anchor-start', label: 'start', type: firstSeg.vegetationType, startM: 0, endM: Math.min(150, distance) });
    }
    if (continuousFuel(lastSeg.vegetationType)) {
      endChecks.push({ id: 'anchor-end', label: 'end', type: lastSeg.vegetationType, startM: Math.max(0, distance - 150), endM: distance });
    }
    for (const end of endChecks) {
      insights.push({
        id: end.id,
        severity: 'warning',
        title: `Line ${end.label} terminates in continuous fuel`,
        detail: `The ${end.label} of this break sits in ${end.type === 'heavyforest' ? 'heavy forest' : 'medium scrub'} with no visible anchor. An unanchored end can be outflanked — tie it into a road, waterway, or cleared ground.`,
        chainage: { startM: end.startM, endM: end.endM },
        action: 'locate',
      });
    }
  }

  // ---- Route-optimization nudge ---------------------------------------------
  if (trackAnalysis && vegetationAnalysis && distance > 300) {
    const steepShare = (trackAnalysis.slopeDistribution.steep + trackAnalysis.slopeDistribution.very_steep) / Math.max(1, trackAnalysis.totalDistance);
    const heavyShare = (vegetationAnalysis.vegetationDistribution.heavyforest ?? 0) / Math.max(1, vegetationAnalysis.totalDistance);
    if (steepShare > 0.12 || heavyShare > 0.18) {
      insights.push({
        id: 'optimize-route',
        severity: 'advice',
        title: 'A smarter path may exist',
        detail: `${Math.round(steepShare * 100)}% of this line is steep and ${Math.round(heavyShare * 100)}% crosses heavy timber. Route optimization can search the corridor for a path that trades a little length for easier ground and lighter fuel.`,
        action: 'optimize',
      });
    }
  }

  // ---- Data confidence --------------------------------------------------------
  if (trackAnalysis?.usedMockElevation || vegetationAnalysis?.usedFallbackData) {
    const parts = [
      trackAnalysis?.usedMockElevation ? 'terrain/slope' : null,
      vegetationAnalysis?.usedFallbackData ? 'vegetation' : null,
    ].filter(Boolean).join(' and ');
    insights.push({
      id: 'estimated-data',
      severity: 'critical',
      title: 'Estimated data in this analysis',
      detail: `Authoritative ${parts} data was unavailable for part of the line. Every figure downstream inherits that uncertainty — verify conditions on the ground before committing resources.`,
    });
  } else if (vegetationAnalysis && vegetationAnalysis.overallConfidence < 0.6) {
    insights.push({
      id: 'low-confidence',
      severity: 'info',
      title: 'Vegetation confidence is moderate',
      detail: `Overall detection confidence is ${Math.round(vegetationAnalysis.overallConfidence * 100)}%. If local knowledge says otherwise, override the vegetation class — overrides always win over auto-detection.`,
    });
  }

  // ---- Crewing strategy --------------------------------------------------------
  const compatible = equipmentResults.filter(r => r.compatible && r.time > 0);
  const bestMachine = compatible.filter(isMachinery).sort((a, b) => a.time - b.time)[0];
  const bestCrew = compatible.filter(isHandCrew).sort((a, b) => a.time - b.time)[0];
  const bestAir = compatible.filter(isAircraft).sort((a, b) => a.time - b.time)[0];

  if (bestMachine) {
    const partial = bestMachine.compatibilityLevel === 'partial';
    const steepM = trackAnalysis ? trackAnalysis.slopeDistribution.steep + trackAnalysis.slopeDistribution.very_steep : 0;
    let detail = `${bestMachine.name} is the fastest viable machine at ~${fmtHours(bestMachine.time)} for the ${breakWidthMeters} m break${bestMachine.cost > 0 ? ` (≈$${Math.round(bestMachine.cost).toLocaleString()})` : ''}.`;
    if (partial) {
      detail += ` It is outside its rated terrain for part of the line${bestMachine.note ? ` — ${bestMachine.note.toLowerCase()}` : ''}.`;
    }
    if (steepM > 50 && bestCrew) {
      detail += ` Pair it with ${bestCrew.name} for the ~${fmtKm(steepM)} of steep ground the machine will work slowly or not at all.`;
    }
    insights.push({
      id: 'strategy',
      severity: 'advice',
      title: 'Recommended approach',
      detail,
    });
  } else if (bestCrew) {
    insights.push({
      id: 'strategy',
      severity: 'advice',
      title: 'Hand crews are the primary option',
      detail: `No machinery is compatible with this line's terrain and fuel. ${bestCrew.name} is the fastest crew option at ~${fmtHours(bestCrew.time)}. Consider re-routing to bring machinery back into play.`,
      action: 'optimize',
    });
  }

  if (bestAir && vegetationAnalysis) {
    const heavyShare = (vegetationAnalysis.vegetationDistribution.heavyforest ?? 0) / Math.max(1, vegetationAnalysis.totalDistance);
    if (heavyShare > 0.3) {
      insights.push({
        id: 'air-support',
        severity: 'info',
        title: 'Aircraft support is worth pre-planning',
        detail: `${Math.round(heavyShare * 100)}% of the line is in heavy fuel. ${bestAir.name} could hold the line with ${bestAir.drops ?? '?'} drops while ground resources cut it — useful insurance if conditions deteriorate.`,
      });
    }
  }

  // ---- Positive confirmation ----------------------------------------------------
  if (
    trackAnalysis &&
    vegetationAnalysis &&
    insights.every(i => i.severity === 'info' || i.id === 'strategy')
  ) {
    insights.push({
      id: 'good-line',
      severity: 'info',
      title: 'Favourable alignment',
      detail: 'No steep pinch points or heavy fuel pockets detected on this line. Conditions favour rapid machine construction.',
    });
  }

  // ---- Difficulty score -----------------------------------------------------------
  let difficultyScore = 0;
  if (trackAnalysis && vegetationAnalysis && distance > 0) {
    const t = trackAnalysis.slopeDistribution;
    const v = vegetationAnalysis.vegetationDistribution;
    const slopePart =
      (t.flat * 0 + t.medium * 30 + t.steep * 70 + t.very_steep * 100) / Math.max(1, trackAnalysis.totalDistance);
    const vegPart =
      ((v.grassland ?? 0) * 0 + (v.lightshrub ?? 0) * 25 + (v.mediumscrub ?? 0) * 55 + (v.heavyforest ?? 0) * 100) /
      Math.max(1, vegetationAnalysis.totalDistance);
    difficultyScore = Math.round(Math.min(100, slopePart * 0.55 + vegPart * 0.45));
  }
  const difficultyLabel: PlanAssessment['difficultyLabel'] =
    difficultyScore < 25 ? 'Low' : difficultyScore < 50 ? 'Moderate' : difficultyScore < 75 ? 'High' : 'Extreme';

  // Rank: critical → warning → advice → info; localized hazards before global notes.
  const severityRank: Record<InsightSeverity, number> = { critical: 0, warning: 1, advice: 2, info: 3 };
  insights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return { insights, difficultyScore, difficultyLabel };
}
