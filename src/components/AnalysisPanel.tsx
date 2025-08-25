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
  /** Callback for when drop preview selection changes */
  onDropPreviewChange?: (aircraftIds: string[]) => void;
}

type TerrainType = 'easy' | 'moderate' | 'difficult' | 'extreme';
type VegetationType = 'light' | 'moderate' | 'heavy' | 'extreme';

interface CalculationResult {
  id: string;
  name: string;
  type: 'machinery' | 'aircraft' | 'handCrew';
  time: number; // hours for all types now
  cost: number;
  compatible: boolean;
  unit: string;
  description?: string;
  drops?: number; // number of drops for aircraft
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

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  distance,
  machinery,
  aircraft,
  handCrews,
  onDropPreviewChange
}) => {
  const [terrain, setTerrain] = useState<TerrainType>('easy');
  const [vegetation, setVegetation] = useState<VegetationType>('light');
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
      const time = compatible ? calculateMachineryTime(distance, machine, terrainFactor, vegetationFactor) : 0;
      const cost = compatible && machine.costPerHour ? time * machine.costPerHour : 0;

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
      const compatible = isCompatible(plane, terrain, vegetation);
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
      
      // All types now use time in hours, so direct comparison
      if (Math.abs(a.time - b.time) < 0.1) {
        return a.cost - b.cost; // If time is similar, sort by cost
      }
      return a.time - b.time;
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

            {/* Drop preview toggles are now available inline on aircraft option cards and rows */}

            {/* Full Equipment Table - Only when expanded */}
            {isExpanded && (
              <div className="equipment-summary">
                <h4>All Equipment Options</h4>
                <div className="equipment-table">
                  <div className="table-header">
                    <span>Equipment</span>
                    <span>Time</span>
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
                        {result.type === 'aircraft' && (
                          <button
                            type="button"
                            className={`row-drop-toggle-button ${selectedAircraftForPreview.includes(result.id) ? 'active' : ''}`}
                            aria-label={selectedAircraftForPreview.includes(result.id) ? 'Preview drops on' : 'Preview drops off'}
                            title="Preview drops"
                            onClick={() => handleDropPreviewChange(result.id, !selectedAircraftForPreview.includes(result.id))}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" fill="currentColor" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <div className="time-info">
                        {result.compatible ? (
                          <>
                            <span className="time-value">
                              {result.time.toFixed(1)}
                            </span>
                            <span className="time-unit">{result.unit}</span>
                            {result.drops && (
                              <span className="drops-detail">({result.drops} drops)</span>
                            )}
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