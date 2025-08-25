import React, { useEffect, useRef, useState } from 'react';
import L, { Map as LeafletMap, LatLng } from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { TrackAnalysis } from '../types/config';
import { analyzeTrackSlopes, getSlopeColor, calculateDistance } from '../utils/slopeCalculation';
import { MAPBOX_TOKEN } from '../config/mapboxToken';

// Helper to build richer popup HTML with 0-decimal slope distribution and mini bar chart
const buildAnalysisPopupHTML = (analysis: TrackAnalysis, totalDistance: number) => {
  const dist = (n: number) => Math.round(n); // 0 decimals
  const total = analysis.totalDistance || 1;
  const entries: { label: string; key: keyof typeof analysis.slopeDistribution; color: string; range: string }[] = [
    { label: 'Flat', key: 'flat', color: '#00aa00', range: '0-10°' },
    { label: 'Medium', key: 'medium', color: '#c8c800', range: '10-20°' },
    { label: 'Steep', key: 'steep', color: '#ff8800', range: '20-30°' },
    { label: 'Very Steep', key: 'very_steep', color: '#ff0000', range: '30°+' }
  ];
  const bars = entries.map(e => {
    const meters = analysis.slopeDistribution[e.key];
    const pct = Math.max(0.5, (meters / total) * 100); // ensure tiny visibility
    return `<div style=\"display:flex;align-items:center;margin:2px 0;gap:6px;font-size:11px;\">
      <div style=\"width:60px;\">${e.label}</div>
      <div style=\"flex:1;background:#eee;height:8px;position:relative;border-radius:4px;overflow:hidden;\">
        <div style=\"position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${e.color};\"></div>
      </div>
      <div style=\"width:55px;text-align:right;\">${dist(meters)} m</div>
    </div>`; 
  }).join('');
  return `
    <div style=\"min-width:260px;\">
      <strong>Fire Break Analysis</strong><br/>
      Distance: ${Math.round(totalDistance)} m<br/>
      Max Slope: ${analysis.maxSlope.toFixed(1)}°<br/>
      Avg Slope: ${analysis.averageSlope.toFixed(1)}°<br/>
      <div style=\"margin-top:6px;font-weight:bold;\">Slope Distribution</div>
      <div style=\"font-size:10px;color:#555;margin-bottom:4px;\">Meters per category</div>
      ${bars}
    </div>`;
};

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
  // Map from polyline leaflet internal id to vertex markers
  const vertexMarkersRef = useRef<Map<number, L.Marker[]>>(new Map());
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
  const token = MAPBOX_TOKEN;
    
    if (token && token !== 'YOUR_MAPBOX_TOKEN_HERE') {
      // Use Mapbox tiles if token is available. Define two Mapbox base layers
      const tileUrl = `https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=${token}`;

      // Satellite (default) and Streets layers
      const satellite = L.tileLayer(tileUrl, {
        id: 'mapbox/satellite-streets-v12',
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 20,
        attribution:
          '<a href="https://www.mapbox.com/" target="_blank" rel="noreferrer">Mapbox</a>'
      });

      const streets = L.tileLayer(tileUrl, {
        id: 'mapbox/streets-v12',
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 20,
        attribution:
          '<a href="https://www.mapbox.com/" target="_blank" rel="noreferrer">Mapbox</a>'
      });

      // Add satellite as the default base layer
      satellite.addTo(map);

      // Add a layer control so users can switch to Streets if desired
      L.control.layers(
        {
          'Satellite': satellite,
          'Streets': streets
        },
        undefined,
        { position: 'topleft' }
      ).addTo(map);
    } else {
      // Fallback to OpenStreetMap when token is missing
      const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
      });
      osm.addTo(map);
    }

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
    const analyzeAndVisualizeBranchSlopes = async (latlngs: LatLng[]): Promise<TrackAnalysis | null> => {
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
        
        // Visualize slope segments (use full coordinate chain if provided)
        analysis.segments.forEach((segment) => {
          const color = getSlopeColor(segment.category);
          const coords = segment.coords && segment.coords.length >= 2 ? segment.coords : [segment.start, segment.end];
          const line = L.polyline(
            coords as any,
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
        
  return analysis;
        
      } catch (error) {
        console.error('Error analyzing track slopes:', error);
        setError('Failed to analyze track slopes');
        return null;
      } finally {
        setIsAnalyzing(false);
      }
    };

    // Handle drawing events for fire break calculation
    map.on(L.Draw.Event.CREATED, async (event: any) => {
      const layer = event.layer;
      drawnItems.addLayer(layer);
      // Attach interactive behavior for this polyline
      if (layer instanceof L.Polyline) {
        attachPolylineInteractions(layer);
      }
      
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
        const analysis = await analyzeAndVisualizeBranchSlopes(latlngs);
        
        // Add popup with comprehensive info
  const popupContent = analysis ? buildAnalysisPopupHTML(analysis, totalDistance) : `Fire Break Distance: ${Math.round(totalDistance)} meters`;
        
        layer.bindPopup(popupContent).openPopup();
        // After creating and analyzing, add draggable vertex markers
        if (layer instanceof L.Polyline) {
          addVertexMarkers(layer);
        }
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
          const analysis = await analyzeAndVisualizeBranchSlopes(latlngs);
          // Update popup with new analysis
          const popupContent = analysis ? buildAnalysisPopupHTML(analysis, totalDistance) : `Fire Break Distance: ${Math.round(totalDistance)} meters`;
          
          layer.setPopupContent(popupContent);
          // Rebuild vertex markers to match new vertices
          removeVertexMarkers(layer);
          addVertexMarkers(layer);
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
        // Clear vertex markers map
        vertexMarkersRef.current.forEach((markers) => markers.forEach(m => m.remove()));
        vertexMarkersRef.current.clear();
      }
    });

    // Helper: attach click handler and other interactions to a polyline
    const attachPolylineInteractions = (poly: L.Polyline) => {
      // Require Shift+click to insert a new vertex to avoid accidental edits
      poly.on('click', (ev: any) => {
        const originalEvent = ev?.originalEvent as MouseEvent | undefined;
        if (!originalEvent || !originalEvent.shiftKey) return; // only on Shift+Click
        const clickLatLng: LatLng = ev.latlng;
        const latlngs = poly.getLatLngs() as LatLng[];

        // Find best insertion index by locating nearest segment midpoint
        let bestIndex = 0;
        let bestDist = Infinity;
        for (let i = 0; i < latlngs.length - 1; i++) {
          const a = latlngs[i];
          const b = latlngs[i + 1];
          const midLat = (a.lat + b.lat) / 2;
          const midLng = (a.lng + b.lng) / 2;
          const d = calculateDistance(clickLatLng.lat, clickLatLng.lng, midLat, midLng);
          if (d < bestDist) {
            bestDist = d;
            bestIndex = i;
          }
        }

        // Insert new point after bestIndex
        latlngs.splice(bestIndex + 1, 0, clickLatLng);
        poly.setLatLngs(latlngs);

        // Recreate markers and re-run analysis
        removeVertexMarkers(poly);
        addVertexMarkers(poly);
        (async () => {
          const analysis = await analyzeAndVisualizeBranchSlopes(latlngs);
          if (analysis) {
            setFireBreakDistance(Math.round(analysis.totalDistance));
            onDistanceChange(Math.round(analysis.totalDistance));
          }
        })();
      });
    };

    // Add draggable marker management functions
    const addVertexMarkers = (poly: L.Polyline) => {
      const id = (poly as any)._leaflet_id as number;
      // remove existing first
      removeVertexMarkers(poly);
      const latlngs = poly.getLatLngs() as LatLng[];
      const markers: L.Marker[] = [];

      // Create vertex markers for each user vertex
      for (let idx = 0; idx < latlngs.length; idx++) {
        const pt = latlngs[idx];
        const vertexMarker = L.marker(pt, { draggable: true });
        vertexMarker.addTo(map);

        // While dragging, update the polyline vertex
        vertexMarker.on('drag', () => {
          const pts = poly.getLatLngs() as LatLng[];
          pts[idx] = vertexMarker.getLatLng();
          poly.setLatLngs(pts);
        });

        // On drag end, recalc and rebuild markers (to re-index)
        vertexMarker.on('dragend', async () => {
          const pts = poly.getLatLngs() as LatLng[];
          let total = 0;
          for (let i = 0; i < pts.length - 1; i++) total += calculateDistance(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
          setFireBreakDistance(Math.round(total));
          onDistanceChange(Math.round(total));
          const analysis = await analyzeAndVisualizeBranchSlopes(pts);
          if (analysis) {
            poly.bindPopup(buildAnalysisPopupHTML(analysis, total)).openPopup();
          }
          // rebuild markers to ensure indices match
          removeVertexMarkers(poly);
          addVertexMarkers(poly);
        });

        markers.push(vertexMarker);

        // Create midpoint marker between this vertex and the next (if exists)
        if (idx < latlngs.length - 1) {
          const a = latlngs[idx];
          const b = latlngs[idx + 1];
          const mid = new LatLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
          const midMarker = L.marker(mid, { draggable: true, opacity: 0.8 });
          midMarker.addTo(map);

          // When a midpoint is dragged and released, convert it to a real vertex
          ((insertionIndex) => {
            midMarker.on('dragend', async () => {
              const newPos = midMarker.getLatLng();
              const pts = poly.getLatLngs() as LatLng[];
              // Insert new vertex at insertionIndex + 1
              pts.splice(insertionIndex + 1, 0, newPos);
              poly.setLatLngs(pts);

              // Rebuild markers to reflect new vertex and new midpoints
              removeVertexMarkers(poly);
              addVertexMarkers(poly);

              // Re-run analysis
              let total = 0;
              for (let i = 0; i < pts.length - 1; i++) total += calculateDistance(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
              setFireBreakDistance(Math.round(total));
              onDistanceChange(Math.round(total));
              const analysis = await analyzeAndVisualizeBranchSlopes(pts);
              if (analysis) {
                poly.bindPopup(buildAnalysisPopupHTML(analysis, total)).openPopup();
              }
            });
          })(idx);

          markers.push(midMarker);
        }
      }

      vertexMarkersRef.current.set(id, markers);
    };

    const removeVertexMarkers = (poly: L.Polyline) => {
      const id = (poly as any)._leaflet_id as number;
      const existing = vertexMarkersRef.current.get(id);
      if (existing) {
        existing.forEach(m => m.remove());
        vertexMarkersRef.current.delete(id);
      }
    };

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
