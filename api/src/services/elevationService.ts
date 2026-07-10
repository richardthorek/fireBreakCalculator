/**
 * Server-side elevation profile service.
 *
 * WHY: slope was computed client-side by fetching Mapbox Terrain-RGB PNG tiles
 * and decoding pixels — many requests per line, ~5 m pixels dominated by DEM
 * noise. Sampling a proper bare-earth DEM server-side gives one request per
 * line and, for Australia, far better vertical accuracy.
 *
 * PRIMARY provider: an ArcGIS ImageServer exposing a bare-earth DEM, queried
 * with `getSamples` (a single call returns elevations for all points). The
 * endpoint is configurable via DEM_IMAGESERVER_URL so it can be pointed at the
 * Geoscience Australia national 1-second/5 m DEM (or any equivalent) without a
 * code change. If unset or the call fails, the caller falls back to the
 * existing client-side Terrain-RGB path, so nothing breaks.
 *
 * This module is pure/queryable and unit-tested via parseGetSamplesResponse().
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ElevationProfileResult {
  elevations: number[];
  /** Which provider produced the values. */
  source: 'dem' | 'unavailable';
  /** True when values are estimated/absent rather than authoritative DEM samples. */
  estimated: boolean;
}

// Configurable DEM ImageServer (ArcGIS). Example (verify before prod):
//   https://services.ga.gov.au/gis/rest/services/DEM_SRTM_1Second_Hydro_Enforced/ImageServer
const DEM_IMAGESERVER_URL = process.env.DEM_IMAGESERVER_URL || '';

/**
 * Parse an ArcGIS ImageServer `getSamples` response into an ordered elevation
 * array. Kept pure so it can be unit-tested without network access.
 *
 * @param json Raw getSamples JSON.
 * @param expectedCount Number of input points (to align/pad the output).
 */
export function parseGetSamplesResponse(json: any, expectedCount: number): number[] {
  const samples: any[] = Array.isArray(json?.samples) ? json.samples : [];
  const out = new Array<number>(expectedCount).fill(NaN);
  for (const s of samples) {
    // locationId is the 0-based index of the input point when points are sent
    // as an ordered multipoint. Fall back to array order if absent.
    const idx = typeof s?.locationId === 'number' ? s.locationId : samples.indexOf(s);
    const raw = s?.value ?? (Array.isArray(s?.values) ? s.values[0] : undefined);
    const val = typeof raw === 'string' ? parseFloat(raw) : raw;
    if (idx >= 0 && idx < expectedCount && typeof val === 'number' && !Number.isNaN(val)) {
      out[idx] = val;
    }
  }
  return out;
}

/** Build the getSamples query URL + body for an ordered set of points. */
export function buildGetSamplesUrl(baseUrl: string, points: LatLng[]): string {
  const multipoint = {
    points: points.map((p) => [p.lng, p.lat]),
    spatialReference: { wkid: 4326 },
  };
  const params = new URLSearchParams({
    f: 'json',
    geometryType: 'esriGeometryMultipoint',
    geometry: JSON.stringify(multipoint),
    returnFirstValueOnly: 'true',
    outSR: '4326',
  });
  return `${baseUrl.replace(/\/$/, '')}/getSamples?${params.toString()}`;
}

/**
 * Fetch an elevation profile for an ordered list of points. Returns
 * `source: 'unavailable'` (all NaN) when no DEM endpoint is configured or the
 * request fails — the caller then falls back to its own elevation source.
 */
export async function getElevationProfile(points: LatLng[]): Promise<ElevationProfileResult> {
  if (!DEM_IMAGESERVER_URL || points.length === 0) {
    return { elevations: points.map(() => NaN), source: 'unavailable', estimated: true };
  }
  try {
    const url = buildGetSamplesUrl(DEM_IMAGESERVER_URL, points);
    const resp = await fetch(url);
    if (!resp.ok) {
      return { elevations: points.map(() => NaN), source: 'unavailable', estimated: true };
    }
    const json = await resp.json();
    const elevations = parseGetSamplesResponse(json, points.length);
    const anyValid = elevations.some((e) => !Number.isNaN(e));
    return anyValid
      ? { elevations, source: 'dem', estimated: false }
      : { elevations, source: 'unavailable', estimated: true };
  } catch {
    return { elevations: points.map(() => NaN), source: 'unavailable', estimated: true };
  }
}
