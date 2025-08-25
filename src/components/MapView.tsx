import React, { useEffect, useRef, useState } from 'react';
import L, { Map as LeafletMap, LatLng } from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { TrackAnalysis, AircraftSpec, VegetationAnalysis } from '../types/config';
import { analyzeTrackSlopes, getSlopeColor, calculateDistance } from '../utils/slopeCalculation';
import { analyzeTrackVegetation } from '../utils/vegetationAnalysis';
import { MAPBOX_TOKEN } from '../config/mapboxToken';
import { SLOPE_CATEGORIES, VEGETATION_CATEGORIES } from '../config/categories';

// Helper to build richer popup HTML with slope and vegetation data
const buildAnalysisPopupHTML = (analysis: TrackAnalysis, vegetationAnalysis: VegetationAnalysis | null, totalDistance: number) => {
  const dist = (n: number) => Math.round(n); // 0 decimals
  const total = analysis.totalDistance || 1;
  const bars = SLOPE_CATEGORIES.map(e => {
    const meters = (analysis.slopeDistribution as any)[e.key] || 0;
    const pct = Math.max(0.5, Math.round((meters / total) * 100)); // percent as integer
    return `<div class="popup-bar-row">
      <div class="popup-bar-label">${e.label}</div>
      <div class="popup-bar-track">
        <div class="popup-bar-fill pct-${pct}" data-color="${e.color}"></div>
      </div>
      <div class="popup-bar-value">${dist(meters)} m</div>
    </div>`;
  }).join('');

  // Build vegetation analysis section
  let vegetationSection = '';
  if (vegetationAnalysis) {
    const vegTypeLabels = {
      grassland: 'Grassland',
      lightshrub: 'Light Shrub',
      mediumscrub: 'Medium Scrub',
      heavyforest: 'Heavy Forest'
    };
    const predominantLabel = vegTypeLabels[vegetationAnalysis.predominantVegetation];
    const confidencePercent = Math.round(vegetationAnalysis.overallConfidence * 100);
    const total = Math.max(1, vegetationAnalysis.totalDistance);
    const pct = (m: number) => Math.round((m / total) * 100);

    const parts = VEGETATION_CATEGORIES.map(c => ({
      label: c.label,
      pct: pct(vegetationAnalysis.vegetationDistribution[c.key as keyof typeof vegetationAnalysis.vegetationDistribution] || 0),
      color: c.color
    }));

    vegetationSection = `
      <div class="popup-veg-section">
        <div class="popup-veg-title">Vegetation Analysis</div>
        <div class="popup-veg-sub">Predominant: <strong>${predominantLabel}</strong> &nbsp; | &nbsp; Confidence: ${confidencePercent}%</div>
        <div class="dist-bar" role="img" aria-label="Vegetation distribution">
          ${parts.map(p => `<div class=\"dist-seg dist-pct-${p.pct}\" data-color=\"${p.color}\"></div>`).join('')}
        </div>
        <div class="dist-legend">
          ${parts.map(p => `<div class=\"dist-legend-item\"><span class=\"dist-swatch\" data-color=\"${p.color}\"></span><span class=\"dist-legend-label\">${p.label}</span><span class=\"dist-legend-pct\">${p.pct}%</span></div>`).join('')}
        </div>
      </div>`;
  }

    return `
    <div class="popup-analysis">
      <div class="popup-title">Fire Break Analysis</div>
      <div class="popup-summary">Distance: ${Math.round(totalDistance)} m &middot; Max: ${analysis.maxSlope.toFixed(1)}° &middot; Avg: ${analysis.averageSlope.toFixed(1)}°</div>
      <div class="popup-section-title">Slope Distribution</div>
      <div class="popup-section-sub">Meters per category</div>
      ${bars}
      ${vegetationSection}
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
  onVegetationAnalysisChange?: (analysis: VegetationAnalysis | null) => void;
  selectedAircraftForPreview?: string[];
  aircraft?: AircraftSpec[];
}

export const MapView: React.FC<MapViewProps> = ({
  onDistanceChange,
  onTrackAnalysisChange,
  onVegetationAnalysisChange,
  selectedAircraftForPreview = [],
  aircraft = []
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  // Map from polyline leaflet internal id to vertex markers
  const vertexMarkersRef = useRef<Map<number, L.Marker[]>>(new Map());
  const slopeLayersRef = useRef<L.LayerGroup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  const [vegetationAnalysis, setVegetationAnalysis] = useState<VegetationAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Drop preview layers
  const dropMarkersRef = useRef<L.LayerGroup | null>(null);
  const dropMarkerGroupsRef = useRef<Map<string, L.LayerGroup>>(new Map());
  const [dropsVersion, setDropsVersion] = useState(0); // bump when geometry changes

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
      const tileUrl = `https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token=${token}`;
      const satellite = L.tileLayer(tileUrl, {
        id: 'mapbox/satellite-streets-v12',
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 20,
        attribution: '<a href="https://www.mapbox.com/" target="_blank" rel="noreferrer">Mapbox</a>'
      });
      const streets = L.tileLayer(tileUrl, {
        id: 'mapbox/streets-v12',
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 20,
        attribution: '<a href="https://www.mapbox.com/" target="_blank" rel="noreferrer">Mapbox</a>'
      });
      satellite.addTo(map);
      L.control.layers({ Satellite: satellite, Streets: streets }, undefined, { position: 'topleft' }).addTo(map);
    } else {
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

  // Create a top-level group for drop markers
  const dropLayer = new L.LayerGroup();
  map.addLayer(dropLayer);
  dropMarkersRef.current = dropLayer;

  // Helper: analyze track for slopes and vegetation
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
        
        // Perform vegetation analysis in parallel
        let vegAnalysis: VegetationAnalysis | null = null;
        try {
          vegAnalysis = await analyzeTrackVegetation(latlngs);
          setVegetationAnalysis(vegAnalysis);
          onVegetationAnalysisChange?.(vegAnalysis);
        } catch (vegError) {
          console.warn('Vegetation analysis failed, continuing with slope analysis only:', vegError);
        }
        
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

    // Helper: attach click handler to polyline for inserting vertices
    const attachPolylineInteractions = (poly: L.Polyline) => {
      poly.on('click', (ev: any) => {
        const originalEvent = ev?.originalEvent as MouseEvent | undefined;
        if (!originalEvent || !originalEvent.shiftKey) return;
        const clickLatLng: LatLng = ev.latlng;
        const latlngs = poly.getLatLngs() as LatLng[];
        let bestIndex = 0;
        let bestDist = Infinity;
        for (let i = 0; i < latlngs.length - 1; i++) {
          const a = latlngs[i];
          const b = latlngs[i + 1];
          const midLat = (a.lat + b.lat) / 2;
          const midLng = (a.lng + b.lng) / 2;
          const d = calculateDistance(clickLatLng.lat, clickLatLng.lng, midLat, midLng);
          if (d < bestDist) { bestDist = d; bestIndex = i; }
        }
        latlngs.splice(bestIndex + 1, 0, clickLatLng);
        poly.setLatLngs(latlngs);
        removeVertexMarkers(poly);
        addVertexMarkers(poly);
        (async () => {
          const analysis = await analyzeAndVisualizeBranchSlopes(latlngs);
          if (analysis) {
            setFireBreakDistance(Math.round(analysis.totalDistance));
            onDistanceChange(Math.round(analysis.totalDistance));
            setDropsVersion(v => v + 1);
          }
        })();
      });
    };

    // Vertex marker helpers
    const addVertexMarkers = (poly: L.Polyline) => {
      const id = (poly as any)._leaflet_id as number;
      removeVertexMarkers(poly);
      const latlngs = poly.getLatLngs() as LatLng[];
      const markers: L.Marker[] = [];
      for (let idx = 0; idx < latlngs.length; idx++) {
        const pt = latlngs[idx];
        const vertexMarker = L.marker(pt, { draggable: true });
        vertexMarker.addTo(map);
        vertexMarker.on('drag', () => {
          const pts = poly.getLatLngs() as LatLng[]; pts[idx] = vertexMarker.getLatLng(); poly.setLatLngs(pts);
        });
        vertexMarker.on('dragend', async () => {
          const pts = poly.getLatLngs() as LatLng[];
            let total = 0; for (let i = 0; i < pts.length - 1; i++) total += calculateDistance(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
            setFireBreakDistance(Math.round(total)); onDistanceChange(Math.round(total));
            const analysis = await analyzeAndVisualizeBranchSlopes(pts);
            if (analysis) { poly.bindPopup(buildAnalysisPopupHTML(analysis, vegetationAnalysis, total)).openPopup(); setDropsVersion(v => v + 1); }
            removeVertexMarkers(poly); addVertexMarkers(poly);
        });
        markers.push(vertexMarker);
        if (idx < latlngs.length - 1) {
          const a = latlngs[idx]; const b = latlngs[idx + 1];
          const mid = new LatLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
          const midMarker = L.marker(mid, { draggable: true, opacity: 0.8 });
          midMarker.addTo(map);
          ((insertionIndex) => {
            midMarker.on('dragend', async () => {
              const newPos = midMarker.getLatLng();
              const pts = poly.getLatLngs() as LatLng[];
              pts.splice(insertionIndex + 1, 0, newPos);
              poly.setLatLngs(pts);
              removeVertexMarkers(poly); addVertexMarkers(poly);
              let total = 0; for (let i = 0; i < pts.length - 1; i++) total += calculateDistance(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
              setFireBreakDistance(Math.round(total)); onDistanceChange(Math.round(total));
              const analysis = await analyzeAndVisualizeBranchSlopes(pts);
              if (analysis) { poly.bindPopup(buildAnalysisPopupHTML(analysis, vegetationAnalysis, total)).openPopup(); setDropsVersion(v => v + 1); }
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
      if (existing) { existing.forEach(m => m.remove()); vertexMarkersRef.current.delete(id); }
    };

    // Drawing created
    map.on(L.Draw.Event.CREATED, async (event: any) => {
      const layer = event.layer; drawnItems.addLayer(layer);
      if (layer instanceof L.Polyline) {
        attachPolylineInteractions(layer);
        const latlngs = layer.getLatLngs() as LatLng[];
        let totalDistance = 0; for (let i = 0; i < latlngs.length - 1; i++) totalDistance += latlngs[i].distanceTo(latlngs[i + 1]);
        setFireBreakDistance(Math.round(totalDistance)); onDistanceChange(Math.round(totalDistance));
        const analysis = await analyzeAndVisualizeBranchSlopes(latlngs);
        const popupContent = analysis ? buildAnalysisPopupHTML(analysis, vegetationAnalysis, totalDistance) : `Fire Break Distance: ${Math.round(totalDistance)} meters`;
        layer.bindPopup(popupContent).openPopup();
        addVertexMarkers(layer);
        setDropsVersion(v => v + 1);
      }
    });

    // Drawing edited
    map.on(L.Draw.Event.EDITED, async (event: any) => {
      const layers = event.layers;
      layers.eachLayer(async (layer: any) => {
        if (layer instanceof L.Polyline) {
          const latlngs = layer.getLatLngs() as LatLng[];
          let totalDistance = 0; for (let i = 0; i < latlngs.length - 1; i++) totalDistance += latlngs[i].distanceTo(latlngs[i + 1]);
          setFireBreakDistance(Math.round(totalDistance)); onDistanceChange(Math.round(totalDistance));
          const analysis = await analyzeAndVisualizeBranchSlopes(latlngs);
          const popupContent = analysis ? buildAnalysisPopupHTML(analysis, vegetationAnalysis, totalDistance) : `Fire Break Distance: ${Math.round(totalDistance)} meters`;
          layer.setPopupContent(popupContent);
          removeVertexMarkers(layer); addVertexMarkers(layer);
          setDropsVersion(v => v + 1);
        }
      });
    });

  // Drawing deleted
  map.on(L.Draw.Event.DELETED, () => {
      if (drawnItems.getLayers().length === 0) {
        setFireBreakDistance(null);
        onDistanceChange(null);
        setTrackAnalysis(null);
        onTrackAnalysisChange?.(null);
        setVegetationAnalysis(null);
        onVegetationAnalysisChange?.(null);
        
        // Clear slope visualization
        if (slopeLayersRef.current) {
          slopeLayersRef.current.clearLayers();
        }
        // Clear vertex markers map
        vertexMarkersRef.current.forEach((markers) => markers.forEach(m => m.remove()));
        vertexMarkersRef.current.clear();
      }
      setDropsVersion(v => v + 1);
    });

    // Cleanup on unmount
    return () => { map.remove(); };
  }, [aircraft, onDistanceChange, onTrackAnalysisChange, onVegetationAnalysisChange]);

  // Re-render drop previews when selected aircraft change or when map/drawn items update.
  // We use dropsVersion to also trigger on topology changes.
  useEffect(() => {
    if (!mapRef.current || !drawnItemsRef.current || !dropMarkersRef.current) return;
    // Clear previous groups
    dropMarkerGroupsRef.current.forEach(group => {
      group.clearLayers();
      if (dropMarkersRef.current!.hasLayer(group)) dropMarkersRef.current!.removeLayer(group);
    });
    dropMarkerGroupsRef.current.clear();
    if (!selectedAircraftForPreview.length) return;
    selectedAircraftForPreview.forEach(id => {
      const spec = aircraft.find(a => a.id === id);
      if (!spec) return;
      const group = new L.LayerGroup();
      const dropLen = spec.dropLength || 1000;
      drawnItemsRef.current!.eachLayer((layer: any) => {
        if (!(layer instanceof L.Polyline)) return;
        const latlngs = layer.getLatLngs() as LatLng[];
        if (!latlngs || latlngs.length < 2) return;
        const cumulative: { pt: LatLng; distFromStart: number }[] = [];
        let acc = 0;
        cumulative.push({ pt: latlngs[0], distFromStart: 0 });
        for (let i = 1; i < latlngs.length; i++) {
          const prev = latlngs[i - 1]; const curr = latlngs[i]; const seg = prev.distanceTo(curr); acc += seg; cumulative.push({ pt: curr, distFromStart: acc });
        }
        for (let d = dropLen; d <= cumulative[cumulative.length - 1].distFromStart; d += dropLen) {
          let idx = cumulative.findIndex(c => c.distFromStart >= d); if (idx === -1) idx = cumulative.length - 1;
          const after = cumulative[idx]; const before = cumulative[Math.max(0, idx - 1)];
          const segLen = after.distFromStart - before.distFromStart || 1; const t = (d - before.distFromStart) / segLen;
          const lat = before.pt.lat + (after.pt.lat - before.pt.lat) * t; const lng = before.pt.lng + (after.pt.lng - before.pt.lng) * t;
          const marker = L.circleMarker([lat, lng], { radius: 6, color: '#4fc3f7', fillColor: '#4fc3f7', fillOpacity: 0.9, weight: 1 });
          marker.bindTooltip(`${spec.name} drop`, { permanent: false, direction: 'top' }); group.addLayer(marker);
        }
      });
      dropMarkersRef.current!.addLayer(group); dropMarkerGroupsRef.current.set(id, group);
    });
  }, [selectedAircraftForPreview, aircraft, dropsVersion]);

  return (
    <div className="map-wrapper">
      {error && <div className="map-error">{error}</div>}
      {/* {fireBreakDistance && (
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
      )} */}
      <div ref={mapContainerRef} className="map-container" aria-label="Fire break planning map" />
    </div>
  );
};
