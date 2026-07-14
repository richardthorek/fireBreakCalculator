/**
 * State vegetation service router and orchestrator.
 *
 * Routes queries to the appropriate state-specific service based on coordinates.
 * Implements fallback chain: state service → NVIS → Mapbox → mock.
 *
 * This is the single entry point for vegetation data queries and should be used
 * by vegetation analysis instead of calling individual state services directly.
 */

import { logger } from './logger';
import { AustralianState, determineState, isInAustralia } from './stateDetection';
import { StateVegetationResult, StateVegetationService } from './stateVegetationInterfaces';
import { VegetationType } from '../config/classification';

// Import existing services (NSW is implemented, others are placeholders for now)
import { fetchNSWVegetation as fetchNSWRaw, fetchNSWVegetationArea, pointInRings, NSWAreaFeature } from './nswVegetationService';
import { fetchNVISVegetation as fetchNVISRaw, fetchNVISAreaRaster, rasterCodeAt, mapMVGCode, NVISAreaRaster } from './nvisVegetationService';

// Service registry: will be populated with state services as they're implemented
const stateServices: Partial<Record<AustralianState, StateVegetationService>> = {
  // NSW: implemented below
  // VIC: to be added in Phase 3a
  // QLD: to be added in Phase 3b
  // WA: to be added in Phase 3c
  // SA: to be added in Phase 3d
  // TAS: to be added in Phase 4
  // ACT: to be added in Phase 4
  // NT: to be added in Phase 4
};

// Simple in-memory cache to reduce duplicate queries (keyed by rounded lat/lng)
const queryCache: Record<string, StateVegetationResult | null> = {};

const CACHE_KEY_PRECISION = 3; // 3 decimals = ~111m precision

function getCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(CACHE_KEY_PRECISION)},${lng.toFixed(CACHE_KEY_PRECISION)}`;
}

/**
 * Adapt NSW service result to StateVegetationResult format.
 * NSW service returns a different interface; this converts it.
 */
function adaptNSWResult(rawResult: Awaited<ReturnType<typeof fetchNSWRaw>>): StateVegetationResult | null {
  if (!rawResult) return null;
  return {
    vegetationType: rawResult.vegetationType,
    confidence: rawResult.confidence,
    displayLabel: rawResult.pctName || rawResult.vegForm || rawResult.vegClass || rawResult.source || 'NSW vegetation',
    source: `NSW SVTM PCT (${rawResult.source})`,
    state: 'NSW',
    rawAttributes: { vegClass: rawResult.vegClass, vegForm: rawResult.vegForm, pctName: rawResult.pctName },
  };
}

/**
 * Adapt NVIS service result to StateVegetationResult format.
 */
function adaptNVISResult(rawResult: Awaited<ReturnType<typeof fetchNVISRaw>>): StateVegetationResult | null {
  if (!rawResult) return null;
  return {
    vegetationType: rawResult.vegetationType,
    confidence: rawResult.confidence,
    displayLabel: rawResult.mvgName || 'NVIS vegetation',
    source: `NVIS MVG ${rawResult.mvgCode || '?'} (${rawResult.mvgName})`,
    state: 'AU', // National dataset, not state-specific
    rawAttributes: { mvgCode: rawResult.mvgCode, mvgName: rawResult.mvgName },
  };
}

/**
 * Register a state-specific vegetation service.
 * Called during initialization to populate the service registry.
 * @internal Used by state service implementations to register themselves
 */
export function registerStateService(state: AustralianState, service: StateVegetationService) {
  stateServices[state] = service;
  logger.debug(`Registered vegetation service for ${state}: ${service.name}`);
}

/**
 * Fetch vegetation data using the state-based fallback chain.
 *
 * Fallback order:
 * 1. State-specific service (NSW, VIC, QLD, etc.)
 * 2. NVIS national dataset
 * 3. External callers handle further fallbacks (Mapbox, mock)
 *
 * @param lat Latitude (WGS84)
 * @param lng Longitude (WGS84)
 * @returns Vegetation result, or null if all queries failed or point is outside Australia
 */
export async function fetchStateVegetation(lat: number, lng: number): Promise<StateVegetationResult | null> {
  // Check cache first
  const cacheKey = getCacheKey(lat, lng);
  if (cacheKey in queryCache) {
    return queryCache[cacheKey];
  }

  // Outside Australia — short-circuit to avoid unnecessary queries
  if (!isInAustralia(lat, lng)) {
    queryCache[cacheKey] = null;
    return null;
  }

  // Area data fetched earlier this session already covers this point —
  // resolve locally, no network. 'nodata' is an authoritative empty answer
  // (ocean/gap), cached as null exactly like a failed point query would be.
  const fromArea = resolveFromCachedAreas(lat, lng);
  if (fromArea === 'nodata') {
    queryCache[cacheKey] = null;
    return null;
  }
  if (fromArea) {
    queryCache[cacheKey] = fromArea;
    return fromArea;
  }

  const state = determineState(lat, lng);
  let result: StateVegetationResult | null = null;

  try {
    // Try state-specific service first (if implemented)
    const stateService = stateServices[state];
    if (stateService) {
      try {
        result = await stateService.fetch(lat, lng);
        if (result) {
          queryCache[cacheKey] = result;
          return result;
        }
      } catch (error) {
        logger.warn(`State service error (${state}):`, error);
        // Fall through to NVIS
      }
    }

    // Fallback to NVIS if state service unavailable or returned no data
    // Special handling: if state service returned results but with low confidence,
    // you might skip NVIS entirely. For now, we always try NVIS as backup.
    const nvisRaw = await fetchNVISRaw(lat, lng);
    if (nvisRaw) {
      result = adaptNVISResult(nvisRaw);
    }
  } catch (error) {
    logger.warn(`Vegetation query failed for (${lat}, ${lng}):`, error);
  }

  // Cache the result (may be null) to avoid repeated failed queries
  queryCache[cacheKey] = result || null;
  return result;
}

// ---------------------------------------------------------------------------
// Area mode: resolve fuel for a whole corridor/box from at most TWO upstream
// requests (one NSW envelope feature-query + one NVIS export image), sampled
// locally, instead of one query per point. See the WHY blocks in the two
// service modules — per-point querying scales linearly with search area and
// would overwhelm free government servers at any real corridor size.
// ---------------------------------------------------------------------------

export interface AreaVegetationBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** A local, synchronous fuel lookup built from area data. Returns the
 *  resolved result, 'nodata' when the authoritative source POSITIVELY
 *  reports no data there (ocean/gap — don't waste a point query), or null
 *  when the area data simply doesn't cover the point (caller may fall back
 *  to a per-point query). */
export type AreaVegetationResolver = (lat: number, lng: number) => StateVegetationResult | 'nodata' | null;

// Fetched area data is RETAINED for the session (bounded FIFO) and consulted
// by every subsequent lookup — including plain fetchStateVegetation point
// calls. Once one consolidated call has pulled the corridor's data, all the
// granular processing that follows (the optimizer's finer refine/polish
// passes, per-segment analysis along the applied line, re-runs) samples that
// locally-held data for free instead of going back upstream.
const areaCache: { key: string; bounds: AreaVegetationBounds; resolve: AreaVegetationResolver }[] = [];
const AREA_CACHE_MAX = 6;

const areaKey = (b: AreaVegetationBounds) =>
  [b.minLat, b.minLng, b.maxLat, b.maxLng].map(v => v.toFixed(3)).join(',');

/** Resolve a point from any retained area dataset. Newest first (later
 *  fetches are likelier to reflect what the user is working on now). A
 *  dataset that covers the bbox but can't resolve the point (unmatched
 *  pixel / PIP miss) falls through to older datasets, then to null. */
export function resolveFromCachedAreas(lat: number, lng: number): StateVegetationResult | 'nodata' | null {
  for (let i = areaCache.length - 1; i >= 0; i--) {
    const { bounds, resolve } = areaCache[i];
    if (lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng) {
      const r = resolve(lat, lng);
      if (r) return r;
    }
  }
  return null;
}

/** Clear retained area datasets (tests / config changes). @internal */
export function _clearAreaVegetationCache() {
  areaCache.length = 0;
}

/**
 * Fetch area vegetation for a bbox: NSW SVTM polygons (high-fidelity overlay,
 * where the bbox touches NSW) and the NVIS national raster, fetched in
 * parallel. Returns null when neither source could be loaded — callers then
 * use the per-point fallback chain unchanged.
 */
export async function fetchStateVegetationArea(bounds: AreaVegetationBounds, signal?: AbortSignal): Promise<AreaVegetationResolver | null> {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const midLng = (bounds.minLng + bounds.maxLng) / 2;
  if (!isInAustralia(midLat, midLng)) return null;

  // Same bounds already fetched this session — the data is local, reuse it.
  const key = areaKey(bounds);
  const cached = areaCache.find(e => e.key === key);
  if (cached) return cached.resolve;

  let nsw: NSWAreaFeature[] | null = null;
  let nvis: NVISAreaRaster | null = null;
  try {
    [nsw, nvis] = await Promise.all([
      fetchNSWVegetationArea(bounds.minLat, bounds.minLng, bounds.maxLat, bounds.maxLng, signal).catch(() => null),
      fetchNVISAreaRaster(bounds.minLat, bounds.minLng, bounds.maxLat, bounds.maxLng, signal).catch(() => null),
    ]);
  } catch {
    return null;
  }
  if ((!nsw || nsw.length === 0) && !nvis) return null;

  const resolve = (lat: number, lng: number): StateVegetationResult | 'nodata' | null => {
    // Same precedence as the per-point chain: state service first, NVIS after.
    if (nsw) {
      for (const f of nsw) {
        if (pointInRings(lng, lat, f.rings)) {
          const adapted = adaptNSWResult(f.result);
          if (adapted) return adapted;
        }
      }
    }
    if (nvis) {
      const code = rasterCodeAt(nvis, lat, lng);
      if (code === 'nodata') return 'nodata';
      if (code != null) {
        const mapped = mapMVGCode(code);
        if (mapped) {
          return {
            vegetationType: mapped.vegetation,
            confidence: nvis.coarse ? mapped.confidence * 0.85 : mapped.confidence,
            displayLabel: mapped.name,
            source: `NVIS MVG ${code} (${mapped.name})${nvis.coarse ? ' — coarse area sample' : ''}`,
            state: 'AU',
            rawAttributes: { mvgCode: code, mvgName: mapped.name },
          };
        }
      }
    }
    return null;
  };

  // Retain for the session so all later granular lookups — finer optimizer
  // passes, per-segment analysis, re-runs — sample this data locally.
  areaCache.push({ key, bounds, resolve });
  if (areaCache.length > AREA_CACHE_MAX) areaCache.shift();
  return resolve;
}

/**
 * Register the NSW service (already implemented).
 * Called during module initialization.
 * @internal
 */
export async function initializeNSWService() {
  const nswService: StateVegetationService = {
    name: 'NSW SVTM PCT',
    fetch: async (lat, lng) => {
      const raw = await fetchNSWRaw(lat, lng);
      return adaptNSWResult(raw);
    },
  };
  registerStateService('NSW', nswService);
}

/**
 * Clear the query cache.
 * Useful for testing or forcing a refresh.
 * @internal
 */
export function _clearStateVegetationCache() {
  Object.keys(queryCache).forEach((k) => delete queryCache[k]);
}

/**
 * Get current service registry status (for monitoring/debugging).
 * @internal
 */
export function getServiceStatus(): Record<AustralianState, boolean> {
  const status: Record<string, boolean> = {};
  for (const state of ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as AustralianState[]) {
    status[state] = state in stateServices;
  }
  return status as Record<AustralianState, boolean>;
}

// Initialize NSW service on module load
initializeNSWService().catch((e) => logger.warn('Failed to initialize NSW service:', e));
