import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Settings2, Radar } from 'lucide-react';
import { MapboxMapView } from './components/MapboxMapView';
import { AnalysisPanel } from './components/AnalysisPanel';
import IntegratedConfigPanel from './components/IntegratedConfigPanel';
import { SearchControl } from './components/SearchControl';
import { MapEmptyState } from './components/MapEmptyState';
import { defaultConfig } from './config/defaultConfig';
import { MachinerySpec, AircraftSpec, HandCrewSpec, VegetationAnalysis, TrackAnalysis } from './types/config';
import { EquipmentApi, CreateEquipmentInput, MachineryApi, AircraftApi, HandCrewApi } from './types/equipmentApi';
import { listEquipment, createEquipment, updateEquipmentItem, deleteEquipment } from './utils/equipmentApi';
import { VegetationFormationMappingApi, CreateVegetationMappingInput } from './types/vegetationMappingApi';
import {
  listVegetationMappings,
  createVegetationMapping,
  updateVegetationMappingItem,
  deleteVegetationMapping
} from './utils/vegetationMappingApi';
import { _clearNSWCache } from './utils/nswVegetationService';
import { readPlanFromUrl, encodePlan, SharedPlan } from './utils/planSharing';
import { AccountControl } from './components/AccountControl';
import { SuiteSession } from './utils/suiteAuth';
import { createSavedPlan, SavedPlanApi } from './utils/savedPlansApi';
import { buildChainageIndex, pointAtChainage, sliceByChainage } from './utils/chainage';
import { optimizeRoute, OptimizedRouteResult, HexHeatmapCell } from './utils/routeOptimizer';
import { scanArea } from './utils/areaScan';
import { OptimizerStatus } from './components/AdvisorPanel';
import { ImportedFeatures, importedToGeoJSON } from './utils/gisImport';
import { LiveFeedMapData } from './utils/liveFeedLayers';
import { ViewBounds } from './utils/liveFeedsService';
import { logger } from './utils/logger';
import { refinePath } from './utils/pathRefinement';
import { PaintedArea, PaintStrokeMode, BrushSize, createHexDab } from './terrain/paintedArea';
import { runMobilityAppreciation, MobilityAppreciationResult } from './terrain/mobilityAppreciation';
import { DEFAULT_ISOCHRONE_MINUTES } from './terrain/accumulatedCost';
import { DEFAULT_MOVER_PROFILE_ID } from './terrain/moverProfiles';
import { RoadSpeedOverrides } from './terrain/roadSpeedModel';
import { MobilityFidelity, DEFAULT_MOBILITY_FIDELITY, originObjectiveDistanceM } from './terrain/mobilityGrid';
import { MobilityClass } from './terrain/mobilityClass';
import { recordMobilityRunTelemetry, MobilityStageTimestamp } from './terrain/mobilityTelemetry';
import { MobilityPanel } from './components/MobilityPanel';
import { CounterMobilityPanel } from './components/CounterMobilityPanel';
import { OakocPanel } from './components/OakocPanel';
import { COUNTER_MEASURES } from './terrain/counterMeasures';
import { computeDelayLedger, buildScenarioEdgePenalties, CounterMeasurePlacement, DelayLedgerEntry } from './terrain/delayLedger';
import { buildCorridorField, compareCorridorFields, CorridorComparison, CorridorField } from './terrain/corridorField';
import { UnitSimulationController, EnsembleAnimationController, EnsembleMoverState } from './terrain/unitSimulation';
import { MobilityLegend } from './components/MobilityLegend';
import { DEFAULT_BEHAVIOUR_SPREAD_ID } from './terrain/movementSimulation';
import { MobilityStage } from './terrain/mobilityAppreciation';
import './styles-tactical.css';

// Site logo/favicon is in the public directory and served at /favicon-96x96.png.
const logo96 = '/favicon-96x96.png';

/**
 * Root application component for the Fire Break Calculator.
 * Renders a fixed-height header (10% of viewport), responsive Mapbox GL JS map,
 * and analysis panel for fire break calculations.
 */
const ROAD_SPEED_OVERRIDES_STORAGE_KEY = 'firebreak.terrainMobility.roadSpeedOverrides.v1';

const App: React.FC = () => {
  const [fireBreakDistance, setFireBreakDistance] = useState<number | null>(null);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);
  // Drawn line vertices (for export/sharing) + any plan restored from the URL.
  const [lineCoords, setLineCoords] = useState<{ lat: number; lng: number }[] | null>(null);
  const [sharedPlan] = useState(() => readPlanFromUrl());
  const [vegetationAnalysis, setVegetationAnalysis] = useState<VegetationAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [selectedAircraftForPreview, setSelectedAircraftForPreview] = useState<string[]>([]);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | undefined>(undefined);
  const [initialLocationSettled, setInitialLocationSettled] = useState<boolean>(false);
  // Track whether the analysis panel is in expanded mode (affects layout).
  // Default to collapsed on mobile/tablet widths so the map keeps the majority
  // of the screen; desktop keeps the panel expanded by default.
  const [isAnalysisPanelExpanded, setIsAnalysisPanelExpanded] = useState<boolean>(
    () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  // Prefetch user location as early as possible to let the map move immediately
  // once the Map instance is ready. This avoids waiting for permission checks
  // inside the map lifecycle which can add perceived delay.
  const [prefetchedLocation, setPrefetchedLocation] = useState<{ lat: number; lng: number } | null>(null);
  
  // Selected location from the global header search control. Stored here so we can
  // pass it down to the map view which will actually pan/zoom to the point.
  const [searchLocation, setSearchLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);

  // Handler invoked by the SearchControl in the header. We store the selection in
  // state and let MapboxMapView react to it and perform the map interaction.
  const handleSearchLocationSelected = useCallback((location: { lat: number; lng: number; label: string }) => {
    setSearchLocation(location);
  }, []);

  // --- Suite account (Station Manager subscription) ------------------------
  // Signed-in session lifted from the header AccountControl. Cloud plan saves
  // are gated on the org's fireBreakEnabled entitlement; the calculator itself
  // stays fully usable anonymously.
  const [suiteSession, setSuiteSession] = useState<SuiteSession | null>(null);
  // Bumped after each save so the AccountControl's plan list refreshes.
  const [plansVersion, setPlansVersion] = useState(0);
  // Bumped to open the header sign-in panel from an anonymous gate.
  const [signInSignal, setSignInSignal] = useState(0);

  const handleSuiteSessionChange = useCallback((session: SuiteSession | null) => {
    setSuiteSession(session);
  }, []);

  // Anonymous limiting applies to every signed-out user: a single,
  // non-persisted break, with persistence (save / share link) prompting
  // StationKit sign-in. (Deployments are expected to configure
  // VITE_SUITE_AUTH_URL so a sign-in path exists.)
  const anonymousLimited = !suiteSession;
  const requestSignIn = useCallback(() => setSignInSignal(v => v + 1), []);

  // Persist the current plan (identical payload to the share link) to the
  // user's account via the saved-plans API.
  const handleSaveToCloud = useCallback(async (name: string, plan: SharedPlan) => {
    if (!suiteSession) throw new Error('Sign in to save plans');
    await createSavedPlan(suiteSession.token, { name, data: encodePlan(plan) });
    setPlansVersion(v => v + 1);
  }, [suiteSession]);

  // Restore a saved plan through the exact same hardened path a shared link
  // uses: put the encoded payload in the URL fragment and reload, so line,
  // break width and vegetation override all come back together.
  const handleLoadSavedPlan = useCallback((plan: SavedPlanApi) => {
    if (
      lineCoords && lineCoords.length >= 2 &&
      !window.confirm(`Load "${plan.name}"? This replaces the line currently on the map.`)
    ) {
      return;
    }
    window.location.hash = `plan=${plan.data}`;
    window.location.reload();
  }, [lineCoords]);

  // --- Route intelligence state ---------------------------------------------
  // Highlighted chainage range (from insight "show on map" / segment locate).
  const [highlightRange, setHighlightRange] = useState<{ startM: number; endM: number } | null>(null);
  // Elevation-profile hover position (chainage in metres) → synced map marker.
  const [hoverChainage, setHoverChainage] = useState<number | null>(null);
  // Corridor route optimizer lifecycle. The result's coords render as a dashed
  // preview on the map until the user applies or dismisses them.
  const [optimizerStatus, setOptimizerStatus] = useState<OptimizerStatus>('idle');
  const [optimizerProgress, setOptimizerProgress] = useState(0);
  const [optimizerPhase, setOptimizerPhase] = useState<string | undefined>();
  const [optimizerResult, setOptimizerResult] = useState<OptimizedRouteResult | null>(null);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [applyLineRequest, setApplyLineRequest] = useState<{ coords: { lat: number; lng: number }[]; version: number } | null>(null);
  const optimizeAbortRef = useRef<AbortController | null>(null);
  const applyVersionRef = useRef(0);
  // WP2 — streamed scan visualization: grid outlines build out, then colour
  // in as each cell is sampled, then the live Dijkstra frontier's current
  // best-guess path. Keyed by cell centre so repeated 'grid'/'cells' events
  // (one wide pass per leg, all drawing from the same shared grid) merge
  // into one set rather than re-adding duplicates.
  const [scanCells, setScanCells] = useState<{ polygon: { lat: number; lng: number }[]; costNormalized: number; costNormalizedObjective: number; revealed: boolean; revealedAt?: number }[]>([]);
  const [scanBestPath, setScanBestPath] = useState<{ lat: number; lng: number }[]>([]);
  const scanCellsMapRef = useRef(new Map<string, { polygon: { lat: number; lng: number }[]; costNormalized: number; costNormalizedObjective: number; revealed: boolean; revealedAt?: number }>());
  // Heatmap colour scale: 'objective' (fixed, absolute difficulty — heavy
  // timber always at least amber, a 45°+ slope always red, regardless of what
  // else is in the scan) or 'relative' (stretched to this scan's own min/max —
  // useful for comparing paths within one corridor). Defaults to objective per
  // field feedback that a per-scan relative scale let flat heavy-forest ground
  // read as "easy" whenever something steeper happened to sit nearby.
  const [heatmapColorMode, setHeatmapColorMode] = useState<'relative' | 'objective'>('objective');
  // WP5 auto-run: applying an optimized route replaces the drawn line, which
  // fires the same onLineChange path that triggers auto-optimize — without
  // this guard, apply -> auto-optimize -> apply would loop. Set right before
  // requesting the apply, cleared once the resulting line-change has been
  // seen (handleLineCoordsChange runs synchronously in the same tick as the
  // map's onLineChange, so this window is exactly one line-change).
  const suppressAutoOptimizeRef = useRef(false);
  const autoOptimizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chainageIndex = useMemo(
    () => (lineCoords && lineCoords.length >= 2 ? buildChainageIndex(lineCoords) : null),
    [lineCoords]
  );
  const highlightCoords = useMemo(
    () => (chainageIndex && highlightRange ? sliceByChainage(chainageIndex, highlightRange.startM, highlightRange.endM) : null),
    [chainageIndex, highlightRange]
  );
  const hoverPoint = useMemo(
    () => (chainageIndex && hoverChainage != null ? pointAtChainage(chainageIndex, hoverChainage) : null),
    [chainageIndex, hoverChainage]
  );

  const handleLocateSegment = useCallback((startM: number, endM: number) => {
    setHighlightRange(prev =>
      prev && Math.abs(prev.startM - startM) < 1 && Math.abs(prev.endM - endM) < 1 ? null : { startM, endM }
    );
  }, []);

  const handleHoverChainage = useCallback((m: number | null) => setHoverChainage(m), []);

  // Reset route-intelligence state whenever the drawn line changes (including
  // after an optimized route is applied — the preview must not linger).
  const handleLineCoordsChange = useCallback((coords: { lat: number; lng: number }[] | null) => {
    setLineCoords(coords);
    setHighlightRange(null);
    setHoverChainage(null);
    optimizeAbortRef.current?.abort();
    setOptimizerStatus('idle');
    setOptimizerResult(null);
    setOptimizerError(null);
    setOptimizerProgress(0);
    setOptimizerPhase(undefined);
    scanCellsMapRef.current.clear();
    setScanCells([]);
    setScanBestPath([]);
  }, []);

  const handleOptimize = useCallback(async () => {
    if (!lineCoords || lineCoords.length < 2) return;
    optimizeAbortRef.current?.abort();
    const controller = new AbortController();
    optimizeAbortRef.current = controller;
    setOptimizerStatus('running');
    setOptimizerProgress(0);
    setOptimizerPhase('grid');
    setOptimizerError(null);
    setOptimizerResult(null);
    scanCellsMapRef.current.clear();
    setScanCells([]);
    setScanBestPath([]);
    try {
      const result = await optimizeRoute(lineCoords, {
        signal: controller.signal,
        onProgress: (f, phase) => {
          setOptimizerProgress(f);
          if (phase) setOptimizerPhase(phase);
        },
        onScanEvent: (event) => {
          if (event.phase === 'grid' && event.data?.cells) {
            let added = false;
            for (const c of event.data.cells) {
              const key = `${c.center.lat.toFixed(6)},${c.center.lng.toFixed(6)}`;
              if (!scanCellsMapRef.current.has(key)) {
                scanCellsMapRef.current.set(key, { polygon: c.polygon, costNormalized: 0, costNormalizedObjective: 0, revealed: false });
                added = true;
              }
            }
            // Per-leg wide passes re-announce their slice of the shared grid;
            // when nothing is new, skip the state churn (it used to make the
            // rendered corridor blink at each leg boundary).
            if (added) setScanCells(Array.from(scanCellsMapRef.current.values()));
          } else if (event.phase === 'cells' && event.data?.cells) {
            for (const c of event.data.cells) {
              const key = `${c.center.lat.toFixed(6)},${c.center.lng.toFixed(6)}`;
              // Keep the FIRST reveal timestamp — later events refine a
              // cell's cost values but must not re-run its fade-in.
              const prev = scanCellsMapRef.current.get(key);
              scanCellsMapRef.current.set(key, {
                polygon: c.polygon,
                costNormalized: c.costNormalized,
                costNormalizedObjective: c.costNormalizedObjective,
                revealed: true,
                revealedAt: prev?.revealed ? prev.revealedAt : performance.now(),
              });
            }
            setScanCells(Array.from(scanCellsMapRef.current.values()));
          } else if (event.phase === 'search' && event.data?.bestPath) {
            setScanBestPath(event.data.bestPath);
          } else if (event.phase === 'done') {
            // Clear only the frontier line. The coloured scan cells stay up
            // so the final heatmap crossfades OVER them — clearing here made
            // the whole corridor vanish for the ~1s until the result
            // rendered (field-reported). A delayed effect below clears them
            // once the heatmap's fade-in has finished.
            setScanBestPath([]);
          }
        },
      });
      if (controller.signal.aborted) return;
      if (!result) {
        setOptimizerStatus('error');
        setOptimizerError('This line could not be optimized (too short or sampling failed).');
        return;
      }
      setOptimizerResult(result);
      setOptimizerStatus('done');
    } catch (error) {
      if (controller.signal.aborted) return;
      logger.error('Route optimization failed', error);
      setOptimizerStatus('error');
      setOptimizerError(error instanceof Error ? error.message : 'Route optimization failed');
    }
  }, [lineCoords]);

  const handleApplyOptimized = useCallback(() => {
    if (!optimizerResult) return;
    suppressAutoOptimizeRef.current = true;
    applyVersionRef.current += 1;
    setApplyLineRequest({ coords: optimizerResult.coords, version: applyVersionRef.current });
    // The map will emit onLineChange for the new geometry, which resets the
    // optimizer state (handleLineCoordsChange) and re-runs all analyses.
  }, [optimizerResult]);

  // Once the final heatmap has faded in (900 ms) over the still-rendered
  // scan cells, retire the scan layer quietly — the two show identical
  // colours by then, so this swap is invisible. Clearing at the moment of
  // completion instead made the whole corridor vanish and fade back.
  useEffect(() => {
    if (optimizerStatus !== 'done') return;
    const timer = window.setTimeout(() => {
      scanCellsMapRef.current.clear();
      setScanCells([]);
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [optimizerStatus]);

  const handleDismissOptimized = useCallback(() => {
    optimizeAbortRef.current?.abort();
    setOptimizerStatus('idle');
    setOptimizerResult(null);
    setOptimizerError(null);
    setOptimizerProgress(0);
    setOptimizerPhase(undefined);
    scanCellsMapRef.current.clear();
    setScanCells([]);
    setScanBestPath([]);
  }, []);

  // WP5 — auto-run: once the drawn line is long enough to be worth a hex
  // search, start one automatically a beat after the user stops drawing,
  // rather than waiting for a manual tap. Skipped right after an apply (the
  // suppress guard above) so applying a result can't re-trigger itself.
  useEffect(() => {
    if (autoOptimizeTimerRef.current) {
      clearTimeout(autoOptimizeTimerRef.current);
      autoOptimizeTimerRef.current = null;
    }
    if (suppressAutoOptimizeRef.current) {
      suppressAutoOptimizeRef.current = false;
      return;
    }
    if (!lineCoords || lineCoords.length < 2) return;
    const length = buildChainageIndex(lineCoords).total;
    if (length < 120) return;
    autoOptimizeTimerRef.current = setTimeout(() => {
      handleOptimize();
    }, 800);
    return () => {
      if (autoOptimizeTimerRef.current) {
        clearTimeout(autoOptimizeTimerRef.current);
        autoOptimizeTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineCoords]);

  // --- WP6: area recon — draw a box, get the terrain+vegetation heatmap ------
  const [areaReconActive, setAreaReconActive] = useState(false);
  const [areaReconStatus, setAreaReconStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [areaReconHeatmap, setAreaReconHeatmap] = useState<HexHeatmapCell[] | null>(null);
  const [areaReconEstimated, setAreaReconEstimated] = useState(false);
  const areaReconAbortRef = useRef<AbortController | null>(null);

  const handleAreaReconBoxDrawn = useCallback(async (sw: { lat: number; lng: number }, ne: { lat: number; lng: number }) => {
    areaReconAbortRef.current?.abort();
    const controller = new AbortController();
    areaReconAbortRef.current = controller;
    setAreaReconStatus('running');
    setAreaReconHeatmap(null);
    try {
      const result = await scanArea(sw, ne, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!result) {
        setAreaReconStatus('error');
        return;
      }
      setAreaReconHeatmap(result.heatmap);
      setAreaReconEstimated(result.usedEstimatedData);
      setAreaReconStatus('done');
    } catch (error) {
      if (controller.signal.aborted) return;
      logger.error('Area recon scan failed', error);
      setAreaReconStatus('error');
    }
  }, []);

  const handleClearAreaRecon = useCallback(() => {
    areaReconAbortRef.current?.abort();
    setAreaReconStatus('idle');
    setAreaReconHeatmap(null);
  }, []);

  // --- Terrain Mobility mode (Pass 1, POC) -----------------------------------
  // Owner decision 2026-07-26: gated by a URL query param for the demo (a
  // subtle toggle on current infrastructure, open data only — NOT a real
  // entitlement; see docs/ROUTE_INTELLIGENCE.md §14 for the residual-risk
  // note and the requirement to convert to a real gate before any release
  // beyond demo use). Computed once — this is a load-time decision, not a
  // live runtime toggle, matching how the mode's basemap style is chosen.
  const mobilityModeAvailable = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ops') === '1',
    []
  );
  // Owner, 2026-07-26: "?ops=1 should default to the new mode" — start
  // directly in Terrain mode when the URL flag is present, fire-break mode
  // otherwise (absent, or set to anything other than "1"). The toggle
  // button still works normally after that initial choice — this only
  // changes which mode the app lands in on load.
  const [mobilityModeActive, setMobilityModeActive] = useState(() => mobilityModeAvailable);

  // Full identity swap (owner, 2026-07-26): the app must not read as "Fire
  // Break Calculator" anywhere while Terrain mode is active — browser tab
  // title and favicon included, not just in-page chrome.
  useEffect(() => {
    const originalTitle = document.title;
    const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const originalIconHref = iconLink?.href;
    if (mobilityModeActive) {
      document.title = 'Terrain Mobility — POC';
      if (iconLink) {
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>
          <rect width='32' height='32' rx='6' fill='#05070a'/>
          <circle cx='16' cy='16' r='10' fill='none' stroke='#38bdf8' stroke-width='2'/>
          <circle cx='16' cy='16' r='3' fill='#38bdf8'/>
          <line x1='16' y1='2' x2='16' y2='7' stroke='#38bdf8' stroke-width='2'/>
          <line x1='16' y1='25' x2='16' y2='30' stroke='#38bdf8' stroke-width='2'/>
          <line x1='2' y1='16' x2='7' y2='16' stroke='#38bdf8' stroke-width='2'/>
          <line x1='25' y1='16' x2='30' y2='16' stroke='#38bdf8' stroke-width='2'/>
        </svg>`;
        iconLink.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      }
    }
    return () => {
      document.title = originalTitle;
      if (iconLink && originalIconHref) iconLink.href = originalIconHref;
    };
  }, [mobilityModeActive]);
  const [mobilityProfileId, setMobilityProfileId] = useState(DEFAULT_MOVER_PROFILE_ID);
  const [mobilityNightMode, setMobilityNightMode] = useState(false);
  // Docs §35 — analysis depth (owner: "let the user select a scale of
  // something like 'quick' to 'fine' for analysis depth"). Not persisted —
  // matches the other per-run toggles in this mode (nightMode, movementView)
  // rather than the road-speed overrides' brigade-calibrate-once case.
  const [mobilityFidelity, setMobilityFidelity] = useState<MobilityFidelity>(DEFAULT_MOBILITY_FIDELITY);
  // Docs §35 Slice A config UI — user-edited road-class speeds, persisted so
  // a brigade/unit calibrates once (owner requirement: "configurable... for
  // fine grained adjustments"). Loaded lazily (useState initializer) rather
  // than in an effect, so the very first run after a reload already sees any
  // saved overrides instead of one run at the sourced defaults.
  const [roadSpeedOverrides, setRoadSpeedOverridesState] = useState<RoadSpeedOverrides>(() => {
    try {
      const raw = localStorage.getItem(ROAD_SPEED_OVERRIDES_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as RoadSpeedOverrides) : {};
    } catch {
      return {}; // corrupt/unavailable storage — fall back to sourced defaults, not a crash
    }
  });
  const setRoadSpeedOverrides = useCallback((next: RoadSpeedOverrides) => {
    setRoadSpeedOverridesState(next);
    try {
      localStorage.setItem(ROAD_SPEED_OVERRIDES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage full/unavailable — the override still applies for this
      // session via state, it just won't survive a reload.
    }
  }, []);
  const [mobilityBoxRole, setMobilityBoxRole] = useState<'origin' | 'objective' | null>(null);
  // Cross-mode cleanup (2026-07-26 UI review: "ensure everything switches...
  // and back again"). Hiding a mode's controls isn't enough on its own — an
  // "armed" tool's state can outlive the switch and keep intercepting clicks
  // meant for the OTHER mode's tool, since the click handlers for both tools
  // are registered unconditionally and only check their own armed-state ref,
  // not which mode is active. Disarm the other mode's tool on every switch,
  // in both directions.
  useEffect(() => {
    if (mobilityModeActive) {
      setAreaReconActive(false); // fire-break's own box-scan tool
    } else {
      setMobilityBoxRole(null); // Terrain mode's paint/erase tool
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobilityModeActive]);
  // Painted areas (owner feedback 2026-07-26): a union of real hex-cell dabs
  // laid down by dragging over the map, not a drawn rectangle — see
  // terrain/paintedArea.ts. Brush size (docs §35) is a FIXED ground hex
  // count (100m-circumradius hexes; small/medium/large/xl = 1/10/100/1000),
  // not a screen-relative pixel radius.
  const [mobilityOriginPaint, setMobilityOriginPaint] = useState<PaintedArea>([]);
  const [mobilityObjectivePaint, setMobilityObjectivePaint] = useState<PaintedArea>([]);
  const [mobilityBrushSize, setMobilityBrushSize] = useState<BrushSize>('medium');
  // Paint vs erase (owner feedback 2026-07-26: "add an erase function") —
  // which kind of stroke the next dab lays down, tagged onto the stroke
  // itself so resolvePaintedAreaGeometry can replay paint/erase in the
  // order they actually happened (see terrain/paintedArea.ts).
  const [mobilityPaintMode, setMobilityPaintMode] = useState<PaintStrokeMode>('paint');
  const [mobilityRunning, setMobilityRunning] = useState(false);
  const [mobilityLogLines, setMobilityLogLines] = useState<string[]>([]);
  const [mobilityResult, setMobilityResult] = useState<MobilityAppreciationResult | null>(null);
  const [mobilityDisplayMode, setMobilityDisplayMode] = useState<'trafficability' | 'isochrone'>('trafficability');
  const [mobilityCursor, setMobilityCursor] = useState<{ lat: number; lng: number } | null>(null);
  const mobilityAbortRef = useRef<AbortController | null>(null);
  // Run progress + phase, so the map can show that something is happening
  // during a run that takes tens of seconds (owner, 2026-07-27).
  const [mobilityProgress, setMobilityProgress] = useState(0);
  const [mobilityStage, setMobilityStage] = useState<MobilityStage | null>(null);
  /** Terrain-only classified cells, painted as soon as sampling finishes and
   *  replaced by the full result — so the map fills in mid-run instead of
   *  staying blank until everything is done. */
  const [mobilityPreviewCells, setMobilityPreviewCells] = useState<
    { polygon: { lat: number; lng: number }[]; trafficability: MobilityClass; timeSeconds: number; bandIndex: number }[] | null
  >(null);
  /** The box-free vehicle road route, painted the moment it resolves — well
   *  before the full grid/search pipeline settles (docs §38's stated
   *  remainder, closed via `onRoadRoute`). Superseded by `mobilityResult`'s
   *  own authoritative `roadRoute` the instant that lands; see the map
   *  `roadRoute` prop below for the precedence. */
  const [mobilityEarlyRoadRoute, setMobilityEarlyRoadRoute] = useState<{ lat: number; lng: number }[] | null>(null);
  /** One master opacity for the analysis overlays (owner, 2026-07-27). */
  const [mobilityOverlayOpacity, setMobilityOverlayOpacity] = useState(1);
  /** Corridor picked out in the panel or on the map — dims the others. */
  const [highlightedCorridorId, setHighlightedCorridorId] = useState<string | null>(null);
  /** Which behaviour population the movement ensemble draws movers from. */
  const [behaviourSpreadId, setBehaviourSpreadId] = useState<string>(DEFAULT_BEHAVIOUR_SPREAD_ID);
  /** Which movement picture the map draws: unrestricted, or with the
   *  recommended restrictions emplaced. */
  const [movementView, setMovementView] = useState<'unrestricted' | 'restricted'>('unrestricted');
  /** Show the simulated transit-frequency field over the cells. */
  const [showTransitField, setShowTransitField] = useState(true);

  // Counter-mobility planner — Pass 4 (docs/ROUTE_INTELLIGENCE.md §5, §15.4).
  // Shares the appreciation run's own sampled grid/min-cut segments rather
  // than resampling — see mobilityAppreciation.ts's `cells`/`originKeys`/
  // `objectiveKeys` note.
  const [mobilityActiveTab, setMobilityActiveTab] = useState<'appreciation' | 'counterMobility' | 'oakoc'>('appreciation');
  const [cmPendingSegmentIndex, setCmPendingSegmentIndex] = useState<number | null>(null);
  const [cmPlacements, setCmPlacements] = useState<CounterMeasurePlacement[]>([]);
  const [cmLedger, setCmLedger] = useState<DelayLedgerEntry[] | null>(null);
  const [cmRunning, setCmRunning] = useState(false);
  const [cmAddedMeasureIds, setCmAddedMeasureIds] = useState<string[]>([]);
  // The iterative scenario: corridors re-derived with every emplaced measure
  // applied together, and the diff against the baseline picture.
  const [cmCorridorComparison, setCmCorridorComparison] = useState<CorridorComparison | null>(null);
  const [cmAfterField, setCmAfterField] = useState<CorridorField | null>(null);
  /** Which corridor picture the map draws: the baseline appreciation, or the
   *  scenario with counter-measures emplaced. */
  const [corridorView, setCorridorView] = useState<'baseline' | 'scenario'>('baseline');

  // MapboxMapView reports only the raw click/drag point; the actual hex dab
  // is built HERE (docs §35) because it needs the role's EXISTING strokes —
  // specifically its first dab's anchor (paintedArea.ts's module header) —
  // which live in this component's state, not the map view's.
  const handleMobilityPaintDab = useCallback((role: 'origin' | 'objective', point: { lat: number; lng: number }) => {
    const setter = role === 'origin' ? setMobilityOriginPaint : setMobilityObjectivePaint;
    setter(prev => [...prev, { mode: mobilityPaintMode, dab: createHexDab(prev, point, mobilityBrushSize) }]);
    setMobilityResult(null); // a stale result over a changed AOI would mislead
  }, [mobilityPaintMode, mobilityBrushSize]);

  const handleClearMobilityPaint = useCallback((role?: 'origin' | 'objective') => {
    mobilityAbortRef.current?.abort();
    if (!role || role === 'origin') setMobilityOriginPaint([]);
    if (!role || role === 'objective') setMobilityObjectivePaint([]);
    setMobilityResult(null);
    setMobilityLogLines([]);
    setMobilityRunning(false);
  }, []);

  const handleRunMobilityAppreciation = useCallback(async () => {
    if (mobilityOriginPaint.length === 0 || mobilityObjectivePaint.length === 0) return;
    mobilityAbortRef.current?.abort();
    const controller = new AbortController();
    mobilityAbortRef.current = controller;
    setMobilityRunning(true);
    setMobilityLogLines([]);
    setMobilityResult(null);
    setMobilityProgress(0);
    setMobilityStage(null);
    setMobilityPreviewCells(null);
    setMobilityEarlyRoadRoute(null);
    setHighlightedCorridorId(null);
    setMovementView('unrestricted');
    // A fresh run resamples the grid, so any prior min-cut segment indices/
    // placements/ledger no longer refer to real cells — clear rather than
    // let them silently go stale.
    setCmPendingSegmentIndex(null);
    setCmPlacements([]);
    setCmLedger(null);
    setCmAddedMeasureIds([]);
    setCmCorridorComparison(null);
    setCmAfterField(null);
    setCorridorView('baseline');
    // Scale/performance telemetry (docs/ROUTE_INTELLIGENCE.md §38) — timed
    // around the whole run, with a timestamp per stage transition, so a
    // completed run can report which phase actually dominated on this
    // device. Never affects the run itself: recorded fire-and-forget after
    // the result is already in hand, and the recorder swallows every failure.
    const runStartMs = performance.now();
    const stageTimestamps: MobilityStageTimestamp[] = [];
    try {
      const result = await runMobilityAppreciation(mobilityOriginPaint, mobilityObjectivePaint, {
        profileId: mobilityProfileId,
        nightMode: mobilityNightMode,
        signal: controller.signal,
        behaviourSpreadId,
        roadSpeedOverrides,
        fidelity: mobilityFidelity,
        onLog: line => setMobilityLogLines(prev => [...prev, line]),
        onProgress: f => { if (!controller.signal.aborted) setMobilityProgress(f); },
        onStage: stage => {
          if (controller.signal.aborted) return;
          setMobilityStage(stage);
          stageTimestamps.push({ key: stage.key, atMs: performance.now() - runStartMs });
        },
        onPreviewCells: cells => {
          if (controller.signal.aborted) return;
          // Terrain classification only — no arrival times exist yet, so
          // bandIndex is -1 for every cell and the isochrone colouring
          // correctly shows them all as "not reached".
          setMobilityPreviewCells(cells.map(c => ({
            polygon: c.polygon,
            trafficability: c.trafficability,
            timeSeconds: c.timeSeconds,
            bandIndex: -1,
          })));
        },
        // Real reachability field + cheapest route, surfaced as soon as the
        // search settles — well before the ensemble/corridors/chokepoints/
        // min-cut that follow (owner: "the map [should start] getting visual
        // results being loaded as it happens... pathways snaking across the
        // landscape from the get go rather than waiting for the end").
        // Every consumer of `mobilityResult` already treats corridorField/
        // ensemble/chokepoints/barrier as nullable (the "no route found"
        // case has always produced exactly this shape), so setting it early
        // here needs no new rendering path.
        onPartialResult: partial => {
          if (controller.signal.aborted) return;
          setMobilityResult(partial);
          setMobilityPreviewCells(null);
        },
        // Fires seconds in, well before onPartialResult — see that option's
        // own doc comment in mobilityAppreciation.ts for why this never
        // depended on the grid/search pipeline in the first place.
        onRoadRoute: route => {
          if (controller.signal.aborted) return;
          setMobilityEarlyRoadRoute(route.waypoints);
        },
      });
      if (controller.signal.aborted) return;
      if (!result) {
        setMobilityLogLines(prev => [...prev, 'RUN FAILED — SEE ABOVE']);
        return;
      }
      setMobilityResult(result);
      setMobilityPreviewCells(null); // the real result supersedes the preview
      recordMobilityRunTelemetry(
        result,
        performance.now() - runStartMs,
        stageTimestamps,
        originObjectiveDistanceM(mobilityOriginPaint, mobilityObjectivePaint)
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      logger.error('Terrain mobility appreciation failed', error);
      setMobilityLogLines(prev => [...prev, `ERROR — ${error instanceof Error ? error.message : 'unknown failure'}`]);
    } finally {
      if (!controller.signal.aborted) setMobilityRunning(false);
    }
  }, [mobilityOriginPaint, mobilityObjectivePaint, mobilityProfileId, mobilityNightMode, behaviourSpreadId, roadSpeedOverrides, mobilityFidelity]);

  const handleCancelMobilityAppreciation = useCallback(() => {
    mobilityAbortRef.current?.abort();
    setMobilityRunning(false);
  }, []);

  const handleRunCounterMobilityLedger = useCallback(() => {
    if (!mobilityResult || cmPlacements.length === 0) return;
    setCmRunning(true);
    try {
      const entries = computeDelayLedger(
        mobilityResult.cells,
        mobilityResult.originKeys,
        mobilityResult.objectiveKeys,
        mobilityResult.profile,
        mobilityNightMode,
        COUNTER_MEASURES,
        cmPlacements
      );
      setCmLedger(entries);

      // Iterative scenario view (owner 2026-07-26: "once countermeasures are
      // in place, show how that affects the corridor and the relative
      // difficulty it adds at those points... this analysis may need to be
      // iterative"). Re-derives the WHOLE corridor picture with every
      // emplaced measure applied together — not the sum of the per-measure
      // ledger rows above, because blocking two of three corridors pushes
      // everything onto the third, which only a combined re-run shows.
      // Compared against the OPTIMISER field, not the (now simulated) headline
      // one: `afterField` below is built from k penalised optimal routes, so
      // diffing it against a simulated-mover baseline would compare two
      // different kinds of evidence and attribute the difference between them
      // to the counter-measures. Like-for-like or not at all.
      if (mobilityResult.optimiserCorridorField) {
        const scenarioPenalties = buildScenarioEdgePenalties(COUNTER_MEASURES, cmPlacements);
        const afterField = buildCorridorField(
          mobilityResult.cells,
          mobilityResult.originKeys,
          mobilityResult.objectiveKeys,
          mobilityResult.profile,
          mobilityNightMode,
          mobilityResult.hexSize,
          mobilityResult.proj,
          { edgePenalties: scenarioPenalties }
        );
        setCmCorridorComparison(compareCorridorFields(mobilityResult.optimiserCorridorField, afterField));
        setCmAfterField(afterField);
      }
    } catch (error) {
      logger.error('Delay ledger computation failed', error);
    } finally {
      setCmRunning(false);
    }
  }, [mobilityResult, mobilityNightMode, cmPlacements]);

  const handleAddCounterMeasureToPlan = useCallback((measureId: string) => {
    setCmAddedMeasureIds(prev => (prev.includes(measureId) ? prev : [...prev, measureId]));
  }, []);

  /** The movement picture currently on the map: unrestricted, or with the
   *  recommended restrictions emplaced. Falls back to unrestricted whenever no
   *  restricted run exists, so the toggle can never blank the map. */
  const displayedEnsemble = useMemo(() => {
    if (movementView === 'restricted' && mobilityResult?.restrictionPlan?.scenario) {
      return mobilityResult.restrictionPlan.scenario;
    }
    return mobilityResult?.ensemble ?? null;
  }, [movementView, mobilityResult]);

  /** Corridors matching whichever movement picture is displayed. Counter-
   *  mobility's own baseline/scenario toggle still wins when it has produced a
   *  field, since that is a more specific user action. */
  const displayedMovementCorridorField = useMemo(() => {
    if (corridorView === 'scenario' && cmAfterField) return cmAfterField;
    if (movementView === 'restricted' && mobilityResult?.restrictedCorridorField) {
      return mobilityResult.restrictedCorridorField;
    }
    return mobilityResult?.corridorField ?? null;
  }, [corridorView, cmAfterField, movementView, mobilityResult]);

  const transitCellsForMap = useMemo(() => {
    if (!showTransitField || !displayedEnsemble) return null;
    return displayedEnsemble.cells.map(c => ({ polygon: c.polygon, transitFraction: c.transitFraction }));
  }, [showTransitField, displayedEnsemble]);

  /**
   * ONE representative route per corridor, road-snapped and corner-smoothed
   * — not a wash of every analysed route (owner, 2026-07-28: "the
   * individual white lines of the considered paths don't work as a
   * visualisation. Because of the hex grid they end up being 'triangles'
   * between the grid centres and they don't follow the road geometry...
   * they need to be consolidated to show substantive differences in the
   * pathways / corridors, not show that every piece of ground has been
   * considered"). Previously drew up to 24 raw, un-refined route polylines
   * stepping hex-centre to hex-centre regardless of what any of them meant
   * for presentation; now draws at most one per corridor (so "2-5 clear
   * corridors" is also "2-5 lines", never more), each the corridor's own
   * FASTEST analysed route (`representativeRoute`, `corridorField.ts`),
   * refined the SAME way the fire-break optimizer's own routes already are
   * (`pathRefinement.ts`): densified, snapped onto a nearby mapped road
   * where the route actually runs alongside one, and corner-smoothed
   * everywhere else — "some corridors may be overland" (owner), so a
   * missing nearby road must not stop the line from smoothing, and a route
   * that genuinely traces a road must not be blurred off it.
   */
  const corridorRoutesForMap = useMemo(() => {
    const corridors = displayedMovementCorridorField?.corridors ?? [];
    const roadWays = mobilityResult?.roadWays ?? [];
    // Carries `rank`/`id` alongside the refined path (2026-07-28, corridor
    // legibility pass) so the map can colour each route line to match its
    // OWN corridor's rank colour rather than a flat, uncorrelated grey —
    // a corridor with no representativeRoute is filtered out first, so a
    // naive index-into-`corridors` alignment would silently desync as soon
    // as any corridor lacked one; carrying the id/rank through avoids that.
    return corridors
      .filter((c): c is typeof c & { representativeRoute: NonNullable<typeof c.representativeRoute> } => c.representativeRoute !== null)
      .map(c => ({
        id: c.id,
        rank: c.rank,
        path: refinePath(c.representativeRoute.path, roadWays, { snapToTrails: true, cornerSmoothingIterations: 2 })
          .map(p => ({ lat: p.lat, lng: p.lng })),
      }));
  }, [displayedMovementCorridorField, mobilityResult]);

  const restrictionsForMap = useMemo(() => {
    if (!mobilityResult?.restrictionPlan) return null;
    return mobilityResult.restrictionPlan.restrictions.map(r => ({
      id: r.id, rank: r.rank, kind: r.kind, from: r.from, to: r.to,
    }));
  }, [mobilityResult]);

  /** The real mapped watercourse/water-body geometry (docs §34), for the
   *  map's own reference layer — separate from any gated cell, so the user
   *  can see the actual river/lake shape the analysis is reacting to. */
  const waterFeaturesForMap = useMemo(() => {
    if (!mobilityResult || mobilityResult.waterFeatures.length === 0) return null;
    return mobilityResult.waterFeatures.map(f => ({ kind: f.kind, coords: f.coords }));
  }, [mobilityResult]);

  const mobilityHeatmapForMap = useMemo(() => {
    if (!mobilityResult) return mobilityPreviewCells;
    return mobilityResult.results.map(r => {
      let bandIndex = -1;
      if (isFinite(r.timeSeconds)) {
        const minutes = r.timeSeconds / 60;
        bandIndex = DEFAULT_ISOCHRONE_MINUTES.findIndex(t => minutes <= t);
        if (bandIndex === -1) bandIndex = DEFAULT_ISOCHRONE_MINUTES.length - 1;
      }
      return { polygon: r.polygon, trafficability: r.trafficability, timeSeconds: r.timeSeconds, bandIndex };
    });
  }, [mobilityResult]);

  // --- Unit movement simulation (owner "bonus feature", 2026-07-26) ----------
  // An RTS-style animated unit following the real computed path, with a real
  // mid-course replan (not simulated) once it's covered half the estimated
  // travel time — see terrain/unitSimulation.ts.
  const [unitSimPosition, setUnitSimPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [unitSimPath, setUnitSimPath] = useState<{ lat: number; lng: number }[] | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simSpeedMultiplier, setSimSpeedMultiplier] = useState(20);
  const [simElapsedSeconds, setSimElapsedSeconds] = useState<number | null>(null);
  const unitSimControllerRef = useRef<UnitSimulationController | null>(null);

  const stopUnitSimulation = useCallback(() => {
    unitSimControllerRef.current?.stop();
    unitSimControllerRef.current = null;
    setSimRunning(false);
  }, []);

  const handleStartSimulation = useCallback(() => {
    if (!mobilityResult?.path || mobilityObjectivePaint.length === 0) return;
    unitSimControllerRef.current?.stop();
    setSimElapsedSeconds(0);
    const controller = new UnitSimulationController(
      mobilityResult.path,
      mobilityObjectivePaint,
      mobilityProfileId,
      mobilityNightMode,
      {
        onPosition: (pos, elapsed) => { setUnitSimPosition(pos); setSimElapsedSeconds(elapsed); },
        onPathChange: path => setUnitSimPath(path.map(p => ({ lat: p.lat, lng: p.lng }))),
        onLog: line => setMobilityLogLines(prev => [...prev, line]),
        onArrived: () => setSimRunning(false),
      }
    );
    controller.setSpeedMultiplier(simSpeedMultiplier);
    unitSimControllerRef.current = controller;
    controller.start();
    setSimRunning(true);
  }, [mobilityResult, mobilityObjectivePaint, mobilityProfileId, mobilityNightMode, simSpeedMultiplier]);

  const handleSpeedMultiplierChange = useCallback((x: number) => {
    setSimSpeedMultiplier(x);
    unitSimControllerRef.current?.setSpeedMultiplier(x);
  }, []);

  // --- Ensemble playback (docs §32) ------------------------------------------
  // The default "simulate movement" action is now the whole ensemble moving at
  // once, not one unit on the optimal line: watching a dozen movers set off
  // together, spread, and re-converge on the same ground is the point the
  // single line could never make. The single-unit replanning simulation is
  // kept as an explicit alternative — it demonstrates something different
  // (a real mid-course re-search) and still works.
  const [simMode, setSimMode] = useState<'ensemble' | 'single'>('ensemble');
  const [ensembleMovers, setEnsembleMovers] = useState<EnsembleMoverState[] | null>(null);
  const ensembleControllerRef = useRef<EnsembleAnimationController | null>(null);

  const stopEnsembleAnimation = useCallback(() => {
    ensembleControllerRef.current?.stop();
    ensembleControllerRef.current = null;
  }, []);

  const handleStartEnsembleAnimation = useCallback(() => {
    const trajectories = displayedEnsemble?.sampleTrajectories ?? [];
    if (trajectories.length === 0) return;
    ensembleControllerRef.current?.stop();
    setSimElapsedSeconds(0);
    const controller = new EnsembleAnimationController(trajectories, {
      onFrame: (movers, elapsed) => { setEnsembleMovers(movers); setSimElapsedSeconds(elapsed); },
      onComplete: () => setSimRunning(false),
      onLog: line => setMobilityLogLines(prev => [...prev, line]),
    });
    controller.setSpeedMultiplier(simSpeedMultiplier);
    ensembleControllerRef.current = controller;
    controller.start();
    setSimRunning(true);
  }, [displayedEnsemble, simSpeedMultiplier]);

  const handleStartAnySimulation = useCallback(() => {
    if (simMode === 'ensemble') handleStartEnsembleAnimation();
    else handleStartSimulation();
  }, [simMode, handleStartEnsembleAnimation, handleStartSimulation]);

  const handleStopAnySimulation = useCallback(() => {
    stopUnitSimulation();
    stopEnsembleAnimation();
    setSimRunning(false);
  }, [stopUnitSimulation, stopEnsembleAnimation]);

  const handleSpeedMultiplierChangeAll = useCallback((x: number) => {
    setSimSpeedMultiplier(x);
    unitSimControllerRef.current?.setSpeedMultiplier(x);
    ensembleControllerRef.current?.setSpeedMultiplier(x);
  }, []);

  // A stale simulation over a changed AOI/result would mislead — clear it
  // whenever the boxes are cleared or a fresh run starts.
  useEffect(() => {
    stopUnitSimulation();
    stopEnsembleAnimation();
    setUnitSimPosition(null);
    setUnitSimPath(null);
    setEnsembleMovers(null);
    setSimElapsedSeconds(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobilityOriginPaint, mobilityObjectivePaint, mobilityRunning, movementView]);

  useEffect(() => () => {
    unitSimControllerRef.current?.stop();
    ensembleControllerRef.current?.stop();
  }, []);

  // --- GIS import: overlays + import-as-plan ---------------------------------
  const [contextOverlays, setContextOverlays] = useState<{ id: string; name: string; geojson: any }[]>([]);
  const overlayIdRef = useRef(0);

  // --- Live feeds: hotspots, fire boundaries, incidents -----------------------
  const [liveFeedData, setLiveFeedData] = useState<LiveFeedMapData>({ hotspots: null, boundaries: null, incidents: null });
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);

  const handleAddOverlay = useCallback((features: ImportedFeatures) => {
    overlayIdRef.current += 1;
    setContextOverlays(prev => [
      ...prev,
      { id: String(overlayIdRef.current), name: features.sourceName, geojson: importedToGeoJSON(features) },
    ]);
  }, []);

  const handleClearOverlays = useCallback(() => setContextOverlays([]), []);

  // An imported line becomes the plan via the same replace-line pipeline the
  // optimizer uses, so the full analysis re-runs on the imported geometry.
  const handleImportAsPlan = useCallback((coords: { lat: number; lng: number }[]) => {
    if (!coords || coords.length < 2) return;
    applyVersionRef.current += 1;
    setApplyLineRequest({ coords, version: applyVersionRef.current });
  }, []);
  
  // Raw remote equipment (backend canonical) + loading state
  const [equipment, setEquipment] = useState<EquipmentApi[]>([]);
  const [loadingEquip, setLoadingEquip] = useState(false);
  const [equipError, setEquipError] = useState<string | null>(null);
  
  // Vegetation formation mappings + loading state
  const [vegetationMappings, setVegetationMappings] = useState<VegetationFormationMappingApi[]>([]);
  const [loadingVegetationMappings, setLoadingVegetationMappings] = useState(false);
  const [vegetationMappingError, setVegetationMappingError] = useState<string | null>(null);

  // Helper function to safely parse terrain/vegetation arrays from API data
  const safeParseAllowedValues = <T extends string>(
    value: any, 
    validValues: T[], 
    fieldName: string, 
    machineName: string
  ): T[] => {
    // Handle string case (CSV parsing failure in API)
    if (typeof value === 'string') {
      logger.warn(`API returned CSV string for ${fieldName} on ${machineName}, parsing locally:`, value);
      const parsed = value.split(',').map(v => v.trim()).filter(Boolean) as T[];
      return parsed.filter(v => validValues.includes(v));
    }
    
    // Handle array case (normal)
    if (Array.isArray(value)) {
      const validated = value.filter(v => validValues.includes(v as T));
      if (validated.length === 0) {
        logger.warn(`${machineName} has empty/invalid ${fieldName} array, using fallback values`);
        // Provide sensible fallbacks for machines with no valid values
        if (fieldName === 'allowedTerrain') {
          return ['flat', 'medium'] as T[];
        } else if (fieldName === 'allowedVegetation') {
          return ['grassland'] as T[];
        }
      }
      return validated;
    }
    
    // Handle null/undefined/other (fallback)
    logger.warn(`${machineName} has invalid ${fieldName} format:`, typeof value, value);
    if (fieldName === 'allowedTerrain') {
      return ['flat', 'medium'] as T[];
    } else if (fieldName === 'allowedVegetation') {
      return ['grassland'] as T[];
    }
    return [] as T[];
  };

  // Derived domain-specific structures consumed by analysis (fallback to defaults until remote loads)
  const machinery: MachinerySpec[] = useMemo(() => {
    if (initialLocationSettled) {
      logger.debug('🔧 Processing machinery from equipment data:', {
        totalEquipment: equipment.length,
        machineryItems: equipment.filter((e): e is MachineryApi => e.type === 'Machinery').length
      });
    }

    const items = equipment.filter((e): e is MachineryApi => e.type === 'Machinery');
    if (!items.length) {
      if (initialLocationSettled || equipment.length > 0) logger.debug('⚠️ No machinery items found, using default config');
      return defaultConfig.machinery;
    }
    
    return items.map(m => {
      logger.debug(`🚜 Processing machinery: ${m.name}`, {
        id: m.id,
        rawAllowedTerrain: m.allowedTerrain,
        rawAllowedVegetation: m.allowedVegetation,
        clearingRate: m.clearingRate
      });

      const allowedTerrain = safeParseAllowedValues(
        m.allowedTerrain, 
        ['flat', 'medium', 'steep', 'very_steep'],
        'allowedTerrain',
        m.name
      );
      
      const allowedVegetation = safeParseAllowedValues(
        m.allowedVegetation,
        ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
        'allowedVegetation', 
        m.name
      );
      
      // If the equipment record doesn't include a numeric maxSlope, derive one
      // from the allowedTerrain tags so analysis keeps working without CSV.
      const deriveMaxSlopeFromTerrain = (terrain: string[] | undefined): number | undefined => {
        if (!terrain || !terrain.length) return undefined;
        // Map terrain levels to representative max slope values
        // flat -> 9, medium -> 24, steep -> 44, very_steep -> 60
        if (terrain.includes('very_steep')) return 60;
        if (terrain.includes('steep')) return 44;
        if (terrain.includes('medium')) return 24;
        if (terrain.includes('flat')) return 9;
        return undefined;
      };

      const processed = {
        id: m.id,
        name: m.name,
        type: 'other' as const,
        clearingRate: m.clearingRate || 0,
        costPerHour: m.costPerHour || 0,
        description: m.description || '',
        allowedTerrain,
        allowedVegetation,
        maxSlope: m.maxSlope ?? deriveMaxSlopeFromTerrain(allowedTerrain)
      };

      return processed;
    });
  }, [equipment, initialLocationSettled]);

  const aircraft: AircraftSpec[] = useMemo(() => {
    if (initialLocationSettled) {
      logger.debug('✈️ Processing aircraft from equipment data:', {
        totalEquipment: equipment.length,
        aircraftItems: equipment.filter((e): e is AircraftApi => e.type === 'Aircraft').length
      });
    }

    const items = equipment.filter((e): e is AircraftApi => e.type === 'Aircraft');
    if (!items.length) {
      if (initialLocationSettled || equipment.length > 0) logger.debug('⚠️ No aircraft items found, using default config');
      return defaultConfig.aircraft;
    }
    
    return items.map(a => {
      logger.debug(`✈️ Processing aircraft: ${a.name}`, {
        id: a.id,
        rawAllowedTerrain: a.allowedTerrain,
        rawAllowedVegetation: a.allowedVegetation,
        dropLength: a.dropLength,
        turnaroundMinutes: a.turnaroundMinutes
      });

      const allowedTerrain = safeParseAllowedValues(
        a.allowedTerrain, 
        ['flat', 'medium', 'steep', 'very_steep'],
        'allowedTerrain',
        a.name
      );
      
      const allowedVegetation = safeParseAllowedValues(
        a.allowedVegetation,
        ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
        'allowedVegetation', 
        a.name
      );
      
      const processed = {
        id: a.id,
        name: a.name,
        type: 'other' as const,
        dropLength: a.dropLength || 0,
        speed: a.speed || 0,
        turnaroundMinutes: a.turnaroundMinutes || 0,
        costPerHour: a.costPerHour || 0,
        description: a.description || '',
        allowedTerrain,
        allowedVegetation
      };

      return processed;
    });
  }, [equipment, initialLocationSettled]);

  const handCrews: HandCrewSpec[] = useMemo(() => {
    if (initialLocationSettled) {
      logger.debug('👨‍🚒 Processing hand crews from equipment data:', {
        totalEquipment: equipment.length,
        handCrewItems: equipment.filter((e): e is HandCrewApi => e.type === 'HandCrew').length
      });
    }

    const items = equipment.filter((e): e is HandCrewApi => e.type === 'HandCrew');
    if (!items.length) {
      if (initialLocationSettled || equipment.length > 0) logger.debug('⚠️ No hand crew items found, using default config');
      return defaultConfig.handCrews;
    }
    
    return items.map(c => {
      logger.debug(`👨‍🚒 Processing hand crew: ${c.name}`, {
        id: c.id,
        rawAllowedTerrain: c.allowedTerrain,
        rawAllowedVegetation: c.allowedVegetation,
        crewSize: c.crewSize,
        clearingRatePerPerson: c.clearingRatePerPerson
      });

      const allowedTerrain = safeParseAllowedValues(
        c.allowedTerrain, 
        ['flat', 'medium', 'steep', 'very_steep'],
        'allowedTerrain',
        c.name
      );
      
      const allowedVegetation = safeParseAllowedValues(
        c.allowedVegetation,
        ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
        'allowedVegetation', 
        c.name
      );
      
      const processed = {
        id: c.id,
        name: c.name,
        crewSize: c.crewSize || 0,
        clearingRatePerPerson: c.clearingRatePerPerson || 0,
        tools: c.equipmentList || [],
        costPerHour: c.costPerHour || 0,
        description: c.description || '',
        allowedTerrain,
        allowedVegetation
      };

      return processed;
    });
  }, [equipment, initialLocationSettled]);

  // Shared loader so we can refresh after CRUD ops to pull canonical server state (e.g. version, defaults)
  const loadEquipment = useCallback(async () => {
    setLoadingEquip(true);
    setEquipError(null);
    try {
      const data = await listEquipment();
      setEquipment(data);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load equipment';
      setEquipError(errorMessage);
    } finally {
      setLoadingEquip(false);
    }
  }, []);

  // Vegetation mappings loader
  const loadVegetationMappings = useCallback(async () => {
    setLoadingVegetationMappings(true);
    setVegetationMappingError(null);
    try {
  // Clear the NSW vegetation cache to force using new mappings
  try { _clearNSWCache(); } catch (err) { logger.warn('Failed to clear NSW cache', err); }
      
      const data = await listVegetationMappings();
      setVegetationMappings(data);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load vegetation mappings';
      setVegetationMappingError(errorMessage);
    } finally {
      setLoadingVegetationMappings(false);
    }
  }, []);

  // Initial load
  useEffect(() => { 
    loadEquipment(); 
    loadVegetationMappings();
    // Prefetch geo location early with short timeout to avoid blocking UI
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
          setPrefetchedLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }, (err) => {
          // ignore failures here — map will still try when initialised
        }, { enableHighAccuracy: false, timeout: 3000 });
      }
    } catch (e) {
      // ignore
    }
  }, [loadEquipment, loadVegetationMappings]);
  
  // Create default vegetation mappings if none exist
  useEffect(() => {
    if (
      !loadingVegetationMappings && 
      vegetationMappings.length === 0 && 
      !vegetationMappingError
    ) {
      const createDefaultMappings = async () => {
        logger.debug('Checking for existing vegetation mappings');
        
        // First, try to load any existing mappings
        try {
          const existingMappings = await listVegetationMappings();
          
          // If mappings were found after all, update state and don't create defaults
          if (existingMappings && existingMappings.length > 0) {
            logger.debug(`Found ${existingMappings.length} existing vegetation mappings, skipping default creation`);
            setVegetationMappings(existingMappings);
            return;
          }
          
          logger.debug('No existing mappings found, creating defaults');
          
          // Common NSW vegetation formations mapped to our 4 categories
          const defaultMappings = [
            // Forests
            { formationName: 'Rainforest', vegetationType: 'heavyforest', confidence: 0.95, active: true },
            { formationName: 'Wet Sclerophyll Forest', vegetationType: 'heavyforest', confidence: 0.95, active: true },
            { formationName: 'Dry Sclerophyll Forest', vegetationType: 'heavyforest', confidence: 0.9, active: true },
            { formationName: 'Forested Wetlands', vegetationType: 'heavyforest', confidence: 0.9, active: true },
            
            // Woodlands
            { formationName: 'Grassy Woodland', vegetationType: 'heavyforest', confidence: 0.85, active: true },
            { formationName: 'Semi-arid Woodland', vegetationType: 'mediumscrub', confidence: 0.8, active: true },
            
            // Shrublands
            { formationName: 'Heathland', vegetationType: 'mediumscrub', confidence: 0.9, active: true },
            { formationName: 'Alpine Complex', vegetationType: 'mediumscrub', confidence: 0.8, active: true },
            { formationName: 'Arid Shrubland', vegetationType: 'mediumscrub', confidence: 0.9, active: true },
            
            // Grasslands
            { formationName: 'Grassland', vegetationType: 'grassland', confidence: 0.95, active: true },
            { formationName: 'Freshwater Wetland', vegetationType: 'grassland', confidence: 0.85, active: true },
            
            // Light vegetation
            { formationName: 'Saline Wetland', vegetationType: 'lightshrub', confidence: 0.85, active: true },
            { formationName: 'Saltmarsh', vegetationType: 'lightshrub', confidence: 0.9, active: true }
          ];
          
          // Create default mappings, handling conflicts gracefully
          for (const mapping of defaultMappings) {
            try {
              await createVegetationMapping(mapping as CreateVegetationMappingInput);
              logger.debug(`Created mapping for: ${mapping.formationName}`);
            } catch (err: any) {
              // Skip over already existing mappings
              if (err.message?.includes('already exists')) {
                logger.debug(`Mapping for ${mapping.formationName} already exists, skipping`);
              } else {
                logger.error(`Error creating mapping for ${mapping.formationName}:`, err);
              }
            }
          }
          
          // Reload to get all mappings including any that were created
          await loadVegetationMappings();
        } catch (error) {
          logger.error('Failed to create default vegetation mappings:', error);
        }
      };
      
      createDefaultMappings();
    }
  }, [loadingVegetationMappings, vegetationMappings, vegetationMappingError, loadVegetationMappings]);

  // CRUD helpers passed to config panel
  const handleCreate = async (partial: Partial<EquipmentApi> & { type: EquipmentApi['type']; name: string; }) => {
    const payload = {
      type: partial.type,
      name: partial.name,
      description: partial.description || '',
      allowedTerrain: partial.allowedTerrain || ['flat'],
      allowedVegetation: partial.allowedVegetation || ['grassland'],
      active: true,
      costPerHour: partial.costPerHour,
      // Add type-specific properties
      ...(partial.type === 'Machinery' && 'clearingRate' in partial ? { clearingRate: partial.clearingRate, maxSlope: partial.maxSlope } : {}),
      ...(partial.type === 'Aircraft' && 'dropLength' in partial ? { dropLength: partial.dropLength, turnaroundMinutes: partial.turnaroundMinutes } : {}),
      ...(partial.type === 'HandCrew' && 'crewSize' in partial ? { crewSize: partial.crewSize, clearingRatePerPerson: partial.clearingRatePerPerson, equipmentList: partial.equipmentList } : {})
    } as CreateEquipmentInput;
    await createEquipment(payload);
    // Always reload full list to capture server-assigned fields & maintain consistency
    await loadEquipment();
  };

  const handleUpdate = async (item: EquipmentApi) => {
    await updateEquipmentItem(item);
    await loadEquipment();
  };

  const handleDelete = async (item: EquipmentApi) => {
    await deleteEquipment(item.type, item.id);
    await loadEquipment();
  };
  
  // CRUD helpers for vegetation mappings
  const handleCreateVegetationMapping = async (mapping: CreateVegetationMappingInput) => {
    await createVegetationMapping(mapping);
    await loadVegetationMappings();
  };

  const handleUpdateVegetationMapping = async (mapping: VegetationFormationMappingApi) => {
    await updateVegetationMappingItem(mapping);
    await loadVegetationMappings();
  };

  const handleDeleteVegetationMapping = async (mapping: VegetationFormationMappingApi) => {
    await deleteVegetationMapping(mapping.id);
    await loadVegetationMappings();
  };

  return (
    <div className={`app-shell${mobilityModeActive ? ' tactical-mode' : ''}`}>
      <header className="app-header">
        <div className="header-left">
          {mobilityModeActive ? (
            <Radar size={40} strokeWidth={1.6} aria-hidden className="app-logo app-logo--tactical" />
          ) : (
            <img src={logo96} alt="App logo" className="app-logo" />
          )}
          <div className="header-titles">
            {mobilityModeActive ? (
              <>
                <h1 className="app-title">Terrain Mobility</h1>
                <span className="app-subtitle">Area Mobility &amp; Counter-Mobility Appreciation — POC</span>
              </>
            ) : (
              <>
                <h1 className="app-title">Fire Break Calculator</h1>
                <span className="app-subtitle">Easy Geospatial Fire Break & Trail Planning Tool</span>
              </>
            )}
          </div>
        </div>
        <div className="header-center">
          <SearchControl 
            onLocationSelected={handleSearchLocationSelected}
            userLocation={userLocation}
            className="header-search-control"
          />
        </div>
        <div className="header-right">
          <AccountControl
            onSessionChange={handleSuiteSessionChange}
            onLoadPlan={handleLoadSavedPlan}
            plansVersion={plansVersion}
            openSignal={signInSignal}
          />
          {!mobilityModeActive && (
            <button
              className="config-panel-toggle"
              onClick={() => setIsConfigOpen(v => !v)}
              title="Open Configuration Panel"
              aria-label="Open configuration panel for equipment and vegetation mappings"
            >
              <Settings2 size={20} strokeWidth={2} aria-hidden className="config-icon" />
              <span className="config-label">Configuration</span>
            </button>
          )}
          {mobilityModeAvailable && (
            <button
              className="config-panel-toggle"
              onClick={() => setMobilityModeActive(v => !v)}
              title="Terrain appreciation mode (POC)"
              aria-label="Toggle terrain appreciation mode"
            >
              <span className="config-label">{mobilityModeActive ? 'Fire break mode' : 'Terrain mode'}</span>
            </button>
          )}
        </div>
      </header>
      <main className="app-main" id="main-content">
        <div className="map-section">
          <MapboxMapView 
            onDistanceChange={setFireBreakDistance}
            onTrackAnalysisChange={setTrackAnalysis}
            onVegetationAnalysisChange={setVegetationAnalysis}
            onAnalyzingChange={setIsAnalyzing}
            selectedAircraftForPreview={selectedAircraftForPreview}
            aircraft={aircraft}
            onUserLocationChange={setUserLocation}
            onInitialLocationSettled={setInitialLocationSettled}
            initialUserLocation={prefetchedLocation}
            selectedSearchLocation={searchLocation}
            onLineChange={handleLineCoordsChange}
            initialLine={sharedPlan?.coords || null}
            highlightCoords={highlightCoords}
            hoverPoint={hoverPoint}
            optimizedPreview={optimizerStatus === 'done' && optimizerResult ? optimizerResult.coords : null}
            applyLineRequest={applyLineRequest}
            contextOverlays={contextOverlays}
            optimizerScanning={optimizerStatus === 'running'}
            optimizerHeatmap={optimizerStatus === 'done' && optimizerResult ? optimizerResult.heatmap : null}
            optimizerProgress={optimizerProgress}
            optimizerPhase={optimizerPhase}
            heatmapColorMode={heatmapColorMode}
            // Scan cells stay up through 'done' so the final heatmap fades
            // in over them (a delayed effect clears them after the fade);
            // clearing at 'running'→'done' blanked the corridor for ~1s.
            scanCells={optimizerStatus === 'running' || optimizerStatus === 'done' ? scanCells : null}
            scanBestPath={optimizerStatus === 'running' ? scanBestPath : null}
            areaReconActive={areaReconActive}
            onAreaReconActiveChange={setAreaReconActive}
            onAreaReconBoxDrawn={handleAreaReconBoxDrawn}
            areaReconHeatmap={areaReconStatus === 'done' ? areaReconHeatmap : null}
            areaReconStatus={areaReconStatus}
            onClearAreaRecon={handleClearAreaRecon}
            onViewBoundsChange={setViewBounds}
            liveFeedData={liveFeedData}
            tacticalMode={mobilityModeActive}
            mobilityBoxRole={mobilityBoxRole}
            onMobilityBoxRoleChange={setMobilityBoxRole}
            onMobilityPaintDab={handleMobilityPaintDab}
            mobilityOriginPaint={mobilityOriginPaint}
            mobilityObjectivePaint={mobilityObjectivePaint}
            mobilityBrushSize={mobilityBrushSize}
            onMobilityBrushSizeChange={setMobilityBrushSize}
            mobilityPaintMode={mobilityPaintMode}
            onMobilityPaintModeChange={setMobilityPaintMode}
            mobilityHeatmap={mobilityHeatmapForMap}
            mobilityDisplayMode={mobilityDisplayMode}
            onCursorMove={setMobilityCursor}
            unitSimPosition={unitSimPosition}
            unitSimPath={unitSimPath}
            // The authoritative result, once it exists, always wins outright
            // — including a null roadRoute (e.g. a retry-widened box moved
            // the route out of range) — never silently falls back to a stale
            // early preview once the real answer is in.
            roadRoute={mobilityResult ? (mobilityResult.roadRoute?.waypoints ?? null) : mobilityEarlyRoadRoute}
            corridors={displayedMovementCorridorField?.corridors ?? null}
            corridorRoutes={corridorRoutesForMap}
            highlightedCorridorId={highlightedCorridorId}
            onCorridorHighlight={setHighlightedCorridorId}
            chokepoints={mobilityResult?.chokepoints ?? null}
            barrierSegments={mobilityResult?.barrier?.segments ?? null}
            roadBarrierSegments={mobilityResult?.roadNetworkBarrier?.segments ?? null}
            onRunAppreciation={handleRunMobilityAppreciation}
            onCancelAppreciation={handleCancelMobilityAppreciation}
            mobilityRunning={mobilityRunning}
            mobilityProgress={mobilityProgress}
            mobilityStageLabel={mobilityStage?.label ?? null}
            mobilityLatestLog={mobilityLogLines.length > 0 ? mobilityLogLines[mobilityLogLines.length - 1] : null}
            mobilityOverlayOpacity={mobilityOverlayOpacity}
            mobilityTransitCells={transitCellsForMap}
            ensembleMovers={ensembleMovers}
            restrictions={restrictionsForMap}
            waterFeatures={waterFeaturesForMap}
          />
          {mobilityModeActive && (
            <MobilityLegend
              overlayOpacity={mobilityOverlayOpacity}
              onOverlayOpacityChange={setMobilityOverlayOpacity}
              present={{
                originPaint: mobilityOriginPaint.length > 0,
                objectivePaint: mobilityObjectivePaint.length > 0,
                cells: !!mobilityHeatmapForMap && mobilityHeatmapForMap.length > 0,
                displayMode: mobilityDisplayMode,
                corridors: (displayedMovementCorridorField?.corridors.length ?? 0) > 0,
                corridorsFromSimulation: displayedMovementCorridorField?.evidence === 'simulated-movers',
                corridorRoutes: corridorRoutesForMap.length > 0,
                transitField: !!transitCellsForMap && transitCellsForMap.length > 0,
                chokepoints: (mobilityResult?.chokepoints.length ?? 0) > 0,
                barrier: (mobilityResult?.barrier?.segments.length ?? 0) > 0,
                roadBarrier: (mobilityResult?.roadNetworkBarrier?.segments.length ?? 0) > 0,
                restrictions: (restrictionsForMap?.length ?? 0) > 0,
                water: (waterFeaturesForMap?.length ?? 0) > 0,
                unitPath: !!unitSimPath,
                movers: !!ensembleMovers && ensembleMovers.length > 0,
                roadRoute: !!mobilityResult?.roadRoute,
              }}
            />
          )}
          <MapEmptyState
            key={mobilityModeActive ? 'terrain' : 'firebreak'}
            initialLocationSettled={initialLocationSettled}
            distance={fireBreakDistance}
            tacticalMode={mobilityModeActive}
            mobilityStarted={mobilityOriginPaint.length > 0 || mobilityObjectivePaint.length > 0}
          />
        </div>
        <div className={`analysis-section${isAnalysisPanelExpanded ? ' expanded' : ' collapsed'}`}>
          {mobilityModeActive ? (
            <>
            <div className="mobility-mode-tabs">
              <button
                className={mobilityActiveTab === 'appreciation' ? 'active' : ''}
                onClick={() => setMobilityActiveTab('appreciation')}
              >
                Terrain appreciation
              </button>
              <button
                className={mobilityActiveTab === 'counterMobility' ? 'active' : ''}
                onClick={() => setMobilityActiveTab('counterMobility')}
              >
                Counter-mobility planner
              </button>
              <button
                className={mobilityActiveTab === 'oakoc' ? 'active' : ''}
                onClick={() => setMobilityActiveTab('oakoc')}
              >
                OCOKA
              </button>
            </div>
            {mobilityActiveTab === 'appreciation' ? (
            <MobilityPanel
              profileId={mobilityProfileId}
              onProfileChange={setMobilityProfileId}
              nightMode={mobilityNightMode}
              onNightModeChange={setMobilityNightMode}
              roadSpeedOverrides={roadSpeedOverrides}
              onRoadSpeedOverridesChange={setRoadSpeedOverrides}
              fidelity={mobilityFidelity}
              onFidelityChange={setMobilityFidelity}
              boxRole={mobilityBoxRole}
              onBoxRoleChange={setMobilityBoxRole}
              originPaint={mobilityOriginPaint}
              objectivePaint={mobilityObjectivePaint}
              brushSize={mobilityBrushSize}
              onBrushSizeChange={setMobilityBrushSize}
              onClearPaint={handleClearMobilityPaint}
              running={mobilityRunning}
              logLines={mobilityLogLines}
              result={mobilityResult}
              displayMode={mobilityDisplayMode}
              onDisplayModeChange={setMobilityDisplayMode}
              cursor={mobilityCursor}
              hasPath={!!mobilityResult?.path}
              simRunning={simRunning}
              onStartSimulation={handleStartAnySimulation}
              onStopSimulation={handleStopAnySimulation}
              speedMultiplier={simSpeedMultiplier}
              onSpeedMultiplierChange={handleSpeedMultiplierChangeAll}
              simElapsedSeconds={simElapsedSeconds}
              cmPlacements={cmPlacements}
              cmLedger={cmLedger}
              behaviourSpreadId={behaviourSpreadId}
              onBehaviourSpreadChange={setBehaviourSpreadId}
              movementView={movementView}
              onMovementViewChange={setMovementView}
              showTransitField={showTransitField}
              onShowTransitFieldChange={setShowTransitField}
              displayedEnsemble={displayedEnsemble}
              displayedCorridorField={displayedMovementCorridorField}
              highlightedCorridorId={highlightedCorridorId}
              onCorridorHighlight={setHighlightedCorridorId}
              simMode={simMode}
              onSimModeChange={setSimMode}
            />
            ) : mobilityActiveTab === 'counterMobility' ? (
              <CounterMobilityPanel
                barrierSegments={mobilityResult?.barrier?.segments ?? []}
                pendingSegmentIndex={cmPendingSegmentIndex}
                onPendingSegmentIndexChange={setCmPendingSegmentIndex}
                placements={cmPlacements}
                onPlacementsChange={setCmPlacements}
                onRunLedger={handleRunCounterMobilityLedger}
                running={cmRunning}
                ledger={cmLedger}
                addedMeasureIds={cmAddedMeasureIds}
                onAddToPlan={handleAddCounterMeasureToPlan}
                corridorComparison={cmCorridorComparison}
                corridorView={corridorView}
                onCorridorViewChange={setCorridorView}
              />
            ) : (
              <OakocPanel result={mobilityResult} />
            )}
            </>
          ) : (
          <AnalysisPanel
            distance={fireBreakDistance}
            trackAnalysis={trackAnalysis}
            vegetationAnalysis={vegetationAnalysis}
            isAnalyzing={isAnalyzing}
            // Only allow heavy backend analysis after the map has completed initial
            // pan/zoom to the user's location (or attempted fallback).
            mapSettled={initialLocationSettled}
            machinery={machinery}
            aircraft={aircraft}
            handCrews={handCrews}
            selectedAircraftForPreview={selectedAircraftForPreview}
            onDropPreviewChange={setSelectedAircraftForPreview}
            onExpandedChange={setIsAnalysisPanelExpanded}
            lineCoords={lineCoords}
            initialBreakWidthMeters={sharedPlan?.breakWidthMeters}
            initialVegetationOverride={sharedPlan?.vegetation}
            onLocateSegment={handleLocateSegment}
            activeHighlightRange={highlightRange}
            onHoverChainage={handleHoverChainage}
            optimizerStatus={optimizerStatus}
            optimizerProgress={optimizerProgress}
            optimizerPhase={optimizerPhase}
            optimizerResult={optimizerResult}
            optimizerError={optimizerError}
            onOptimize={handleOptimize}
            onApplyOptimized={handleApplyOptimized}
            onDismissOptimized={handleDismissOptimized}
            heatmapColorMode={heatmapColorMode}
            onHeatmapColorModeChange={setHeatmapColorMode}
            onImportAsPlan={handleImportAsPlan}
            onAddOverlay={handleAddOverlay}
            overlayCount={contextOverlays.length}
            onClearOverlays={handleClearOverlays}
            viewBounds={viewBounds}
            onLiveFeedData={setLiveFeedData}
            canSaveToCloud={!!suiteSession?.fireBreakEnabled}
            onSaveToCloud={handleSaveToCloud}
            anonymousLimited={anonymousLimited}
            onRequestSignIn={requestSignIn}
          />
          )}
        </div>
        <IntegratedConfigPanel
          // Fire-break-only panel — its own open button is already hidden in
          // Terrain mode (header, above), but `isConfigOpen` itself survives
          // a mode switch, so if it was left open before switching it would
          // otherwise still render on top of the Terrain UI (2026-07-26 UI
          // review: "ensure everything switches... instead of sitting on
          // top" applies here too, not just the map overlay controls).
          isOpen={isConfigOpen && !mobilityModeActive}
          onToggle={() => setIsConfigOpen(v => !v)}

          // Equipment props
          equipment={equipment}
          loadingEquipment={loadingEquip}
          equipmentError={equipError}
          onCreateEquipment={handleCreate}
          onUpdateEquipment={handleUpdate}
          onDeleteEquipment={handleDelete}
          
          // Vegetation mapping props
          vegetationMappings={vegetationMappings}
          loadingVegetationMappings={loadingVegetationMappings}
          vegetationMappingError={vegetationMappingError}
          onCreateVegetationMapping={handleCreateVegetationMapping}
          onUpdateVegetationMapping={handleUpdateVegetationMapping}
          onDeleteVegetationMapping={handleDeleteVegetationMapping}
        />
      </main>
    </div>
  );
};

export default App;
