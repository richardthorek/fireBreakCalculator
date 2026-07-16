/**
 * National vegetation via NVIS (National Vegetation Information System).
 *
 * WHY THE WEB SERVICE (and not a self-hosted raster)
 * The NSW SVTM PCT layer is high-fidelity but NSW-only. Outside NSW the app
 * previously fell back to coarse global landcover and ultimately to a
 * pseudo-random mock — i.e. fabricated vegetation. NVIS gives an
 * Australia-wide, authoritative fuel class.
 *
 * The full NVIS product is a continental raster (Major Vegetation Groups /
 * Subgroups, ~100 m grid) — multi-gigabyte GeoTIFFs. Self-hosting it to answer
 * per-point queries would require either a raster/COG sampling server or a
 * preprocessing pipeline into vector/PMTiles: heavy infrastructure and ongoing
 * maintenance for a lightweight planning tool. DCCEEW already publishes a
 * maintained ArcGIS REST service that answers point lookups directly, so we use
 * that. The endpoint is env-overridable so it can be repointed (including at a
 * self-hosted mirror) without a code change if the decision is revisited.
 * See docs/NVIS_INTEGRATION.md for the full rationale and the hosting path.
 *
 * ROBUSTNESS
 * NVIS MapServer layer 0 is a raster, so we query with `identify` (the correct
 * operation for raster map services) and fall back to `query` for deployments
 * that expose a feature layer. The Major Vegetation Group is resolved from a
 * numeric MVG code when present (authoritative table below) and from the group
 * name otherwise, since field names vary across NVIS releases.
 */

import { logger } from './logger';
import { VegetationType } from '../config/classification';
import { tilesCovering, tileBounds, tileUrl, legendUrl, NVIS_TILE_DEG, MAX_NVIS_TILES } from './vegetationTiles';

const NVIS_MVG_URL =
  (import.meta.env.VITE_NVIS_MVG_URL as string | undefined) ||
  'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer';

const NVIS_LAYER_ID = 0;

// Rough continental bounding box for Australia to short-circuit needless queries.
const AUS_BBOX = { minLat: -44.0, maxLat: -9.0, minLng: 112.0, maxLng: 154.5 };

export interface NVISResult {
  vegetationType: VegetationType;
  confidence: number;
  /** The Major Vegetation Group name (resolved from code or attributes). */
  mvgName: string;
  /** The Major Vegetation Group number (1–32, 99) when known. */
  mvgCode?: number;
  source: 'nvis';
}

const cache: Record<string, NVISResult | null> = {};

const inAustralia = (lat: number, lng: number): boolean =>
  lat >= AUS_BBOX.minLat && lat <= AUS_BBOX.maxLat && lng >= AUS_BBOX.minLng && lng <= AUS_BBOX.maxLng;

/**
 * Authoritative NVIS Major Vegetation Groups (MVG 1–32, plus 99 = unknown),
 * mapped to the app's 4-class fireline fuel taxonomy. Names are the standard
 * DCCEEW NVIS MVG labels. Confidence reflects how cleanly each group maps to a
 * fireline-relevant fuel structure (closed forest and grassland map cleanly;
 * mixed woodlands and "other/unclassified" groups less so).
 *
 * Fuel-class rationale: the 4 classes proxy clearing difficulty, so structure
 * (and the dominant fuel a line-building resource must cut through) drives the
 * mapping — tall/closed forests → heavyforest; woodlands/shrublands/heath/mallee
 * → mediumscrub; open woodlands and low sparse shrublands → lightshrub;
 * grasslands/herblands/sedgelands and effectively fuel-free classes → grassland.
 */
export const MVG_CLASSES: Record<number, { name: string; vegetation: VegetationType; confidence: number }> = {
  1: { name: 'Rainforests and Vine Thickets', vegetation: 'heavyforest', confidence: 0.9 },
  2: { name: 'Eucalypt Tall Open Forests', vegetation: 'heavyforest', confidence: 0.95 },
  3: { name: 'Eucalypt Open Forests', vegetation: 'heavyforest', confidence: 0.9 },
  4: { name: 'Eucalypt Low Open Forests', vegetation: 'heavyforest', confidence: 0.8 },
  5: { name: 'Eucalypt Woodlands', vegetation: 'mediumscrub', confidence: 0.8 },
  6: { name: 'Acacia Forests and Woodlands', vegetation: 'mediumscrub', confidence: 0.7 },
  7: { name: 'Callitris Forests and Woodlands', vegetation: 'heavyforest', confidence: 0.8 },
  8: { name: 'Casuarina Forests and Woodlands', vegetation: 'mediumscrub', confidence: 0.7 },
  9: { name: 'Melaleuca Forests and Woodlands', vegetation: 'heavyforest', confidence: 0.75 },
  10: { name: 'Other Forests and Woodlands', vegetation: 'heavyforest', confidence: 0.7 },
  11: { name: 'Eucalypt Open Woodlands', vegetation: 'lightshrub', confidence: 0.65 },
  12: { name: 'Tropical Eucalypt Woodlands/Grasslands', vegetation: 'grassland', confidence: 0.7 },
  13: { name: 'Acacia Open Woodlands', vegetation: 'lightshrub', confidence: 0.65 },
  14: { name: 'Mallee Woodlands and Shrublands', vegetation: 'mediumscrub', confidence: 0.85 },
  15: { name: 'Low Closed Forests and Tall Closed Shrublands', vegetation: 'mediumscrub', confidence: 0.7 },
  16: { name: 'Acacia Shrublands', vegetation: 'mediumscrub', confidence: 0.8 },
  17: { name: 'Other Shrublands', vegetation: 'mediumscrub', confidence: 0.8 },
  18: { name: 'Heathlands', vegetation: 'mediumscrub', confidence: 0.85 },
  19: { name: 'Tussock Grasslands', vegetation: 'grassland', confidence: 0.95 },
  20: { name: 'Hummock Grasslands', vegetation: 'grassland', confidence: 0.9 },
  21: { name: 'Other Grasslands, Herblands, Sedgelands and Rushlands', vegetation: 'grassland', confidence: 0.9 },
  22: { name: 'Chenopod Shrublands, Samphire Shrublands and Forblands', vegetation: 'lightshrub', confidence: 0.8 },
  23: { name: 'Mangroves', vegetation: 'lightshrub', confidence: 0.5 },
  24: { name: 'Inland Aquatic - freshwater, salt lakes, lagoons', vegetation: 'grassland', confidence: 0.4 },
  25: { name: 'Cleared, non-native vegetation, buildings', vegetation: 'grassland', confidence: 0.5 },
  26: { name: 'Unclassified native vegetation', vegetation: 'mediumscrub', confidence: 0.4 },
  27: { name: 'Naturally bare - sand, rock, claypan, mudflat', vegetation: 'grassland', confidence: 0.4 },
  28: { name: 'Sea and estuaries', vegetation: 'grassland', confidence: 0.3 },
  29: { name: 'Regrowth, modified native vegetation', vegetation: 'mediumscrub', confidence: 0.6 },
  30: { name: 'Unclassified forest', vegetation: 'heavyforest', confidence: 0.6 },
  31: { name: 'Other Open Woodlands', vegetation: 'lightshrub', confidence: 0.6 },
  32: { name: 'Mallee Open Woodlands and Sparse Mallee Shrublands', vegetation: 'mediumscrub', confidence: 0.7 },
  99: { name: 'Unknown / no data', vegetation: 'lightshrub', confidence: 0.3 },
};

/** Map an NVIS Major Vegetation Group number to the app's fuel taxonomy. */
export function mapMVGCode(code: number): { vegetation: VegetationType; confidence: number; name: string } | null {
  const entry = MVG_CLASSES[code];
  if (!entry) return null;
  return { vegetation: entry.vegetation, confidence: entry.confidence, name: entry.name };
}

/**
 * Map an NVIS Major Vegetation Group name to the app's 4-class fuel taxonomy.
 * Used when only a group name (not a numeric code) is available. Ordered rules;
 * first match wins.
 */
export function mapMVGToVegetation(name: string): { vegetation: VegetationType; confidence: number } {
  const n = (name || '').toLowerCase();
  if (!n) return { vegetation: 'lightshrub', confidence: 0.3 };

  const rules: Array<{ re: RegExp; vegetation: VegetationType; confidence: number }> = [
    // Closed/tall forests and dense paperbark/cypress → heavy
    { re: /rainforest|vine thicket|closed forest|tall open forest|open forest|low open forest|melaleuca|callitris/, vegetation: 'heavyforest', confidence: 0.9 },
    // Grasslands / herblands / sedgelands → grassland
    { re: /tussock grass|hummock grass|grassland|herbland|sedgeland|rushland|aquatic/, vegetation: 'grassland', confidence: 0.85 },
    // Mallee, heath, acacia/casuarina/eucalypt woodlands, shrublands → medium scrub
    { re: /mallee|heath|acacia (forest|woodland|shrub)|casuarina|eucalypt woodland|other shrubland|low closed forest|other forests and woodlands/, vegetation: 'mediumscrub', confidence: 0.8 },
    // Sparse chenopod/samphire/saltbush, mangroves, open woodlands → light
    { re: /chenopod|samphire|saltbush|mangrove|open woodland|sparse/, vegetation: 'lightshrub', confidence: 0.7 },
    // Cleared / non-native / bare / water → treat as grassland-equivalent low fuel
    { re: /cleared|non-native|regrowth|naturally bare|salt lake|lake|sea|estuar|water|unknown|no data/, vegetation: 'grassland', confidence: 0.5 },
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
 * Pull a numeric MVG code (1–99) out of an ArcGIS attribute bag. NVIS releases
 * expose the group number under varying field names (MVG_NUMBER, Value, Pixel
 * Value, NVISDSC1, gridcode, …) — try the code-like fields, accept the first
 * value that resolves to a known MVG number.
 */
export function extractMVGCode(attributes: Record<string, unknown>): number | null {
  if (!attributes) return null;
  const keys = Object.keys(attributes);
  const codeKeys = keys.filter((k) =>
    /mvg.*(number|num|code|value)|^value$|pixel\s*value|nvisdsc1|gridcode|^mvg$|raster\.?value/i.test(k)
  );

  const toCode = (raw: unknown): number | null => {
    // Ocean and data gaps come back as the string sentinel "NoData" on the pixel
    // value field. It is NOT a class — it must fall through so the resolver moves
    // to the next source rather than inventing a fuel class. Guard explicitly.
    if (typeof raw === 'string' && /nodata/i.test(raw)) return null;
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    return Number.isInteger(num) && MVG_CLASSES[num] ? num : null;
  };

  // When the service exposes an explicit code/pixel-value field, trust ONLY that.
  // Do not then scan unrelated numeric fields (SORT_ORDER, COUNT, OBJECTID): for a
  // "NoData" pixel those would otherwise resolve to a bogus MVG (e.g. SORT_ORDER
  // "28" → "Sea and estuaries" → grassland), fabricating fuel over open water.
  if (codeKeys.length > 0) {
    for (const k of codeKeys) {
      const code = toCode(attributes[k]);
      if (code != null) return code;
    }
    return null;
  }

  // No recognisable code field (older/variant NVIS releases) — last-resort scan.
  for (const k of keys) {
    const code = toCode(attributes[k]);
    if (code != null) return code;
  }
  return null;
}

/**
 * Pick the Major Vegetation Group name out of an ArcGIS attribute bag without
 * assuming the exact field name (NVIS releases vary: MVG_NAME, MVGROUP, etc.).
 */
export function extractMVGName(attributes: Record<string, unknown>): string | null {
  if (!attributes) return null;
  const keys = Object.keys(attributes);
  const preferred = keys.find((k) => /mvg.*name|mvg_?group|major.*veg|nvisdsc1|mvg$/i.test(k));
  const candidateKey =
    preferred ||
    keys.find((k) => /veg.*(group|name|class|desc)/i.test(k)) ||
    keys.find((k) => typeof attributes[k] === 'string' && (attributes[k] as string).length > 3);
  if (!candidateKey) return null;
  const val = attributes[candidateKey];
  return typeof val === 'string' ? val : val != null ? String(val) : null;
}

/** Resolve an attribute bag to an NVIS fuel-class result (code preferred). */
function resolveFromAttributes(attributes: Record<string, unknown>): NVISResult | null {
  const code = extractMVGCode(attributes);
  if (code != null) {
    const mapped = mapMVGCode(code)!;
    logger.debug(`NVIS resolved MVG ${code} "${mapped.name}" → ${mapped.vegetation} (conf ${mapped.confidence})`);
    return { vegetationType: mapped.vegetation, confidence: mapped.confidence, mvgName: mapped.name, mvgCode: code, source: 'nvis' };
  }
  const name = extractMVGName(attributes);
  if (name) {
    const mapped = mapMVGToVegetation(name);
    logger.debug(`NVIS resolved by name "${name}" → ${mapped.vegetation} (conf ${mapped.confidence}); no MVG code field found`);
    return { vegetationType: mapped.vegetation, confidence: mapped.confidence, mvgName: name, source: 'nvis' };
  }
  return null;
}

/** Build the ArcGIS `identify` URL — the correct op for a raster map service. */
function buildIdentifyUrl(lat: number, lng: number): string {
  // A small map extent around the point keeps identify well-conditioned.
  const d = 0.01;
  const mapExtent = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  return (
    `${NVIS_MVG_URL}/identify` +
    `?f=json&geometry=${encodeURIComponent(lng + ',' + lat)}` +
    `&geometryType=esriGeometryPoint&sr=4326` +
    `&layers=${encodeURIComponent('all:' + NVIS_LAYER_ID)}&tolerance=1` +
    `&mapExtent=${encodeURIComponent(mapExtent)}&imageDisplay=400,400,96` +
    `&returnGeometry=false`
  );
}

/** Build the ArcGIS `query` URL — fallback for feature-layer deployments. */
function buildQueryUrl(lat: number, lng: number): string {
  return (
    `${NVIS_MVG_URL}/${NVIS_LAYER_ID}/query` +
    `?f=json&geometry=${encodeURIComponent(lng + ',' + lat)}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=*&returnGeometry=false`
  );
}

/** Query NVIS for the Major Vegetation Group at a point. Null outside AUS / on failure. */
export async function fetchNVISVegetation(lat: number, lng: number): Promise<NVISResult | null> {
  if (!inAustralia(lat, lng)) return null;

  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (key in cache) return cache[key];

  // 1) identify (raster map service), 2) query (feature layer) as fallback.
  const attempts: Array<() => string> = [
    () => buildIdentifyUrl(lat, lng),
    () => buildQueryUrl(lat, lng),
  ];

  for (const build of attempts) {
    try {
      const resp = await fetch(build());
      if (!resp.ok) {
        logger.warn('NVIS query HTTP', resp.status, resp.statusText);
        continue;
      }
      const json = await resp.json();
      // identify → results[].attributes; query → features[].attributes.
      const attrs: Record<string, unknown> | undefined =
        json?.results?.[0]?.attributes || json?.features?.[0]?.attributes;
      if (!attrs) continue;
      const result = resolveFromAttributes(attrs);
      if (result) {
        cache[key] = result;
        return result;
      }
    } catch (e) {
      logger.warn('NVIS query failed', e);
    }
  }

  cache[key] = null;
  return null;
}

export function _clearNVISCache() {
  Object.keys(cache).forEach((k) => delete cache[k]);
  legendPromise = null;
  tileRasterCache.clear();
}

// ---------------------------------------------------------------------------
// Area raster: ONE `export` image request for a whole corridor/box, decoded
// app-side, instead of one `identify` round trip per sampled point.
//
// WHY: the corridor optimizer needs fuel at hundreds–thousands of hex cells.
// Point-identify per cell scales requests linearly with search area and, at
// any real scale, hammers a free government server that owes us nothing
// (field-confirmed 2026-07-14: "at any sort of scale we will overwhelm the
// upstream API"). NVIS is a ~100 m colormapped raster, so the whole area of
// interest fits in one small PNG: `export` renders the bbox, the legend
// endpoint tells us which colour is which Major Vegetation Group, and every
// local sample after that is a free pixel lookup.
//
// HONESTY: colours are matched against the service's OWN legend (fetched
// once per session, never hardcoded — a re-symbolised release changes both
// together). A pixel that matches no legend colour resolves to null (caller
// falls back to point-identify); transparent pixels are NoData, reported as
// such rather than invented; and an export whose opaque pixels match NOTHING
// is treated as contract drift and discarded entirely so the caller falls
// back to the proven per-point path.
// ---------------------------------------------------------------------------

export interface NVISLegendColor {
  r: number;
  g: number;
  b: number;
  label: string;
  /** MVG code resolved from the label; null when the label maps to no known group. */
  code: number | null;
}

/** Resolve a legend label to an MVG code: leading number first (e.g. "3 -
 *  Eucalypt Open Forests"), then exact/substring name match, longest names
 *  first so "Eucalypt Open Forests" can't swallow "Eucalypt Low Open
 *  Forests". Exported for tests and the canary. */
export function resolveLegendLabelToMVG(label: string): number | null {
  const trimmed = (label || '').trim();
  if (!trimmed) return null;
  const lead = trimmed.match(/^(\d{1,2})\b/);
  if (lead) {
    const n = parseInt(lead[1], 10);
    if (MVG_CLASSES[n]) return n;
  }
  const norm = trimmed.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const byLengthDesc = Object.entries(MVG_CLASSES)
    .map(([codeStr, e]) => ({ code: parseInt(codeStr, 10), name: e.name.toLowerCase().replace(/[^a-z]+/g, ' ').trim() }))
    .sort((a, b) => b.name.length - a.name.length);
  for (const e of byLengthDesc) {
    if (norm === e.name) return e.code;
  }
  for (const e of byLengthDesc) {
    if (norm.includes(e.name)) return e.code;
  }
  return null;
}

/** Nearest legend colour within a small anti-aliasing tolerance; null beyond it. */
export function matchColorToLegend(r: number, g: number, b: number, entries: NVISLegendColor[]): NVISLegendColor | null {
  let best: NVISLegendColor | null = null;
  let bestD = Infinity;
  for (const e of entries) {
    const d = (r - e.r) ** 2 + (g - e.g) ** 2 + (b - e.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return bestD <= 300 ? best : null;
}

export interface NVISAreaRaster {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  width: number;
  height: number;
  /** Per pixel (row-major, top-left origin): MVG code, -1 = NoData
   *  (transparent), 0 = opaque but unmatched (unknown — caller should fall
   *  back to a point query). */
  codes: Int16Array;
  /** True when pixels are coarser than NVIS's native ~100 m (very large bbox
   *  clamped to the export size cap) — samples are still authoritative NVIS,
   *  just lower resolution. */
  coarse: boolean;
}

/** Sample the raster at a point: MVG code, 'nodata', or null (outside bbox /
 *  unmatched pixel). Pure — exported for tests. */
export function rasterCodeAt(raster: NVISAreaRaster, lat: number, lng: number): number | 'nodata' | null {
  if (lat < raster.minLat || lat > raster.maxLat || lng < raster.minLng || lng > raster.maxLng) return null;
  const px = Math.min(raster.width - 1, Math.max(0, Math.floor(((lng - raster.minLng) / (raster.maxLng - raster.minLng)) * raster.width)));
  const py = Math.min(raster.height - 1, Math.max(0, Math.floor(((raster.maxLat - lat) / (raster.maxLat - raster.minLat)) * raster.height)));
  const code = raster.codes[py * raster.width + px];
  if (code === -1) return 'nodata';
  return code > 0 ? code : null;
}

/** Decode an image blob to raw RGBA via canvas. Browser-only; returns null in
 *  environments without canvas (tests) so callers fall back gracefully. */
async function decodeImageBytes(blob: Blob): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null;
    const bmp = await createImageBitmap(blob);
    let ctx: { drawImage: (b: ImageBitmap, x: number, y: number) => void; getImageData: (x: number, y: number, w: number, h: number) => ImageData } | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d') as any;
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      ctx = c.getContext('2d') as any;
    }
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { width: bmp.width, height: bmp.height, data: img.data };
  } catch (e) {
    logger.warn('NVIS image decode failed', e);
    return null;
  }
}

let legendPromise: Promise<NVISLegendColor[] | null> | null = null;

/** The service's own colour→MVG legend, fetched once per session — via the
 *  shared tile-cache API when reachable (blob-cached across users), falling
 *  back to the government service directly. A failed fetch is not cached,
 *  so a later run retries. */
export function fetchNVISLegend(): Promise<NVISLegendColor[] | null> {
  if (legendPromise) return legendPromise;
  legendPromise = (async (): Promise<NVISLegendColor[] | null> => {
    try {
      let json: any = null;
      try {
        const viaApi = await fetch(legendUrl());
        if (viaApi.ok) json = await viaApi.json();
      } catch { /* API unreachable — direct below */ }
      if (!json) {
        const resp = await fetch(`${NVIS_MVG_URL}/legend?f=json`);
        if (!resp.ok) return null;
        json = await resp.json();
      }
      const layer = (json?.layers ?? []).find((l: any) => l?.layerId === NVIS_LAYER_ID) ?? json?.layers?.[0];
      const items: any[] = layer?.legend ?? [];
      const entries: NVISLegendColor[] = [];
      for (const item of items) {
        if (!item?.imageData) continue;
        const bytes = Uint8Array.from(atob(item.imageData), (c) => c.charCodeAt(0));
        const decoded = await decodeImageBytes(new Blob([bytes], { type: item.contentType || 'image/png' }));
        if (!decoded) continue;
        const o = (Math.floor(decoded.height / 2) * decoded.width + Math.floor(decoded.width / 2)) * 4;
        if (decoded.data[o + 3] < 128) continue;
        entries.push({
          r: decoded.data[o],
          g: decoded.data[o + 1],
          b: decoded.data[o + 2],
          label: item.label ?? '',
          code: resolveLegendLabelToMVG(item.label ?? ''),
        });
      }
      // NVIS has 33 classes; far fewer decodable swatches means we hit the
      // wrong layer or the legend shape drifted — don't colour-match against it.
      if (entries.filter((e) => e.code != null).length < 15) return null;
      return entries;
    } catch (e) {
      logger.warn('NVIS legend fetch failed', e);
      return null;
    }
  })().then((result) => {
    if (result === null) legendPromise = null;
    return result;
  });
  return legendPromise;
}

/** NVIS's native grid is ~100 m ≈ 0.001°. */
const NATIVE_PIXEL_DEG = 0.001;
const MAX_EXPORT_PX = 1000;

/**
 * Fetch the MVG raster for a bbox as ONE export image and decode it to per-
 * pixel codes. Null on any failure (legend unavailable, export error, decode
 * unsupported, or zero opaque pixels matching the legend — contract drift),
 * signalling the caller to fall back to per-point identify.
 */
export async function fetchNVISAreaRaster(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  signal?: AbortSignal
): Promise<NVISAreaRaster | null> {
  if (maxLat <= minLat || maxLng <= minLng) return null;
  if (maxLat < AUS_BBOX.minLat || minLat > AUS_BBOX.maxLat || maxLng < AUS_BBOX.minLng || minLng > AUS_BBOX.maxLng) return null;

  const legend = await fetchNVISLegend();
  if (!legend || signal?.aborted) return null;

  let width = Math.ceil((maxLng - minLng) / NATIVE_PIXEL_DEG);
  let height = Math.ceil((maxLat - minLat) / NATIVE_PIXEL_DEG);
  let coarse = false;
  const maxSide = Math.max(width, height);
  if (maxSide > MAX_EXPORT_PX) {
    const scale = MAX_EXPORT_PX / maxSide;
    width = Math.max(2, Math.round(width * scale));
    height = Math.max(2, Math.round(height * scale));
    coarse = true;
  }
  width = Math.max(2, width);
  height = Math.max(2, height);

  const url =
    `${NVIS_MVG_URL}/export?f=image&format=png&transparent=true` +
    `&bbox=${minLng},${minLat},${maxLng},${maxLat}&bboxSR=4326&imageSR=4326` +
    `&size=${width},${height}&layers=${encodeURIComponent('show:' + NVIS_LAYER_ID)}`;
  try {
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      logger.warn('NVIS export HTTP', resp.status, resp.statusText);
      return null;
    }
    return await decodeExportBlobToRaster(await resp.blob(), { minLat, minLng, maxLat, maxLng }, legend, coarse);
  } catch (e) {
    logger.warn('NVIS area export failed', e);
    return null;
  }
}

/** Decode an export PNG blob into a code raster. Shared by the direct-bbox
 *  path above and the tiled path below. Null on decode failure or when no
 *  opaque pixel matches the legend (contract drift — a silent all-estimated
 *  area would be worse than slow point queries). */
async function decodeExportBlobToRaster(
  blob: Blob,
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  legend: NVISLegendColor[],
  coarse: boolean
): Promise<NVISAreaRaster | null> {
  const decoded = await decodeImageBytes(blob);
  if (!decoded) return null;

  const codes = new Int16Array(decoded.width * decoded.height);
  // The raster has ≤34 distinct colours; memoise colour→code so the match
  // loop is a map hit per pixel, not 33 distance computations.
  const colourMemo = new Map<number, number>();
  let matched = 0;
  let opaque = 0;
  for (let i = 0; i < codes.length; i++) {
    const o = i * 4;
    if (decoded.data[o + 3] < 128) {
      codes[i] = -1; // NoData — honest gap, never a fuel class
      continue;
    }
    opaque++;
    const packed = (decoded.data[o] << 16) | (decoded.data[o + 1] << 8) | decoded.data[o + 2];
    let code = colourMemo.get(packed);
    if (code === undefined) {
      code = matchColorToLegend(decoded.data[o], decoded.data[o + 1], decoded.data[o + 2], legend)?.code ?? 0;
      colourMemo.set(packed, code);
    }
    codes[i] = code;
    if (code > 0) matched++;
  }
  if (opaque > 0 && matched === 0) {
    logger.warn('NVIS export decoded but no pixel matched the legend — falling back');
    return null;
  }
  logger.debug(`NVIS raster ${decoded.width}×${decoded.height}, ${matched}/${opaque} opaque pixels matched${coarse ? ' (coarse)' : ''}`);
  return { ...bounds, width: decoded.width, height: decoded.height, codes, coarse };
}

// Decoded tile rasters, memoised for the session: repeat corridors (or a
// nudged line) re-use the decode, not just the browser's HTTP cache.
const tileRasterCache = new Map<string, NVISAreaRaster>();

/**
 * Fetch the MVG raster for a bbox as CACHED TILES via the shared cross-user
 * tile API (`/api/vegetation/tile/nvis/{tx}/{ty}` — blob-backed, so during
 * an incident the government server is hit once per tile per 90 days, not
 * once per user). Tiles are large (0.5° ≈ 55 km at native resolution) so
 * coverage builds out and minor line adjustments are free. Returns one
 * raster per tile, or null when the API/decode is unavailable or the bbox
 * needs more than MAX_NVIS_TILES — callers fall back to the direct
 * single-export path.
 */
export async function fetchNVISAreaRastersTiled(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  signal?: AbortSignal
): Promise<NVISAreaRaster[] | null> {
  if (maxLat <= minLat || maxLng <= minLng) return null;
  if (maxLat < AUS_BBOX.minLat || minLat > AUS_BBOX.maxLat || maxLng < AUS_BBOX.minLng || minLng > AUS_BBOX.maxLng) return null;
  const tiles = tilesCovering({ minLat, minLng, maxLat, maxLng }, NVIS_TILE_DEG, MAX_NVIS_TILES);
  if (!tiles || tiles.length === 0) return null;

  const legend = await fetchNVISLegend();
  if (!legend || signal?.aborted) return null;

  const rasters: NVISAreaRaster[] = [];
  const misses: typeof tiles = [];
  for (const t of tiles) {
    const cached = tileRasterCache.get(`${t.tx},${t.ty}`);
    if (cached) rasters.push(cached);
    else misses.push(t);
  }

  try {
    const CONCURRENCY = 4;
    let cursor = 0;
    let failed = false;
    const worker = async () => {
      while (cursor < misses.length && !failed) {
        if (signal?.aborted) { failed = true; return; }
        const t = misses[cursor++];
        const resp = await fetch(tileUrl('nvis', t), { signal });
        if (!resp.ok) { failed = true; return; }
        const raster = await decodeExportBlobToRaster(await resp.blob(), tileBounds(t.tx, t.ty, NVIS_TILE_DEG), legend, false);
        if (!raster) { failed = true; return; }
        tileRasterCache.set(`${t.tx},${t.ty}`, raster);
        rasters.push(raster);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, misses.length) }, worker));
    if (failed) return null;
    return rasters;
  } catch (e) {
    logger.debug('NVIS tile API unavailable, falling back to direct export', e);
    return null;
  }
}
