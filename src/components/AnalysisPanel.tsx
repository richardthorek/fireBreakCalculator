/**
 * Analysis Panel component for displaying fire break calculations.
 * Shows estimated time and resources required for different equipment types
 * based on the drawn fire break line and selected parameters.
 */

import React, { useState, useMemo } from 'react';
import { MachinerySpec, AircraftSpec, HandCrewSpec, TrackAnalysis, VegetationAnalysis } from '../types/config';
import { deriveTerrainFromSlope, VEGETATION_TYPES } from '../config/classification';

interface AnalysisPanelProps {
  /** Distance of the drawn fire break in meters */
  distance: number | null;
  /** Track analysis data including slope information */
  trackAnalysis: TrackAnalysis | null;
  /** Vegetation analysis data from Mapbox Terrain v2 */
  vegetationAnalysis: VegetationAnalysis | null;
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
  time: number; // hours for all types
  cost: number;
  compatible: boolean;
  slopeCompatible?: boolean;
  maxSlopeExceeded?: number;
  drops?: number; // aircraft specific
  unit: string; // always 'hours'
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
  if (machinery.maxSlope == null) return { compatible: true };
  const compatible = maxSlope <= machinery.maxSlope;
  return { compatible, maxSlopeExceeded: compatible ? undefined : maxSlope };
};

export const AnalysisPanel: React.FC<AnalysisPanelProps & { selectedAircraftForPreview?: string[] }> = ({
  distance,
  trackAnalysis,
  vegetationAnalysis,
  machinery,
  aircraft,
  handCrews,
  onDropPreviewChange,
  selectedAircraftForPreview: externalSelected = []
}) => {
  // Vegetation state: allow manual override of auto-detected vegetation
  const [selectedVegetation, setSelectedVegetation] = useState<VegetationType>('grassland');
  const [useAutoDetected, setUseAutoDetected] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedAircraftForPreview, setSelectedAircraftForPreview] = useState<string[]>(externalSelected);
  // Quick option selections
  const [selectedQuickMachinery, setSelectedQuickMachinery] = useState<string | null>(null);
  const [selectedQuickAircraft, setSelectedQuickAircraft] = useState<string | null>(null);
  const [selectedQuickHandCrew, setSelectedQuickHandCrew] = useState<string | null>(null);

  // Determine effective vegetation: auto-detected or manually selected
  const effectiveVegetation = useMemo(() => {
    if (useAutoDetected && vegetationAnalysis) {
      return vegetationAnalysis.predominantVegetation;
    }
    return selectedVegetation;
  }, [useAutoDetected, vegetationAnalysis, selectedVegetation]);

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
  // Vegetation taxonomy factors (lower easier)
  const vegetationFactors: Record<VegetationType, number> = {
    grassland: 1.0,
    lightshrub: 1.1,
    mediumscrub: 1.5,
    heavyforest: 2.0
  };

  // Derive effective terrain requirement from max slope
  const derivedTerrainRequirement = useMemo<TerrainType | null>(() => {
    if (!trackAnalysis) return null;
    return deriveTerrainFromSlope(trackAnalysis.maxSlope) as TerrainType;
  }, [trackAnalysis]);

  const calculations = useMemo(() => {
    if (!distance) return [];

    const results: CalculationResult[] = [];
    const effectiveTerrain = derivedTerrainRequirement || 'easy';
    const terrainFactor = terrainFactors[effectiveTerrain];
    const vegetationFactor = vegetationFactors[effectiveVegetation];
    const requiredTerrain = effectiveTerrain;

    // Machinery
    machinery.forEach(machine => {
      const compatible = isCompatible(machine, requiredTerrain, effectiveVegetation);
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

    // Aircraft
    aircraft.forEach(plane => {
      const compatible = isCompatible(plane, requiredTerrain, effectiveVegetation);
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
        drops
      });
    });

    // Hand Crews
    handCrews.forEach(crew => {
      const compatible = isCompatible(crew, requiredTerrain, effectiveVegetation);
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
        return a.cost - b.cost;
      }
      return a.time - b.time;
    });
  }, [distance, trackAnalysis, effectiveVegetation, machinery, aircraft, handCrews, derivedTerrainRequirement]);

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
          {distance && <span className="distance-display">{distance.toLocaleString()}m</span>}
          {trackAnalysis && <span className="slope-display">Max Slope: {trackAnalysis.maxSlope.toFixed(1)}°</span>}
        </div>
        <button className="expand-button" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
          {isExpanded ? '▼' : '▲'}
        </button>
      </div>
      <div className="analysis-content">
        <div className="conditions-section">
          <div className="conditions-group">
            <label htmlFor="vegetation-toggle">Vegetation Type</label>
            {vegetationAnalysis && (
              <div className="auto-detected-vegetation">
                <div className="auto-detected-header">
                  <span className="auto-detected-label">Auto-detected: <strong>{vegetationAnalysis.predominantVegetation}</strong></span>
                  <span className="confidence-badge">{Math.round(vegetationAnalysis.overallConfidence * 100)}% confidence</span>
                </div>
                <div className="vegetation-toggle">
                  <label>
                    <input type="checkbox" checked={useAutoDetected} onChange={e => setUseAutoDetected(e.target.checked)} />
                    Use auto-detected vegetation
                  </label>
                </div>
              </div>
            )}
            {(!vegetationAnalysis || !useAutoDetected) && (
              <select
                aria-label="Select vegetation type"
                id="vegetation-select"
                value={selectedVegetation}
                onChange={e => setSelectedVegetation(e.target.value as VegetationType)}
                disabled={useAutoDetected && !!vegetationAnalysis}
              >
                {VEGETATION_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            <div className="effective-vegetation">Using: <strong>{effectiveVegetation}</strong></div>
          </div>
        </div>
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
                  <div className="slope-category flat"><span>Flat (0-10°):</span><span>{trackAnalysis.slopeDistribution.flat}</span></div>
                  <div className="slope-category medium"><span>Medium (10-20°):</span><span>{trackAnalysis.slopeDistribution.medium}</span></div>
                  <div className="slope-category steep"><span>Steep (20-30°):</span><span>{trackAnalysis.slopeDistribution.steep}</span></div>
                  <div className="slope-category very-steep"><span>Very Steep (30°+):</span><span>{trackAnalysis.slopeDistribution.very_steep}</span></div>
                </div>
              )}
            </div>
          </div>
        )}
        {!distance ? (
          <div className="no-line-message"><p>Draw a line on the map to see equipment analysis</p></div>
        ) : (
          <>
            <div className="best-options-summary">
              <h4>Quick Options</h4>
              <div className="best-options-grid">
                <div className="option-category">
                  <div className="category-header"><span className="category-icon">🛠️</span><span className="category-label">Machinery</span></div>
                  {bestOptions.machinery ? (
                    <div className="option-details">
                      <span className="option-name">{bestOptions.machinery.name}</span>
                      {quickMachinery && <span className="option-time">{quickMachinery.time.toFixed(1)} {quickMachinery.unit}</span>}
                    </div>
                  ) : <span className="no-option">No compatible options</span>}
                </div>
                <div className="option-category">
                  <div className="category-header"><span className="category-icon">✈️</span><span className="category-label">Aircraft</span></div>
                  {bestOptions.aircraft ? (
                    <div className="option-details">
                      <div className="drop-preview-toggle">
                        <span className="option-name">{bestOptions.aircraft.name}</span>
                        <button
                          type="button"
                          className={`drop-toggle-button ${selectedAircraftForPreview.includes(bestOptions.aircraft.id) ? 'active' : ''}`}
                          aria-label={selectedAircraftForPreview.includes(bestOptions.aircraft.id) ? 'Drop preview on' : 'Drop preview off'}
                          title="Toggle drop preview"
                          onClick={() => handleDropPreviewChange(bestOptions.aircraft!.id, !selectedAircraftForPreview.includes(bestOptions.aircraft!.id))}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" fill="currentColor" /></svg>
                        </button>
                      </div>
                      <span className="option-time">{bestOptions.aircraft.time.toFixed(1)} {bestOptions.aircraft.unit}{bestOptions.aircraft.drops && <span className="drops-info"> ({bestOptions.aircraft.drops} drops)</span>}</span>
                    </div>
                  ) : <span className="no-option">No compatible options</span>}
                </div>
                <div className="option-category">
                  <div className="category-header"><span className="category-icon">👨‍🚒</span><span className="category-label">Hand Crew</span></div>
                  {bestOptions.handCrew ? (
                    <div className="option-details">
                      <span className="option-name">{bestOptions.handCrew.name}</span>
                      {quickHandCrew && <span className="option-time">{quickHandCrew.time.toFixed(1)} {quickHandCrew.unit}</span>}
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
                      {calculations.filter(r => r.type === 'machinery').map(result => (
                        <div key={result.id} className={`table-row ${!result.compatible ? 'incompatible' : ''}`}>
                          <div className="equipment-info">
                            <span className="equipment-icon">{getEquipmentIcon(result)}</span>
                            <div className="equipment-details">
                              <span className="equipment-name">{result.name}</span>
                              <span className="equipment-type">{result.type}</span>
                            </div>
                          </div>
                          <div className="time-info">{result.compatible ? (<><span className="time-value">{result.time.toFixed(1)}</span><span className="time-unit">{result.unit}</span></>) : (<span className="incompatible-text">N/A</span>)}</div>
                          <div className="cost-info">{result.compatible && result.cost > 0 ? <span className="cost-value">${result.cost.toFixed(0)}</span> : <span className="no-cost">-</span>}</div>
                          <div className="status-info">{result.compatible ? <span className="compatible">✓ Compatible</span> : <span className="incompatible-status">✗ Incompatible</span>}</div>
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
    </div>
  );
};