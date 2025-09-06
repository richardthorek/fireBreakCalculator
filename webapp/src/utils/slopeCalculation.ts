/**
 * Slope calculation utilities for fire break analysis
 * Calculates slope along track segments with elevation data
 */

import { SlopeSegment, SlopeCategory, TrackAnalysis } from '../types/config';
import { classifySlope, slopeCategoryColor } from '../config/classification';
import { MAPBOX_TOKEN } from '../config/mapboxToken';

// Coordinate type compatibility for both Leaflet and Mapbox GL JS
type LatLngLike = { lat: number; lng: number } | { lat: number; lon: number };

// Helper to normalize coordinates
const normalizeCoord = (coord: LatLngLike): { lat: number; lng: number } => {
  if ('lng' in coord) {
    return { lat: coord.lat, lng: coord.lng };
  }
  return { lat: coord.lat, lng: (coord as any).lon };
};

/**
 * Calculate total distance of a polyline
 * Accepts array of coordinate objects
 */
export function calculateDistance(points: LatLngLike[]): number;
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number;
export function calculateDistance(pointsOrLat: LatLngLike[] | number, lng1?: number, lat2?: number, lng2?: number): number {
  // Handle array of points
  if (Array.isArray(pointsOrLat)) {
    let totalDistance = 0;
    for (let i = 0; i < pointsOrLat.length - 1; i++) {
      const start = normalizeCoord(pointsOrLat[i]);
      const end = normalizeCoord(pointsOrLat[i + 1]);
      totalDistance += calculateDistanceBetweenPoints(start.lat, start.lng, end.lat, end.lng);
    }
    return totalDistance;
  }
  
  // Handle individual coordinates
  return calculateDistanceBetweenPoints(pointsOrLat, lng1!, lat2!, lng2!);
}

/**
 * Calculate distance between two lat/lng points using Haversine formula
 * Returns distance in meters
 */
const calculateDistanceBetweenPoints = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/** Convert degrees to radians */
const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

/**
 * Calculate slope between two points in degrees
 */
export const calculateSlope = (
  startElevation: number, 
  endElevation: number, 
  horizontalDistance: number
): number => {
  if (horizontalDistance === 0) return 0;
  const verticalDistance = Math.abs(endElevation - startElevation);
  const slopeRadians = Math.atan(verticalDistance / horizontalDistance);
  return slopeRadians * (180 / Math.PI); // Convert to degrees
};

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
 */
const getMockElevation = async (lat: number, lng: number): Promise<number> => {
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
        const ctx = canvas.getContext('2d');
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

// Configuration: sampling distance along track and terrain zoom used for high-detail sampling
const DEFAULT_SAMPLE_METERS = 10; // sample every 10m along the track for detailed profiles
const DEFAULT_TERRAIN_ZOOM = 15; // higher zoom gives ~4-8m/pixel depending on latitude

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
    const segmentDistance = calculateDistanceBetweenPoints(start.lat, start.lng, end.lat, end.lng);

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
        if (!lastPoint || calculateDistanceBetweenPoints(normalizeCoord(lastPoint).lat, normalizeCoord(lastPoint).lng, pt.lat, pt.lng) > 0.001) {
          interpolatedPoints.push(pt);
        }
        distanceAlongSegment += intervalDistance;
      }
    }

    // Always include the original end point of this segment (user-dropped)
    const last = interpolatedPoints[interpolatedPoints.length - 1];
    const endPt = { lat: end.lat, lng: end.lng };
    if (!last || calculateDistanceBetweenPoints(normalizeCoord(last).lat, normalizeCoord(last).lng, endPt.lat, endPt.lng) > 0.001) {
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
  
  // Generate points every 100m (these will include original user points)
  const interpolatedPoints = generateInterpolatedPoints(points, 100);

  // Build raw mini-segments between consecutive interpolated points, then merge contiguous with same category
  const rawSegments: SlopeSegment[] = [];
  let totalDistance = 0;
  let slopeDistanceSum = 0; // for weighted average
  let maxSlope = 0;

  for (let i = 0; i < interpolatedPoints.length - 1; i++) {
    const start = normalizeCoord(interpolatedPoints[i]);
    const end = normalizeCoord(interpolatedPoints[i + 1]);

    const distance = calculateDistanceBetweenPoints(start.lat, start.lng, end.lat, end.lng);
    // Skip zero-length segments
    if (distance <= 0.001) continue;

    // Detailed profile sampling: sample along the segment at DEFAULT_SAMPLE_METERS
    // and use Mapbox Terrain-RGB at a higher zoom to capture narrow gullies/peaks.
    const sampleMeters = DEFAULT_SAMPLE_METERS;
    const numSamples = Math.max(1, Math.ceil(distance / sampleMeters));
    const profilePoints: LatLngLike[] = [];
    for (let s = 0; s <= numSamples; s++) {
      const t = s / numSamples;
      const lat = start.lat + (end.lat - start.lat) * t;
      const lng = start.lng + (end.lng - start.lng) * t;
      profilePoints.push({ lat, lng });
    }

    // Fetch elevations for profile points (use higher terrain zoom for detail)
    const elevPromises = profilePoints.map(p => {
      const norm = normalizeCoord(p);
      return getElevationMapbox(norm.lat, norm.lng, { zoom: DEFAULT_TERRAIN_ZOOM });
    });
    const elevs = await Promise.all(elevPromises);

    // Compute sub-step slopes and aggregate
    let maxSubSlope = 0;
    let weightedSlopeSum = 0;
    let totalSubDist = 0;
    for (let k = 0; k < profilePoints.length - 1; k++) {
      const a = normalizeCoord(profilePoints[k]);
      const b = normalizeCoord(profilePoints[k + 1]);
      const subDist = calculateDistanceBetweenPoints(a.lat, a.lng, b.lat, b.lng);
      const subSlope = calculateSlope(elevs[k], elevs[k + 1], subDist);
      if (subSlope > maxSubSlope) maxSubSlope = subSlope;
      weightedSlopeSum += subSlope * subDist;
      totalSubDist += subDist;
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
      distance
    });

    totalDistance += distance;
    slopeDistanceSum += slope * distance;
    if (slope > maxSlope) maxSlope = slope;
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
    }
  }

  // Build slope distribution as distances per category (meters)
  const slopeDistribution = { flat: 0, medium: 0, steep: 0, very_steep: 0 } as Record<SlopeCategory, number> & { very_steep: number };
  for (const s of mergedSegments) slopeDistribution[s.category] += s.distance;

  return {
    totalDistance,
    segments: mergedSegments,
    maxSlope,
    averageSlope: totalDistance > 0 ? slopeDistanceSum / totalDistance : 0,
    slopeDistribution
  };
};