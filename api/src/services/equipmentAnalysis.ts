/**
 * Equipment Analysis Service
 * 
 * Core business logic for calculating fire break equipment recommendations.
 * Moved from frontend to backend for better reliability, debugging, and performance.
 */

import { TerrainLevel, VegetationType } from '../types/common';

export interface TrackAnalysis {
  maxSlope: number;
  totalDistance: number;
  slopeDistribution: Record<string, number>;
}

export interface VegetationAnalysis {
  predominantVegetation: VegetationType;
  coverage: Record<VegetationType, number>;
}

export interface EquipmentSpec {
  id: string;
  name: string;
  type: 'Machinery' | 'Aircraft' | 'HandCrew';
  allowedTerrain: TerrainLevel[];
  allowedVegetation: VegetationType[];
  clearingRate?: number;
  costPerHour?: number;
  description?: string;
  // Machinery specific
  maxSlope?: number;
  // Aircraft specific
  dropLength?: number;
  turnaroundMinutes?: number;
  // Hand crew specific
  crewSize?: number;
  clearingRatePerPerson?: number;
}

export interface CalculationResult {
  id: string;
  name: string;
  type: 'Machinery' | 'Aircraft' | 'HandCrew';
  time: number;
  cost: number;
  compatible: boolean;
  compatibilityLevel: 'full' | 'partial' | 'incompatible';
  unit: string;
  description?: string;
  slopeCompatible?: boolean;
  maxSlopeExceeded?: number;
  drops?: number;
  overLimitPercent?: number;
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
      terrainFactor: number;
      vegetationFactor: number;
    };
  };
}

// Default factors (can be overridden by request parameters)
const DEFAULT_TERRAIN_FACTORS: Record<TerrainLevel, number> = {
  easy: 1.0,
  moderate: 1.3,
  difficult: 1.7,
  extreme: 2.2
};

const DEFAULT_VEGETATION_FACTORS: Record<VegetationType, number> = {
  grassland: 1.0,
  lightshrub: 1.1,
  mediumscrub: 1.5,
  heavyforest: 2.0
};

const TERRAIN_RANK: Record<TerrainLevel, number> = {
  easy: 0,
  moderate: 1,
  difficult: 2,
  extreme: 3
};

const SLOPE_CATEGORY_TO_TERRAIN: Record<string, TerrainLevel> = {
  flat: 'easy',
  medium: 'moderate',
  steep: 'difficult',
  very_steep: 'extreme'
};

export class EquipmentAnalysisService {
  
  /**
   * Validate equipment specification
   */
  private validateEquipment(equipment: EquipmentSpec): string[] {
    const errors: string[] = [];
    
    if (!equipment.id || equipment.id.trim() === '') {
      errors.push('Equipment ID is required');
    }
    
    if (!equipment.name || equipment.name.trim() === '') {
      errors.push('Equipment name is required');
    }
    
    if (!equipment.allowedTerrain || equipment.allowedTerrain.length === 0) {
      errors.push('Equipment must specify allowed terrain types');
    }
    
    if (!equipment.allowedVegetation || equipment.allowedVegetation.length === 0) {
      errors.push('Equipment must specify allowed vegetation types');
    }
    
    // Type-specific validations
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
   * Derive terrain level from maximum slope
   */
  private deriveTerrainFromSlope(maxSlope: number): TerrainLevel {
    if (maxSlope < 10) return 'easy';
    if (maxSlope < 20) return 'moderate';
    if (maxSlope < 30) return 'difficult';
    return 'extreme';
  }
  
  /**
   * Check basic environment compatibility (terrain and vegetation)
   */
  private isEnvironmentCompatible(
    equipment: EquipmentSpec,
    requiredTerrain: TerrainLevel,
    vegetation: VegetationType
  ): boolean {
    // Terrain hierarchy check - equipment can handle anything up to its max capability
    const highestAllowedRank = Math.max(...equipment.allowedTerrain.map(t => TERRAIN_RANK[t]));
    const requiredRank = TERRAIN_RANK[requiredTerrain];
    const terrainCompatible = requiredRank <= highestAllowedRank;
    
    // Vegetation exact match
    const vegetationCompatible = equipment.allowedVegetation.includes(vegetation);
    
    return terrainCompatible && vegetationCompatible;
  }
  
  /**
   * Check slope compatibility for machinery
   */
  private isSlopeCompatible(
    equipment: EquipmentSpec,
    maxSlope: number
  ): { compatible: boolean; maxSlopeExceeded?: number } {
    if (equipment.maxSlope == null) return { compatible: true };
    const compatible = maxSlope <= equipment.maxSlope;
    return { compatible, maxSlopeExceeded: compatible ? undefined : maxSlope };
  }
  
  /**
   * Evaluate machinery terrain compatibility with partial support
   */
  private evaluateMachineryCompatibility(
    equipment: EquipmentSpec,
    trackAnalysis: TrackAnalysis,
    vegetation: VegetationType,
    requiredTerrain: TerrainLevel
  ): { level: 'full' | 'partial' | 'incompatible'; overLimitPercent?: number; note?: string } {
    
    // Basic environment check first
    if (!this.isEnvironmentCompatible(equipment, requiredTerrain, vegetation)) {
      return { level: 'incompatible', note: 'Terrain/vegetation not permitted' };
    }
    
    // If no detailed track data, fall back to simple check
    if (!trackAnalysis || !trackAnalysis.slopeDistribution) {
      return { level: 'full' };
    }
    
    // Calculate percentage of route that exceeds equipment capability
    const highestAllowed = Math.max(...equipment.allowedTerrain.map(t => TERRAIN_RANK[t]));
    const distByCat = trackAnalysis.slopeDistribution;
    
    const overDistance = Object.entries(distByCat).reduce((acc, [cat, dist]) => {
      const terrain = SLOPE_CATEGORY_TO_TERRAIN[cat];
      if (!terrain) return acc;
      const rank = TERRAIN_RANK[terrain];
      return rank > highestAllowed ? acc + (dist as number) : acc;
    }, 0);
    
    const total = trackAnalysis.totalDistance || 0;
    const overPercent = total > 0 ? overDistance / total : 0;
    
    if (overPercent === 0) return { level: 'full' };
    
    // Allow partial if within threshold (15%)
    const PARTIAL_THRESHOLD = 0.15;
    if (overPercent <= PARTIAL_THRESHOLD) {
      return {
        level: 'partial',
        overLimitPercent: overPercent,
        note: `~${Math.round(overPercent * 100)}% of route exceeds rated terrain; applying time penalty.`
      };
    }
    
    return {
      level: 'incompatible',
      overLimitPercent: overPercent,
      note: 'Too much difficult terrain'
    };
  }
  
  /**
   * Calculate machinery time
   */
  private calculateMachineryTime(
    distance: number,
    equipment: EquipmentSpec,
    terrainFactor: number,
    vegetationFactor: number
  ): number {
    const clearingRate = equipment.clearingRate || 0;
    if (clearingRate <= 0) return 0;
    
    const adjustedRate = clearingRate / (terrainFactor * vegetationFactor);
    return distance / adjustedRate; // hours
  }
  
  /**
   * Calculate aircraft drops and time
   */
  private calculateAircraftTime(
    distance: number,
    equipment: EquipmentSpec
  ): { time: number; drops: number } {
    const dropLength = equipment.dropLength || 100; // Default 100m
    const turnaroundMinutes = equipment.turnaroundMinutes || 15; // Default 15 minutes
    
    const drops = Math.ceil(distance / dropLength);
    const totalTime = drops * (turnaroundMinutes / 60); // Convert to hours
    
    return { time: totalTime, drops };
  }
  
  /**
   * Calculate hand crew time
   */
  private calculateHandCrewTime(
    distance: number,
    equipment: EquipmentSpec,
    terrainFactor: number,
    vegetationFactor: number
  ): number {
    const crewSize = equipment.crewSize || 0;
    const ratePerPerson = equipment.clearingRatePerPerson || 0;
    
    if (crewSize <= 0 || ratePerPerson <= 0) return 0;
    
    const totalRate = crewSize * ratePerPerson;
    const adjustedRate = totalRate / (terrainFactor * vegetationFactor);
    return distance / adjustedRate; // hours
  }
  
  /**
   * Main analysis method
   */
  public async analyzeEquipment(
    request: AnalysisRequest,
    equipmentList: EquipmentSpec[]
  ): Promise<AnalysisResponse> {
    
    const validationErrors: string[] = [];
    const results: CalculationResult[] = [];
    
    // Determine analysis parameters
    const terrainFactors = { ...DEFAULT_TERRAIN_FACTORS, ...(request.parameters?.terrainFactors || {}) };
    const vegetationFactors = { ...DEFAULT_VEGETATION_FACTORS, ...(request.parameters?.vegetationFactors || {}) };
    
    const effectiveTerrain = this.deriveTerrainFromSlope(request.trackAnalysis.maxSlope);
    const effectiveVegetation = request.vegetationAnalysis.predominantVegetation;
    const terrainFactor = terrainFactors[effectiveTerrain];
    const vegetationFactor = vegetationFactors[effectiveVegetation];
    
    // Process each piece of equipment
    for (const equipment of equipmentList) {
      const equipmentErrors = this.validateEquipment(equipment);
      
      if (equipmentErrors.length > 0) {
        validationErrors.push(`${equipment.name}: ${equipmentErrors.join(', ')}`);
        
        // Add incompatible result for invalid equipment
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
          note: 'Equipment configuration invalid'
        });
        continue;
      }
      
      // Calculate based on equipment type
      if (equipment.type === 'Machinery') {
        const terrainEval = this.evaluateMachineryCompatibility(
          equipment,
          request.trackAnalysis,
          effectiveVegetation,
          effectiveTerrain
        );
        
        const slopeCheck = this.isSlopeCompatible(equipment, request.trackAnalysis.maxSlope);
        
        const compatible = (terrainEval.level === 'full' || terrainEval.level === 'partial') && slopeCheck.compatible;
        
        let time = 0;
        if (compatible) {
          time = this.calculateMachineryTime(request.distance, equipment, terrainFactor, vegetationFactor);
          
          // Apply penalty for partial compatibility
          if (terrainEval.level === 'partial' && terrainEval.overLimitPercent) {
            const penaltyMultiplier = 1 + terrainEval.overLimitPercent * 2;
            time *= penaltyMultiplier;
          }
        }
        
        const cost = compatible && equipment.costPerHour ? time * equipment.costPerHour : 0;
        
        results.push({
          id: equipment.id,
          name: equipment.name,
          type: equipment.type,
          time,
          cost,
          compatible,
          compatibilityLevel: !slopeCheck.compatible || terrainEval.level === 'incompatible' ? 'incompatible' : terrainEval.level,
          unit: 'hours',
          description: equipment.description,
          slopeCompatible: slopeCheck.compatible,
          maxSlopeExceeded: slopeCheck.maxSlopeExceeded,
          overLimitPercent: terrainEval.overLimitPercent,
          note: !slopeCheck.compatible ? 'Slope exceeds capability' : terrainEval.note
        });
        
      } else if (equipment.type === 'Aircraft') {
        const compatible = this.isEnvironmentCompatible(equipment, effectiveTerrain, effectiveVegetation);
        
        let time = 0;
        let drops = 0;
        if (compatible) {
          const calc = this.calculateAircraftTime(request.distance, equipment);
          time = calc.time;
          drops = calc.drops;
        }
        
        const cost = compatible && equipment.costPerHour ? time * equipment.costPerHour : 0;
        
        results.push({
          id: equipment.id,
          name: equipment.name,
          type: equipment.type,
          time,
          cost,
          compatible,
          compatibilityLevel: compatible ? 'full' : 'incompatible',
          unit: 'hours',
          description: equipment.description,
          drops
        });
        
      } else if (equipment.type === 'HandCrew') {
        const compatible = this.isEnvironmentCompatible(equipment, effectiveTerrain, effectiveVegetation);
        
        const time = compatible ? this.calculateHandCrewTime(request.distance, equipment, terrainFactor, vegetationFactor) : 0;
        const cost = compatible && equipment.costPerHour ? time * equipment.costPerHour : 0;
        
        results.push({
          id: equipment.id,
          name: equipment.name,
          type: equipment.type,
          time,
          cost,
          compatible,
          compatibilityLevel: compatible ? 'full' : 'incompatible',
          unit: 'hours',
          description: equipment.description
        });
      }
    }
    
    // Sort results: compatible first (by time, then cost), then incompatible
    results.sort((a, b) => {
      if (a.compatible !== b.compatible) {
        return a.compatible ? -1 : 1;
      }
      
      if (a.compatible) {
        // Both compatible - sort by time, then cost
        if (Math.abs(a.time - b.time) < 0.1) {
          return a.cost - b.cost;
        }
        return a.time - b.time;
      }
      
      // Both incompatible - keep original order
      return 0;
    });
    
    return {
      calculations: results,
      metadata: {
        timestamp: new Date().toISOString(),
        equipmentCount: equipmentList.length,
        validationErrors,
        analysisParameters: {
          effectiveTerrain,
          effectiveVegetation,
          terrainFactor,
          vegetationFactor
        }
      }
    };
  }
}
