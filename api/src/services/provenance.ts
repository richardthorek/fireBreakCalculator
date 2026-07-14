/**
 * Provenance, versioning and the standing legal disclaimer (API side).
 *
 * Mirrors `webapp/src/config/provenance.ts`. The estimate engine lives in the
 * API (`productionModel.ts` / `equipmentAnalysis.ts`), so this file is the
 * authoritative home of the engine version; the webapp copy must be kept in
 * step. Stamped into the analysis response metadata and every server-built
 * briefing so any consumer knows which model produced the numbers and when.
 */

/** Estimate-engine version. Bump when the production/estimate model changes. */
export const ENGINE_VERSION = '1.3.0';
/** Date the current engine version took effect (last calibration change). */
export const ENGINE_UPDATED = '2026-07-13';

export const DISCLAIMER_SHORT =
  'Planning aid only — not an operational tasking. All estimates, terrain and vegetation data must be verified on the ground before work commences.';

export const DISCLAIMER_LONG = [
  'This briefing was produced by the Fire Break Calculator, a planning-support tool.',
  'It is NOT an operational order, a tasking, or an authoritative record of ground conditions.',
  'Time, cost, resource, slope and vegetation figures are estimates derived from published models and third-party spatial data that may be coarse, out of date, or unavailable — in which case fallback/estimated values are used and flagged.',
  'Do not rely on it as the sole basis for deploying personnel or heavy plant. Ground-truth all conditions, and follow your agency\'s doctrine, risk assessment and chain-of-command approval before any work commences.',
].join(' ');

/** Provenance block stamped into analysis response metadata. */
export function provenanceMetadata(now: Date = new Date()) {
  return {
    estimateEngineVersion: ENGINE_VERSION,
    estimateEngineUpdated: ENGINE_UPDATED,
    generatedUtc: now.toISOString(),
  };
}
