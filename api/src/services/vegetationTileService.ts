/**
 * Shared vegetation tile cache — quantised tiles, blob-backed, cross-user.
 *
 * WHY: the webapp resolves fuel from area queries (one NVIS export image +
 * NSW SVTM polygon queries — see webapp stateVegetationRouter). Those calls
 * previously went browser → government server per user. During an incident,
 * many users work the same ground; this endpoint makes the upstream cost
 * per-TILE-per-90-days instead of per-user: the first request for a tile
 * fetches it upstream once and stores it in the existing storage account's
 * blob container; every later request — any user — is a blob read.
 *
 * Tiles are QUANTISED (fixed grid, integer indices) so different users'
 * overlapping corridors resolve to identical cache keys — a raw bbox key
 * would essentially never collide across users. Tiles are also deliberately
 * LARGE (NVIS 0.5° ≈ 55 km at the raster's native ~100 m/px = 500×500 px,
 * comfortably under the export size cap) so one fetch builds out local
 * coverage and minor line adjustments stay within already-cached tiles.
 * NSW tiles are smaller (0.05° ≈ 5.5 km) because PCT polygon density, not
 * image size, is the limit — each tile query is paginated up to a few pages
 * and abandoned (uncached) if the feature count still exceeds the limit.
 *
 * The client keeps its direct-to-government path as the fallback when this
 * endpoint is unreachable (offline-capable deployments, local dev without
 * storage), so the cache is an accelerator, never a dependency.
 *
 * Blob layout (v1 in the path so the contract can be versioned):
 *   vegtiles/nvis/v1/{tx}_{ty}.png      — raw export PNG, native resolution
 *   vegtiles/nsw/v1/{tx}_{ty}.json      — { features: [...] } merged pages
 *   vegtiles/nvis-legend/v1.json        — raw legend?f=json response
 * A Bicep lifecycle rule deletes blobs older than 90 days (vegetation
 * changes on a timescale of years; the canary watches for contract drift).
 */

import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';

// ---- Tile grid (MUST match webapp/src/utils/vegetationTiles.ts) ----
export const NVIS_TILE_DEG = 0.5;
export const NSW_TILE_DEG = 0.05;

/** Rough continental bounds — reject tile indices outside Australia. */
const AUS_BBOX = { minLat: -44.0, maxLat: -9.0, minLng: 112.0, maxLng: 154.5 };

export interface TileBounds { minLat: number; minLng: number; maxLat: number; maxLng: number }

export function tileBounds(tx: number, ty: number, tileDeg: number): TileBounds {
  return {
    minLng: tx * tileDeg,
    minLat: ty * tileDeg,
    maxLng: (tx + 1) * tileDeg,
    maxLat: (ty + 1) * tileDeg,
  };
}

/** A tile index is valid when it's an integer and its tile overlaps Australia. */
export function isValidTileIndex(tx: number, ty: number, tileDeg: number): boolean {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return false;
  const b = tileBounds(tx, ty, tileDeg);
  return b.maxLat >= AUS_BBOX.minLat && b.minLat <= AUS_BBOX.maxLat &&
    b.maxLng >= AUS_BBOX.minLng && b.minLng <= AUS_BBOX.maxLng;
}

// ---- Upstream endpoints (env-overridable, mirrors the webapp services) ----
const NVIS_MVG_URL = process.env.NVIS_MVG_URL ||
  'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer';
const NSW_SVTM_BASE = process.env.NSW_SVTM_URL ||
  'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer';
const NSW_FEATURE_LAYER = 3;

const UPSTREAM_TIMEOUT_MS = 25_000;
/** NVIS native ~100 m ≈ 0.001° → a 0.5° tile is 500 px. */
const NVIS_PX_PER_TILE = Math.round(NVIS_TILE_DEG / 0.001);
/** Max ArcGIS result pages merged per NSW tile before giving up (uncached). */
const NSW_MAX_PAGES = 4;

const CONTAINER = process.env.VEG_TILES_CONTAINER || 'vegtiles';

let containerPromise: Promise<ContainerClient | null> | null = null;

/** Container client from the existing storage connection string; null when
 *  storage isn't configured (local dev) — callers then pass through. */
function getContainer(): Promise<ContainerClient | null> {
  if (!containerPromise) {
    containerPromise = (async () => {
      const conn = process.env.TABLES_CONNECTION_STRING;
      if (!conn) return null;
      try {
        const svc = BlobServiceClient.fromConnectionString(conn);
        const container = svc.getContainerClient(CONTAINER);
        await container.createIfNotExists();
        return container;
      } catch {
        containerPromise = null; // retry next request
        return null;
      }
    })();
  }
  return containerPromise;
}

async function readBlob(container: ContainerClient, name: string): Promise<Buffer | null> {
  try {
    const blob = container.getBlockBlobClient(name);
    if (!(await blob.exists())) return null;
    return await blob.downloadToBuffer();
  } catch {
    return null;
  }
}

async function writeBlob(container: ContainerClient, name: string, data: Buffer, contentType: string): Promise<void> {
  try {
    await container.getBlockBlobClient(name).uploadData(data, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
  } catch {
    // A failed cache write must not fail the request — next caller refetches.
  }
}

async function fetchUpstream(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`upstream HTTP ${resp.status}`);
  return {
    bytes: Buffer.from(await resp.arrayBuffer()),
    contentType: resp.headers.get('content-type') || 'application/octet-stream',
  };
}

export interface TileResult { bytes: Buffer; contentType: string; cacheHit: boolean }

/** NVIS export PNG for a tile, blob-cached. Throws on upstream failure. */
export async function getNvisTile(tx: number, ty: number): Promise<TileResult> {
  const name = `nvis/v1/${tx}_${ty}.png`;
  const container = await getContainer();
  if (container) {
    const cached = await readBlob(container, name);
    if (cached) return { bytes: cached, contentType: 'image/png', cacheHit: true };
  }
  const b = tileBounds(tx, ty, NVIS_TILE_DEG);
  const url =
    `${NVIS_MVG_URL}/export?f=image&format=png&transparent=true` +
    `&bbox=${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}&bboxSR=4326&imageSR=4326` +
    `&size=${NVIS_PX_PER_TILE},${NVIS_PX_PER_TILE}&layers=${encodeURIComponent('show:0')}`;
  const { bytes } = await fetchUpstream(url);
  // PNG signature guard — never cache an HTML error page as a tile.
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) throw new Error('upstream export did not return a PNG');
  if (container) await writeBlob(container, name, bytes, 'image/png');
  return { bytes, contentType: 'image/png', cacheHit: false };
}

/** NVIS legend JSON, blob-cached. Throws on upstream failure. */
export async function getNvisLegend(): Promise<TileResult> {
  const name = 'nvis-legend/v1.json';
  const container = await getContainer();
  if (container) {
    const cached = await readBlob(container, name);
    if (cached) return { bytes: cached, contentType: 'application/json', cacheHit: true };
  }
  const { bytes } = await fetchUpstream(`${NVIS_MVG_URL}/legend?f=json`);
  const parsed = JSON.parse(bytes.toString('utf-8'));
  if (!Array.isArray(parsed?.layers)) throw new Error('legend response has no layers[]');
  if (container) await writeBlob(container, name, bytes, 'application/json');
  return { bytes, contentType: 'application/json', cacheHit: false };
}

/**
 * NSW SVTM features for a tile, blob-cached: envelope query, paginated and
 * merged. If features still exceed the transfer limit after NSW_MAX_PAGES,
 * returns `{ exceeded: true }` WITHOUT caching, so the client discards the
 * tile (partial polygon sets misclassify) and a later request can retry.
 */
export async function getNswTile(tx: number, ty: number): Promise<TileResult & { exceeded?: boolean }> {
  const name = `nsw/v1/${tx}_${ty}.json`;
  const container = await getContainer();
  if (container) {
    const cached = await readBlob(container, name);
    if (cached) return { bytes: cached, contentType: 'application/json', cacheHit: true };
  }
  const b = tileBounds(tx, ty, NSW_TILE_DEG);
  const envelope = JSON.stringify({ xmin: b.minLng, ymin: b.minLat, xmax: b.maxLng, ymax: b.maxLat, spatialReference: { wkid: 4326 } });
  const base =
    `${NSW_SVTM_BASE}/${NSW_FEATURE_LAYER}/query?f=json` +
    `&geometry=${encodeURIComponent(envelope)}` +
    `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=${encodeURIComponent('OBJECTID,vegClass,vegForm,PCTName')}&returnGeometry=true&outSR=4326` +
    `&maxAllowableOffset=0.0002&geometryPrecision=5`;

  const features: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < NSW_MAX_PAGES; page++) {
    const { bytes } = await fetchUpstream(`${base}&resultOffset=${offset}`);
    const json = JSON.parse(bytes.toString('utf-8'));
    if (json?.error) throw new Error(`upstream query error ${json.error?.code ?? ''}`);
    const feats: unknown[] = Array.isArray(json?.features) ? json.features : [];
    features.push(...feats);
    if (!json?.exceededTransferLimit) {
      const merged = Buffer.from(JSON.stringify({ features }), 'utf-8');
      if (container) await writeBlob(container, name, merged, 'application/json');
      return { bytes: merged, contentType: 'application/json', cacheHit: false };
    }
    offset += feats.length;
    if (feats.length === 0) break; // defensive: exceeded but empty page
  }
  return {
    bytes: Buffer.from(JSON.stringify({ exceeded: true }), 'utf-8'),
    contentType: 'application/json',
    cacheHit: false,
    exceeded: true,
  };
}

/** Reset memoised container (tests). @internal */
export function _resetTileCache() {
  containerPromise = null;
}
