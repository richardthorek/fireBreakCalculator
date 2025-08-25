import React, { useEffect, useRef, useState } from 'react';
import L, { Map as LeafletMap, LatLng } from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { AircraftSpec } from '../types/config';

// Default map center (latitude, longitude) & zoom. Centered on New South Wales, Australia.
// This center (~ -32, 147) and zoom ~6 gives a state-level view of NSW.
const DEFAULT_CENTER: L.LatLngExpression = [-32.0, 147.0]; // NSW, Australia
const DEFAULT_ZOOM = 6;

/**
 * Encapsulates Leaflet map setup with drawing tools for fire break planning.
 * Uses Mapbox tiles with token from Vite env. Provides graceful fallback
 * messaging if token is missing. Includes line drawing capability for
 * fire break route planning and distance calculation.
 */

interface MapViewProps {
  onDistanceChange: (distance: number | null) => void;
  selectedAircraftForPreview: string[];
  aircraft: AircraftSpec[];
}

export const MapView: React.FC<MapViewProps> = ({ onDistanceChange, selectedAircraftForPreview, aircraft }) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const dropMarkersRef = useRef<L.LayerGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [currentPolyline, setCurrentPolyline] = useState<L.Polyline | null>(null);

  // Function to create drop markers along a polyline
  const createDropMarkers = (polyline: L.Polyline, aircraftId: string, dropInterval: number) => {
    if (!mapRef.current || !dropMarkersRef.current) return;

    const latlngs = polyline.getLatLngs() as LatLng[];
    
    if (latlngs.length < 2) return;

    const markerPositions: LatLng[] = [];
    let totalDistanceTraversed = 0;
    let nextDropDistance = dropInterval; // First drop at dropInterval meters

    // Walk along the polyline
    for (let i = 0; i < latlngs.length - 1; i++) {
      const start = latlngs[i];
      const end = latlngs[i + 1];
      const segmentDistance = start.distanceTo(end);
      const segmentStart = totalDistanceTraversed;
      const segmentEnd = totalDistanceTraversed + segmentDistance;

      // Check if any drop points fall within this segment
      while (nextDropDistance <= segmentEnd) {
        const distanceIntoSegment = nextDropDistance - segmentStart;
        const ratio = distanceIntoSegment / segmentDistance;
        
        const lat = start.lat + (end.lat - start.lat) * ratio;
        const lng = start.lng + (end.lng - start.lng) * ratio;
        markerPositions.push(new L.LatLng(lat, lng));
        
        nextDropDistance += dropInterval;
      }
      
      totalDistanceTraversed = segmentEnd;
    }

    // Create markers with different colors for different aircraft
    const colors = ['red', 'blue', 'green', 'orange', 'purple'];
    const aircraftIndex = selectedAircraftForPreview.indexOf(aircraftId);
    const color = colors[aircraftIndex % colors.length];
    
    const aircraftSpec = aircraft.find(a => a.id === aircraftId);
    const aircraftName = aircraftSpec?.name || aircraftId;

    markerPositions.forEach((pos, index) => {
      const marker = L.circleMarker(pos, {
        color: color,
        fillColor: color,
        fillOpacity: 0.7,
        radius: 6,
        weight: 2
      }).bindTooltip(`${aircraftName} - Drop ${index + 1}`, {
        permanent: false,
        direction: 'top'
      });
      
      dropMarkersRef.current!.addLayer(marker);
    });
  };

  // Function to update drop markers based on selected aircraft
  const updateDropMarkers = () => {
    if (!dropMarkersRef.current || !currentPolyline) return;

    // Clear existing markers
    dropMarkersRef.current.clearLayers();

    // Add markers for each selected aircraft
    selectedAircraftForPreview.forEach(aircraftId => {
      const aircraftSpec = aircraft.find(a => a.id === aircraftId);
      if (aircraftSpec) {
        createDropMarkers(currentPolyline, aircraftId, aircraftSpec.dropLength);
      }
    });
  };

  // Effect to update drop markers when aircraft selection changes
  useEffect(() => {
    updateDropMarkers();
  }, [selectedAircraftForPreview, aircraft, currentPolyline]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return; // prevent re-init

    // Initialize the map
    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;

    // Try Mapbox first, fallback to OpenStreetMap
    const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
    
    if (token && token !== 'YOUR_MAPBOX_TOKEN_HERE') {
      // Use Mapbox tiles if token is available
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
    } else {
      // Fallback to OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
      }).addTo(map);
    }

    // Optional: Add a marker to show the center
    L.marker(DEFAULT_CENTER).addTo(map).bindPopup('Default Center - NSW, Australia').openPopup();

    // Initialize drawing tools for fire break planning
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    // Initialize drop markers layer
    const dropMarkers = new L.LayerGroup();
    map.addLayer(dropMarkers);
    dropMarkersRef.current = dropMarkers;

    // Configure drawing controls - only allow polylines for fire breaks
    const drawControl = new L.Control.Draw({
      position: 'topright',
      draw: {
        polyline: {
          shapeOptions: {
            color: '#ff6b35', // Fire break color
            weight: 4,
            opacity: 0.8
          },
          allowIntersection: false,
          drawError: {
            color: '#e1004a',
            message: '<strong>Error:</strong> Fire break lines cannot intersect!'
          },
          guidelineDistance: 20,
          maxGuideLineLength: 4000,
          showLength: true,
          metric: true
        },
        polygon: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false
      },
      edit: {
        featureGroup: drawnItems,
        remove: true
      }
    });
    map.addControl(drawControl);

    // Handle drawing events for fire break calculation
    map.on(L.Draw.Event.CREATED, (event: any) => {
      const layer = event.layer;
      drawnItems.addLayer(layer);
      
      // Calculate distance for fire break
      if (layer instanceof L.Polyline) {
        const latlngs = layer.getLatLngs() as LatLng[];
        let totalDistance = 0;
        
        for (let i = 0; i < latlngs.length - 1; i++) {
          totalDistance += latlngs[i].distanceTo(latlngs[i + 1]);
        }
        
        setFireBreakDistance(Math.round(totalDistance));
        onDistanceChange(Math.round(totalDistance));
        setCurrentPolyline(layer); // Store the polyline for drop markers
        
        // Add popup with distance info
        layer.bindPopup(`Fire Break Distance: ${Math.round(totalDistance)} meters`).openPopup();
      }
    });

    // Handle editing events
    map.on(L.Draw.Event.EDITED, (event: any) => {
      const layers = event.layers;
      layers.eachLayer((layer: any) => {
        if (layer instanceof L.Polyline) {
          const latlngs = layer.getLatLngs() as LatLng[];
          let totalDistance = 0;
          
          for (let i = 0; i < latlngs.length - 1; i++) {
            totalDistance += latlngs[i].distanceTo(latlngs[i + 1]);
          }
          
          setFireBreakDistance(Math.round(totalDistance));
          onDistanceChange(Math.round(totalDistance));
          setCurrentPolyline(layer); // Update the polyline for drop markers
          layer.setPopupContent(`Fire Break Distance: ${Math.round(totalDistance)} meters`);
        }
      });
    });

    // Handle deletion events
    map.on(L.Draw.Event.DELETED, () => {
      if (drawnItems.getLayers().length === 0) {
        setFireBreakDistance(null);
        onDistanceChange(null);
        setCurrentPolyline(null);
      }
    });

    // Cleanup on unmount
    return () => {
      map.remove();
    };
  }, []);

  return (
    <div className="map-wrapper">
      {error && <div className="map-error">{error}</div>}
      {fireBreakDistance && (
        <div className="map-info">
          <strong>Fire Break Distance:</strong> {fireBreakDistance.toLocaleString()} meters
        </div>
      )}
      <div ref={mapContainerRef} className="map-container" aria-label="Fire break planning map" />
    </div>
  );
};
