import React, { useEffect, useRef, useState } from 'react';
import mapboxgl, { Map as MapboxMap, LngLat } from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
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
  const mapRef = useRef<MapboxMap | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [showTouchHint, setShowTouchHint] = useState(() => { try { return isTouchDevice(); } catch { return false; } });
  const dropMarkersRef = useRef<Map<string, mapboxgl.Marker[]>>(new Map());
  const [dropsVersion, setDropsVersion] = useState(0);

  // Initialize map relying solely on hosted style
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
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
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { line_string: true, trash: true },
      defaultMode: 'draw_line_string',
      styles: [
        { id: 'gl-draw-line', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff6b35', 'line-width': 4, 'line-opacity': 0.85 } },
        { id: 'gl-draw-vertex-halo-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 8, 'circle-color': '#FFF' } },
        { id: 'gl-draw-vertex-active', type: 'circle', filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']], paint: { 'circle-radius': 5, 'circle-color': '#ff6b35' } }
      ]
    });
    map.addControl(draw, 'top-right');
    drawRef.current = draw;

    const handleLineChange = async (feature: any) => {
      if (!feature || feature.geometry?.type !== 'LineString') return;
      const latlngs = feature.geometry.coordinates.map((c: number[]) => toLatLng(new LngLat(c[0], c[1])));
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
    map.on('error', e => { logger.error('Mapbox error', e); if (e?.error?.message?.includes('style')) setError('Failed to load hosted style.'); });
    return () => { map.remove(); };
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
      features.features.forEach(f => {
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
          markerElement.style.cssText =
            'width:12px;height:12px;border-radius:50%;background:#4fc3f7;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3);cursor:pointer;';

          // Create and add marker to map
          const marker = new mapboxgl.Marker(markerElement)
            .setLngLat([lng, lat])
            .addTo(map);
          markers.push(marker);
        }
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
    <div className="mapbox-map-container" style={{ position:'relative', width:'100%', height:'100%' }}>
      <div ref={mapContainerRef} className="mapbox-map" style={{ width:'100%', height:'100%' }} />
      {error && (<div style={{ position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',background:'rgba(255,255,255,0.95)',padding:16,borderRadius:8,maxWidth:320,zIndex:1000,boxShadow:'0 4px 12px rgba(0,0,0,0.25)',fontSize:14 }}><strong style={{ display:'block', color:'#c62828', marginBottom:8 }}>Map Error</strong>{error}</div>)}
      {showTouchHint && (<div style={{ position:'absolute', top:20, right:20, background:'rgba(0,0,0,0.75)', color:'#fff', padding:'10px 12px', borderRadius:6, fontSize:13, maxWidth:220, zIndex:1000 }}>Tap to add points, double‑tap to finish.<button onClick={()=>setShowTouchHint(false)} style={{ background:'none', border:'none', color:'#fff', marginLeft:8, cursor:'pointer' }}>×</button></div>)}
      {isAnalyzing && (<div style={{ position:'absolute', bottom:16, right:16, background:'rgba(0,0,0,0.6)', color:'#fff', padding:'6px 10px', borderRadius:4, fontSize:12 }}>Analyzing…</div>)}
      {fireBreakDistance!=null && (<div style={{ position:'absolute', bottom:16, left:16, background:'rgba(0,0,0,0.6)', color:'#fff', padding:'6px 10px', borderRadius:4, fontSize:12 }}>Distance: {Math.round(fireBreakDistance)} m</div>)}
    </div>
  );
};

export default MapboxMapView;
