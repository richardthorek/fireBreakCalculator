/**
 * DEA Fractional Cover — docs/ROUTE_INTELLIGENCE.md §10.3(c), §11.7, §10.7
 * M3c: "Separates green grass from dry grass from bare ground — operationally
 * the difference between a highway, a fire risk, and a bog."
 *
 * Layer: `ga_ls_fc_pc_cyear_3` ("DEA Fractional Cover Percentiles Calendar
 * Year (Landsat)", Collection 3, 30 m — NOTE: this app's own docs describe
 * DEA Fractional Cover as "25 m"; the live capabilities document's own title
 * and pixel geometry for this Collection-3 product both say 30 m. Recorded
 * here as a discrepancy between docs' prose and the live product actually
 * queried, not silently reconciled — whoever wires this in should confirm
 * which figure the rest of the mode's resolution assumptions depend on).
 * This is a CALENDAR-YEAR composite (one value per year, each summarising
 * that year's clear Landsat observations at 10th/50th/90th percentile) —
 * docs describes the broader family as a "seasonal time series"; what this
 * module actually queries is annual, not sub-annual seasonal, granularity.
 * That is the real product's real granularity, not a shortfall of this
 * module — stated plainly rather than silently claiming "seasonal".
 *
 * LIVE-VERIFIED this session (via `curl`):
 *  - Omitting `TIME=` returned the most recent available annual composite
 *    (`time: "2025-01-01"`, live in July 2026) — see `deaOwsClient.ts`
 *    header for why this is treated as an OBSERVED behaviour, not assumed
 *    documented contract; this module always returns the actual `time` the
 *    server answered with.
 *  - A LAND pixel (145.00°E, 30.00°S, western NSW plains) returned real,
 *    physically sane values: `bs_pc_50: 28, pv_pc_50: 29, npv_pc_50: 43`
 *    (bare + green + dry ≈ 100%, `qa: "sufficient observations"`).
 *  - A WATER pixel (Lake Argyle, WA) returned `"n/a"` for every band with
 *    `qa: "insufficient observations wet"` — the product's own documented
 *    WOfS-based water/cloud masking (its abstract: "Fractional Cover
 *    products use Water Observations from Space (WOfS) to mask out areas of
 *    water, cloud and other phenomena"), not a bug. This module treats that
 *    case as "no answer", never as 0% cover.
 */

import { fetchDeaFeatureInfo, numericBand } from './deaOwsClient';

const LAYER = 'ga_ls_fc_pc_cyear_3';

export interface FractionalCoverResult {
  /** Median (50th percentile) green/photosynthetic vegetation cover, %. */
  greenPct: number;
  /** Median non-photosynthetic (dry/dead) vegetation cover, %. */
  dryPct: number;
  /** Median bare-soil cover, %. */
  barePct: number;
  /** The calendar-year composite actually returned (see module header —
   *  reported explicitly rather than assumed from an omitted TIME param). */
  year: string;
  confidence: 'published';
  source: string;
}

/**
 * Query DEA's Fractional Cover percentile-calendar-year composite at a
 * point, for the most recent available year unless `year` (a `YYYY-01-01`
 * TIME token — see `dataAvailableForDates` on a raw `fetchDeaFeatureInfo`
 * call for the valid set) is given. Null outside the technical extent, on
 * any network/parse failure, or when the pixel is masked (water/cloud/
 * insufficient observations — the product's own "n/a", never fabricated as
 * 0% cover).
 */
export async function fetchFractionalCover(
  lat: number,
  lng: number,
  year?: string,
  signal?: AbortSignal
): Promise<FractionalCoverResult | null> {
  const resp = await fetchDeaFeatureInfo(LAYER, lat, lng, year, signal);
  if (!resp || resp.data.length === 0) return null;

  const slice = resp.data[0];
  const green = numericBand(slice.bands.pv_pc_50);
  const dry = numericBand(slice.bands.npv_pc_50);
  const bare = numericBand(slice.bands.bs_pc_50);
  if (green === null || dry === null || bare === null) return null;

  return {
    greenPct: green,
    dryPct: dry,
    barePct: bare,
    year: slice.time || (year ?? 'most recent available'),
    confidence: 'published',
    source:
      'Digital Earth Australia, "DEA Fractional Cover Percentiles Calendar Year (Landsat)" ' +
      '(ga_ls_fc_pc_cyear_3, Collection 3) via live WMS GetFeatureInfo (ows.dea.ga.gov.au). ' +
      'Reports the 50th-percentile (median) green/dry/bare bands for the returned calendar year; ' +
      '10th/90th-percentile bands are also published by this layer but not surfaced by this function.',
  };
}
