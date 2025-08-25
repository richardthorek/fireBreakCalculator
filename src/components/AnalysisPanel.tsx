/**
 * Analysis Panel component for displaying fire break calculations.
 * Shows estimated time and resources required for different equipment types
 * based on the drawn fire break line and selected parameters.
 */

import React, { useState, useMemo } from 'react';
import { MachinerySpec, AircraftSpec, HandCrewSpec, TrackAnalysis } from '../types/config';

interface AnalysisPanelProps {
  /** Distance of the drawn fire break in meters */
  distance: number | null;
  /** Track analysis data including slope information */
  trackAnalysis: TrackAnalysis | null;
  /** Available machinery options */
  machinery: MachinerySpec[];
  /** Available aircraft options */
  aircraft: AircraftSpec[];
  /** Available hand crew options */
  handCrews: HandCrewSpec[];
}

type TerrainType = 'easy' | 'moderate' | 'difficult' | 'extreme';
type VegetationType = 'light' | 'moderate' | 'heavy' | 'extreme';

interface CalculationResult {
  id: string;
  name: string;
  type: 'machinery' | 'aircraft' | 'handCrew';
  time: number; // hours for machinery/handCrew, total drops for aircraft
  cost: number;
  compatible: boolean;
  slopeCompatible?: boolean; // Whether equipment can handle the slope
  maxSlopeExceeded?: number; // Max slope encountered if exceeded
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
  vegetation: VegetationType
): boolean => {
  return equipment.allowedTerrain.includes(terrain) && 
         equipment.allowedVegetation.includes(vegetation);
};

/**
 * Check if machinery is compatible with the slope requirements
 */
const isSlopeCompatible = (
  machinery: MachinerySpec,
  maxSlope: number
): { compatible: boolean; maxSlopeExceeded?: number } => {
  if (machinery.maxSlope === undefined) {
    // If no slope limit is defined, assume it can handle any slope
    return { compatible: true };
  }
  
  const compatible = maxSlope <= machinery.maxSlope;
  return {
    compatible,
    maxSlopeExceeded: compatible ? undefined : maxSlope
  };
};

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  distance,
  trackAnalysis,
  machinery,
  aircraft,
  handCrews
}) => {
  const [terrain, setTerrain] = useState<TerrainType>('easy');
  const [vegetation, setVegetation] = useState<VegetationType>('light');
  const [isExpanded, setIsExpanded] = useState(false);

  // Terrain and vegetation factors
  const terrainFactors = {
    easy: 1.0,
    moderate: 1.3,
    difficult: 1.7,
    extreme: 2.2
  };

  const vegetationFactors = {
    light: 1.0,
    moderate: 1.4,
    heavy: 1.8,
    extreme: 2.5
  };

  const calculations = useMemo(() => {
    if (!distance) return [];

    const results: CalculationResult[] = [];
    const terrainFactor = terrainFactors[terrain];
    const vegetationFactor = vegetationFactors[vegetation];

    // Calculate machinery results
    machinery.forEach(machine => {
      const compatible = isCompatible(machine, terrain, vegetation);
      const slopeCheck = trackAnalysis ? isSlopeCompatible(machine, trackAnalysis.maxSlope) : { compatible: true };
      const fullCompatibility = compatible && slopeCheck.compatible;
      
      const time = fullCompatibility ? calculateMachineryTime(distance, machine, terrainFactor, vegetationFactor) : 0;
      const cost = fullCompatibility && machine.costPerHour ? time * machine.costPerHour : 0;

      results.push({
        id: machine.id,
        name: machine.name,
        type: 'machinery',
        time,
        cost,
        compatible: fullCompatibility,
        slopeCompatible: slopeCheck.compatible,
        maxSlopeExceeded: slopeCheck.maxSlopeExceeded,
        unit: 'hours',
        description: machine.description
      });
    });

    // Calculate aircraft results
    aircraft.forEach(plane => {
      const compatible = isCompatible(plane, terrain, vegetation);
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
      const compatible = isCompatible(crew, terrain, vegetation);
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
  }, [distance, trackAnalysis, terrain, vegetation, machinery, aircraft, handCrews]);

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
        <div className="header-info">
          {distance && (
            <span className="distance-display">{distance.toLocaleString()}m</span>
          )}
          {trackAnalysis && (
            <span className="slope-display">
              Max Slope: {trackAnalysis.maxSlope.toFixed(1)}°
            </span>
          )}
        </div>
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
              Vegetation:
              <select 
                value={vegetation} 
                onChange={(e) => setVegetation(e.target.value as VegetationType)}
              >
                <option value="light">Light (Grass)</option>
                <option value="moderate">Moderate (Mixed)</option>
                <option value="heavy">Heavy (Dense Forest)</option>
                <option value="extreme">Extreme (Very Dense)</option>
              </select>
            </label>
          </div>
        </div>

        {/* Slope Analysis Information - When track analysis is available */}
        {trackAnalysis && (
          <div className="slope-analysis-section">
            <h4>Slope Analysis</h4>
            <div className="slope-summary">
              <div className="slope-stats">
                <span>Max: {trackAnalysis.maxSlope.toFixed(1)}°</span>
                <span>Avg: {trackAnalysis.averageSlope.toFixed(1)}°</span>
                <span>Segments: {trackAnalysis.segments.length}</span>
              </div>
              {isExpanded && (
                <div className="slope-distribution">
                  <div className="slope-category flat">
                    <span>Flat (0-10°):</span>
                    <span>{trackAnalysis.slopeDistribution.flat}</span>
                  </div>
                  <div className="slope-category medium">
                    <span>Medium (10-20°):</span>
                    <span>{trackAnalysis.slopeDistribution.medium}</span>
                  </div>
                  <div className="slope-category steep">
                    <span>Steep (20-30°):</span>
                    <span>{trackAnalysis.slopeDistribution.steep}</span>
                  </div>
                  <div className="slope-category very-steep">
                    <span>Very Steep (30°+):</span>
                    <span>{trackAnalysis.slopeDistribution.very_steep}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

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
                          <div className="incompatible-details">
                            <span className="incompatible-status">✗ Incompatible</span>
                            {result.slopeCompatible === false && result.maxSlopeExceeded && (
                              <span className="slope-warning">
                                Max slope {result.maxSlopeExceeded.toFixed(1)}° exceeds limit
                              </span>
                            )}
                          </div>
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