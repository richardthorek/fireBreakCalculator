/**
 * Analysis Panel component for displaying fire break calculations.
 * Shows estimated time and resources required for different equipment types
 * based on the drawn fire break line and selected parameters.
 */

import React, { useState } from 'react';
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

interface CalculationInputs {
  terrainFactor: number;
  vegetationFactor: number;
  selectedMachinery: string[];
  selectedAircraft: string[];
  selectedHandCrews: string[];
}

/**
 * Calculate time required for machinery to clear the fire break
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

export const AnalysisPanel: React.FC<AnalysisPanelProps> = ({
  distance,
  machinery,
  aircraft,
  handCrews
}) => {
  const [inputs, setInputs] = useState<CalculationInputs>({
    terrainFactor: 1.0,
    vegetationFactor: 1.0,
    selectedMachinery: [],
    selectedAircraft: [],
    selectedHandCrews: []
  });

  const [isExpanded, setIsExpanded] = useState(false);

  if (!distance) {
    return (
      <div className="analysis-panel">
        <div className="analysis-header">
          <h3>Fire Break Analysis</h3>
          <p>Draw a line on the map to start planning your fire break</p>
        </div>
      </div>
    );
  }

  const toggleResourceSelection = (type: 'machinery' | 'aircraft' | 'handCrews', id: string) => {
    setInputs(prev => {
      const key = `selected${type.charAt(0).toUpperCase() + type.slice(1)}` as 
        'selectedMachinery' | 'selectedAircraft' | 'selectedHandCrews';
      const currentSelection = prev[key];
      const newSelection = currentSelection.includes(id)
        ? currentSelection.filter(item => item !== id)
        : [...currentSelection, id];
      
      return {
        ...prev,
        [key]: newSelection
      };
    });
  };

  return (
    <div className={`analysis-panel ${isExpanded ? 'expanded' : ''}`}>
      <div className="analysis-header" onClick={() => setIsExpanded(!isExpanded)}>
        <h3>Fire Break Analysis</h3>
        <span className="distance-display">{distance.toLocaleString()}m</span>
        <button className="expand-button" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
          {isExpanded ? '▼' : '▲'}
        </button>
      </div>

      {isExpanded && (
        <div className="analysis-content">
          {/* Terrain and Vegetation Factors */}
          <div className="factors-section">
            <h4>Conditions</h4>
            <div className="factor-controls">
              <label>
                Terrain:
                <select 
                  value={inputs.terrainFactor} 
                  onChange={(e) => setInputs(prev => ({ ...prev, terrainFactor: parseFloat(e.target.value) }))}
                >
                  <option value={1.0}>Easy (Flat)</option>
                  <option value={1.3}>Moderate (Rolling)</option>
                  <option value={1.7}>Difficult (Steep)</option>
                  <option value={2.2}>Extreme (Very Steep)</option>
                </select>
              </label>
              <label>
                Vegetation:
                <select 
                  value={inputs.vegetationFactor} 
                  onChange={(e) => setInputs(prev => ({ ...prev, vegetationFactor: parseFloat(e.target.value) }))}
                >
                  <option value={1.0}>Light (Grass)</option>
                  <option value={1.4}>Moderate (Mixed)</option>
                  <option value={1.8}>Heavy (Dense Forest)</option>
                  <option value={2.5}>Extreme (Very Dense)</option>
                </select>
              </label>
            </div>
          </div>

          {/* Machinery Section */}
          <div className="resource-section">
            <h4>Machinery</h4>
            {machinery.map(machine => (
              <div key={machine.id} className="resource-item">
                <label>
                  <input
                    type="checkbox"
                    checked={inputs.selectedMachinery.includes(machine.id)}
                    onChange={() => toggleResourceSelection('machinery', machine.id)}
                  />
                  <span className="resource-name">{machine.name}</span>
                </label>
                {inputs.selectedMachinery.includes(machine.id) && (
                  <div className="calculation-result">
                    Time: {calculateMachineryTime(distance, machine, inputs.terrainFactor, inputs.vegetationFactor).toFixed(1)} hours
                    {machine.costPerHour && (
                      <span className="cost">
                        Cost: ${(calculateMachineryTime(distance, machine, inputs.terrainFactor, inputs.vegetationFactor) * machine.costPerHour).toFixed(0)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Aircraft Section */}
          <div className="resource-section">
            <h4>Aircraft</h4>
            {aircraft.map(craft => (
              <div key={craft.id} className="resource-item">
                <label>
                  <input
                    type="checkbox"
                    checked={inputs.selectedAircraft.includes(craft.id)}
                    onChange={() => toggleResourceSelection('aircraft', craft.id)}
                  />
                  <span className="resource-name">{craft.name}</span>
                </label>
                {inputs.selectedAircraft.includes(craft.id) && (
                  <div className="calculation-result">
                    Drops: {calculateAircraftDrops(distance, craft)}
                    <span className="time">
                      Time: {((calculateAircraftDrops(distance, craft) * craft.turnaroundTime) / 60).toFixed(1)} hours
                    </span>
                    {craft.costPerHour && (
                      <span className="cost">
                        Cost: ${(((calculateAircraftDrops(distance, craft) * craft.turnaroundTime) / 60) * craft.costPerHour).toFixed(0)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Hand Crews Section */}
          <div className="resource-section">
            <h4>Hand Crews</h4>
            {handCrews.map(crew => (
              <div key={crew.id} className="resource-item">
                <label>
                  <input
                    type="checkbox"
                    checked={inputs.selectedHandCrews.includes(crew.id)}
                    onChange={() => toggleResourceSelection('handCrews', crew.id)}
                  />
                  <span className="resource-name">{crew.name}</span>
                </label>
                {inputs.selectedHandCrews.includes(crew.id) && (
                  <div className="calculation-result">
                    Time: {calculateHandCrewTime(distance, crew, inputs.terrainFactor, inputs.vegetationFactor).toFixed(1)} hours
                    {crew.costPerHour && (
                      <span className="cost">
                        Cost: ${(calculateHandCrewTime(distance, crew, inputs.terrainFactor, inputs.vegetationFactor) * crew.costPerHour).toFixed(0)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};