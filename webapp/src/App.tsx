import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { MapView } from './components/MapView';
import { AnalysisPanel } from './components/AnalysisPanel';
import { EquipmentConfigPanel } from './components/EquipmentConfigPanel';
import { defaultConfig } from './config/defaultConfig';
import { MachinerySpec, AircraftSpec, HandCrewSpec, VegetationAnalysis, TrackAnalysis } from './types/config';
import { EquipmentApi, CreateEquipmentInput, MachineryApi, AircraftApi, HandCrewApi } from './types/equipmentApi';
import { listEquipment, createEquipment, updateEquipmentItem, deleteEquipment } from './utils/equipmentApi';

/**
 * Root application component for the RFS Fire Break Calculator.
 * Renders a fixed-height header (10% of viewport), responsive Leaflet map,
 * and analysis panel for fire break calculations.
 */
const App: React.FC = () => {
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  const [vegetationAnalysis, setVegetationAnalysis] = useState<VegetationAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [selectedAircraftForPreview, setSelectedAircraftForPreview] = useState<string[]>([]);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  // Raw remote equipment (backend canonical) + loading state
  const [equipment, setEquipment] = useState<EquipmentApi[]>([]);
  const [loadingEquip, setLoadingEquip] = useState(false);
  const [equipError, setEquipError] = useState<string | null>(null);

  // Derived domain-specific structures consumed by analysis (fallback to defaults until remote loads)
  const machinery: MachinerySpec[] = useMemo(() => {
    const items = equipment.filter((e): e is MachineryApi => e.type === 'Machinery');
    if (!items.length) return defaultConfig.machinery;
    return items.map(m => ({
      id: m.id,
      name: m.name,
      type: 'other',
      clearingRate: m.clearingRate || 0,
      costPerHour: m.costPerHour || 0,
      description: m.description || '',
      allowedTerrain: m.allowedTerrain as MachinerySpec['allowedTerrain'],
      allowedVegetation: m.allowedVegetation as MachinerySpec['allowedVegetation'],
      maxSlope: m.maxSlope
    }));
  }, [equipment]);

  const aircraft: AircraftSpec[] = useMemo(() => {
    const items = equipment.filter((e): e is AircraftApi => e.type === 'Aircraft');
    if (!items.length) return defaultConfig.aircraft;
    return items.map(a => ({
      id: a.id,
      name: a.name,
      type: 'other',
      dropLength: a.dropLength || 0,
      speed: 0,
      turnaroundTime: a.turnaroundMinutes || 0,
      costPerHour: a.costPerHour || 0,
      description: a.description || '',
      allowedTerrain: a.allowedTerrain as AircraftSpec['allowedTerrain'],
      allowedVegetation: a.allowedVegetation as AircraftSpec['allowedVegetation']
    }));
  }, [equipment]);

  const handCrews: HandCrewSpec[] = useMemo(() => {
    const items = equipment.filter((e): e is HandCrewApi => e.type === 'HandCrew');
    if (!items.length) return defaultConfig.handCrews;
    return items.map(c => ({
      id: c.id,
      name: c.name,
      crewSize: c.crewSize || 0,
      clearingRatePerPerson: c.clearingRatePerPerson || 0,
      tools: c.equipmentList || [],
      costPerHour: c.costPerHour || 0,
      description: c.description || '',
      allowedTerrain: c.allowedTerrain as HandCrewSpec['allowedTerrain'],
      allowedVegetation: c.allowedVegetation as HandCrewSpec['allowedVegetation']
    }));
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

  // Initial load
  useEffect(() => { loadEquipment(); }, [loadEquipment]);

  // CRUD helpers passed to config panel
  const handleCreate = async (partial: Partial<EquipmentApi> & { type: EquipmentApi['type']; name: string; }) => {
    const payload = {
      type: partial.type,
      name: partial.name,
      description: partial.description || '',
      allowedTerrain: partial.allowedTerrain || ['easy'],
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

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="app-header">
        <h1 className="app-title">RFS Fire Break Calculator</h1>
        <span className="app-subtitle">Geospatial Fire Break & Trail Planning Tool</span>
        <button
          className="config-panel-toggle"
          onClick={() => setIsConfigOpen(v => !v)}
          title="Configure Equipment"
          aria-label="Open equipment configuration panel"
        >
          ⚙️ Config
        </button>
      </header>
      <main className="app-main" id="main-content">
        <div className="map-section">
          <MapView 
            onDistanceChange={setFireBreakDistance}
            onTrackAnalysisChange={setTrackAnalysis}
            onVegetationAnalysisChange={setVegetationAnalysis}
            onAnalyzingChange={setIsAnalyzing}
            selectedAircraftForPreview={selectedAircraftForPreview}
            aircraft={aircraft}
          />
        </div>
        <div className="analysis-section">
          <AnalysisPanel 
            distance={fireBreakDistance}
            trackAnalysis={trackAnalysis}
            vegetationAnalysis={vegetationAnalysis}
            isAnalyzing={isAnalyzing}
            machinery={machinery}
            aircraft={aircraft}
            handCrews={handCrews}
            selectedAircraftForPreview={selectedAircraftForPreview}
            onDropPreviewChange={setSelectedAircraftForPreview}
          />
        </div>
        <EquipmentConfigPanel
          isOpen={isConfigOpen}
          onToggle={() => setIsConfigOpen(v => !v)}
          equipment={equipment}
          loading={loadingEquip}
          error={equipError}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      </main>
    </div>
  );
};

export default App;
