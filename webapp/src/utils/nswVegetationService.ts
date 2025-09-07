/**
 * NSW Vegetation (Plant Community Type) service integration.
 * Queries the ArcGIS Feature Layer (layer 3) from the NSW Government service
 * to obtain a higher fidelity vegetation formation / class for a point.
 *
 * Service root:
 * https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer
 * Feature layer (PCT polygons + labels): id=3
 * We query attributes: vegForm, vegClass, PCTName
 */

import { logger } from './logger';
import { mapFormationToVegetationType, _clearVegetationMappingCache } from './vegetationMappingHelper';
import { VegetationType } from '../config/classification';

const ARC_GIS_BASE = 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer';
const FEATURE_LAYER_ID = 3;

// Approx NSW bounding box (lon/lat) to short‑circuit queries outside coverage.
// (Not exact; generous padding.)
const NSW_BBOX = { minLat: -38.5, maxLat: -27.5, minLng: 140.0, maxLng: 154.5 };

interface NSWVegResultRaw {
  vegetationType: 'grassland' | 'lightshrub' | 'mediumscrub' | 'heavyforest';
  confidence: number;
  source: string;           // debug info (e.g. vegClass / vegForm used)
  vegClass?: string | null;
  vegForm?: string | null;
  pctName?: string | null;
}

/** Simple in‑memory cache keyed by ~100m grid to reduce duplicate network hits */
const cache: Record<string, NSWVegResultRaw | null> = {};

/** Determine if a point is plausibly within NSW extent we care about */
const inNSW = (lat: number, lng: number): boolean => {
  return lat >= NSW_BBOX.minLat && lat <= NSW_BBOX.maxLat && lng >= NSW_BBOX.minLng && lng <= NSW_BBOX.maxLng;
};

/** Map NSW vegetation attributes to internal 4-class taxonomy */
export function mapNSWToInternal(vegClass?: string | null, vegForm?: string | null, pctName?: string | null): NSWVegResultRaw | null {
  // Prefer the vegetation formation (vegForm) for grouping/roll-up
  const base = (vegForm || vegClass || pctName || '').toLowerCase();
  if (!base) return null;

  // Broad heuristic grouping – can be refined over time.
  // Order matters (first matching rule wins) - more specific rules should come first
  const tests: Array<{ re: RegExp; type: NSWVegResultRaw['vegetationType']; confidence: number } > = [
    // Alpine formations - prioritize over other patterns, but be more specific to avoid capturing forest types
    { re: /(alpine\s+(heath|grassland|herbfield|shrubland)|montane\s+(grass|herbfield))/, type: 'grassland', confidence: 0.8 },
    // Rainforests, sclerophyll forests, wet forested types -> heavy
    { re: /(rainforest|wet\s+sclerophyll|dry\s+sclerophyll|sclerophyll\s+forest|forest|wet\s+sclerophyll|wet\s+sclerophyll\s+forest|forested|montane\s+wet\s+sclerophyll)/, type: 'heavyforest', confidence: 0.95 },
    // Woodlands and grassy woodlands considered lighter than closed forest but often treated as heavy for machine constraints
    { re: /(grassy\s+woodland|woodland|semi-arid\s+woodlands|woodland\b|woodlands)/, type: 'heavyforest', confidence: 0.9 },
    // Grasslands and grassy formations -> grassland
    { re: /(grassland|grassy|meadow|temperate\s+montane\s+grass|maritime|riverine\s+plain\s+grasslands|floodplain)/, type: 'grassland', confidence: 0.9 },
    // Wetlands, marshes, swamps, saline wetlands -> light (lower fuel / wet areas)
    { re: /(saltmarsh|wetland|fen|swamp|sedgeland|rushland|freshwater|saline|mangrove|coastal\s+swamp|lagoon)/, type: 'lightshrub', confidence: 0.75 },
    // Heaths, shrublands, mallee, chenopod, arid shrublands -> medium scrub
    { re: /(heath|heathland|shrubland|shrub|scrub|mallee|chenopod|acacia|arid\s+shrub|semi-arid)/, type: 'mediumscrub', confidence: 0.85 },
    // Catch remaining alpine/montane types that weren't caught by more specific patterns above
    { re: /(alpine|montane)/, type: 'grassland', confidence: 0.7 },
  ];

  for (const t of tests) {
    if (t.re.test(base)) {
      return { vegetationType: t.type, confidence: t.confidence, source: base, vegClass, vegForm, pctName };
    }
  }

  // Fallback heuristic based on remaining hints
  // Final fallbacks
  if (/forest|wood/i.test(base)) {
    return { vegetationType: 'heavyforest', confidence: 0.7, source: base, vegClass, vegForm, pctName };
  }
  if (/heath|shrub|scrub/i.test(base)) {
    return { vegetationType: 'mediumscrub', confidence: 0.6, source: base, vegClass, vegForm, pctName };
  }
  if (/grass|herb|montane/i.test(base)) {
    return { vegetationType: 'grassland', confidence: 0.7, source: base, vegClass, vegForm, pctName };
  }

  // Treat explicit unclassified/unknown as grassland/agricultural per request
  if (/(not\s+classif|not\s+classified|unclass|unknown|unclassified)/i.test(base)) {
    return { vegetationType: 'grassland', confidence: 0.6, source: base, vegClass, vegForm, pctName };
  }

  return { vegetationType: 'lightshrub', confidence: 0.5, source: base, vegClass, vegForm, pctName };
}

/**
 * Query the NSW ArcGIS Feature Layer for vegetation attributes at a point.
 * Returns null if outside NSW or if the service yields no match / error.
 * 
 * Uses dynamic vegetation mappings from the database if available, with hardcoded
 * mappings as fallback.
 */
export async function fetchNSWVegetation(lat: number, lng: number): Promise<NSWVegResultRaw | null> {
  if (!inNSW(lat, lng)) return null; // Skip network outside region

  // Cache key rounded to ~100m (approx 0.001 deg latitude)
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (key in cache) return cache[key];

  const url = `${ARC_GIS_BASE}/${FEATURE_LAYER_ID}/query` +
    `?f=json&geometry=${encodeURIComponent(lng + ',' + lat)}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=vegClass,vegForm,PCTName&returnGeometry=false&outSR=4326` +
    `&maxAllowableOffset=5`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      logger.warn('NSW vegetation query HTTP', resp.status, resp.statusText);
      cache[key] = null; return null;
    }
    const json = await resp.json();
    const feat = json?.features?.[0];
    if (!feat || !feat.attributes) { cache[key] = null; return null; }
    const { vegClass, vegForm, PCTName } = feat.attributes as Record<string, string | null>;
    
    let vegetationType: VegetationType;
    let confidence: number;
    let source: string;
    
    // First try to use the dynamic vegetation mapping
    try {
      // Use the hierarchical mapping system: formation > class > type (PCT)
      const formationName = vegForm || '';
      const className = vegClass || undefined;
      const typeName = PCTName || undefined; // We can use PCT name as the type name
      
      const result = await mapFormationToVegetationType(formationName, className, typeName);
      vegetationType = result.vegetation;
      confidence = result.confidence;
      source = `Dynamic mapping: ${formationName}${className ? ` > ${className}` : ''}${typeName ? ` > ${typeName}` : ''}`;
      logger.debug(`Dynamic vegetation mapping used: ${source} -> ${vegetationType}`);
    } catch (error) {
      // Fall back to hardcoded mapping if dynamic mapping fails
      logger.warn('Dynamic vegetation mapping failed, falling back to hardcoded mapping', error);
      const fallbackResult = mapNSWToInternal(vegClass, vegForm, PCTName);
      if (!fallbackResult) { 
        cache[key] = null; 
        return null; 
      }
      vegetationType = fallbackResult.vegetationType;
      confidence = fallbackResult.confidence;
      source = fallbackResult.source;
    }
    
    const result: NSWVegResultRaw = {
      vegetationType,
      confidence,
      source,
      vegClass,
      vegForm,
      pctName: PCTName
    };
    
    cache[key] = result;
    return result;
  } catch (e) {
    logger.warn('NSW vegetation query failed', e);
    cache[key] = null; return null;
  }
}

/** 
 * For diagnostics - clears both NSW vegetation cache and vegetation mapping cache 
 */
export function _clearNSWCache() { 
  // Clear NSW vegetation cache
  Object.keys(cache).forEach(k => delete cache[k]); 
  // Clear vegetation mapping cache (static import used to avoid mixed dynamic/static imports)
  try {
    _clearVegetationMappingCache();
  } catch (err) {
    logger.warn('Failed to clear vegetation mapping cache via static import', err);
  }
}

export type NSWVegetationResult = NSWVegResultRaw;
