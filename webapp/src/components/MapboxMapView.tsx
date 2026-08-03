import React, { useCallback, useEffect, useRef, useState } from 'react';
// Lazy-load heavy map libraries to keep initial bundle small. The actual
// imports (mapbox-gl and mapbox-gl-draw) are performed inside the effect.
import type { LngLat } from 'mapbox-gl';
import { TrackAnalysis, AircraftSpec, VegetationAnalysis } from '../types/config';
import { analyzeTrackSlopes, getSlopeColor, calculateDistance } from '../utils/slopeCalculation';
import { REVEAL_DURATION_MS } from '../utils/revealTiming';
import { analyzeTrackVegetation } from '../utils/vegetationAnalysis';
import { MAPBOX_TOKEN } from '../config/mapboxToken';
import { isTouchDevice } from '../utils/deviceDetection';
import { logger } from '../utils/logger';
import { SearchControl } from './SearchControl';
import { phaseMessage } from './AdvisorPanel';
import { applyLiveFeedLayers, LiveFeedMapData } from '../utils/liveFeedLayers';
import type { ViewBounds } from '../utils/liveFeedsService';
import { ensureStreetsSource, extractCorridorTrails } from '../utils/mapboxTrails';
import { setLocalTrailProvider } from '../utils/infrastructureService';
import { smoothPolygonGeometry } from '../utils/polygonSmoothing';
import { MobilityClass } from '../terrain/mobilityClass';
import {
  metersPerPixel, brushApproxRadiusM, applyStrokes, BrushSize, PaintStrokeMode, PaintedArea,
  BRUSH_HEX_COUNT, PAINT_HEX_SIZE_M,
} from '../terrain/paintedArea';
import { union } from '@turf/union';
import { polygon as turfPolygon, featureCollection } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

/** The cached, already-resolved painted shape (see the incremental note by
 *  `originPaintGeomRef`). */
type PaintedFeature = Feature<Polygon | MultiPolygon> | null;

const BRUSH_LABEL: Record<BrushSize, string> = { small: 'S', medium: 'M', large: 'L', xl: 'XL' };

/**
 * Resolve a painted area against a cached accumulator: extend it when strokes
 * were only appended (the live-drag case), replay from scratch otherwise.
 * Mutates the ref, and returns the geometry to render (or null if everything
 * has been erased away).
 */
function resolvePaintedAreaIncrementally(
  ref: React.MutableRefObject<{ count: number; feature: PaintedFeature }>,
  area: PaintedArea
): Polygon | MultiPolygon | null {
  const cached = ref.current;
  const appendedOnly = area.length > cached.count && cached.feature !== null;
  const feature = appendedOnly
    ? applyStrokes(cached.feature, area.slice(cached.count))
    : applyStrokes(null, area);
  ref.current = { count: area.length, feature };
  return feature ? feature.geometry : null;
}

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
   *  rendered as a smooth green→amber→red suitability heatmap once ready.
   *  Each cell carries BOTH normalisations so `heatmapColorMode` can switch
   *  between them without re-running the search. */
  optimizerHeatmap?: {
    polygon: { lat: number; lng: number }[];
    costNormalized: number;
    costNormalizedObjective: number;
  }[] | null;
  /** Optimizer progress (0..1) — drives the WP3 progress-synced sweep so its
   *  leading edge tracks how far the search has actually gotten instead of
   *  a fixed-period ping-pong. */
  optimizerProgress?: number;
  /** Optimizer phase name — drives the on-map progress pill's copy. */
  optimizerPhase?: string;
  /** WP2 — streamed scan cells: grid outlines build out, then colour in as
   *  each cell is sampled. Distinct from `optimizerHeatmap`, which only
   *  appears once the search is fully done. */
  scanCells?: { polygon: { lat: number; lng: number }[]; costNormalized: number; costNormalizedObjective: number; revealed: boolean; revealedAt?: number }[] | null;
  /** Which heatmap scale to render: 'objective' (fixed, absolute difficulty —
   *  heavy timber is always at least amber, a 45°+ slope always red,
   *  regardless of what else is in the scan) or 'relative' (stretched to the
   *  min/max of THIS scan's own cells — useful for comparing paths within one
   *  corridor). Defaults to 'objective'. */
  heatmapColorMode?: 'relative' | 'objective';
  /** WP2 — the live Dijkstra frontier's current best-guess path. */
  scanBestPath?: { lat: number; lng: number }[] | null;
  /** WP6 — true while the area-recon box tool is armed (next two map clicks
   *  define opposite corners of the scan box). */
  areaReconActive?: boolean;
  onAreaReconActiveChange?: (active: boolean) => void;
  /** Fired once the user finishes drawing the recon box (two clicks). */
  onAreaReconBoxDrawn?: (sw: { lat: number; lng: number }, ne: { lat: number; lng: number }) => void;
  /** Cost-normalised hex cells from the area recon scan — same shape as
   *  `optimizerHeatmap`, rendered as its own layer so it survives independently
   *  of any route search. */
  areaReconHeatmap?: { polygon: { lat: number; lng: number }[]; costNormalized: number; costNormalizedObjective: number }[] | null;
  /** Area recon scan lifecycle, for the status badge + clear button. */
  areaReconStatus?: 'idle' | 'running' | 'done' | 'error';
  onClearAreaRecon?: () => void;
  /** Current map view bounds — emitted when the view changes. */
  onViewBoundsChange?: (bounds: ViewBounds | null) => void;
  /** Live feed data to render on the map. */
  liveFeedData?: LiveFeedMapData;

  // --- Terrain Mobility mode (docs/ROUTE_INTELLIGENCE.md "Terrain Mobility &
  // Counter-Mobility") — additive, only active while the mode is armed from
  // App.tsx. Switches the initial basemap to a dark tactical style.
  /** Dark tactical basemap + chrome, decided once at map init (mirrors the
   *  mode's URL-gated, load-time nature — not a live runtime toggle). */
  tacticalMode?: boolean;
  /** Which area is currently armed for painting (press-drag over the map
   *  lays down dabs while armed — see terrain/paintedArea.ts). */
  mobilityBoxRole?: 'origin' | 'objective' | null;
  onMobilityBoxRoleChange?: (role: 'origin' | 'objective' | null) => void;
  /** Fired for every dab painted (or erased — see mobilityPaintMode) while a
   *  role is armed. This component reports only the raw click/drag POINT —
   *  the caller (App.tsx) builds the actual hex dab via `createHexDab`,
   *  since it holds the painted area's existing strokes (needed for the
   *  area's anchor — see paintedArea.ts's module header) and the current
   *  brush size. */
  onMobilityPaintDab?: (role: 'origin' | 'objective', point: { lat: number; lng: number }) => void;
  /** Persistent painted areas — ordered paint/erase stroke sequences,
   *  resolved to one shape and rendered until cleared. */
  mobilityOriginPaint?: PaintedArea;
  mobilityObjectivePaint?: PaintedArea;
  /** Brush size — a FIXED ground hex count (`BRUSH_HEX_COUNT`), not a
   *  screen-relative pixel radius (docs §35). */
  mobilityBrushSize?: BrushSize;
  onMobilityBrushSizeChange?: (size: BrushSize) => void;
  /** Paint vs erase — which kind of stroke the brush lays down next. */
  mobilityPaintMode?: PaintStrokeMode;
  onMobilityPaintModeChange?: (mode: PaintStrokeMode) => void;
  /** Movement corridors (smoothed bands) from the last appreciation run, plus
   *  the individual routes they were derived from. The bands are the
   *  presentation; the routes render faintly INSIDE them so the analysis
   *  underneath stays visible rather than being hidden by the abstraction
   *  (docs §28). */
  corridors?: {
    id: string;
    rank: number;
    easeClass: string;
    bottleneckWidthM: number;
    cells: { polygon: { lat: number; lng: number }[]; density: number }[];
  }[] | null;
  corridorRoutes?: { id: string; rank: number; path: { lat: number; lng: number }[] }[] | null;
  /** Corridor the user has picked out in the panel. That band keeps full
   *  strength and every other one drops back, which is the only reliable way
   *  to answer "which of these overlapping bands is the one I'm reading
   *  about" (owner, 2026-07-27: "the corridors are visually unclear"). */
  highlightedCorridorId?: string | null;
  onCorridorHighlight?: (id: string | null) => void;
  /** Result cells from the last terrain appreciation run. */
  mobilityHeatmap?: {
    polygon: { lat: number; lng: number }[];
    trafficability: MobilityClass;
    timeSeconds: number;
    bandIndex: number;
  }[] | null;
  /** 'trafficability' colours by mobility class — unrestricted/restricted/
   *  severely restricted (a terrain property, independent of reachability);
   *  'isochrone' colours by arrival-time band (a reachability property from
   *  the origin AOI). */
  mobilityDisplayMode?: 'trafficability' | 'isochrone';
  /** Live cursor position, for the tactical coordinate readout. */
  onCursorMove?: (point: { lat: number; lng: number } | null) => void;
  /** Unit simulation — current animated position (moved via a plain
   *  mapboxgl.Marker so per-frame updates never touch React state). */
  unitSimPosition?: { lat: number; lng: number } | null;
  /** Unit simulation — the intended path currently being followed (redrawn
   *  whenever a mid-course replan splices a new remainder onto it). */
  unitSimPath?: { lat: number; lng: number }[] | null;
  /** Docs §35 Slice A — the box-free ROAD-NETWORK route between the painted
   *  areas (vehicle profiles only, `roadRouteSearch.ts`). Drawn as its own
   *  distinct line since it is independent of, and can exist even when,
   *  the hex-grid search's own path/corridors above found nothing. */
  roadRoute?: { lat: number; lng: number }[] | null;
  /** Pass 2 — top chokepoint cells (highest route-crossing count first). */
  chokepoints?: { center: { lat: number; lng: number }; passCount: number }[] | null;
  /** Pass 2 — cheapest severing cut segments (the barrier plan line). */
  barrierSegments?: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }[] | null;
  /** OCOKA 3 (docs/ROUTE_INTELLIGENCE.md §47) — the road-network-EXACT min-cut:
   *  the cheapest set of REAL road segments (not hex-cell edges) that severs
   *  the road network between the painted areas, for vehicle profiles. A
   *  separate, more precise sibling to `barrierSegments` above, not a
   *  replacement — see `computeRoadNetworkMinCut` in terrain/minCutBarrier.ts. */
  roadBarrierSegments?: { from: { lat: number; lng: number }; to: { lat: number; lng: number } }[] | null;
  /** Owner feedback (2026-07-26): primary Terrain-mode actions must be
   *  reachable as floating map buttons, not buried in a side panel the user
   *  has to scroll/expand to reach on mobile. */
  onRunAppreciation?: () => void;
  onCancelAppreciation?: () => void;
  mobilityRunning?: boolean;
  /** Overall run progress 0..1 and the current phase's plain-English label —
   *  the analysis takes tens of seconds and previously showed nothing at all
   *  while it worked (owner, 2026-07-27). */
  mobilityProgress?: number;
  mobilityStageLabel?: string | null;
  /** The most recent assessment-log line, echoed onto the map so the run's
   *  real output is visible with the side panel collapsed. */
  mobilityLatestLog?: string | null;
  /** One master opacity for every analysis overlay (cells, bands, routes,
   *  dots, lines), so the ground underneath can be read (owner, 2026-07-27).
   *  1 = as designed; lower multiplies every layer's own opacity down. */
  mobilityOverlayOpacity?: number;
  /** Probabilistic movement ensemble — per-cell transit frequency over many
   *  simulated movers (terrain/movementSimulation.ts). MODELLED behaviour, not
   *  measured: the legend and panel say so, and this layer is styled as a
   *  diffuse field rather than a crisp route for the same reason. */
  mobilityTransitCells?: { polygon: { lat: number; lng: number }[]; transitFraction: number }[] | null;
  /** Live positions/trails of the animated ensemble, updated per frame. */
  ensembleMovers?: { index: number; lat: number; lng: number; trail: { lat: number; lng: number }[]; arrived: boolean }[] | null;
  /** Recommended restrictions (restrictionPlanner.ts) — where to deny
   *  movement, ranked. Drawn heavy and numbered because these are the
   *  actionable output, not another analysis layer. */
  restrictions?: {
    id: string;
    rank: number;
    kind: 'road-block' | 'ground-denial';
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
  }[] | null;
  /** Real mapped watercourse/water-body geometry the last run fetched (docs
   *  §34) — a reference layer showing the actual river/lake shape the
   *  hydrology gate is reacting to, independent of any cell it influenced.
   *  `kind === 'water'` (OSM natural=water) renders as a filled polygon;
   *  anything else (river/canal/stream) renders as a line. */
  waterFeatures?: { kind: string; coords: { lat: number; lng: number }[] }[] | null;
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
  optimizerHeatmap = null,
  optimizerProgress = 0,
  optimizerPhase,
  heatmapColorMode = 'objective',
  scanCells = null,
  scanBestPath = null,
  areaReconActive = false,
  onAreaReconActiveChange,
  onAreaReconBoxDrawn,
  areaReconHeatmap = null,
  areaReconStatus = 'idle',
  onClearAreaRecon,
  onViewBoundsChange,
  liveFeedData: externalLiveFeedData,
  tacticalMode = false,
  mobilityBoxRole = null,
  onMobilityBoxRoleChange,
  onMobilityPaintDab,
  mobilityOriginPaint = [],
  mobilityObjectivePaint = [],
  mobilityBrushSize = 'medium',
  onMobilityBrushSizeChange,
  mobilityPaintMode = 'paint',
  onMobilityPaintModeChange,
  corridors = null,
  corridorRoutes = null,
  highlightedCorridorId = null,
  onCorridorHighlight,
  mobilityHeatmap = null,
  mobilityDisplayMode = 'trafficability',
  onCursorMove,
  unitSimPosition = null,
  unitSimPath = null,
  roadRoute = null,
  chokepoints = null,
  barrierSegments = null,
  roadBarrierSegments = null,
  onRunAppreciation,
  onCancelAppreciation,
  mobilityRunning = false,
  mobilityProgress = 0,
  mobilityStageLabel = null,
  mobilityLatestLog = null,
  mobilityOverlayOpacity = 1,
  mobilityTransitCells = null,
  ensembleMovers = null,
  restrictions = null,
  waterFeatures = null
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
  const unitSimMarkerRef = useRef<mapboxgl.Marker | null>(null);
  /** One HTML label per movement corridor — see the corridor-label effect. */
  const corridorLabelMarkersRef = useRef<mapboxgl.Marker[]>([]);
  /** One numbered badge per recommended restriction. */
  const restrictionMarkersRef = useRef<mapboxgl.Marker[]>([]);
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
  // "The reveal is the demo" (2026-07-26 UI review, master_plan.md Step 11):
  // increments on every renderSlopeSegments call so an in-flight reveal loop
  // from a superseded analysis recognises it's stale and stops touching
  // feature-state on the next frame.
  const slopeRevealTokenRef = useRef(0);
  // WP3: the sweep eases toward this every frame instead of a fixed clock.
  const optimizerProgressRef = useRef(0);
  useEffect(() => { optimizerProgressRef.current = optimizerProgress; }, [optimizerProgress]);

  // WP6 — area recon box tool. Click handlers are registered once at map
  // init (see the big init effect below), so they read these refs for the
  // latest prop values/callbacks rather than closing over stale props.
  const areaReconActiveRef = useRef(false);
  useEffect(() => { areaReconActiveRef.current = areaReconActive; }, [areaReconActive]);
  const onAreaReconActiveChangeRef = useRef(onAreaReconActiveChange);
  useEffect(() => { onAreaReconActiveChangeRef.current = onAreaReconActiveChange; }, [onAreaReconActiveChange]);
  const onAreaReconBoxDrawnRef = useRef(onAreaReconBoxDrawn);
  useEffect(() => { onAreaReconBoxDrawnRef.current = onAreaReconBoxDrawn; }, [onAreaReconBoxDrawn]);
  const areaReconStartRef = useRef<{ lat: number; lng: number } | null>(null);

  // Terrain Mobility mode — origin/objective PAINT tool (owner feedback
  // 2026-07-26: press-drag to paint circular dabs, not a two-click
  // rectangle — see terrain/paintedArea.ts). Refs so the once-registered
  // map listeners always read the latest prop values.
  const mobilityBoxRoleRef = useRef(mobilityBoxRole);
  const mobilityBrushSizeRef = useRef(mobilityBrushSize);
  useEffect(() => { mobilityBrushSizeRef.current = mobilityBrushSize; }, [mobilityBrushSize]);
  const mobilityPaintingRef = useRef(false);
  const mobilityLastDabRef = useRef<{ lat: number; lng: number } | null>(null);
  // Hold-to-pan (owner, 2026-07-27: "give me an option to pan the map by
  // holding space or something while in painting mode"). While a paint role is
  // armed, dragPan is disabled so a one-finger drag paints — which leaves no
  // way to move the map without disarming the tool. Holding Space (or Alt, for
  // anyone whose hands are already on the mouse) temporarily hands dragPan
  // back and suppresses painting for the duration.
  const panOverrideRef = useRef(false);
  const [panOverrideActive, setPanOverrideActive] = useState(false);
  // Live pointer position in SCREEN space, for the brush cursor ring.
  const [brushCursorPoint, setBrushCursorPoint] = useState<{ x: number; y: number; radiusPx: number } | null>(null);
  // The painting hint is a nudge, not a modal: dismissed by hand, and it
  // re-arms when a role is (re-)selected so it is there when it is useful and
  // gone once the user is clearly getting on with it.
  const [paintHintDismissed, setPaintHintDismissed] = useState(false);
  useEffect(() => { if (mobilityBoxRole) setPaintHintDismissed(false); }, [mobilityBoxRole]);
  useEffect(() => {
    mobilityBoxRoleRef.current = mobilityBoxRole;
    // Arming, disarming, or switching role always ends any in-progress
    // stroke and disables map drag-pan only while a role is actually armed
    // (touch-drag must paint, not pan, while a tool is selected).
    mobilityPaintingRef.current = false;
    mobilityLastDabRef.current = null;
    const map = mapRef.current;
    if (map?.dragPan) {
      if (mobilityBoxRole && !panOverrideRef.current) map.dragPan.disable(); else map.dragPan.enable();
    }
  }, [mobilityBoxRole]);

  // Hold Space (or Alt) to pan while a paint tool is armed. Registered on
  // `window` rather than the canvas because the canvas is not focusable and
  // would never receive the keystroke. Space is swallowed while a role is
  // armed so the page cannot scroll under the map mid-stroke; when no role is
  // armed the handler does nothing at all and Space behaves normally.
  useEffect(() => {
    if (!tacticalMode) return;
    const setOverride = (on: boolean) => {
      if (panOverrideRef.current === on) return;
      panOverrideRef.current = on;
      setPanOverrideActive(on);
      const map = mapRef.current;
      if (!map?.dragPan) return;
      if (on) {
        // Abandon any stroke in progress — the drag that follows is a pan.
        mobilityPaintingRef.current = false;
        mobilityLastDabRef.current = null;
        map.dragPan.enable();
      } else if (mobilityBoxRoleRef.current) {
        map.dragPan.disable();
      }
    };
    const isPanKey = (e: KeyboardEvent) => e.code === 'Space' || e.key === ' ' || e.key === 'Alt';
    const onKeyDown = (e: KeyboardEvent) => {
      if (!mobilityBoxRoleRef.current || !isPanKey(e)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      e.preventDefault();
      setOverride(true);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (isPanKey(e)) setOverride(false); };
    // A window that loses focus mid-hold never delivers the keyup, which would
    // leave the tool permanently in pan mode.
    const onBlur = () => setOverride(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      setOverride(false);
    };
  }, [tacticalMode]);

  // MapboxDraw's mode is only read from `tacticalMode` once, at construction
  // (see the "load-time decision" note where `new MapboxDraw(...)` is built
  // below) — fine for a fresh page load with the mode already active, but the
  // in-app "Terrain mode" header toggle flips `tacticalMode` on an
  // ALREADY-MOUNTED map without remounting it, so MapboxDraw was staying
  // armed in `draw_line_string` (or vice-versa) regardless of the toggle
  // (field-reported: "paint origin still drawing a fire break line" after
  // switching modes mid-session). This keeps it in sync on every toggle.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    try { draw.changeMode(tacticalMode ? 'simple_select' : 'draw_line_string'); } catch { /* draw not ready yet */ }
  }, [tacticalMode]);
  const onMobilityBoxRoleChangeRef = useRef(onMobilityBoxRoleChange);
  useEffect(() => { onMobilityBoxRoleChangeRef.current = onMobilityBoxRoleChange; }, [onMobilityBoxRoleChange]);
  const onMobilityPaintDabRef = useRef(onMobilityPaintDab);
  useEffect(() => { onMobilityPaintDabRef.current = onMobilityPaintDab; }, [onMobilityPaintDab]);
  const onCursorMoveRef = useRef(onCursorMove);
  useEffect(() => { onCursorMoveRef.current = onCursorMove; }, [onCursorMove]);

  // Live context feeds (hotspots, fire boundaries, incidents) — the control
  // panel owns fetching/refresh; this component just tracks the current map
  // view (to drive the hotspots bbox query) and renders whatever it's given.
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);
  const [liveFeedData, setLiveFeedData] = useState<LiveFeedMapData>({ hotspots: null, boundaries: null, incidents: null });

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
  // Owner, 2026-07-26: "bring back the satellite as the default map, seeing
  // the terrain is the key." §13.1's original tactical-mode design called
  // for a dark vector basemap (a restrained "ops HUD" look) — reasonable for
  // a chrome aesthetic, wrong for a tool whose whole analytical premise is
  // reading real ground (vegetation density, tracks, gaps) off the map.
  // Terrain mode now defaults to the SAME satellite imagery fire-break mode
  // already uses, not a separate basemap — one real view of the ground in
  // both modes. VITE_MAPBOX_TACTICAL_STYLE remains available as an explicit
  // override for anyone who wants a different tactical-specific style later.
  const satelliteStyleURL = (import.meta as any).env?.VITE_MAPBOX_SATELLITE_STYLE || 'mapbox://styles/richardbt/cmf7esv62000n01qw0khz891t';
  const styleURL = tacticalMode
    ? ((import.meta as any).env?.VITE_MAPBOX_TACTICAL_STYLE || satelliteStyleURL)
    : satelliteStyleURL;
  logger.info(`Map init (hosted style only): ${styleURL}`);
  const map = new mapboxgl.Map({ container: mapContainerRef.current, style: styleURL, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, accessToken: token });
  mapRef.current = map;

    // Track the current view bounds for the live-feeds control (hotspots
    // query needs a bbox). Updated on every pan/zoom and once at load.
    const updateViewBounds = () => {
      try {
        const b = map.getBounds();
        if (!b) return;
        const bounds = { minLat: b.getSouth(), maxLat: b.getNorth(), minLng: b.getWest(), maxLng: b.getEast() };
        setViewBounds(bounds);
        onViewBoundsChange?.(bounds);
      } catch { /* map not ready */ }
    };
    map.on('moveend', updateViewBounds);
    map.once('load', updateViewBounds);
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
  // Terrain mode has no fire-break line to draw — MapboxDraw must not sit
  // armed in `draw_line_string` there, or its own click handling swallows
  // every map click intended for the origin/objective AOI box tool before
  // it ever reaches that tool's handler (field-reported: dropping a point
  // while "Draw origin area" was selected ran the fire-break analysis
  // instead). `tacticalMode` is a load-time decision here, same as the
  // basemap style choice below.
  const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: tacticalMode ? { line_string: false, trash: false } : { line_string: true, trash: true },
      defaultMode: tacticalMode ? 'simple_select' : 'draw_line_string',
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

    // Add labels to the draw control buttons for clarity. Hiding the whole
    // control in Terrain mode is done in CSS against `.mapboxgl-ctrl-top-right`
    // directly (see styles-tactical.css) — an earlier attempt added a wrapper
    // class here via `.mapbox-gl-draw_ctrl`, a selector that doesn't exist in
    // this MapboxDraw version's actual DOM output (its real classes are
    // `mapboxgl-ctrl-group`/`mapbox-gl-draw_line`/`mapbox-gl-draw_trash` —
    // see its bundled source), so that class was silently never applied and
    // the pencil/trash controls kept showing in Terrain mode (field-reported).
    setTimeout(() => {
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
      // Add the Mapbox Streets vector road source (invisible query layer) so the
      // optimizer can read corridor trails straight from the vector tiles the
      // map already loads — zero extra network, no CORS, works offline once the
      // area is cached. Registered as the infrastructure service's primary
      // trail source; it falls back to the backend Overpass proxy whenever this
      // returns nothing (tiles not loaded for the corridor).
      ensureStreetsSource(map);
      setLocalTrailProvider((s, w, n, e, kind) => extractCorridorTrails(map, s, w, n, e, kind));
    });
  map.on('error', (e: any) => { logger.error('Mapbox error', e); if (e?.error?.message?.includes('style')) setError('Failed to load hosted style.'); });

    // WP6 — area recon box tool: while armed, the first click sets one
    // corner, the second finishes the box and hands it to the parent. Reads
    // refs (not props) since this listener is bound once at map init.
    map.on('click', (e: any) => {
      if (!areaReconActiveRef.current) return;
      const pt = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      if (!areaReconStartRef.current) {
        areaReconStartRef.current = pt;
        return;
      }
      const sw = areaReconStartRef.current;
      areaReconStartRef.current = null;
      onAreaReconActiveChangeRef.current?.(false);
      onAreaReconBoxDrawnRef.current?.(sw, pt);
    });
    map.on('mousemove', (e: any) => {
      if (!areaReconActiveRef.current || !areaReconStartRef.current) return;
      const sw = areaReconStartRef.current;
      const pt = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const coords = [
        [sw.lng, sw.lat], [pt.lng, sw.lat], [pt.lng, pt.lat], [sw.lng, pt.lat], [sw.lng, sw.lat],
      ];
      setOverlay('area-recon-preview', { type: 'Polygon', coordinates: [coords] }, {
        main: { type: 'fill', paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.12 } },
        casing: { type: 'line', paint: { 'line-color': '#38bdf8', 'line-width': 2, 'line-dasharray': [2, 2] } },
      });
    });

    // Terrain Mobility mode — press-drag-to-paint AOI tool (owner feedback
    // 2026-07-26): while a role is armed, mousedown starts a stroke and every
    // subsequent mousemove (throttled by distance so a slow drag doesn't
    // flood dabs) lays down another dab. Dabs are now real hex cells at a
    // FIXED ground size (docs §35) — this component reports only the raw
    // click point; App.tsx turns it into the actual hex stamp via
    // `createHexDab`, since building that needs the painted area's existing
    // strokes (for its anchor) which live in App.tsx's state, not here.
    // mouseup ends the stroke; the role stays armed so the user can paint
    // several strokes to build up one irregular area, and dragPan is
    // disabled/enabled by the role-change effect above so a touch-drag
    // paints instead of panning the map.
    const paintDabAt = (lngLat: { lat: number; lng: number }) => {
      const role = mobilityBoxRoleRef.current;
      if (!role) return;
      mobilityLastDabRef.current = { lat: lngLat.lat, lng: lngLat.lng };
      onMobilityPaintDabRef.current?.(role, { lat: lngLat.lat, lng: lngLat.lng });
    };
    // A pinch/two-finger-pan gesture must still reach Mapbox's own
    // touchZoomRotate handler (owner feedback 2026-07-26: "a two finger
    // movement... should move the map as intended") — dragPan is disabled
    // while a role is armed so a ONE-finger drag paints instead of panning,
    // but that must not swallow a second finger. `e.points` is Mapbox's own
    // per-touch screen-point array (present on touch events, absent on
    // mouse events, where a single pointer is implicitly assumed).
    const touchCount = (e: any): number => e?.points?.length ?? 1;
    const handlePaintStart = (e: any) => {
      if (!mobilityBoxRoleRef.current) return;
      if (panOverrideRef.current) return; // Space held — this drag is a pan
      if (touchCount(e) > 1) { mobilityPaintingRef.current = false; return; }
      e.preventDefault?.();
      mobilityPaintingRef.current = true;
      paintDabAt({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    const handlePaintMove = (e: any) => {
      if (!mobilityPaintingRef.current || !mobilityBoxRoleRef.current) return;
      if (panOverrideRef.current) { mobilityPaintingRef.current = false; return; }
      if (touchCount(e) > 1) { mobilityPaintingRef.current = false; return; } // a second finger joined mid-stroke — hand off to native pinch/pan
      e.preventDefault?.();
      const pt = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const last = mobilityLastDabRef.current;
      // Only add a new dab once the cursor has moved a meaningful fraction
      // of the brush's on-screen size — an unthrottled drag would otherwise
      // lay down dozens of near-identical dabs per second. The threshold is
      // ground-fixed now (docs §35: PAINT_HEX_SIZE_M-based, not a screen
      // pixel constant), converted to on-screen pixels at the CURRENT
      // zoom/latitude so it still throttles correctly whether zoomed in or
      // out — roughly a third of the brush's on-screen radius, so a stroke
      // stays continuous (dabs overlap heavily) while a slow drag still does
      // not flood the stroke list.
      const point = map.project([pt.lng, pt.lat]);
      const lastPoint = last ? map.project([last.lng, last.lat]) : null;
      const movedPx = lastPoint ? Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) : Infinity;
      const brushRadiusPx = brushApproxRadiusM(mobilityBrushSizeRef.current) / metersPerPixel(pt.lat, map.getZoom());
      const thresholdPx = Math.max(6, brushRadiusPx * 0.45);
      if (movedPx >= thresholdPx) paintDabAt(pt);
    };
    const handlePaintEnd = () => { mobilityPaintingRef.current = false; };
    // Mapbox GL fires distinct event types for mouse vs. touch input —
    // 'mousedown'/'mousemove'/'mouseup' never fire from a touch tap, so a
    // mouse-only registration here silently did nothing on phones/tablets
    // (field-reported: "paint destination does nothing" on mobile). Both
    // event families share the same MapMouseEvent/MapTouchEvent `.lngLat`
    // shape, so the same handlers cover both.
    map.on('mousedown', handlePaintStart);
    map.on('mousemove', handlePaintMove);
    map.on('mouseup', handlePaintEnd);
    map.on('mouseleave', handlePaintEnd);
    map.on('touchstart', handlePaintStart);
    map.on('touchmove', handlePaintMove);
    map.on('touchend', handlePaintEnd);
    map.on('touchcancel', handlePaintEnd);
    // Live cursor position for the tactical coordinate readout — independent
    // of any drawing tool. Throttled (~10 Hz): an unthrottled mousemove would
    // fire a React state update (and a UTM re-projection) on every pixel of
    // mouse travel, which is unnecessary jank for a read-only display.
    let lastCursorEmit = 0;
    map.on('mousemove', (e: any) => {
      // The brush ring follows the pointer at full frame rate — it IS the
      // cursor, and a throttled cursor reads as broken. Cheap: one screen-space
      // state update, no projection or re-layout. Ring radius is now derived
      // from the brush's FIXED ground size (docs §35) converted to pixels at
      // this point's zoom/latitude — it genuinely grows zooming in and
      // shrinks zooming out, the correct behaviour for a real-world-fixed
      // brush (the old fixed-pixel cursor did the opposite).
      if (mobilityBoxRoleRef.current && e.point) {
        const radiusPx = brushApproxRadiusM(mobilityBrushSizeRef.current) / metersPerPixel(e.lngLat.lat, map.getZoom());
        setBrushCursorPoint({ x: e.point.x, y: e.point.y, radiusPx });
      }
      const now = performance.now();
      if (now - lastCursorEmit < 100) return;
      lastCursorEmit = now;
      onCursorMoveRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    map.on('mouseout', () => { onCursorMoveRef.current?.(null); setBrushCursorPoint(null); });

    return () => {
      // Drop the map-backed trail provider so a stale map instance is never
      // queried after unmount (the optimizer would then use the network path).
      setLocalTrailProvider(null);
      map.remove();
    };
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

  // --- Terrain Mobility: one master opacity for every analysis overlay -------
  // Owner, 2026-07-27: "I need a slider to make the elements of the analysis
  // like cells and the points and lines more or less opaque to see the
  // background better." Each mobility layer registers its OWN designed opacity
  // here as a base (a number or a Mapbox expression, since several are
  // data-driven), and the slider multiplies every base by one factor. Doing it
  // as a multiply rather than a flat override is what preserves the meaning
  // each layer already encodes in opacity — the corridor band's density
  // gradient, the isochrone field's unreached dimming — instead of flattening
  // them all to the same value.
  //
  // Painted origin/objective areas are deliberately NOT included: they are the
  // user's own inputs, not analysis output, and fading them out while hunting
  // for the ground underneath would lose track of what was actually asked.
  const overlayOpacityRef = useRef(mobilityOverlayOpacity);
  const overlayBaseOpacityRef = useRef(
    new Map<string, { layerId: string; property: string; base: number | unknown[] }>()
  );

  const applyOverlayOpacityTo = useCallback((layerId: string, property: string, base: number | unknown[]) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (!map.getLayer(layerId)) return;
      const k = overlayOpacityRef.current;
      const value = typeof base === 'number' ? base * k : ['*', base, k];
      map.setPaintProperty(layerId, property, value as any);
    } catch (e) { /* style may be mid-reload */ }
  }, []);

  /** Register (or update) a layer's designed opacity and apply the current
   *  slider factor to it immediately. */
  const registerOverlayOpacity = useCallback((layerId: string, property: string, base: number | unknown[]) => {
    overlayBaseOpacityRef.current.set(`${layerId}|${property}`, { layerId, property, base });
    applyOverlayOpacityTo(layerId, property, base);
  }, [applyOverlayOpacityTo]);

  const unregisterOverlayOpacity = useCallback((layerId: string) => {
    for (const key of [...overlayBaseOpacityRef.current.keys()]) {
      if (key.startsWith(`${layerId}|`)) overlayBaseOpacityRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    overlayOpacityRef.current = mobilityOverlayOpacity;
    for (const entry of overlayBaseOpacityRef.current.values()) {
      applyOverlayOpacityTo(entry.layerId, entry.property, entry.base);
    }
  }, [mobilityOverlayOpacity, applyOverlayOpacityTo]);

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

  // WP6 — clear the box-preview and any half-drawn corner whenever the area
  // recon tool is switched off (finished, cancelled, or toggled off).
  useEffect(() => {
    if (!areaReconActive) {
      areaReconStartRef.current = null;
      setOverlay('area-recon-preview', null, {});
    }
  }, [areaReconActive]);

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
  // envelope with a bright leading edge. WP3: one-directional and
  // progress-synced — the edge eases toward the real scan fraction
  // (`optimizerProgressRef`) every frame instead of ping-ponging on a fixed
  // clock, so it reveals the actual search instead of just decorating the
  // wait. Purely non-interactive; skipped outright under
  // prefers-reduced-motion (the heatmap below still appears on completion,
  // just without the animated build-up).
  const scanAnimRef = useRef<number | null>(null);
  const scanEasedTRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const stopScan = () => {
      if (scanAnimRef.current != null) {
        cancelAnimationFrame(scanAnimRef.current);
        scanAnimRef.current = null;
      }
      scanEasedTRef.current = 0;
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

    scanEasedTRef.current = 0;
    const frame = () => {
      if (!mapRef.current) return;
      // Ease toward the real scan progress rather than a fixed-period
      // ping-pong — the sweep visually tracks how far the search has
      // actually gotten.
      const target = Math.max(0, Math.min(1, optimizerProgressRef.current));
      scanEasedTRef.current += (target - scanEasedTRef.current) * 0.08;
      const t = scanEasedTRef.current;

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
        properties: { cost: heatmapColorMode === 'relative' ? c.costNormalized : c.costNormalizedObjective },
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
  }, [optimizerHeatmap, heatmapColorMode]);

  // WP2 — streamed scan cells: grid outlines building out, then colouring in
  // as each cell is sampled, so the wait shows the search actually happening
  // instead of an end-of-run reveal. Distinct source from `hex-heatmap`
  // above, which only appears once `optimizerHeatmap` lands (the final,
  // definitive result) — the parent clears `scanCells` at that point.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cells = scanCells;

    const remove = () => {
      try {
        if (map.getLayer('hex-scan-outline')) map.removeLayer('hex-scan-outline');
        if (map.getLayer('hex-scan')) map.removeLayer('hex-scan');
        if (map.getSource('hex-scan')) map.removeSource('hex-scan');
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
        properties: { cost: heatmapColorMode === 'relative' ? c.costNormalized : c.costNormalizedObjective, revealed: c.revealed ? 1 : 0, revealedAt: c.revealedAt ?? 0 },
        geometry: { type: 'Polygon' as const, coordinates: [c.polygon.map(p => [p.lng, p.lat])] },
      })),
    };

    // Per-cell fade-in: data-driven paint properties can't use Mapbox's
    // layer-level transitions, so newly revealed cells ease from the grid's
    // neutral opacity to full over REVEAL_FADE_MS by re-setting the opacity
    // expression each frame with the current clock (the standard trick for
    // per-feature time-based animation — the GPU evaluates it per feature).
    // The loop self-terminates once the youngest reveal has finished fading,
    // and is skipped entirely under prefers-reduced-motion.
    const REVEAL_FADE_MS = 450;
    const reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const newestReveal = cells.reduce((m, c) => Math.max(m, c.revealedAt ?? 0), 0);
    let raf = 0;

    const opacityExpression = (now: number) => [
      'case', ['==', ['get', 'revealed'], 0], 0.12,
      ['+', 0.12, ['*', 0.2,
        ['min', 1, ['max', 0, ['/', ['-', now, ['get', 'revealedAt']], REVEAL_FADE_MS]]]]],
    ];

    const animate = () => {
      try {
        if (!map.getLayer('hex-scan')) return;
        const now = performance.now();
        if (reducedMotion || now > newestReveal + REVEAL_FADE_MS) {
          // Everything has finished fading — pin the static values and stop.
          map.setPaintProperty('hex-scan', 'fill-opacity',
            ['case', ['==', ['get', 'revealed'], 0], 0.12, 0.32] as any);
          return;
        }
        map.setPaintProperty('hex-scan', 'fill-opacity', opacityExpression(now) as any);
        raf = requestAnimationFrame(animate);
      } catch (e) { /* style may be mid-teardown */ }
    };

    const apply = () => {
      try {
        const existing = map.getSource('hex-scan');
        if (existing) {
          existing.setData(data);
          animate();
          return;
        }
        map.addSource('hex-scan', { type: 'geojson', data } as any);
        map.addLayer({
          id: 'hex-scan',
          type: 'fill',
          source: 'hex-scan',
          paint: {
            // Unrevealed cells (still just grid outline, not yet sampled)
            // sit at a neutral grey; revealed ones pick up the same
            // green→amber→red gradient the final heatmap uses.
            'fill-color': [
              'case', ['==', ['get', 'revealed'], 0], '#334155',
              ['interpolate', ['linear'], ['get', 'cost'], 0, '#1E9E62', 0.5, '#F6A609', 1, '#D8232A'],
            ],
            'fill-opacity': ['case', ['==', ['get', 'revealed'], 0], 0.12, 0.32],
          },
        });
        map.addLayer({
          id: 'hex-scan-outline',
          type: 'line',
          source: 'hex-scan',
          paint: { 'line-color': 'rgba(255,255,255,0.10)', 'line-width': 0.5 },
        });
        animate();
      } catch (e) {
        logger.warn('Failed to render scan cells', e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      map.once('idle', apply);
    } else {
      apply();
    }

    // Cleanup cancels only the animation frame — the source/layers persist
    // across updates (updated in place via setData above). Tearing them down
    // on every streamed event made the whole corridor visibly blink during
    // the search (field-reported: "comes up at once then vanishes briefly").
    // Removal happens in the cells-empty branch above and on unmount below.
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [scanCells, heatmapColorMode]);

  // Unmount-only teardown for the persistent hex-scan source/layers.
  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (!map) return;
      try {
        if (map.getLayer('hex-scan-outline')) map.removeLayer('hex-scan-outline');
        if (map.getLayer('hex-scan')) map.removeLayer('hex-scan');
        if (map.getSource('hex-scan')) map.removeSource('hex-scan');
      } catch (e) { /* style may already be gone */ }
    };
  }, []);

  // WP2 — the live Dijkstra frontier's current best-guess path, so
  // pathfinding is visibly crawling the grid rather than appearing only
  // once the search finishes.
  useEffect(() => {
    const coords = scanBestPath && scanBestPath.length >= 2
      ? scanBestPath.map(c => [c.lng, c.lat])
      : null;
    setOverlay('scan-frontier', coords ? { type: 'LineString', coordinates: coords } : null, {
      main: { type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-opacity': 0.75, 'line-dasharray': [0.5, 1.5] } }
    });
  }, [scanBestPath]);

  // WP6 — area recon heatmap: same rendering as the route optimizer's
  // heatmap, but its own source so a scanned box survives independently of
  // any route search (neither clears the other).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cells = areaReconHeatmap;

    const remove = () => {
      try {
        if (map.getLayer('area-recon-heatmap-outline')) map.removeLayer('area-recon-heatmap-outline');
        if (map.getLayer('area-recon-heatmap')) map.removeLayer('area-recon-heatmap');
        if (map.getSource('area-recon-heatmap')) map.removeSource('area-recon-heatmap');
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
        properties: { cost: heatmapColorMode === 'relative' ? c.costNormalized : c.costNormalizedObjective },
        geometry: { type: 'Polygon' as const, coordinates: [c.polygon.map(p => [p.lng, p.lat])] },
      })),
    };

    const apply = () => {
      try {
        const existing = map.getSource('area-recon-heatmap');
        if (existing) {
          existing.setData(data);
          return;
        }
        map.addSource('area-recon-heatmap', { type: 'geojson', data } as any);
        map.addLayer({
          id: 'area-recon-heatmap',
          type: 'fill',
          source: 'area-recon-heatmap',
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
          id: 'area-recon-heatmap-outline',
          type: 'line',
          source: 'area-recon-heatmap',
          paint: { 'line-color': 'rgba(56,189,248,0.35)', 'line-width': 0.5 },
        });
        if (!reducedMotionRef.current) {
          map.setPaintProperty('area-recon-heatmap', 'fill-opacity-transition', { duration: 900 });
          requestAnimationFrame(() => {
            try { mapRef.current?.setPaintProperty('area-recon-heatmap', 'fill-opacity', 0.32); } catch { /* map gone */ }
          });
        }
      } catch (e) {
        logger.warn('Failed to render area recon heatmap', e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      map.once('idle', apply);
    } else {
      apply();
    }

    return () => remove();
  }, [areaReconHeatmap, heatmapColorMode]);

  // Painted-area geometry, resolved INCREMENTALLY (owner, 2026-07-27: "ensure
  // the painting happens during the drag and not at the end"). Painting always
  // did fire per dab, but the render replayed every stroke through @turf's
  // polygon booleans on every one of them — quadratic in stroke count and real
  // work each time, so a long stroke fell steadily further behind the finger
  // and the shape appeared to land in a lump at mouse-up. Since a drag only
  // ever APPENDS strokes, the resolved shape is cached and extended by the new
  // strokes alone; any other change (clear, undo, a fresh area) falls back to a
  // full replay, which is still correct.
  const originPaintGeomRef = useRef<{ count: number; feature: PaintedFeature }>({ count: 0, feature: null });
  const objectivePaintGeomRef = useRef<{ count: number; feature: PaintedFeature }>({ count: 0, feature: null });

  // Terrain Mobility mode — persistent painted origin (cyan) / objective
  // (amber) areas, rendered until cleared from App.tsx. Real ground size
  // (not a fixed screen radius) so the painted area reads as a stable patch
  // of ground at any zoom. The dabs are unioned into one continuous polygon
  // (paintedAreaToUnionGeometry, real @turf/union geometry — owner feedback
  // 2026-07-26: "a continuous shape, not a series of overlapping circles")
  // rather than rendered as independent overlapping circles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const remove = () => {
      try {
        if (map.getLayer('mobility-origin-paint-outline')) map.removeLayer('mobility-origin-paint-outline');
        if (map.getLayer('mobility-origin-paint')) map.removeLayer('mobility-origin-paint');
        if (map.getSource('mobility-origin-paint')) map.removeSource('mobility-origin-paint');
      } catch (e) { /* style may already be gone */ }
    };
    if (mobilityOriginPaint.length === 0) { originPaintGeomRef.current = { count: 0, feature: null }; remove(); return; }
    const geometry = resolvePaintedAreaIncrementally(originPaintGeomRef, mobilityOriginPaint);
    if (!geometry) { remove(); return; }
    const data = { type: 'Feature' as const, properties: {}, geometry };
    const apply = () => {
      try {
        const existing = map.getSource('mobility-origin-paint');
        if (existing) { existing.setData(data); return; }
        map.addSource('mobility-origin-paint', { type: 'geojson', data } as any);
        map.addLayer({ id: 'mobility-origin-paint', type: 'fill', source: 'mobility-origin-paint', paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.22 } });
        map.addLayer({ id: 'mobility-origin-paint-outline', type: 'line', source: 'mobility-origin-paint', paint: { 'line-color': '#38bdf8', 'line-width': 1.5 } });
      } catch (e) { logger.warn('Failed to render painted origin area', e); }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
    return () => remove();
  }, [mobilityOriginPaint]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const remove = () => {
      try {
        if (map.getLayer('mobility-objective-paint-outline')) map.removeLayer('mobility-objective-paint-outline');
        if (map.getLayer('mobility-objective-paint')) map.removeLayer('mobility-objective-paint');
        if (map.getSource('mobility-objective-paint')) map.removeSource('mobility-objective-paint');
      } catch (e) { /* style may already be gone */ }
    };
    if (mobilityObjectivePaint.length === 0) { objectivePaintGeomRef.current = { count: 0, feature: null }; remove(); return; }
    const geometry = resolvePaintedAreaIncrementally(objectivePaintGeomRef, mobilityObjectivePaint);
    if (!geometry) { remove(); return; }
    const data = { type: 'Feature' as const, properties: {}, geometry };
    const apply = () => {
      try {
        const existing = map.getSource('mobility-objective-paint');
        if (existing) { existing.setData(data); return; }
        map.addSource('mobility-objective-paint', { type: 'geojson', data } as any);
        map.addLayer({ id: 'mobility-objective-paint', type: 'fill', source: 'mobility-objective-paint', paint: { 'fill-color': '#F6A609', 'fill-opacity': 0.22 } });
        map.addLayer({ id: 'mobility-objective-paint-outline', type: 'line', source: 'mobility-objective-paint', paint: { 'line-color': '#F6A609', 'line-width': 1.5 } });
      } catch (e) { logger.warn('Failed to render painted objective area', e); }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
    return () => remove();
  }, [mobilityObjectivePaint]);

  // Terrain Mobility mode — result heatmap. Two independently switchable
  // colourings over the SAME cells (docs "Terrain Mobility & Counter-
  // Mobility" §3/§4): 'trafficability' is a terrain property (GO/SLOW-GO/
  // NO-GO, independent of reachability), 'isochrone' is a reachability
  // property (arrival-time band from the origin AOI's super-source search).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cells = mobilityHeatmap;

    const remove = () => {
      try {
        if (map.getLayer('mobility-heatmap-outline')) map.removeLayer('mobility-heatmap-outline');
        if (map.getLayer('mobility-heatmap')) map.removeLayer('mobility-heatmap');
        if (map.getSource('mobility-heatmap')) map.removeSource('mobility-heatmap');
      } catch (e) { /* style may already be gone */ }
    };

    if (!cells || cells.length === 0) {
      remove();
      return;
    }

    const maxBand = Math.max(1, ...cells.map(c => c.bandIndex));
    const data = {
      type: 'FeatureCollection' as const,
      features: cells.map(c => ({
        type: 'Feature' as const,
        properties: {
          trafficability: c.trafficability,
          bandIndex: c.bandIndex,
          reached: c.bandIndex >= 0 ? 1 : 0,
        },
        geometry: { type: 'Polygon' as const, coordinates: [c.polygon.map(p => [p.lng, p.lat])] },
      })),
    };

    const apply = () => {
      try {
        const existing = map.getSource('mobility-heatmap');
        if (existing) {
          existing.setData(data);
        } else {
          map.addSource('mobility-heatmap', { type: 'geojson', data } as any);
          map.addLayer({
            id: 'mobility-heatmap',
            type: 'fill',
            source: 'mobility-heatmap',
            paint: { 'fill-color': '#1E9E62', 'fill-opacity': 0.5 },
          });
          map.addLayer({
            id: 'mobility-heatmap-outline',
            type: 'line',
            source: 'mobility-heatmap',
            paint: { 'line-color': '#38bdf8', 'line-width': 0.5, 'line-opacity': 0.3 },
          });
        }
        if (mobilityDisplayMode === 'isochrone') {
          map.setPaintProperty('mobility-heatmap', 'fill-color', [
            'case',
            ['==', ['get', 'reached'], 0], '#1c2733',
            ['interpolate', ['linear'], ['get', 'bandIndex'], 0, '#38bdf8', maxBand, '#0b2a3f'],
          ]);
          registerOverlayOpacity('mobility-heatmap', 'fill-opacity', ['case', ['==', ['get', 'reached'], 0], 0.06, 0.55]);
        } else {
          map.setPaintProperty('mobility-heatmap', 'fill-color', [
            'match', ['get', 'trafficability'],
            'unrestricted', '#1E9E62',
            'restricted', '#F6A609',
            'severely-restricted', '#D8232A',
            '#55607A',
          ]);
          registerOverlayOpacity('mobility-heatmap', 'fill-opacity', 0.5);
        }
        registerOverlayOpacity('mobility-heatmap-outline', 'line-opacity', 0.3);
      } catch (e) {
        logger.warn('Failed to render mobility heatmap', e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      map.once('idle', apply);
    } else {
      apply();
    }

    return () => {
      unregisterOverlayOpacity('mobility-heatmap');
      unregisterOverlayOpacity('mobility-heatmap-outline');
      remove();
    };
  }, [mobilityHeatmap, mobilityDisplayMode, registerOverlayOpacity, unregisterOverlayOpacity]);

  // --- Probabilistic movement field (docs §32) ------------------------------
  // Per-cell share of simulated movers that crossed it. Deliberately styled as
  // a soft, single-hue field with NO outline and a strongly non-linear ramp:
  // this is modelled behaviour, and it must not read like the crisp, measured
  // GO/SLOW-GO grid sitting under it. The busy spine glows; ground a handful of
  // movers wandered into stays faint, because that is what the number means.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const remove = () => {
      try {
        if (map.getLayer('mobility-transit')) map.removeLayer('mobility-transit');
        unregisterOverlayOpacity('mobility-transit');
        if (map.getSource('mobility-transit')) map.removeSource('mobility-transit');
      } catch (e) { /* style may already be gone */ }
    };
    if (!mobilityTransitCells || mobilityTransitCells.length === 0) { remove(); return; }
    const data = {
      type: 'FeatureCollection' as const,
      features: mobilityTransitCells.map(c => ({
        type: 'Feature' as const,
        properties: { transit: Math.min(1, Math.max(0, c.transitFraction)) },
        geometry: { type: 'Polygon' as const, coordinates: [c.polygon.map(p => [p.lng, p.lat])] },
      })),
    };
    const apply = () => {
      try {
        const existing = map.getSource('mobility-transit');
        if (existing) {
          (existing as any).setData(data);
        } else {
          map.addSource('mobility-transit', { type: 'geojson', data } as any);
          map.addLayer({
            id: 'mobility-transit',
            type: 'fill',
            source: 'mobility-transit',
            paint: {
              'fill-color': [
                'interpolate', ['linear'], ['get', 'transit'],
                0, '#1b3a5c',
                0.25, '#2f7fb5',
                0.6, '#f2c14e',
                1, '#f2603c',
              ],
              'fill-opacity': 0,
            },
          } as any);
        }
        registerOverlayOpacity('mobility-transit', 'fill-opacity', [
          'interpolate', ['linear'], ['get', 'transit'], 0, 0.05, 1, 0.62,
        ]);
      } catch (e) { logger.warn('Failed to render movement transit field', e); }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
    return () => remove();
  }, [mobilityTransitCells, registerOverlayOpacity, unregisterOverlayOpacity]);

  // --- Hydrology reference layer (docs §34) ---------------------------------
  // Owner, 2026-07-27: "I can see substantial waterways in my sample area but
  // they don't seem to form a barrier in the overlay analysis. If they are
  // being considered then we need to show more of that." The GO/SLOW-GO/
  // NO-GO cell colouring now DOES react to water (mobilityCost.ts's fording
  // gate), but a coloured hex alone doesn't tell a reviewer "that's because of
  // THIS river" — this layer draws the actual mapped watercourse/water-body
  // geometry the gate is reacting to, as its own visible reference, separate
  // from any cell it influenced. Lines (river/canal/stream) get a bold casing
  // + core so a substantial waterway reads unmistakably as a real linear
  // feature; `natural=water` bodies get a filled polygon.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const remove = () => {
      try {
        for (const id of ['mobility-water-body', 'mobility-water-line-casing', 'mobility-water-line']) {
          if (map.getLayer(id)) map.removeLayer(id);
          unregisterOverlayOpacity(id);
        }
        if (map.getSource('mobility-water-body')) map.removeSource('mobility-water-body');
        if (map.getSource('mobility-water-line')) map.removeSource('mobility-water-line');
      } catch (e) { /* style may already be gone */ }
    };
    if (!waterFeatures || waterFeatures.length === 0) { remove(); return; }

    const bodyFeatures = waterFeatures
      .filter(f => f.kind === 'water' && f.coords.length >= 4)
      .map(f => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [f.coords.map(p => [p.lng, p.lat])] },
      }));
    const lineFeatures = waterFeatures
      .filter(f => f.kind !== 'water' && f.coords.length >= 2)
      .map(f => ({
        type: 'Feature' as const,
        properties: { kind: f.kind },
        geometry: { type: 'LineString' as const, coordinates: f.coords.map(p => [p.lng, p.lat]) },
      }));

    const apply = () => {
      try {
        const bodyData = { type: 'FeatureCollection' as const, features: bodyFeatures };
        const lineData = { type: 'FeatureCollection' as const, features: lineFeatures };
        if (map.getSource('mobility-water-body')) {
          (map.getSource('mobility-water-body') as any).setData(bodyData);
          (map.getSource('mobility-water-line') as any)?.setData(lineData);
        } else {
          map.addSource('mobility-water-body', { type: 'geojson', data: bodyData } as any);
          map.addLayer({
            id: 'mobility-water-body',
            type: 'fill',
            source: 'mobility-water-body',
            paint: { 'fill-color': '#1e88e5', 'fill-opacity': 0 },
          } as any);
          map.addSource('mobility-water-line', { type: 'geojson', data: lineData } as any);
          map.addLayer({
            id: 'mobility-water-line-casing',
            type: 'line',
            source: 'mobility-water-line',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#0a3d62',
              'line-width': ['match', ['get', 'kind'], 'stream', 4, 6],
              'line-opacity': 0,
            },
          } as any);
          map.addLayer({
            id: 'mobility-water-line',
            type: 'line',
            source: 'mobility-water-line',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#4fc3f7',
              'line-width': ['match', ['get', 'kind'], 'stream', 2, 3],
              'line-opacity': 0,
            },
          } as any);
        }
        registerOverlayOpacity('mobility-water-body', 'fill-opacity', 0.4);
        registerOverlayOpacity('mobility-water-line-casing', 'line-opacity', 0.9);
        registerOverlayOpacity('mobility-water-line', 'line-opacity', 0.95);
      } catch (e) { logger.warn('Failed to render hydrology reference layer', e); }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
    return () => remove();
  }, [waterFeatures, registerOverlayOpacity, unregisterOverlayOpacity]);

  // --- Recommended restrictions (docs §32) ---------------------------------
  // The actionable output of the whole mode: block HERE. Drawn as a heavy bar
  // across the ground between two real cell centres — never an invented point
  // along an edge — with a numbered badge carrying its rank, so the map and
  // the panel's ranked list are obviously the same thing.
  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapLibRef.current;
    const markers = restrictionMarkersRef.current;
    markers.forEach(m => m.remove());
    markers.length = 0;
    if (!map) return;
    const remove = () => {
      try {
        for (const id of ['mobility-restrictions', 'mobility-restrictions-casing']) {
          if (map.getLayer(id)) map.removeLayer(id);
          unregisterOverlayOpacity(id);
        }
        if (map.getSource('mobility-restrictions')) map.removeSource('mobility-restrictions');
      } catch (e) { /* style may already be gone */ }
    };
    if (!restrictions || restrictions.length === 0) { remove(); return; }
    const data = {
      type: 'FeatureCollection' as const,
      features: restrictions.map(r => ({
        type: 'Feature' as const,
        properties: { rank: r.rank, kind: r.kind },
        geometry: { type: 'LineString' as const, coordinates: [[r.from.lng, r.from.lat], [r.to.lng, r.to.lat]] },
      })),
    };
    const apply = () => {
      try {
        const existing = map.getSource('mobility-restrictions');
        if (existing) {
          (existing as any).setData(data);
        } else {
          map.addSource('mobility-restrictions', { type: 'geojson', data } as any);
          map.addLayer({
            id: 'mobility-restrictions-casing',
            type: 'line',
            source: 'mobility-restrictions',
            layout: { 'line-cap': 'butt' },
            paint: { 'line-color': '#2a0505', 'line-width': 12, 'line-opacity': 0 },
          } as any);
          map.addLayer({
            id: 'mobility-restrictions',
            type: 'line',
            source: 'mobility-restrictions',
            layout: { 'line-cap': 'butt' },
            paint: {
              'line-color': ['case', ['==', ['get', 'kind'], 'road-block'], '#ff4d4d', '#F6A609'],
              'line-width': 7,
              'line-opacity': 0,
              'line-dasharray': [1, 0.6],
            },
          } as any);
        }
        registerOverlayOpacity('mobility-restrictions-casing', 'line-opacity', 0.75);
        registerOverlayOpacity('mobility-restrictions', 'line-opacity', 0.95);
      } catch (e) { logger.warn('Failed to render recommended restrictions', e); }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();

    if (mapboxgl) {
      for (const r of restrictions) {
        const el = document.createElement('div');
        el.className = `restriction-map-badge restriction-map-badge--${r.kind}`;
        el.textContent = String(r.rank);
        el.title = r.kind === 'road-block' ? 'Recommended road block' : 'Recommended ground denial';
        try {
          markers.push(new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([(r.from.lng + r.to.lng) / 2, (r.from.lat + r.to.lat) / 2])
            .addTo(map));
        } catch (e) { logger.warn('Failed to place restriction badge', e); }
      }
    }

    return () => { markers.forEach(m => m.remove()); markers.length = 0; remove(); };
  }, [restrictions, registerOverlayOpacity, unregisterOverlayOpacity]);

  // --- Animated ensemble: many movers at once -------------------------------
  // GeoJSON layers rather than N DOM markers: at a dozen-plus movers updated
  // every animation frame, markers thrash the DOM, while one setData call per
  // frame on two layers does not. Trails fade the ensemble's history in behind
  // it so the fan-out and re-convergence is legible as it happens.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const remove = () => {
      try {
        for (const id of ['ensemble-movers', 'ensemble-trails']) {
          if (map.getLayer(id)) map.removeLayer(id);
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch (e) { /* style may already be gone */ }
    };
    if (!ensembleMovers || ensembleMovers.length === 0) { remove(); return; }
    const trailData = {
      type: 'FeatureCollection' as const,
      features: ensembleMovers
        .filter(m => m.trail.length >= 2)
        .map(m => ({
          type: 'Feature' as const,
          properties: { arrived: m.arrived ? 1 : 0 },
          geometry: { type: 'LineString' as const, coordinates: m.trail.map(p => [p.lng, p.lat]) },
        })),
    };
    const moverData = {
      type: 'FeatureCollection' as const,
      features: ensembleMovers.map(m => ({
        type: 'Feature' as const,
        properties: { arrived: m.arrived ? 1 : 0 },
        geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
      })),
    };
    const apply = () => {
      try {
        if (map.getSource('ensemble-trails')) {
          (map.getSource('ensemble-trails') as any).setData(trailData);
          (map.getSource('ensemble-movers') as any).setData(moverData);
          return;
        }
        map.addSource('ensemble-trails', { type: 'geojson', data: trailData } as any);
        map.addLayer({
          id: 'ensemble-trails',
          type: 'line',
          source: 'ensemble-trails',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#7dd3fc', 'line-width': 1.4, 'line-opacity': 0.45 },
        } as any);
        map.addSource('ensemble-movers', { type: 'geojson', data: moverData } as any);
        map.addLayer({
          id: 'ensemble-movers',
          type: 'circle',
          source: 'ensemble-movers',
          paint: {
            'circle-radius': 5,
            'circle-color': ['case', ['==', ['get', 'arrived'], 1], '#1E9E62', '#38bdf8'],
            'circle-stroke-color': '#04212f',
            'circle-stroke-width': 1.5,
            'circle-opacity': 0.95,
          },
        } as any);
      } catch (e) { logger.warn('Failed to render simulated movers', e); }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
  }, [ensembleMovers]);

  // Unit simulation — intended path line (redrawn whenever a mid-course
  // replan splices a new remainder onto it).
  useEffect(() => {
    const coords = unitSimPath && unitSimPath.length >= 2 ? unitSimPath.map(p => [p.lng, p.lat]) : null;
    setOverlay('unit-sim-path', coords ? { type: 'LineString', coordinates: coords } : null, {
      main: {
        type: 'line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#38bdf8', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [1.5, 1] },
      },
    });
  }, [unitSimPath]);

  // Docs §35 Slice A — box-free road-network route (vehicle profiles only).
  // Amber/dashed, distinct from the sky-blue unit-sim path above: this line
  // can exist even when the hex-grid search found no path at all, and is
  // deliberately styled so it doesn't read as "the" answer, just as A road
  // answer, restricted to the road network (see the log line that reports
  // it for the door-to-door caveat).
  useEffect(() => {
    const coords = roadRoute && roadRoute.length >= 2 ? roadRoute.map(p => [p.lng, p.lat]) : null;
    setOverlay('road-route-line', coords ? { type: 'LineString', coordinates: coords } : null, {
      main: {
        type: 'line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#f59e0b', 'line-width': 4, 'line-opacity': 0.8, 'line-dasharray': [3, 2] },
      },
    });
  }, [roadRoute]);

  // Unit simulation — the moving unit itself. A plain mapboxgl.Marker moved
  // via setLngLat on every animation frame (see App.tsx's UnitSimulationController)
  // so per-frame updates never touch React state / re-render this component.
  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapLibRef.current;
    if (!map || !mapboxgl) return;

    if (!unitSimPosition) {
      unitSimMarkerRef.current?.remove();
      unitSimMarkerRef.current = null;
      return;
    }

    if (!unitSimMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'unit-sim-marker';
      unitSimMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([unitSimPosition.lng, unitSimPosition.lat]).addTo(map);
    } else {
      unitSimMarkerRef.current.setLngLat([unitSimPosition.lng, unitSimPosition.lat]);
    }
  }, [unitSimPosition]);

  // Movement corridors — the presentation layer (docs §28, clarified §33).
  //
  // The original render was bands only: a fill of hexes whose per-cell opacity
  // followed density. That is the right honesty statement (fuzzy edges = "we
  // don't know exactly where within here") but on its own it reads as blotches
  // — field report, 2026-07-27: "the corridors are visually unclear to me."
  // Two overlapping bands with soft edges and no boundary give the eye nothing
  // to latch a shape onto, and nothing ties a band on the map to a card in the
  // panel. So the band now carries FOUR paired layers, each doing one job:
  //
  //   1. `mobility-corridors` — the density fill, unchanged in meaning: the
  //      soft interior gradient is still the uncertainty statement.
  //   2. `mobility-corridor-edge` — the corridor's dissolved OUTLINE (a real
  //      @turf/union of its own hexes, so it is the actual extent, not a
  //      drawn-on approximation). Deliberately thin and semi-transparent: it
  //      makes the band legible as one object without hardening the claim
  //      into a surveyed boundary.
  //   3. `mobility-corridor-spine` — only the highest-density cells, drawn
  //      brighter. This is where movement is most concentrated, which is the
  //      thing a commander actually reads off a corridor.
  //   4. `mobility-corridor-routes` — ONE representative line per corridor
  //      (its own fastest analysed route), not the full analysed set (owner,
  //      2026-07-28: "the individual white lines of the considered paths
  //      don't work as a visualisation... they end up being 'triangles'
  //      between the grid centres and they don't follow the road geometry
  //      ... consolidate to show substantive differences, not that every
  //      piece of ground has been considered"). `App.tsx`'s
  //      `corridorRoutesForMap` refines each one first (`pathRefinement.ts`
  //      — snap onto a nearby road where the route genuinely follows one,
  //      corner-smooth the rest) before it ever reaches this layer, so what
  //      renders here is already the presentation line, not raw hex-centre
  //      steps.
  //
  // `highlightedCorridorId` dims every band but one, so picking a card in the
  // panel answers "which of these is that" unambiguously.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layerIds = ['mobility-corridor-routes', 'mobility-corridor-routes-casing', 'mobility-corridor-spine', 'mobility-corridor-edge', 'mobility-corridors'];
    const remove = () => {
      try {
        for (const id of layerIds) {
          if (map.getLayer(id)) map.removeLayer(id);
          unregisterOverlayOpacity(id);
        }
        for (const id of ['mobility-corridor-routes', 'mobility-corridor-edge', 'mobility-corridors']) {
          if (map.getSource(id)) map.removeSource(id);
        }
      } catch (e) { /* style may already be gone */ }
    };
    if (!corridors || corridors.length === 0) { remove(); return; }

    // Rank-coded — deliberately a BLUE/VIOLET family, entirely outside the
    // red/amber/green the trafficability heatmap already owns (owner,
    // 2026-07-27, live-testing: "the corridors need to be a colour other
    // than red. The red, amber, green is used for the hex to show
    // passability so the corridor in red makes it look like it's picking
    // the hardest route!" — confirmed a real collision, not just taste:
    // rank 1 was `#D8232A`, identical to the heatmap's own NO-GO red; rank
    // 2 was `#F6A609`, identical to its SLOW-GO amber). Ease class is
    // carried as a property for the legend rather than a second colour
    // axis, so one visual channel = one meaning.
    const rankColor = (rank: number) =>
      rank === 1 ? '#3B82F6' : rank === 2 ? '#8B5CF6' : rank === 3 ? '#06B6D4' : '#94a3b8';

    const cellFeatures = corridors.flatMap(c =>
      c.cells.map(cell => ({
        type: 'Feature' as const,
        properties: {
          corridorId: c.id,
          rank: c.rank,
          ease: c.easeClass,
          color: rankColor(c.rank),
          density: Math.min(1, Math.max(0, cell.density)),
          // Floor the opacity so a low-density fringe cell is still faintly
          // visible (it IS part of the corridor) without reading as strongly
          // as the spine.
          opacity: 0.10 + 0.40 * Math.min(1, Math.max(0, cell.density)),
        },
        geometry: { type: 'Polygon' as const, coordinates: [cell.polygon.map(p => [p.lng, p.lat])] },
      }))
    );

    // Dissolved outline per corridor — a genuine union of that corridor's own
    // hexes. Falls back to the undissolved cells if the union fails for any
    // reason, so a geometry edge case degrades to the previous look rather
    // than dropping the corridor off the map entirely.
    const edgeFeatures = corridors.map(c => {
      let dissolved: any = null;
      try {
        const polys = c.cells.map(cell => turfPolygon([cell.polygon.map(p => [p.lng, p.lat])]));
        dissolved = polys.length === 1 ? polys[0] : union(featureCollection(polys) as any);
      } catch (e) {
        logger.warn('Corridor outline union failed; falling back to cell fill only', e);
      }
      if (!dissolved) return null;
      // Chaikin corner-cutting over the real dissolved shape (docs §28,
      // "Smooth the corridor band's own outline") — presentation only, the
      // EXTENT is still exactly what buildCorridorField computed; this just
      // rounds off the hex tessellation's own blocky edge at close zoom.
      // 2 passes matches the same default used for corridor route lines
      // (`App.tsx`'s `cornerSmoothingIterations`), enough to read as a band
      // rather than a staircase without eroding the shape's real extent.
      const geometry = smoothPolygonGeometry(dissolved.geometry, 2);
      return {
        type: 'Feature' as const,
        properties: { corridorId: c.id, rank: c.rank, color: rankColor(c.rank) },
        geometry,
      };
    }).filter((f): f is NonNullable<typeof f> => f !== null);

    const routeFeatures = (corridorRoutes ?? []).map(r => ({
      type: 'Feature' as const,
      properties: { corridorId: r.id, color: rankColor(r.rank) },
      geometry: { type: 'LineString' as const, coordinates: r.path.map(p => [p.lng, p.lat]) },
    }));

    // Highlight is applied as a MULTIPLIER on each layer's own designed
    // opacity, so the density gradient inside the chosen band survives.
    const emphasis = (): number | unknown[] => (
      highlightedCorridorId
        ? ['case', ['==', ['get', 'corridorId'], highlightedCorridorId], 1.25, 0.2]
        : 1
    );
    const scaledBy = (base: number | unknown[]): number | unknown[] => {
      const e = emphasis();
      if (typeof e === 'number' && typeof base === 'number') return base * e;
      return ['*', base, e];
    };

    const apply = () => {
      try {
        const cellData = { type: 'FeatureCollection' as const, features: cellFeatures };
        const edgeData = { type: 'FeatureCollection' as const, features: edgeFeatures };
        const routeData = { type: 'FeatureCollection' as const, features: routeFeatures };

        if (map.getSource('mobility-corridors')) {
          (map.getSource('mobility-corridors') as any).setData(cellData);
          (map.getSource('mobility-corridor-edge') as any)?.setData(edgeData);
          (map.getSource('mobility-corridor-routes') as any)?.setData(routeData);
        } else {
          map.addSource('mobility-corridors', { type: 'geojson', data: cellData } as any);
          map.addLayer({
            id: 'mobility-corridors',
            type: 'fill',
            source: 'mobility-corridors',
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0 },
          } as any);
          map.addSource('mobility-corridor-edge', { type: 'geojson', data: edgeData } as any);
          map.addLayer({
            id: 'mobility-corridor-edge',
            type: 'line',
            source: 'mobility-corridor-edge',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            // Crisp, not blurred (2026-07-28, corridor legibility pass —
            // owner: challenged to "pull out the corridors" from a screenshot
            // cold and couldn't). A blurred 2px line reads as a smudge at any
            // real zoom; a solid, wider line reads as an actual boundary.
            paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0 },
          } as any);
          map.addLayer({
            id: 'mobility-corridor-spine',
            type: 'fill',
            source: 'mobility-corridors',
            filter: ['>=', ['get', 'density'], 0.6],
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0 },
          } as any);
          map.addSource('mobility-corridor-routes', { type: 'geojson', data: routeData } as any);
          // Casing + core (2026-07-28), same pattern already used for
          // recommended-restriction lines (`mobility-restrictions-casing`):
          // a wider dark line underneath a narrower, rank-coloured one on top
          // reads crisply against ANY hex colour behind it. The route line
          // previously rendered at 0.8px / near-white / 40% opacity — the
          // single clearest shape a corridor has (a real drawn path, not a
          // fuzzy fill) was effectively invisible; this is now the star, not
          // an afterthought.
          map.addLayer({
            id: 'mobility-corridor-routes-casing',
            type: 'line',
            source: 'mobility-corridor-routes',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#05070a', 'line-width': 6, 'line-opacity': 0 },
          } as any);
          map.addLayer({
            id: 'mobility-corridor-routes',
            type: 'line',
            source: 'mobility-corridor-routes',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0 },
          } as any);
        }

        registerOverlayOpacity('mobility-corridors', 'fill-opacity', scaledBy(['get', 'opacity']));
        registerOverlayOpacity('mobility-corridor-edge', 'line-opacity', scaledBy(0.85));
        registerOverlayOpacity('mobility-corridor-spine', 'fill-opacity', scaledBy(0.28));
        registerOverlayOpacity('mobility-corridor-routes-casing', 'line-opacity', scaledBy(0.8));
        registerOverlayOpacity('mobility-corridor-routes', 'line-opacity', scaledBy(1));
      } catch (e) { logger.warn('Failed to render movement corridors', e); }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
    return () => remove();
  }, [corridors, corridorRoutes, highlightedCorridorId, registerOverlayOpacity, unregisterOverlayOpacity]);

  // Tapping a corridor band on the map selects it, the same selection the
  // panel's corridor cards drive — so the map and the panel are two views of
  // one choice rather than two unrelated lists.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onCorridorHighlight) return;
    const onClick = (e: any) => {
      const id = e?.features?.[0]?.properties?.corridorId;
      if (typeof id === 'string') onCorridorHighlight(id === highlightedCorridorId ? null : id);
    };
    try { map.on('click', 'mobility-corridors', onClick); } catch { /* layer not present yet */ }
    return () => { try { map.off('click', 'mobility-corridors', onClick); } catch { /* map gone */ } };
  }, [onCorridorHighlight, highlightedCorridorId, corridors]);

  // Corridor labels — an HTML marker per corridor at its densest cell, so a
  // band on the map names itself ("CORRIDOR 1 · OPEN · ~180 M") instead of
  // needing to be cross-referenced against the panel. Deliberately HTML
  // markers rather than a Mapbox symbol layer: symbol layers need font glyphs
  // from the style, and this mode's basemap is user-overridable
  // (VITE_MAPBOX_TACTICAL_STYLE), so a missing glyph set would silently drop
  // every label.
  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapLibRef.current;
    const markers = corridorLabelMarkersRef.current;
    markers.forEach(m => m.remove());
    markers.length = 0;
    if (!map || !mapboxgl || !corridors || corridors.length === 0) return;
    for (const c of corridors) {
      const densest = c.cells.reduce((best, cell) => (cell.density > best.density ? cell : best), c.cells[0]);
      if (!densest) continue;
      const lat = densest.polygon.reduce((s, p) => s + p.lat, 0) / densest.polygon.length;
      const lng = densest.polygon.reduce((s, p) => s + p.lng, 0) / densest.polygon.length;
      const el = document.createElement('div');
      el.className = `corridor-map-label corridor-map-label--rank${Math.min(c.rank, 4)}${highlightedCorridorId && highlightedCorridorId !== c.id ? ' dimmed' : ''}`;
      // Numbered badge first (docs §28 addendum, 2026-07-28 — owner: "pull out
      // the corridors ... without excellent prior knowledge" exposed that a
      // bare text label gives the eye nothing to anchor to). The badge's own
      // fill is the SAME rank colour the label border/text and the map
      // shape/route already use, so this one small circle visually ties all
      // three together instead of each being its own disconnected mark.
      const badge = document.createElement('span');
      badge.className = 'corridor-map-label__badge';
      badge.textContent = String(c.rank);
      const text = document.createElement('span');
      text.textContent = `CORRIDOR ${c.rank} · ${c.easeClass.replace('-', ' ').toUpperCase()} · ~${Math.round(c.bottleneckWidthM)} M`;
      el.appendChild(badge);
      el.appendChild(text);
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        onCorridorHighlight?.(highlightedCorridorId === c.id ? null : c.id);
      });
      try {
        markers.push(new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map));
      } catch (e) { logger.warn('Failed to place corridor label', e); }
    }
    return () => { markers.forEach(m => m.remove()); markers.length = 0; };
  }, [corridors, highlightedCorridorId, onCorridorHighlight]);

  // Pass 2 — chokepoint markers, sized/coloured by how many of the
  // dissimilar routes cross each cell (docs §4: "the ground everything
  // funnels through").
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const remove = () => {
      try {
        if (map.getLayer('mobility-chokepoints')) map.removeLayer('mobility-chokepoints');
        if (map.getSource('mobility-chokepoints')) map.removeSource('mobility-chokepoints');
      } catch (e) { /* style may already be gone */ }
    };
    if (!chokepoints || chokepoints.length === 0) { remove(); return; }
    const maxCount = Math.max(1, ...chokepoints.map(c => c.passCount));
    const data = {
      type: 'FeatureCollection' as const,
      features: chokepoints.map(c => ({
        type: 'Feature' as const,
        properties: { passCount: c.passCount, weight: c.passCount / maxCount },
        geometry: { type: 'Point' as const, coordinates: [c.center.lng, c.center.lat] },
      })),
    };
    const apply = () => {
      try {
        const existing = map.getSource('mobility-chokepoints');
        if (existing) { existing.setData(data); return; }
        map.addSource('mobility-chokepoints', { type: 'geojson', data } as any);
        map.addLayer({
          id: 'mobility-chokepoints',
          type: 'circle',
          source: 'mobility-chokepoints',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 0, 5, 1, 14],
            'circle-color': '#D8232A',
            'circle-opacity': 0.55,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        });
        registerOverlayOpacity('mobility-chokepoints', 'circle-opacity', 0.55);
        registerOverlayOpacity('mobility-chokepoints', 'circle-stroke-opacity', 0.9);
      } catch (e) {
        logger.warn('Failed to render chokepoints', e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
    return () => { unregisterOverlayOpacity('mobility-chokepoints'); remove(); };
  }, [chokepoints, registerOverlayOpacity, unregisterOverlayOpacity]);

  // Pass 2 — min-cut barrier plan: the cheapest set of segments severing the
  // origin AOI from the objective AOI for the selected profile.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const remove = () => {
      try {
        if (map.getLayer('mobility-barrier')) map.removeLayer('mobility-barrier');
        if (map.getSource('mobility-barrier')) map.removeSource('mobility-barrier');
      } catch (e) { /* style may already be gone */ }
    };
    if (!barrierSegments || barrierSegments.length === 0) { remove(); return; }
    const data = {
      type: 'FeatureCollection' as const,
      features: barrierSegments.map(s => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: [[s.from.lng, s.from.lat], [s.to.lng, s.to.lat]] },
      })),
    };
    const apply = () => {
      try {
        const existing = map.getSource('mobility-barrier');
        if (existing) { existing.setData(data); return; }
        map.addSource('mobility-barrier', { type: 'geojson', data } as any);
        map.addLayer({
          id: 'mobility-barrier',
          type: 'line',
          source: 'mobility-barrier',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#D8232A', 'line-width': 5, 'line-opacity': 0.85 },
        });
        registerOverlayOpacity('mobility-barrier', 'line-opacity', 0.85);
      } catch (e) {
        logger.warn('Failed to render barrier plan', e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
    return () => { unregisterOverlayOpacity('mobility-barrier'); remove(); };
  }, [barrierSegments, registerOverlayOpacity, unregisterOverlayOpacity]);

  // OCOKA 3 (docs/ROUTE_INTELLIGENCE.md §47) — road-network-exact min-cut: the
  // cheapest set of REAL road segments (not hex-cell edges) severing the road
  // network between the painted areas. A separate layer from `mobility-barrier`
  // above, not a restyle of it — dashed purple so it reads as the more precise,
  // road-geometry-exact sibling rather than a duplicate of the hex cut.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const remove = () => {
      try {
        if (map.getLayer('mobility-road-barrier')) map.removeLayer('mobility-road-barrier');
        if (map.getSource('mobility-road-barrier')) map.removeSource('mobility-road-barrier');
      } catch (e) { /* style may already be gone */ }
    };
    if (!roadBarrierSegments || roadBarrierSegments.length === 0) { remove(); return; }
    const data = {
      type: 'FeatureCollection' as const,
      features: roadBarrierSegments.map(s => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: [[s.from.lng, s.from.lat], [s.to.lng, s.to.lat]] },
      })),
    };
    const apply = () => {
      try {
        const existing = map.getSource('mobility-road-barrier');
        if (existing) { existing.setData(data); return; }
        map.addSource('mobility-road-barrier', { type: 'geojson', data } as any);
        map.addLayer({
          id: 'mobility-road-barrier',
          type: 'line',
          source: 'mobility-road-barrier',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#7C3AED', 'line-width': 5, 'line-opacity': 0.85, 'line-dasharray': [2, 1.5] },
        });
        registerOverlayOpacity('mobility-road-barrier', 'line-opacity', 0.85);
      } catch (e) {
        logger.warn('Failed to render road-network barrier plan', e);
      }
    };
    if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', apply); else apply();
    return () => { unregisterOverlayOpacity('mobility-road-barrier'); remove(); };
  }, [roadBarrierSegments, registerOverlayOpacity, unregisterOverlayOpacity]);

  // Live context feeds — hotspots, fire/burn boundaries, jurisdictional
  // incidents. Data is fetched by LiveFeedsControl (now in AnalysisPanel);
  // this just syncs it onto the map whenever it changes.
  const effectiveLiveFeedData = externalLiveFeedData ?? liveFeedData;
  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapLibRef.current;
    if (!map || !mapboxgl) return;
    const apply = () => applyLiveFeedLayers(map, mapboxgl, effectiveLiveFeedData);
    if (map.isStyleLoaded && !map.isStyleLoaded()) {
      map.once('idle', apply);
    } else {
      apply();
    }
  }, [effectiveLiveFeedData]);

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
      id: i, // stable per-segment id — required for setFeatureState in the reveal below
      properties:{ slope:seg.slope, category:seg.category, distance:seg.distance, elevationChange:Math.abs(seg.endElevation-seg.startElevation), color:getSlopeColor(seg.category), index:i },
      geometry:{ type:'LineString' as const, coordinates:(seg.coords && seg.coords.length>=2? seg.coords.map(c=>[c[1],c[0]]): [[seg.start[1],seg.start[0]],[seg.end[1],seg.end[0]]]) }
    }));
    map.addSource('slope-segments',{ type:'geojson', data:{ type:'FeatureCollection', features } } as any);
    // Unrevealed segments render as a faint neutral preview line (so the
    // route's shape is visible immediately) — feature-state flips each one
    // to its real slope colour as startSlopeReveal sweeps through, with a
    // short paint transition so each arrival fades in rather than popping.
    map.addLayer({
      id:'slope-segments', type:'line', source:'slope-segments',
      layout:{ 'line-join':'round','line-cap':'round' },
      paint:{
        'line-color': ['case', ['boolean', ['feature-state','revealed'], false], ['get','color'], 'rgba(148,163,184,0.4)'],
        'line-width': ['case', ['boolean', ['feature-state','revealed'], false], 6, 3],
        'line-opacity': ['case', ['boolean', ['feature-state','revealed'], false], 0.85, 0.5],
        'line-color-transition': { duration: 240 },
        'line-width-transition': { duration: 240 },
        'line-opacity-transition': { duration: 240 },
      } as any,
    });
    startSlopeReveal(features.length);
  };

  /** Sweeps `revealed` feature-state across the slope-segments source over
   *  REVEAL_DURATION_MS, left-to-right along the drawn line — "the reveal is
   *  the demo" (2026-07-26 UI review, master_plan.md Step 11), the same
   *  moment AnalysisPanel's hero-readout numbers count up in. Reduced-motion
   *  users get every segment revealed on the first frame instead. */
  const startSlopeReveal = (count: number) => {
    const map = mapRef.current;
    if (!map || count === 0) return;
    const token = ++slopeRevealTokenRef.current;
    if (reducedMotionRef.current) {
      for (let i = 0; i < count; i++) map.setFeatureState({ source: 'slope-segments', id: i }, { revealed: true });
      return;
    }
    const start = performance.now();
    let revealed = 0;
    const step = (now: number) => {
      if (slopeRevealTokenRef.current !== token) return; // superseded by a newer analysis
      const m = mapRef.current;
      if (!m || !m.getSource('slope-segments')) return;
      const elapsed = now - start;
      const target = Math.min(count, Math.ceil((elapsed / REVEAL_DURATION_MS) * count));
      for (let i = revealed; i < target; i++) {
        m.setFeatureState({ source: 'slope-segments', id: i }, { revealed: true });
      }
      revealed = target;
      if (revealed < count) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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
      {!tacticalMode && showTouchHint && (
        <div className="touch-hint-overlay">
          Tap to add points, double‑tap to finish.
          <button onClick={() => setShowTouchHint(false)}>×</button>
        </div>
      )}
      {!tacticalMode && isAnalyzing && (
        <div className="analyzing-badge">Analyzing…</div>
      )}
      {/* Optimizer progress ON the map: on phones the analysis panel is
          usually collapsed and its % counter hidden below the expansion
          handle, so the map carries the phase + % itself. */}
      {optimizerScanning && (
        <div className="map-progress-pill" role="status">
          <span className="map-progress-pill-spinner" aria-hidden />
          <span>{phaseMessage(optimizerPhase, optimizerProgress)}</span>
          <strong>{Math.round(optimizerProgress * 100)}%</strong>
        </div>
      )}
      {/* transient locating UI */}
      {isLocating && (
        <div className="locating-badge">Locating…</div>
      )}
      {locationError && (
        <div className="location-error-badge">{locationError}</div>
      )}
      {!tacticalMode && fireBreakDistance!=null && (
        <div className="distance-badge">Distance: {Math.round(fireBreakDistance)} m</div>
      )}
      {!tacticalMode && onAreaReconActiveChange && (
        <button
          type="button"
          className={`area-recon-toggle-btn${areaReconActive ? ' active' : ''}`}
          onClick={() => onAreaReconActiveChange(!areaReconActive)}
          title="Scan a box for terrain and vegetation difficulty, before drawing a line through it"
        >
          {areaReconActive ? 'Click two corners…' : 'Scan area'}
        </button>
      )}
      {!tacticalMode && areaReconStatus === 'running' && (
        <div className="area-recon-badge">Scanning area…</div>
      )}
      {!tacticalMode && areaReconStatus === 'error' && (
        <div className="area-recon-badge error">Area scan failed</div>
      )}
      {!tacticalMode && areaReconStatus === 'done' && onClearAreaRecon && (
        <button type="button" className="area-recon-clear-btn" onClick={onClearAreaRecon}>
          Clear scan
        </button>
      )}
      {/* Brush cursor (owner, 2026-07-27: "the mouse icon for painting needs
          to be different, a size appropriate brush"). A ring approximating
          the brush's real hex cluster (docs §35: a FIXED ground size —
          100m-circumradius hexes, brush size sets how many), converted to
          on-screen pixels at the cursor's own zoom/latitude
          (`brushCursorPoint.radiusPx`) — genuinely bigger zoomed in, smaller
          zoomed out, an honest preview of ground coverage at any zoom.
          Pointer-events off so it never intercepts the stroke it is
          previewing. */}
      {tacticalMode && mobilityBoxRole && brushCursorPoint && !panOverrideActive && (
        <div
          className={`paint-brush-cursor paint-brush-cursor--${mobilityPaintMode} paint-brush-cursor--${mobilityBoxRole}`}
          style={{
            left: brushCursorPoint.x,
            top: brushCursorPoint.y,
            width: brushCursorPoint.radiusPx * 2,
            height: brushCursorPoint.radiusPx * 2,
          }}
          aria-hidden
        >
          <span className="paint-brush-cursor-dot" />
        </div>
      )}
      {/* Subtle guidance while painting, dismissible and self-dismissing once
          the area has strokes in it — it is a nudge, not a modal. */}
      {tacticalMode && mobilityBoxRole && !paintHintDismissed && (
        <div className="paint-hint" role="status">
          <strong>
            {mobilityPaintMode === 'erase' ? 'Drag to erase' : 'Click and drag to paint'}
            {' '}the {mobilityBoxRole} area
          </strong>
          <span>Paint appears as you drag · hold <kbd>Space</kbd> to pan the map · S/M/L changes brush size</span>
          <button type="button" onClick={() => setPaintHintDismissed(true)} aria-label="Dismiss painting hint">×</button>
        </div>
      )}
      {tacticalMode && panOverrideActive && (
        <div className="paint-pan-badge" role="status">Pan mode — release <kbd>Space</kbd> to paint</div>
      )}
      {/* Terrain-mode run progress. Previously this mode showed nothing at all
          while the analysis worked (owner: "a long process of churn with no
          visual update"): the fire-break progress pill above is gated on the
          optimizer, and the assessment log lives in a panel that is usually
          collapsed on a phone. Phase, bar and the latest real log line. */}
      {tacticalMode && mobilityRunning && (
        <div className="mobility-progress-hud" role="status" aria-live="polite">
          <div className="mobility-progress-hud-head">
            <span className="mobility-progress-hud-spinner" aria-hidden />
            <span className="mobility-progress-hud-stage">{mobilityStageLabel ?? 'Working…'}</span>
            <strong>{Math.round(mobilityProgress * 100)}%</strong>
          </div>
          <div className="mobility-progress-hud-bar">
            <div
              className="mobility-progress-hud-fill"
              style={{ width: `${Math.max(2, Math.min(100, mobilityProgress * 100))}%` }}
            />
          </div>
          {mobilityLatestLog && (
            <div className="mobility-progress-hud-log tac-mono">{mobilityLatestLog}</div>
          )}
        </div>
      )}
      {tacticalMode && (
        <div className="mobility-overlay-controls">
          <button
            type="button"
            className={`mobility-overlay-btn mobility-overlay-btn--origin${mobilityBoxRole === 'origin' ? ' active' : ''}`}
            onClick={() => onMobilityBoxRoleChange?.(mobilityBoxRole === 'origin' ? null : 'origin')}
          >
            {mobilityBoxRole === 'origin' ? (mobilityPaintMode === 'erase' ? 'Drag to erase…' : 'Drag to paint…') : (mobilityOriginPaint.length > 0 ? `Origin (${mobilityOriginPaint.length})` : 'Paint origin')}
          </button>
          <button
            type="button"
            className={`mobility-overlay-btn mobility-overlay-btn--objective${mobilityBoxRole === 'objective' ? ' active' : ''}`}
            onClick={() => onMobilityBoxRoleChange?.(mobilityBoxRole === 'objective' ? null : 'objective')}
          >
            {mobilityBoxRole === 'objective' ? (mobilityPaintMode === 'erase' ? 'Drag to erase…' : 'Drag to paint…') : (mobilityObjectivePaint.length > 0 ? `Objective (${mobilityObjectivePaint.length})` : 'Paint objective')}
          </button>
          {mobilityBoxRole && (
            <div className="mobility-brush-row">
              {(['small', 'medium', 'large', 'xl'] as const).map(size => (
                <button
                  key={size}
                  type="button"
                  className={`mobility-brush-btn${mobilityBrushSize === size ? ' active' : ''}`}
                  onClick={() => onMobilityBrushSizeChange?.(size)}
                  title={`${BRUSH_HEX_COUNT[size]} hex${BRUSH_HEX_COUNT[size] === 1 ? '' : 'es'} (${PAINT_HEX_SIZE_M}m each)`}
                >
                  {BRUSH_LABEL[size]}
                </button>
              ))}
            </div>
          )}
          {mobilityBoxRole && (
            <button
              type="button"
              className={`mobility-overlay-btn mobility-overlay-btn--erase${mobilityPaintMode === 'erase' ? ' active' : ''}`}
              onClick={() => onMobilityPaintModeChange?.(mobilityPaintMode === 'erase' ? 'paint' : 'erase')}
            >
              {mobilityPaintMode === 'erase' ? 'Erasing — tap to paint' : 'Erase'}
            </button>
          )}
          {!mobilityRunning ? (
            <button
              type="button"
              className="mobility-overlay-btn mobility-overlay-btn--run"
              disabled={mobilityOriginPaint.length === 0 || mobilityObjectivePaint.length === 0}
              onClick={() => onRunAppreciation?.()}
            >
              Run appreciation
            </button>
          ) : (
            <button
              type="button"
              className="mobility-overlay-btn mobility-overlay-btn--cancel"
              onClick={() => onCancelAppreciation?.()}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default MapboxMapView;
