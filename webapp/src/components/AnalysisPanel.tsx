/**
 * Analysis Panel component for displaying fire break calculations.
 * Shows estimated time and resources required for different equipment types
 * based on the drawn fire break line and selected parameters.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { MachinerySpec, AircraftSpec, HandCrewSpec, TrackAnalysis, VegetationAnalysis } from '../types/config';
import { deriveTerrainFromSlope, VEGETATION_TYPES, TerrainLevel, VegetationType } from '../config/classification';
import { DistributionBar } from './DistributionBar';
import { OverlapMatrix } from './OverlapMatrix';
import { HelpContent } from './HelpContent';
import { SLOPE_CATEGORIES, VEGETATION_CATEGORIES } from '../config/categories';
import { getVegetationTypeDisplayName, getTerrainLevelDisplayName } from '../utils/formatters';
import { calculateEquipmentAnalysis, BackendCalculationResult, testBackendAnalysis } from '../utils/backendAnalysis';

interface AnalysisPanelProps {
  /** Distance of the drawn fire break in meters */
  distance: number | null;
  /** Track analysis data including slope information */
  trackAnalysis: TrackAnalysis | null;
  /** Vegetation analysis data from Mapbox Terrain v2 */
  vegetationAnalysis: VegetationAnalysis | null;
  /** Whether analysis is currently running */
  isAnalyzing?: boolean;
  /** Available machinery options */
  machinery: MachinerySpec[];
  /** Available aircraft options */
  aircraft: AircraftSpec[];
  /** Available hand crew options */
  handCrews: HandCrewSpec[];
  /** Currently selected aircraft for preview */
  selectedAircraftForPreview?: string[];
  /** Callback for when drop preview selection changes */
  onDropPreviewChange?: (aircraftIds: string[]) => void;
  /** Callback for when expanded state changes */
  onExpandedChange?: (isExpanded: boolean) => void;
  /** True when the parent map has completed initial pan/zoom to the user's location
   *  (or attempted fallback). Gate heavy backend analysis until this is true to
   *  avoid spamming the backend while the map is still settling. */
  mapSettled?: boolean;
}

// Use centralized type definitions from classification.ts
// Using TerrainLevel directly from classification.ts for consistency


interface CalculationResult {
  id: string;
  name: string;
  type: 'machinery' | 'aircraft' | 'handCrew';
  /** Estimated total time in hours */
  time: number;
  /** Estimated total cost (0 if unknown) */
  cost: number;
  /** True when either fully or partially compatible */
  compatible: boolean;
  /** Granular compatibility state for clearer UX */
  compatibilityLevel?: 'full' | 'partial' | 'incompatible';
  /** Slope constraint result for machinery */
  slopeCompatible?: boolean;
  /** If slope exceeds capability the encountered (max) slope value */
  maxSlopeExceeded?: number;
  /** Aircraft-only: number of required drops */
  drops?: number;
  /** Output unit (presently always 'hours') */
  unit: string;
  description?: string;
  /** For partial compatibility: percentage (0–1) of distance outside spec */
  overLimitPercent?: number;
  /** Reason / notes shown in tooltip or future detailed view */
  note?: string;
}

/**
 * Get appropriate icon for equipment type
 */
const getEquipmentIcon = (result: CalculationResult): string => {
  if (result.type === 'machinery') {
    // Check if it's a dozer or grader from the name
    if (result.name.toLowerCase().includes('dozer')) {
      return '🚜';
    } else if (result.name.toLowerCase().includes('grader')) {
      return '🛠️';
    }
    return '🚜'; // Default to bulldozer for machinery
  } else if (result.type === 'aircraft') {
    // Check if it's a helicopter or fixed wing
    if (result.name.toLowerCase().includes('helicopter')) {
      return '🚁';
    } else {
      return '✈️';
    }
  } else if (result.type === 'handCrew') {
    return '👨‍🚒';
  }
  return '';
};

/**
 * Calculate time required for machinery to clear the fire break
 * TODO: Future enhancement - integrate elevation profile analysis
 * similar to https://docs.mapbox.com/mapbox-gl-js/example/elevation-along-line/
 * to factor in slope steepness for more accurate time calculations
 */
const calculateMachineryTime = (
  distance: number,
  machinery: MachinerySpec,
  terrainFactor: number,
  vegetationFactor: number
): number => {
  const adjustedRate = machinery.clearingRate / (terrainFactor * vegetationFactor);
  return distance / adjustedRate; // hours
};

/**
 * Calculate number of aircraft drops required
 */
const calculateAircraftDrops = (distance: number, aircraft: AircraftSpec): number => {
  // Ensure we have a valid drop length to avoid division by zero
  const dropLength = aircraft.dropLength || 100; // Default to 100m if not specified
  return Math.ceil(distance / dropLength);
};

/**
 * Calculate time required for hand crews
 */
const calculateHandCrewTime = (
  distance: number,
  handCrew: HandCrewSpec,
  terrainFactor: number,
  vegetationFactor: number
): number => {
  const totalRate = handCrew.crewSize * handCrew.clearingRatePerPerson;
  const adjustedRate = totalRate / (terrainFactor * vegetationFactor);
  return distance / adjustedRate; // hours
};

/**
 * Basic terrain & vegetation membership check (used for aircraft & hand crew, and as a first pass for machinery).
 * This has been enhanced to handle terrain hierarchies properly.
 */
const baseEnvironmentCompatible = (
  equipment: MachinerySpec | AircraftSpec | HandCrewSpec,
  requiredTerrain: TerrainLevel,
  vegetation: VegetationType
): boolean => {
  console.log(`      🔍 Checking base environment compatibility for ${equipment.name}:`, {
    equipmentId: equipment.id,
    equipmentAllowedTerrain: equipment.allowedTerrain,
    equipmentAllowedVegetation: equipment.allowedVegetation,
    requiredTerrain,
    vegetation
  });

  // For terrain compatibility, equipment can handle anything up to its maximum allowed difficulty
  const highestAllowedRank = Math.max(...equipment.allowedTerrain.map(t => terrainRank[t]));
  const requiredRank = terrainRank[requiredTerrain];
  const terrainCompatible = requiredRank <= highestAllowedRank;
  
  console.log(`      🏔️ Terrain compatibility check:`, {
    highestAllowedRank,
    requiredRank,
    terrainCompatible,
    terrainRankings: equipment.allowedTerrain.map(t => ({ terrain: t, rank: terrainRank[t] }))
  });
  
  // For vegetation, we need an exact match
  const vegetationCompatible = equipment.allowedVegetation.includes(vegetation);
  
  console.log(`      🌿 Vegetation compatibility check:`, {
    allowedVegetation: equipment.allowedVegetation,
    requiredVegetation: vegetation,
    vegetationCompatible
  });
  
  const overall = terrainCompatible && vegetationCompatible;
  console.log(`      ✅ Overall base compatibility:`, overall);
  
  return overall;
};

/** Ordinal ordering helper for terrain difficulty */
const terrainRank: Record<TerrainLevel, number> = { flat: 0, medium: 1, steep: 2, very_steep: 3 };

/** Map slope category key → terrain level (mirrors deriveTerrainFromSlope logic) */
const slopeCategoryToTerrain: Record<string, TerrainLevel> = {
  flat: 'flat',
  medium: 'medium',
  steep: 'steep',
  very_steep: 'very_steep'
};

/**
 * Determine machinery compatibility allowing partial matches when only a small portion
 * of the line exceeds the machine's rated terrain class. This addresses prior overly
 * strict exclusion where any presence of a higher terrain class removed otherwise viable equipment.
 *
 * Partial rule: if distance percentage above machine capability ≤ 15%, treat as partial (time penalty applied).
 */
function evaluateMachineryTerrainCompatibility(
  machine: MachinerySpec,
  trackAnalysis: TrackAnalysis | null,
  vegetation: VegetationType,
  requiredTerrain: TerrainLevel
): { level: 'full' | 'partial' | 'incompatible'; overLimitPercent?: number; note?: string } {
  // If we lack detailed track data fall back to simple membership logic
  if (!trackAnalysis) {
    return baseEnvironmentCompatible(machine, requiredTerrain, vegetation)
      ? { level: 'full' }
      : { level: 'incompatible', note: 'Terrain/vegetation not permitted' };
  }

  const simpleOk = baseEnvironmentCompatible(machine, requiredTerrain, vegetation);
  // Fast path: if highest required terrain is within machine allowance we are full compatible.
  const highestAllowed = machine.allowedTerrain.reduce((max, t) => Math.max(max, terrainRank[t]), 0);
  const requiredRank = terrainRank[requiredTerrain];
  if (requiredRank <= highestAllowed && simpleOk) return { level: 'full' };

  // Compute percentage distance that exceeds machine capability (terrain-wise)
  const distByCat = trackAnalysis.slopeDistribution; // assumed in meters
  const overDistance = Object.entries(distByCat).reduce((acc, [cat, dist]) => {
    const terr = slopeCategoryToTerrain[cat];
    if (!terr) return acc;
    const r = terrainRank[terr];
    return r > highestAllowed ? acc + (dist as number) : acc;
  }, 0);
  const total = trackAnalysis.totalDistance || 0;
  const overPercent = total > 0 ? overDistance / total : 0;

  if (overPercent === 0 && simpleOk) return { level: 'full' };
  // Allow partial if within threshold and vegetation permitted overall (otherwise reject)
  const PARTIAL_THRESHOLD = 0.15; // 15% of distance
  if (overPercent > 0 && overPercent <= PARTIAL_THRESHOLD && machine.allowedVegetation.includes(vegetation)) {
    return {
      level: 'partial',
      overLimitPercent: overPercent,
      note: `~${Math.round(overPercent * 100)}% of route exceeds rated terrain; applying time penalty.`
    };
  }
  return { level: 'incompatible', overLimitPercent: overPercent, note: overPercent > 0 ? 'Too much challenging terrain' : 'Terrain/vegetation not permitted' };
}

/**
 * Check if machinery is compatible with the slope requirements
 */
const isSlopeCompatible = (
  machinery: MachinerySpec,
  maxSlope: number
): { compatible: boolean; maxSlopeExceeded?: number } => {
  if (machinery.maxSlope == null) return { compatible: true };
  const compatible = maxSlope <= machinery.maxSlope;
  return { compatible, maxSlopeExceeded: compatible ? undefined : maxSlope };
};

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  distance,
  trackAnalysis,
  vegetationAnalysis,
  isAnalyzing = false,
  machinery,
  aircraft,
  handCrews,
  onDropPreviewChange,
  onExpandedChange,
  selectedAircraftForPreview: externalSelected = []
  ,
  mapSettled = false
}: AnalysisPanelProps) => {
  // Vegetation state: allow manual override of auto-detected vegetation
  const [selectedVegetation, setSelectedVegetation] = useState<VegetationType>('grassland');
  const [useAutoDetected, setUseAutoDetected] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true); // default expanded
  const [selectedAircraftForPreview, setSelectedAircraftForPreview] = useState<string[]>(externalSelected);

  // Backend analysis state (always use backend)
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [backendResults, setBackendResults] = useState<BackendCalculationResult[] | null>(null);
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);

  // Quick option selections
  const [selectedQuickMachinery, setSelectedQuickMachinery] = useState<string | null>(null);
  const [selectedQuickAircraft, setSelectedQuickAircraft] = useState<string | null>(null);
  const [selectedQuickHandCrew, setSelectedQuickHandCrew] = useState<string | null>(null);

  // Test backend availability on mount
  // Test backend availability, but delay the test until the map has settled.
  // Running the test call (which hits the backend analysis endpoint) before the
  // map has finished its initial pan/zoom causes unnecessary load and noisy logs.
  useEffect(() => {
    if (!mapSettled) {
      // Clear any previous state while waiting for the map to settle
      setBackendAvailable(null);
      return;
    }

    const checkBackend = async () => {
      const available = await testBackendAnalysis();
      setBackendAvailable(available);
    };
    checkBackend();
  }, [mapSettled]);
  
  // Determine effective vegetation: auto-detected or manually selected
  const effectiveVegetation = useMemo(() => {
    if (useAutoDetected && vegetationAnalysis) {
      const detectedVeg = vegetationAnalysis.predominantVegetation;
      // Defensive check: ensure detected vegetation is valid
      const validVegTypes: readonly string[] = VEGETATION_TYPES;
      if (!validVegTypes.includes(detectedVeg)) {
        console.warn(`⚠️ Invalid predominant vegetation detected: "${detectedVeg}", falling back to mediumscrub`);
        return 'mediumscrub';
      }
      // Check if vegetation distribution is empty (all zeros)
      const totalVegDistance = Object.values(vegetationAnalysis.vegetationDistribution).reduce((sum, val) => sum + val, 0);
      if (totalVegDistance === 0) {
        console.warn('⚠️ Vegetation distribution is empty (all zeros), using fallback mediumscrub for safer balance');
        return 'mediumscrub';
      }
      return detectedVeg;
    }
    return selectedVegetation;
  }, [useAutoDetected, vegetationAnalysis, selectedVegetation]);

  // Backend analysis effect (always run)
  useEffect(() => {
    // Delay heavy backend analysis until the map has settled (i.e. initial
    // pan/zoom to user location completed). This prevents early logs/calls
    // and gives the map time to show the user's location seamlessly.
    if (!distance || !trackAnalysis || !vegetationAnalysis || !backendAvailable || !mapSettled) {
      // Log why backend analysis is not running for debugging
      if (distance && trackAnalysis && vegetationAnalysis) {
        console.log('⏸️ Backend analysis blocked:', {
          distance: !!distance,
          trackAnalysis: !!trackAnalysis,
          vegetationAnalysis: !!vegetationAnalysis,
          backendAvailable,
          mapSettled
        });
      }
      setBackendResults(null);
      return;
    }

    const runBackendAnalysis = async () => {
      setBackendLoading(true);
      setBackendError(null);
      console.log('🔄 Running backend analysis...', {
        distance,
        maxSlope: trackAnalysis.maxSlope,
        vegetation: effectiveVegetation
      });
      
      try {
        const response = await calculateEquipmentAnalysis({
          distance,
          trackAnalysis,
          vegetationAnalysis: {
            ...vegetationAnalysis,
            predominantVegetation: effectiveVegetation
          }
        });
        
        // If backend returns empty calculations, log a warning and fall back to frontend
        if (!response.calculations || response.calculations.length === 0) {
          console.warn('⚠️ Backend returned no calculations, falling back to frontend calculations');
          setBackendResults(null);
          setBackendError('Backend returned no equipment data');
        } else {
          setBackendResults(response.calculations);
          console.log('✅ Backend analysis completed', {
            calculationsCount: response.calculations.length,
            compatibleCount: response.calculations.filter(c => c.compatible).length
          });
        }
      } catch (error) {
        console.error('❌ Backend analysis failed', error);
        setBackendError(error instanceof Error ? error.message : 'Backend analysis failed');
        setBackendResults(null);
      } finally {
        setBackendLoading(false);
      }
    };

    runBackendAnalysis();
  }, [distance, trackAnalysis, vegetationAnalysis, effectiveVegetation, backendAvailable, mapSettled]);

  // Handle drop preview selection changes
  const handleDropPreviewChange = (aircraftId: string, enabled: boolean) => {
    const updatedSelection = enabled
      ? Array.from(new Set([...selectedAircraftForPreview, aircraftId]))
      : selectedAircraftForPreview.filter((id: string) => id !== aircraftId);
    setSelectedAircraftForPreview(updatedSelection);
    onDropPreviewChange?.(updatedSelection);
  };

  // Terrain and vegetation factors
  const terrainFactors = {
    flat: 1.0,
    medium: 1.3,
    steep: 1.7,
    very_steep: 2.2
  };
  // Vegetation taxonomy factors (lower easier)
  const vegetationFactors: Record<VegetationType, number> = {
    grassland: 1.0,
    lightshrub: 1.1,
    mediumscrub: 1.5,
    heavyforest: 2.0
  };

  // Derive effective terrain requirement from max slope
  const derivedTerrainRequirement = useMemo<TerrainLevel | null>(() => {
    if (!trackAnalysis) return null;
    return deriveTerrainFromSlope(trackAnalysis.maxSlope);
  }, [trackAnalysis]);

  const calculations = useMemo<CalculationResult[]>(() => {
    // Do not perform calculations or emit logs until the map has settled to the
    // user's location. This prevents analysis from starting while the map is
    // still panning/zooming on initial load and keeps console noise low.
    if (!mapSettled) {
      console.log('⏸️ Frontend calculations blocked: map not settled yet');
      return [];
    }

    console.log('🔧 Starting frontend equipment calculations', {
      distance,
      derivedTerrainRequirement,
      effectiveVegetation,
      trackAnalysis: trackAnalysis ? { maxSlope: trackAnalysis.maxSlope, slopeDistribution: trackAnalysis.slopeDistribution } : null,
      vegetationAnalysis: vegetationAnalysis ? { 
        predominantVegetation: vegetationAnalysis.predominantVegetation,
        vegetationDistribution: vegetationAnalysis.vegetationDistribution,
        totalDistance: vegetationAnalysis.totalDistance
      } : null,
      machineryCount: machinery.length,
      aircraftCount: aircraft.length,
      handCrewsCount: handCrews.length,
      equipmentDetails: {
        machinery: machinery.map(m => ({ id: m.id, name: m.name, clearingRate: m.clearingRate })),
        aircraft: aircraft.map(a => ({ id: a.id, name: a.name, dropLength: a.dropLength })),
        handCrews: handCrews.map(h => ({ id: h.id, name: h.name, crewSize: h.crewSize }))
      }
    });

    if (!distance) {
      console.log('❌ No distance provided, returning empty calculations');
      return [];
    }
    
    // Warn if no equipment is available
    if (machinery.length === 0 && aircraft.length === 0 && handCrews.length === 0) {
      console.warn('⚠️ No equipment available for calculations. Check equipment loading.');
      return [];
    }

    const results: CalculationResult[] = [];
    const effectiveTerrain = derivedTerrainRequirement || 'flat';
    const terrainFactor = terrainFactors[effectiveTerrain];
    const vegetationFactor = vegetationFactors[effectiveVegetation];
    const requiredTerrain = effectiveTerrain;

    console.log('📊 Analysis parameters:', {
      effectiveTerrain,
      terrainFactor,
      vegetationFactor,
      requiredTerrain
    });

    // Machinery with partial compatibility support
    console.log('🚜 Evaluating machinery equipment:');
    machinery.forEach((machine: MachinerySpec, index: number) => {
      console.log(`🚜 [${index + 1}/${machinery.length}] Evaluating machinery: ${machine.name}`, {
        id: machine.id,
        allowedTerrain: machine.allowedTerrain,
        allowedVegetation: machine.allowedVegetation,
        clearingRate: machine.clearingRate,
        maxSlope: machine.maxSlope
      });

      const terrainEval = evaluateMachineryTerrainCompatibility(machine, trackAnalysis, effectiveVegetation, requiredTerrain);
      console.log(`   ⚙️ Terrain evaluation result:`, terrainEval);

      const slopeCheck = trackAnalysis ? isSlopeCompatible(machine, trackAnalysis.maxSlope) : { compatible: true };
      console.log(`   📐 Slope compatibility:`, slopeCheck, trackAnalysis ? `(max slope: ${trackAnalysis.maxSlope}°)` : '(no track analysis)');

      const fullyEnvOk = terrainEval.level === 'full' && slopeCheck.compatible;
      const partiallyOk = terrainEval.level === 'partial' && slopeCheck.compatible;
      const compatible = fullyEnvOk || partiallyOk; // treat partial as compatible for selection purposes

      console.log(`   ✅ Final compatibility:`, {
        fullyEnvOk,
        partiallyOk,
        compatible,
        compatibilityLevel: terrainEval.level === 'incompatible' || !slopeCheck.compatible ? 'incompatible' : terrainEval.level
      });

      let time = 0;
      if (compatible) {
        time = calculateMachineryTime(distance, machine, terrainFactor, vegetationFactor);
        console.log(`   ⏱️ Initial time calculation: ${time} hours`);
        
        // Apply time penalty for partial compatibility proportional to over-limit percent (scaled *2)
        if (terrainEval.level === 'partial' && terrainEval.overLimitPercent) {
          const penaltyMultiplier = 1 + terrainEval.overLimitPercent * 2; // e.g. 10% over → +20% time
          time *= penaltyMultiplier;
          console.log(`   ⏱️ Applied partial compatibility penalty: ${penaltyMultiplier}x → ${time} hours`);
        }
      } else {
        console.log(`   ❌ Machine incompatible, skipping time calculation`);
      }
      const costVal = compatible && (machine as any).costPerHour ? time * (machine as any).costPerHour : 0;

      const result = {
        id: machine.id,
        name: machine.name,
        type: 'machinery' as const,
        time,
        cost: costVal,
        compatible,
        compatibilityLevel: terrainEval.level === 'incompatible' || !slopeCheck.compatible ? 'incompatible' as const : terrainEval.level,
        slopeCompatible: slopeCheck.compatible,
        maxSlopeExceeded: slopeCheck.maxSlopeExceeded,
        unit: 'hours',
        description: machine.description,
        overLimitPercent: terrainEval.overLimitPercent,
        note: !slopeCheck.compatible
          ? 'Slope exceeds capability'
          : terrainEval.note
      };

      console.log(`   📋 Final result:`, result);
      results.push(result);
    });

    // Aircraft (strict membership – no partial logic currently required)
    console.log('✈️ Evaluating aircraft equipment:');
    aircraft.forEach((plane: AircraftSpec, index: number) => {
      console.log(`✈️ [${index + 1}/${aircraft.length}] Evaluating aircraft: ${plane.name}`, {
        id: plane.id,
        allowedTerrain: plane.allowedTerrain,
        allowedVegetation: plane.allowedVegetation,
        dropLength: plane.dropLength,
        turnaroundMinutes: plane.turnaroundMinutes
      });

      // Fix compatibility check for aircraft turnaround minutes property
      const compatible = baseEnvironmentCompatible(plane, requiredTerrain, effectiveVegetation);
      console.log(`   ✅ Base environment compatibility:`, compatible);

      const drops = compatible ? calculateAircraftDrops(distance, plane) : 0;
      const totalTime = compatible ? drops * ((plane.turnaroundMinutes || 0) / 60) : 0; // convert minutes to hours
      const costVal = compatible && (plane as any).costPerHour ? totalTime * (plane as any).costPerHour : 0;

      console.log(`   📊 Aircraft calculations:`, {
        drops,
        totalTime,
        costVal
      });

      const result = {
        id: plane.id,
        name: plane.name,
        type: 'aircraft' as const,
        time: totalTime,
        cost: costVal,
        compatible,
        compatibilityLevel: compatible ? 'full' as const : 'incompatible' as const,
        unit: 'hours',
        description: plane.description,
        drops
      };

      console.log(`   📋 Final result:`, result);
      results.push(result);
    });

    // Hand Crews (strict membership – no partial logic currently required)
    console.log('👨‍🚒 Evaluating hand crew equipment:');
    handCrews.forEach((crew: HandCrewSpec, index: number) => {
      console.log(`👨‍🚒 [${index + 1}/${handCrews.length}] Evaluating hand crew: ${crew.name}`, {
        id: crew.id,
        allowedTerrain: crew.allowedTerrain,
        allowedVegetation: crew.allowedVegetation,
        crewSize: crew.crewSize,
        clearingRatePerPerson: crew.clearingRatePerPerson
      });

      const compatible = baseEnvironmentCompatible(crew, requiredTerrain, effectiveVegetation);
      console.log(`   ✅ Base environment compatibility:`, compatible);

      const time = compatible ? calculateHandCrewTime(distance, crew, terrainFactor, vegetationFactor) : 0;
      const costVal = compatible && (crew as any).costPerHour ? time * (crew as any).costPerHour : 0;

      console.log(`   📊 Hand crew calculations:`, {
        time,
        costVal
      });

      const result = {
        id: crew.id,
        name: crew.name,
        type: 'handCrew' as const,
        time,
        cost: costVal,
        compatible,
        compatibilityLevel: compatible ? 'full' as const : 'incompatible' as const,
        unit: 'hours',
        description: crew.description
      };

      console.log(`   📋 Final result:`, result);
      results.push(result);
    });

    // Sort: full compatible first, then partial, then incompatible; within each by time then cost
    const sortedResults = results.sort((a, b) => {
      const rank = (r?: CalculationResult) => {
        if (!r || !r.compatibilityLevel) return 3;
        if (r.compatibilityLevel === 'full') return 0;
        if (r.compatibilityLevel === 'partial') return 1;
        return 2; // incompatible
      };
      const ar = rank(a);
      const br = rank(b);
      if (ar !== br) return ar - br;
      if (ar === 2) return 0; // both incompatible – keep input order
      if (Math.abs(a.time - b.time) < 0.1) return a.cost - b.cost;
      return a.time - b.time;
    });

    console.log('📈 Final sorted results:', {
      totalResults: sortedResults.length,
      compatibleResults: sortedResults.filter(r => r.compatible).length,
      resultsByType: {
        machinery: sortedResults.filter(r => r.type === 'machinery').length,
        aircraft: sortedResults.filter(r => r.type === 'aircraft').length,
        handCrew: sortedResults.filter(r => r.type === 'handCrew').length
      },
      topCompatibleResults: sortedResults.filter(r => r.compatible).slice(0, 3).map(r => ({
        name: r.name,
        type: r.type,
        compatible: r.compatible,
        time: r.time,
        compatibilityLevel: r.compatibilityLevel
      }))
    });

    return sortedResults;
  }, [distance, trackAnalysis, effectiveVegetation, machinery, aircraft, handCrews, derivedTerrainRequirement]);

  // Always use backend results, fallback to frontend calculations only if backend unavailable
  // Type guard for compatibilityLevel
  function isCompatibilityLevel(value: any): value is 'full' | 'partial' | 'incompatible' {
    return value === 'full' || value === 'partial' || value === 'incompatible';
  }
  const finalCalculations = backendResults ? backendResults.map(r => ({
    ...r,
    compatibilityLevel: isCompatibilityLevel(r.compatibilityLevel) ? r.compatibilityLevel : 'incompatible'
  })) : calculations;

  // Get best option for each category
  const bestOptions = useMemo(() => {
    const compatibleResults = finalCalculations.filter((result: any) => result.compatible);
    
    return {
      machinery: compatibleResults.find(result => result.type === 'machinery' || result.type === 'Machinery'),
      aircraft: compatibleResults.find(result => result.type === 'aircraft' || result.type === 'Aircraft'),
      handCrew: compatibleResults.find(result => result.type === 'handCrew' || result.type === 'HandCrew')
    };
  }, [finalCalculations]);

  // Initialize / reconcile selected quick options when calculations change
  useMemo(() => {
    if (finalCalculations.length === 0) return null;
  const machList = finalCalculations.filter((c: any) => (c.type === 'machinery' || c.type === 'Machinery') && c.compatible);
  const airList = finalCalculations.filter((c: any) => (c.type === 'aircraft' || c.type === 'Aircraft') && c.compatible);
  const handList = finalCalculations.filter((c: any) => (c.type === 'handCrew' || c.type === 'HandCrew') && c.compatible);
    if ((!selectedQuickMachinery || !machList.some(m => m.id === selectedQuickMachinery)) && machList.length) {
      setSelectedQuickMachinery(machList[0].id);
    }
    if ((!selectedQuickAircraft || !airList.some(a => a.id === selectedQuickAircraft)) && airList.length) {
      setSelectedQuickAircraft(airList[0].id);
    }
    if ((!selectedQuickHandCrew || !handList.some(h => h.id === selectedQuickHandCrew)) && handList.length) {
      setSelectedQuickHandCrew(handList[0].id);
    }
    return null;
  }, [finalCalculations, selectedQuickMachinery, selectedQuickAircraft, selectedQuickHandCrew]);

  const quickMachinery = selectedQuickMachinery ? finalCalculations.find(c => c.id === selectedQuickMachinery) : undefined;
  const quickAircraft = selectedQuickAircraft ? finalCalculations.find(c => c.id === selectedQuickAircraft) : undefined;
  const quickHandCrew = selectedQuickHandCrew ? finalCalculations.find(c => c.id === selectedQuickHandCrew) : undefined;

  return (
    <div className="analysis-panel-permanent">
  <div className="analysis-header">
        <h3>Fire Break Analysis</h3>
        <div className="header-info">
          {isAnalyzing && (
            <div className="analysis-spinner">
              <div className="spinner"></div>
              <span>Analyzing terrain...</span>
            </div>
          )}
          {!isAnalyzing && distance && <span className="distance-display">{distance.toLocaleString(undefined, { maximumFractionDigits: 0 })}m</span>}
          {!isAnalyzing && trackAnalysis && <span className="slope-display">Max Slope: {Math.round(trackAnalysis.maxSlope)}°</span>}
          
          {/* Backend Analysis Status */}
          {backendAvailable !== null && (
            <div className="backend-status">
              <span>Backend Analysis</span>
              {backendLoading && <span className="loading-indicator">⏳</span>}
              {backendError && <span className="error-indicator" title={backendError}>❌</span>}
              {!backendAvailable && <span className="disabled-indicator" title="Backend service unavailable">⚠️</span>}
            </div>
          )}
        </div>
        <button
          className="expand-button"
          aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
          aria-controls="analysis-content"
          aria-expanded={isExpanded}
          onClick={() => {
            const newExpanded = !isExpanded;
            setIsExpanded(newExpanded);
            onExpandedChange?.(newExpanded);
          }}
        >
          {isExpanded ? '▼' : '▲'}
        </button>
      </div>
      <div className="analysis-content" id="analysis-content">
        {distance && (
          <div className="conditions-section">
            {vegetationAnalysis ? (
              <div className="conditions-group">
                <label htmlFor="vegetation-toggle">Vegetation Type</label>
                <div className="auto-detected-vegetation">
                  <div className="auto-detected-header">
                    <span className="auto-detected-label">Auto-detected: <strong>{vegetationAnalysis.predominantVegetation}</strong></span>
                    <span className="confidence-badge">{Math.round(vegetationAnalysis.overallConfidence * 100)}% confidence</span>
                  </div>
                  <div className="vegetation-toggle">
                    <label>
                      <input type="checkbox" checked={useAutoDetected} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUseAutoDetected(e.target.checked)} />
                      Use auto-detected vegetation
                    </label>
                  </div>
                  <div className="vegetation-breakdown">
                    <div className="vegetation-breakdown-title">Distribution</div>
                    <DistributionBar
                      categories={VEGETATION_CATEGORIES}
                      data={vegetationAnalysis.vegetationDistribution as any}
                      total={vegetationAnalysis.totalDistance}
                      ariaLabel="Vegetation distribution"
                      compact={true}
                      showLabels={false}
                    />
                    <FormationSummary vegetationAnalysis={vegetationAnalysis} />
                    {/* Subtle data credit moved here from map overlay */}
                    <div className="vegetation-credit">Data: NSW Department of Climate Change, Energy, the Environment and Water</div>
                  </div>
                </div>
                {!useAutoDetected && (
                  <select
                    aria-label="Select vegetation type"
                    id="vegetation-select"
                    value={selectedVegetation}
                    onChange={e => setSelectedVegetation(e.target.value as VegetationType)}
                    disabled={useAutoDetected}
                  >
                    {VEGETATION_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                )}
                <div className="effective-vegetation">Using: <strong>{effectiveVegetation}</strong></div>
              </div>
            ) : (
              <div className="conditions-group">
                <div className="vegetation-loading">{isAnalyzing ? 'Analyzing vegetation…' : 'Vegetation analysis pending…'}</div>
              </div>
            )}
          </div>
        )}
        {trackAnalysis && (
          <div className="slope-analysis-section">
            <h4>Slope Analysis</h4>
            <div className="slope-summary">
              <div className="slope-stats">
                <span>Max: {Math.round(trackAnalysis.maxSlope)}°</span>
                <span>Avg: {Math.round(trackAnalysis.averageSlope)}°</span>
                <span>Segments: {trackAnalysis.segments.length}</span>
              </div>
              {isExpanded && (
                <div className="slope-distribution">
                  <DistributionBar
                    categories={SLOPE_CATEGORIES}
                    data={trackAnalysis.slopeDistribution as any}
                    total={trackAnalysis.totalDistance}
                    ariaLabel="Slope distribution"
                  />
                </div>
              )}
            </div>
            {isExpanded && vegetationAnalysis && (
              <div className="overlap-section">
                <h5 className="overlap-title">Slope × Vegetation Overlap</h5>
                <OverlapMatrix trackAnalysis={trackAnalysis} vegetationAnalysis={vegetationAnalysis} />
                <div className="overlap-aux">
                  <div className="overlap-legend">
                    <div className="legend-title">Vegetation legend</div>
                    <div className="legend-items">
                      <div className="dist-legend-item"><span className="dist-swatch" data-color="#00aa00"></span><span className="dist-legend-label">Grass</span></div>
                      <div className="dist-legend-item"><span className="dist-swatch" data-color="#c8c800"></span><span className="dist-legend-label">Light</span></div>
                      <div className="dist-legend-item"><span className="dist-swatch" data-color="#ff8800"></span><span className="dist-legend-label">Medium</span></div>
                      <div className="dist-legend-item"><span className="dist-swatch" data-color="#006400"></span><span className="dist-legend-label">Heavy</span></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {!distance ? (
          <HelpContent />
        ) : (
          <>
            {/* Diagnostic message when no calculations are available */}
            {finalCalculations.length === 0 && (() => {
              // Extract diagnostic conditions for better readability
              const isMapInitializing = !mapSettled;
              const isBackendUnavailable = mapSettled && backendAvailable === false; // explicitly false, not null (initializing)
              const isBackendLoading = mapSettled && backendAvailable && backendLoading;
              const hasBackendError = mapSettled && backendAvailable && !backendLoading && backendError;
              const hasNoEquipment = mapSettled && backendAvailable && !backendLoading && !backendError && 
                                     (machinery.length === 0 && aircraft.length === 0 && handCrews.length === 0);
              const isWaitingForData = mapSettled && backendAvailable && !backendLoading && !backendError && 
                                       (machinery.length > 0 || aircraft.length > 0 || handCrews.length > 0);
              
              // Don't show warning during normal map initialization - this is expected behavior
              if (isMapInitializing) {
                return null;
              }
              
              return (
                <div className="diagnostic-message" style={{ 
                  padding: '1rem', 
                  margin: '1rem 0', 
                  backgroundColor: '#fff3cd', 
                  border: '1px solid #ffc107', 
                  borderRadius: '4px',
                  color: '#856404'
                }}>
                  <strong>⚠️ No Equipment Data Available</strong>
                  <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>
                    {isBackendUnavailable && 'Backend service unavailable. Check console for details.'}
                    {isBackendLoading && 'Loading equipment analysis...'}
                    {hasBackendError && `Error: ${backendError}`}
                    {hasNoEquipment && 'No equipment configured. Please add equipment in the Configuration panel.'}
                    {isWaitingForData && 'Equipment loaded, waiting for analysis results...'}
                    {!isBackendUnavailable && !isBackendLoading && !hasBackendError && !hasNoEquipment && !isWaitingForData && 
                      'No calculations available. Please check your configuration.'}
                  </p>
                </div>
              );
            })()}
            <div className="best-options-summary">
              <h4>Quick Options</h4>
              <div className="best-options-grid">
                <div className="option-category">
                  <div className="category-header"><span className="category-icon">🛠️</span><span className="category-label">Machinery</span></div>
                  {finalCalculations.filter(c => (c.type === 'machinery' || c.type === 'Machinery') && c.compatible).length > 0 ? (
                    <div className="option-details">
                      <select
                        className="quick-select"
                        value={selectedQuickMachinery || ''}
                        onChange={(e) => setSelectedQuickMachinery(e.target.value)}
                        aria-label="Select machinery option"
                      >
                        {finalCalculations.filter(c => (c.type === 'machinery' || c.type === 'Machinery') && c.compatible).map((result: any) => (
                          <option key={result.id} value={result.id}>{result.name}</option>
                        ))}
                      </select>
                      {quickMachinery && <span className="option-time">{quickMachinery.time.toFixed(0)} {quickMachinery.unit}</span>}
                    </div>
                  ) : <span className="no-option">No compatible options</span>}
                </div>
                <div className="option-category">
                  <div className="category-header"><span className="category-icon">✈️</span><span className="category-label">Aircraft</span></div>
                  {finalCalculations.filter(c => (c.type === 'aircraft' || c.type === 'Aircraft') && c.compatible).length > 0 ? (
                    <div className="option-details">
                      <div className="aircraft-selection-row">
                        <select
                          className="quick-select"
                          value={selectedQuickAircraft || ''}
                          onChange={(e) => setSelectedQuickAircraft(e.target.value)}
                          aria-label="Select aircraft option"
                        >
                          {finalCalculations.filter(c => (c.type === 'aircraft' || c.type === 'Aircraft') && c.compatible).map((result: any) => (
                            <option key={result.id} value={result.id}>{result.name}</option>
                          ))}
                        </select>
                        {quickAircraft && (
                          <button
                            type="button"
                            className={`drop-toggle-button ${selectedAircraftForPreview.includes(quickAircraft.id) ? 'active' : ''}`}
                            aria-label={selectedAircraftForPreview.includes(quickAircraft.id) ? 'Drop preview on' : 'Drop preview off'}
                            title="Toggle drop preview"
                            onClick={() => handleDropPreviewChange(quickAircraft.id, !selectedAircraftForPreview.includes(quickAircraft.id))}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" fill="currentColor" /></svg>
                          </button>
                        )}
                      </div>
                      {quickAircraft && <span className="option-time">{quickAircraft.time.toFixed(0)} {quickAircraft.unit}{quickAircraft.drops && <span className="drops-info"> ({quickAircraft.drops} drops)</span>}</span>}
                    </div>
                  ) : <span className="no-option">No compatible options</span>}
                </div>
                <div className="option-category">
                  <div className="category-header"><span className="category-icon">👨‍🚒</span><span className="category-label">Hand Crew</span></div>
                  {finalCalculations.filter(c => (c.type === 'handCrew' || c.type === 'HandCrew') && c.compatible).length > 0 ? (
                    <div className="option-details">
                      <select
                        className="quick-select"
                        value={selectedQuickHandCrew || ''}
                        onChange={(e) => setSelectedQuickHandCrew(e.target.value)}
                        aria-label="Select hand crew option"
                      >
                        {finalCalculations.filter(c => (c.type === 'handCrew' || c.type === 'HandCrew') && c.compatible).map((result: any) => (
                          <option key={result.id} value={result.id}>{result.name}</option>
                        ))}
                      </select>
                      {quickHandCrew && <span className="option-time">{quickHandCrew.time.toFixed(0)} {quickHandCrew.unit}</span>}
                    </div>
                  ) : <span className="no-option">No compatible options</span>}
                </div>
              </div>
            </div>
            {isExpanded && (
              <div className="equipment-summary">
                <h4>All Equipment Options</h4>
                <div className="equipment-categories">
                  <div className="equipment-category-section">
                    <h5 className="category-section-header"><span className="category-section-icon">🛠️</span>Machinery</h5>
                    <div className="equipment-table">
                      <div className="table-header"><span>Equipment</span><span>Time</span><span>Cost</span><span>Status</span></div>
                      {finalCalculations.filter(r => (r.type === 'machinery' || r.type === 'Machinery')).map((result: any) => (
                        <div key={result.id} className={`table-row ${!result.compatible ? 'incompatible' : ''} ${result.compatibilityLevel === 'partial' ? 'partial' : ''}`} title={result.note || ''}>
                          <div className="equipment-info">
                            <span className="equipment-icon">{getEquipmentIcon(result)}</span>
                            <div className="equipment-details">
                              <span className="equipment-name">{result.name}</span>
                              <span className="equipment-type">{result.compatibilityLevel === 'partial' ? 'Partial' : result.type}</span>
                            </div>
                          </div>
                          <div className="time-info">{result.compatible ? (<><span className="time-value">{result.time.toFixed(0)}</span><span className="time-unit">{result.unit}</span></>) : (<span className="incompatible-text">N/A</span>)}</div>
                          <div className="cost-info">{result.compatible && result.cost > 0 ? <span className="cost-value">${result.cost.toFixed(0)}</span> : <span className="no-cost">-</span>}</div>
                          <div className="status-info">{result.compatibilityLevel === 'full' && result.compatible && <span className="compatible">✓ Compatible</span>}{result.compatibilityLevel === 'partial' && <span className="partial-status">△ Partial</span>}{result.compatibilityLevel === 'incompatible' && <span className="incompatible-status">✗ Incompatible</span>}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="equipment-category-section">
                    <h5 className="category-section-header"><span className="category-section-icon">✈️</span>Aircraft</h5>
                    <div className="equipment-table">
                      <div className="table-header"><span>Equipment</span><span>Time</span><span>Cost</span><span>Status</span></div>
                      {finalCalculations.filter(r => (r.type === 'aircraft' || r.type === 'Aircraft')).map((result: any) => (
                        <div key={result.id} className={`table-row ${!result.compatible ? 'incompatible' : ''} ${result.compatibilityLevel === 'partial' ? 'partial' : ''}`} title={result.note || ''}>
                          <div className="equipment-info">
                            <span className="equipment-icon">{getEquipmentIcon(result)}</span>
                            <div className="equipment-details">
                              <span className="equipment-name">{result.name}</span>
                              <span className="equipment-type">{result.drops ? `${result.drops} drops` : result.type}</span>
                            </div>
                          </div>
                          <div className="time-info">{result.compatible ? (<><span className="time-value">{result.time.toFixed(0)}</span><span className="time-unit">{result.unit}</span></>) : (<span className="incompatible-text">N/A</span>)}</div>
                          <div className="cost-info">{result.compatible && result.cost > 0 ? <span className="cost-value">${result.cost.toFixed(0)}</span> : <span className="no-cost">-</span>}</div>
                          <div className="status-info">{result.compatibilityLevel === 'full' && result.compatible && <span className="compatible">✓ Compatible</span>}{result.compatibilityLevel === 'partial' && <span className="partial-status">△ Partial</span>}{result.compatibilityLevel === 'incompatible' && <span className="incompatible-status">✗ Incompatible</span>}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="equipment-category-section">
                    <h5 className="category-section-header"><span className="category-section-icon">👨‍🚒</span>Hand Crew</h5>
                    <div className="equipment-table">
                      <div className="table-header"><span>Equipment</span><span>Time</span><span>Cost</span><span>Status</span></div>
                      {finalCalculations.filter(r => (r.type === 'handCrew' || r.type === 'HandCrew')).map((result: any) => (
                        <div key={result.id} className={`table-row ${!result.compatible ? 'incompatible' : ''} ${result.compatibilityLevel === 'partial' ? 'partial' : ''}`} title={result.note || ''}>
                          <div className="equipment-info">
                            <span className="equipment-icon">{getEquipmentIcon(result)}</span>
                            <div className="equipment-details">
                              <span className="equipment-name">{result.name}</span>
                              <span className="equipment-type">{result.type}</span>
                            </div>
                          </div>
                          <div className="time-info">{result.compatible ? (<><span className="time-value">{result.time.toFixed(0)}</span><span className="time-unit">{result.unit}</span></>) : (<span className="incompatible-text">N/A</span>)}</div>
                          <div className="cost-info">{result.compatible && result.cost > 0 ? <span className="cost-value">${result.cost.toFixed(0)}</span> : <span className="no-cost">-</span>}</div>
                          <div className="status-info">{result.compatibilityLevel === 'full' && result.compatible && <span className="compatible">✓ Compatible</span>}{result.compatibilityLevel === 'partial' && <span className="partial-status">△ Partial</span>}{result.compatibilityLevel === 'incompatible' && <span className="incompatible-status">✗ Incompatible</span>}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* Buy Me a Coffee button - injected script will render the button into the DOM */}
      <BuyMeACoffee />
    </div>
  );
};

/** Formation summary: subtle sorted list with small bar graphic (largest → smallest) and supporting examples */
const FormationSummary: React.FC<{ vegetationAnalysis: VegetationAnalysis }> = ({ vegetationAnalysis }) => {
  // Aggregate distances by displayLabel (preferred formation)
  const counts: Record<string, number> = {};
  const supporting: Set<string> = new Set();
  let total = 0;
  for (const seg of vegetationAnalysis.segments) {
    const label = (seg.displayLabel || seg.landcoverClass || 'Unknown').toString();
    const dist = seg.distance || 0;
    counts[label] = (counts[label] || 0) + dist;
    total += dist;
    if (seg.nswVegClass) supporting.add(seg.nswVegClass);
    if (seg.nswPCTName) supporting.add(seg.nswPCTName);
    if (seg.landcoverClass) supporting.add(seg.landcoverClass);
  }

  // Convert to sorted array largest → smallest
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  // Subtle colors for bars
  const barBg = '#e9eef0';
  const barColor = '#6aa84f';

  return (
    <div className="formation-summary">
      <div className="formation-title">Formation distribution</div>
      <div role="list" aria-label="Formation distribution" className="formation-list">
        {entries.length === 0 && <div className="formation-note">No formation data available</div>}
        {entries.map(([label, dist], i) => {
          const pct = total > 0 ? Math.round((dist / total) * 100) : 0;
          return (
            <div key={i} role="listitem" className="formation-row">
              <div className="formation-swatch" aria-hidden />
              <div className="formation-label">{label}</div>
              <div className="formation-bar">
                <div className="formation-bar-fill" style={{ width: `${Math.max(0, Math.min(100, Math.round(pct)))}%` }} aria-hidden />
              </div>
              <div className="formation-pct">{pct}%</div>
            </div>
          );
        })}
      </div>

      {supporting.size > 0 && (
        <div className="formation-supporting">
          <div className="formation-supporting-title">Supporting examples</div>
          <div>
            {Array.from(supporting).slice(0, 6).map((s, i) => (
              <span key={i} className="example">{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Buy Me a Coffee button loader.
 * This injects the remote script with the desired data attributes once when the component mounts.
 */
const BuyMeACoffee: React.FC = () => {
  useEffect(() => {
    // Avoid injecting multiple times
    const existing = document.querySelector('script[src="https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js"]');
    if (existing) return;

    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.src = 'https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js';
    s.async = true;
    // data attributes from user
    s.setAttribute('data-name', 'bmc-button');
    s.setAttribute('data-slug', 'richardbt');
    s.setAttribute('data-color', '#FF5F5F');
    s.setAttribute('data-emoji', '');
    s.setAttribute('data-font', 'Inter');
    s.setAttribute('data-text', 'Love it? buy me a coffee');
    s.setAttribute('data-outline-color', '#000000');
    s.setAttribute('data-font-color', '#ffffff');
    s.setAttribute('data-coffee-color', '#FFDD00');

    // Append the script inside the placeholder so the BuyMeACoffee widget renders there
    const placeholder = document.getElementById('bmc-button-placeholder');
    if (placeholder) {
      placeholder.appendChild(s);
    } else {
      document.body.appendChild(s);
    }

    return () => {
      // keep cleanup minimal: remove the script if it was added
      if (s.parentNode) s.parentNode.removeChild(s);
    };
  }, []);

  // The script will render a button where it finds the script tag or by its internal placement.
  // Provide a small container at the bottom of the panel for the button to appear near.
  // Also render a visible fallback anchor so users always see a way to support the project if the script fails.
  return (
    <div className="bottom-buttons-container">
      <div className="buttons-row">
        <div id="bmc-button-placeholder">
          <a
            className="bmc-fallback"
            href="https://www.buymeacoffee.com/richardbt"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Buy me a coffee"
          >
            Love it? buy me a coffee
          </a>
        </div>
        <a
          className="feature-suggestion-button"
          href="https://github.com/richardthorek/fireBreakCalculator/issues/new?template=feature_request.md&title=Feature%20Request%3A%20&labels=enhancement"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Suggest a feature or contact developer"
        >
          💡 Suggest Feature
        </a>
      </div>
      {/* Flaticon attribution for icons used in the UI */}
      <div className="flaticon-credit">
        <a href="https://www.flaticon.com/free-icons/bull-dozer" title="bull dozer icons" target="_blank" rel="noopener noreferrer">
          Bull dozer icons created by IYIKON - Flaticon
        </a>
      </div>
    </div>
  );
};