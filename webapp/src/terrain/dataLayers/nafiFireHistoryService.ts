/**
 * NAFI (North Australia & Rangelands Fire Information) time-since-fire —
 * docs/ROUTE_INTELLIGENCE.md §10.3(c), §11.7, §10.7 M3c. Docs name this "the
 * single most valuable [Tier-1] layer for the real theatre": time-since-fire
 * combined with vegetation type is a far better understorey-density predictor
 * than vegetation type alone, and it directly resolves both failure cases
 * §10.1 identifies (the widely-spaced woodland that behaves as grassland, and
 * the regrowth thicket that reads as open).
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS ACTUALLY VERIFIED THIS SESSION (live, not just researched)
 * ---------------------------------------------------------------------------
 * Unlike the .gov.au NVIS fact-sheet fetches attempted for structureTable.ts
 * (which returned HTTP 503 from this sandbox all session — see that file),
 * `firenorth.org.au` IS reachable here, and the endpoint contract below was
 * confirmed with real, live requests in this session (via `curl` — not
 * inferred from documentation), specifically:
 *
 *  - `GET https://firenorth.org.au/geoserver/public/ows?SERVICE=WMS&VERSION=
 *    1.3.0&REQUEST=GetCapabilities` returns a real GeoServer 1.3.0 capabilities
 *    document (~11,000 lines), titled "NAFI online data", contact "Patrice
 *    Weber, Darwin Centre for Bushfire Research", no listed access fee or
 *    constraint.
 *  - It publishes PRE-COMPUTED time-since-fire rasters directly — better than
 *    the "derive it from N annual fire-scar layers" plan this module
 *    originally intended:
 *      `tslb_last10_250m`  — "Time Since Last Burnt Last 10 years (2016–2025)"
 *      `tslb_longterm_250m` — "Long Term Time Since Last Burnt 2025 (26 years)"
 *    both `queryable="1"`, 250 m, CRS EPSG:4326 / CRS:84, geographic extent
 *    (from the capabilities doc, CRS:84 order) roughly
 *    minLng 112.0, maxLng 155.0, minLat -40.0, maxLat -9.0 — i.e. the
 *    TECHNICAL raster extent is continental, wider than the "ground-validated
 *    north of ~20-29°S" region docs §11.7 actually attests to (see
 *    `CORE_VALIDATED_SOUTH_LAT` below).
 *  - A real `GetFeatureInfo` call against `tslb_last10_250m` at a point in
 *    Arnhem Land savanna (132.50°E, 13.00°S — chosen because that country
 *    burns most years) returned
 *    `{"type":"FeatureCollection","features":[{"properties":{"_":1}}],...}`
 *    — i.e. INFO_FORMAT=application/json gives the RAW underlying pixel
 *    value directly (an integer, years-since-burn) under an unnamed `"_"`
 *    property, not a rendered colour needing legend-matching the way the
 *    NVIS/NSW raster services do. Cross-checked against the same point's
 *    annual `fs2020..fs2025` layers (also live-queried: values 5, 9, 0, 0, 6,
 *    0 — plausibly month-of-burn per year, 0 = no fire that year), which
 *    puts the most recent burn at 2024: consistent with `tslb_last10_250m`
 *    returning 1 (years since burn, measured from the layer's stated 2025
 *    reference year) at the same point. This cross-check is the basis for
 *    trusting the value semantics below, not an assumption.
 *
 * WHAT WAS **NOT** VERIFIED (stated plainly rather than guessed): the
 * no-fire / NoData sentinel encoding. The one point tested had a positive
 * hit; a location with no fire recorded inside the 10-year or 26-year window
 * was not tested, so this module treats ANY value outside a physically
 * plausible range for that layer's stated window (see `MAX_PLAUSIBLE_YEARS`)
 * — or a missing/null property, or an empty `features` array — as "no answer
 * from this layer", falling to the next tier, rather than assuming a
 * specific sentinel meaning "never burnt". `GetLegendGraphic` for these two
 * layers returns a plain "Opaque Raster" style with no discrete rule
 * breakdown (continuous colour ramp), so the sentinel can't be read off the
 * legend either — confirming this is a genuine open item, not a shortcut.
 *
 * ---------------------------------------------------------------------------
 * RESILIENCE — same discipline as nvisVegetationService.ts / nswVegetationService.ts
 * ---------------------------------------------------------------------------
 * Never throws. Outside the technical bbox, on any HTTP failure, on a
 * malformed/empty response, or when both layers return an implausible value
 * → resolves to `null` (or `available:false` for the batch form) and the
 * caller is expected to treat that as "unknown", not "no fire ever". Nothing
 * here is a fabricated fallback number.
 *
 * ---------------------------------------------------------------------------
 * SCOPE CUT, stated plainly: POINT query only, not an area/tile query.
 * ---------------------------------------------------------------------------
 * This repo's established, hard-won pattern (docs §"Area-query vegetation")
 * is one area request per corridor scan, not one request per sampled point,
 * because per-point queries "at any sort of scale will overwhelm the
 * upstream API". This module does NOT yet have that area form. Two reasons,
 * stated rather than hidden: (1) time budget for this pass; (2) the
 * mechanism would have to differ from NVIS's area raster anyway — GeoServer's
 * `GetFeatureInfo` here returns raw values, not renderable colours to
 * legend-match, so an area version would need a `WCS GetCoverage` raw-grid
 * extract (a different request type this session did not verify live) rather
 * than reusing the NVIS `export`-image-plus-legend-decode approach. Flagged
 * here as the concrete next step for whoever wires an area form in, not
 * silently deferred.
 */

import { logger } from '../../utils/logger';

const NAFI_WMS_BASE =
  (import.meta.env.VITE_NAFI_WMS_URL as string | undefined) || 'https://firenorth.org.au/geoserver/public/ows';

/** Technical raster extent, read directly from the live GetCapabilities
 *  document this session (CRS:84 / lon-lat order), for the two time-since-
 *  fire layers — the hard "don't even try" gate. */
const NAFI_TECHNICAL_BBOX = { minLng: 112.0, maxLng: 155.01, minLat: -40.01, maxLat: -9.0 };

/**
 * Coarse approximation of docs §11.7's ground-validated coverage description
 * ("NT to 26°S, far-northern WA to 21°S, all Qld to 29°S, northern SA to
 * 29°S, since 2012") as a SINGLE latitude cutoff across the whole technical
 * bbox width. This is deliberately coarser than the true (jagged, per-state)
 * validated boundary — no polygon for that boundary was sourced this
 * session — so it is used only to SET CONFIDENCE ('published' north of it,
 * 'estimated' south of it but still inside the technical bbox), never as a
 * hard availability gate. The technical bbox above is the only hard gate.
 */
const CORE_VALIDATED_SOUTH_LAT = -29;

export type NAFITimeSinceFireWindow = 'last10' | 'longterm';

export interface NAFITimeSinceFireResult {
  /** Years since the most recent fire NAFI detected at this point, within
   *  whichever window answered (see `window`). */
  yearsSinceFire: number;
  /** Which precomputed NAFI layer supplied the answer — the 10-year window
   *  is preferred (more current imagery generation/calibration) and the
   *  26-year "long term" layer is consulted only when the 10-year layer had
   *  no plausible value (i.e. no fire recorded in the last 10 years there). */
  window: NAFITimeSinceFireWindow;
  /** 'published' inside docs §11.7's coarsely-approximated validated band
   *  (see `CORE_VALIDATED_SOUTH_LAT`), 'estimated' outside it but still
   *  inside the layer's technical extent — the same product, less
   *  independently attested at that latitude. */
  confidence: 'published' | 'estimated';
  source: string;
}

const MAX_PLAUSIBLE_YEARS: Record<NAFITimeSinceFireWindow, number> = { last10: 10, longterm: 26 };
const LAYER_NAME: Record<NAFITimeSinceFireWindow, string> = {
  last10: 'tslb_last10_250m',
  longterm: 'tslb_longterm_250m',
};

const inTechnicalBbox = (lat: number, lng: number): boolean =>
  lat >= NAFI_TECHNICAL_BBOX.minLat && lat <= NAFI_TECHNICAL_BBOX.maxLat &&
  lng >= NAFI_TECHNICAL_BBOX.minLng && lng <= NAFI_TECHNICAL_BBOX.maxLng;

const cache: Record<string, NAFITimeSinceFireResult | null> = {};

/** Build the GetFeatureInfo URL for a point, querying BOTH time-since-fire
 *  layers in ONE request (comma-joined LAYERS/QUERY_LAYERS — verified live
 *  this session against six fire-scar layers in a single call, so a two-layer
 *  combined request is the same mechanism at smaller scale) — one upstream
 *  round trip per point, not two, matching this repo's "as few upstream
 *  requests as the API contract allows" discipline. Parameters (bbox pad,
 *  image size, CRS:84 to sidestep WMS 1.3.0's EPSG:4326 axis-order ambiguity)
 *  are exactly the combination exercised live this session, not a fresh,
 *  untested guess. */
function buildFeatureInfoUrl(lat: number, lng: number): string {
  const d = 0.01; // ~1.1 km pad — comfortably larger than one 250 m native pixel
  const minx = lng - d, maxx = lng + d, miny = lat - d, maxy = lat + d;
  const layers = `${LAYER_NAME.last10},${LAYER_NAME.longterm}`;
  return (
    `${NAFI_WMS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo` +
    `&LAYERS=${layers}&QUERY_LAYERS=${layers}&STYLES=` +
    `&CRS=CRS:84&BBOX=${minx},${miny},${maxx},${maxy}` +
    `&WIDTH=101&HEIGHT=101&I=50&J=50` +
    `&INFO_FORMAT=application/json&FEATURE_COUNT=1`
  );
}

/** Pull a plausible integer years-value out of one GetFeatureInfo GeoJSON
 *  feature, or null if absent/implausible for that window (see module header
 *  — the NoData encoding was not observed this session, so anything outside
 *  a physically sane range is treated as "no answer", not zero years). */
function extractPlausibleYears(feature: unknown, window: NAFITimeSinceFireWindow): number | null {
  if (!feature || typeof feature !== 'object') return null;
  const props = (feature as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object') return null;
  const raw = (props as Record<string, unknown>)['_'];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_PLAUSIBLE_YEARS[window]) return null;
  return Math.round(value);
}

/**
 * Query NAFI's precomputed time-since-fire rasters for a point. Prefers the
 * 10-year window; falls back to the 26-year "long term" layer only when the
 * first gave no plausible value. Null outside the technical extent, on any
 * network/parse failure, or when NEITHER layer yields a plausible value at
 * this point (never fabricated as "never burnt" — see module header).
 */
export async function fetchNAFITimeSinceFire(lat: number, lng: number, signal?: AbortSignal): Promise<NAFITimeSinceFireResult | null> {
  if (!inTechnicalBbox(lat, lng)) return null;

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (key in cache) return cache[key];

  try {
    const resp = await fetch(buildFeatureInfoUrl(lat, lng), { signal });
    if (!resp.ok) {
      logger.warn('NAFI time-since-fire query HTTP', resp.status, resp.statusText);
      cache[key] = null;
      return null;
    }
    const json = await resp.json();
    const features: unknown[] = Array.isArray(json?.features) ? json.features : [];
    if (features.length < 2) {
      // Combined request should return one feature per QUERY_LAYERS entry —
      // fewer means the server didn't honour the multi-layer query as
      // expected. Treat as "no answer" rather than mis-index the array.
      cache[key] = null;
      return null;
    }

    const confidence: 'published' | 'estimated' = lat >= CORE_VALIDATED_SOUTH_LAT ? 'published' : 'estimated';
    const sourceNote =
      'NAFI (North Australia & Rangelands Fire Information), Charles Darwin University — ' +
      `${LAYER_NAME.last10}/${LAYER_NAME.longterm} via live WMS GetFeatureInfo (firenorth.org.au). ` +
      (confidence === 'published'
        ? 'Point falls inside this app’s coarse approximation of docs §11.7’s ground-validated coverage band.'
        : 'Point is inside the layer’s technical raster extent but SOUTH of this app’s coarse ' +
          'approximation of docs §11.7’s ground-validated band — same product, not independently ' +
          'attested at this latitude.');

    const last10Years = extractPlausibleYears(features[0], 'last10');
    if (last10Years !== null) {
      const result: NAFITimeSinceFireResult = { yearsSinceFire: last10Years, window: 'last10', confidence, source: sourceNote };
      cache[key] = result;
      return result;
    }

    const longtermYears = extractPlausibleYears(features[1], 'longterm');
    if (longtermYears !== null) {
      const result: NAFITimeSinceFireResult = { yearsSinceFire: longtermYears, window: 'longterm', confidence, source: sourceNote };
      cache[key] = result;
      return result;
    }

    // Neither layer gave a plausible value — honestly "no answer", not "never
    // burnt" (see module header: the no-fire sentinel wasn't observed live).
    cache[key] = null;
    return null;
  } catch (e) {
    logger.warn('NAFI time-since-fire query failed', e);
    cache[key] = null;
    return null;
  }
}

export function _clearNAFICache(): void {
  Object.keys(cache).forEach((k) => delete cache[k]);
}
