import React, { useEffect, useRef, useState } from 'react';
// Lazy-load heavy map libraries to keep initial bundle small. The actual
// imports (mapbox-gl and mapbox-gl-draw) are performed inside the effect.
import type { LngLat } from 'mapbox-gl';
import { TrackAnalysis, AircraftSpec, VegetationAnalysis } from '../types/config';
import { analyzeTrackSlopes, getSlopeColor, calculateDistance } from '../utils/slopeCalculation';
import { analyzeTrackVegetation } from '../utils/vegetationAnalysis';
import { MAPBOX_TOKEN } from '../config/mapboxToken';
import { isTouchDevice } from '../utils/deviceDetection';
import { logger } from '../utils/logger';

// Utility
const toLatLng = (lngLat: LngLat) => ({ lat: lngLat.lat, lng: lngLat.lng });

const DEFAULT_CENTER: [number, number] = [147.0, -32.0];
const DEFAULT_ZOOM = 6;

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
  // Use any for dynamically loaded libs to avoid static type dependency
  const mapRef = useRef<any | null>(null);
  const drawRef = useRef<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  const [vegetationAnalysis, setVegetationAnalysis] = useState<VegetationAnalysis | null>(null);
  
  // Touch controls state and configuration
  // Automatically detect touch devices and show appropriate hints
  // Touch workflow: tap line tool -> tap points individually -> tap line tool again or press Enter to finish
  const [showTouchHint, setShowTouchHint] = useState(() => {
    try { return isTouchDevice(); } catch { return false; }
  });
  const [showVegetationZoomHint, setShowVegetationZoomHint] = useState(false);
  const [vegetationLayerEnabled, setVegetationLayerEnabled] = useState(false);
  
  // Aircraft drop markers state
  const dropMarkersRef = useRef<Map<string, mapboxgl.Marker[]>>(new Map());
  const mapLibRef = useRef<any>(null); // holds dynamically loaded mapboxgl module
  const [dropsVersion, setDropsVersion] = useState(0);

  // Initialize map relying solely on hosted style
  useEffect(() => {
    // mark effect body as async by creating and invoking an async function
    (async () => {
    if (!mapContainerRef.current || mapRef.current) return;
    // Dynamically import heavy map libraries so Vite can code-split them
    let mapboxgl: any = null;
    let MapboxDraw: any = null;
    try {
      // Load CSS side-effects via dynamic import
      await Promise.all([
        import('mapbox-gl/dist/mapbox-gl.css'),
        import('@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css')
      ]);
  mapboxgl = (await import('mapbox-gl')).default;
  MapboxDraw = (await import('@mapbox/mapbox-gl-draw')).default;
  mapLibRef.current = mapboxgl;
    } catch (err) {
      logger.error('Failed to load map libraries dynamically', err);
      setError('Failed to load mapping libraries.');
      return;
    }
    const token = MAPBOX_TOKEN;
    if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
      setError('Mapbox token missing. Set VITE_MAPBOX_ACCESS_TOKEN or VITE_MAPBOX_TOKEN.');
      return;
    }
  mapboxgl.accessToken = token;
  const styleURL = (import.meta as any).env?.VITE_MAPBOX_SATELLITE_STYLE || 'mapbox://styles/richardbt/cmf7esv62000n01qw0khz891t';
  logger.info(`Map init (hosted style only): ${styleURL}`);
  const map = new mapboxgl.Map({ container: mapContainerRef.current, style: styleURL, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, accessToken: token });
  mapRef.current = map;
    
    // Add standard Mapbox navigation controls (zoom, rotate, pitch)
    map.addControl(new mapboxgl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: true
    }), 'top-left');
    
    // Add full screen control
    map.addControl(new mapboxgl.FullscreenControl(), 'top-left');

  
    // Initialize MapboxDraw for drawing functionality
    // Configure for optimal touch experience: tap-by-tap point placement with separate finalization
  const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { line_string: true, trash: true },
      defaultMode: 'draw_line_string',
      // Touch-optimized options
      touchEnabled: true,
      touchBuffer: 25, // Larger touch target for mobile
      clickBuffer: 5,  // Smaller click buffer for precise mouse input
      styles: [
        { id: 'gl-draw-line', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff6b35', 'line-width': 4, 'line-opacity': 0.85 } },
        { id: 'gl-draw-vertex-halo-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 8, 'circle-color': '#FFF' } },
        { id: 'gl-draw-vertex-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 5, 'circle-color': '#ff6b35' } }
      ]
    });
    
    // Position the drawing tools in the top right with spacing for better visibility
    map.addControl(draw, 'top-right');

    // Add custom class to draw control container for enhanced styling and add labels
    setTimeout(() => {
      const drawContainer = document.querySelector('.mapboxgl-ctrl-top-right .mapbox-gl-draw_ctrl');
      if (drawContainer && drawContainer.parentElement) {
        drawContainer.parentElement.classList.add('mapboxgl-ctrl-group-draw');
      }
      
      // Apply custom styling to the draw buttons to make them more visible
      const lineStringBtn = document.querySelector('.mapbox-gl-draw_line');
      if (lineStringBtn) {
        const labelSpan = document.createElement('span');
        labelSpan.textContent = 'Draw';
        labelSpan.className = 'draw-button-label';
        lineStringBtn.appendChild(labelSpan);
      }
      
      const trashBtn = document.querySelector('.mapbox-gl-draw_trash');
      if (trashBtn) {
        const labelSpan = document.createElement('span');
        labelSpan.textContent = 'Delete';
        labelSpan.className = 'draw-button-label';
        trashBtn.appendChild(labelSpan);
      }
    }, 500);

    drawRef.current = draw;

    // Enhanced touch controls for better mobile experience
  if (isTouchDevice()) {
      // Add touch-specific event listeners for improved interaction
      let touchStartTime = 0;
      let touchStartTarget: EventTarget | null = null;
      
      map.getContainer().addEventListener('touchstart', (e: TouchEvent) => {
        touchStartTime = Date.now();
        touchStartTarget = e.target;
      }, { passive: true });
      
      map.getContainer().addEventListener('touchend', (e: TouchEvent) => {
        const touchDuration = Date.now() - touchStartTime;
        
        // Only treat as tap if touch was brief (< 300ms) and didn't move much
        if (touchDuration < 300 && touchStartTarget === e.target) {
          // On touch devices, provide better feedback for drawing actions
          const mode = draw.getMode();
          if (mode === 'draw_line_string') {
            // Add visual feedback for successful point placement
            const container = map.getContainer();
            const feedback = document.createElement('div');
            feedback.style.cssText = `
              position: absolute;
              pointer-events: none;
              background: #ff6b35;
              width: 8px;
              height: 8px;
              border-radius: 50%;
              z-index: 999;
              opacity: 0.8;
              animation: pulse 0.3s ease-out;
            `;
            
            // Position feedback at touch point (approximate)
            const rect = container.getBoundingClientRect();
            const touch = (e as TouchEvent).changedTouches[0];
            if (touch) {
              feedback.style.left = (touch.clientX - rect.left - 4) + 'px';
              feedback.style.top = (touch.clientY - rect.top - 4) + 'px';
            }
            
            container.appendChild(feedback);
            setTimeout(() => feedback.remove(), 300);
          }
        }
      }, { passive: true });
    }

    const handleLineChange = async (feature: any) => {
      if (!feature || feature.geometry?.type !== 'LineString') return;
      // mapboxgl.LngLat isn't available as a static import when loaded dynamically,
      // so construct simple objects compatible with downstream utilities instead
      const latlngs = feature.geometry.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
      const distance = calculateDistance(latlngs);
      setFireBreakDistance(distance);
      onDistanceChange(distance);
      await analyzeAndRender(latlngs);
      setDropsVersion(v => v + 1);
    };
    map.on('draw.create', (e: any) => handleLineChange(e.features[0]));
    map.on('draw.update', (e: any) => handleLineChange(e.features[0]));
    map.on('draw.delete', () => {
      setFireBreakDistance(null);
      onDistanceChange(null);
      if (map.getLayer('slope-segments')) map.removeLayer('slope-segments');
      if (map.getSource('slope-segments')) map.removeSource('slope-segments');
      onTrackAnalysisChange?.(null);
      onVegetationAnalysisChange?.(null);
      setDropsVersion(v => v + 1);
    });

    map.on('style.load', () => {
      const style = map.getStyle();
      logger.info(`Hosted style loaded (${(style.layers || []).length} layers)`);
    });
  map.on('error', (e: any) => { logger.error('Mapbox error', e); if (e?.error?.message?.includes('style')) setError('Failed to load hosted style.'); });
    return () => { map.remove(); };
    })();
  }, []);

  // Aircraft drop markers
  useEffect(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw || !selectedAircraftForPreview.length) {
      dropMarkersRef.current.forEach(mks => mks.forEach(m => m.remove()));
      dropMarkersRef.current.clear();
      return;
    }
    // clear existing
    dropMarkersRef.current.forEach(mks => mks.forEach(m => m.remove()));
    dropMarkersRef.current.clear();
    const features = draw.getAll();
    selectedAircraftForPreview.forEach(id => {
      const spec = aircraft.find(a => a.id === id); if (!spec) return;
      const dropLen = spec.dropLength || 1000;
      const markers: mapboxgl.Marker[] = [];
    features.features.forEach((f: any) => {
        if (f.geometry.type !== 'LineString') return;
        const coords = f.geometry.coordinates; if (coords.length < 2) return;
        const cumulative: { coord: [number,number]; dist: number }[] = []; let total=0; cumulative.push({ coord:[coords[0][0], coords[0][1]], dist:0 });
        for (let i=1;i<coords.length;i++){ const a=coords[i-1]; const b=coords[i]; const d=calculateDistance(a[1],a[0],b[1],b[0]); total+=d; cumulative.push({ coord:[b[0],b[1]], dist: total }); }
        for (let d = dropLen; d <= total; d += dropLen) {
          // Find the index of the first cumulative distance >= d
          let idx = cumulative.findIndex(c => c.dist >= d);
          if (idx === -1) idx = cumulative.length - 1;
          const after = cumulative[idx];
          const before = cumulative[Math.max(0, idx - 1)];
          const segmentLength = after.dist - before.dist || 1;
          const t = (d - before.dist) / segmentLength;
          const lng = before.coord[0] + (after.coord[0] - before.coord[0]) * t;
          const lat = before.coord[1] + (after.coord[1] - before.coord[1]) * t;

          // Create marker element
          const markerElement = document.createElement('div');
          markerElement.className = 'aircraft-drop-marker';

          // Create and add marker to map
          // Use the dynamically-loaded Mapbox constructor from mapLibRef when available
          const MarkerCtor = mapLibRef.current?.Marker;
          if (!MarkerCtor) return;
          const marker = new MarkerCtor(markerElement)
            .setLngLat([lng, lat])
            .addTo(map);
          markers.push(marker);
        }
      });
      dropMarkersRef.current.set(id, markers);
    });
  }, [selectedAircraftForPreview, aircraft, dropsVersion]);

  // Analysis + rendering
  const analyzeAndRender = async (latlngs: any[]) => {
    setIsAnalyzing(true); onAnalyzingChange?.(true);
    try {
      const slope = await analyzeTrackSlopes(latlngs);
      onTrackAnalysisChange?.(slope);
      let veg: VegetationAnalysis | null = null;
      try { veg = await analyzeTrackVegetation(latlngs); onVegetationAnalysisChange?.(veg); } catch (e) { logger.warn('Vegetation analysis failed', e); }
      renderSlopeSegments(slope);
    } catch (e) {
      logger.error('Slope analysis failed', e); setError('Slope analysis failed');
    } finally {
      setIsAnalyzing(false); onAnalyzingChange?.(false);
    }
  };

  const renderSlopeSegments = (analysis: TrackAnalysis) => {
    const map = mapRef.current; if (!map) return;
    if (map.getLayer('slope-segments')) map.removeLayer('slope-segments');
    if (map.getSource('slope-segments')) map.removeSource('slope-segments');
    const features = analysis.segments.map((seg,i)=>({
      type:'Feature' as const,
      properties:{ slope:seg.slope, category:seg.category, distance:seg.distance, elevationChange:Math.abs(seg.endElevation-seg.startElevation), color:getSlopeColor(seg.category), index:i },
      geometry:{ type:'LineString' as const, coordinates:(seg.coords && seg.coords.length>=2? seg.coords.map(c=>[c[1],c[0]]): [[seg.start[1],seg.start[0]],[seg.end[1],seg.end[0]]]) }
    }));
    map.addSource('slope-segments',{ type:'geojson', data:{ type:'FeatureCollection', features } } as any);
    map.addLayer({ id:'slope-segments', type:'line', source:'slope-segments', layout:{ 'line-join':'round','line-cap':'round'}, paint:{ 'line-color':['get','color'], 'line-width':6, 'line-opacity':0.8 } });
  };

  return (
    <div className="mapbox-map-container">
      <div ref={mapContainerRef} className="mapbox-map" />
      {error && (
        <div className="map-error-overlay">
          <strong>Map Error</strong>
          {error}
        </div>
      )}
      {showTouchHint && (
        <div className="touch-hint-overlay">
          Tap to add points, double‑tap to finish.
          <button onClick={() => setShowTouchHint(false)}>×</button>
        </div>
      )}
      {isAnalyzing && (
        <div className="analyzing-badge">Analyzing…</div>
      )}
      {fireBreakDistance!=null && (
        <div className="distance-badge">Distance: {Math.round(fireBreakDistance)} m</div>
      )}
    </div>
  );
};

export default MapboxMapView;
