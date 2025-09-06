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
  
  if (!isOpen) return null;
  
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
  };
  
  const handleEquipmentSubTabChange = (subTab: EquipmentSubTab) => {
    setActiveEquipmentSubTab(subTab);
  };
  
  return (
    <div className="integrated-config-panel">
      <div className="config-header">
        <h3>Configuration</h3>
        <button 
          className="close-button"
          onClick={onToggle}
          aria-label="Close configuration panel"
        >
          ✕
        </button>
      </div>
      
      {/* Main tabs */}
      <div 
        className="config-tabs main-tabs"
        role="tablist"
        aria-label="Configuration Categories"
      >
        <button 
          id="equipment-tab"
          className={`tab-button ${activeTab === 'equipment' ? 'active' : ''}`} 
          onClick={() => handleTabChange('equipment')}
          role="tab"
          aria-selected={activeTab === 'equipment'}
          aria-controls="equipment-panel"
        >
          Equipment
        </button>
        <button 
          id="vegetation-tab"
          className={`tab-button ${activeTab === 'vegetation' ? 'active' : ''}`} 
          onClick={() => handleTabChange('vegetation')}
          role="tab"
          aria-selected={activeTab === 'vegetation'}
          aria-controls="vegetation-panel"
        >
          Vegetation
        </button>
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
              {/* Equipment subtabs */}
              <div 
                className="config-tabs sub-tabs"
                role="tablist"
                aria-label="Equipment Types"
              >
                <button
                  id="machinery-tab"
                  className={`tab-button ${activeEquipmentSubTab === 'machinery' ? 'active' : ''}`}
                  onClick={() => handleEquipmentSubTabChange('machinery')}
                  role="tab"
                  aria-selected={activeEquipmentSubTab === 'machinery'} 
                  aria-controls="machinery-panel"
                >
                  Machinery ({equipment.filter(e => e.type === 'Machinery').length})
                </button>
                <button
                  id="aircraft-tab"
                  className={`tab-button ${activeEquipmentSubTab === 'aircraft' ? 'active' : ''}`}
                  onClick={() => handleEquipmentSubTabChange('aircraft')}
                  role="tab"
                  aria-selected={activeEquipmentSubTab === 'aircraft'} 
                  aria-controls="aircraft-panel"
                >
                  Aircraft ({equipment.filter(e => e.type === 'Aircraft').length})
                </button>
                <button
                  id="handcrew-tab"
                  className={`tab-button ${activeEquipmentSubTab === 'handcrew' ? 'active' : ''}`}
                  onClick={() => handleEquipmentSubTabChange('handcrew')}
                  role="tab"
                  aria-selected={activeEquipmentSubTab === 'handcrew'} 
                  aria-controls="handcrew-panel"
                >
                  Hand Crews ({equipment.filter(e => e.type === 'HandCrew').length})
                </button>
              </div>
              
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
                  initialTab={activeEquipmentSubTab === 'machinery' ? 'Machinery' : 
                            activeEquipmentSubTab === 'aircraft' ? 'Aircraft' : 'HandCrew'}
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
      
      <div className="shared-config-notice">
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
