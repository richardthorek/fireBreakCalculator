/**
 * DEA Water Observations from Space (WOfS) — multi-year wet-frequency —
 * docs/ROUTE_INTELLIGENCE.md §10.3(c), §11.7, §10.7 M3c: "How often each
 * pixel has been *observed as water* over decades... needs no modelling at
 * all — it is measurement. Extremely high value for the wet/dry toggle."
 *
 * Layer: `ga_ls_wo_fq_myear_3` ("DEA Water Observations Multi Year
 * (Landsat)", Collection 3, 1986–near present, 30 m) — the CURRENT product;
 * several similarly-named layers on the same server are explicitly marked
 * DEPRECATED in their own capabilities `<Title>` and are not used (see
 * `deaOwsClient.ts` header for the full list rejected).
 *
 * LIVE-VERIFIED this session (via `curl`, not just documentation) at Lake
 * Argyle, WA (128.75°E, 16.20°S — a large permanent reservoir, chosen
 * because a near-100% wet frequency there is a strong sanity check):
 *   `{"data":[{"time":"1987-01-01 00:00:00 UTC","bands":{"frequency":
 *   0.9660493731498718,"count_wet":939,"count_clear":972,"land":{"Sea,
 *   Mainland or Island":"mainland"}}}], ...}`
 * `frequency` (0.966) matches `count_wet/count_clear` (939/972 = 0.966)
 * exactly, confirming the field semantics matches docs' own description
 * ("frequency of wet observations as clear-wet ÷ clear-total") rather than
 * assuming it from the layer name alone.
 */

import { fetchDeaFeatureInfo, numericBand, DEA_OWS_BASE, inDeaTechnicalBbox } from './deaOwsClient';
import { decodeImageBytes } from '../../utils/nvisVegetationService';
import { logger } from '../../utils/logger';

const LAYER = 'ga_ls_wo_fq_myear_3';

export interface SurfaceWaterFrequencyResult {
  /** Fraction (0–1) of CLEAR Landsat observations, 1986–near present, that
   *  were classified wet at this pixel. A pixel wet 0.4 of the time is a
   *  seasonal trap, not a permanent obstacle — see docs §10.3(c). */
  frequency: number;
  countWet: number;
  countClear: number;
  /** The product's own nominal reference period label (its `time` field —
   *  a fixed multi-year composite, not a specific date). */
  period: string;
  confidence: 'published';
  source: string;
}

/**
 * Query DEA's multi-year Water Observations frequency at a point. Null
 * outside the technical extent, on any network/parse failure, or when the
 * pixel has too few clear observations to report a frequency (the product's
 * own "n/a" masking — e.g. permanent cloud/shadow — never fabricated as 0).
 */
export async function fetchSurfaceWaterFrequency(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<SurfaceWaterFrequencyResult | null> {
  const resp = await fetchDeaFeatureInfo(LAYER, lat, lng, undefined, signal);
  if (!resp || resp.data.length === 0) return null;

  const slice = resp.data[0];
  const frequency = numericBand(slice.bands.frequency);
  const countWet = numericBand(slice.bands.count_wet);
  const countClear = numericBand(slice.bands.count_clear);
  if (frequency === null || countWet === null || countClear === null) return null;

  return {
    frequency,
    countWet,
    countClear,
    period: slice.time || 'multi-year (1986–near present)',
    confidence: 'published',
    source:
      'Digital Earth Australia, "DEA Water Observations Multi Year (Landsat)" (ga_ls_wo_fq_myear_3, ' +
      'Collection 3, 30 m, 1986–near present) via live WMS GetFeatureInfo (ows.dea.ga.gov.au). ' +
      'frequency = count_wet / count_clear, as reported directly by the product.',
  };
}

// ---------------------------------------------------------------------------
// Area raster — Terrain Mobility hydrology gate (docs §34)
// ---------------------------------------------------------------------------
//
// The point-query function above is a GetFeatureInfo call — one pixel per
// request. `mobilityGrid.ts` samples up to ~2800 cells per run, and this
// codebase already treats "hundreds of upstream requests" as the failure mode
// to design AROUND (see that module's own comment on why NAFI/DEA point
// queries stay capped small) — calling it per cell here would repeat exactly
// that mistake. The fix mirrors `nafiFireHistoryService.ts`'s own area-raster
// solution: ONE request for the whole AOI, decoded client-side, sampled
// per-cell from the decode.
//
// WHY THIS IS WMS GetMap, NOT WCS GetCoverage (as NAFI uses): LIVE-VERIFIED
// this session — `ga_ls_wo_fq_myear_3`'s WCS DescribeCoverage advertises only
// GeoTIFF/netCDF (`curl .../DescribeCoverage?COVERAGE=ga_ls_wo_fq_myear_3`),
// and a live GetCoverage request with `FORMAT=PNG` is REJECTED
// (`ServiceException`, confirmed by curl) — there is no browser-native way to
// decode a multi-band GeoTIFF here (no such dependency in this project, and
// this module deliberately does not add a GeoTIFF parser to work around one
// layer). WMS GetMap with `FORMAT=image/png`, by contrast, IS live-verified to
// return a real 200 PNG (confirmed by curl against the same bbox) — WMS
// rasterises through a STYLE rather than returning raw band data, which is
// exactly what a canvas-decodable image needs.
//
// CONSEQUENCE OF THAT CHOICE: what comes back is a STYLED, 8-bit RGB image —
// not the exact `frequency` float the point-query function reports. The value
// recovered per pixel is therefore an APPROXIMATION reconstructed by matching
// each pixel's colour against the style's own published colour ramp (the
// SAME technique `nvisVegetationService.ts`/`nafiFireHistoryService.ts`
// already use for their own legend-colour-coded rasters), not a measurement
// read directly off a data band. This is a real precision loss versus the
// point function and is reported honestly — see `WOFS_AREA_CONFIDENCE` below
// and `SurfaceWaterFrequencyRaster`'s own doc comment.
//
// STYLE CHOSEN: `mysummary_wofs_frequency_blue_3` ("Water Summary (blue)") —
// LIVE-VERIFIED this session to be a clean, monotonic single-hue ramp (pale
// cyan at 0% through blue to purple at 100%, sampled at x=35..365px of its own
// 400×125 `legend.png`, no perceptual colour-space complications from a
// multi-hue ramp). `WOFS_FREQUENCY_RAMP` below is that sampling, taken at 15px
// steps (~4.5 percentage points of frequency per control point) — the same
// density convention `nafiFireHistoryService.ts`'s own `LEGEND` table uses.

/** Live-derived colour ramp control points for the `mysummary_wofs_frequency_
 *  blue_3` style's `legend.png` (sampled this session at y=50px, x=35..365px,
 *  15px steps — see module note above). Linear across the ramp's own pixel
 *  extent, which is the standard convention this OWS instance's auto-legend
 *  generator uses (confirmed by the same convention already relied on for
 *  NAFI's/NVIS's own colour-ramp legends elsewhere in this codebase). */
const WOFS_FREQUENCY_RAMP: { frequency: number; r: number; g: number; b: number }[] = [
  { frequency: 0.000, r: 200, g: 251, b: 250 },
  { frequency: 0.045, r: 178, g: 245, b: 251 },
  { frequency: 0.091, r: 154, g: 238, b: 253 },
  { frequency: 0.136, r: 130, g: 232, b: 254 },
  { frequency: 0.182, r: 109, g: 226, b: 255 },
  { frequency: 0.227, r: 84, g: 221, b: 255 },
  { frequency: 0.273, r: 60, g: 216, b: 255 },
  { frequency: 0.318, r: 38, g: 212, b: 255 },
  { frequency: 0.364, r: 14, g: 207, b: 255 },
  { frequency: 0.409, r: 1, g: 196, b: 255 },
  { frequency: 0.455, r: 1, g: 179, b: 255 },
  { frequency: 0.500, r: 1, g: 161, b: 255 },
  { frequency: 0.545, r: 1, g: 143, b: 255 },
  { frequency: 0.591, r: 1, g: 127, b: 255 },
  { frequency: 0.636, r: 6, g: 104, b: 255 },
  { frequency: 0.682, r: 14, g: 78, b: 255 },
  { frequency: 0.727, r: 22, g: 55, b: 255 },
  { frequency: 0.773, r: 30, g: 29, b: 255 },
  { frequency: 0.818, r: 38, g: 3, b: 255 },
  { frequency: 0.864, r: 47, g: 1, b: 250 },
  { frequency: 0.909, r: 58, g: 1, b: 244 },
  { frequency: 0.955, r: 68, g: 0, b: 238 },
  { frequency: 1.000, r: 78, g: 0, b: 232 },
];

/** Squared-distance tolerance for matching a decoded pixel against the ramp —
 *  generous enough to absorb PNG/JPEG-adjacent compression and anti-aliasing
 *  noise (this endpoint returns PNG, lossless, but the ramp itself was hand-
 *  sampled at 15px steps so some interpolation error is expected) without
 *  matching an unrelated hue (a basemap/land pixel outside the coloured ramp
 *  entirely). Pixels beyond this are reported as "no data" (transparent /
 *  masked / land), never coerced to the nearest ramp colour regardless of
 *  how implausible. */
const WOFS_COLOR_MATCH_TOLERANCE_SQ = 24 ** 2;

/**
 * Nearest-ramp-point match with linear interpolation between the two closest
 * neighbours (not just nearest-colour snap) — the ramp is dense enough and
 * smooth enough that interpolating between adjacent control points is more
 * accurate than rounding to whichever sampled point is nearest, unlike NAFI's
 * categorical (non-interpolatable) year bands. Pure — exported for tests.
 */
export function matchWofsFrequencyColour(r: number, g: number, b: number): number | null {
  let bestIdx = -1;
  let bestD = Infinity;
  for (let i = 0; i < WOFS_FREQUENCY_RAMP.length; i++) {
    const e = WOFS_FREQUENCY_RAMP[i];
    const d = (r - e.r) ** 2 + (g - e.g) ** 2 + (b - e.b) ** 2;
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  if (bestIdx < 0 || bestD > WOFS_COLOR_MATCH_TOLERANCE_SQ) return null;

  // Interpolate toward whichever neighbour is closer in colour, for a smoother
  // reconstruction than snapping to the nearest of 23 discrete samples.
  const best = WOFS_FREQUENCY_RAMP[bestIdx];
  const neighbourIdx = bestIdx === 0 ? 1 : bestIdx === WOFS_FREQUENCY_RAMP.length - 1 ? bestIdx - 1 : (
    ((r - WOFS_FREQUENCY_RAMP[bestIdx - 1].r) ** 2 + (g - WOFS_FREQUENCY_RAMP[bestIdx - 1].g) ** 2 + (b - WOFS_FREQUENCY_RAMP[bestIdx - 1].b) ** 2) <
    ((r - WOFS_FREQUENCY_RAMP[bestIdx + 1].r) ** 2 + (g - WOFS_FREQUENCY_RAMP[bestIdx + 1].g) ** 2 + (b - WOFS_FREQUENCY_RAMP[bestIdx + 1].b) ** 2)
      ? bestIdx - 1 : bestIdx + 1
  );
  const neighbour = WOFS_FREQUENCY_RAMP[neighbourIdx];
  const dBest = Math.sqrt(bestD);
  const dNeighbour = Math.sqrt((r - neighbour.r) ** 2 + (g - neighbour.g) ** 2 + (b - neighbour.b) ** 2);
  const total = dBest + dNeighbour;
  const t = total > 0 ? dBest / total : 0; // weight toward the closer of the two
  const freq = best.frequency + t * (neighbour.frequency - best.frequency);
  return Math.max(0, Math.min(1, freq));
}

/** Max side length requested from the upstream image — matches NAFI's/NVIS's
 *  own export-size cap: keep one request small regardless of AOI size,
 *  coarsening rather than growing unbounded. */
const MAX_WOFS_AREA_PX = 400;

export interface SurfaceWaterFrequencyRaster {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  width: number;
  height: number;
  /** Colour-ramp-reconstructed frequency, ×1000 as an integer (Int16Array has
   *  no fractional storage) — -1 = no match (outside the ramp's colour range:
   *  land, no data, or a basemap feature bleeding through). Divide by 1000 to
   *  recover the 0..1 fraction. */
  frequencyX1000: Int16Array;
  /** Always 'estimated': every value here is a colour-ramp reconstruction of a
   *  styled image, not the exact measured fraction the point-query function
   *  (`fetchSurfaceWaterFrequency`) reads directly off the data band. Callers
   *  that can afford a point query for a specific cell should prefer it; this
   *  raster exists so an AOI-wide grid does not have to. */
  confidence: 'estimated';
  source: string;
}

/**
 * Fetch multi-year water-observation frequency for a bbox as ONE styled PNG
 * (one upstream request regardless of grid size) and decode to a per-pixel
 * frequency raster via colour-ramp matching. Null on any failure (decode
 * unsupported — browser-only, same limitation `decodeImageBytes` documents —
 * network/HTTP error, or a response that matched no ramp colour anywhere),
 * signalling the caller to proceed without a hydrology layer rather than
 * block the whole appreciation run on it.
 */
export async function fetchSurfaceWaterFrequencyArea(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  signal?: AbortSignal
): Promise<SurfaceWaterFrequencyRaster | null> {
  const { minLat, minLng, maxLat, maxLng } = bounds;
  if (maxLat <= minLat || maxLng <= minLng) return null;
  if (!inDeaTechnicalBbox(minLat, minLng) && !inDeaTechnicalBbox(maxLat, maxLng)) return null;

  const nativePxPerDeg = 1 / (30 / 111320); // 30 m native pixel, in degrees at the equator — a coarse but adequate cap basis
  const degWidth = maxLng - minLng;
  const degHeight = maxLat - minLat;
  let width = Math.max(2, Math.ceil(degWidth * nativePxPerDeg));
  let height = Math.max(2, Math.ceil(degHeight * nativePxPerDeg));
  const maxSide = Math.max(width, height);
  if (maxSide > MAX_WOFS_AREA_PX) {
    const scale = MAX_WOFS_AREA_PX / maxSide;
    width = Math.max(2, Math.round(width * scale));
    height = Math.max(2, Math.round(height * scale));
  }

  // WMS 1.3.0 + EPSG:4326 = (lat, lon) BBOX axis order — the same convention
  // `deaOwsClient.ts`'s point-query function already established and verified
  // live for this exact server.
  const url =
    `${DEA_OWS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(LAYER)}&STYLES=mysummary_wofs_frequency_blue_3` +
    `&CRS=EPSG:4326&BBOX=${minLat},${minLng},${maxLat},${maxLng}` +
    `&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/png&TRANSPARENT=TRUE`;

  let decoded: { width: number; height: number; data: Uint8ClampedArray } | null;
  try {
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      logger.warn('DEA WOfS area GetMap HTTP', resp.status, resp.statusText);
      return null;
    }
    decoded = await decodeImageBytes(await resp.blob());
  } catch (e) {
    logger.warn('DEA WOfS area query failed', e);
    return null;
  }
  if (!decoded) return null; // decode unsupported (non-browser) or a malformed image

  const frequencyX1000 = new Int16Array(width * height).fill(-1);
  let matched = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (decoded.data[o + 3] < 128) continue; // transparent — no observation/land, not "0% wet"
    const freq = matchWofsFrequencyColour(decoded.data[o], decoded.data[o + 1], decoded.data[o + 2]);
    if (freq === null) continue;
    frequencyX1000[i] = Math.round(freq * 1000);
    matched++;
  }

  if (matched === 0) {
    logger.warn('DEA WOfS area query decoded but matched no pixel against the colour ramp — continuing without hydrology data');
    return null;
  }

  return {
    minLat, minLng, maxLat, maxLng, width, height,
    frequencyX1000,
    confidence: 'estimated',
    source:
      'Digital Earth Australia, "DEA Water Observations Multi Year (Landsat)" (ga_ls_wo_fq_myear_3, ' +
      'Collection 3, 30 m, 1986–near present) via WMS GetMap area query, colour-ramp reconstructed ' +
      '("Water Summary (blue)" style) — an approximation of the exact per-pixel frequency, not a direct read.',
  };
}

/**
 * Sample a fetched area raster at a point — pure, exported for tests. Mirrors
 * `nafiFireHistoryService.ts`'s `sampleNAFIAreaRaster` contract: null outside
 * the raster's own bounds or where no pixel matched the colour ramp.
 */
export function sampleSurfaceWaterFrequencyRaster(
  raster: SurfaceWaterFrequencyRaster,
  lat: number,
  lng: number
): { frequency: number; confidence: 'estimated'; source: string } | null {
  if (lat < raster.minLat || lat > raster.maxLat || lng < raster.minLng || lng > raster.maxLng) return null;
  const px = Math.min(raster.width - 1, Math.max(0, Math.floor(((lng - raster.minLng) / (raster.maxLng - raster.minLng)) * raster.width)));
  const py = Math.min(raster.height - 1, Math.max(0, Math.floor(((raster.maxLat - lat) / (raster.maxLat - raster.minLat)) * raster.height)));
  const i = py * raster.width + px;
  const v = raster.frequencyX1000[i];
  if (v < 0) return null;
  return { frequency: v / 1000, confidence: raster.confidence, source: raster.source };
}
