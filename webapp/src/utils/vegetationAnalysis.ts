/**
 * Vegetation analysis utilities using NSW vegetation service and Mapbox Terrain v2 
 * Automatically extracts landcover data to determine vegetation type/density
 */

// Coordinate type compatibility for both Leaflet and Mapbox GL JS
type LatLngLike = { lat: number; lng: number } | { lat: number; lon: number };

import { VegetationType } from '../config/classification';
import { VegetationSegment, VegetationAnalysis } from '../types/config';
import { MAPBOX_TOKEN } from '../config/mapboxToken';
import { fetchStateVegetation } from './stateVegetationRouter';
import { logger } from './logger';
import { mapFormationToVegetationType } from './vegetationMappingHelper';
import { fetchCorridorWaterways, distanceToNearestWater, fetchCorridorInfrastructure, distanceToNearestTrail, InfrastructureData } from './infrastructureService';
import { fetchNAFITimeSinceFire } from '../terrain/dataLayers/nafiFireHistoryService';

/** Same snap distance Terrain Mobility's hydrology gate uses (docs
 *  ROUTE_INTELLIGENCE.md §34) — a mapped waterway/water-body within this of a
 *  sample point is treated as actually crossing the line, not just nearby. */
const WATER_SNAP_M = 30;

/** Same snap distance `routeOptimizer.ts`'s own `TRAIL_SNAP_M` uses for its
 *  internal path-selection "on trail" test — kept identical so this
 *  segment-level flag and the optimizer's own before/after trail-reuse stat
 *  (`RouteComparisonStats.existingTrailDistance`) describe the same ground,
 *  not two different snap radii quietly disagreeing. */
const TRAIL_SNAP_M = 30;

/**
 * Helper function to get longitude from coordinate object that may use lng or lon
 */
const getLng = (coord: LatLngLike): number => {
  return 'lng' in coord ? coord.lng : coord.lon;
};

/**
 * Map Mapbox Terrain v2 landcover class to application vegetation type
 */
export const mapLandcoverToVegetation = (landcoverClass: string): { vegetation: VegetationType; confidence: number } => {
  const lowerClass = landcoverClass.toLowerCase();
  
  switch (lowerClass) {
    // Forest and wooded areas
    case 'wood':
    case 'forest':
    case 'tree':
    case 'trees':
    case 'woodland':
    case 'mixed forest':
    case 'dense forest':
      return { vegetation: 'heavyforest', confidence: 0.9 };
    
    // Scrub and shrubland
    case 'scrub':
    case 'shrub':
    case 'shrubland':
    case 'bush':
    case 'bushland':
    case 'heath':
    case 'heathland':
    case 'savanna':
    case 'mallee':
      return { vegetation: 'mediumscrub', confidence: 0.85 };
    
    // Grassland and open areas
    case 'grass':
    case 'grassland':
    case 'meadow':
    case 'pasture':
    case 'field':
    case 'dry grass':
    case 'wet grass':
    case 'prairie':
    case 'steppe':
      return { vegetation: 'grassland', confidence: 0.9 };
    
    // Light vegetation and sparse areas
    case 'crop':
    case 'farmland':
    case 'agriculture':
    case 'cultivated':
    case 'farm':
    case 'sparse vegetation':
    case 'sparse':
      return { vegetation: 'lightshrub', confidence: 0.7 };
    
    // Dense vegetation that's not forest (treat as heavy for machinery constraints)
    case 'dense vegetation':
    case 'dense scrub':
    case 'thick vegetation':
      return { vegetation: 'heavyforest', confidence: 0.8 };
    
    // Snow and ice areas
    case 'snow':
    case 'ice':
    case 'glacier':
      return { vegetation: 'grassland', confidence: 0.3 };
    
    // Urban and developed areas (treat as light vegetation for fire break planning)
    case 'urban':
    case 'built':
    case 'developed':
    case 'building':
    case 'residential':
    case 'commercial':
    case 'industrial':
      return { vegetation: 'lightshrub', confidence: 0.5 };
    
    // Bare ground and rocky areas (treat as grassland)
    case 'bare':
    case 'rock':
    case 'rocky':
    case 'barren':
    case 'sand':
    case 'sandy':
    case 'gravel':
    case 'stone':
      return { vegetation: 'grassland', confidence: 0.6 };
    
    // Water bodies (treat as grassland with very low confidence)
    case 'water':
    case 'river':
    case 'lake':
    case 'pond':
    case 'wetland':
    case 'marsh':
    case 'swamp':
      return { vegetation: 'grassland', confidence: 0.2 };
    
    // Transportation infrastructure
    case 'road':
    case 'highway':
    case 'path':
    case 'track':
      return { vegetation: 'lightshrub', confidence: 0.4 };
    
    default:
      // Log unknown landcover classes for debugging
      logger.warn(`Unknown landcover class: "${landcoverClass}" - defaulting to lightshrub`);
      return { vegetation: 'lightshrub', confidence: 0.4 };
  }
};

/**
 * Fetch landcover data from Mapbox Tilequery API.
 * Returns the landcover class AND whether the value is estimated (mock
 * fallback) rather than real data, so downstream analysis can flag it —
 * fabricated data must never pass silently as analysis in a planning tool.
 */
const fetchLandcoverData = async (
  lat: number,
  lng: number,
  token: string
): Promise<{ cls: string; estimated: boolean }> => {
  // If no token or placeholder token, provide mock variation instead of throwing error
  if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
    return { cls: getMockLandcoverClass(lat, lng), estimated: true };
  }

  try {
    // Use Mapbox Tilequery API for point queries
    const lon = lng;
    const latQ = lat;
    const limit = 5;
    const radius = 50; // meters
    const tileset = 'mapbox.mapbox-terrain-v2';
    const url = `https://api.mapbox.com/v4/${tileset}/tilequery/${lon},${latQ}.json?layers=landcover&limit=${limit}&radius=${radius}&access_token=${token}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      logger.warn(`Mapbox tilequery HTTP ${resp.status}: ${resp.statusText} - falling back to mock data`);
      return { cls: getMockLandcoverClass(lat, lng), estimated: true };
    }

    const json = await resp.json();
    if (json && Array.isArray(json.features) && json.features.length > 0) {
      const feature = json.features[0];
      const props = feature.properties || {};
      const candidate = props.class || props.Class || props.landcover || props.type || props.label || props.cover || null;
      if (candidate) {
        logger.debug(`Mapbox returned landcover class: "${candidate}" for lat=${lat.toFixed(4)}, lng=${lng.toFixed(4)}`);
        return { cls: String(candidate), estimated: false };
      }
    }

    // If we get here, Mapbox returned no usable landcover class - use mock data
    logger.warn('Mapbox tilequery returned no landcover class for point - using mock data');
    return { cls: getMockLandcoverClass(lat, lng), estimated: true };
  } catch (err) {
    // Fall back to mock data instead of propagating errors
    logger.warn('Mapbox tilequery failed, using mock data:', err);
    return { cls: getMockLandcoverClass(lat, lng), estimated: true };
  }
};

/**
 * Generate realistic mock landcover classification for development/testing
 * Provides variation based on coordinates to simulate diverse vegetation
 */
const getMockLandcoverClass = (lat: number, lng: number): string => {
  // Create pseudo-random but deterministic variation based on coordinates
  const latSeed = Math.floor(Math.abs(lat * 10000)) % 1000;
  const lngSeed = Math.floor(Math.abs(lng * 10000)) % 1000;
  const combinedSeed = (latSeed + lngSeed * 37) % 1000;
  const variation = (combinedSeed * 23 + latSeed * 7 + lngSeed * 13) % 100;
  
  // Generate varied landcover based on coordinate-based pseudo-randomness
  if (variation < 20) {
    return 'grass';
  } else if (variation < 35) {
    return 'forest';
  } else if (variation < 50) {
    return 'scrub';
  } else if (variation < 65) {
    return 'crop';
  } else if (variation < 75) {
    return 'bare';
  } else if (variation < 85) {
    return 'urban';
  } else if (variation < 95) {
    return 'water';
  } else {
    return 'rock';
  }
};

/**
 * Run `fn` over `items` with at most `limit` promises in flight at once,
 * preserving input order in the result. Vegetation lookups are network-bound
 * and independent, so a bounded pool turns dozens of sequential awaits (the
 * dominant cost of a long line's analysis) into a handful of concurrent waves
 * without stampeding the upstream ArcGIS services.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * Calculate distance between two lat/lng points using Haversine formula
 * Returns distance in meters
 */
const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Generate points for vegetation sampling along a polyline
 * Uses similar interval approach as slope analysis (every 200m for vegetation)
 */
export const generateVegetationSamplePoints = (
  points: LatLngLike[], 
  intervalDistance: number = 200
): LatLngLike[] => {
  if (points.length < 2) return points;
  
  const samplePoints: LatLngLike[] = [];
  let accumulatedDistance = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const segmentDistance = calculateDistance(start.lat, getLng(start), end.lat, getLng(end));

    // Always include the first point
    if (i === 0) samplePoints.push(start);

    // Add sample points at intervals
    const remainingToNextInterval = intervalDistance - (accumulatedDistance % intervalDistance);
    
    if (segmentDistance >= remainingToNextInterval) {
      let distanceAlongSegment = remainingToNextInterval;
      while (distanceAlongSegment < segmentDistance) {
        const ratio = distanceAlongSegment / segmentDistance;
        const interpolatedLat = start.lat + (end.lat - start.lat) * ratio;
        const interpolatedLng = getLng(start) + (getLng(end) - getLng(start)) * ratio;
        const pt = { lat: interpolatedLat, lng: interpolatedLng };
        
        // Avoid duplicates
        const last = samplePoints[samplePoints.length - 1];
        if (!last || calculateDistance(last.lat, getLng(last), pt.lat, pt.lng) > 1) {
          samplePoints.push(pt);
        }
        
        distanceAlongSegment += intervalDistance;
      }
    }

    // Always include the end point
    const last = samplePoints[samplePoints.length - 1];
    const endPt = { lat: end.lat, lng: getLng(end) };
    if (!last || calculateDistance(last.lat, getLng(last), endPt.lat, endPt.lng) > 1) {
      samplePoints.push(endPt);
    }

    accumulatedDistance += segmentDistance;
  }

  return samplePoints;
};

/**
 * Analyze track for vegetation information using NSW vegetation service and Mapbox Terrain v2
 */
export const analyzeTrackVegetation = async (points: LatLngLike[]): Promise<VegetationAnalysis> => {
  if (points.length < 2) {
    return {
      totalDistance: 0,
      segments: [],
      predominantVegetation: 'grassland',
      vegetationDistribution: {
        grassland: 0,
        lightshrub: 0,
        mediumscrub: 0,
        heavyforest: 0
      },
      overallConfidence: 0
    };
  }

  const token = MAPBOX_TOKEN;

  // Generate sample points for vegetation analysis
  const samplePoints = generateVegetationSamplePoints(points, 200);

  // Build segments between consecutive sample points
  const rawSegments: VegetationSegment[] = [];
  let totalDistance = 0;
  let totalConfidence = 0;

  // Collect the segments worth sampling (skip zero-length) so their vegetation
  // lookups can run concurrently rather than one await at a time.
  interface SegSpec { start: LatLngLike; end: LatLngLike; distance: number; midLat: number; midLng: number; }
  const segSpecs: SegSpec[] = [];
  for (let i = 0; i < samplePoints.length - 1; i++) {
    const start = samplePoints[i];
    const end = samplePoints[i + 1];
    const distance = calculateDistance(start.lat, getLng(start), end.lat, getLng(end));
    if (distance <= 0.001) continue; // Skip zero-length segments
    segSpecs.push({
      start,
      end,
      distance,
      midLat: (start.lat + end.lat) / 2,
      midLng: (getLng(start) + getLng(end)) / 2,
    });
  }

  // Water-crossing check (mirrors Terrain Mobility's hydrology gate,
  // ROUTE_INTELLIGENCE.md §34): NVIS/Mapbox landcover both fall back to
  // mislabelling open water as low-confidence 'grassland', which would
  // otherwise let a line crossing a river or lake get costed as ordinary,
  // buildable ground. One corridor-wide fetch (not per-segment), checked at
  // each segment's start/mid/end so a narrow crossing within a 200 m
  // vegetation segment isn't missed by a single midpoint sample. Best-effort:
  // an unavailable water layer degrades to "no water detected" rather than
  // blocking vegetation analysis.
  let waterways: InfrastructureData = { trails: [], available: false };
  // Existing-trail check (docs/CALCULATION_REVIEW.md, 2026-07-28) — the SAME
  // reusable-trail set `routeOptimizer.ts` already fetches to prefer
  // trail-following routes during pathfinding, but that fact was previously
  // discarded before segments reached the API's cost model: a manually-drawn
  // line (or even the OPTIMIZED route the optimizer itself produced) along a
  // real formed track was costed identically to virgin bush of the same
  // vegetation class, with no indication anywhere in the final estimate that
  // ground was already broken. INFORMATIONAL ONLY, not an auto-discount —
  // there is no sourced existing-track-vs-virgin-clearing-rate factor to
  // apply (the same "do not invent a coefficient" reasoning already applied
  // to NAFI fire history/DEA fractional cover below), so this is surfaced as
  // a fact for the user to weigh, exactly like those two.
  let existingTrails: InfrastructureData = { trails: [], available: false };
  try {
    let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
    for (const p of points) {
      south = Math.min(south, p.lat); north = Math.max(north, p.lat);
      west = Math.min(west, getLng(p)); east = Math.max(east, getLng(p));
    }
    [waterways, existingTrails] = await Promise.all([
      fetchCorridorWaterways(south, west, north, east),
      fetchCorridorInfrastructure(south, west, north, east),
    ]);
  } catch (err) {
    logger.warn('Water-crossing / existing-trail check failed; proceeding without it:', err);
  }
  const crossesWaterAt = (spec: SegSpec): boolean => {
    if (waterways.trails.length === 0) return false;
    const pts = [
      { lat: spec.start.lat, lng: getLng(spec.start) },
      { lat: spec.midLat, lng: spec.midLng },
      { lat: spec.end.lat, lng: getLng(spec.end) },
    ];
    return pts.some((p) => distanceToNearestWater(p, waterways.trails, WATER_SNAP_M) <= WATER_SNAP_M);
  };
  const onExistingTrailAt = (spec: SegSpec): boolean => {
    if (existingTrails.trails.length === 0) return false;
    const pts = [
      { lat: spec.start.lat, lng: getLng(spec.start) },
      { lat: spec.midLat, lng: spec.midLng },
      { lat: spec.end.lat, lng: getLng(spec.end) },
    ];
    return pts.some((p) => distanceToNearestTrail(p, existingTrails.trails, TRAIL_SNAP_M) <= TRAIL_SNAP_M);
  };

  const resolveVegetation = async (spec: SegSpec, i: number) => {
    try {
      // Query state-based vegetation service (NSW, VIC, QLD, etc.) with NVIS fallback
      const stateVeg = await fetchStateVegetation(spec.midLat, spec.midLng);
      if (stateVeg) {
        return {
          estimated: false,
          vegetation: stateVeg.vegetationType,
          confidence: stateVeg.confidence,
          landcoverClass: stateVeg.displayLabel,
          displayLabel: stateVeg.displayLabel || 'Unknown vegetation',
          isModifiedOrLowFidelity: stateVeg.isModifiedOrLowFidelity,
        };
      }
      // Fall back to coarse landcover (may be mock — flagged as estimated)
      const landcover = await fetchLandcoverData(spec.midLat, spec.midLng, token || '');
      const mapped = mapLandcoverToVegetation(landcover.cls);
      return {
        estimated: landcover.estimated,
        vegetation: mapped.vegetation,
        confidence: landcover.estimated ? mapped.confidence * 0.5 : mapped.confidence,
        landcoverClass: landcover.cls,
        displayLabel: landcover.cls || 'Unknown vegetation',
      };
    } catch (segmentError) {
      // If an individual segment fails, use deterministic fallback vegetation.
      logger.warn(`Failed to get vegetation for segment ${i}, using fallback:`, segmentError);
      const fallbackClass = getMockLandcoverClass(spec.midLat, spec.midLng);
      const { vegetation, confidence } = mapLandcoverToVegetation(fallbackClass);
      return {
        estimated: true,
        vegetation,
        confidence: confidence * 0.5, // Reduce confidence for fallback data
        landcoverClass: fallbackClass + ' (fallback)',
        displayLabel: fallbackClass + ' (fallback)',
      };
    }
  };

  // Fire history (NAFI) is informational context, not a cost-model input:
  // there is no sourced fuel-age→clearing-rate curve to apply (the way the
  // NWCG/Report 56 tables ground the fuel-CLASS factors), so fabricating a
  // coefficient here would repeat exactly the "invented factor" problem
  // CALCULATION_REVIEW.md F3 replaced. Surfaced instead as a fact the user
  // can weigh themselves. `fetchNAFITimeSinceFire` short-circuits with no
  // network call outside NAFI's northern/rangeland technical extent (most of
  // NSW/VIC/southern SA), so this is a no-op there, not a wasted request.
  const resolveFireHistory = async (
    spec: SegSpec
  ): Promise<{ yearsSinceFire?: number; fireHistoryConfidence?: 'published' | 'estimated' }> => {
    try {
      const r = await fetchNAFITimeSinceFire(spec.midLat, spec.midLng);
      return r ? { yearsSinceFire: r.yearsSinceFire, fireHistoryConfidence: r.confidence } : {};
    } catch {
      return {};
    }
  };

  // Resolve every segment's vegetation (and, alongside it, fire history) with
  // bounded concurrency. State/NVIS lookups are cached and deduped, so this
  // only fans out real network work and keeps ordering stable for the merge
  // step below.
  const resolved = await mapWithConcurrency(segSpecs, 8, async (spec, i) => {
    const [veg, fire] = await Promise.all([resolveVegetation(spec, i), resolveFireHistory(spec)]);
    return { ...veg, ...fire };
  });

  for (let j = 0; j < segSpecs.length; j++) {
    const spec = segSpecs[j];
    const r = resolved[j];
    rawSegments.push({
      estimated: r.estimated,
      start: [spec.start.lat, getLng(spec.start)],
      end: [spec.end.lat, getLng(spec.end)],
      coords: [[spec.start.lat, getLng(spec.start)], [spec.end.lat, getLng(spec.end)]],
      vegetationType: r.vegetation,
      confidence: r.confidence,
      landcoverClass: r.landcoverClass,
      displayLabel: r.displayLabel,
      distance: spec.distance,
      isModifiedOrLowFidelity: r.isModifiedOrLowFidelity,
      isWater: crossesWaterAt(spec),
      onExistingTrail: onExistingTrailAt(spec),
      yearsSinceFire: r.yearsSinceFire,
      fireHistoryConfidence: r.fireHistoryConfidence,
    });
    totalDistance += spec.distance;
    totalConfidence += r.confidence;
  }

  // Merge consecutive segments with the same vegetation type — but never
  // across a water-crossing OR existing-trail boundary, so a narrow
  // river/lake crossing or a stretch that reuses a mapped track inside a
  // longer grassland run stays a distinct, separately-flagged segment rather
  // than disappearing into the merge.
  const mergedSegments: VegetationSegment[] = [];
  for (const seg of rawSegments) {
    const last = mergedSegments[mergedSegments.length - 1];
    if (!last || last.vegetationType !== seg.vegetationType || !!last.isWater !== !!seg.isWater
      || !!last.onExistingTrail !== !!seg.onExistingTrail) {
      mergedSegments.push({ ...seg, coords: seg.coords ? [...seg.coords] : [seg.start, seg.end] });
    } else {
      // Merge segments
      if (seg.coords) {
        const toAppend = seg.coords.slice(1); // Skip first point (duplicate)
        if (!last.coords) last.coords = [last.start, last.end];
        last.coords.push(...toAppend);
      }
      last.end = seg.end;

      // Weighted average of confidence
      const combinedDistance = last.distance + seg.distance;
      last.confidence = (last.confidence * last.distance + seg.confidence * seg.distance) / combinedDistance;
      last.distance = combinedDistance;
      if (seg.estimated) last.estimated = true;
      if (seg.isModifiedOrLowFidelity) last.isModifiedOrLowFidelity = true;
      // Keep the MOST RECENT fire (smallest years-since-fire) across the
      // merged run — the most fuel-hazard-notable fact, not an average.
      if (seg.yearsSinceFire !== undefined &&
          (last.yearsSinceFire === undefined || seg.yearsSinceFire < last.yearsSinceFire)) {
        last.yearsSinceFire = seg.yearsSinceFire;
        last.fireHistoryConfidence = seg.fireHistoryConfidence;
      }
    }
  }

  // Calculate vegetation distribution
  const vegetationDistribution = {
    grassland: 0,
    lightshrub: 0,
    mediumscrub: 0,
    heavyforest: 0
  };

  for (const segment of mergedSegments) {
    vegetationDistribution[segment.vegetationType] += segment.distance;
  }

  // Find predominant vegetation type
  let predominantVegetation: VegetationType = 'grassland';
  let maxDistance = 0;
  for (const [vegType, distance] of Object.entries(vegetationDistribution)) {
    if (distance > maxDistance) {
      maxDistance = distance;
      predominantVegetation = vegType as VegetationType;
    }
  }

  const overallConfidence = rawSegments.length > 0 ? totalConfidence / rawSegments.length : 0;
  const usedFallbackData = rawSegments.some(s => s.estimated);

  return {
    totalDistance,
    segments: mergedSegments,
    predominantVegetation,
    vegetationDistribution,
    overallConfidence,
    usedFallbackData
  };
};

/**
 * Interface for vegetation overlay data
 */
export interface VegetationOverlayPoint {
  lat: number;
  lng: number;
  vegetationType: VegetationType;
  confidence: number;
  landcoverClass: string;
}

/**
 * Generate vegetation overlay data for an area buffer around a line
 * Uses NSW vegetation service exclusively for authoritative data
 * Creates a grid of points within the specified buffer distance
 */
export const generateVegetationOverlay = async (
  points: LatLngLike[], 
  bufferDistanceKm: number = 1.0,
  gridSpacingM: number = 500
): Promise<VegetationOverlayPoint[]> => {
  if (points.length < 2) {
    return [];
  }

  const overlayPoints: VegetationOverlayPoint[] = [];

  // Calculate bounds of the line with buffer
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, getLng(point));
    maxLng = Math.max(maxLng, getLng(point));
  }

  // Add buffer (convert km to degrees approximately)
  const bufferDegrees = bufferDistanceKm / 111; // rough conversion
  minLat -= bufferDegrees;
  maxLat += bufferDegrees;
  minLng -= bufferDegrees;
  maxLng += bufferDegrees;

  // Generate grid points within the buffer
  const gridSpacingDegrees = gridSpacingM / 111000; // convert meters to degrees
  
  for (let lat = minLat; lat <= maxLat; lat += gridSpacingDegrees) {
    for (let lng = minLng; lng <= maxLng; lng += gridSpacingDegrees) {
      // Check if point is within buffer distance of the line
      const gridPoint = { lat, lng };
      let withinBuffer = false;
      
      for (let i = 0; i < points.length - 1; i++) {
        const lineStart = points[i];
        const lineEnd = points[i + 1];
        const distanceToLine = distanceToLineSegment(gridPoint, lineStart, lineEnd);
        
        if (distanceToLine <= bufferDistanceKm * 1000) { // convert km to meters
          withinBuffer = true;
          break;
        }
      }
      
      if (withinBuffer) {
        try {
          // Use state-based vegetation data (state service with NVIS fallback)
          const stateVeg = await fetchStateVegetation(lat, lng);

          if (stateVeg) {
            // Only include points where we have state vegetation data
            overlayPoints.push({
              lat,
              lng,
              vegetationType: stateVeg.vegetationType,
              confidence: stateVeg.confidence,
              landcoverClass: stateVeg.displayLabel
            });
          }
          // If no state data available, skip this point (don't show overlay)

        } catch (error) {
          logger.warn(`Failed to fetch vegetation data for point ${lat}, ${lng}:`, error);
        }
      }
    }
  }

  return overlayPoints;
};

/**
 * Calculate distance from a point to a line segment
 */
const distanceToLineSegment = (point: LatLngLike, lineStart: LatLngLike, lineEnd: LatLngLike): number => {
  const A = point.lat - lineStart.lat;
  const B = getLng(point) - getLng(lineStart);
  const C = lineEnd.lat - lineStart.lat;
  const D = getLng(lineEnd) - getLng(lineStart);

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    // Line segment is a point
    return calculateDistance(point.lat, getLng(point), lineStart.lat, getLng(lineStart));
  }
  
  let param = dot / lenSq;
  
  if (param < 0) {
    return calculateDistance(point.lat, getLng(point), lineStart.lat, getLng(lineStart));
  } else if (param > 1) {
    return calculateDistance(point.lat, getLng(point), lineEnd.lat, getLng(lineEnd));
  } else {
    const projectionLat = lineStart.lat + param * C;
    const projectionLng = getLng(lineStart) + param * D;
    return calculateDistance(point.lat, getLng(point), projectionLat, projectionLng);
  }
};