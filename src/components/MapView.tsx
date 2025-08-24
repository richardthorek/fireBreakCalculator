import React, { useEffect, useRef, useState } from 'react';
import L, { Map as LeafletMap } from 'leaflet';

// Default map center (latitude, longitude) & zoom. Centered on New South Wales, Australia.
// This center (~ -32, 147) and zoom ~6 gives a state-level view of NSW.
const DEFAULT_CENTER: L.LatLngExpression = [-32.0, 147.0]; // NSW, Australia
const DEFAULT_ZOOM = 6;

/**
 * Encapsulates Leaflet map setup. Uses Mapbox tiles with token from Vite env.
 * Provides graceful fallback messaging if token is missing.
 */
export const MapView: React.FC = () => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return; // prevent re-init

    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
    if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
      setError('Mapbox access token not configured. Set VITE_MAPBOX_ACCESS_TOKEN in .env');
      return;
    }

    // Initialize the map
    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    // Mapbox raster tiles URL template
    const tileUrl = `https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=${token}`;

    L.tileLayer(tileUrl, {
      id: 'mapbox/streets-v12',
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 20,
      attribution:
        '© <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors | ' +
        '<a href="https://www.mapbox.com/" target="_blank" rel="noreferrer">Mapbox</a>',
    }).addTo(map);

    // Optional: Add a marker to show the center
    L.marker(DEFAULT_CENTER).addTo(map).bindPopup('Default Center').openPopup();

    // Cleanup on unmount
    return () => {
      map.remove();
    };
  }, []);

  return (
    <div className="map-wrapper">
      {error && <div className="map-error">{error}</div>}
      <div ref={mapContainerRef} className="map-container" aria-label="Map display" />
    </div>
  );
};
