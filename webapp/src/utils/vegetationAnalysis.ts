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

  for (let i = 0; i < samplePoints.length - 1; i++) {
    const start = samplePoints[i];
    const end = samplePoints[i + 1];
    
    const distance = calculateDistance(start.lat, getLng(start), end.lat, getLng(end));
    if (distance <= 0.001) continue; // Skip zero-length segments
    
    // Sample landcover at the midpoint of the segment
    const midLat = (start.lat + end.lat) / 2;
    const midLng = (getLng(start) + getLng(end)) / 2;
    
    try {
      // Query state-based vegetation service (NSW, VIC, QLD, etc.) with NVIS fallback
      const stateVeg = await fetchStateVegetation(midLat, midLng);
      let vegetation: VegetationType;
      let confidence: number;
      let landcoverClass: string;
      let estimated = false;

      if (stateVeg) {
        // State service or NVIS returned data
        vegetation = stateVeg.vegetationType;
        confidence = stateVeg.confidence;
        landcoverClass = stateVeg.displayLabel;
      } else {
        // Fall back to coarse landcover (may be mock — flagged as estimated)
        const landcover = await fetchLandcoverData(midLat, midLng, token || '');
        landcoverClass = landcover.cls;
        estimated = landcover.estimated;
        const mapped = mapLandcoverToVegetation(landcover.cls);
        vegetation = mapped.vegetation;
        confidence = estimated ? mapped.confidence * 0.5 : mapped.confidence;
      }

      rawSegments.push({
        estimated,
        start: [start.lat, getLng(start)],
        end: [end.lat, getLng(end)],
        coords: [[start.lat, getLng(start)], [end.lat, getLng(end)]],
        vegetationType: vegetation,
        confidence,
        landcoverClass,
        // Display label from state service or landcover class
        displayLabel: stateVeg?.displayLabel || landcoverClass || 'Unknown vegetation',
        distance
      });
      
      totalDistance += distance;
      totalConfidence += confidence;
    } catch (segmentError) {
      // If individual segment fails, use fallback vegetation based on position
      logger.warn(`Failed to get vegetation for segment ${i}, using fallback:`, segmentError);
      const fallbackClass = getMockLandcoverClass(midLat, midLng);
      const { vegetation, confidence } = mapLandcoverToVegetation(fallbackClass);

      rawSegments.push({
        estimated: true,
        start: [start.lat, getLng(start)],
        end: [end.lat, getLng(end)],
        coords: [[start.lat, getLng(start)], [end.lat, getLng(end)]],
        vegetationType: vegetation,
        confidence: confidence * 0.5, // Reduce confidence for fallback data
        landcoverClass: fallbackClass + ' (fallback)',
        distance
      });
      
      totalDistance += distance;
      totalConfidence += confidence * 0.5;
    }
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
      if (seg.estimated) last.estimated = true;
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