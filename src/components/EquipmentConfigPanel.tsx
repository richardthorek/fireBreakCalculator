/**
 * Equipment Configuration Panel component for managing fire break calculator resources.
 * Allows administrators to configure machinery, aircraft, and hand crew specifications
 * including clearing rates, costs, and terrain/vegetation constraints.
 */

import React, { useState } from 'react';
import { MachinerySpec, AircraftSpec, HandCrewSpec } from '../types/config';

interface EquipmentConfigPanelProps {
  machinery: MachinerySpec[];
  aircraft: AircraftSpec[];
  handCrews: HandCrewSpec[];
  onUpdateMachinery: (machinery: MachinerySpec[]) => void;
  onUpdateAircraft: (aircraft: AircraftSpec[]) => void;
  onUpdateHandCrews: (handCrews: HandCrewSpec[]) => void;
}

type EquipmentType = 'machinery' | 'aircraft' | 'handCrews';

export const EquipmentConfigPanel: React.FC<EquipmentConfigPanelProps> = ({
  machinery,
  aircraft,
  handCrews,
  onUpdateMachinery,
  onUpdateAircraft,
  onUpdateHandCrews
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<EquipmentType>('machinery');
  const [editingItem, setEditingItem] = useState<string | null>(null);

  const terrainOptions = ['easy', 'moderate', 'difficult', 'extreme'];
  const vegetationOptions = ['light', 'moderate', 'heavy', 'extreme'];

  const handleUpdateMachinery = (updatedMachine: MachinerySpec) => {
    const updated = machinery.map(m => m.id === updatedMachine.id ? updatedMachine : m);
    onUpdateMachinery(updated);
    setEditingItem(null);
  };

  const handleUpdateAircraft = (updatedAircraft: AircraftSpec) => {
    const updated = aircraft.map(a => a.id === updatedAircraft.id ? updatedAircraft : a);
    onUpdateAircraft(updated);
    setEditingItem(null);
  };

  const handleUpdateHandCrew = (updatedCrew: HandCrewSpec) => {
    const updated = handCrews.map(c => c.id === updatedCrew.id ? updatedCrew : c);
    onUpdateHandCrews(updated);
    setEditingItem(null);
  };

  const MachineryEditForm: React.FC<{ machine: MachinerySpec }> = ({ machine }) => {
    const [formData, setFormData] = useState(machine);

    const handleSave = () => {
      handleUpdateMachinery(formData);
    };

    return (
      <div className="equipment-edit-form">
        <h5>{machine.name} - Configuration</h5>
        <div className="form-grid">
          <label>
            Name:
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
            />
          </label>
          <label>
            Clearing Rate (m/h):
            <input
              type="number"
              value={formData.clearingRate}
              onChange={(e) => setFormData({...formData, clearingRate: Number(e.target.value)})}
            />
          </label>
          <label>
            Cost per Hour ($):
            <input
              type="number"
              value={formData.costPerHour || 0}
              onChange={(e) => setFormData({...formData, costPerHour: Number(e.target.value)})}
            />
          </label>
          <label>
            Description:
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
            />
          </label>
        </div>
        
        <div className="constraints-section">
          <h6>Terrain Compatibility</h6>
          <div className="checkbox-group">
            {terrainOptions.map(terrain => (
              <label key={terrain} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.allowedTerrain.includes(terrain as any)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData({...formData, allowedTerrain: [...formData.allowedTerrain, terrain as any]});
                    } else {
                      setFormData({...formData, allowedTerrain: formData.allowedTerrain.filter(t => t !== terrain)});
                    }
                  }}
                />
                {terrain.charAt(0).toUpperCase() + terrain.slice(1)}
              </label>
            ))}
          </div>

          <h6>Vegetation Compatibility</h6>
          <div className="checkbox-group">
            {vegetationOptions.map(vegetation => (
              <label key={vegetation} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.allowedVegetation.includes(vegetation as any)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setFormData({...formData, allowedVegetation: [...formData.allowedVegetation, vegetation as any]});
                    } else {
                      setFormData({...formData, allowedVegetation: formData.allowedVegetation.filter(v => v !== vegetation)});
                    }
                  }}
                />
                {vegetation.charAt(0).toUpperCase() + vegetation.slice(1)}
              </label>
            ))}
          </div>
        </div>

        <div className="form-actions">
          <button onClick={handleSave} className="save-button">Save Changes</button>
          <button onClick={() => setEditingItem(null)} className="cancel-button">Cancel</button>
        </div>
      </div>
    );
  };

  const EquipmentList: React.FC = () => {
    const currentEquipment = activeTab === 'machinery' ? machinery : 
                           activeTab === 'aircraft' ? aircraft : handCrews;

    return (
      <div className="equipment-list">
        {currentEquipment.map((item) => (
          <div key={item.id} className="equipment-item">
            {editingItem === item.id ? (
              activeTab === 'machinery' ? 
                <MachineryEditForm machine={item as MachinerySpec} /> :
                <div>Edit form for {activeTab} coming soon...</div>
            ) : (
              <div className="equipment-summary">
                <div className="equipment-header">
                  <h5>{item.name}</h5>
                  <button 
                    onClick={() => setEditingItem(item.id)}
                    className="edit-button"
                  >
                    Edit
                  </button>
                </div>
                <div className="equipment-details">
                  {activeTab === 'machinery' && (
                    <p>Rate: {(item as MachinerySpec).clearingRate} m/h</p>
                  )}
                  {activeTab === 'aircraft' && (
                    <p>Drop Length: {(item as AircraftSpec).dropLength} m</p>
                  )}
                  {activeTab === 'handCrews' && (
                    <p>Crew Size: {(item as HandCrewSpec).crewSize} people</p>
                  )}
                  <p>Cost: ${item.costPerHour || 0}/h</p>
                  <p>Terrain: {item.allowedTerrain.join(', ')}</p>
                  <p>Vegetation: {item.allowedVegetation.join(', ')}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  if (!isOpen) {
    return (
      <button 
        className="config-panel-toggle"
        onClick={() => setIsOpen(true)}
        title="Configure Equipment"
      >
        ⚙️ Config
      </button>
    );
  }

  return (
    <div className="equipment-config-panel">
      <div className="config-header">
        <h3>Equipment Configuration</h3>
        <button 
          className="close-button"
          onClick={() => setIsOpen(false)}
        >
          ✕
        </button>
      </div>

      <div className="config-tabs">
        <button 
          className={`tab-button ${activeTab === 'machinery' ? 'active' : ''}`}
          onClick={() => setActiveTab('machinery')}
        >
          Machinery ({machinery.length})
        </button>
        <button 
          className={`tab-button ${activeTab === 'aircraft' ? 'active' : ''}`}
          onClick={() => setActiveTab('aircraft')}
        >
          Aircraft ({aircraft.length})
        </button>
        <button 
          className={`tab-button ${activeTab === 'handCrews' ? 'active' : ''}`}
          onClick={() => setActiveTab('handCrews')}
        >
          Hand Crews ({handCrews.length})
        </button>
      </div>

      <div className="config-content">
        <EquipmentList />
      </div>
    </div>
  );
};