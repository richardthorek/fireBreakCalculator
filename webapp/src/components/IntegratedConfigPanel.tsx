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
          {/* When on equipment show inline sub-tabs + add button here; vegetation has own internal controls */}
          {activeTab === 'equipment' && (
            <div className="equip-inline-tabs" aria-label="Equipment type sub tabs">
              <button
                id="machinery-tab"
                className={`mini-tab ${activeEquipmentSubTab === 'machinery' ? 'active' : ''}`}
                onClick={() => handleEquipmentSubTabChange('machinery')}
                title="Machinery"
              >Mach ({equipment.filter(e => e.type === 'Machinery').length})</button>
              <button
                id="aircraft-tab"
                className={`mini-tab ${activeEquipmentSubTab === 'aircraft' ? 'active' : ''}`}
                onClick={() => handleEquipmentSubTabChange('aircraft')}
                title="Aircraft"
              >Air ({equipment.filter(e => e.type === 'Aircraft').length})</button>
              <button
                id="handcrew-tab"
                className={`mini-tab ${activeEquipmentSubTab === 'handcrew' ? 'active' : ''}`}
                onClick={() => handleEquipmentSubTabChange('handcrew')}
                title="Hand Crews"
              >Crew ({equipment.filter(e => e.type === 'HandCrew').length})</button>
              <button 
                className="add-equipment-btn mini" 
                onClick={handleAddEquipment}
                aria-label={`Add ${activeEquipmentSubTab}`}
              >＋</button>
            </div>
          )}
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
            <div id="equipment-panels-container">
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
              />
            </div>
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
