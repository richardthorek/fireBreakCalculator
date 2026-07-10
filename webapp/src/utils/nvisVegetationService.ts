/**
 * National vegetation via NVIS (National Vegetation Information System).
 *
 * The NSW SVTM PCT layer is high-fidelity but NSW-only. Outside NSW the app
 * previously fell back to coarse global landcover and ultimately to a
 * pseudo-random mock — i.e. fabricated vegetation. This module adds the
 * Australia-wide DCCEEW NVIS Major Vegetation Groups service as an
 * AUTHORITATIVE national fallback so most of the continent gets a real fuel
 * class instead of a guess.
 *
 * Service (DCCEEW): NVIS Extant Major Vegetation Groups (MapServer, layer 0).
 * Overridable via VITE_NVIS_MVG_URL for resilience if the endpoint moves.
 */

import { logger } from './logger';
import { VegetationType } from '../config/classification';

const NVIS_MVG_URL =
  (import.meta.env.VITE_NVIS_MVG_URL as string | undefined) ||
  'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer';

const NVIS_LAYER_ID = 0;

// Rough continental bounding box for Australia to short-circuit needless queries.
const AUS_BBOX = { minLat: -44.0, maxLat: -9.0, minLng: 112.0, maxLng: 154.5 };

export interface NVISResult {
  vegetationType: VegetationType;
  confidence: number;
  /** The Major Vegetation Group name returned by NVIS (for display/debug). */
  mvgName: string;
  source: 'nvis';
}

const cache: Record<string, NVISResult | null> = {};

const inAustralia = (lat: number, lng: number): boolean =>
  lat >= AUS_BBOX.minLat && lat <= AUS_BBOX.maxLat && lng >= AUS_BBOX.minLng && lng <= AUS_BBOX.maxLng;

/**
 * Map an NVIS Major Vegetation Group name to the app's 4-class fuel taxonomy.
 * Ordered rules; first match wins. Confidence reflects how cleanly the group
 * maps to a fireline-relevant fuel structure.
 */
export function mapMVGToVegetation(name: string): { vegetation: VegetationType; confidence: number } {
  const n = (name || '').toLowerCase();
  if (!n) return { vegetation: 'lightshrub', confidence: 0.3 };

  const rules: Array<{ re: RegExp; vegetation: VegetationType; confidence: number }> = [
    // Closed/tall forests and dense paperbark/cypress → heavy
    { re: /rainforest|vine thicket|closed forest|tall open forest|open forest|melaleuca|callitris/, vegetation: 'heavyforest', confidence: 0.9 },
    // Grasslands / herblands / sedgelands → grassland
    { re: /tussock grass|hummock grass|grassland|herbland|sedgeland|rushland|wetland/, vegetation: 'grassland', confidence: 0.85 },
    // Mallee, heath, acacia/casuarina/eucalypt woodlands, shrublands → medium scrub
    { re: /mallee|heath|acacia (forest|woodland|shrub)|casuarina|eucalypt (woodland|open woodland)|other shrubland|low closed forest/, vegetation: 'mediumscrub', confidence: 0.8 },
    // Sparse chenopod/samphire/saltbush, mangroves → light
    { re: /chenopod|samphire|saltbush|mangrove|sparse/, vegetation: 'lightshrub', confidence: 0.7 },
    // Cleared / non-native / bare / water → treat as grassland-equivalent low fuel
    { re: /cleared|non-native|regrowth|naturally bare|salt lake|lake|sea|water|unknown|no data/, vegetation: 'grassland', confidence: 0.5 },
  ];
  for (const r of rules) {
    if (r.re.test(n)) return { vegetation: r.vegetation, confidence: r.confidence };
  }
  // Generic hints as a last resort before defaulting.
  if (/forest|wood/.test(n)) return { vegetation: 'heavyforest', confidence: 0.65 };
  if (/shrub|scrub/.test(n)) return { vegetation: 'mediumscrub', confidence: 0.6 };
  if (/grass|herb/.test(n)) return { vegetation: 'grassland', confidence: 0.65 };
  return { vegetation: 'mediumscrub', confidence: 0.4 };
}

/**
 * Pick the Major Vegetation Group name out of an ArcGIS attribute bag without
 * assuming the exact field name (NVIS releases vary: MVG_NAME, MVGROUP, etc.).
 */
export function extractMVGName(attributes: Record<string, unknown>): string | null {
  if (!attributes) return null;
  const keys = Object.keys(attributes);
  // Prefer a field whose name references the MVG/vegetation group.
  const preferred = keys.find((k) => /mvg.*name|mvg_?group|major.*veg|nvisdsc1|mvg$/i.test(k));
  const candidateKey =
    preferred ||
    keys.find((k) => /veg.*(group|name|class|desc)/i.test(k)) ||
    keys.find((k) => typeof attributes[k] === 'string' && (attributes[k] as string).length > 3);
  if (!candidateKey) return null;
  const val = attributes[candidateKey];
  return typeof val === 'string' ? val : val != null ? String(val) : null;
}

/** Query NVIS for the Major Vegetation Group at a point. Null outside AUS / on failure. */
export async function fetchNVISVegetation(lat: number, lng: number): Promise<NVISResult | null> {
  if (!inAustralia(lat, lng)) return null;

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (key in cache) return cache[key];

  const url =
    `${NVIS_MVG_URL}/${NVIS_LAYER_ID}/query` +
    `?f=json&geometry=${encodeURIComponent(lng + ',' + lat)}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=*&returnGeometry=false`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      logger.warn('NVIS query HTTP', resp.status, resp.statusText);
      cache[key] = null;
      return null;
    }
    const json = await resp.json();
    const feat = json?.features?.[0];
    if (!feat || !feat.attributes) {
      cache[key] = null;
      return null;
    }
    const mvgName = extractMVGName(feat.attributes);
    if (!mvgName) {
      cache[key] = null;
      return null;
    }
    const mapped = mapMVGToVegetation(mvgName);
    const result: NVISResult = {
      vegetationType: mapped.vegetation,
      confidence: mapped.confidence,
      mvgName,
      source: 'nvis',
    };
    cache[key] = result;
    return result;
  } catch (e) {
    logger.warn('NVIS query failed', e);
    cache[key] = null;
    return null;
  }
}

export function _clearNVISCache() {
  Object.keys(cache).forEach((k) => delete cache[k]);
}
