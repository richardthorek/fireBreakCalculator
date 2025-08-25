/**
 * Analysis Panel component for displaying fire break calculations.
 * Shows estimated time and resources required for different equipment types
 * based on the drawn fire break line and selected parameters.
 */

import React, { useState, useMemo } from 'react';
import { MachinerySpec, AircraftSpec, HandCrewSpec } from '../types/config';

interface AnalysisPanelProps {
  /** Distance of the drawn fire break in meters */
  distance: number | null;
  /** Available machinery options */
  machinery: MachinerySpec[];
  /** Available aircraft options */
  aircraft: AircraftSpec[];
  /** Available hand crew options */
  handCrews: HandCrewSpec[];
}

type TerrainType = 'easy' | 'moderate' | 'difficult' | 'extreme';
type VegetationType = 'grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest';

interface CalculationResult {
  id: string;
  name: string;
  type: 'machinery' | 'aircraft' | 'handCrew';
  time: number; // hours for machinery/handCrew, total drops for aircraft
  cost: number;
  compatible: boolean;
  unit: string;
  description?: string;
}

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
  return Math.ceil(distance / aircraft.dropLength);
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
 * Check if equipment is compatible with terrain and vegetation
 */
const isCompatible = (
  equipment: MachinerySpec | AircraftSpec | HandCrewSpec,
  terrain: TerrainType,
  vegetation: VegetationType,
  expectedObjectDiameter = 0.2 // meters - default expected diameter of objects to clear
): boolean => {
  // Basic allowed terrain / vegetation check
  const basic = equipment.allowedTerrain.includes(terrain) && 
                equipment.allowedVegetation.includes(vegetation);

  if (!basic) return false;

  // If equipment declares a minClearDiameter, ensure it can handle expected objects
  // Use a type-guard to safely access machinery-specific field
  if ((equipment as MachinerySpec).minClearDiameter !== undefined) {
    const m = equipment as MachinerySpec;
    return m.minClearDiameter! <= expectedObjectDiameter;
  }

  // For aircraft and hand crews, assume they can handle small items; keep basic result
  return true;
};

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  distance,
  machinery,
  aircraft,
  handCrews
}) => {
  const [terrain, setTerrain] = useState<TerrainType>('easy');
  const [vegetation, setVegetation] = useState<VegetationType>('grassland');
  const [slopeDeg, setSlopeDeg] = useState<number>(5); // degrees
  const [expectedObjectDiameter, setExpectedObjectDiameter] = useState<number>(0.2); // meters
  const [isExpanded, setIsExpanded] = useState(false);

  // Terrain and vegetation factors
  const terrainFactors = {
    easy: 1.0,
    moderate: 1.3,
    difficult: 1.7,
    extreme: 2.2
  };
  // Map new vegetation taxonomy to numeric factors (lower is easier)
  const vegetationFactors = {
    grassland: 1.0,     // very light
    lightshrub: 1.1,    // <10cm diameter
    mediumscrub: 1.5,   // 10-50cm
    heavyforest: 2.0    // 50cm+
  } as const;

  // Additional slope time factor: additional percent time per degree (2% = 0.02)
  const slopeTimeFactor = 0.02;

  // Helper: pick a per-condition rate for machinery if available
  const selectMachineRate = (
    machine: MachinerySpec,
    slope: number,
    veg: VegetationType,
    terrainFactor: number,
    vegetationFactor: number
  ): number => {
    // Try to find a performance row matching vegetation
    const perfs = machine.performances?.filter(p => p.density === veg) ?? [];
    if (perfs.length > 0) {
      // Find first perf with slopeMax >= requested slope (smallest such slopeMax)
      const higher = perfs.filter(p => p.slopeMax >= slope).sort((a,b) => a.slopeMax - b.slopeMax);
      if (higher.length > 0) return higher[0].metersPerHour;
      // else use the highest available slope performance (worst-case)
      const fallback = perfs.sort((a,b) => b.slopeMax - a.slopeMax)[0];
      if (fallback) return fallback.metersPerHour;
    }

    // No explicit performance row: fall back to penalty-adjusted base rate
    // penalize rate by terrain and vegetation and slope
    const base = machine.clearingRate || 1;
    const slopePenalty = 1 + slope * slopeTimeFactor; // e.g., 5deg -> 1.1
    return base / (terrainFactor * vegetationFactor * slopePenalty);
  };

  const calculations = useMemo(() => {
    if (!distance) return [];

    const results: CalculationResult[] = [];
    const terrainFactor = terrainFactors[terrain];
    const vegetationFactor = vegetationFactors[vegetation];

    // Calculate machinery results using per-condition rates when available
    machinery.forEach(machine => {
      const compatible = isCompatible(machine, terrain, vegetation, expectedObjectDiameter);
      const rate = compatible ? selectMachineRate(machine, slopeDeg, vegetation, terrainFactor, vegetationFactor) : 0;
      const time = compatible ? distance / Math.max(rate, 0.0001) : 0;
      const cost = compatible && machine.costPerHour ? time * (machine.costPerHour ?? 0) : 0;

      results.push({
        id: machine.id,
        name: machine.name,
        type: 'machinery',
        time,
        cost,
        compatible,
        unit: 'hours',
        description: machine.description
      });
    });

    // Calculate aircraft results
    aircraft.forEach(plane => {
      const compatible = isCompatible(plane, terrain, vegetation, expectedObjectDiameter);
      const drops = compatible ? calculateAircraftDrops(distance, plane) : 0;
      const totalTime = compatible ? drops * (plane.turnaroundTime / 60) : 0; // convert minutes to hours
      const cost = compatible && plane.costPerHour ? totalTime * plane.costPerHour : 0;

      results.push({
        id: plane.id,
        name: plane.name,
        type: 'aircraft',
        time: drops,
        cost,
        compatible,
        unit: 'drops',
        description: plane.description
      });
    });

    // Calculate hand crew results
    handCrews.forEach(crew => {
      const compatible = isCompatible(crew, terrain, vegetation, expectedObjectDiameter);
      const time = compatible ? calculateHandCrewTime(distance, crew, terrainFactor, vegetationFactor) : 0;
      const cost = compatible && crew.costPerHour ? time * crew.costPerHour : 0;

      results.push({
        id: crew.id,
        name: crew.name,
        type: 'handCrew',
        time,
        cost,
        compatible,
        unit: 'hours',
        description: crew.description
      });
    });

    // Sort by time (ascending) - quickest first, then by cost
    return results.sort((a, b) => {
      if (!a.compatible && b.compatible) return 1;
      if (a.compatible && !b.compatible) return -1;
      if (!a.compatible && !b.compatible) return 0;
      
      // For aircraft, convert drops to estimated time for sorting
      const aTime = a.type === 'aircraft' ? a.time * 0.5 : a.time; // rough estimate
      const bTime = b.type === 'aircraft' ? b.time * 0.5 : b.time;
      
      if (Math.abs(aTime - bTime) < 0.1) {
        return a.cost - b.cost; // If time is similar, sort by cost
      }
      return aTime - bTime;
    });
  }, [distance, terrain, vegetation, machinery, aircraft, handCrews]);

  // Get best option for each category
  const bestOptions = useMemo(() => {
    const compatibleResults = calculations.filter(result => result.compatible);
    
    return {
      machinery: compatibleResults.find(result => result.type === 'machinery'),
      aircraft: compatibleResults.find(result => result.type === 'aircraft'),
      handCrew: compatibleResults.find(result => result.type === 'handCrew')
    };
  }, [calculations]);

  return (
    <div className="analysis-panel-permanent">
      <div className="analysis-header" onClick={() => setIsExpanded(!isExpanded)}>
        <h3>Fire Break Analysis</h3>
        {distance && (
          <span className="distance-display">{distance.toLocaleString()}m</span>
        )}
        <button className="expand-button" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
          {isExpanded ? '▼' : '▲'}
        </button>
      </div>

      <div className="analysis-content">
        {/* Terrain and Vegetation Controls - Always visible */}
        <div className="conditions-section">
          <h4>Site Conditions</h4>
          <div className="condition-controls">
            <label>
              Terrain:
              <select 
                value={terrain} 
                onChange={(e) => setTerrain(e.target.value as TerrainType)}
              >
                <option value="easy">Easy (Flat)</option>
                <option value="moderate">Moderate (Rolling)</option>
                <option value="difficult">Difficult (Steep)</option>
                <option value="extreme">Extreme (Very Steep)</option>
              </select>
            </label>
            <label>
              Slope (degrees):
              <input type="number" value={slopeDeg} min={0} max={60} step={1} onChange={(e) => setSlopeDeg(Number(e.target.value))} />
            </label>
            <label>
              Expected object diameter (m):
              <input type="number" value={expectedObjectDiameter} min={0} max={5} step={0.05} onChange={(e) => setExpectedObjectDiameter(Number(e.target.value))} />
            </label>
            <label>
              Vegetation:
              <select 
                value={vegetation} 
                onChange={(e) => setVegetation(e.target.value as VegetationType)}
              >
                <option value="grassland">Grassland (very light)</option>
                <option value="lightshrub">Light shrub/scrub (&lt;10cm diameter)</option>
                <option value="mediumscrub">Medium scrub/forest (10-50cm)</option>
                <option value="heavyforest">Heavy forest (50cm+)</option>
              </select>
            </label>
          </div>
        </div>

        {!distance ? (
          <div className="no-line-message">
            <p>Draw a line on the map to see equipment analysis</p>
          </div>
        ) : (
          <>
            {/* Best Options Summary - Always visible when line exists */}
            <div className="best-options-summary">
              <h4>Best Options</h4>
              <div className="best-options-grid">
                <div className="option-category">
                  <span className="category-label">Machinery</span>
                  {bestOptions.machinery ? (
                    <div className="option-details">
                      <span className="option-name">{bestOptions.machinery.name}</span>
                      <span className="option-time">
                        {bestOptions.machinery.time.toFixed(1)} {bestOptions.machinery.unit}
                      </span>
                    </div>
                  ) : (
                    <span className="no-option">No compatible options</span>
                  )}
                </div>
                
                <div className="option-category">
                  <span className="category-label">Aircraft</span>
                  {bestOptions.aircraft ? (
                    <div className="option-details">
                      <span className="option-name">{bestOptions.aircraft.name}</span>
                      <span className="option-time">
                        {bestOptions.aircraft.time.toFixed(0)} {bestOptions.aircraft.unit}
                      </span>
                    </div>
                  ) : (
                    <span className="no-option">No compatible options</span>
                  )}
                </div>
                
                <div className="option-category">
                  <span className="category-label">Hand Crew</span>
                  {bestOptions.handCrew ? (
                    <div className="option-details">
                      <span className="option-name">{bestOptions.handCrew.name}</span>
                      <span className="option-time">
                        {bestOptions.handCrew.time.toFixed(1)} {bestOptions.handCrew.unit}
                      </span>
                    </div>
                  ) : (
                    <span className="no-option">No compatible options</span>
                  )}
                </div>
              </div>
            </div>

            {/* Full Equipment Table - Only when expanded */}
            {isExpanded && (
              <div className="equipment-summary">
                <h4>All Equipment Options</h4>
                <div className="equipment-table">
                  <div className="table-header">
                    <span>Equipment</span>
                    <span>Time/Drops</span>
                    <span>Cost</span>
                    <span>Status</span>
                  </div>
                  {calculations.map((result) => (
                    <div 
                      key={result.id} 
                      className={`table-row ${!result.compatible ? 'incompatible' : ''}`}
                    >
                      <div className="equipment-info">
                        <span className="equipment-name">{result.name}</span>
                        <span className="equipment-type">{result.type}</span>
                      </div>
                      <div className="time-info">
                        {result.compatible ? (
                          <>
                            <span className="time-value">
                              {result.time.toFixed(1)}
                            </span>
                            <span className="time-unit">{result.unit}</span>
                          </>
                        ) : (
                          <span className="incompatible-text">N/A</span>
                        )}
                      </div>
                      <div className="cost-info">
                        {result.compatible && result.cost > 0 ? (
                          <span className="cost-value">${result.cost.toFixed(0)}</span>
                        ) : (
                          <span className="no-cost">-</span>
                        )}
                      </div>
                      <div className="status-info">
                        {result.compatible ? (
                          <span className="compatible">✓ Compatible</span>
                        ) : (
                          <span className="incompatible-status">✗ Incompatible</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};