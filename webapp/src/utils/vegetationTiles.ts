/**
 * Quantised vegetation tile grid — client half of the shared cross-user
 * tile cache (`/api/vegetation/tile`, see api/src/services/
 * vegetationTileService.ts for the why and the blob layout).
 *
 * Constants here MUST match the API's: identical grids are what make two
 * users' overlapping corridors resolve to identical cache keys. Tiles are
 * deliberately large (NVIS 0.5° ≈ 55 km) so one fetch builds out local
 * coverage — a minor adjustment to the drawn line stays inside tiles the
 * session (or another user, via the blob) has already paid for.
 */

export const NVIS_TILE_DEG = 0.5;
export const NSW_TILE_DEG = 0.05;

/** Covering-tile caps: a request wider than this falls back to the direct
 *  single-bbox path rather than firing an unbounded tile fan-out. */
export const MAX_NVIS_TILES = 12;
export const MAX_NSW_TILES = 48;

export interface TileIndex { tx: number; ty: number }
export interface TileBoundsDeg { minLat: number; minLng: number; maxLat: number; maxLng: number }

export function tileBounds(tx: number, ty: number, tileDeg: number): TileBoundsDeg {
  return {
    minLng: tx * tileDeg,
    minLat: ty * tileDeg,
    maxLng: (tx + 1) * tileDeg,
    maxLat: (ty + 1) * tileDeg,
  };
}

/** All tiles overlapping the bounds, or null when the fan-out would exceed
 *  `maxTiles` (caller falls back to its direct path). */
export function tilesCovering(bounds: TileBoundsDeg, tileDeg: number, maxTiles: number): TileIndex[] | null {
  const txMin = Math.floor(bounds.minLng / tileDeg);
  const txMax = Math.floor(bounds.maxLng / tileDeg);
  const tyMin = Math.floor(bounds.minLat / tileDeg);
  const tyMax = Math.floor(bounds.maxLat / tileDeg);
  const count = (txMax - txMin + 1) * (tyMax - tyMin + 1);
  if (count > maxTiles) return null;
  const out: TileIndex[] = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) out.push({ tx, ty });
  }
  return out;
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';

export const tileUrl = (source: 'nvis' | 'nsw', t: TileIndex) => `${apiBase}/vegetation/tile/${source}/${t.tx}/${t.ty}`;
export const legendUrl = () => `${apiBase}/vegetation/legend`;
