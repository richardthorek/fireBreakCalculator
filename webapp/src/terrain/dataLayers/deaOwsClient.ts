/**
 * Shared client for Digital Earth Australia's Open Data Cube OWS instance
 * (`ows.dea.ga.gov.au` — the open-source `datacube-ows` server; DEA's own
 * pages describe it as the WMS/WMTS/WCS endpoint for "Fractional Cover" and
 * related Tier-1 products docs/ROUTE_INTELLIGENCE.md §10.3(c)/§11.7 name).
 * Shared by `deaWaterObservationsService.ts` and `deaFractionalCoverService.ts`
 * — same pattern as this app's existing `vegetationTiles.ts` sharing tiling
 * helpers between `nvisVegetationService.ts` and `nswVegetationService.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS LIVE-VERIFIED THIS SESSION (via `curl`, not just researched)
 * ---------------------------------------------------------------------------
 *  - `GET https://ows.dea.ga.gov.au/?service=WMS&version=1.3.0&request=
 *    GetCapabilities` returns a real ~1.6 MB WMS 1.3.0 capabilities document
 *    listing (among others) `ga_ls_wo_fq_myear_3` ("DEA Water Observations
 *    Multi Year (Landsat)", 1986–near present) and `ga_ls_fc_pc_cyear_3`
 *    ("DEA Fractional Cover Percentiles Calendar Year (Landsat)") as the
 *    CURRENT, non-deprecated Collection-3 products — several OLDER WOfS
 *    layers on the same server (`wofs_filtered_summary`, `wofs_summary_clear`,
 *    `wofs_summary_wet`, `WOfS_frequency`, `wofs_filtered_summary_confidence`)
 *    are explicitly titled "...(Landsat, DEPRECATED)" in their own
 *    `<Title>` and are deliberately NOT used here.
 *  - This instance does **NOT** accept `CRS=CRS:84` (confirmed live —
 *    `ServiceException code="InvalidCRS"`, listing its actual supported CRS
 *    set: EPSG:4326, EPSG:3857, EPSG:3577, EPSG:4283, EPSG:3111, EPSG:32756,
 *    EPSG:3832, WIKID:102171). Unlike NAFI's GeoServer, this client uses
 *    `CRS=EPSG:4326` with the WMS 1.3.0-correct (lat, lon) BBOX axis order —
 *    verified live against a known permanent waterbody (Lake Argyle, WA,
 *    128.75°E/16.20°S), which returned a plausible `frequency: 0.966`.
 *  - `INFO_FORMAT=text/plain` is NOT supported (confirmed live — only
 *    `application/json` and `text/html` are offered); this client always
 *    requests `application/json`.
 *  - The GetFeatureInfo JSON shape is `datacube-ows`'s own nested format —
 *    NOT the flat GeoServer `{"properties":{"_":value}}` shape
 *    `nafiFireHistoryService.ts` (a different server) uses:
 *    `properties.data[]` is an array of `{ time, bands: {...} }` entries (one
 *    per queried time-slice — a static "multi-year" product returns exactly
 *    one entry whose `time` is its own nominal reference date), plus a
 *    top-level `data_available_for_dates` listing every valid `TIME=` value
 *    for that layer/pixel. Confirmed live for both products this session —
 *    see the two service modules for the actual band names and example
 *    values observed.
 *  - Band values in `bands` are usually numbers, but come back as the
 *    STRING `"n/a"` for a masked/invalid pixel (observed live: Fractional
 *    Cover over open water returns `"n/a"` for every band, with
 *    `qa: { "Quality Assurance": "insufficient observations wet" }` — the
 *    product's own documented water/cloud masking, not a bug). Every band
 *    read in the two service modules is therefore explicitly type-guarded
 *    for `"n/a"` / non-numeric rather than assumed numeric.
 *  - Omitting `TIME=` on a per-composite product (`ga_ls_fc_pc_cyear_3`) was
 *    OBSERVED to default to the most recent available composite (returned
 *    `time: "2025-01-01"` live, in July 2026) — this is an OBSERVED runtime
 *    behaviour, not documented API contract, so `deaFractionalCoverService.ts`
 *    surfaces the actual `time` the server answered with in its result
 *    rather than assuming the default will always mean "latest".
 *
 * ---------------------------------------------------------------------------
 * RESILIENCE — same discipline as nvisVegetationService.ts: never throws,
 * resolves to `null` outside the technical bbox, on any HTTP failure, or on
 * a response shape that doesn't parse as expected.
 */

import { logger } from '../../utils/logger';

const DEA_OWS_BASE = (import.meta.env.VITE_DEA_OWS_URL as string | undefined) || 'https://ows.dea.ga.gov.au/';

/** Technical extent, read from the live GetCapabilities document this
 *  session (`ga_ls_fc_3`'s EX_GeographicBoundingBox — the widest of the
 *  layers inspected, covering the mainland, Tasmania and near offshore
 *  territories). Hard gate — short-circuits queries with no chance of data. */
export const DEA_TECHNICAL_BBOX = { minLng: 70.0, maxLng: 170.0, minLat: -55.6, maxLat: -7.6 };

export const inDeaTechnicalBbox = (lat: number, lng: number): boolean =>
  lat >= DEA_TECHNICAL_BBOX.minLat && lat <= DEA_TECHNICAL_BBOX.maxLat &&
  lng >= DEA_TECHNICAL_BBOX.minLng && lng <= DEA_TECHNICAL_BBOX.maxLng;

/** One `data[]` entry from a datacube-ows GetFeatureInfo response — one
 *  queried time-slice's band values. Band values are `unknown` because they
 *  are numbers for a valid pixel but the literal string `"n/a"` (or a nested
 *  QA object, for the `qa`/`land` pseudo-bands) for a masked one — callers
 *  must type-guard, never assume numeric. */
export interface DeaFeatureInfoTimeSlice {
  time: string;
  bands: Record<string, unknown>;
}

export interface DeaFeatureInfoResponse {
  /** Empty when `TIME=` was omitted and the server has no "answer with the
   *  latest" behaviour for that layer (observed to happen for the per-scene
   *  `ga_ls_fc_3`, which needs an explicit TIME — see module header). */
  data: DeaFeatureInfoTimeSlice[];
  dataAvailableForDates: string[];
  lon: number;
  lat: number;
}

/** Extract a finite number from a raw band value, or null for `"n/a"` /
 *  anything else non-numeric (the masked-pixel case — see module header).
 *  Exported so both service modules share one guard rather than each
 *  re-implementing the `"n/a"` check slightly differently. */
export function numericBand(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/**
 * Query one DEA OWS layer's GetFeatureInfo at a point. `time` is an optional
 * `YYYY-MM-DD` (or the layer's own valid TIME token) — omit for a layer whose
 * "no TIME given" behaviour is to answer with its most recent composite (see
 * module header; `deaFractionalCoverService.ts` relies on this, observed
 * live, and reports back whichever `time` the server actually used).
 * Null on any failure or outside the technical bbox — never throws.
 */
export async function fetchDeaFeatureInfo(
  layer: string,
  lat: number,
  lng: number,
  time?: string,
  signal?: AbortSignal
): Promise<DeaFeatureInfoResponse | null> {
  if (!inDeaTechnicalBbox(lat, lng)) return null;

  const d = 0.01; // ~1.1 km pad, comfortably larger than one 25-30 m native pixel
  const minLat = lat - d, maxLat = lat + d, minLng = lng - d, maxLng = lng + d;
  // WMS 1.3.0 + EPSG:4326 uses (lat, lon) axis order — confirmed live this
  // session (CRS:84, which sidesteps this on NAFI's GeoServer, is rejected
  // here; EPSG:4326 in (lat, lon) order is the combination that worked).
  let url =
    `${DEA_OWS_BASE}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo` +
    `&LAYERS=${encodeURIComponent(layer)}&QUERY_LAYERS=${encodeURIComponent(layer)}&STYLES=` +
    `&CRS=EPSG:4326&BBOX=${minLat},${minLng},${maxLat},${maxLng}` +
    `&WIDTH=101&HEIGHT=101&I=50&J=50` +
    `&INFO_FORMAT=application/json&FEATURE_COUNT=1`;
  if (time) url += `&TIME=${encodeURIComponent(time)}`;

  try {
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      logger.warn('DEA OWS GetFeatureInfo HTTP', layer, resp.status, resp.statusText);
      return null;
    }
    const json = await resp.json();
    const feature = json?.features?.[0];
    const props = feature?.properties;
    if (!props || typeof props !== 'object') return null;
    const data: unknown = props.data;
    if (!Array.isArray(data)) return null;
    const slices: DeaFeatureInfoTimeSlice[] = data
      .filter((d): d is { time: unknown; bands: unknown } => !!d && typeof d === 'object')
      .map((d) => ({
        time: typeof d.time === 'string' ? d.time : '',
        bands: d.bands && typeof d.bands === 'object' ? (d.bands as Record<string, unknown>) : {},
      }));
    const dataAvailableForDates: string[] = Array.isArray(props.data_available_for_dates)
      ? props.data_available_for_dates.filter((x: unknown): x is string => typeof x === 'string')
      : [];
    return {
      data: slices,
      dataAvailableForDates,
      lon: typeof props.lon === 'number' ? props.lon : lng,
      lat: typeof props.lat === 'number' ? props.lat : lat,
    };
  } catch (e) {
    logger.warn('DEA OWS GetFeatureInfo failed', layer, e);
    return null;
  }
}
