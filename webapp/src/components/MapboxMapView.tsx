import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import mapboxgl, { Map as MapboxMap, LngLat, Popup } from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { TrackAnalysis, AircraftSpec, VegetationAnalysis } from '../types/config';
import { analyzeTrackSlopes, getSlopeColor, calculateDistance } from '../utils/slopeCalculation';
import { analyzeTrackVegetation } from '../utils/vegetationAnalysis';
import { MAPBOX_TOKEN } from '../config/mapboxToken';
import { SLOPE_CATEGORIES, VEGETATION_CATEGORIES } from '../config/categories';
import { isTouchDevice } from '../utils/deviceDetection';
import { logger } from '../utils/logger';

// Helper to convert LngLat to LatLng format for existing utilities
const lngLatToLatLng = (lngLat: LngLat) => ({ lat: lngLat.lat, lng: lngLat.lng });

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
          ${parts.map(p => `<div class=\"dist-seg pct-${p.pct}\" data-color=\"${p.color}\"></div>`).join('')}
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

// Default map center (longitude, latitude) & zoom. Centered on New South Wales, Australia.
const DEFAULT_CENTER: [number, number] = [147.0, -32.0]; // NSW, Australia (lng, lat)
const DEFAULT_ZOOM = 6;

/**
 * Mapbox GL JS implementation of the fire break planning map.
 * Replaces Leaflet with native Mapbox GL JS for better performance and features.
 */

interface MapboxMapViewProps {
  onDistanceChange: (distance: number | null) => void;
  onTrackAnalysisChange?: (analysis: TrackAnalysis | null) => void;
  onVegetationAnalysisChange?: (analysis: VegetationAnalysis | null) => void;
  onAnalyzingChange?: (isAnalyzing: boolean) => void;
  selectedAircraftForPreview?: string[];
  aircraft?: AircraftSpec[];
}

export const MapboxMapView: React.FC<MapboxMapViewProps> = ({
  onDistanceChange,
  onTrackAnalysisChange,
  onVegetationAnalysisChange,
  onAnalyzingChange,
  selectedAircraftForPreview = [],
  aircraft = []
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  const [vegetationAnalysis, setVegetationAnalysis] = useState<VegetationAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showTouchHint, setShowTouchHint] = useState(() => {
    try { return isTouchDevice(); } catch { return false; }
  });
  const [showVegetationZoomHint, setShowVegetationZoomHint] = useState(false);
  const [vegetationLayerEnabled, setVegetationLayerEnabled] = useState(false);
  
  // Aircraft drop markers state
  const dropMarkersRef = useRef<Map<string, mapboxgl.Marker[]>>(new Map());
  const [dropsVersion, setDropsVersion] = useState(0);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return; // prevent re-init

    const token = MAPBOX_TOKEN;
    if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
      setError('Mapbox token is not configured. Please set VITE_MAPBOX_TOKEN in your environment.');
      return;
    }

    mapboxgl.accessToken = token;

    // Initialize the map with custom satellite style
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/richardbt/cmf7esv62000n01qw0khz891t', // Custom satellite style with contours
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      accessToken: token
    });

    mapRef.current = map;

    // Add navigation controls
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    // Initialize MapboxDraw for drawing functionality
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        line_string: true,
        trash: true
      },
      defaultMode: 'draw_line_string',
      styles: [
        // Fire break line style
        {
          'id': 'gl-draw-line',
          'type': 'line',
          'filter': ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
          'layout': {
            'line-cap': 'round',
            'line-join': 'round'
          },
          'paint': {
            'line-color': '#ff6b35',
            'line-width': 4,
            'line-opacity': 0.8
          }
        },
        // Vertex styles
        {
          'id': 'gl-draw-polygon-and-line-vertex-halo-active',
          'type': 'circle',
          'filter': ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          'paint': {
            'circle-radius': 8,
            'circle-color': '#FFF'
          }
        },
        {
          'id': 'gl-draw-polygon-and-line-vertex-active',
          'type': 'circle',
          'filter': ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          'paint': {
            'circle-radius': 5,
            'circle-color': '#ff6b35'
          }
        }
      ]
    });

    map.addControl(draw, 'top-right');
    drawRef.current = draw;

    // Handle drawing events
    map.on('draw.create', async (e: any) => {
      const feature = e.features[0];
      if (feature.geometry.type === 'LineString') {
        const coordinates = feature.geometry.coordinates;
        const latlngs = coordinates.map((coord: number[]) => lngLatToLatLng(new LngLat(coord[0], coord[1])));
        
        // Calculate distance
        const distance = calculateDistance(latlngs);
        setFireBreakDistance(distance);
        onDistanceChange(distance);

        // Perform analysis
        await analyzeAndVisualizeSlopes(latlngs);
        
        // Trigger aircraft drop visualization update
        setDropsVersion(v => v + 1);
      }
    });

    map.on('draw.update', async (e: any) => {
      const feature = e.features[0];
      if (feature.geometry.type === 'LineString') {
        const coordinates = feature.geometry.coordinates;
        const latlngs = coordinates.map((coord: number[]) => lngLatToLatLng(new LngLat(coord[0], coord[1])));
        
        // Calculate distance
        const distance = calculateDistance(latlngs);
        setFireBreakDistance(distance);
        onDistanceChange(distance);

        // Perform analysis
        await analyzeAndVisualizeSlopes(latlngs);
        
        // Trigger aircraft drop visualization update
        setDropsVersion(v => v + 1);
      }
    });

    map.on('draw.delete', () => {
      setFireBreakDistance(null);
      onDistanceChange(null);
      setTrackAnalysis(null);
      onTrackAnalysisChange?.(null);
      setVegetationAnalysis(null);
      onVegetationAnalysisChange?.(null);
      
      // Clear slope visualization
      if (map.getLayer('slope-segments')) {
        map.removeLayer('slope-segments');
      }
      if (map.getSource('slope-segments')) {
        map.removeSource('slope-segments');
      }
      
      // Trigger aircraft drop visualization update
      setDropsVersion(v => v + 1);
    });

    // Add streets layer as an alternative
    map.on('style.load', () => {
      // Add NSW vegetation WMS layer as a raster source
      map.addSource('nsw-vegetation', {
        type: 'raster',
        tiles: [
          'https://mapprod3.environment.nsw.gov.au/arcgis/services/VIS/SVTM_NSW_Extant_PCT/MapServer/WMSServer?bbox={bbox-epsg-3857}&format=image/png&service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&transparent=true&width=256&height=256&layers=3'
        ],
        tileSize: 256
      });

      // Add vegetation layer (initially hidden)
      map.addLayer({
        id: 'nsw-vegetation-layer',
        type: 'raster',
        source: 'nsw-vegetation',
        layout: {
          visibility: 'none'
        },
        paint: {
          'raster-opacity': 0.7
        }
      });

      // Add layer control
      addLayerControl(map);
    });

    // Handle errors
    map.on('error', (e) => {
      logger.error('Mapbox GL error:', e);
      setError('Map failed to load. Please check your connection and try again.');
    });

    return () => {
      map.remove();
    };
  }, []);

  // Aircraft drop visualization effect
  useEffect(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    
    if (!map || !draw || !selectedAircraftForPreview.length) {
      // Clear existing markers if no aircraft selected
      dropMarkersRef.current.forEach(markers => {
        markers.forEach(marker => marker.remove());
      });
      dropMarkersRef.current.clear();
      return;
    }

    // Clear previous markers
    dropMarkersRef.current.forEach(markers => {
      markers.forEach(marker => marker.remove());
    });
    dropMarkersRef.current.clear();

    // Get all drawn features
    const features = draw.getAll();
    
    selectedAircraftForPreview.forEach(aircraftId => {
      const spec = aircraft.find(a => a.id === aircraftId);
      if (!spec) return;

      const dropLength = spec.dropLength || 1000;
      const markers: mapboxgl.Marker[] = [];

      features.features.forEach(feature => {
        if (feature.geometry.type !== 'LineString') return;
        
        const coordinates = feature.geometry.coordinates;
        if (coordinates.length < 2) return;

        // Calculate cumulative distances along the line
        const cumulative: { coord: [number, number]; distFromStart: number }[] = [];
        let totalDistance = 0;
        
        cumulative.push({ coord: [coordinates[0][0], coordinates[0][1]], distFromStart: 0 });
        
        for (let i = 1; i < coordinates.length; i++) {
          const prev = coordinates[i - 1];
          const curr = coordinates[i];
          const segmentDistance = calculateDistance(prev[1], prev[0], curr[1], curr[0]); // lat1, lng1, lat2, lng2
          totalDistance += segmentDistance;
          cumulative.push({ coord: [curr[0], curr[1]], distFromStart: totalDistance });
        }

        // Place drop markers at intervals
        for (let distance = dropLength; distance <= totalDistance; distance += dropLength) {
          // Find the segment containing this distance
          let segmentIndex = cumulative.findIndex(c => c.distFromStart >= distance);
          if (segmentIndex === -1) segmentIndex = cumulative.length - 1;
          
          const after = cumulative[segmentIndex];
          const before = cumulative[Math.max(0, segmentIndex - 1)];
          
          const segmentLength = after.distFromStart - before.distFromStart || 1;
          const t = (distance - before.distFromStart) / segmentLength;
          
          // Interpolate position
          const lng = before.coord[0] + (after.coord[0] - before.coord[0]) * t;
          const lat = before.coord[1] + (after.coord[1] - before.coord[1]) * t;

          // Create marker element
          const markerElement = document.createElement('div');
          markerElement.className = 'aircraft-drop-marker';
          markerElement.style.cssText = `
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background-color: #4fc3f7;
            border: 2px solid #ffffff;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            cursor: pointer;
          `;

          // Create and add marker
          const marker = new mapboxgl.Marker(markerElement)
            .setLngLat([lng, lat])
            .setPopup(new mapboxgl.Popup({ offset: 25 })
              .setHTML(`<div><strong>${spec.name}</strong><br/>Aircraft Drop Point</div>`))
            .addTo(map);

          markers.push(marker);
        }
      });

      dropMarkersRef.current.set(aircraftId, markers);
    });
  }, [selectedAircraftForPreview, aircraft, dropsVersion]);

  // Helper function to analyze and visualize slopes
  const analyzeAndVisualizeSlopes = async (latlngs: any[]): Promise<TrackAnalysis | null> => {
    setIsAnalyzing(true);
    onAnalyzingChange?.(true);
    
    try {
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
        logger.warn('Vegetation analysis failed, continuing with slope analysis only:', vegError);
      }
      
      // Visualize slope segments
      visualizeSlopeSegments(analysis);
      
      return analysis;
      
    } catch (error) {
      logger.error('Error analyzing track slopes:', error);
      setError('Failed to analyze track slopes');
      return null;
    } finally {
      setIsAnalyzing(false);
      onAnalyzingChange?.(false);
    }
  };

  // Helper function to visualize slope segments
  const visualizeSlopeSegments = (analysis: TrackAnalysis) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing slope visualization
    if (map.getLayer('slope-segments')) {
      map.removeLayer('slope-segments');
    }
    if (map.getSource('slope-segments')) {
      map.removeSource('slope-segments');
    }

    // Create GeoJSON features for slope segments
    const features = analysis.segments.map((segment, index) => {
      const color = getSlopeColor(segment.category);
      const coords = segment.coords && segment.coords.length >= 2 
        ? segment.coords.map(coord => [coord[1], coord[0]]) // [lng, lat] for GeoJSON
        : [[segment.start[1], segment.start[0]], [segment.end[1], segment.end[0]]]; // [lng, lat]

      return {
        type: 'Feature' as const,
        properties: {
          slope: segment.slope,
          category: segment.category,
          distance: segment.distance,
          elevationChange: Math.abs(segment.endElevation - segment.startElevation),
          color: color,
          index: index
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: coords
        }
      };
    });

    // Add source and layer for slope segments
    map.addSource('slope-segments', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: features
      }
    });

    map.addLayer({
      id: 'slope-segments',
      type: 'line',
      source: 'slope-segments',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 6,
        'line-opacity': 0.8
      }
    });

    // Add click handler for slope segment popups
    map.on('click', 'slope-segments', (e) => {
      if (e.features && e.features[0] && e.features[0].properties) {
        const feature = e.features[0];
        const properties = feature.properties!;
        
        // Build popup content with slope and vegetation data
        let popupHTML = `
          <div>
            <strong>Slope Segment</strong><br/>
            Slope: ${properties.slope?.toFixed(1) || 0}° (${(properties.category || '').replace('_', ' ')})<br/>
            Distance: ${properties.distance?.toFixed(0) || 0}m<br/>
            Elevation change: ${properties.elevationChange?.toFixed(1) || 0}m
          </div>
        `;
        
        // Add vegetation analysis summary if available
        if (vegetationAnalysis) {
          const predominantVegLabels = {
            grassland: 'Grassland',
            lightshrub: 'Light Shrub',
            mediumscrub: 'Medium Scrub',
            heavyforest: 'Heavy Forest'
          };
          const predominantLabel = predominantVegLabels[vegetationAnalysis.predominantVegetation] || 'Unknown';
          const confidencePercent = Math.round(vegetationAnalysis.overallConfidence * 100);
          
          popupHTML += `
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
              <strong>Vegetation:</strong> ${predominantLabel}<br/>
              <small>Confidence: ${confidencePercent}%</small>
            </div>
          `;
        }
        
        new mapboxgl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(popupHTML)
          .addTo(map);
      }
    });

    // Change cursor on hover
    map.on('mouseenter', 'slope-segments', () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'slope-segments', () => {
      map.getCanvas().style.cursor = '';
    });
  };

  // Helper function to add layer control
  const addLayerControl = (map: MapboxMap) => {
    const layerControl = document.createElement('div');
    layerControl.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    layerControl.style.background = 'white';
    layerControl.style.padding = '10px';
    layerControl.style.borderRadius = '4px';
    
    layerControl.innerHTML = `
      <div style="margin-bottom: 8px;">
        <label style="display: block; margin-bottom: 4px;">
          <input type="radio" name="basemap" value="satellite" checked> Satellite (Contours)
        </label>
        <label style="display: block;">
          <input type="radio" name="basemap" value="streets"> Streets
        </label>
      </div>
      <div>
        <label style="display: block;">
          <input type="checkbox" id="vegetation-toggle"> NSW Vegetation
        </label>
      </div>
    `;

    // Handle basemap switching
    const basemapRadios = layerControl.querySelectorAll('input[name="basemap"]');
    basemapRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.value === 'satellite') {
          map.setStyle('mapbox://styles/richardbt/cmf7esv62000n01qw0khz891t');
        } else if (target.value === 'streets') {
          map.setStyle('mapbox://styles/mapbox/streets-v12');
        }
      });
    });

    // Handle vegetation layer toggle
    const vegetationToggle = layerControl.querySelector('#vegetation-toggle') as HTMLInputElement;
    vegetationToggle.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const visibility = target.checked ? 'visible' : 'none';
      
      if (map.getLayer('nsw-vegetation-layer')) {
        map.setLayoutProperty('nsw-vegetation-layer', 'visibility', visibility);
        setVegetationLayerEnabled(target.checked);
        
        if (target.checked && map.getZoom() < 10) {
          setShowVegetationZoomHint(true);
          setTimeout(() => setShowVegetationZoomHint(false), 10000);
        }
      }
    });

    // Add to map
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'mapboxgl-ctrl-top-left';
    controlsContainer.style.position = 'absolute';
    controlsContainer.style.top = '10px';
    controlsContainer.style.left = '50px';
    controlsContainer.appendChild(layerControl);
    
    map.getContainer().appendChild(controlsContainer);
  };

  return (
    <div className="mapbox-map-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div 
        ref={mapContainerRef} 
        className="mapbox-map"
        style={{ width: '100%', height: '100%' }}
        role="application"
        aria-label="Interactive fire break planning map"
      />
      
      {error && (
        <div className="map-error-overlay" style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          maxWidth: '300px',
          textAlign: 'center',
          zIndex: 1000
        }}>
          <div style={{ color: '#e1004a', fontWeight: 'bold', marginBottom: '8px' }}>
            Map Error
          </div>
          <div style={{ fontSize: '14px', lineHeight: '1.4' }}>
            {error}
          </div>
        </div>
      )}
      
      {showTouchHint && (
        <div className="touch-hint" style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '12px',
          borderRadius: '6px',
          fontSize: '14px',
          maxWidth: '200px',
          zIndex: 1000
        }}>
          Tap the line tool, then tap points to draw your fire break route. Double-tap to finish.
          <button 
            onClick={() => setShowTouchHint(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              marginLeft: '8px',
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>
      )}
      
      {showVegetationZoomHint && (
        <div className="vegetation-zoom-hint" style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          background: 'rgba(255, 140, 0, 0.9)',
          color: 'white',
          padding: '12px',
          borderRadius: '6px',
          fontSize: '14px',
          maxWidth: '250px',
          zIndex: 1000
        }}>
          Zoom in for better vegetation detail. Optimal zoom level is 10+.
        </div>
      )}
    </div>
  );
};