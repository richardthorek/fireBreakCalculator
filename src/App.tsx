import React, { useState } from 'react';
import { MapView } from './components/MapView';
import { AnalysisPanel } from './components/AnalysisPanel';
import { EquipmentConfigPanel } from './components/EquipmentConfigPanel';
import { defaultConfig } from './config/defaultConfig';
import { MachinerySpec, AircraftSpec, HandCrewSpec, TrackAnalysis, VegetationAnalysis } from './types/config';

/**
 * Root application component for the RFS Fire Break Calculator.
 * Renders a fixed-height header (10% of viewport), responsive Leaflet map,
 * and analysis panel for fire break calculations.
 */
const App: React.FC = () => {
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [selectedAircraftForPreview, setSelectedAircraftForPreview] = useState<string[]>([]);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  const [vegetationAnalysis, setVegetationAnalysis] = useState<VegetationAnalysis | null>(null);
  
  // State for configurable equipment
  const [machinery, setMachinery] = useState<MachinerySpec[]>(defaultConfig.machinery);
  const [aircraft, setAircraft] = useState<AircraftSpec[]>(defaultConfig.aircraft);
  const [handCrews, setHandCrews] = useState<HandCrewSpec[]>(defaultConfig.handCrews);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">RFS Fire Break Calculator</h1>
        <span className="app-subtitle">Geospatial Fire Break & Trail Planning Tool</span>
      </header>
      <main className="app-main">
        <div className="map-section">
          <MapView 
            
            onDistanceChange={setFireBreakDistance} 
            onTrackAnalysisChange={setTrackAnalysis}
            onVegetationAnalysisChange={setVegetationAnalysis}
            selectedAircraftForPreview={selectedAircraftForPreview}
            aircraft={aircraft}
          />
        </div>
        <div className="analysis-section">
          <AnalysisPanel 
            distance={fireBreakDistance}
            trackAnalysis={trackAnalysis}
            vegetationAnalysis={vegetationAnalysis}
            machinery={machinery}
            aircraft={aircraft}
            handCrews={handCrews}
            onDropPreviewChange={setSelectedAircraftForPreview}
          />
        </div>
        <EquipmentConfigPanel
          machinery={machinery}
          aircraft={aircraft}
          handCrews={handCrews}
          onUpdateMachinery={setMachinery}
          onUpdateAircraft={setAircraft}
          onUpdateHandCrews={setHandCrews}
        />
      </main>
    </div>
  );
};

export default App;
