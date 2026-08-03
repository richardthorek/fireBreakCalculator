/**
 * Slope calculation utilities for fire break analysis
 * Calculates slope along track segments with elevation data
 */

import { SlopeSegment, SlopeCategory, TrackAnalysis } from '../types/config';
import { classifySlope, slopeCategoryColor, calculateDistance, calculateSlope } from '@firebreak/terrain';
import { MAPBOX_TOKEN } from '../config/mapboxToken';
import { fetchElevationProfile } from './elevationApi';

// calculateDistance and calculateSlope are pure (no network/browser deps) and
// live in shared/terrain/src/geo.ts so terrain/mobility mode's algorithms
// (also pure) can use the same code — see shared/terrain/README.md.
export { calculateDistance, calculateSlope };

// Coordinate type compatibility for both Leaflet and Mapbox GL JS — a
// fire-break-mode-only compatibility shim (terrain/mobility mode's pure
// algorithms all use the canonical `LatLng {lat,lng}` shape already), so it
// stays local rather than moving to the shared package.
type LatLngLike = { lat: number; lng: number } | { lat: number; lon: number };

const normalizeCoord = (coord: LatLngLike): { lat: number; lng: number } => {
  if ('lng' in coord) {
    return { lat: coord.lat, lng: coord.lng };
  }
  return { lat: coord.lat, lng: (coord as { lat: number; lon: number }).lon };
};

/** Convert degrees to radians */
const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

/**
 * Categorize slope based on angle in degrees
 */
export const categorizeSlope = (slope: number): SlopeCategory => classifySlope(slope) as SlopeCategory;

/**
 * Get color for slope visualization
 */
export const getSlopeColor = (category: SlopeCategory): string => slopeCategoryColor(category);

/**
 * Mock elevation service for development/testing fallback.
 * Every use is counted so analyses can flag that estimated (not real) terrain
 * data contributed to the result — fabricated data must never pass silently
 * as analysis in a planning tool.
 */
let mockElevationUseCount = 0;

const getMockElevation = async (lat: number, lng: number): Promise<number> => {
  mockElevationUseCount++;
  const baseElevation = 100;
  const latVariation = Math.sin(lat * 0.07) * 120; // exaggerate to test slope categories
  const lngVariation = Math.cos(lng * 0.05) * 80;
  return Math.max(0, baseElevation + latVariation + lngVariation);
};

// --- Mapbox Terrain-RGB Elevation Sampling ---------------------------------

interface TileCacheEntry { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; }
const terrainTileCache: Record<string, TileCacheEntry> = {};

/** Convert lat/lon to XYZ tile indices and pixel coordinates within the tile */
const latLngToTilePixel = (lat: number, lon: number, z: number, tileSize = 256) => {
  const latRad = toRadians(lat);
  const n = Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  const xInt = Math.floor(x);
  const yInt = Math.floor(y);
  const pixelX = Math.floor((x - xInt) * tileSize);
  const pixelY = Math.floor((y - yInt) * tileSize);
  return { x: xInt, y: yInt, pixelX, pixelY };
};

/** Decode elevation (meters) from Terrain-RGB pixel */
const decodeTerrainRGB = (r: number, g: number, b: number): number => {
  // Mapbox formula: -10000 + (R * 256 * 256 + G * 256 + B) * 0.1
  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
};

/** Fetch and cache a Terrain-RGB tile, returning a canvas + ctx for pixel access */
const fetchTerrainTile = (z: number, x: number, y: number, token: string, tileSize = 256): Promise<TileCacheEntry> => {
  const key = `${z}/${x}/${y}`;
  if (terrainTileCache[key]) return Promise.resolve(terrainTileCache[key]);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // Using v4 terrain-rgb tileset
    img.src = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}${tileSize === 512 ? '@2x' : ''}.pngraw?access_token=${token}`;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = tileSize;
        canvas.height = tileSize;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return reject(new Error('Canvas 2D context unavailable'));
        ctx.drawImage(img, 0, 0);
        const entry = { canvas, ctx };
        terrainTileCache[key] = entry;
        resolve(entry);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load terrain tile'));
  });
};

/** Get elevation using Mapbox Terrain-RGB; fallback to mock if failure */
const getElevationMapbox = async (lat: number, lng: number, options?: { zoom?: number }): Promise<number> => {
  const token = MAPBOX_TOKEN;
  if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
    return getMockElevation(lat, lng);
  }
  const zoom = options?.zoom ?? 13; // Balance detail vs tile count
  try {
    const tileSize = 256; // 256 standard size
    const { x, y, pixelX, pixelY } = latLngToTilePixel(lat, lng, zoom, tileSize);
    const tile = await fetchTerrainTile(zoom, x, y, token, tileSize);
    const data = tile.ctx.getImageData(pixelX, pixelY, 1, 1).data;
    return decodeTerrainRGB(data[0], data[1], data[2]);
  } catch (e) {
    // Fallback if network error
    return getMockElevation(lat, lng);
  }
};

/** Public elevation accessor used by slope analysis */
const getElevation = async (lat: number, lng: number): Promise<number> => {
  return getElevationMapbox(lat, lng);
};

// Per-analysis cache of authoritative DEM elevations keyed to ~1 m precision.
// Populated by a single batch call to the backend elevation-profile endpoint;
// when a point is present here we use the DEM value instead of Terrain-RGB.
const elevationKey = (lat: number, lng: number): string => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/**
 * Resolve elevation for a point, preferring an authoritative DEM value from the
 * supplied batch cache and falling back to Mapbox Terrain-RGB (then mock).
 */
const resolveElevation = async (
  lat: number,
  lng: number,
  demCache: Map<string, number> | null
): Promise<number> => {
  if (demCache) {
    const v = demCache.get(elevationKey(lat, lng));
    if (v !== undefined && !Number.isNaN(v)) return v;
  }
  return getElevationMapbox(lat, lng, { zoom: DEFAULT_TERRAIN_ZOOM });
};

/**
 * Batch elevation sampler for arbitrary point sets (e.g. the route optimizer's
 * corridor grid). Prefers a single authoritative DEM request; falls back to
 * Terrain-RGB tiles (then mock) per point. `estimated` is true when any value
 * did not come from real elevation data, so callers can flag results honestly.
 */
export const sampleElevationsBatch = async (
  points: { lat: number; lng: number }[]
): Promise<{ elevations: number[]; estimated: boolean }> => {
  if (points.length === 0) return { elevations: [], estimated: false };
  const mockCountAtStart = mockElevationUseCount;
  const profile = await fetchElevationProfile(points);
  if (profile) {
    return { elevations: profile.elevations, estimated: profile.estimated };
  }
  const elevations = await Promise.all(
    points.map(p => getElevationMapbox(p.lat, p.lng, { zoom: DEFAULT_TERRAIN_ZOOM }))
  );
  return { elevations, estimated: mockElevationUseCount > mockCountAtStart };
};

/** Deterministically generate the elevation sample points for a mini-segment. */
const computeProfilePoints = (
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  distance: number
): { lat: number; lng: number }[] => {
  const numSamples = Math.max(1, Math.ceil(distance / DEFAULT_SAMPLE_METERS));
  const pts: { lat: number; lng: number }[] = [];
  for (let s = 0; s <= numSamples; s++) {
    const t = s / numSamples;
    pts.push({ lat: start.lat + (end.lat - start.lat) * t, lng: start.lng + (end.lng - start.lng) * t });
  }
  return pts;
};

// Configuration: sampling distance along track and terrain zoom used for high-detail sampling
const DEFAULT_SAMPLE_METERS = 10; // sample every 10m along the track for detailed profiles
const DEFAULT_TERRAIN_ZOOM = 15; // higher zoom gives ~4-8m/pixel depending on latitude

// --- Cross-slope (side-slope) sampling -------------------------------------
// The along-line slope above answers "how steep is the ground in the
// direction of travel". A line can be gentle in that direction while running
// along a hillside contour — the SIDEHILL gradient, perpendicular to travel,
// is the figure NWCG guidance and CALCULATION_REVIEW.md (F2) cite as the real
// dozer-rollover constraint (~45% sidehill vs ~55% straight uphill: two
// different limits). Nothing in this module measured that until now.

/** Initial bearing from a to b, degrees (0=N, 90=E), standard great-circle formula. */
const bearingDegrees = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const phi1 = toRadians(a.lat), phi2 = toRadians(b.lat);
  const dLambda = toRadians(b.lng - a.lng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
};

/** Destination point given a start, bearing (degrees) and distance (metres). */
const destinationPoint = (
  start: { lat: number; lng: number }, bearingDeg: number, distanceM: number
): { lat: number; lng: number } => {
  const R = 6371000;
  const delta = distanceM / R;
  const theta = toRadians(bearingDeg);
  const phi1 = toRadians(start.lat), lambda1 = toRadians(start.lng);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(
    Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
    Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
  );
  return { lat: phi2 * (180 / Math.PI), lng: lambda2 * (180 / Math.PI) };
};

// Offset either side of the line for the cross-slope probe. Wide enough to
// sit above DEM/Terrain-RGB pixel noise (~4-8 m/pixel at the zoom this module
// uses — see F4 in CALCULATION_REVIEW.md on along-slope's own noise
// sensitivity), narrow enough to still describe the hillside right at the
// drawn line rather than an unrelated slope further away.
const CROSS_SLOPE_OFFSET_M = 15;

/** One perpendicular probe: a left/right point pair straddling `at`, offset
 *  from the line's bearing through `from`→`to`. */
interface CrossSlopeProbe { at: { lat: number; lng: number }; left: { lat: number; lng: number }; right: { lat: number; lng: number }; }

const buildCrossSlopeProbes = (
  start: { lat: number; lng: number }, end: { lat: number; lng: number }
): CrossSlopeProbe[] => {
  const brg = bearingDegrees(start, end);
  const mid = { lat: (start.lat + end.lat) / 2, lng: (start.lng + end.lng) / 2 };
  // Probe at start, mid and end of the mini-segment — the max of the three
  // becomes the segment's representative cross-slope (same "flag the hazard,
  // don't average it away" convention as maxSubSlope for along-line slope).
  return [start, mid, end].map((at) => ({
    at,
    left: destinationPoint(at, brg - 90, CROSS_SLOPE_OFFSET_M),
    right: destinationPoint(at, brg + 90, CROSS_SLOPE_OFFSET_M),
  }));
};

/**
 * Generate points every 100m along a polyline (default). Interval can be overridden.
 */
export const generateInterpolatedPoints = (
  points: LatLngLike[], 
  intervalDistance: number = 100
): LatLngLike[] => {
  if (points.length < 2) return points;
  const interpolatedPoints: LatLngLike[] = [];
  let accumulatedDistance = 0;

  // Ensure we always include every user-provided point, and also add
  // interpolated points at regular intervals between them. This avoids
  // "cutting corners" by omitting user drop points.
  for (let i = 0; i < points.length - 1; i++) {
    const start = normalizeCoord(points[i]);
    const end = normalizeCoord(points[i + 1]);
    const segmentDistance = calculateDistance(start.lat, start.lng, end.lat, end.lng);

    // If this is the first point, include it
    if (i === 0) interpolatedPoints.push(start);

    // Determine distance from the last global interval to the next interval
    const remainingToNextInterval = intervalDistance - (accumulatedDistance % intervalDistance);

    if (segmentDistance >= remainingToNextInterval) {
      let distanceAlongSegment = remainingToNextInterval;
      while (distanceAlongSegment < segmentDistance) {
        const ratio = distanceAlongSegment / segmentDistance;
        const interpolatedLat = start.lat + (end.lat - start.lat) * ratio;
        const interpolatedLng = start.lng + (end.lng - start.lng) * ratio;
        const pt = { lat: interpolatedLat, lng: interpolatedLng };
        // Avoid duplicates if an interpolated point coincides with the last added
        const lastPoint = interpolatedPoints[interpolatedPoints.length - 1];
        if (!lastPoint || calculateDistance(normalizeCoord(lastPoint).lat, normalizeCoord(lastPoint).lng, pt.lat, pt.lng) > 0.001) {
          interpolatedPoints.push(pt);
        }
        distanceAlongSegment += intervalDistance;
      }
    }

    // Always include the original end point of this segment (user-dropped)
    const last = interpolatedPoints[interpolatedPoints.length - 1];
    const endPt = { lat: end.lat, lng: end.lng };
    if (!last || calculateDistance(normalizeCoord(last).lat, normalizeCoord(last).lng, endPt.lat, endPt.lng) > 0.001) {
      interpolatedPoints.push(endPt);
    }

    accumulatedDistance += segmentDistance;
  }

  return interpolatedPoints;
};

/**
 * Analyze track for slope information
 */
export const analyzeTrackSlopes = async (points: LatLngLike[]): Promise<TrackAnalysis> => {
  if (points.length < 2) {
    return {
      totalDistance: 0,
      segments: [],
      maxSlope: 0,
      averageSlope: 0,
      slopeDistribution: { flat: 0, medium: 0, steep: 0, very_steep: 0 }
    };
  }

  // Track whether any elevation sample fell back to the mock service during
  // THIS analysis, so the result can be flagged as estimated.
  const mockCountAtStart = mockElevationUseCount;
  
  // Generate points every 100m (these will include original user points)
  const interpolatedPoints = generateInterpolatedPoints(points, 100);

  // Precompute each mini-segment and its detailed elevation sample points so we
  // can request all elevations in ONE backend call instead of hundreds of tile
  // fetches. Sampling is deterministic (computeProfilePoints), so keys line up.
  const segmentPlan: {
    start: { lat: number; lng: number }; end: { lat: number; lng: number }; distance: number;
    profilePoints: { lat: number; lng: number }[]; crossSlopeProbes: CrossSlopeProbe[];
  }[] = [];
  for (let i = 0; i < interpolatedPoints.length - 1; i++) {
    const start = normalizeCoord(interpolatedPoints[i]);
    const end = normalizeCoord(interpolatedPoints[i + 1]);
    const distance = calculateDistance(start.lat, start.lng, end.lat, end.lng);
    if (distance <= 0.001) continue;
    segmentPlan.push({
      start, end, distance,
      profilePoints: computeProfilePoints(start, end, distance),
      crossSlopeProbes: buildCrossSlopeProbes(start, end),
    });
  }

  // One batch request to the authoritative DEM (if configured/available) —
  // the cross-slope left/right probe points ride along in the SAME request,
  // not a second network round trip.
  let demCache: Map<string, number> | null = null;
  const crossSlopePoints = segmentPlan.flatMap(s => s.crossSlopeProbes.flatMap(p => [p.left, p.right]));
  const allPoints = [...segmentPlan.flatMap(s => s.profilePoints), ...crossSlopePoints];
  if (allPoints.length > 0) {
    const profile = await fetchElevationProfile(allPoints);
    if (profile) {
      demCache = new Map<string, number>();
      allPoints.forEach((p, idx) => {
        const e = profile.elevations[idx];
        if (typeof e === 'number' && !Number.isNaN(e)) demCache!.set(elevationKey(p.lat, p.lng), e);
      });
    }
  }

  // Build raw mini-segments between consecutive interpolated points, then merge contiguous with same category
  const rawSegments: SlopeSegment[] = [];
  let totalDistance = 0;
  let slopeDistanceSum = 0; // for weighted average
  let maxSlope = 0;
  let maxCrossSlope = 0;
  // Fine-grained elevation profile (chainage → elevation/local slope) kept for
  // the elevation-profile chart; sampled from the same ~10 m points as slopes.
  const elevationProfile: { distanceM: number; elevation: number; slope: number }[] = [];

  for (const plan of segmentPlan) {
    const { start, end, distance, profilePoints, crossSlopeProbes } = plan;

    // Resolve elevations: authoritative DEM batch value if present, else Terrain-RGB.
    const elevs = await Promise.all(
      profilePoints.map(p => resolveElevation(p.lat, p.lng, demCache))
    );

    // Compute sub-step slopes and aggregate
    let maxSubSlope = 0;
    let weightedSlopeSum = 0;
    let totalSubDist = 0;
    for (let k = 0; k < profilePoints.length - 1; k++) {
      const a = normalizeCoord(profilePoints[k]);
      const b = normalizeCoord(profilePoints[k + 1]);
      const subDist = calculateDistance(a.lat, a.lng, b.lat, b.lng);
      const subSlope = calculateSlope(elevs[k], elevs[k + 1], subDist);
      if (subSlope > maxSubSlope) maxSubSlope = subSlope;
      weightedSlopeSum += subSlope * subDist;
      totalSubDist += subDist;
      if (elevationProfile.length === 0) {
        elevationProfile.push({ distanceM: totalDistance, elevation: elevs[0], slope: subSlope });
      }
      elevationProfile.push({
        distanceM: totalDistance + Math.min(totalSubDist, distance),
        elevation: elevs[k + 1],
        slope: subSlope
      });
    }

    // Cross-slope: resolve the left/right probe pairs (same DEM/Terrain-RGB
    // resolution path as the along-line points — already batched above) and
    // take the steepest of the three probes as this mini-segment's
    // representative side-slope, same "flag the hazard" convention as
    // maxSubSlope above.
    let segCrossSlope = 0;
    for (const probe of crossSlopeProbes) {
      const [elevLeft, elevRight] = await Promise.all([
        resolveElevation(probe.left.lat, probe.left.lng, demCache),
        resolveElevation(probe.right.lat, probe.right.lng, demCache),
      ]);
      const cs = calculateSlope(elevLeft, elevRight, CROSS_SLOPE_OFFSET_M * 2);
      if (cs > segCrossSlope) segCrossSlope = cs;
    }

    // Use maxSubSlope to detect steep gullies; use weighted average as segment slope
    const slope = totalSubDist > 0 ? (weightedSlopeSum / totalSubDist) : 0;
    const category = categorizeSlope(maxSubSlope); // categorize by max local slope to flag hazards

    rawSegments.push({
      start: [start.lat, start.lng],
      end: [end.lat, end.lng],
      coords: profilePoints.map(p => {
        const norm = normalizeCoord(p);
        return [norm.lat, norm.lng];
      }),
      slope,
      category,
      startElevation: elevs[0],
      endElevation: elevs[elevs.length - 1],
      distance,
      crossSlopeDeg: segCrossSlope,
    });

    totalDistance += distance;
    slopeDistanceSum += slope * distance;
    if (slope > maxSlope) maxSlope = slope;
    if (segCrossSlope > maxCrossSlope) maxCrossSlope = segCrossSlope;
  }

  // Merge consecutive segments that share the same category to avoid many small pieces
  const mergedSegments: SlopeSegment[] = [];
  for (const seg of rawSegments) {
    const last = mergedSegments[mergedSegments.length - 1];
    if (!last || last.category !== seg.category) {
      mergedSegments.push({ ...seg, coords: seg.coords ? [...seg.coords] : [seg.start, seg.end] });
    } else {
      // merge - append coordinates excluding duplicate of last end
      if (seg.coords) {
        const toAppend = seg.coords.slice(1); // skip first (already present as last.end)
        if (!last.coords) last.coords = [last.start, last.end];
        last.coords.push(...toAppend);
      }
      last.end = seg.end;
      last.endElevation = seg.endElevation;
      const combinedDistance = last.distance + seg.distance;
      last.slope = (last.slope * last.distance + seg.slope * seg.distance) / combinedDistance;
      last.distance = combinedDistance;
      // Cross-slope is a hazard figure like maxSubSlope above — take the max
      // across the merged run, not a distance-weighted average, so a short
      // sidehill stretch inside a longer easy run isn't diluted away.
      if ((seg.crossSlopeDeg ?? 0) > (last.crossSlopeDeg ?? 0)) last.crossSlopeDeg = seg.crossSlopeDeg;
    }
  }

  // Build slope distribution as distances per category (meters)
  const slopeDistribution = { flat: 0, medium: 0, steep: 0, very_steep: 0 } as Record<SlopeCategory, number> & { very_steep: number };
  for (const s of mergedSegments) slopeDistribution[s.category] += s.distance;

  // Downsample the profile to a bounded size so long routes stay cheap to render.
  const MAX_PROFILE_POINTS = 600;
  let profileOut = elevationProfile;
  if (elevationProfile.length > MAX_PROFILE_POINTS) {
    const step = elevationProfile.length / MAX_PROFILE_POINTS;
    profileOut = [];
    for (let i = 0; i < MAX_PROFILE_POINTS; i++) {
      profileOut.push(elevationProfile[Math.floor(i * step)]);
    }
    profileOut.push(elevationProfile[elevationProfile.length - 1]);
  }

  return {
    totalDistance,
    segments: mergedSegments,
    maxSlope,
    maxCrossSlope,
    averageSlope: totalDistance > 0 ? slopeDistanceSum / totalDistance : 0,
    slopeDistribution,
    elevationProfile: profileOut,
    usedMockElevation: mockElevationUseCount > mockCountAtStart
  };
};