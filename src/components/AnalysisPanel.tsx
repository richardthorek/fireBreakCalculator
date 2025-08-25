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
  /** Callback for when drop preview selection changes */
  onDropPreviewChange?: (aircraftIds: string[]) => void;
}

type TerrainType = 'easy' | 'moderate' | 'difficult' | 'extreme';
type VegetationType = 'grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest';

interface CalculationResult {
  id: string;
  name: string;
  type: 'machinery' | 'aircraft' | 'handCrew';
  time: number; // hours for all types now
  cost: number;
  compatible: boolean;
  slopeCompatible?: boolean; // Whether equipment can handle the slope
  maxSlopeExceeded?: number; // Max slope encountered if exceeded
  unit: string;
  description?: string;
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
  requiredTerrain: TerrainType,
  vegetation: VegetationType
): boolean => {
  return equipment.allowedTerrain.includes(requiredTerrain) &&
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
  handCrews,
  onDropPreviewChange
}) => {
  const [terrain, setTerrain] = useState<TerrainType>('easy');
  const [vegetation, setVegetation] = useState<VegetationType>('grassland');
  const [slopeDeg, setSlopeDeg] = useState<number>(5); // degrees
  const [expectedObjectDiameter, setExpectedObjectDiameter] = useState<number>(0.2); // meters
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedAircraftForPreview, setSelectedAircraftForPreview] = useState<string[]>([]);

  // Handle drop preview selection changes
  const handleDropPreviewChange = (aircraftId: string, isSelected: boolean) => {
    const updatedSelection = isSelected 
      ? [...selectedAircraftForPreview, aircraftId]
      : selectedAircraftForPreview.filter(id => id !== aircraftId);
    
    setSelectedAircraftForPreview(updatedSelection);
    onDropPreviewChange?.(updatedSelection);
  };

  // Terrain and vegetation factors
  const terrainFactors = {
    easy: 1.0,
    moderate: 1.3,
    difficult: 1.7,
    extreme: 2.2
  };
  // Map new vegetation taxonomy to numeric factors (lower is easier)
  const vegetationFactors = {
    light: 1.0,
    moderate: 1.4,
    heavy: 1.8,
    extreme: 2.5
  };

  // Map max slope to a minimum terrain class requirement
  const derivedTerrainRequirement: TerrainType | null = useMemo(() => {
    if (!trackAnalysis) return null;
    const maxSlope = trackAnalysis.maxSlope;
    if (maxSlope <= 10) return 'easy';
    if (maxSlope <= 20) return 'moderate';
    if (maxSlope <= 30) return 'difficult';
    return 'extreme';
  }, [trackAnalysis]);

  const calculations = useMemo(() => {
    if (!distance) return [];

    const results: CalculationResult[] = [];
    const terrainFactor = terrainFactors[terrain];
    const vegetationFactor = vegetationFactors[vegetation];

    // Calculate machinery results
    const requiredTerrain = derivedTerrainRequirement || terrain; // fallback to user selection if no analysis
    machinery.forEach(machine => {
      const compatible = isCompatible(machine, requiredTerrain, vegetation);
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
      const compatible = isCompatible(plane, requiredTerrain, vegetation);
      const drops = compatible ? calculateAircraftDrops(distance, plane) : 0;
      const totalTime = compatible ? drops * (plane.turnaroundTime / 60) : 0; // convert minutes to hours
      const cost = compatible && plane.costPerHour ? totalTime * plane.costPerHour : 0;

      results.push({
        id: plane.id,
        name: plane.name,
        type: 'aircraft',
        time: totalTime,
        cost,
        compatible,
        unit: 'hours',
        description: plane.description,
        // Store additional aircraft-specific info for display
        drops: drops
      });
    });

    // Calculate hand crew results
    handCrews.forEach(crew => {
      const compatible = isCompatible(crew, requiredTerrain, vegetation);
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
      
      // All types now use time in hours, so direct comparison
      if (Math.abs(a.time - b.time) < 0.1) {
        return a.cost - b.cost; // If time is similar, sort by cost
      }
      return a.time - b.time;
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
              <h4>Quick Options</h4>
              <div className="best-options-grid">
                <div className="option-category">
                  <div className="category-header">
                    <span className="category-icon">🛠️</span>
                    <span className="category-label">Machinery</span>
                  </div>
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
                  <div className="category-header">
                    <span className="category-icon">✈️</span>
                    <span className="category-label">Aircraft</span>
                  </div>
                  {bestOptions.aircraft ? (
                    <div className="option-details">
                      <div className="drop-preview-toggle">
                        <span className="option-name">{bestOptions.aircraft.name}</span>
                        {/* Toggle button placed top-right via CSS */}
                        <button
                          type="button"
                          className={`drop-toggle-button ${selectedAircraftForPreview.includes(bestOptions.aircraft?.id ?? '') ? 'active' : ''}`}
                          aria-label={selectedAircraftForPreview.includes(bestOptions.aircraft?.id ?? '') ? 'Drop preview on' : 'Drop preview off'}
                          title="Toggle drop preview"
                          onClick={() => bestOptions.aircraft && handleDropPreviewChange(bestOptions.aircraft.id, !selectedAircraftForPreview.includes(bestOptions.aircraft.id))}
                        >
                          {/* Simple plane SVG icon */}
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" fill="currentColor" />
                          </svg>
                        </button>
                      </div>
                      <span className="option-time">
                        {bestOptions.aircraft.time.toFixed(1)} {bestOptions.aircraft.unit}
                        {bestOptions.aircraft.drops && (
                          <span className="drops-info"> ({bestOptions.aircraft.drops} drops)</span>
                        )}
                      </span>
                    </div>
                  ) : (
                    <span className="no-option">No compatible options</span>
                  )}
                </div>
                
                <div className="option-category">
                  <div className="category-header">
                    <span className="category-icon">👨‍🚒</span>
                    <span className="category-label">Hand Crew</span>
                  </div>
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

            {/* Drop preview toggles are now available inline on aircraft option cards and rows */}

            {/* Full Equipment Table - Only when expanded */}
            {isExpanded && (
              <div className="equipment-summary">
                <h4>All Equipment Options</h4>
                <div className="equipment-categories">
                  {/* Machinery Section */}
                  <div className="equipment-category-section">
                    <h5 className="category-section-header">
                      <span className="category-section-icon">🛠️</span>
                      Machinery
                    </h5>
                    <div className="equipment-table">
                      <div className="table-header">
                        <span>Equipment</span>
                        <span>Time</span>
                        <span>Cost</span>
                        <span>Status</span>
                      </div>
                      {calculations
                        .filter(result => result.type === 'machinery')
                        .map((result) => (
                        <div 
                          key={result.id} 
                          className={`table-row ${!result.compatible ? 'incompatible' : ''}`}
                        >
                          <div className="equipment-info">
                            <span className="equipment-icon">{getEquipmentIcon(result)}</span>
                            <div className="equipment-details">
                              <span className="equipment-name">{result.name}</span>
                              <span className="equipment-type">{result.type}</span>
                            </div>
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