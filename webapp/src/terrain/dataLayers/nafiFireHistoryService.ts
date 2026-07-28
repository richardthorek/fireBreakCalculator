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
import { decodeImageBytes } from '../../utils/nvisVegetationService';

const NAFI_WMS_BASE =
  ((import.meta as any).env?.VITE_NAFI_WMS_URL as string | undefined) || 'https://firenorth.org.au/geoserver/public/ows';

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

// ---------------------------------------------------------------------------
// AREA QUERY (2026-07-27) — the mechanism the module header above flagged as
// the concrete next step, now built. One request PER WINDOW for a whole grid
// (2 requests total, not one per cell/point) — the same "area-batched, not
// per-point" discipline as NVIS's vegetation raster (docs "Area-query
// vegetation").
//
// WHY WCS `GetCoverage` + PNG, not the GeoTIFF the module header originally
// guessed at: live-verified this session (via `curl` + Pillow, not inferred).
// `DescribeCoverage` for `tslb_last10_250m` lists GeoTIFF/GIF/JPEG/PNG/TIFF as
// the coverage's own supported formats. The GeoTIFF path was tried first and
// rejected: GeoServer serves it as a TILED (not simple-stripped) 8-bit
// palette raster (`TileWidth`/`TileOffsets` present in the IFD), which would
// need a real TIFF-tile decoder — meaningfully more implementation risk than
// this repo's existing, already-trusted pattern. PNG sidesteps all of that:
// it decodes with the SAME `decodeImageBytes` canvas helper NVIS's own area
// raster already uses, and a live 1×1-pixel cross-check confirmed it encodes
// the identical underlying value as the point-query's `GetFeatureInfo` call
// (both resolved to years=1 at the same coordinate) — just as an RGB colour
// (indexed differently per PNG, since GD renumbers its own palette per
// image) rather than a raw index, which is why colour-legend matching is
// still needed, exactly as it already is for NVIS's MVG raster.
//
// THE NO-ANSWER SIGNAL: a pixel with no plausible fire-recency value for a
// window (either genuinely outside the data footprint, or unburnt within
// that specific window) renders fully TRANSPARENT (alpha 0) — live-confirmed
// against a known open-ocean point that returned raw property "_": 11 (i.e.
// past `MAX_PLAUSIBLE_YEARS.last10`) via GetFeatureInfo, and alpha 0 via the
// PNG area path for the identical point. This module does not attempt to
// further distinguish "genuinely no data" from "no fire in this window" —
// both already collapse to the same "try the next window, else no answer"
// behaviour the point-query function above uses, so preserving that same
// ambiguity here is a deliberate consistency choice, not an oversight.
//
// THE 22–26 YEAR TIE (`tslb_longterm_250m` only): the live-fetched legend has
// FIVE consecutive year values (22–26) rendered in the identical colour
// (53,80,89) — the source's own palette design flattens the tail of its
// ramp, not a decode bug (confirmed by reading the raw GeoTIFF ColorMap
// tag directly, independent of the PNG path). A colour match against that
// shared colour cannot recover which of the five years it actually is.
// Resolved conservatively for THIS product's purpose (denser regrowth over a
// longer unburnt period generally means harder going, and this project's
// standing rule is to never understate difficulty on ambiguous data): the
// HIGHEST year in the tied band (26) is reported, flagged `coarseBand: true`
// so callers/UI can carry the caveat rather than presenting it as an exact
// figure.

/** RGB legend entries verified live this session (curl + Pillow against the
 *  server's own GeoTIFF ColorMap tag) for each window's 1..N year ramp. Never
 *  re-derived from a guess — these are the actual palette colours observed. */
interface NAFIColourEntry { years: number; r: number; g: number; b: number }

const NAFI_LEGEND_LAST10: NAFIColourEntry[] = [
  { years: 1, r: 121, g: 35, b: 33 },
  { years: 2, r: 230, g: 56, b: 39 },
  { years: 3, r: 240, g: 130, b: 56 },
  { years: 4, r: 255, g: 210, b: 0 },
  { years: 5, r: 250, g: 245, b: 119 },
  { years: 6, r: 208, g: 242, b: 17 },
  { years: 7, r: 51, g: 247, b: 74 },
  { years: 8, r: 107, g: 213, b: 124 },
  { years: 9, r: 139, g: 239, b: 210 },
  { years: 10, r: 139, g: 205, b: 237 },
];

const NAFI_LEGEND_LONGTERM: NAFIColourEntry[] = [
  { years: 1, r: 121, g: 35, b: 33 },
  { years: 2, r: 200, g: 40, b: 23 },
  { years: 3, r: 238, g: 88, b: 88 },
  { years: 4, r: 240, g: 130, b: 56 },
  { years: 5, r: 253, g: 164, b: 8 },
  { years: 6, r: 255, g: 210, b: 0 },
  { years: 7, r: 250, g: 245, b: 119 },
  { years: 8, r: 208, g: 242, b: 17 },
  { years: 9, r: 151, g: 231, b: 25 },
  { years: 10, r: 51, g: 247, b: 74 },
  { years: 11, r: 10, g: 220, b: 35 },
  { years: 12, r: 107, g: 213, b: 124 },
  { years: 13, r: 75, g: 220, b: 180 },
  { years: 14, r: 60, g: 240, b: 240 },
  { years: 15, r: 155, g: 235, b: 235 },
  { years: 16, r: 210, g: 245, b: 245 },
  { years: 17, r: 205, g: 225, b: 225 },
  { years: 18, r: 160, g: 200, b: 200 },
  { years: 19, r: 132, g: 170, b: 182 },
  { years: 20, r: 91, g: 137, b: 151 },
  { years: 21, r: 78, g: 118, b: 130 },
  // 22-26 share one colour in the source palette (see module note) — the
  // tie is resolved by matchNAFIColour, not by listing duplicate entries.
  { years: 22, r: 53, g: 80, b: 89 },
  { years: 23, r: 53, g: 80, b: 89 },
  { years: 24, r: 53, g: 80, b: 89 },
  { years: 25, r: 53, g: 80, b: 89 },
  { years: 26, r: 53, g: 80, b: 89 },
];

const LEGEND: Record<NAFITimeSinceFireWindow, NAFIColourEntry[]> = {
  last10: NAFI_LEGEND_LAST10,
  longterm: NAFI_LEGEND_LONGTERM,
};

/** Squared-distance colour tolerance — same threshold NVIS's own
 *  `matchColorToLegend` uses for the same anti-aliasing concern (a solid
 *  legend colour rendered through PNG can pick up minor filtering noise). */
const COLOR_MATCH_TOLERANCE_SQ = 300;

/**
 * Nearest legend colour within tolerance, resolving an exact colour TIE
 * (only occurs in `NAFI_LEGEND_LONGTERM`'s flattened 22-26 band) to the
 * HIGHEST tied year — see module note on why higher/harder is the
 * conservative choice here. Pure — exported for tests.
 */
export function matchNAFIColour(
  r: number, g: number, b: number, window: NAFITimeSinceFireWindow
): { years: number; coarseBand: boolean } | null {
  let bestD = Infinity;
  let tied: NAFIColourEntry[] = [];
  for (const e of LEGEND[window]) {
    const d = (r - e.r) ** 2 + (g - e.g) ** 2 + (b - e.b) ** 2;
    if (d < bestD - 1e-6) {
      bestD = d;
      tied = [e];
    } else if (Math.abs(d - bestD) <= 1e-6) {
      tied.push(e);
    }
  }
  if (bestD > COLOR_MATCH_TOLERANCE_SQ || tied.length === 0) return null;
  const years = Math.max(...tied.map((e) => e.years));
  return { years, coarseBand: tied.length > 1 };
}

/**
 * Build the WCS 1.0.0 `GetCoverage` KVP URL for one window's area raster.
 * BBOX axis order verified LIVE this session: WCS 1.0.0 with
 * `CRS=EPSG:4326` on this GeoServer takes (lng,lat) order — NOT the
 * lat/lng order WMS 1.3.0 uses for the same EPSG code (which is exactly why
 * the point-query function above sidesteps the ambiguity with `CRS:84`
 * instead). Getting this backwards would silently mirror the sampled grid,
 * so it is called out here rather than left implicit.
 */
export function buildNAFIAreaCoverageUrl(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  width: number,
  height: number,
  window: NAFITimeSinceFireWindow
): string {
  return (
    `${NAFI_WMS_BASE}?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage` +
    `&COVERAGE=public:${LAYER_NAME[window]}&CRS=EPSG:4326` +
    `&BBOX=${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}` +
    `&WIDTH=${width}&HEIGHT=${height}&FORMAT=PNG`
  );
}

/** Max side length requested from the upstream raster — matches NVIS's own
 *  export-size cap (`MAX_EXPORT_PX`), same rationale: keep the single request
 *  small regardless of how large the painted AOI is, coarsening rather than
 *  ever growing unbounded. */
const MAX_AREA_PX = 400;

export interface NAFIAreaRaster {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  width: number;
  height: number;
  /** Resolved years-since-fire per pixel (last10 preferred, longterm
   *  fallback — same precedence as the point-query function). -1 = no
   *  plausible answer from either window at this pixel. */
  years: Int16Array;
  /** Which window answered each pixel: 0 = last10, 1 = longterm, -1 = neither
   *  (see `years`). Tracked directly during resolution rather than inferred
   *  from the years value afterward — last10 and longterm's legends overlap
   *  in range (both can answer e.g. "5 years"), so a post-hoc guess from the
   *  number alone would be wrong for a real fraction of pixels. */
  window: Int8Array;
  /** 1 where the resolved value came from `tslb_longterm_250m`'s colour-tied
   *  22-26 band (see module note) — a coarser figure than the rest of the
   *  raster, flagged per-pixel rather than for the whole raster since most
   *  pixels won't hit it. */
  coarseBand: Uint8Array;
  /** 1 where this pixel is south of the coarse validated-latitude cutoff
   *  (`CORE_VALIDATED_SOUTH_LAT`) — mirrors the point-query function's own
   *  'estimated' confidence tier, computed per-pixel since a large AOI can
   *  straddle that latitude. */
  estimated: Uint8Array;
  source: string;
}

/**
 * Fetch BOTH time-since-fire windows for a bbox as ONE PNG each (2 upstream
 * requests total, regardless of grid size) and decode to a per-pixel years
 * raster. Null on any failure (decode unsupported — browser-only, same
 * limitation `decodeImageBytes` documents — or a network/HTTP error),
 * signalling the caller to fall back to the point-query function above.
 */
export async function fetchNAFITimeSinceFireArea(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  signal?: AbortSignal
): Promise<NAFIAreaRaster | null> {
  const { minLat, minLng, maxLat, maxLng } = bounds;
  if (maxLat <= minLat || maxLng <= minLng) return null;
  if (!inTechnicalBbox(minLat, minLng) && !inTechnicalBbox(maxLat, maxLng)) return null;

  const degWidth = maxLng - minLng;
  const degHeight = maxLat - minLat;
  const nativePxPerDeg = 1 / 0.0025; // 250 m native pixel, in degrees (matches DescribeCoverage's offsetVector)
  let width = Math.max(2, Math.ceil(degWidth * nativePxPerDeg));
  let height = Math.max(2, Math.ceil(degHeight * nativePxPerDeg));
  const maxSide = Math.max(width, height);
  if (maxSide > MAX_AREA_PX) {
    const scale = MAX_AREA_PX / maxSide;
    width = Math.max(2, Math.round(width * scale));
    height = Math.max(2, Math.round(height * scale));
  }

  const fetchWindow = async (window: NAFITimeSinceFireWindow) => {
    const resp = await fetch(buildNAFIAreaCoverageUrl(bounds, width, height, window), { signal });
    if (!resp.ok) {
      logger.warn('NAFI area GetCoverage HTTP', window, resp.status, resp.statusText);
      return null;
    }
    return decodeImageBytes(await resp.blob());
  };

  let last10: { width: number; height: number; data: Uint8ClampedArray } | null;
  let longterm: { width: number; height: number; data: Uint8ClampedArray } | null;
  try {
    [last10, longterm] = await Promise.all([fetchWindow('last10'), fetchWindow('longterm')]);
  } catch (e) {
    logger.warn('NAFI area query failed', e);
    return null;
  }
  if (!last10 && !longterm) return null; // decode unsupported (non-browser) or both requests failed

  const years = new Int16Array(width * height).fill(-1);
  const windowAt = new Int8Array(width * height).fill(-1);
  const coarseBand = new Uint8Array(width * height);
  const estimated = new Uint8Array(width * height);
  let matched = 0;

  for (let py = 0; py < height; py++) {
    const lat = maxLat - ((py + 0.5) / height) * (maxLat - minLat);
    const rowEstimated = lat < CORE_VALIDATED_SOUTH_LAT ? 1 : 0;
    for (let px = 0; px < width; px++) {
      const i = py * width + px;
      estimated[i] = rowEstimated;
      const o = i * 4;

      if (last10 && last10.data[o + 3] >= 128) {
        const m = matchNAFIColour(last10.data[o], last10.data[o + 1], last10.data[o + 2], 'last10');
        if (m) {
          years[i] = m.years;
          windowAt[i] = 0;
          coarseBand[i] = m.coarseBand ? 1 : 0;
          matched++;
          continue;
        }
      }
      if (longterm && longterm.data[o + 3] >= 128) {
        const m = matchNAFIColour(longterm.data[o], longterm.data[o + 1], longterm.data[o + 2], 'longterm');
        if (m) {
          years[i] = m.years;
          windowAt[i] = 1;
          coarseBand[i] = m.coarseBand ? 1 : 0;
          matched++;
        }
      }
    }
  }

  if (matched === 0) {
    logger.warn('NAFI area query decoded but matched no pixel against either legend — falling back');
    return null;
  }

  return {
    minLat, minLng, maxLat, maxLng, width, height,
    years, window: windowAt, coarseBand, estimated,
    source:
      'NAFI (North Australia & Rangelands Fire Information), Charles Darwin University — ' +
      `${LAYER_NAME.last10}/${LAYER_NAME.longterm} via WCS GetCoverage area query (firenorth.org.au).`,
  };
}

/**
 * Sample a fetched area raster at a point — pure, exported for tests. Mirrors
 * `nvisVegetationService.ts`'s `rasterCodeAt` contract: null outside the
 * raster's own bounds or where no pixel matched either legend.
 */
export function sampleNAFIAreaRaster(raster: NAFIAreaRaster, lat: number, lng: number): NAFITimeSinceFireResult | null {
  if (lat < raster.minLat || lat > raster.maxLat || lng < raster.minLng || lng > raster.maxLng) return null;
  const px = Math.min(raster.width - 1, Math.max(0, Math.floor(((lng - raster.minLng) / (raster.maxLng - raster.minLng)) * raster.width)));
  const py = Math.min(raster.height - 1, Math.max(0, Math.floor(((raster.maxLat - lat) / (raster.maxLat - raster.minLat)) * raster.height)));
  const i = py * raster.width + px;
  const yearsSinceFire = raster.years[i];
  if (yearsSinceFire < 0 || raster.window[i] < 0) return null;

  const window: NAFITimeSinceFireWindow = raster.window[i] === 0 ? 'last10' : 'longterm';
  const confidence: 'published' | 'estimated' = raster.estimated[i] ? 'estimated' : 'published';
  const coarseNote = raster.coarseBand[i]
    ? ' Colour-band-limited: the source palette does not distinguish this figure from nearby years in its 22-26yr band — treat as approximate.'
    : '';
  return {
    yearsSinceFire,
    window,
    confidence,
    source: raster.source + coarseNote,
  };
}
