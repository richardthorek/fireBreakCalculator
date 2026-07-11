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
import { SearchControl } from './SearchControl';

// Utility
const toLatLng = (lngLat: LngLat) => ({ lat: lngLat.lat, lng: lngLat.lng });

/** Bounding box [[minLng,minLat],[maxLng,maxLat]] of all coordinates in a GeoJSON object. */
const geojsonBounds = (geojson: any): [[number, number], [number, number]] | null => {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const visit = (coords: any) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(visit);
    }
  };
  const features = geojson?.type === 'FeatureCollection' ? geojson.features : [geojson];
  for (const f of features ?? []) visit(f?.geometry?.coordinates);
  if (!isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
};

const DEFAULT_CENTER: [number, number] = [147.0, -32.0];
const DEFAULT_ZOOM = 6;

interface MapboxMapViewProps {
  onDistanceChange: (distance: number | null) => void;
  onTrackAnalysisChange?: (analysis: TrackAnalysis | null) => void;
  onVegetationAnalysisChange?: (analysis: VegetationAnalysis | null) => void;
  onAnalyzingChange?: (isAnalyzing: boolean) => void;
  selectedAircraftForPreview?: string[];
  aircraft?: AircraftSpec[];
  onSearchLocationSelected?: (location: { lat: number; lng: number; label: string }) => void;
  onUserLocationChange?: (location: { lat: number; lng: number } | undefined) => void;
  /** Callback invoked once the map has attempted initial auto-locate and the initial
   *  pan/zoom (or a reasonable fallback) has completed. Use this to delay heavy
   *  analysis until the map view is settled on the user's location. */
  onInitialLocationSettled?: (settled: boolean) => void;
  /** If provided, the map will use this prefetched location immediately on init
   *  to pan/zoom as soon as the Map instance is ready. This helps avoid waiting
   *  for permission checks inside the map lifecycle and reduces perceived delay. */
  initialUserLocation?: { lat: number; lng: number } | null;
  // Optional externally-controlled search selection — when provided the map should
  // pan/zoom to this location. This is used so header search control can trigger map moves.
  selectedSearchLocation?: { lat: number; lng: number; label: string } | null;
  /** Emits the drawn line's ordered vertices (or null when cleared) for export/sharing. */
  onLineChange?: (coords: { lat: number; lng: number }[] | null) => void;
  /** A plan line to restore on load (e.g. from a shared link). Drawn + analysed once. */
  initialLine?: { lat: number; lng: number }[] | null;
  /** Coordinates of a line slice to highlight (insight "show on map" / segment locate). */
  highlightCoords?: { lat: number; lng: number }[] | null;
  /** Synced marker for the elevation-profile hover position. */
  hoverPoint?: { lat: number; lng: number } | null;
  /** Optimized-route preview coordinates (rendered as a dashed line until applied). */
  optimizedPreview?: { lat: number; lng: number }[] | null;
  /** When set (version bumps), replace the drawn line with these coords and re-analyse. */
  applyLineRequest?: { coords: { lat: number; lng: number }[]; version: number } | null;
  /** Imported reference overlays (fire perimeters, other lines) — non-editable context. */
  contextOverlays?: { id: string; name: string; geojson: any }[];
  /** True while the route optimizer is actively searching — drives the
   *  corridor scanning sweep animation (skipped under reduced motion). */
  optimizerScanning?: boolean;
  /** Cost-normalised hex cells from the optimizer's widest search pass —
   *  rendered as a smooth green→amber→red suitability heatmap once ready. */
  optimizerHeatmap?: {
    polygon: { lat: number; lng: number }[];
    costNormalized: number;
  }[] | null;
}

export const MapboxMapView: React.FC<MapboxMapViewProps> = ({
  onDistanceChange,
  onTrackAnalysisChange,
  onVegetationAnalysisChange,
  onAnalyzingChange,
  selectedAircraftForPreview = [],
  aircraft = [],
  onSearchLocationSelected,
  onUserLocationChange
  ,
  onInitialLocationSettled
  ,
  initialUserLocation = null,
  selectedSearchLocation,
  onLineChange,
  initialLine = null,
  highlightCoords = null,
  hoverPoint = null,
  optimizedPreview = null,
  applyLineRequest = null,
  contextOverlays = [],
  optimizerScanning = false,
  optimizerHeatmap = null
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
  // Locating state for geolocation UX
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);
  
  // Notify parent when user location changes
  useEffect(() => {
    if (onUserLocationChange) {
      onUserLocationChange(userLocation);
    }
  }, [userLocation, onUserLocationChange]);
  
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
  const locationMarkerRef = useRef<any | null>(null);
  const mapLibRef = useRef<any>(null); // holds dynamically loaded mapboxgl module
  // Ensure we only signal initial location settled once to avoid duplicate
  // work triggered when fitBounds and later easeTo/moveend both fire.
  const initialSettledSignalledRef = useRef(false);
  const [dropsVersion, setDropsVersion] = useState(0);
  // Exposes the init-scoped line-change handler to prop-driven effects
  // (optimized-route apply) so they can trigger the same analysis pipeline.
  const handleLineChangeRef = useRef<((feature: any) => void) | null>(null);
  const appliedLineVersionRef = useRef(0);
  // Latest drawn line, kept outside React state so the scan-sweep animation
  // (a rAF loop, not a render) can read the current envelope every frame.
  const lastLineCoordsRef = useRef<{ lat: number; lng: number }[] | null>(null);
  // WCAG 2.1 reduced-motion preference, checked once — the corridor scan
  // sweep is pure decoration and is skipped entirely when the user has
  // asked for less motion (the heatmap itself still appears, just without
  // an animated fade).
  const reducedMotionRef = useRef(false);
  useEffect(() => {
    try { reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  }, []);

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
    // If the parent prefetched the user's location, use it immediately to
    // reduce the time-to-move. Otherwise fall back to permission-based check.
    if (initialUserLocation && initialUserLocation.lat && initialUserLocation.lng) {
      // apply the same centering logic used by the geolocation result
      const { lat: latitude, lng: longitude } = initialUserLocation;
      const userLngLat: [number, number] = [longitude, latitude];
      // place marker and fit bounds like tryRequestLocation does
      try {
        if (locationMarkerRef.current) { try { locationMarkerRef.current.remove(); } catch {} }
        const el = document.createElement('div'); el.className = 'user-location-marker'; const pulse = document.createElement('div'); pulse.className = 'user-location-pulse'; el.appendChild(pulse);
        const MarkerCtor = mapLibRef.current?.Marker || (mapboxgl as any).Marker;
        const marker = new MarkerCtor(el).setLngLat(userLngLat).addTo(map);
        locationMarkerRef.current = marker;

        // compute sample bbox like tryRequestLocation (approx 10km)
        const radius = 10000; const R = 6378137; const latRad = latitude * Math.PI / 180; const angularDistance = radius / R; const samples = 64;
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (let i = 0; i < samples; i++) {
          const theta = (i / samples) * (Math.PI * 2);
          const latOffset = Math.asin(Math.sin(latitude * Math.PI / 180) * Math.cos(angularDistance) + Math.cos(latitude * Math.PI / 180) * Math.sin(angularDistance) * Math.cos(theta));
          const lonOffset = (longitude * Math.PI / 180) + Math.atan2(Math.sin(theta) * Math.sin(angularDistance) * Math.cos(latitude * Math.PI / 180), Math.cos(angularDistance) - Math.sin(latitude * Math.PI / 180) * Math.sin(latOffset));
          const sampleLat = latOffset * 180 / Math.PI;
          const sampleLng = lonOffset * 180 / Math.PI;
          if (sampleLng < minLng) minLng = sampleLng; if (sampleLng > maxLng) maxLng = sampleLng; if (sampleLat < minLat) minLat = sampleLat; if (sampleLat > maxLat) maxLat = sampleLat;
        }

        if (!isFinite(minLng) || !isFinite(minLat)) {
          map.setCenter(userLngLat); map.setZoom(12);
          if (!initialSettledSignalledRef.current) { initialSettledSignalledRef.current = true; onInitialLocationSettled?.(true); }
        } else {
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, duration: 1000 });
        }
        map.once('moveend', () => {
          try { map.easeTo({ pitch: 40, bearing: 0, duration: 1000 }); } catch (e) {}
          if (!initialSettledSignalledRef.current) { initialSettledSignalledRef.current = true; onInitialLocationSettled?.(true); }
        });
        setUserLocation({ lat: latitude, lng: longitude });
      } catch (err) {
        // ignore prefetched location errors and fall back to permission logic below
      }
    } else {
      (async () => {
        try {
          if ((navigator as any).permissions && (navigator as any).permissions.query) {
            const p = await (navigator as any).permissions.query({ name: 'geolocation' });
            if (p.state === 'granted') {
              tryRequestLocation();
            }
          }
        } catch (e) {
          // ignore permission check failures
        }
      })();
    }
    
    // Add standard Mapbox navigation controls (zoom, rotate, pitch)
    map.addControl(new mapboxgl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: true
    }), 'top-left');
    
    // Add full screen control
    map.addControl(new mapboxgl.FullscreenControl(), 'top-left');

    // Add custom geolocate button/control to request user location on demand
    const geolocateControl = {
      onAdd: function(m: any) {
        const container = document.createElement('div');
        container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group geolocate-control';
        const btn = document.createElement('button');
        btn.className = 'mapbox-geolocate-btn';
        btn.title = 'Center map on your location';
        btn.setAttribute('aria-label', 'Center map on your location');
        btn.innerHTML = '📍';
        btn.onclick = () => {
          // request location when button clicked
          tryRequestLocation();
        };
        container.appendChild(btn);
        return container;
      },
      onRemove: function() {}
    };
    map.addControl(geolocateControl, 'top-left');

  // If permission was already granted previously, try to auto-locate
  const tryAutoLocate = async () => {
      try {
        if ((navigator as any).permissions && (navigator as any).permissions.query) {
          const p = await (navigator as any).permissions.query({ name: 'geolocation' });
          if (p.state === 'granted') {
            tryRequestLocation();
          }
        }
      } catch (e) {
        // ignore
      }
    };
    tryAutoLocate();

    // Helper: request browser geolocation and handle the result
    function tryRequestLocation() {
      if (!navigator.geolocation) {
        setLocationError('Geolocation not supported by this browser');
        return;
      }
      // show transient locating UI
      setIsLocating(true);
      setLocationError(null);
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        // center map and add pulsing marker
        const userLngLat: [number, number] = [longitude, latitude];
        // remove existing marker
        if (locationMarkerRef.current) {
          try { locationMarkerRef.current.remove(); } catch {}
          locationMarkerRef.current = null;
        }

        // Create pulsing marker element
        const el = document.createElement('div');
        el.className = 'user-location-marker';
        const pulse = document.createElement('div');
        pulse.className = 'user-location-pulse';
        el.appendChild(pulse);

        // Use Mapbox Marker constructor from dynamically loaded lib if available
        const MarkerCtor = mapLibRef.current?.Marker || (mapboxgl as any).Marker;
        const marker = new MarkerCtor(el).setLngLat(userLngLat).addTo(map);
        locationMarkerRef.current = marker;

        // Build a circular sample of points ~10km from center, compute bbox and fit bounds.
        const radius = 10000; // meters
        const R = 6378137; // earth radius in m
        const latRad = latitude * Math.PI / 180;
        const angularDistance = radius / R; // in radians
        const samples = 64;
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (let i = 0; i < samples; i++) {
          const theta = (i / samples) * (Math.PI * 2);
          // approximate offsets
          const latOffset = Math.asin(Math.sin(latitude * Math.PI / 180) * Math.cos(angularDistance) + Math.cos(latitude * Math.PI / 180) * Math.sin(angularDistance) * Math.cos(theta));
          const lonOffset = (longitude * Math.PI / 180) + Math.atan2(Math.sin(theta) * Math.sin(angularDistance) * Math.cos(latitude * Math.PI / 180), Math.cos(angularDistance) - Math.sin(latitude * Math.PI / 180) * Math.sin(latOffset));
          const sampleLat = latOffset * 180 / Math.PI;
          const sampleLng = lonOffset * 180 / Math.PI;
          if (sampleLng < minLng) minLng = sampleLng;
          if (sampleLng > maxLng) maxLng = sampleLng;
          if (sampleLat < minLat) minLat = sampleLat;
          if (sampleLat > maxLat) maxLat = sampleLat;
        }

        // Fallback in case computation fails
        if (!isFinite(minLng) || !isFinite(minLat)) {
          console.debug('Map: fitBounds fallback — using setCenter/setZoom for user location');
          map.setCenter(userLngLat);
          map.setZoom(12);
          // signal that initial locate & view change is complete (only once)
          try {
            if (!initialSettledSignalledRef.current) {
              console.debug('Map: signalling initialLocationSettled (fallback)');
              initialSettledSignalledRef.current = true;
              onInitialLocationSettled?.(true);
            }
          } catch {}
        } else {
          console.debug('Map: fitting bounds to user location sample box', { minLng, minLat, maxLng, maxLat });
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, duration: 1000 });
        }

        // apply a mild tilt after move completes to ensure zoom/center happen first
        map.once('moveend', () => {
          console.debug('Map: moveend received — applying pitch and signalling initialLocationSettled');
          try { map.easeTo({ pitch: 40, bearing: 0, duration: 1000 }); } catch (e) { /* ignore */ }
          try {
            if (!initialSettledSignalledRef.current) {
              initialSettledSignalledRef.current = true;
              onInitialLocationSettled?.(true);
            }
          } catch {}
        });
        // clear locating state on success and update user location for search
        setIsLocating(false);
        setLocationError(null);
        setUserLocation({ lat: latitude, lng: longitude });
  }, (err) => {
        logger.warn('Geolocation failed', err);
        // Distinguish permission denied vs other failures for clearer UX
        if (err && (err.code === 1 || (err.PERMISSION_DENIED !== undefined && err.code === err.PERMISSION_DENIED))) {
          setLocationError('Location permission denied');
        } else {
          setLocationError('Unable to access location');
        }
        setIsLocating(false);
  // signal that we attempted initial locate but it failed/was denied so analysis may proceed
  try {
    if (!initialSettledSignalledRef.current) {
      initialSettledSignalledRef.current = true;
      onInitialLocationSettled?.(true);
    }
  } catch {}
      }, { enableHighAccuracy: true, timeout: 10000 });
    };

  
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
      lastLineCoordsRef.current = latlngs;
      const distance = calculateDistance(latlngs);
      setFireBreakDistance(distance);
      onDistanceChange(distance);
      onLineChange?.(latlngs);
      await analyzeAndRender(latlngs);
      setDropsVersion(v => v + 1);
    };
    handleLineChangeRef.current = handleLineChange;
    map.on('draw.create', (e: any) => handleLineChange(e.features[0]));
    map.on('draw.update', (e: any) => handleLineChange(e.features[0]));
    map.on('draw.delete', () => {
      lastLineCoordsRef.current = null;
      setFireBreakDistance(null);
      onDistanceChange(null);
      if (map.getLayer('slope-segments')) map.removeLayer('slope-segments');
      if (map.getSource('slope-segments')) map.removeSource('slope-segments');
      onTrackAnalysisChange?.(null);
      onVegetationAnalysisChange?.(null);
      onLineChange?.(null);
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

  // --- Prop-driven overlay layers (highlight / hover / optimized preview) ----

  /** Upsert a GeoJSON source+layer for a simple line/point/polygon overlay; remove when geometry is null. */
  const setOverlay = (
    id: string,
    geometry:
      | { type: 'LineString'; coordinates: number[][] }
      | { type: 'Point'; coordinates: number[] }
      | { type: 'Polygon'; coordinates: number[][][] }
      | null,
    layer: any
  ) => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      try {
        if (!geometry) {
          if (map.getLayer(id)) map.removeLayer(id);
          if (map.getLayer(`${id}-casing`)) map.removeLayer(`${id}-casing`);
          if (map.getSource(id)) map.removeSource(id);
          return;
        }
        const data = { type: 'Feature' as const, properties: {}, geometry };
        const existing = map.getSource(id);
        if (existing) {
          existing.setData(data);
        } else {
          map.addSource(id, { type: 'geojson', data } as any);
          if (layer.casing) map.addLayer({ ...layer.casing, id: `${id}-casing`, source: id });
          map.addLayer({ ...layer.main, id, source: id });
        }
      } catch (e) {
        logger.warn(`Failed to update overlay ${id}`, e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      map.once('idle', apply);
    } else {
      apply();
    }
  };

  // Segment/insight highlight: bright casing + white core over the slice.
  useEffect(() => {
    const coords = highlightCoords && highlightCoords.length >= 2
      ? highlightCoords.map(c => [c.lng, c.lat])
      : null;
    setOverlay('segment-highlight', coords ? { type: 'LineString', coordinates: coords } : null, {
      casing: { type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#F6A609', 'line-width': 14, 'line-opacity': 0.55, 'line-blur': 2 } },
      main: { type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.95 } }
    });
  }, [highlightCoords]);

  // Elevation-profile hover marker.
  useEffect(() => {
    setOverlay('profile-hover-point', hoverPoint ? { type: 'Point', coordinates: [hoverPoint.lng, hoverPoint.lat] } : null, {
      main: { type: 'circle', paint: { 'circle-radius': 7, 'circle-color': '#F6A609', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } }
    });
  }, [hoverPoint]);

  // Optimized route preview: dashed amber line with dark casing.
  useEffect(() => {
    const coords = optimizedPreview && optimizedPreview.length >= 2
      ? optimizedPreview.map(c => [c.lng, c.lat])
      : null;
    setOverlay('optimized-route-preview', coords ? { type: 'LineString', coordinates: coords } : null, {
      casing: { type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0C1220', 'line-width': 7, 'line-opacity': 0.6 } },
      main: { type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#F6A609', 'line-width': 4, 'line-dasharray': [1.6, 1.4], 'line-opacity': 0.95 } }
    });
  }, [optimizedPreview]);

  // Corridor scanning sweep — theatre shown while the route optimizer is
  // actively searching. A translucent band grows across the line's bounding
  // envelope with a bright leading edge, visually hinting "the system is
  // reading terrain and vegetation across this area" ahead of the real hex
  // heatmap landing. Purely decorative and non-interactive; skipped outright
  // under prefers-reduced-motion (the heatmap below still appears on
  // completion, just without the animated build-up).
  const scanAnimRef = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const stopScan = () => {
      if (scanAnimRef.current != null) {
        cancelAnimationFrame(scanAnimRef.current);
        scanAnimRef.current = null;
      }
      setOverlay('scan-band', null, {});
      setOverlay('scan-line', null, {});
    };

    if (!optimizerScanning) {
      stopScan();
      return;
    }

    const coords = lastLineCoordsRef.current;
    if (!coords || coords.length < 2 || reducedMotionRef.current) {
      // No envelope to sweep, or motion is disabled — skip the animation
      // silently; the heatmap effect below still runs when data arrives.
      return () => stopScan();
    }

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of coords) {
      if (c.lng < minLng) minLng = c.lng;
      if (c.lng > maxLng) maxLng = c.lng;
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
    }
    const padLng = (maxLng - minLng) * 0.18 + 0.002;
    const padLat = (maxLat - minLat) * 0.18 + 0.002;
    minLng -= padLng; maxLng += padLng; minLat -= padLat; maxLat += padLat;
    const axis: 'lng' | 'lat' = (maxLng - minLng) >= (maxLat - minLat) ? 'lng' : 'lat';

    const durationMs = 2600;
    const startTime = performance.now();
    const frame = (now: number) => {
      if (!mapRef.current) return;
      const elapsed = (now - startTime) % (durationMs * 2);
      const t = elapsed < durationMs ? elapsed / durationMs : 2 - elapsed / durationMs; // ping-pong 0→1→0

      const bandCoords: number[][] = axis === 'lng'
        ? [
            [minLng, minLat],
            [minLng + (maxLng - minLng) * t, minLat],
            [minLng + (maxLng - minLng) * t, maxLat],
            [minLng, maxLat],
            [minLng, minLat],
          ]
        : [
            [minLng, minLat],
            [maxLng, minLat],
            [maxLng, minLat + (maxLat - minLat) * t],
            [minLng, minLat + (maxLat - minLat) * t],
            [minLng, minLat],
          ];
      const linePos = axis === 'lng' ? minLng + (maxLng - minLng) * t : minLat + (maxLat - minLat) * t;
      const lineCoords: number[][] = axis === 'lng'
        ? [[linePos, minLat], [linePos, maxLat]]
        : [[minLng, linePos], [maxLng, linePos]];

      setOverlay('scan-band', { type: 'Polygon', coordinates: [bandCoords] }, {
        main: { type: 'fill', paint: { 'fill-color': '#F6A609', 'fill-opacity': 0.05 } }
      });
      setOverlay('scan-line', { type: 'LineString', coordinates: lineCoords }, {
        main: { type: 'line', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#F6A609', 'line-width': 2.5, 'line-blur': 3, 'line-opacity': 0.85 } }
      });

      scanAnimRef.current = requestAnimationFrame(frame);
    };
    scanAnimRef.current = requestAnimationFrame(frame);

    return () => stopScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimizerScanning]);

  // Hex cost heatmap — the scan's result. Smooth green→amber→red gradient
  // (a Mapbox `interpolate` expression, not discrete buckets) over every hex
  // the widest search pass considered, so the crew sees exactly what the
  // optimizer weighed up, not just the line it chose. Fades in on arrival;
  // set instantly under reduced motion.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cells = optimizerHeatmap;

    const remove = () => {
      try {
        if (map.getLayer('hex-heatmap-outline')) map.removeLayer('hex-heatmap-outline');
        if (map.getLayer('hex-heatmap')) map.removeLayer('hex-heatmap');
        if (map.getSource('hex-heatmap')) map.removeSource('hex-heatmap');
      } catch (e) { /* style may already be gone */ }
    };

    if (!cells || cells.length === 0) {
      remove();
      return;
    }

    const data = {
      type: 'FeatureCollection' as const,
      features: cells.map(c => ({
        type: 'Feature' as const,
        properties: { cost: c.costNormalized },
        geometry: { type: 'Polygon' as const, coordinates: [c.polygon.map(p => [p.lng, p.lat])] },
      })),
    };

    const apply = () => {
      try {
        const existing = map.getSource('hex-heatmap');
        if (existing) {
          existing.setData(data);
          return;
        }
        map.addSource('hex-heatmap', { type: 'geojson', data } as any);
        map.addLayer({
          id: 'hex-heatmap',
          type: 'fill',
          source: 'hex-heatmap',
          paint: {
            'fill-color': [
              'interpolate', ['linear'], ['get', 'cost'],
              0, '#1E9E62',
              0.5, '#F6A609',
              1, '#D8232A',
            ],
            'fill-opacity': reducedMotionRef.current ? 0.32 : 0,
          },
        });
        map.addLayer({
          id: 'hex-heatmap-outline',
          type: 'line',
          source: 'hex-heatmap',
          paint: { 'line-color': 'rgba(255,255,255,0.10)', 'line-width': 0.5 },
        });
        if (!reducedMotionRef.current) {
          map.setPaintProperty('hex-heatmap', 'fill-opacity-transition', { duration: 900 });
          requestAnimationFrame(() => {
            try { mapRef.current?.setPaintProperty('hex-heatmap', 'fill-opacity', 0.32); } catch { /* map gone */ }
          });
        }
      } catch (e) {
        logger.warn('Failed to render hex heatmap', e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      map.once('idle', apply);
    } else {
      apply();
    }

    return () => remove();
  }, [optimizerHeatmap]);

  // Imported reference overlays: polygons (fire perimeters) as translucent red
  // fill + outline, lines as dashed slate. Sources are keyed by overlay id.
  const renderedOverlayIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      try {
        const wanted = new Set(contextOverlays.map(o => `ctx-${o.id}`));
        // Remove overlays no longer wanted.
        for (const key of Array.from(renderedOverlayIdsRef.current)) {
          if (!wanted.has(key)) {
            for (const suffix of ['-fill', '-line']) {
              if (map.getLayer(`${key}${suffix}`)) map.removeLayer(`${key}${suffix}`);
            }
            if (map.getSource(key)) map.removeSource(key);
            renderedOverlayIdsRef.current.delete(key);
          }
        }
        // Add new overlays.
        for (const overlay of contextOverlays) {
          const key = `ctx-${overlay.id}`;
          if (renderedOverlayIdsRef.current.has(key)) continue;
          map.addSource(key, { type: 'geojson', data: overlay.geojson } as any);
          map.addLayer({
            id: `${key}-fill`,
            type: 'fill',
            source: key,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': '#D8232A', 'fill-opacity': 0.18 }
          });
          map.addLayer({
            id: `${key}-line`,
            type: 'line',
            source: key,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#D8232A', 'line-width': 2.5, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 }
          });
          renderedOverlayIdsRef.current.add(key);
          // Bring the newly imported overlay into view.
          const bounds = geojsonBounds(overlay.geojson);
          if (bounds) map.fitBounds(bounds, { padding: 80, duration: 800, maxZoom: 14 });
        }
      } catch (e) {
        logger.warn('Failed to update context overlays', e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      map.once('idle', apply);
    } else {
      apply();
    }
  }, [contextOverlays]);

  // Replace the drawn line when an optimized route is applied. Runs the same
  // pipeline as a manual draw so all analyses re-run against the new geometry.
  useEffect(() => {
    if (!applyLineRequest || applyLineRequest.version === appliedLineVersionRef.current) return;
    const map = mapRef.current;
    const draw = drawRef.current;
    const handler = handleLineChangeRef.current;
    if (!map || !draw || !handler || applyLineRequest.coords.length < 2) return;
    appliedLineVersionRef.current = applyLineRequest.version;
    try {
      draw.deleteAll();
      const feature = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: applyLineRequest.coords.map(p => [p.lng, p.lat]) }
      };
      draw.add(feature);
      handler(feature);
    } catch (e) {
      logger.warn('Failed to apply optimized line', e);
    }
  }, [applyLineRequest]);

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

  // Restore a shared plan line once the map + draw tools are ready.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!initialLine || initialLine.length < 2 || restoredRef.current) return;
    let cancelled = false;
    const tryRestore = () => {
      if (cancelled || restoredRef.current) return;
      const map = mapRef.current;
      const draw = drawRef.current;
      if (!map || !draw) { window.setTimeout(tryRestore, 200); return; }
      restoredRef.current = true;
      try {
        draw.add({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: initialLine.map(p => [p.lng, p.lat]) }
        });
        const lngs = initialLine.map(p => p.lng);
        const lats = initialLine.map(p => p.lat);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 80, duration: 0 }
        );
        lastLineCoordsRef.current = initialLine;
        const distance = calculateDistance(initialLine);
        setFireBreakDistance(distance);
        onDistanceChange(distance);
        onLineChange?.(initialLine);
        analyzeAndRender(initialLine);
      } catch (e) {
        logger.warn('Failed to restore shared plan', e);
      }
    };
    tryRestore();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLine]);

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

  // Handle location selection from search
  const handleSearchLocationSelected = (location: { lat: number; lng: number; label: string }) => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing search marker if any
    if (locationMarkerRef.current) {
      try { 
        locationMarkerRef.current.remove(); 
      } catch {}
      locationMarkerRef.current = null;
    }

    // Create a marker for the selected location
    const el = document.createElement('div');
    el.className = 'search-location-marker';
    el.innerHTML = '📍';
    
    // Use Mapbox Marker constructor from dynamically loaded lib
    const MarkerCtor = mapLibRef.current?.Marker;
    if (MarkerCtor) {
      const marker = new MarkerCtor(el)
        .setLngLat([location.lng, location.lat])
        .addTo(map);
      locationMarkerRef.current = marker;
    }

    // Fly to the selected location
    map.flyTo({
      center: [location.lng, location.lat],
      zoom: 14,
      duration: 1500
    });

    // Call parent callback if provided
    if (onSearchLocationSelected) {
      onSearchLocationSelected(location);
    }

    logger.info(`Search location selected: ${location.label} at ${location.lat}, ${location.lng}`);
  };

  // If an external selectedSearchLocation prop changes, trigger the same behaviour
  // so UI that manages the search (e.g. header SearchControl) can move the map.
  useEffect(() => {
    if (!selectedSearchLocation) return;
    // Defer to existing handler which creates marker and flies the map
    handleSearchLocationSelected(selectedSearchLocation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSearchLocation]);

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
      {/* transient locating UI */}
      {isLocating && (
        <div className="locating-badge">Locating…</div>
      )}
      {locationError && (
        <div className="location-error-badge">{locationError}</div>
      )}
      {fireBreakDistance!=null && (
        <div className="distance-badge">Distance: {Math.round(fireBreakDistance)} m</div>
      )}
    </div>
  );
};

export default MapboxMapView;
