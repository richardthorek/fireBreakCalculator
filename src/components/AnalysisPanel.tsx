/**
 * Analysis Panel component for displaying fire break calculations.
 * Shows estimated time and resources required for different equipment types
 * based on the drawn fire break line and selected parameters.
 */

import React, { useState, useMemo } from 'react';
import { MachinerySpec, AircraftSpec, HandCrewSpec, TrackAnalysis } from '../types/config';
import { deriveTerrainFromSlope, VEGETATION_TYPES } from '../config/classification';

interface AnalysisPanelProps {
  /** Distance of the drawn fire break in meters */
  distance: number | null;
  /** Track analysis data including slope information */
  trackAnalysis: TrackAnalysis | null;
  /** All drawn breaks with their distances and analyses */
  breaks?: { id: number; distance: number; analysis: TrackAnalysis | null }[];
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
  drops?: number;
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
  requiredTerrain: TerrainType,
  vegetation: VegetationType,
  expectedObjectDiameter = 0.2 // meters - default expected diameter of objects to clear
): boolean => {
  // Basic compatibility checks: terrain and vegetation membership
  return equipment.allowedTerrain.includes(requiredTerrain) &&
         equipment.allowedVegetation.includes(vegetation as any);
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
  breaks = [],
  machinery,
  aircraft,
  handCrews,
  onDropPreviewChange
}) => {
  // User-selected vegetation context (was previously removed)
  const [selectedVegetation, setSelectedVegetation] = useState<VegetationType>('grassland');
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedAircraftForPreview, setSelectedAircraftForPreview] = useState<string[]>([]);
  // User-selected quick option IDs
  const [selectedQuickMachinery, setSelectedQuickMachinery] = useState<string | null>(null);
  const [selectedQuickAircraft, setSelectedQuickAircraft] = useState<string | null>(null);
  const [selectedQuickHandCrew, setSelectedQuickHandCrew] = useState<string | null>(null);

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
    grassland: 1.0,
    lightshrub: 1.1,
    mediumscrub: 1.5,
    heavyforest: 2.0
  } as Record<VegetationType, number>;

  // Map max slope to a minimum terrain class requirement
  const derivedTerrainRequirement: TerrainType | null = useMemo(() => {
    if (!trackAnalysis) return null;
    return deriveTerrainFromSlope(trackAnalysis.maxSlope) as TerrainType;
  }, [trackAnalysis]);

  const calculations = useMemo(() => {
    if (!distance) return [];

    const results: CalculationResult[] = [];
  const effectiveTerrain = derivedTerrainRequirement || 'easy';
  const terrainFactor = terrainFactors[effectiveTerrain];
  const vegetationFactor = vegetationFactors[selectedVegetation];

    // Calculate machinery results
  const requiredTerrain = effectiveTerrain;
    machinery.forEach(machine => {
  const compatible = isCompatible(machine, requiredTerrain, selectedVegetation);
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
  const compatible = isCompatible(plane, requiredTerrain, selectedVegetation);
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
  const compatible = isCompatible(crew, requiredTerrain, selectedVegetation);
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
  }, [distance, trackAnalysis, selectedVegetation, machinery, aircraft, handCrews, derivedTerrainRequirement]);

  // Helper to compute calculations for an arbitrary break (re-use same logic)
  const computeForBreak = (dist: number, analysis: TrackAnalysis | null) => {
    // reuse the same logic as above but with provided inputs
    const effectiveTerrain = (analysis ? deriveTerrainFromSlope(analysis.maxSlope) : 'easy') as TerrainType;
    const terrainFactor = {
      easy: 1.0,
      moderate: 1.3,
      difficult: 1.7,
      extreme: 2.2
    }[effectiveTerrain];
    const vegetationFactor = {
      grassland: 1.0,
      lightshrub: 1.1,
      mediumscrub: 1.5,
      heavyforest: 2.0
    }[selectedVegetation];

    const results: CalculationResult[] = [];
    const requiredTerrain = effectiveTerrain;

    machinery.forEach(machine => {
      const compatible = isCompatible(machine, requiredTerrain, selectedVegetation);
      const slopeCheck = analysis ? isSlopeCompatible(machine, analysis.maxSlope) : { compatible: true };
      const fullCompatibility = compatible && slopeCheck.compatible;
      const time = fullCompatibility ? calculateMachineryTime(dist, machine, terrainFactor, vegetationFactor) : 0;
      const cost = fullCompatibility && machine.costPerHour ? time * machine.costPerHour : 0;
      results.push({ id: machine.id, name: machine.name, type: 'machinery', time, cost, compatible: fullCompatibility, slopeCompatible: slopeCheck.compatible, maxSlopeExceeded: slopeCheck.maxSlopeExceeded, unit: 'hours', description: machine.description });
    });

    aircraft.forEach(plane => {
      const compatible = isCompatible(plane, requiredTerrain, selectedVegetation);
      const drops = compatible ? calculateAircraftDrops(dist, plane) : 0;
      const totalTime = compatible ? drops * (plane.turnaroundTime / 60) : 0;
      const cost = compatible && plane.costPerHour ? totalTime * plane.costPerHour : 0;
      results.push({ id: plane.id, name: plane.name, type: 'aircraft', time: totalTime, cost, compatible, unit: 'hours', description: plane.description, drops });
    });

    handCrews.forEach(crew => {
      const compatible = isCompatible(crew, requiredTerrain, selectedVegetation);
      const time = compatible ? calculateHandCrewTime(dist, crew, terrainFactor, vegetationFactor) : 0;
      const cost = compatible && crew.costPerHour ? time * crew.costPerHour : 0;
      results.push({ id: crew.id, name: crew.name, type: 'handCrew', time, cost, compatible, unit: 'hours', description: crew.description });
    });

    results.sort((a, b) => {
      if (!a.compatible && b.compatible) return 1;
      if (a.compatible && !b.compatible) return -1;
      if (!a.compatible && !b.compatible) return 0;
      if (Math.abs(a.time - b.time) < 0.1) return a.cost - b.cost;
      return a.time - b.time;
    });

    return results;
  };

  // Get best option for each category
  const bestOptions = useMemo(() => {
    const compatibleResults = calculations.filter(result => result.compatible);
    
    return {
      machinery: compatibleResults.find(result => result.type === 'machinery'),
      aircraft: compatibleResults.find(result => result.type === 'aircraft'),
      handCrew: compatibleResults.find(result => result.type === 'handCrew')
    };
  }, [calculations]);

  // Initialize / reconcile selected quick options when calculations change
  useMemo(() => {
    if (calculations.length === 0) return null;
    const machList = calculations.filter(c => c.type === 'machinery' && c.compatible);
    const airList = calculations.filter(c => c.type === 'aircraft' && c.compatible);
    const handList = calculations.filter(c => c.type === 'handCrew' && c.compatible);
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
  }, [calculations, selectedQuickMachinery, selectedQuickAircraft, selectedQuickHandCrew]);

  const quickMachinery = selectedQuickMachinery ? calculations.find(c => c.id === selectedQuickMachinery) : undefined;
  const quickAircraft = selectedQuickAircraft ? calculations.find(c => c.id === selectedQuickAircraft) : undefined;
  const quickHandCrew = selectedQuickHandCrew ? calculations.find(c => c.id === selectedQuickHandCrew) : undefined;

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
        {/* Vegetation selector */}
        <div className="conditions-section">
          <div className="conditions-group">
            <label htmlFor="vegetation-select">Vegetation</label>
            <select
              id="vegetation-select"
              value={selectedVegetation}
              onChange={(e) => setSelectedVegetation(e.target.value as VegetationType)}
            >
              {VEGETATION_TYPES.map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* List of drawn breaks and per-break recommendations */}
        {breaks && breaks.length > 0 && (
          <div className="breaks-list">
            <h4>Drawn Fire Breaks</h4>
            <div className="break-items">
              {breaks.map(b => {
                const recs = computeForBreak(b.distance, b.analysis);
                const bestMachinery = recs.find(r => r.type === 'machinery' && r.compatible);
                const bestAircraft = recs.find(r => r.type === 'aircraft' && r.compatible);
                const bestHand = recs.find(r => r.type === 'handCrew' && r.compatible);
                return (
                  <div key={b.id} className="break-item">
                    <div className="break-header">
                      <strong>Break {b.id}</strong>
                      <span className="break-distance">{b.distance} m</span>
                    </div>
                    <div className="break-recommendations">
                      <div className="rec-machinery">Machinery: {bestMachinery ? `${bestMachinery.name} (${bestMachinery.time.toFixed(1)}h)` : 'None'}</div>
                      <div className="rec-aircraft">Aircraft: {bestAircraft ? `${bestAircraft.name} (${bestAircraft.time.toFixed(1)}h)` : 'None'}</div>
                      <div className="rec-hand">Hand Crew: {bestHand ? `${bestHand.name} (${bestHand.time.toFixed(1)}h)` : 'None'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
                  {quickMachinery ? (
                    <div className="option-details option-with-select">
                      <div className="option-main-line">
                        <select
                          className="quick-select"
                          value={quickMachinery.id}
                          onChange={(e) => setSelectedQuickMachinery(e.target.value)}
                          aria-label="Select machinery option"
                          title="Select machinery option"
                        >
                          {calculations.filter(c => c.type==='machinery').map(m => (
                            // Allow the user to pick any option; mark incompatible ones visually instead of disabling them
                            <option key={m.id} value={m.id} data-incompatible={m.compatible ? 'false' : 'true'}>
                              {m.name}{!m.compatible ? ' (✗)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="option-time">
                        {quickMachinery.time.toFixed(1)} {quickMachinery.unit}
                      </span>
                    </div>
                  ) : <span className="no-option">No compatible options</span>}
                </div>
                
                <div className="option-category">
                  <div className="category-header">
                    <span className="category-icon">✈️</span>
                    <span className="category-label">Aircraft</span>
                  </div>
                  {quickAircraft ? (
                    <div className="option-details option-with-select">
                      <div className="drop-preview-toggle option-main-line">
                        <select
                          className="quick-select"
                          value={quickAircraft.id}
                          onChange={(e) => {
                            const newId = e.target.value;
                            const prevId = selectedQuickAircraft;
                            setSelectedQuickAircraft(newId);
                            // If drop preview was enabled for the previous quick aircraft,
                            // replace it with the newly selected aircraft so the preview follows selection.
                            if (prevId && selectedAircraftForPreview.includes(prevId)) {
                              const updated = selectedAircraftForPreview.filter(id => id !== prevId).concat(newId);
                              setSelectedAircraftForPreview(updated);
                              onDropPreviewChange?.(updated);
                            }
                          }}
                          aria-label="Select aircraft option"
                          title="Select aircraft option"
                        >
                          {calculations.filter(c => c.type==='aircraft').map(a => (
                            <option key={a.id} value={a.id} data-incompatible={a.compatible ? 'false' : 'true'}>
                              {a.name}{!a.compatible ? ' (✗)' : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={`drop-toggle-button ${selectedAircraftForPreview.includes(quickAircraft.id) ? 'active' : ''}`}
                          aria-label={selectedAircraftForPreview.includes(quickAircraft.id) ? 'Drop preview on' : 'Drop preview off'}
                          title="Toggle drop preview"
                          onClick={() => handleDropPreviewChange(quickAircraft.id, !selectedAircraftForPreview.includes(quickAircraft.id))}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" fill="currentColor" />
                          </svg>
                        </button>
                      </div>
                      <span className="option-time">
                        {quickAircraft.time.toFixed(1)} {quickAircraft.unit}
                        {quickAircraft.drops && (
                          <span className="drops-info"> ({quickAircraft.drops} drops)</span>
                        )}
                      </span>
                    </div>
                  ) : <span className="no-option">No compatible options</span>}
                </div>
                
                <div className="option-category">
                  <div className="category-header">
                    <span className="category-icon">👨‍🚒</span>
                    <span className="category-label">Hand Crew</span>
                  </div>
                  {quickHandCrew ? (
                    <div className="option-details option-with-select">
                      <div className="option-main-line">
                        <select
                          className="quick-select"
                          value={quickHandCrew.id}
                          onChange={(e) => setSelectedQuickHandCrew(e.target.value)}
                          aria-label="Select hand crew option"
                          title="Select hand crew option"
                        >
                          {calculations.filter(c => c.type==='handCrew').map(h => (
                            <option key={h.id} value={h.id} data-incompatible={h.compatible ? 'false' : 'true'}>
                              {h.name}{!h.compatible ? ' (✗)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="option-time">
                        {quickHandCrew.time.toFixed(1)} {quickHandCrew.unit}
                      </span>
                    </div>
                  ) : <span className="no-option">No compatible options</span>}
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