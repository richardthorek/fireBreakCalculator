/**
 * Provenance, versioning and the standing legal disclaimer.
 *
 * Single source of truth for the webapp side of two safety properties:
 *
 *  1. **Reproducibility** — every document the tool emits (GIS export, print
 *     briefing, SMEACS pack, saved plan) is stamped with the estimate-engine
 *     version, the data sources it can draw on, and the moment it was produced.
 *     The estimate model is tuned over time (e.g. the 2026-07-13 vegetation
 *     cost-weight change), so the same drawn line can produce different numbers
 *     in different releases. A stamped output lets a crew — or a later audit —
 *     know *which* model and *when*.
 *
 *  2. **Liability framing** — the tool is a planning aid, not an operational
 *     authority. The disclaimer below travels with every export/briefing and is
 *     shown standing in the app, so a document that *looks* official (the SMEACS
 *     pack especially) can never be mistaken for an agency tasking.
 *
 * The API mirrors the engine version and disclaimer in
 * `api/src/services/provenance.ts`; keep the two in step when the model changes.
 */

/** Estimate-engine version. Bump when the production/estimate model changes. */
export const ENGINE_VERSION = '1.3.0';
/** Date the current engine version took effect (last calibration change). */
export const ENGINE_UPDATED = '2026-07-13';

/** Webapp build version (kept in step with package.json). */
export const APP_VERSION = '1.0.0';

/**
 * Data sources the analysis can draw on. These are provider-maintained; the
 * tool does not control their currency, so a stamped output records the source
 * *names* and the retrieval time rather than a release number we can't verify.
 */
export const DATA_SOURCES = {
  vegetation: 'NVIS Extant MVG (national) + NSW SVTM PCT overlay',
  elevation: 'ArcGIS bare-earth DEM (where configured) / Mapbox Terrain-RGB fallback',
  basemap: 'Mapbox satellite',
} as const;

/**
 * Basis for the built-in standard equipment cost rates. Rates are indicative
 * planning figures, not a live price feed; without an as-of date and currency
 * they rot silently. Deployments that configure their own equipment carry their
 * own rates — this basis describes only the built-in fallback catalogue.
 */
export const COST_BASIS = {
  currency: 'AUD',
  asOf: '2026-07',
  note: 'Indicative planning rates for the built-in standard equipment; confirm against current agency/contractor rates.',
} as const;

/** Datum/CRS all exported geometry is expressed in. */
export const COORDINATE_REFERENCE_SYSTEM = 'WGS84 (EPSG:4326)';

/**
 * Standing disclaimer. Short form for tight UI; long form for documents that
 * leave the app and may be read out of context.
 */
export const DISCLAIMER_SHORT =
  'Planning aid only — not an operational tasking. All estimates, terrain and vegetation data must be verified on the ground before work commences.';

export const DISCLAIMER_LONG = [
  'This document was produced by the Fire Break Calculator, a planning-support tool.',
  'It is NOT an operational order, a tasking, or an authoritative record of ground conditions.',
  'Time, cost, resource, slope and vegetation figures are estimates derived from published models and third-party spatial data that may be coarse, out of date, or unavailable — in which case fallback/estimated values are used and flagged.',
  'Do not rely on it as the sole basis for deploying personnel or heavy plant. Ground-truth all conditions, and follow your agency\'s doctrine, risk assessment and chain-of-command approval before any work commences.',
].join(' ');

/** One-line provenance stamp for document footers. */
export function provenanceStamp(now: Date = new Date()): string {
  return `Fire Break Calculator v${APP_VERSION} · estimate engine v${ENGINE_VERSION} (${ENGINE_UPDATED}) · generated ${now.toISOString()} · geometry ${COORDINATE_REFERENCE_SYSTEM}`;
}

/** Structured provenance block for machine-readable exports (GeoJSON etc.). */
export function provenanceProperties(now: Date = new Date()) {
  return {
    generator: 'Fire Break Calculator',
    app_version: APP_VERSION,
    estimate_engine_version: ENGINE_VERSION,
    estimate_engine_updated: ENGINE_UPDATED,
    generated_utc: now.toISOString(),
    coordinate_reference_system: COORDINATE_REFERENCE_SYSTEM,
    data_sources: `${DATA_SOURCES.vegetation}; ${DATA_SOURCES.elevation}`,
    cost_basis: `${COST_BASIS.currency} rates as of ${COST_BASIS.asOf}`,
    disclaimer: DISCLAIMER_LONG,
  };
}
