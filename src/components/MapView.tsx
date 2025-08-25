import React, { useEffect, useRef, useState } from 'react';
import L, { Map as LeafletMap, LatLng } from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { TrackAnalysis } from '../types/config';
import { analyzeTrackSlopes, getSlopeColor } from '../utils/slopeCalculation';

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
  onTrackAnalysisChange?: (analysis: TrackAnalysis | null) => void;
}

export const MapView: React.FC<MapViewProps> = ({ onDistanceChange, onTrackAnalysisChange }) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const slopeLayersRef = useRef<L.LayerGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

    // Initialize slope visualization layer
    const slopeLayer = new L.LayerGroup();
    map.addLayer(slopeLayer);
    slopeLayersRef.current = slopeLayer;

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

    // Function to analyze track and visualize slopes
    const analyzeAndVisualizeBranchSlopes = async (latlngs: LatLng[]) => {
      setIsAnalyzing(true);
      
      try {
        // Clear existing slope visualization
        if (slopeLayersRef.current) {
          slopeLayersRef.current.clearLayers();
        }
        
        // Perform slope analysis
        const analysis = await analyzeTrackSlopes(latlngs);
        setTrackAnalysis(analysis);
        onTrackAnalysisChange?.(analysis);
        
        // Visualize slope segments
        analysis.segments.forEach((segment) => {
          const color = getSlopeColor(segment.category);
          const line = L.polyline(
            [segment.start, segment.end],
            {
              color,
              weight: 6,
              opacity: 0.8
            }
          );
          
          // Add popup with slope information
          line.bindPopup(`
            <div>
              <strong>Slope Segment</strong><br/>
              Slope: ${segment.slope.toFixed(1)}° (${segment.category.replace('_', ' ')})<br/>
              Distance: ${segment.distance.toFixed(0)}m<br/>
              Elevation change: ${Math.abs(segment.endElevation - segment.startElevation).toFixed(1)}m
            </div>
          `);
          
          if (slopeLayersRef.current) {
            slopeLayersRef.current.addLayer(line);
          }
        });
        
      } catch (error) {
        console.error('Error analyzing track slopes:', error);
        setError('Failed to analyze track slopes');
      } finally {
        setIsAnalyzing(false);
      }
    };

    // Handle drawing events for fire break calculation
    map.on(L.Draw.Event.CREATED, async (event: any) => {
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
        
        // Analyze slopes and add visualization
        await analyzeAndVisualizeBranchSlopes(latlngs);
        
        // Add popup with comprehensive info
        const analysis = trackAnalysis;
        const popupContent = analysis ? `
          <div>
            <strong>Fire Break Analysis</strong><br/>
            Distance: ${Math.round(totalDistance)}m<br/>
            Max Slope: ${analysis.maxSlope.toFixed(1)}°<br/>
            Avg Slope: ${analysis.averageSlope.toFixed(1)}°<br/>
            <br/>
            <strong>Slope Distribution:</strong><br/>
            Flat (0-10°): ${analysis.slopeDistribution.flat} segments<br/>
            Medium (10-20°): ${analysis.slopeDistribution.medium} segments<br/>
            Steep (20-30°): ${analysis.slopeDistribution.steep} segments<br/>
            Very Steep (30°+): ${analysis.slopeDistribution.very_steep} segments
          </div>
        ` : `Fire Break Distance: ${Math.round(totalDistance)} meters`;
        
        layer.bindPopup(popupContent).openPopup();
      }
    });

    // Handle editing events
    map.on(L.Draw.Event.EDITED, async (event: any) => {
      const layers = event.layers;
      layers.eachLayer(async (layer: any) => {
        if (layer instanceof L.Polyline) {
          const latlngs = layer.getLatLngs() as LatLng[];
          let totalDistance = 0;
          
          for (let i = 0; i < latlngs.length - 1; i++) {
            totalDistance += latlngs[i].distanceTo(latlngs[i + 1]);
          }
          
          setFireBreakDistance(Math.round(totalDistance));
          onDistanceChange(Math.round(totalDistance));
          
          // Re-analyze slopes after editing
          await analyzeAndVisualizeBranchSlopes(latlngs);
          
          // Update popup with new analysis
          const analysis = trackAnalysis;
          const popupContent = analysis ? `
            <div>
              <strong>Fire Break Analysis</strong><br/>
              Distance: ${Math.round(totalDistance)}m<br/>
              Max Slope: ${analysis.maxSlope.toFixed(1)}°<br/>
              Avg Slope: ${analysis.averageSlope.toFixed(1)}°<br/>
              <br/>
              <strong>Slope Distribution:</strong><br/>
              Flat (0-10°): ${analysis.slopeDistribution.flat} segments<br/>
              Medium (10-20°): ${analysis.slopeDistribution.medium} segments<br/>
              Steep (20-30°): ${analysis.slopeDistribution.steep} segments<br/>
              Very Steep (30°+): ${analysis.slopeDistribution.very_steep} segments
            </div>
          ` : `Fire Break Distance: ${Math.round(totalDistance)} meters`;
          
          layer.setPopupContent(popupContent);
        }
      });
    });

    // Handle deletion events
    map.on(L.Draw.Event.DELETED, () => {
      if (drawnItems.getLayers().length === 0) {
        setFireBreakDistance(null);
        onDistanceChange(null);
        setTrackAnalysis(null);
        onTrackAnalysisChange?.(null);
        
        // Clear slope visualization
        if (slopeLayersRef.current) {
          slopeLayersRef.current.clearLayers();
        }
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
          {isAnalyzing && <div className="analysis-loading">Analyzing slopes...</div>}
          {trackAnalysis && (
            <div className="slope-summary">
              <strong>Slope Analysis:</strong> Max {trackAnalysis.maxSlope.toFixed(1)}°, 
              Avg {trackAnalysis.averageSlope.toFixed(1)}°
            </div>
          )}
        </div>
      )}
      <div ref={mapContainerRef} className="map-container" aria-label="Fire break planning map" />
    </div>
  );
};
