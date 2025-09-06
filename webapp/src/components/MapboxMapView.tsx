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

// --- Diagnostic helpers ----------------------------------------------------
/**
 * Attempt to fetch the raw style JSON (if it is a Mapbox style URL) so we can
 * log why sources might be empty. For security reasons Mapbox GL JS normally
 * does this internally; we replicate in a best‑effort manner using the Styles API.
 */
async function diagnoseStyleJSON(styleURL: string, token: string) {
  try {
    if (!styleURL.startsWith('mapbox://styles/')) {
      logger.info('diagnoseStyleJSON: Non mapbox:// style skipped');
      return;
    }
    // styleURL format: mapbox://styles/{user}/{style_id}
    const parts = styleURL.replace('mapbox://styles/', '').split('/');
    if (parts.length !== 2) return;
    const user = parts[0];
    const styleId = parts[1];
    const apiURL = `https://api.mapbox.com/styles/v1/${user}/${styleId}?access_token=${token}`;
    const resp = await fetch(apiURL);
    if (!resp.ok) {
      logger.warn(`diagnoseStyleJSON: Failed fetching style JSON (${resp.status})`);
      return;
    }
    const json = await resp.json();
    const srcKeys = Object.keys(json.sources || {});
    const layerCount = Array.isArray(json.layers) ? json.layers.length : 0;
    logger.info(`diagnoseStyleJSON: Raw style sources: ${srcKeys.length} [${srcKeys.join(', ')}], layers: ${layerCount}`);
    if (srcKeys.length === 0) {
      logger.warn('diagnoseStyleJSON: Style JSON truly has zero sources. Style in Studio may be empty or private.');
    }
  } catch (err) {
    logger.error('diagnoseStyleJSON: Error while diagnosing style JSON', err);
  }
}

/**
 * Build and set a composite fallback style (satellite imagery + terrain + hillshade + contours)
 * so the application remains functional when the custom Studio style fails or is empty.
 */
function injectFallbackCompositeStyle(map: mapboxgl.Map) {
  try {
    const fallbackStyle = {
      version: 8,
      name: 'Fallback Satellite Terrain',
      sources: {
        'satellite': {
          type: 'raster',
          url: 'mapbox://mapbox.satellite',
          tileSize: 256
        },
        'mapbox-dem': {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14
        },
        'contours': {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-terrain-v2'
        }
      },
      sprite: 'mapbox://sprites/mapbox/streets-v12',
      glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#000' } },
        { id: 'satellite-base', type: 'raster', source: 'satellite', paint: { 'raster-opacity': 1 } },
        { id: 'hillshade', type: 'hillshade', source: 'mapbox-dem', paint: { 'hillshade-exaggeration': 0.25 } },
        { id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contour', paint: { 'line-color': '#877b59', 'line-width': 1, 'line-opacity': 0.55 } }
      ]
    } as any; // minimal specification to satisfy runtime; not exporting as strongly typed
    map.setStyle(fallbackStyle);
    logger.info('Injected fallback composite style with satellite + terrain + contours');
  } catch (err) {
    logger.error('Failed to inject fallback composite style', err);
  }
}

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
  const [currentStyle, setCurrentStyle] = useState('satellite');
  // Keep a ref in sync with currentStyle so event handlers (registered once) see latest value
  const currentStyleRef = useRef(currentStyle);
  useEffect(() => { currentStyleRef.current = currentStyle; }, [currentStyle]);
  
  // Track whether we've already attempted a manual fallback style inject to avoid loops
  const fallbackInjectedRef = useRef(false);
  // Count style load attempts for diagnostics
  const styleLoadAttemptsRef = useRef(0);
  // Ensure contour source/layers exist (idempotent)
  const ensureContoursLayer = (map: mapboxgl.Map) => {
    // Base (minor) contour lines
    if (!map.getLayer('contour-lines') && map.getSource('contours')) {
      try {
        map.addLayer({
          id: 'contour-lines',
          type: 'line',
          source: 'contours',
          'source-layer': 'contour',
          minzoom: 8,
          paint: {
            'line-color': '#b6a17a',
            'line-width': ['interpolate',['linear'],['zoom'],8,0.3,12,0.8,14,1.2,16,2],
            'line-opacity': 0.6
          }
        });
        logger.info('ensureContoursLayer: added contour-lines layer');
      } catch (err) { logger.warn('ensureContoursLayer: failed adding contour-lines', err); }
    }
    // Major contour lines
    if (!map.getLayer('contour-lines-major') && map.getSource('contours')) {
      try {
        map.addLayer({
          id: 'contour-lines-major',
          type: 'line',
            source: 'contours',
            'source-layer': 'contour',
            minzoom: 8,
            filter: ['all', ['==',['get','index'],1]],
            paint: {
              'line-color': '#8c774e',
              'line-width': ['interpolate',['linear'],['zoom'],8,0.6,12,1.2,14,1.6,16,2.4],
              'line-opacity': 0.75
            }
        });
        logger.info('ensureContoursLayer: added contour-lines-major layer');
      } catch (err) { logger.warn('ensureContoursLayer: failed adding contour-lines-major', err); }
    }
  };
  // Unified helper to add terrain + contours; used on style load and checkbox toggle
  const addTerrainAndContours = (map: mapboxgl.Map) => {
    if (!map) return;
    // DEM source
    if (!map.getSource('mapbox-dem')) {
      try {
        map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
        logger.info('addTerrainAndContours: raster-dem source added');
      } catch (e) { logger.warn('addTerrainAndContours: DEM add failed (maybe exists)', e); }
    }
    // Hillshade layer
    if (!map.getLayer('hillshade')) {
      try {
        map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'mapbox-dem', paint: { 'hillshade-exaggeration': 0.25 } });
        logger.info('addTerrainAndContours: hillshade layer added');
      } catch (e) { logger.warn('addTerrainAndContours: hillshade add failed', e); }
    }
    // Contours source
    if (!map.getSource('contours')) {
      try { map.addSource('contours', { type: 'vector', url: 'mapbox://mapbox.mapbox-terrain-v2' }); logger.info('addTerrainAndContours: contours source added'); } catch (e) { logger.warn('addTerrainAndContours: contours source failed', e); }
    }
    // Layers
    ensureContoursLayer(map);
    // Ensure visibility
    ['hillshade','contour-lines','contour-lines-major'].forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id,'visibility','visible'); });
  };
  
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
  const envCustomStyle = (import.meta as any).env?.VITE_MAPBOX_SATELLITE_STYLE as string | undefined;
  const customStyleURL = envCustomStyle || 'mapbox://styles/richardbt/cmf7esv62000n01qw0khz891t';
    logger.info(`Initializing map with custom satellite style: ${customStyleURL}`);
    
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: customStyleURL, // Custom satellite style with contours
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

    // Handle style loading and setup layers
  map.on('style.load', async () => {
      const style = map.getStyle();
      logger.info(`Style loaded: ${style.name || 'Unknown'}`);
      logger.info(`Style metadata:`, style.metadata);
      logger.info(`Style sources:`, Object.keys(style.sources || {}));
      logger.info(`Style layers:`, (style.layers || []).map(l => l.id));
      styleLoadAttemptsRef.current += 1;
      
      // If sources are unexpectedly empty, perform deep diagnostics & potential fallback build
      if (Object.keys(style.sources || {}).length === 0) {
        logger.warn('⚠ Style has zero sources after load. Running diagnostics...');
        await diagnoseStyleJSON(customStyleURL, MAPBOX_TOKEN!);
        // Schedule a re-check after a brief delay to allow imported style components to resolve
        setTimeout(async () => {
          const postDelayStyle = map.getStyle();
            const srcCount = Object.keys(postDelayStyle.sources || {}).length;
            if (srcCount === 0 && !fallbackInjectedRef.current) {
              logger.warn('⚠ Style still has no sources after delay. Injecting programmatic fallback satellite + terrain style.');
              injectFallbackCompositeStyle(map);
              fallbackInjectedRef.current = true;
            }
        }, 750);
      }
      
      // Verify the style is the expected custom style when satellite is selected
  if (currentStyleRef.current === 'satellite') {
        const styleURL = style.sprite;
        logger.info(`Satellite style loaded, sprite URL: ${styleURL}`);
        // Proactively attempt to add terrain + contours shortly after style load
        setTimeout(() => { try { addTerrainAndContours(map); } catch (e) { logger.warn('Deferred addTerrainAndContours failed', e); } }, 300);
        
        // Check if contour/elevation related sources are present
        const sources = style.sources || {};
        const contourSources = Object.keys(sources).filter(key => 
          key.includes('contour') || key.includes('elevation') || key.includes('hillshade') ||
          key.includes('terrain') || key.includes('mapbox-dem') || key.includes('mapbox-terrain')
        );
        logger.info(`Contour-related sources found:`, contourSources);
        
        // Check if contour/elevation related layers are present
        const layers = style.layers || [];
        const contourLayers = layers.filter(layer => 
          layer.id.includes('contour') || layer.id.includes('elevation') || layer.id.includes('hillshade') ||
          layer.id.includes('terrain') || layer.id.includes('slope')
        );
        logger.info(`Contour-related layers found:`, contourLayers.map(l => ({ id: l.id, type: l.type })));
        
        // Log all satellite layer IDs for debugging
        logger.info(`All layer IDs in satellite style:`, layers.map(l => ({ id: l.id, type: l.type })));
        
        // Specific check for terrain/elevation data
  if (contourSources.length === 0 && contourLayers.length === 0) {
          logger.warn('⚠ No contour-related sources or layers found in the custom satellite style!');
          logger.warn('This might indicate the style does not include contour/elevation data.');
          logger.warn('Consider checking the Mapbox Studio style configuration.');
          
          // Add fallback contour data from Mapbox terrain source
          logger.info('Adding fallback contour data to ensure visibility...');
          
          try {
            // Add Mapbox terrain source if not present
            if (!map.getSource('mapbox-dem')) {
              map.addSource('mapbox-dem', {
                type: 'raster-dem',
                url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
                tileSize: 512,
                maxzoom: 14
              });
            }
            
            // Add hillshade layer for terrain visualization
            if (!map.getLayer('hillshade')) {
              map.addLayer({
                id: 'hillshade',
                type: 'hillshade',
                source: 'mapbox-dem',
                layout: {},
                paint: {
                  'hillshade-shadow-color': '#473B24',
                  'hillshade-highlight-color': '#FFFFFF',
                  'hillshade-exaggeration': 0.25
                }
              });
            }
            
            logger.info('✓ Added fallback terrain visualization');
          } catch (error) {
            logger.error('Failed to add fallback terrain data:', error);
          }
        } else {
          logger.info(`✓ Found ${contourSources.length} contour sources and ${contourLayers.length} contour layers`);
        }
      }
      
      // Add NSW vegetation WMS layer as a raster source
      if (!map.getSource('nsw-vegetation')) {
        map.addSource('nsw-vegetation', {
          type: 'raster',
          tiles: [
            'https://mapprod3.environment.nsw.gov.au/arcgis/services/VIS/SVTM_NSW_Extant_PCT/MapServer/WMSServer?bbox={bbox-epsg-3857}&format=image/png&service=WMS&version=1.1.1&request=GetMap&srs=EPSG:3857&transparent=true&width=256&height=256&layers=3'
          ],
          tileSize: 256
        });
      }

      // Add vegetation layer (preserve previous visibility state)
      // Insert vegetation layer BEFORE any contour layers to ensure contours stay visible
      if (!map.getLayer('nsw-vegetation-layer')) {
        // Find the first contour/elevation/hillshade layer to insert vegetation before it
        const layers = map.getStyle().layers || [];
        let beforeLayer: string | undefined = undefined;
        
        for (const layer of layers) {
          if (layer.id.includes('contour') || layer.id.includes('elevation') || layer.id.includes('hillshade')) {
            beforeLayer = layer.id;
            logger.info(`Inserting vegetation layer before contour layer: ${beforeLayer}`);
            break;
          }
        }
        
        if (!beforeLayer) {
          // If no contour layers found, insert before any satellite/raster layers
          for (const layer of layers) {
            if (layer.type === 'raster' || layer.id.includes('satellite')) {
              beforeLayer = layer.id;
              logger.info(`Inserting vegetation layer before raster layer: ${beforeLayer}`);
              break;
            }
          }
        }
        
        map.addLayer({
          id: 'nsw-vegetation-layer',
          type: 'raster',
          source: 'nsw-vegetation',
          layout: {
            visibility: vegetationLayerEnabled ? 'visible' : 'none'
          },
          paint: {
            'raster-opacity': 0.7
          }
        }, beforeLayer); // Insert before the specified layer to keep contours on top
        
        // Log layer order after adding vegetation layer
        const layerIds = map.getStyle().layers?.map(l => l.id) || [];
        logger.info(`Layer order after adding vegetation layer:`, layerIds);
        
        // Check if vegetation layer might be hiding contours
        const vegetationLayerIndex = layerIds.indexOf('nsw-vegetation-layer');
        const contourLayerIndices = layerIds
          .map((id, index) => ({ id, index }))
          .filter(item => item.id.includes('contour') || item.id.includes('elevation') || item.id.includes('hillshade'))
          .map(item => item.index);
        
        if (contourLayerIndices.length > 0) {
          logger.info(`Contour layers found at indices: ${contourLayerIndices}, vegetation at: ${vegetationLayerIndex}`);
          if (vegetationLayerIndex > Math.max(...contourLayerIndices)) {
            logger.warn(`Vegetation layer (index ${vegetationLayerIndex}) may be covering contour layers (indices ${contourLayerIndices})`);
          } else {
            logger.info(`✓ Vegetation layer properly positioned below contour layers`);
          }
        } else {
          logger.warn(`No contour-related layers found in the current style`);
        }
      }

      // Add layer control only if it doesn't exist
      if (!map.getContainer().querySelector('.layer-control-container')) {
  addLayerControl(map);
      }
    });

    // Add specific error handling for style loading
    map.on('styleloadstart', () => {
      logger.info(`Loading style for ${currentStyle} view...`);
    });

    map.on('styleimagemissing', (e) => {
      logger.warn('Style image missing:', e.id);
    });

    // Add data loading verification
    map.on('styledata', (e) => {
      if (e.dataType === 'style') {
        logger.info(`Style data loaded for ${currentStyle} view`);
        
        // Verify custom satellite style is properly loaded
        if (currentStyleRef.current === 'satellite') {
          const style = map.getStyle();
          const metaAny: any = style.metadata || {};
          const styleId = metaAny['mapbox:id'] || metaAny['id'] || (style as any).id || 'unknown';
          logger.info(`Satellite style ID: ${styleId}`);
          
          // Check if this matches our expected custom style
          if (styleId.includes('cmf7esv62000n01qw0khz891t') || styleId.includes('richardbt')) {
            logger.info('✓ Custom satellite style with contours loaded successfully');
          } else {
            logger.warn(`⚠ Unexpected style loaded: ${styleId}, expected: cmf7esv62000n01qw0khz891t`);
            // Attempt to extract style id from sprite URL if available
            if (style.sprite) {
              try {
                const spriteMatch = /styles\/([^/]+)\/([a-z0-9]+)\//i.exec(style.sprite);
                if (spriteMatch) {
                  logger.info(`Derived owner from sprite: ${spriteMatch[1]}, style id: ${spriteMatch[2]}`);
                }
              } catch (_) { /* ignore */ }
            }
          }
        }
      }
    });

    // Handle errors
    map.on('error', (e) => {
      logger.error('Mapbox GL error:', e);
      
      // Provide more specific error handling for different error types
      if (e.error && e.error.message) {
        if (e.error.message.includes('style') || e.error.message.includes('unauthorized')) {
          setError('Failed to load map style. Please check that the Mapbox style URL is accessible and the token has proper permissions.');
          
          // Important: Don't fallback to a different style automatically as this might hide the real issue
          logger.error('Custom satellite style failed to load - keeping error visible for debugging');
        } else {
          setError('Map failed to load. Please check your connection and try again.');
        }
      } else {
        setError('Map failed to load. Please check your connection and try again.');
      }
    });

    // Add data loading error handler specifically for style issues
    map.on('dataloading', (e) => {
      if ('sourceDataType' in e && e.sourceDataType === 'visibility') {
        logger.debug(`Data loading: ${('sourceId' in e) ? e.sourceId : 'unknown'} - ${e.sourceDataType}`);
      }
    });

    map.on('sourcedata', (e) => {
      if ('sourceId' in e && e.sourceId === 'composite' && 'isSourceLoaded' in e && e.isSourceLoaded) {
        logger.info('Base style tiles loaded successfully');
      }
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
    layerControl.className = 'mapboxgl-ctrl mapboxgl-ctrl-group layer-control-container';
    layerControl.style.background = 'white';
    layerControl.style.padding = '10px';
    layerControl.style.borderRadius = '4px';
    layerControl.style.border = '1px solid #2a3442';
    layerControl.style.color = '#f5f7fa';
    layerControl.style.backdropFilter = 'blur(8px)';
    (layerControl.style as any).webkitBackdropFilter = 'blur(8px)';
    layerControl.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    
    layerControl.innerHTML = `
      <div style="margin-bottom: 8px;">

        <label style="display: block; margin-bottom: 4px;">
          <input type="radio" name="basemap" value="satellite" ${currentStyle === 'satellite' ? 'checked' : ''}> Satellite (Contours)
        </label>
        <label style="display: block;">
          <input type="radio" name="basemap" value="streets" ${currentStyle === 'streets' ? 'checked' : ''}> Streets
        </label>
      </div>
      <div style="margin-bottom: 8px;">
        <label style="display: block;">
          <input type="checkbox" id="vegetation-toggle" ${vegetationLayerEnabled ? 'checked' : ''}> NSW Vegetation

        </label>
        <label style="display: block;">
          <input type="checkbox" id="terrain-toggle" checked> Terrain/Contours
        </label>
      </div>
      <div style="border-top: 1px solid #ddd; padding-top: 8px;">
        <button id="debug-style" style="font-size: 11px; padding: 2px 6px; cursor: pointer;">Debug Style</button>
      </div>
    `;

    // Handle basemap switching
    const basemapRadios = layerControl.querySelectorAll('input[name="basemap"]');
    basemapRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.value === 'satellite') {
          logger.info('Switching to satellite style with contours');
          setCurrentStyle('satellite');
          const customStyleURL = 'mapbox://styles/richardbt/cmf7esv62000n01qw0khz891t';
          logger.info(`Loading custom satellite style: ${customStyleURL}`);
          map.setStyle(customStyleURL);
        } else if (target.value === 'streets') {
          logger.info('Switching to streets style');
          setCurrentStyle('streets');
          map.setStyle('mapbox://styles/mapbox/streets-v12');
        }
      });
    });

    // Handle terrain/contours layer toggle (improved)
    const terrainToggle = layerControl.querySelector('#terrain-toggle') as HTMLInputElement;
    terrainToggle.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.checked) {
        addTerrainAndContours(map);
      } else {
        ['hillshade','contour-lines','contour-lines-major'].forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id,'visibility','none'); });
      }
    });

    // Handle vegetation layer toggle
    const vegetationToggle = layerControl.querySelector('#vegetation-toggle') as HTMLInputElement;
    vegetationToggle.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const visibility = target.checked ? 'visible' : 'none';
      
      setVegetationLayerEnabled(target.checked);
      
      if (map.getLayer('nsw-vegetation-layer')) {
        map.setLayoutProperty('nsw-vegetation-layer', 'visibility', visibility);
        
        if (target.checked && map.getZoom() < 10) {
          setShowVegetationZoomHint(true);
          setTimeout(() => setShowVegetationZoomHint(false), 10000);
        }
      }
    });

    // Handle debug style button
    const debugButton = layerControl.querySelector('#debug-style') as HTMLButtonElement;
    debugButton.addEventListener('click', () => {
      const style = map.getStyle();
      logger.info('=== STYLE DEBUG REPORT ===');
      logger.info(`Style Name: ${style.name || 'Unknown'}`);
  const dbgMeta: any = style.metadata || {};
  logger.info(`Style ID: ${dbgMeta['mapbox:id'] || dbgMeta['id'] || 'Unknown'}`);
      logger.info(`Current zoom: ${map.getZoom()}`);
      logger.info(`Current center: ${map.getCenter().lng}, ${map.getCenter().lat}`);
      
      // Check all sources
      const sources = style.sources || {};
      logger.info(`Sources (${Object.keys(sources).length}):`, Object.keys(sources));
      
      // Check all layers with types
      const layers = style.layers || [];
      logger.info(`Layers (${layers.length}):`);
      layers.forEach((layer, index) => {
        const contourRelated = layer.id.includes('contour') || layer.id.includes('elevation') || layer.id.includes('hillshade');
        logger.info(`  ${index}: ${layer.id} (${layer.type})${contourRelated ? ' [CONTOUR-RELATED]' : ''}`);
      });
      
      // Check specifically for contour patterns
      const contourLayers = layers.filter(l => 
        l.id.includes('contour') || l.id.includes('elevation') || l.id.includes('hillshade') ||
        l.id.includes('terrain') || l.id.includes('topo')
      );
      logger.info(`Potential contour layers found: ${contourLayers.length}`);
      contourLayers.forEach(layer => {
        logger.info(`  Contour layer: ${layer.id} (${layer.type})`);
      });
      
      // Check for added terrain layers
      const addedTerrainLayers = ['hillshade', 'contour-lines'];
      addedTerrainLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
          const visibility = map.getLayoutProperty(layerId, 'visibility') || 'visible';
          logger.info(`  Added terrain layer: ${layerId} (visibility: ${visibility})`);
        }
      });
      
      // Check vegetation layer position
      const vegIndex = layers.findIndex(l => l.id === 'nsw-vegetation-layer');
      if (vegIndex >= 0) {
        logger.info(`Vegetation layer position: ${vegIndex} of ${layers.length}`);
      }
      
      logger.info('=== END DEBUG REPORT ===');
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