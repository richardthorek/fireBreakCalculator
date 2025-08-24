import React from 'react';
import { MapView } from './components/MapView';

/**
 * Root application component. Renders a fixed-height header (10% of viewport)
 * and a responsive Leaflet map filling the remaining space.
 */
const App: React.FC = () => {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">RFS Geospatial Viewer</h1>
        <span className="app-subtitle">Leaflet + Mapbox (React / Vite)</span>
      </header>
      <main className="app-main">
        <MapView />
      </main>
    </div>
  );
};

export default App;
