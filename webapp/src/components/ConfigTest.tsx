import React from 'react';
import IntegratedConfigPanel from './IntegratedConfigPanel';
import { EquipmentApi } from '../types/equipmentApi';
import { VegetationFormationMappingApi, CreateVegetationMappingInput } from '../types/vegetationMappingApi';

const ConfigTest: React.FC = () => {
  // Dummy data
  const equipment: EquipmentApi[] = [];
  const vegetationMappings: VegetationFormationMappingApi[] = [];

  return (
    <div>
      <h1>Configuration Panel Test</h1>
      <IntegratedConfigPanel 
        isOpen={true}
        onToggle={() => console.log('Toggle')}
        equipment={equipment}
        loadingEquipment={false}
        equipmentError={null}
        onCreateEquipment={(equipment: Partial<EquipmentApi> & { type: EquipmentApi['type']; name: string; }) => Promise.resolve()}
        onUpdateEquipment={(equipment: EquipmentApi) => Promise.resolve()}
        onDeleteEquipment={(equipment: EquipmentApi) => Promise.resolve()}
        vegetationMappings={vegetationMappings}
        loadingVegetationMappings={false}
        vegetationMappingError={null}
        onCreateVegetationMapping={(mapping: CreateVegetationMappingInput) => Promise.resolve()}
        onUpdateVegetationMapping={(mapping: VegetationFormationMappingApi) => Promise.resolve()}
        onDeleteVegetationMapping={(mapping: VegetationFormationMappingApi) => Promise.resolve()}
      />
    </div>
  );
};

export default ConfigTest;
