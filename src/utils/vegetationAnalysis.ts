/**
 * Vegetation analysis utilities using Mapbox Terrain v2 vector tiles
 * Automatically extracts landcover data to determine vegetation type/density
 */

import { LatLng } from 'leaflet';
import { VegetationType } from '../config/classification';
import { VegetationSegment, VegetationAnalysis } from '../types/config';
import { MAPBOX_TOKEN } from '../config/mapboxToken';

/**
 * Map Mapbox Terrain v2 landcover class to application vegetation type
 */
export const mapLandcoverToVegetation = (landcoverClass: string): { vegetation: VegetationType; confidence: number } => {
  const lowerClass = landcoverClass.toLowerCase();
  
  switch (lowerClass) {
    case 'wood':
    case 'forest':
      return { vegetation: 'heavyforest', confidence: 0.9 };
    
    case 'scrub':
    case 'shrub':
      return { vegetation: 'mediumscrub', confidence: 0.85 };
    
    case 'grass':
    case 'grassland':
      return { vegetation: 'grassland', confidence: 0.9 };
    
    case 'crop':
    case 'farmland':
    case 'agriculture':
      return { vegetation: 'lightshrub', confidence: 0.7 };
    
    case 'snow':
    case 'ice':
      // Snow/ice areas default to grassland with low confidence
      return { vegetation: 'grassland', confidence: 0.3 };
    
    default:
      // Unknown landcover defaults to medium scrub with low confidence
      return { vegetation: 'mediumscrub', confidence: 0.4 };
  }
};

/**
 * Convert lat/lon to tile coordinates for Mapbox vector tiles
 */
const latLngToTile = (lat: number, lng: number, zoom: number) => {
  const latRad = lat * Math.PI / 180;
  const n = Math.pow(2, zoom);
  const x = Math.floor(n * (lng + 180) / 360);
  const y = Math.floor(n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2);
  return { x, y, z: zoom };
};

/**
 * Fetch landcover data from Mapbox Terrain v2 vector tiles
 */
const fetchLandcoverData = async (lat: number, lng: number, token: string): Promise<string> => {
  // Require a real Mapbox token; do not fall back to mock data
  if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
    throw new Error('Mapbox token is required for vegetation analysis; set MAPBOX_TOKEN');
  }

  try {
    // Use Mapbox Tilequery API for point queries (simpler than parsing MVT)
    // Example: https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/{lon},{lat}.json?layers=landcover&limit=5&radius=50&access_token={token}
    const lon = lng;
    const latQ = lat;
    const limit = 5;
    const radius = 50; // meters
    const tileset = 'mapbox.mapbox-terrain-v2';
    const url = `https://api.mapbox.com/v4/${tileset}/tilequery/${lon},${latQ}.json?layers=landcover&limit=${limit}&radius=${radius}&access_token=${token}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Mapbox tilequery HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();
    if (json && Array.isArray(json.features) && json.features.length > 0) {
      const feature = json.features[0];
      const props = feature.properties || {};
      const candidate = props.class || props.Class || props.landcover || props.type || props.label || props.cover || null;
      if (candidate) return String(candidate);
    }

    // If we get here, Mapbox returned no usable landcover class
    throw new Error('Mapbox tilequery returned no landcover class for point');
  } catch (err) {
    // Propagate errors to caller; do not silently substitute mock values
    throw err;
  }
};

/**
 * Mock landcover classification for development/testing
 * Provides realistic variation based on coordinates
 */
// Note: mock landcover removed — real Mapbox data is required

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
  points: LatLng[], 
  intervalDistance: number = 200
): LatLng[] => {
  if (points.length < 2) return points;
  
  const samplePoints: LatLng[] = [];
  let accumulatedDistance = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const segmentDistance = calculateDistance(start.lat, start.lng, end.lat, end.lng);

    // Always include the first point
    if (i === 0) samplePoints.push(start);

    // Add sample points at intervals
    const remainingToNextInterval = intervalDistance - (accumulatedDistance % intervalDistance);
    
    if (segmentDistance >= remainingToNextInterval) {
      let distanceAlongSegment = remainingToNextInterval;
      while (distanceAlongSegment < segmentDistance) {
        const ratio = distanceAlongSegment / segmentDistance;
        const interpolatedLat = start.lat + (end.lat - start.lat) * ratio;
        const interpolatedLng = start.lng + (end.lng - start.lng) * ratio;
        const pt = new LatLng(interpolatedLat, interpolatedLng);
        
        // Avoid duplicates
        const last = samplePoints[samplePoints.length - 1];
        if (!last || last.distanceTo(pt) > 0.001) {
          samplePoints.push(pt);
        }
        
        distanceAlongSegment += intervalDistance;
      }
    }

    // Always include the end point
    const last = samplePoints[samplePoints.length - 1];
    const endPt = new LatLng(end.lat, end.lng);
    if (!last || last.distanceTo(endPt) > 0.001) {
      samplePoints.push(endPt);
    }

    accumulatedDistance += segmentDistance;
  }

  return samplePoints;
};

/**
 * Analyze track for vegetation information using Mapbox Terrain v2
 */
export const analyzeTrackVegetation = async (points: LatLng[]): Promise<VegetationAnalysis> => {
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

  for (let i = 0; i < samplePoints.length - 1; i++) {
    const start = samplePoints[i];
    const end = samplePoints[i + 1];
    
    const distance = calculateDistance(start.lat, start.lng, end.lat, end.lng);
    if (distance <= 0.001) continue; // Skip zero-length segments
    
    // Sample landcover at the midpoint of the segment
    const midLat = (start.lat + end.lat) / 2;
    const midLng = (start.lng + end.lng) / 2;
    
    const landcoverClass = await fetchLandcoverData(midLat, midLng, token || '');
    const { vegetation, confidence } = mapLandcoverToVegetation(landcoverClass);
    
    rawSegments.push({
      start: [start.lat, start.lng],
      end: [end.lat, end.lng],
      coords: [[start.lat, start.lng], [end.lat, end.lng]],
      vegetationType: vegetation,
      confidence,
      landcoverClass,
      distance
    });
    
    totalDistance += distance;
    totalConfidence += confidence;
  }

  // Merge consecutive segments with the same vegetation type
  const mergedSegments: VegetationSegment[] = [];
  for (const seg of rawSegments) {
    const last = mergedSegments[mergedSegments.length - 1];
    if (!last || last.vegetationType !== seg.vegetationType) {
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

  return {
    totalDistance,
    segments: mergedSegments,
    predominantVegetation,
    vegetationDistribution,
    overallConfidence
  };
};