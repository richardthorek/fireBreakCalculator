/**
 * Client for the backend elevation-profile endpoint.
 * One request returns elevations for all sample points along a line, replacing
 * hundreds of client-side Terrain-RGB tile fetches. Falls back silently
 * (returns null) when the backend or a DEM source is unavailable, so the caller
 * can use its existing per-point elevation path.
 */

import { logger } from './logger';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

export interface ElevationProfileResponse {
  elevations: number[];
  source: 'dem' | 'unavailable';
  estimated: boolean;
}

/**
 * Fetch elevations for an ordered list of points. Returns null on any failure
 * or when the backend reports no authoritative DEM source, signalling the
 * caller to fall back.
 */
export async function fetchElevationProfile(
  points: { lat: number; lng: number }[]
): Promise<ElevationProfileResponse | null> {
  if (points.length === 0) return null;
  try {
    const resp = await fetch(`${baseUrl}/elevation/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as ElevationProfileResponse;
    if (!json || json.source !== 'dem' || !Array.isArray(json.elevations)) return null;
    if (json.elevations.length !== points.length) return null;
    return json;
  } catch (e) {
    logger.debug('Elevation profile backend unavailable, falling back to tiles', e);
    return null;
  }
}
