/**
 * Vegetation analysis utilities using Mapbox Terrain v2 vector tiles
 * Automatically extracts landcover data to determine vegetation type/density
 */

import { LatLng } from 'leaflet';
import { VegetationType } from '../config/classification';
import { VegetationSegment, VegetationAnalysis } from '../types/config';
import { MAPBOX_TOKEN } from '../config/mapboxToken';
import { fetchNSWVegetation } from './nswVegetationService';
import { logger } from './logger';

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
      return { vegetation: 'heavyforest', confidence: 0.9 };
    
    // Scrub and shrubland
    case 'scrub':
    case 'shrub':
    case 'shrubland':
    case 'bush':
    case 'bushland':
      return { vegetation: 'mediumscrub', confidence: 0.85 };
    
    // Grassland and open areas
    case 'grass':
    case 'grassland':
    case 'meadow':
    case 'pasture':
    case 'field':
      return { vegetation: 'grassland', confidence: 0.9 };
    
    // Agricultural and cultivated areas
    case 'crop':
    case 'farmland':
    case 'agriculture':
    case 'cultivated':
    case 'farm':
      return { vegetation: 'lightshrub', confidence: 0.7 };
    
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
      logger.warn(`Unknown landcover class: "${landcoverClass}" - defaulting to mediumscrub`);
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
const fetchLandcoverData = async (lat: number, lng: number, token: string): Promise<string> => {
  // If no token or placeholder token, provide mock variation instead of throwing error
  if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
    return getMockLandcoverClass(lat, lng);
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
      logger.warn(`Mapbox tilequery HTTP ${resp.status}: ${resp.statusText} - falling back to mock data`);
      return getMockLandcoverClass(lat, lng);
    }

    const json = await resp.json();
    if (json && Array.isArray(json.features) && json.features.length > 0) {
      const feature = json.features[0];
      const props = feature.properties || {};
      const candidate = props.class || props.Class || props.landcover || props.type || props.label || props.cover || null;
      if (candidate) {
        logger.debug(`Mapbox returned landcover class: "${candidate}" for lat=${lat.toFixed(4)}, lng=${lng.toFixed(4)}`);
        return String(candidate);
      }
    }

    // If we get here, Mapbox returned no usable landcover class - use mock data
    logger.warn('Mapbox tilequery returned no landcover class for point - using mock data');
    return getMockLandcoverClass(lat, lng);
  } catch (err) {
    // Fall back to mock data instead of propagating errors
    logger.warn('Mapbox tilequery failed, using mock data:', err);
    return getMockLandcoverClass(lat, lng);
  }
};

/**
 * Generate realistic mock landcover classification for development/testing
 * Provides variation based on coordinates to simulate diverse vegetation
 */
const getMockLandcoverClass = (lat: number, lng: number): string => {
  // Create pseudo-random but deterministic variation based on coordinates
  // Use a different approach to ensure more variation
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
    
    try {
      // 1. Try high‑fidelity NSW government vegetation layer first (if in region)
      const nswVeg = await fetchNSWVegetation(midLat, midLng);
      let vegetation: VegetationType; let confidence: number; let landcoverClass: string;
      if (nswVeg) {
        vegetation = nswVeg.vegetationType as VegetationType;
        // Blend original heuristic confidence with a base high trust for authoritative dataset
        confidence = Math.min(1, nswVeg.confidence + 0.1);
        landcoverClass = nswVeg.source || '(nsw)';
      } else {
        // 2. Fallback to Mapbox Landcover query (existing logic)
        const mapboxClass = await fetchLandcoverData(midLat, midLng, token || '');
        landcoverClass = mapboxClass;
        const mapped = mapLandcoverToVegetation(mapboxClass);
        vegetation = mapped.vegetation;
        confidence = mapped.confidence;
      }
      
      rawSegments.push({
        start: [start.lat, start.lng],
        end: [end.lat, end.lng],
        coords: [[start.lat, start.lng], [end.lat, end.lng]],
        vegetationType: vegetation,
        confidence,
        landcoverClass,
        // If NSW authoritative data was used, include its raw fields for display/rollup
        nswVegClass: nswVeg?.vegClass ?? null,
        nswVegForm: nswVeg?.vegForm ?? null,
        nswPCTName: nswVeg?.pctName ?? null,
        // Preferred display label: prefer formation (vegForm) -> PCTName -> vegClass -> mapbox class
        displayLabel: (nswVeg?.vegForm || nswVeg?.pctName || nswVeg?.vegClass || landcoverClass || '').toString(),
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
        start: [start.lat, start.lng],
        end: [end.lat, end.lng],
        coords: [[start.lat, start.lng], [end.lat, end.lng]],
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
 * Creates a grid of points within the specified buffer distance
 */
export const generateVegetationOverlay = async (
  points: LatLng[], 
  bufferDistanceKm: number = 1.0,
  gridSpacingM: number = 500
): Promise<VegetationOverlayPoint[]> => {
  if (points.length < 2) {
    return [];
  }

  const token = MAPBOX_TOKEN;
  const overlayPoints: VegetationOverlayPoint[] = [];

  // Calculate bounds of the line with buffer
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
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
      const gridPoint = new LatLng(lat, lng);
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
          // First try NSW vegetation data
          const nswVeg = await fetchNSWVegetation(lat, lng);
          let vegetation: VegetationType;
          let confidence: number;
          let landcoverClass: string;
          
          if (nswVeg) {
            vegetation = nswVeg.vegetationType as VegetationType;
            confidence = Math.min(1, nswVeg.confidence + 0.1);
            landcoverClass = nswVeg.source || '(nsw)';
          } else {
            // Fallback to Mapbox data
            landcoverClass = await fetchLandcoverData(lat, lng, token || '');
            const mapped = mapLandcoverToVegetation(landcoverClass);
            vegetation = mapped.vegetation;
            confidence = mapped.confidence;
          }
          
          overlayPoints.push({
            lat,
            lng,
            vegetationType: vegetation,
            confidence,
            landcoverClass
          });
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
const distanceToLineSegment = (point: LatLng, lineStart: LatLng, lineEnd: LatLng): number => {
  const A = point.lat - lineStart.lat;
  const B = point.lng - lineStart.lng;
  const C = lineEnd.lat - lineStart.lat;
  const D = lineEnd.lng - lineStart.lng;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    // Line segment is a point
    return point.distanceTo(lineStart);
  }
  
  let param = dot / lenSq;
  
  if (param < 0) {
    return point.distanceTo(lineStart);
  } else if (param > 1) {
    return point.distanceTo(lineEnd);
  } else {
    const projection = new LatLng(
      lineStart.lat + param * C,
      lineStart.lng + param * D
    );
    return point.distanceTo(projection);
  }
};