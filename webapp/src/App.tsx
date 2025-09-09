import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { MapboxMapView } from './components/MapboxMapView';
import { AnalysisPanel } from './components/AnalysisPanel';
import IntegratedConfigPanel from './components/IntegratedConfigPanel';
import { SearchControl } from './components/SearchControl';
import { defaultConfig } from './config/defaultConfig';
import { MachinerySpec, AircraftSpec, HandCrewSpec, VegetationAnalysis, TrackAnalysis } from './types/config';
import { EquipmentApi, CreateEquipmentInput, MachineryApi, AircraftApi, HandCrewApi } from './types/equipmentApi';
import { listEquipment, createEquipment, updateEquipmentItem, deleteEquipment } from './utils/equipmentApi';
import { VegetationFormationMappingApi, CreateVegetationMappingInput } from './types/vegetationMappingApi';
import { 
  listVegetationMappings, 
  createVegetationMapping, 
  updateVegetationMappingItem, 
  deleteVegetationMapping 
} from './utils/vegetationMappingApi';
import { _clearNSWCache } from './utils/nswVegetationService';

// Import site logo/favicon as a module so the bundler rewrites the path
// and the image is available regardless of deployment prefix or asset fingerprinting.
import logo96 from '../favicon-96x96.png';

/**
 * Root application component for the Fire Break Calculator.
 * Renders a fixed-height header (10% of viewport), responsive Mapbox GL JS map,
 * and analysis panel for fire break calculations.
 */
const App: React.FC = () => {
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  const [vegetationAnalysis, setVegetationAnalysis] = useState<VegetationAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [selectedAircraftForPreview, setSelectedAircraftForPreview] = useState<string[]>([]);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [initialLocationSettled, setInitialLocationSettled] = useState<boolean>(false);
  
  // Selected location from the global header search control. Stored here so we can
  // pass it down to the map view which will actually pan/zoom to the point.
  const [searchLocation, setSearchLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);

  // Handler invoked by the SearchControl in the header. We store the selection in
  // state and let MapboxMapView react to it and perform the map interaction.
  const handleSearchLocationSelected = useCallback((location: { lat: number; lng: number; label: string }) => {
    setSearchLocation(location);
  }, []);
  
  // Raw remote equipment (backend canonical) + loading state
  const [equipment, setEquipment] = useState<EquipmentApi[]>([]);
  const [loadingEquip, setLoadingEquip] = useState(false);
  const [equipError, setEquipError] = useState<string | null>(null);
  
  // Vegetation formation mappings + loading state
  const [vegetationMappings, setVegetationMappings] = useState<VegetationFormationMappingApi[]>([]);
  const [loadingVegetationMappings, setLoadingVegetationMappings] = useState(false);
  const [vegetationMappingError, setVegetationMappingError] = useState<string | null>(null);

  // Helper function to safely parse terrain/vegetation arrays from API data
  const safeParseAllowedValues = <T extends string>(
    value: any, 
    validValues: T[], 
    fieldName: string, 
    machineName: string
  ): T[] => {
    // Handle string case (CSV parsing failure in API)
    if (typeof value === 'string') {
      console.warn(`API returned CSV string for ${fieldName} on ${machineName}, parsing locally:`, value);
      const parsed = value.split(',').map(v => v.trim()).filter(Boolean) as T[];
      return parsed.filter(v => validValues.includes(v));
    }
    
    // Handle array case (normal)
    if (Array.isArray(value)) {
      const validated = value.filter(v => validValues.includes(v as T));
      if (validated.length === 0) {
        console.warn(`${machineName} has empty/invalid ${fieldName} array, using fallback values`);
        // Provide sensible fallbacks for machines with no valid values
        if (fieldName === 'allowedTerrain') {
          return ['flat', 'medium'] as T[];
        } else if (fieldName === 'allowedVegetation') {
          return ['grassland'] as T[];
        }
      }
      return validated;
    }
    
    // Handle null/undefined/other (fallback)
    console.warn(`${machineName} has invalid ${fieldName} format:`, typeof value, value);
    if (fieldName === 'allowedTerrain') {
      return ['flat', 'medium'] as T[];
    } else if (fieldName === 'allowedVegetation') {
      return ['grassland'] as T[];
    }
    return [] as T[];
  };

  // Derived domain-specific structures consumed by analysis (fallback to defaults until remote loads)
  const machinery: MachinerySpec[] = useMemo(() => {
    console.log('🔧 Processing machinery from equipment data:', {
      totalEquipment: equipment.length,
      machineryItems: equipment.filter((e): e is MachineryApi => e.type === 'Machinery').length
    });

    const items = equipment.filter((e): e is MachineryApi => e.type === 'Machinery');
    if (!items.length) {
      console.log('⚠️ No machinery items found, using default config');
      return defaultConfig.machinery;
    }
    
    return items.map(m => {
      console.log(`🚜 Processing machinery: ${m.name}`, {
        id: m.id,
        rawAllowedTerrain: m.allowedTerrain,
        rawAllowedVegetation: m.allowedVegetation,
        clearingRate: m.clearingRate
      });

      const allowedTerrain = safeParseAllowedValues(
        m.allowedTerrain, 
        ['flat', 'medium', 'steep', 'very_steep'],
        'allowedTerrain',
        m.name
      );
      
      const allowedVegetation = safeParseAllowedValues(
        m.allowedVegetation,
        ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
        'allowedVegetation', 
        m.name
      );
      
      // If the equipment record doesn't include a numeric maxSlope, derive one
      // from the allowedTerrain tags so analysis keeps working without CSV.
      const deriveMaxSlopeFromTerrain = (terrain: string[] | undefined): number | undefined => {
        if (!terrain || !terrain.length) return undefined;
        // Map terrain levels to representative max slope values
        // flat -> 9, medium -> 24, steep -> 44, very_steep -> 60
        if (terrain.includes('very_steep')) return 60;
        if (terrain.includes('steep')) return 44;
        if (terrain.includes('medium')) return 24;
        if (terrain.includes('flat')) return 9;
        return undefined;
      };

      const processed = {
        id: m.id,
        name: m.name,
        type: 'other' as const,
        clearingRate: m.clearingRate || 0,
        costPerHour: m.costPerHour || 0,
        description: m.description || '',
        allowedTerrain,
        allowedVegetation,
        maxSlope: m.maxSlope ?? deriveMaxSlopeFromTerrain(allowedTerrain)
      };

      console.log(`   ✅ Processed machinery result:`, processed);
      return processed;
    });
  }, [equipment]);

  const aircraft: AircraftSpec[] = useMemo(() => {
    console.log('✈️ Processing aircraft from equipment data:', {
      totalEquipment: equipment.length,
      aircraftItems: equipment.filter((e): e is AircraftApi => e.type === 'Aircraft').length
    });

    const items = equipment.filter((e): e is AircraftApi => e.type === 'Aircraft');
    if (!items.length) {
      console.log('⚠️ No aircraft items found, using default config');
      return defaultConfig.aircraft;
    }
    
    return items.map(a => {
      console.log(`✈️ Processing aircraft: ${a.name}`, {
        id: a.id,
        rawAllowedTerrain: a.allowedTerrain,
        rawAllowedVegetation: a.allowedVegetation,
        dropLength: a.dropLength,
        turnaroundMinutes: a.turnaroundMinutes
      });

      const allowedTerrain = safeParseAllowedValues(
        a.allowedTerrain, 
        ['flat', 'medium', 'steep', 'very_steep'],
        'allowedTerrain',
        a.name
      );
      
      const allowedVegetation = safeParseAllowedValues(
        a.allowedVegetation,
        ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
        'allowedVegetation', 
        a.name
      );
      
      const processed = {
        id: a.id,
        name: a.name,
        type: 'other' as const,
        dropLength: a.dropLength || 0,
        speed: a.speed || 0,
        turnaroundMinutes: a.turnaroundMinutes || 0,
        costPerHour: a.costPerHour || 0,
        description: a.description || '',
        allowedTerrain,
        allowedVegetation
      };

      console.log(`   ✅ Processed aircraft result:`, processed);
      return processed;
    });
  }, [equipment]);

  const handCrews: HandCrewSpec[] = useMemo(() => {
    console.log('👨‍🚒 Processing hand crews from equipment data:', {
      totalEquipment: equipment.length,
      handCrewItems: equipment.filter((e): e is HandCrewApi => e.type === 'HandCrew').length
    });

    const items = equipment.filter((e): e is HandCrewApi => e.type === 'HandCrew');
    if (!items.length) {
      console.log('⚠️ No hand crew items found, using default config');
      return defaultConfig.handCrews;
    }
    
    return items.map(c => {
      console.log(`👨‍🚒 Processing hand crew: ${c.name}`, {
        id: c.id,
        rawAllowedTerrain: c.allowedTerrain,
        rawAllowedVegetation: c.allowedVegetation,
        crewSize: c.crewSize,
        clearingRatePerPerson: c.clearingRatePerPerson
      });

      const allowedTerrain = safeParseAllowedValues(
        c.allowedTerrain, 
        ['flat', 'medium', 'steep', 'very_steep'],
        'allowedTerrain',
        c.name
      );
      
      const allowedVegetation = safeParseAllowedValues(
        c.allowedVegetation,
        ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
        'allowedVegetation', 
        c.name
      );
      
      const processed = {
        id: c.id,
        name: c.name,
        crewSize: c.crewSize || 0,
        clearingRatePerPerson: c.clearingRatePerPerson || 0,
        tools: c.equipmentList || [],
        costPerHour: c.costPerHour || 0,
        description: c.description || '',
        allowedTerrain,
        allowedVegetation
      };

      console.log(`   ✅ Processed hand crew result:`, processed);
      return processed;
    });
  }, [equipment]);

  // Shared loader so we can refresh after CRUD ops to pull canonical server state (e.g. version, defaults)
  const loadEquipment = useCallback(async () => {
    setLoadingEquip(true);
    setEquipError(null);
    try {
      const data = await listEquipment();
      setEquipment(data);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load equipment';
      setEquipError(errorMessage);
    } finally {
      setLoadingEquip(false);
    }
  }, []);

  // Vegetation mappings loader
  const loadVegetationMappings = useCallback(async () => {
    setLoadingVegetationMappings(true);
    setVegetationMappingError(null);
    try {
  // Clear the NSW vegetation cache to force using new mappings
  try { _clearNSWCache(); } catch (err) { console.warn('Failed to clear NSW cache', err); }
      
      const data = await listVegetationMappings();
      setVegetationMappings(data);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load vegetation mappings';
      setVegetationMappingError(errorMessage);
    } finally {
      setLoadingVegetationMappings(false);
    }
  }, []);

  // Initial load
  useEffect(() => { 
    loadEquipment(); 
    loadVegetationMappings();
  }, [loadEquipment, loadVegetationMappings]);
  
  // Create default vegetation mappings if none exist
  useEffect(() => {
    if (
      !loadingVegetationMappings && 
      vegetationMappings.length === 0 && 
      !vegetationMappingError
    ) {
      const createDefaultMappings = async () => {
        console.log('Checking for existing vegetation mappings');
        
        // First, try to load any existing mappings
        try {
          const existingMappings = await listVegetationMappings();
          
          // If mappings were found after all, update state and don't create defaults
          if (existingMappings && existingMappings.length > 0) {
            console.log(`Found ${existingMappings.length} existing vegetation mappings, skipping default creation`);
            setVegetationMappings(existingMappings);
            return;
          }
          
          console.log('No existing mappings found, creating defaults');
          
          // Common NSW vegetation formations mapped to our 4 categories
          const defaultMappings = [
            // Forests
            { formationName: 'Rainforest', vegetationType: 'heavyforest', confidence: 0.95, active: true },
            { formationName: 'Wet Sclerophyll Forest', vegetationType: 'heavyforest', confidence: 0.95, active: true },
            { formationName: 'Dry Sclerophyll Forest', vegetationType: 'heavyforest', confidence: 0.9, active: true },
            { formationName: 'Forested Wetlands', vegetationType: 'heavyforest', confidence: 0.9, active: true },
            
            // Woodlands
            { formationName: 'Grassy Woodland', vegetationType: 'heavyforest', confidence: 0.85, active: true },
            { formationName: 'Semi-arid Woodland', vegetationType: 'mediumscrub', confidence: 0.8, active: true },
            
            // Shrublands
            { formationName: 'Heathland', vegetationType: 'mediumscrub', confidence: 0.9, active: true },
            { formationName: 'Alpine Complex', vegetationType: 'mediumscrub', confidence: 0.8, active: true },
            { formationName: 'Arid Shrubland', vegetationType: 'mediumscrub', confidence: 0.9, active: true },
            
            // Grasslands
            { formationName: 'Grassland', vegetationType: 'grassland', confidence: 0.95, active: true },
            { formationName: 'Freshwater Wetland', vegetationType: 'grassland', confidence: 0.85, active: true },
            
            // Light vegetation
            { formationName: 'Saline Wetland', vegetationType: 'lightshrub', confidence: 0.85, active: true },
            { formationName: 'Saltmarsh', vegetationType: 'lightshrub', confidence: 0.9, active: true }
          ];
          
          // Create default mappings, handling conflicts gracefully
          for (const mapping of defaultMappings) {
            try {
              await createVegetationMapping(mapping as CreateVegetationMappingInput);
              console.log(`Created mapping for: ${mapping.formationName}`);
            } catch (err: any) {
              // Skip over already existing mappings
              if (err.message?.includes('already exists')) {
                console.log(`Mapping for ${mapping.formationName} already exists, skipping`);
              } else {
                console.error(`Error creating mapping for ${mapping.formationName}:`, err);
              }
            }
          }
          
          // Reload to get all mappings including any that were created
          await loadVegetationMappings();
        } catch (error) {
          console.error('Failed to create default vegetation mappings:', error);
        }
      };
      
      createDefaultMappings();
    }
  }, [loadingVegetationMappings, vegetationMappings, vegetationMappingError, loadVegetationMappings]);

  // CRUD helpers passed to config panel
  const handleCreate = async (partial: Partial<EquipmentApi> & { type: EquipmentApi['type']; name: string; }) => {
    const payload = {
      type: partial.type,
      name: partial.name,
      description: partial.description || '',
      allowedTerrain: partial.allowedTerrain || ['flat'],
      allowedVegetation: partial.allowedVegetation || ['grassland'],
      active: true,
      costPerHour: partial.costPerHour,
      // Add type-specific properties
      ...(partial.type === 'Machinery' && 'clearingRate' in partial ? { clearingRate: partial.clearingRate, maxSlope: partial.maxSlope } : {}),
      ...(partial.type === 'Aircraft' && 'dropLength' in partial ? { dropLength: partial.dropLength, turnaroundMinutes: partial.turnaroundMinutes } : {}),
      ...(partial.type === 'HandCrew' && 'crewSize' in partial ? { crewSize: partial.crewSize, clearingRatePerPerson: partial.clearingRatePerPerson, equipmentList: partial.equipmentList } : {})
    } as CreateEquipmentInput;
    await createEquipment(payload);
    // Always reload full list to capture server-assigned fields & maintain consistency
    await loadEquipment();
  };

  const handleUpdate = async (item: EquipmentApi) => {
    await updateEquipmentItem(item);
    await loadEquipment();
  };

  const handleDelete = async (item: EquipmentApi) => {
    await deleteEquipment(item.type, item.id);
    await loadEquipment();
  };
  
  // CRUD helpers for vegetation mappings
  const handleCreateVegetationMapping = async (mapping: CreateVegetationMappingInput) => {
    await createVegetationMapping(mapping);
    await loadVegetationMappings();
  };

  const handleUpdateVegetationMapping = async (mapping: VegetationFormationMappingApi) => {
    await updateVegetationMappingItem(mapping);
    await loadVegetationMappings();
  };

  const handleDeleteVegetationMapping = async (mapping: VegetationFormationMappingApi) => {
    await deleteVegetationMapping(mapping.id);
    await loadVegetationMappings();
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <img src={logo96} alt="App logo" className="app-logo" />
          <div className="header-titles">
            <h1 className="app-title">Fire Break Calculator</h1>
            <span className="app-subtitle">Easy Geospatial Fire Break & Trail Planning Tool</span>
          </div>
        </div>
        <div className="header-center">
          <SearchControl 
            onLocationSelected={handleSearchLocationSelected}
            userLocation={userLocation}
            className="header-search-control"
          />
        </div>
        <div className="header-right">
          <button
            className="config-panel-toggle"
            onClick={() => setIsConfigOpen(v => !v)}
            title="Open Configuration Panel"
            aria-label="Open configuration panel for equipment and vegetation mappings"
          >
            <span className="config-icon" aria-hidden>⚙️</span>
            <span className="config-label">Configuration</span>
          </button>
        </div>
      </header>
      <main className="app-main" id="main-content">
        <div className="map-section">
          <MapboxMapView 
            onDistanceChange={setFireBreakDistance}
            onTrackAnalysisChange={setTrackAnalysis}
            onVegetationAnalysisChange={setVegetationAnalysis}
            onAnalyzingChange={setIsAnalyzing}
            selectedAircraftForPreview={selectedAircraftForPreview}
            aircraft={aircraft}
            onUserLocationChange={setUserLocation}
            onInitialLocationSettled={setInitialLocationSettled}
            selectedSearchLocation={searchLocation}
          />
        </div>
        <div className="analysis-section">
          <AnalysisPanel 
            distance={fireBreakDistance}
            trackAnalysis={trackAnalysis}
            vegetationAnalysis={vegetationAnalysis}
            isAnalyzing={isAnalyzing}
            // Only allow heavy backend analysis after the map has completed initial
            // pan/zoom to the user's location (or attempted fallback).
            mapSettled={initialLocationSettled}
            machinery={machinery}
            aircraft={aircraft}
            handCrews={handCrews}
            selectedAircraftForPreview={selectedAircraftForPreview}
            onDropPreviewChange={setSelectedAircraftForPreview}
          />
        </div>
        <IntegratedConfigPanel 
          isOpen={isConfigOpen}
          onToggle={() => setIsConfigOpen(v => !v)}
          
          // Equipment props
          equipment={equipment}
          loadingEquipment={loadingEquip}
          equipmentError={equipError}
          onCreateEquipment={handleCreate}
          onUpdateEquipment={handleUpdate}
          onDeleteEquipment={handleDelete}
          
          // Vegetation mapping props
          vegetationMappings={vegetationMappings}
          loadingVegetationMappings={loadingVegetationMappings}
          vegetationMappingError={vegetationMappingError}
          onCreateVegetationMapping={handleCreateVegetationMapping}
          onUpdateVegetationMapping={handleUpdateVegetationMapping}
          onDeleteVegetationMapping={handleDeleteVegetationMapping}
        />
      </main>
    </div>
  );
};

export default App;
