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

import { fetchDeaFeatureInfo, numericBand } from './deaOwsClient';

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
