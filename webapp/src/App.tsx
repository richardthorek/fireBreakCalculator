import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Settings2 } from 'lucide-react';
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

// Site logo/favicon is in the public directory and served at /favicon-96x96.png.
const logo96 = '/favicon-96x96.png';

/**
 * Root application component for the Fire Break Calculator.
 * Renders a fixed-height header (10% of viewport), responsive Mapbox GL JS map,
 * and analysis panel for fire break calculations.
 */
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
    <div className="app-shell">
      <header className="app-header">
        <div className="header-left">
          <img src={logo96} alt="App logo" className="app-logo" />
          <div className="header-titles">
            <h1 className="app-title">Fire Break Calculator</h1>
            <span className="app-subtitle">Easy Geospatial Fire Break & Trail Planning Tool</span>
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
          <button
            className="config-panel-toggle"
            onClick={() => setIsConfigOpen(v => !v)}
            title="Open Configuration Panel"
            aria-label="Open configuration panel for equipment and vegetation mappings"
          >
            <Settings2 size={20} strokeWidth={2} aria-hidden className="config-icon" />
            <span className="config-label">Configuration</span>
          </button>
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
          />
          <MapEmptyState 
            initialLocationSettled={initialLocationSettled}
            distance={fireBreakDistance}
          />
        </div>
        <div className={`analysis-section${isAnalysisPanelExpanded ? ' expanded' : ' collapsed'}`}>
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
        </div>
        <IntegratedConfigPanel 
          isOpen={isConfigOpen}
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
