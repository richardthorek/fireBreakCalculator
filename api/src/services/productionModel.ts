/**
 * Fireline Production Model
 * ------------------------------------------------------------------
 * Converts an equipment item's *reference* production rate (its rate in the
 * easiest conditions — flat, grassland/grass fuel) into an *effective* rate for
 * a given fuel type and slope, and defines the safety limits that gate whether a
 * resource can work a given piece of ground at all.
 *
 * WHY THIS EXISTS
 * The previous model multiplied a single base rate by two hand-picked factors
 * (`terrainFactor × vegetationFactor`) applied to the whole route's worst-case
 * slope and single "predominant" vegetation class. That is not how fireline
 * production behaves: production rates are published *per resource class × fuel
 * type × slope class* (NWCG 2021 Fire Line Production Rate Tables; Victorian
 * DELWP Report 56 "Prediction of firefighting resources for suppression
 * operations"), and different resource types respond very differently to fuel
 * and slope (a hand crew slows dramatically in heavy forest; a dozer less so;
 * aircraft are driven by coverage, not cutting).
 *
 * DESIGN
 * - Factors are expressed as SPEED multipliers in (0, 1], i.e. a fraction of the
 *   reference rate. 1.0 = reference (flat grassland). This matches the project's
 *   own `scripts/add_machines.js` convention (grass fast, heavy forest ~0.6×,
 *   30° slope ~0.5×) and the shape of the published tables.
 * - The reference rate is the equipment's configured `clearingRate`
 *   (machinery, m/hr) or `crewSize × clearingRatePerPerson` (hand crew, m/hr),
 *   INTERPRETED as the rate achievable in flat grassland. Every other condition
 *   is slower.
 * - All numbers are DEFAULTS grounded in the structure of the published tables
 *   and are intended to be calibrated against local observations. They live here
 *   as named, documented constants (not scattered magic numbers) precisely so a
 *   fire service can tune them without touching calculation logic.
 *
 * These are engineering approximations for planning, not certified suppression
 * doctrine. Treat outputs as estimates with the confidence the UI reports.
 */

import { TerrainLevel, VegetationType } from '../types/common';

export type ResourceKind = 'Machinery' | 'Aircraft' | 'HandCrew';

/** [slopeDegrees, speedFactor] anchor points; interpolated linearly, clamped at ends. */
type SlopeAnchor = [number, number];

/**
 * Machinery (dozer/grader) fuel speed factors — fraction of flat-grassland rate.
 * Dozers push through heavier fuel but slow substantially in closed forest with
 * large stems/understorey. Ratios reflect dozer-line production dropping to
 * roughly a third of grass rates in heavy timber.
 */
export const MACHINERY_FUEL_FACTOR: Record<VegetationType, number> = {
  grassland: 1.0,
  lightshrub: 0.8,
  mediumscrub: 0.55,
  heavyforest: 0.35,
};

/**
 * Machinery slope speed factors. Anchored to the project's existing
 * add_machines.js data (10°→~1.0, 20°→~0.72, 30°→~0.48) and extended with the
 * general shape of published tables. Beyond the machine's safety limit the
 * segment is treated as unworkable regardless of this factor.
 */
export const MACHINERY_SLOPE_ANCHORS: SlopeAnchor[] = [
  [0, 1.0],
  [10, 0.95],
  [15, 0.85],
  [20, 0.72],
  [25, 0.58],
  [30, 0.48],
  [35, 0.4],
  [45, 0.3],
];

/**
 * Hand crew fuel speed factors — hand-tool line construction is far more
 * fuel-sensitive than machinery; heavy forest with understorey can be several
 * times slower than grass (consistent with NWCG hand-crew tables spanning a much
 * wider range across fuel models than the dozer tables).
 */
export const HANDCREW_FUEL_FACTOR: Record<VegetationType, number> = {
  grassland: 1.0,
  lightshrub: 0.62,
  mediumscrub: 0.38,
  heavyforest: 0.22,
};

/** Hand crews can work steeper ground than machinery but still slow with slope. */
export const HANDCREW_SLOPE_ANCHORS: SlopeAnchor[] = [
  [0, 1.0],
  [15, 0.85],
  [25, 0.7],
  [35, 0.55],
  [45, 0.45],
  [60, 0.35],
];

/**
 * Aircraft fuel COVERAGE factor — heavier fuel needs a higher retardant/water
 * coverage level, so a single load treats less line. Applied as a multiplier on
 * effective drop length (grass = full length; heavy forest ≈ half).
 */
export const AIRCRAFT_COVERAGE_FACTOR: Record<VegetationType, number> = {
  grassland: 1.0,
  lightshrub: 0.85,
  mediumscrub: 0.65,
  heavyforest: 0.5,
};

/**
 * Default maximum workable slope (degrees) when an equipment item does not
 * specify its own `maxSlope`. Machinery default (~25° ≈ 47% grade) is a
 * conservative planning limit consistent with NWCG dozer guidance (avoid
 * sidehill > ~45%). Hand crews can work considerably steeper.
 */
export const DEFAULT_MAX_SLOPE_DEGREES: Record<ResourceKind, number> = {
  Machinery: 25,
  HandCrew: 45,
  Aircraft: 90, // aircraft overfly terrain; slope is not a work limit
};

/** Upper slope bound (degrees) implied by an equipment item's coarse terrain class. */
const TERRAIN_SLOPE_CEILING: Record<TerrainLevel, number> = {
  flat: 10,
  medium: 25,
  steep: 45,
  very_steep: 90,
};

/** Linear interpolation over sorted [x, y] anchors, clamped beyond the ends. */
function interpolateAnchors(anchors: SlopeAnchor[], x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/** Fuel speed (coverage for aircraft) factor for a resource kind + vegetation. */
export function fuelFactor(kind: ResourceKind, veg: VegetationType): number {
  switch (kind) {
    case 'Machinery':
      return MACHINERY_FUEL_FACTOR[veg];
    case 'HandCrew':
      return HANDCREW_FUEL_FACTOR[veg];
    case 'Aircraft':
      return AIRCRAFT_COVERAGE_FACTOR[veg];
  }
}

/** Slope speed factor for a resource kind at a given slope (degrees). */
export function slopeFactor(kind: ResourceKind, slopeDegrees: number): number {
  const s = Math.max(0, slopeDegrees || 0);
  switch (kind) {
    case 'Machinery':
      return interpolateAnchors(MACHINERY_SLOPE_ANCHORS, s);
    case 'HandCrew':
      return interpolateAnchors(HANDCREW_SLOPE_ANCHORS, s);
    case 'Aircraft':
      return 1.0; // slope does not slow an air drop
  }
}

/**
 * Effective production rate (m/hr) for a segment, given the reference rate.
 * Returns 0 if the reference rate is non-positive.
 */
export function effectiveRate(
  referenceRate: number,
  kind: ResourceKind,
  veg: VegetationType,
  slopeDegrees: number
): number {
  if (!referenceRate || referenceRate <= 0) return 0;
  return referenceRate * fuelFactor(kind, veg) * slopeFactor(kind, slopeDegrees);
}

/**
 * Resolve the maximum workable slope (degrees) for an equipment item: explicit
 * `maxSlope` wins; otherwise fall back to the ceiling implied by its highest
 * allowed terrain class, or the resource-kind default — whichever is lower, so
 * we never silently exceed a conservative safety default.
 */
export function resolveMaxSlopeDegrees(
  kind: ResourceKind,
  explicitMaxSlope: number | undefined,
  allowedTerrain: TerrainLevel[]
): number {
  if (typeof explicitMaxSlope === 'number' && explicitMaxSlope > 0) {
    return explicitMaxSlope;
  }
  const terrainCeiling = allowedTerrain.length
    ? Math.max(...allowedTerrain.map((t) => TERRAIN_SLOPE_CEILING[t] ?? 0))
    : DEFAULT_MAX_SLOPE_DEGREES[kind];
  return Math.min(terrainCeiling, DEFAULT_MAX_SLOPE_DEGREES[kind] * 1.8);
}

/** Map a slope in degrees to the coarse terrain class used for display/gating. */
export function slopeToTerrain(slopeDegrees: number): TerrainLevel {
  if (slopeDegrees < 10) return 'flat';
  if (slopeDegrees < 25) return 'medium';
  if (slopeDegrees < 45) return 'steep';
  return 'very_steep';
}
