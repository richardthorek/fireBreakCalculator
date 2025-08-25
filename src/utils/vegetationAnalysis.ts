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
  if (!landcoverClass || typeof landcoverClass !== 'string') {
    return { vegetation: 'mediumscrub', confidence: 0.4 };
  }
  const lowerClass = landcoverClass.toLowerCase().trim();

  // Heuristic substring matching to handle varied labels returned by different sources
  if (lowerClass.includes('forest') || lowerClass.includes('wood') || lowerClass.includes('tree') || lowerClass.includes('woodland')) {
    return { vegetation: 'heavyforest', confidence: 0.9 };
  }

  if (lowerClass.includes('scrub') || lowerClass.includes('shrub') || lowerClass.includes('brush')) {
    return { vegetation: 'mediumscrub', confidence: 0.85 };
  }

  if (lowerClass.includes('grass') || lowerClass.includes('herb') || lowerClass.includes('tussock')) {
    return { vegetation: 'grassland', confidence: 0.9 };
  }

  // Treat crop/farmland/agriculture as grassland for this tool — crops behave more like grassland
  if (lowerClass.includes('crop') || lowerClass.includes('farmland') || lowerClass.includes('agri') || lowerClass.includes('cultiv')) {
    return { vegetation: 'grassland', confidence: 0.75 };
  }

  if (lowerClass.includes('wetland') || lowerClass.includes('marsh') || lowerClass.includes('bog')) {
    return { vegetation: 'mediumscrub', confidence: 0.6 };
  }

  if (lowerClass.includes('snow') || lowerClass.includes('ice') || lowerClass.includes('glacier')) {
    return { vegetation: 'grassland', confidence: 0.3 };
  }

  // Fallback to medium scrub with low confidence
  return { vegetation: 'mediumscrub', confidence: 0.4 };
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
  // If no token is available, use the mock generator and log for visibility
  if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
    console.info('Mapbox token not set - using mock landcover data for vegetation analysis');
    return getMockLandcover(lat, lng);
  }

  // Try Mapbox Tilequery API which is simpler to parse for point queries than raw MVT
  // Example endpoint: https://api.mapbox.com/v4/{tileset}/tilequery/{lon},{lat}.json?layers=landcover&limit=5&radius=50&access_token={token}
  try {
    const lon = lng;
    const latQ = lat;
    const limit = 5;
    const radius = 50; // meters
    const tileset = 'mapbox.mapbox-terrain-v2';
    const url = `https://api.mapbox.com/v4/${tileset}/tilequery/${lon},${latQ}.json?layers=landcover&limit=${limit}&radius=${radius}&access_token=${token}`;

    const resp = await fetch(url);
    if (resp.ok) {
      const json = await resp.json();
      if (json && Array.isArray(json.features) && json.features.length > 0) {
        // Try to find a sensible property for landcover class
        const feature = json.features[0];
        const props = feature.properties || {};
        const candidate = props.class || props.Class || props.landcover || props.type || props.label || props.cover || null;
        if (candidate) return String(candidate);
      }
    } else {
      console.warn(`Mapbox tilequery returned ${resp.status} ${resp.statusText}`);
    }
  } catch (err) {
    console.warn('Error querying Mapbox tilequery for landcover:', err);
  }

  // Fallback to mock if we couldn't obtain a definitive landcover value
  console.info('Falling back to mock landcover data for vegetation analysis');
  return getMockLandcover(lat, lng);
};

/**
 * Mock landcover classification for development/testing
 * Provides realistic variation based on coordinates
 */
const getMockLandcover = (lat: number, lng: number): string => {
  // Create variation based on lat/lng to simulate different landcover types
  const latVar = Math.abs(lat) % 1;
  const lngVar = Math.abs(lng) % 1;
  const combined = (latVar + lngVar) % 1;
  
  if (combined < 0.2) return 'grass';
  else if (combined < 0.4) return 'scrub';
  else if (combined < 0.6) return 'wood';
  else if (combined < 0.8) return 'crop';
  else return 'grass';
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
  intervalDistance: number = 100
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
  
  // Generate sample points for vegetation analysis (100m spacing gives denser sampling)
  const samplePoints = generateVegetationSamplePoints(points, 100);

  // Build segments between consecutive sample points and collect midpoints for batching
  const rawSegments: VegetationSegment[] = [];
  let totalDistance = 0;
  let totalConfidence = 0;

  const midpoints: { lat: number; lng: number }[] = [];
  const segmentPairs: { start: LatLng; end: LatLng; distance: number }[] = [];

  for (let i = 0; i < samplePoints.length - 1; i++) {
    const start = samplePoints[i];
    const end = samplePoints[i + 1];
    const distance = calculateDistance(start.lat, start.lng, end.lat, end.lng);
    if (distance <= 0.001) continue;
    const midLat = (start.lat + end.lat) / 2;
    const midLng = (start.lng + end.lng) / 2;
    midpoints.push({ lat: midLat, lng: midLng });
    segmentPairs.push({ start, end, distance });
  }

  // Fetch landcover classes in batch (one tilequery per tile) when token exists,
  // otherwise fall back to per-point fetch which will use mock data.
  let landcoverClasses: string[] = [];
  if (token && token !== 'YOUR_MAPBOX_TOKEN_HERE') {
    landcoverClasses = await batchFetchLandcoverForSamples(midpoints, token);
    // If the batch returned a uniform class across all midpoints (often a sign
    // of poor tile coverage or fallback to mock), try a per-point query as a
    // more-granular fallback to improve accuracy.
    if (landcoverClasses.length > 1 && landcoverClasses.every(v => v === landcoverClasses[0])) {
      console.info('Batch tilequery returned uniform landcover classes, falling back to per-point queries for better accuracy');
      const lcPromises = midpoints.map(p => fetchLandcoverData(p.lat, p.lng, token || ''));
      landcoverClasses = await Promise.all(lcPromises);
    }
  } else {
    // Token missing: use single point fetch (which internally falls back to mock)
    const lcPromises = midpoints.map(p => fetchLandcoverData(p.lat, p.lng, token || ''));
    landcoverClasses = await Promise.all(lcPromises);
  }

  // Now construct raw segments using the fetched landcover classes
  for (let i = 0; i < segmentPairs.length; i++) {
    const { start, end, distance } = segmentPairs[i];
    const mid = midpoints[i];
    const landcoverClass = landcoverClasses[i] || getMockLandcover(mid.lat, mid.lng);
    const { vegetation, confidence } = mapLandcoverToVegetation(landcoverClass);

    // Debug visibility: log sample midpoint, raw landcover, and mapped vegetation
    console.debug('Veg sample', { midLat: mid.lat, midLng: mid.lng, landcoverClass, mappedVegetation: vegetation, confidence });

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

/**
 * Batch landcover fetch for multiple sample points by grouping points into
 * WebMercator tiles and making a single tilequery per tile. This reduces
 * API requests dramatically compared to one request per sample point.
 *
 * Strategy:
 * - Map each sample point to a tile (zoom 14 by default)
 * - For each tile, call tilequery once at the tile center with a radius that
 *   covers the tile
 * - Match returned features to each sample point by choosing the nearest
 *   feature centroid
 */
const batchFetchLandcoverForSamples = async (points: { lat: number; lng: number }[], token: string, zoom = 14): Promise<string[]> => {
  if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
    // No token: return mock values per point for visibility
    return points.map(p => getMockLandcover(p.lat, p.lng));
  }

  // Group points by tile
  const tileMap = new Map<string, { idxs: number[]; pts: { lat: number; lng: number }[]; x: number; y: number; z: number }>();
  points.forEach((p, i) => {
    const { x, y, z } = latLngToTile(p.lat, p.lng, zoom);
    const key = `${z}/${x}/${y}`;
    const existing = tileMap.get(key);
    if (existing) {
      existing.idxs.push(i);
      existing.pts.push(p);
    } else {
      tileMap.set(key, { idxs: [i], pts: [p], x, y, z });
    }
  });

  const results: string[] = new Array(points.length).fill('');

  // Helper: compute center lon/lat of a tile
  const tileCenterLonLat = (x: number, y: number, z: number) => {
    const n = Math.pow(2, z);
    const lon = (x + 0.5) / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n)));
    const lat = latRad * 180 / Math.PI;
    return { lon, lat };
  };

  // Process each tile with one tilequery
  const tilePromises = Array.from(tileMap.entries()).map(async ([key, info]) => {
    const { x, y, z, idxs, pts } = info;
    const { lon: centerLon, lat: centerLat } = tileCenterLonLat(x, y, z);

    // Approximate tile physical size (meters) at the tile center
    const n = Math.pow(2, z);
    const lonDeg = 360 / n;
    const latRad = centerLat * Math.PI / 180;
    const metersPerDegLon = 111320 * Math.cos(latRad);
    const metersPerDegLat = 110574; // approximate
    const tileWidthMeters = Math.abs(lonDeg * metersPerDegLon);
    const tileHeightMeters = Math.abs((360 / n) * (Math.PI / 180) * 6378137); // coarse fallback
    // Use diagonal half as radius to ensure coverage
    const radius = Math.ceil(Math.sqrt(tileWidthMeters * tileWidthMeters + tileHeightMeters * tileHeightMeters) / 2) + 50;

    const tileset = 'mapbox.mapbox-terrain-v2';
    const limit = 50;
    const url = `https://api.mapbox.com/v4/${tileset}/tilequery/${centerLon},${centerLat}.json?layers=landcover&limit=${limit}&radius=${radius}&access_token=${token}`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`Tilequery for ${key} failed: ${resp.status} ${resp.statusText}`);
        // fallback: fill those indices with mock
        idxs.forEach(i => { results[i] = getMockLandcover(pts[idxs.indexOf(i)].lat, pts[idxs.indexOf(i)].lng); });
        return;
      }

      const json = await resp.json();
      const features = (json && Array.isArray(json.features)) ? json.features : [];

      // Precompute centroids for features
      const featureCentroids = features.map((f: any) => {
        const geom = f.geometry || {};
        let cx = null as number | null;
        let cy = null as number | null;
        if (!geom || !geom.coordinates) return { props: f.properties || {}, cx: null, cy: null };
        const coords = geom.coordinates;
        const type = geom.type;
        try {
          if (type === 'Point') {
            cx = coords[1]; cy = coords[0]; // bug: GeoJSON is [lon,lat] -> so cy=lon? we'll correctly map below
            // We'll normalize below
          } else if (type === 'MultiPoint' || type === 'LineString') {
            // coords: [ [lon,lat], ... ]
            let sumLat = 0, sumLon = 0, count = 0;
            for (const c of coords) { sumLon += c[0]; sumLat += c[1]; count++; }
            cx = sumLat / count; cy = sumLon / count;
          } else if (type === 'Polygon') {
            // Take first ring
            const ring = coords[0] || [];
            let sumLat = 0, sumLon = 0, count = 0;
            for (const c of ring) { sumLon += c[0]; sumLat += c[1]; count++; }
            if (count > 0) { cx = sumLat / count; cy = sumLon / count; }
          }
        } catch (e) {
          // ignore geometry parsing issues
        }
        return { props: f.properties || {}, cx, cy };
      });

      // Assign nearest feature's landcover class to each point in tile
      idxs.forEach((sampleIdx, localIdx) => {
        const p = pts[localIdx];
        let chosen = null as string | null;
        let minDist = Number.POSITIVE_INFINITY;
        for (const f of featureCentroids) {
          if (f.cx == null || f.cy == null) continue;
          // note: f.cx stored as lat, f.cy as lon from above normalization
          const d = calculateDistance(p.lat, p.lng, f.cx as number, f.cy as number);
          if (d < minDist) { minDist = d; chosen = f.props?.class || f.props?.Class || f.props?.landcover || f.props?.type || f.props?.label || f.props?.cover || null; }
        }
        if (chosen) results[sampleIdx] = String(chosen);
        else results[sampleIdx] = getMockLandcover(p.lat, p.lng);
      });
    } catch (err) {
      console.warn('Error in tilequery batch fetch:', err);
      idxs.forEach((sampleIdx, localIdx) => {
        const p = pts[localIdx];
        results[sampleIdx] = getMockLandcover(p.lat, p.lng);
      });
    }
  });

  await Promise.all(tilePromises);

  return results;
};