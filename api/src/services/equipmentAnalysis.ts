/**
 * Equipment Analysis Service
 *
 * Core business logic for estimating how different resources (machinery,
 * aircraft, hand crews) build a fire break along a planned line.
 *
 * KEY BEHAVIOUR (rewritten for accuracy):
 * - The estimate is INTEGRATED PER SEGMENT along the route. Each segment carries
 *   its own slope and fuel/vegetation, and time is summed segment by segment
 *   using the grounded production model (see productionModel.ts). This replaces
 *   the previous approach that collapsed the whole line to a single worst-case
 *   slope bucket and a single "predominant" vegetation class.
 * - Machinery slope SAFETY LIMITS are enforced: a segment steeper than the
 *   machine's workable slope (explicit `maxSlope`, or a conservative default) is
 *   counted as over-limit. Too much over-limit ground makes the machine
 *   incompatible; a small fraction is allowed as "partial" with a time penalty.
 * - Aircraft are modelled by load/coverage: heavier fuel needs higher coverage,
 *   so effective line per drop shrinks; cost uses per-drop cost when available.
 * - When the caller supplies a joined `segments[]` profile the model uses it
 *   directly; otherwise it degrades gracefully to the marginal slope/vegetation
 *   distributions (still integrated over slope, better than single-bucket).
 */

import { TerrainLevel, VegetationType } from '../types/common';
import {
  ResourceKind,
  effectiveRate,
  fuelFactor,
  handCrewWidthMultiplier,
  machineryWidthMultiplier,
  resolveMaxSlopeDegrees,
  slopeToTerrain,
} from './productionModel';

export interface TrackAnalysis {
  maxSlope: number;
  totalDistance: number;
  slopeDistribution: Record<string, number>;
}

export interface VegetationAnalysis {
  predominantVegetation: VegetationType;
  coverage?: Record<VegetationType, number>;
  vegetationDistribution?: Record<VegetationType, number>;
  overallConfidence?: number;
}

/** A resolved slice of the planned line with (approximately) uniform conditions. */
export interface RouteSegment {
  /** Length of this segment in metres. */
  length: number;
  /** Representative slope for the segment, in degrees. */
  slopeDegrees: number;
  /** Fuel / vegetation class for the segment. */
  vegetation: VegetationType;
  /** Detection confidence for the vegetation class (0..1), optional. */
  vegetationConfidence?: number;
}

export interface EquipmentSpec {
  id: string;
  name: string;
  type: ResourceKind;
  allowedTerrain: TerrainLevel[];
  allowedVegetation: VegetationType[];
  clearingRate?: number;
  costPerHour?: number;
  description?: string;
  maxSlope?: number;
  /** Machinery blade cut width per pass (m). */
  cutWidthMeters?: number;
  // Aircraft specific
  dropLength?: number;
  turnaroundMinutes?: number;
  capacityLitres?: number;
  costPerDrop?: number;
  // Hand crew specific
  crewSize?: number;
  clearingRatePerPerson?: number;
}

export interface CalculationResult {
  id: string;
  name: string;
  type: ResourceKind;
  time: number;
  cost: number;
  compatible: boolean;
  compatibilityLevel: 'full' | 'partial' | 'incompatible';
  unit: string;
  description?: string;
  slopeCompatible?: boolean;
  maxSlopeExceeded?: number;
  drops?: number;
  /** Machinery passes required to reach the requested break width. */
  passes?: number;
  overLimitPercent?: number;
  /** Vegetation-detection confidence carried through for UI signalling (0..1). */
  confidence?: number;
  note?: string;
  validationErrors?: string[];
}

export interface AnalysisParameters {
  terrainFactors?: Record<TerrainLevel, number>;
  vegetationFactors?: Record<VegetationType, number>;
}

export interface AnalysisRequest {
  distance: number;
  trackAnalysis: TrackAnalysis;
  vegetationAnalysis: VegetationAnalysis;
  /** Joined per-segment route profile. Preferred; falls back to distributions. */
  segments?: RouteSegment[];
  /** Target fire break width (m). Machinery does multiple passes; hand-crew effort scales. */
  breakWidthMeters?: number;
  parameters?: AnalysisParameters;
}

export interface AnalysisResponse {
  calculations: CalculationResult[];
  metadata: {
    timestamp: string;
    equipmentCount: number;
    validationErrors: string[];
    analysisParameters: {
      effectiveTerrain: TerrainLevel;
      effectiveVegetation: VegetationType;
      /** Length-weighted mean slope across the route (degrees). */
      meanSlope: number;
      /** Steepest segment slope on the route (degrees). */
      maxSlope: number;
      /** Number of segments the estimate integrated over. */
      segmentCount: number;
      /** Whether a joined segment profile was supplied (true) or synthesised. */
      profileFromClient: boolean;
      /** Overall vegetation-detection confidence (0..1). */
      overallConfidence: number;
    };
  };
}

// Representative slope (degrees) for each coarse category, used only when a
// joined segment profile is unavailable and we synthesise from distributions.
const CATEGORY_REPRESENTATIVE_SLOPE: Record<string, number> = {
  flat: 5,
  medium: 17,
  steep: 34,
  very_steep: 50,
};

// Tunable gating constants (documented; previously scattered magic numbers).
/** Fraction of route allowed to exceed a resource's limits before it is ruled out. */
const PARTIAL_THRESHOLD = 0.15;
/** Time-penalty slope of the partial band: penalty = 1 + overFraction × K. */
const PARTIAL_TIME_PENALTY_K = 2;

export class EquipmentAnalysisService {
  private validateEquipment(equipment: EquipmentSpec): string[] {
    const errors: string[] = [];
    if (!equipment.id || equipment.id.trim() === '') errors.push('Equipment ID is required');
    if (!equipment.name || equipment.name.trim() === '') errors.push('Equipment name is required');
    if (!equipment.allowedTerrain || equipment.allowedTerrain.length === 0) {
      errors.push('Equipment must specify allowed terrain types');
    }
    if (!equipment.allowedVegetation || equipment.allowedVegetation.length === 0) {
      errors.push('Equipment must specify allowed vegetation types');
    }
    if (equipment.type === 'Machinery') {
      if (!equipment.clearingRate || equipment.clearingRate <= 0) {
        errors.push('Machinery must have positive clearing rate');
      }
    } else if (equipment.type === 'Aircraft') {
      if (!equipment.dropLength || equipment.dropLength <= 0) {
        errors.push('Aircraft must have positive drop length');
      }
      if (!equipment.turnaroundMinutes || equipment.turnaroundMinutes <= 0) {
        errors.push('Aircraft must have positive turnaround time');
      }
    } else if (equipment.type === 'HandCrew') {
      if (!equipment.crewSize || equipment.crewSize <= 0) {
        errors.push('Hand crew must have positive crew size');
      }
      if (!equipment.clearingRatePerPerson || equipment.clearingRatePerPerson <= 0) {
        errors.push('Hand crew must have positive clearing rate per person');
      }
    }
    return errors;
  }

  /**
   * Build the per-segment route profile the estimate integrates over. Uses the
   * client-supplied joined profile when present; otherwise synthesises segments
   * from the slope distribution (integrating slope properly) with the route's
   * predominant vegetation applied to each.
   */
  private buildProfile(request: AnalysisRequest): { segments: RouteSegment[]; fromClient: boolean } {
    if (request.segments && request.segments.length > 0) {
      const cleaned = request.segments.filter((s) => s && s.length > 0);
      if (cleaned.length > 0) return { segments: cleaned, fromClient: true };
    }

    const predominant = request.vegetationAnalysis.predominantVegetation || 'grassland';
    const dist = request.trackAnalysis.slopeDistribution || {};
    const segments: RouteSegment[] = [];
    for (const [category, length] of Object.entries(dist)) {
      if (!length || length <= 0) continue;
      segments.push({
        length: length as number,
        slopeDegrees: CATEGORY_REPRESENTATIVE_SLOPE[category] ?? 5,
        vegetation: predominant,
        vegetationConfidence: request.vegetationAnalysis.overallConfidence,
      });
    }
    // Nothing usable in the distribution — fall back to one flat segment.
    if (segments.length === 0) {
      segments.push({
        length: request.distance || request.trackAnalysis.totalDistance || 0,
        slopeDegrees: request.trackAnalysis.maxSlope || 0,
        vegetation: predominant,
        vegetationConfidence: request.vegetationAnalysis.overallConfidence,
      });
    }
    return { segments, fromClient: false };
  }

  /** Reference (flat-grassland) production rate in m/hr for a line-building resource. */
  private referenceRate(equipment: EquipmentSpec): number {
    if (equipment.type === 'Machinery') return equipment.clearingRate || 0;
    if (equipment.type === 'HandCrew') {
      return (equipment.crewSize || 0) * (equipment.clearingRatePerPerson || 0);
    }
    return 0;
  }

  /**
   * Integrate a line-building resource (Machinery or HandCrew) over the profile.
   */
  private evaluateLineResource(
    equipment: EquipmentSpec,
    segments: RouteSegment[],
    breakWidthMeters?: number
  ): CalculationResult {
    const kind = equipment.type;
    const refRate = this.referenceRate(equipment);
    const allowedVeg = new Set(equipment.allowedVegetation);
    const slopeLimit = resolveMaxSlopeDegrees(kind, equipment.maxSlope, equipment.allowedTerrain);

    // Break-width handling: published rates are single-pass; widen accordingly.
    let widthMultiplier = 1;
    let passes: number | undefined;
    if (kind === 'Machinery') {
      const w = machineryWidthMultiplier(breakWidthMeters, equipment.cutWidthMeters);
      widthMultiplier = w.multiplier;
      passes = w.passes;
    } else if (kind === 'HandCrew') {
      widthMultiplier = handCrewWidthMultiplier(breakWidthMeters);
    }

    let totalLength = 0;
    let overLength = 0;
    let time = 0;
    let steepestOver = 0;
    let confidenceWeighted = 0;

    for (const seg of segments) {
      totalLength += seg.length;
      confidenceWeighted += (seg.vegetationConfidence ?? 0) * seg.length;

      const slopeOver = seg.slopeDegrees > slopeLimit;
      const vegOver = !allowedVeg.has(seg.vegetation);
      if (slopeOver || vegOver) {
        overLength += seg.length;
        if (seg.slopeDegrees > steepestOver) steepestOver = seg.slopeDegrees;
      }

      const rate = effectiveRate(refRate, kind, seg.vegetation, seg.slopeDegrees);
      // A workable segment always has rate > 0. For an over-limit segment we
      // still accrue notional time so partial estimates remain meaningful.
      if (rate > 0) {
        time += seg.length / rate;
      } else if (refRate > 0) {
        time += seg.length / (refRate * 0.1);
      }
    }

    const overFraction = totalLength > 0 ? overLength / totalLength : 0;
    let level: 'full' | 'partial' | 'incompatible';
    if (overFraction === 0) level = 'full';
    else if (overFraction <= PARTIAL_THRESHOLD) level = 'partial';
    else level = 'incompatible';

    if (level === 'partial') {
      time *= 1 + overFraction * PARTIAL_TIME_PENALTY_K;
    }

    time *= widthMultiplier;

    const compatible = level !== 'incompatible';
    const cost = compatible && equipment.costPerHour ? time * equipment.costPerHour : 0;
    const slopeCompatible = steepestOver === 0 || steepestOver <= slopeLimit;
    const confidence = totalLength > 0 ? confidenceWeighted / totalLength : undefined;

    const notes: string[] = [];
    if (level === 'incompatible') {
      notes.push(`${Math.round(overFraction * 100)}% of route exceeds this resource's slope/fuel limits`);
    } else if (level === 'partial') {
      notes.push(`~${Math.round(overFraction * 100)}% of route over limits; time penalty applied`);
    }
    if (compatible && passes && passes > 1) {
      notes.push(`${passes} passes for ${Math.round(breakWidthMeters || 0)}m break`);
    } else if (compatible && kind === 'HandCrew' && widthMultiplier > 1) {
      notes.push(`effort scaled ×${widthMultiplier.toFixed(1)} for ${Math.round(breakWidthMeters || 0)}m break`);
    }
    const note = notes.length ? notes.join(' • ') : undefined;

    return {
      id: equipment.id,
      name: equipment.name,
      type: kind,
      time: compatible ? time : 0,
      cost,
      compatible,
      compatibilityLevel: level,
      unit: 'hours',
      description: equipment.description,
      slopeCompatible,
      maxSlopeExceeded: steepestOver > slopeLimit ? steepestOver : undefined,
      passes,
      overLimitPercent: overFraction > 0 ? overFraction : undefined,
      confidence,
      note,
    };
  }

  /**
   * Evaluate an aircraft using a load/coverage model. Heavier fuel needs higher
   * coverage, shrinking effective line per drop. Cost prefers per-drop cost.
   */
  private evaluateAircraft(equipment: EquipmentSpec, segments: RouteSegment[]): CalculationResult {
    const allowedVeg = new Set(equipment.allowedVegetation);
    const dropLength = equipment.dropLength || 100;
    const turnaroundMinutes = equipment.turnaroundMinutes || 15;

    let totalLength = 0;
    let overLength = 0;
    let fractionalDrops = 0;
    let confidenceWeighted = 0;

    for (const seg of segments) {
      totalLength += seg.length;
      confidenceWeighted += (seg.vegetationConfidence ?? 0) * seg.length;
      if (!allowedVeg.has(seg.vegetation)) overLength += seg.length;

      const effectiveDrop = dropLength * fuelFactor('Aircraft', seg.vegetation);
      if (effectiveDrop > 0) fractionalDrops += seg.length / effectiveDrop;
    }

    const overFraction = totalLength > 0 ? overLength / totalLength : 0;
    let level: 'full' | 'partial' | 'incompatible';
    if (overFraction === 0) level = 'full';
    else if (overFraction <= PARTIAL_THRESHOLD) level = 'partial';
    else level = 'incompatible';

    const compatible = level !== 'incompatible';
    const drops = Math.max(1, Math.ceil(fractionalDrops));
    const time = compatible ? drops * (turnaroundMinutes / 60) : 0;

    let cost = 0;
    if (compatible) {
      if (equipment.costPerDrop && equipment.costPerDrop > 0) cost = drops * equipment.costPerDrop;
      else if (equipment.costPerHour) cost = time * equipment.costPerHour;
    }

    const confidence = totalLength > 0 ? confidenceWeighted / totalLength : undefined;
    let note: string | undefined;
    if (level === 'incompatible') {
      note = `${Math.round(overFraction * 100)}% of route in fuel this aircraft cannot effectively treat`;
    } else if (level === 'partial') {
      note = `~${Math.round(overFraction * 100)}% of route in marginal fuel`;
    }

    return {
      id: equipment.id,
      name: equipment.name,
      type: 'Aircraft',
      time,
      cost,
      compatible,
      compatibilityLevel: level,
      unit: 'hours',
      description: equipment.description,
      drops: compatible ? drops : 0,
      overLimitPercent: overFraction > 0 ? overFraction : undefined,
      confidence,
      note,
    };
  }

  /**
   * Cost-optimised machinery hint: flag the cheapest compatible machine whose
   * time is within 2× the fastest, and annotate the rest with why.
   */
  private optimizeMachinerySelection(results: CalculationResult[]): CalculationResult[] {
    const machineryResults = results.filter((r) => r.type === 'Machinery' && r.compatible);
    if (machineryResults.length <= 1) return results;

    const fastest = machineryResults.reduce((f, c) => (c.time < f.time ? c : f));
    const maxAcceptableTime = fastest.time * 2;
    const acceptable = machineryResults.filter((m) => m.time <= maxAcceptableTime);
    if (acceptable.length === 0) return results;

    acceptable.sort((a, b) => a.cost - b.cost);
    const recommended = acceptable[0];

    return results.map((result) => {
      if (result.type !== 'Machinery' || !result.compatible) return result;
      if (result.id === recommended.id) {
        return {
          ...result,
          note: result.note ? `${result.note} • Cost-optimised selection` : 'Cost-optimised selection',
        };
      }
      const timeRatio = result.time / fastest.time;
      const costSavings = result.cost - recommended.cost;
      let reason = '';
      if (result.time > maxAcceptableTime) reason = `Takes ${timeRatio.toFixed(1)}× longer than fastest option`;
      else if (result.cost > recommended.cost) reason = `$${Math.round(costSavings)} more than cost-optimised choice`;
      return { ...result, note: result.note ? `${result.note} • ${reason}` : reason };
    });
  }

  public async analyzeEquipment(
    request: AnalysisRequest,
    equipmentList: EquipmentSpec[]
  ): Promise<AnalysisResponse> {
    const validationErrors: string[] = [];
    const results: CalculationResult[] = [];

    const { segments, fromClient } = this.buildProfile(request);

    // Route-level descriptive stats for metadata.
    let totalLength = 0;
    let slopeWeighted = 0;
    let maxSlope = 0;
    let confidenceWeighted = 0;
    for (const seg of segments) {
      totalLength += seg.length;
      slopeWeighted += seg.slopeDegrees * seg.length;
      confidenceWeighted += (seg.vegetationConfidence ?? 0) * seg.length;
      if (seg.slopeDegrees > maxSlope) maxSlope = seg.slopeDegrees;
    }
    const meanSlope = totalLength > 0 ? slopeWeighted / totalLength : 0;
    const overallConfidence =
      request.vegetationAnalysis.overallConfidence ??
      (totalLength > 0 ? confidenceWeighted / totalLength : 0);
    const effectiveVegetation = request.vegetationAnalysis.predominantVegetation || 'grassland';

    for (const equipment of equipmentList) {
      const equipmentErrors = this.validateEquipment(equipment);
      if (equipmentErrors.length > 0) {
        validationErrors.push(`${equipment.name}: ${equipmentErrors.join(', ')}`);
        results.push({
          id: equipment.id,
          name: equipment.name,
          type: equipment.type,
          time: 0,
          cost: 0,
          compatible: false,
          compatibilityLevel: 'incompatible',
          unit: 'hours',
          description: equipment.description,
          validationErrors: equipmentErrors,
          note: 'Equipment configuration invalid',
        });
        continue;
      }

      if (equipment.type === 'Machinery' || equipment.type === 'HandCrew') {
        results.push(this.evaluateLineResource(equipment, segments, request.breakWidthMeters));
      } else if (equipment.type === 'Aircraft') {
        results.push(this.evaluateAircraft(equipment, segments));
      }
    }

    const optimizedResults = this.optimizeMachinerySelection(results);

    optimizedResults.sort((a, b) => {
      const rank = (r: CalculationResult) =>
        r.compatibilityLevel === 'full' ? 0 : r.compatibilityLevel === 'partial' ? 1 : 2;
      const ar = rank(a);
      const br = rank(b);
      if (ar !== br) return ar - br;
      if (ar === 2) return 0;
      if (Math.abs(a.time - b.time) < 0.1) return a.cost - b.cost;
      return a.time - b.time;
    });

    return {
      calculations: optimizedResults,
      metadata: {
        timestamp: new Date().toISOString(),
        equipmentCount: equipmentList.length,
        validationErrors,
        analysisParameters: {
          effectiveTerrain: slopeToTerrain(meanSlope),
          effectiveVegetation,
          meanSlope,
          maxSlope,
          segmentCount: segments.length,
          profileFromClient: fromClient,
          overallConfidence,
        },
      },
    };
  }
}
