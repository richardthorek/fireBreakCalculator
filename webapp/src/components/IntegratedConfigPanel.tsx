/**
 * Integrated Configuration Panel component for managing equipment and vegetation mapping settings.
 * Provides a unified interface to access both equipment and vegetation mapping panels.
 */

import React, { useState } from 'react';
import { EquipmentConfigPanel } from './EquipmentConfigPanel';
import VegetationConfigPanel from './VegetationConfigPanel';
import { EquipmentApi } from '../types/equipmentApi';
import { VegetationFormationMappingApi, CreateVegetationMappingInput } from '../types/vegetationMappingApi';

interface IntegratedConfigPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  
  // Equipment props
  equipment: EquipmentApi[];
  loadingEquipment: boolean;
  equipmentError: string | null;
  onCreateEquipment: (partial: Partial<EquipmentApi> & { type: EquipmentApi['type']; name: string; }) => Promise<void>;
  onUpdateEquipment: (item: EquipmentApi) => Promise<void>;
  onDeleteEquipment: (item: EquipmentApi) => Promise<void>;
  
  // Vegetation mapping props
  vegetationMappings: VegetationFormationMappingApi[];
  loadingVegetationMappings: boolean;
  vegetationMappingError: string | null;
  onCreateVegetationMapping: (mapping: CreateVegetationMappingInput) => Promise<void>;
  onUpdateVegetationMapping: (mapping: VegetationFormationMappingApi) => Promise<void>;
  onDeleteVegetationMapping: (mapping: VegetationFormationMappingApi) => Promise<void>;
}

type TabType = 'equipment' | 'vegetation';
type EquipmentSubTab = 'machinery' | 'aircraft' | 'handcrew';

const IntegratedConfigPanel: React.FC<IntegratedConfigPanelProps> = ({
  isOpen,
  onToggle,
  
  // Equipment props
  equipment,
  loadingEquipment,
  equipmentError,
  onCreateEquipment,
  onUpdateEquipment,
  onDeleteEquipment,
  
  // Vegetation mapping props
  vegetationMappings,
  loadingVegetationMappings,
  vegetationMappingError,
  onCreateVegetationMapping,
  onUpdateVegetationMapping,
  onDeleteVegetationMapping
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('equipment');
  const [activeEquipmentSubTab, setActiveEquipmentSubTab] = useState<EquipmentSubTab>('machinery');
  const [equipmentFilter, setEquipmentFilter] = useState('');
  // State to trigger equipment add mode
  const [triggerEquipmentAdd, setTriggerEquipmentAdd] = useState(0);
  
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
  };

  const handleEquipmentSubTabChange = (subTab: EquipmentSubTab) => {
    setActiveEquipmentSubTab(subTab);
  };

  const handleAddEquipment = () => {
    // Trigger add mode in the equipment panel
    setTriggerEquipmentAdd(prev => prev + 1);
  };

  if (!isOpen) return null;
  
  return (
    <div className="integrated-config-panel compact">
      {/* Unified ultra-compact header */}
      <div className="config-header compact-header" role="banner">
        <div className="header-left">
          <h3 className="panel-title" aria-label="Configuration panel">Config</h3>
          <div className="main-tabs" aria-label="Configuration Categories">
            <button 
              id="equipment-tab"
              className={`tab-button ${activeTab === 'equipment' ? 'active' : ''}`} 
              onClick={() => handleTabChange('equipment')}
            >Equipment</button>
            <button 
              id="vegetation-tab"
              className={`tab-button ${activeTab === 'vegetation' ? 'active' : ''}`} 
              onClick={() => handleTabChange('vegetation')}
            >Vegetation</button>
          </div>
        </div>
        <div className="header-right">
          <button 
            className="close-button"
            onClick={onToggle}
            aria-label="Close configuration panel"
          >✕</button>
        </div>
      </div>
      
      <div className="config-content">
        <div 
          id="equipment-panel"
          className="equipment-section"
          role="tabpanel"
          aria-labelledby="equipment-tab"
          hidden={activeTab !== 'equipment'}
        >
          {activeTab === 'equipment' && (
            <>
              {/* 20% Guidance area for equipment */}
              <div className="panel-guidance">
                <h4>Equipment Configuration</h4>
                <div className="panel-guidance-content">
                  <div className="panel-guidance-left">
                    <div className="equipment-type-tabs">
                      <button
                        className={`equipment-type-tab ${activeEquipmentSubTab === 'machinery' ? 'active' : ''}`}
                        onClick={() => handleEquipmentSubTabChange('machinery')}
                        title="Machinery"
                      >Machinery ({equipment.filter(e => e.type === 'Machinery').length})</button>
                      <button
                        className={`equipment-type-tab ${activeEquipmentSubTab === 'aircraft' ? 'active' : ''}`}
                        onClick={() => handleEquipmentSubTabChange('aircraft')}
                        title="Aircraft"
                      >Aircraft ({equipment.filter(e => e.type === 'Aircraft').length})</button>
                      <button
                        className={`equipment-type-tab ${activeEquipmentSubTab === 'handcrew' ? 'active' : ''}`}
                        onClick={() => handleEquipmentSubTabChange('handcrew')}
                        title="Hand Crews"
                      >Hand Crews ({equipment.filter(e => e.type === 'HandCrew').length})</button>
                    </div>
                  </div>
                  <div className="panel-guidance-right">
                    <input 
                      type="text" 
                      placeholder="Filter equipment..." 
                      className="equipment-filter"
                      value={equipmentFilter}
                      onChange={(e) => setEquipmentFilter(e.target.value)}
                    />
                    <button 
                      className="add-equipment-btn" 
                      onClick={handleAddEquipment}
                      aria-label={`Add ${activeEquipmentSubTab}`}
                    >+ Add</button>
                  </div>
                </div>
              </div>
              
              {/* 70% Content area */}
              <div className="panel-content">
                <EquipmentConfigPanel
                  equipment={equipment}
                  loading={loadingEquipment}
                  error={equipmentError}
                  onCreate={onCreateEquipment}
                  onUpdate={onUpdateEquipment}
                  onDelete={onDeleteEquipment}
                  isOpen={true}
                  onToggle={onToggle}
                  showOwnTabs={false}
                  triggerAdd={triggerEquipmentAdd}
                  initialTab={activeEquipmentSubTab === 'machinery' ? 'Machinery' : 
                            activeEquipmentSubTab === 'aircraft' ? 'Aircraft' : 'HandCrew'}
                  showDescription={false}
                  showGuide={false}
                  filter={equipmentFilter}
                  compactMode={true}
                />
              </div>
            </>
          )}
        </div>
        
        <div 
          id="vegetation-panel"
          className="vegetation-section"
          role="tabpanel"
          aria-labelledby="vegetation-tab"
          hidden={activeTab !== 'vegetation'}
        >
          {activeTab === 'vegetation' && (
            <>
              {/* 20% Guidance area for vegetation */}
              <div className="panel-guidance">
                <h4>Vegetation Formation Mappings</h4>
                <div className="panel-guidance-content">
                  <div className="panel-guidance-left">
                    <span style={{fontSize: '0.75rem', color: '#94a3b8'}}>
                      Configure how NSW vegetation data maps to equipment compatibility categories
                    </span>
                  </div>
                  <div className="panel-guidance-right">
                    <div className="vegetation-guidance-controls-inline">
                      {/* These controls will be populated by the VegetationConfigPanel */}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 70% Content area */}
              <div className="panel-content">
                <VegetationConfigPanel
                  mappings={vegetationMappings}
                  loading={loadingVegetationMappings}
                  error={vegetationMappingError}
                  onCreate={onCreateVegetationMapping}
                  onUpdate={onUpdateVegetationMapping}
                  onDelete={onDeleteVegetationMapping}
                  isOpen={true}
                  onToggle={onToggle}
                />
              </div>
            </>
          )}
        </div>
      </div>
      
  <div className="shared-config-notice compact">
        <div className="notice-icon">⚠️</div>
        <div className="notice-content">
          <strong>Important:</strong> All configuration settings are shared among all users. 
          Any changes you make will be visible to everyone using the system.
        </div>
      </div>
    </div>
  );
};

export default IntegratedConfigPanel;
