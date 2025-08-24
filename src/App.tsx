import React, { useState } from 'react';
import { MapView } from './components/MapView';
import { AnalysisPanel } from './components/AnalysisPanel';
import { defaultConfig } from './config/defaultConfig';

/**
 * Root application component for the RFS Fire Break Calculator.
 * Renders a fixed-height header (10% of viewport), responsive Leaflet map,
 * and analysis panel for fire break calculations.
 */
const App: React.FC = () => {
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">RFS Fire Break Calculator</h1>
        <span className="app-subtitle">Geospatial Fire Break & Trail Planning Tool</span>
      </header>
      <main className="app-main">
        <MapView onDistanceChange={setFireBreakDistance} />
        <AnalysisPanel 
          distance={fireBreakDistance}
          machinery={defaultConfig.machinery}
          aircraft={defaultConfig.aircraft}
          handCrews={defaultConfig.handCrews}
        />
      </main>
    </div>
  );
};

export default App;
