/**
 * Mobility cost strategy — Terrain Mobility & Counter-Mobility mode.
 *
 * This is the "edgeCost, but injectable, directional and profile-parameterised"
 * module docs/ROUTE_INTELLIGENCE.md §2 calls for, sitting alongside (not
 * replacing) the fire-break optimizer's `edgeCost` in routeOptimizer.ts. The
 * two are deliberately separate: the fire-break model prices CLEARING a line
 * through terrain (symmetric — cutting a break doesn't care which way you
 * walk it), this one prices MOVING through terrain (asymmetric — uphill,
 * downhill and cross-slope are three different problems, and a vehicle's
 * roll-over limit on side-slope is usually stricter than its climb limit).
 *
 * PASS 1 HONESTY NOTE: vegetation "structure" (stem diameter / gap width) is
 * currently inferred from NVIS formation alone via `estimateStructureFromVegetation`
 * below — a TIER 0 placeholder per docs §10.5. It is NOT the real percolation/
 * gap-network analysis, and it is NOT the AusPlots-derived stem-density table
 * with variance that docs §10.4/§11.6 call for (that lands in Pass 3, M3b/M3c).
 * Every result this module produces is therefore marked `estimated: true` and
 * `dataTier: 0` until a later pass wires in real structure data — this module
 * must keep reporting that honestly rather than silently upgrading its own
 * confidence.
 */

import { VegetationType } from '../config/classification';
import { MoverProfile } from './moverProfiles';
import { lookupStructure } from './dataLayers/structureTable';

// ---------------------------------------------------------------------------
// Directional slope
// ---------------------------------------------------------------------------

/**
 * Signed along-travel slope in degrees. Positive = climbing from `from` to
 * `to`; negative = descending. Unlike `slopeCalculation.ts`'s `calculateSlope`
 * (unsigned, used by the symmetric fire-break model), direction matters here.
 */
export function signedSlopeDegrees(fromElevation: number, toElevation: number, horizontalDistance: number): number {
  if (horizontalDistance <= 0) return 0;
  return Math.atan((toElevation - fromElevation) / horizontalDistance) * (180 / Math.PI);
}

/** Raw grade (rise/run) — the `s` term Tobler's and Irmischer & Clarke's
 *  functions are defined against. Positive = uphill. */
export function gradeFraction(fromElevation: number, toElevation: number, horizontalDistance: number): number {
  if (horizontalDistance <= 0) return 0;
  return (toElevation - fromElevation) / horizontalDistance;
}

// ---------------------------------------------------------------------------
// Individual foot speed models
// ---------------------------------------------------------------------------

/** Irmischer & Clarke (2018) off-path terrain-adjusted walking speed.
 *  v (m/s) = 0.11 + exp(-(100s+2)^2/1800), s = signed grade fraction.
 *  Measured off-path on USMA cadets in hilly, wooded terrain — the primary
 *  individual-foot model for this product (docs §11.1). */
export function irmischerClarkeSpeedKmh(grade: number): number {
  const s100 = 100 * grade;
  const vMs = 0.11 + Math.exp(-((s100 + 2) ** 2) / 1800);
  return vMs * 3.6;
}

/** Tobler's hiking function (1993). v (km/h) = 6*exp(-3.5*|s+0.05|).
 *  On-path, no vegetation term — used here only as a cross-check / a
 *  "prefers easy ground" alternative, never as the primary figure. */
export function toblerSpeedKmh(grade: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(grade + 0.05));
}

// ---------------------------------------------------------------------------
// Vegetation structure — Tier 0 placeholder (see module honesty note above)
// ---------------------------------------------------------------------------

export interface StructureEstimate {
  /** Representative stem diameter, mm — the figure a TRACKED profile's
   *  override-force check is compared against. */
  stemDiameterMedianMm: number;
  /** Widest available cross-country gap along a short (~50 m) straight
   *  crossing, metres — the figure a WHEELED profile's gap-width check is
   *  compared against. */
  gapWidthEstimateM: number;
}

/**
 * Infers structure from NVIS formation alone, which docs §10.1 establishes is
 * unreliable in both directions (a widely-spaced woodland can be as open as
 * grassland; a multi-stemmed thicket can read as low cover while being a wall
 * of stems) — still Tier 0 (per §10.7, "Tier 0 done properly" is M3a, not a
 * tier bump), but now backed by `dataLayers/structureTable.ts`'s cited,
 * per-row-confidence table (AusPlots-derived figures for heavyforest, a
 * named NSW regulatory benchmark for mediumscrub) instead of an uncited
 * guess. Applying a class-level figure to an individual cell is still an
 * estimate regardless of how well the class-level figure is cited, so this
 * module keeps reporting `estimated: true` / `dataTier: 0` throughout — see
 * `lookupStructure`'s own per-row `confidence`/`source` for the real
 * provenance. Pass 3/4 (M3d) lands measured lidar understorey return
 * fraction where available, which is the actual tier bump.
 */
export function estimateStructureFromVegetation(vegetation: VegetationType): StructureEstimate {
  const { stemDiameterMedianMm, gapWidthEstimateM } = lookupStructure(vegetation);
  return { stemDiameterMedianMm, gapWidthEstimateM };
}

// ---------------------------------------------------------------------------
// Vehicle gradient speed curve
// ---------------------------------------------------------------------------

/**
 * Smooth 0..1 speed multiplier from 0 at slope 0 down to 0 at `limitDeg`
 * (quadratic ease-out — an engineering interpolation between the doctrinal
 * anchors, not itself a doctrinal figure). Beyond `limitDeg` the caller must
 * treat the edge as NO-GO rather than reading a multiplier from this curve.
 */
export function vehicleGradeSpeedFactor(absSlopeDeg: number, limitDeg: number): number {
  if (limitDeg <= 0) return 0;
  const t = Math.min(1, absSlopeDeg / limitDeg);
  return 1 - t * t;
}

// ---------------------------------------------------------------------------
// Edge classification and cost
// ---------------------------------------------------------------------------

export type TrafficabilityClass = 'GO' | 'SLOW-GO' | 'NO-GO';

export interface MobilitySample {
  lat: number;
  lng: number;
  elevation: number;
  vegetation: VegetationType;
  vegEstimated: boolean;
  onTrail: boolean;
}

export interface EdgeMobilityOptions {
  /** Perpendicular (roll-over) slope estimate at the FROM cell, degrees,
   *  where the caller has grid context to compute one (accumulatedCost.ts
   *  does, from hex neighbours). Absent when not available — treated as
   *  "unknown", not zero. */
  crossSlopeDeg?: number | null;
  /** Apply the profile's night factor. */
  nightMode?: boolean;
}

export interface EdgeMobilityResult {
  /** Time cost for this DIRECTED edge, seconds. Infinity for NO-GO. */
  timeSeconds: number;
  distM: number;
  slopeDeg: number; // signed, direction of travel
  crossSlopeDeg: number | null;
  speedKmh: number;
  trafficability: TrafficabilityClass;
  blockedReason?: string;
  /** True whenever a Tier-0 structure placeholder, an unresolved cross-slope,
   *  or estimated vegetation/elevation contributed to this result. */
  estimated: boolean;
  dataTier: 0;
}

const SLOW_GO_MARGIN = 0.85; // within 85% of a hard limit reads as SLOW-GO, not GO

/**
 * Classify and cost a single directed edge for a given mover profile. This is
 * the injectable replacement for routeOptimizer.ts's fixed `edgeCost` — every
 * caller (isochrone field, corridor search, GO/SLOW-GO/NO-GO overlay) goes
 * through this one function so profile-switching recolours consistently.
 */
export function edgeMobilityCost(
  profile: MoverProfile,
  from: MobilitySample,
  to: MobilitySample,
  distM: number,
  options: EdgeMobilityOptions = {}
): EdgeMobilityResult {
  const { crossSlopeDeg = null, nightMode = false } = options;
  const estimatedBase = from.vegEstimated || to.vegEstimated;

  if (distM <= 0) {
    return { timeSeconds: 0, distM: 0, slopeDeg: 0, crossSlopeDeg, speedKmh: 0, trafficability: 'GO', estimated: estimatedBase, dataTier: 0 };
  }

  const slopeDeg = signedSlopeDegrees(from.elevation, to.elevation, distM);
  const grade = gradeFraction(from.elevation, to.elevation, distM);
  const absSlope = Math.abs(slopeDeg);

  // --- Hard slope gates (climb + cross-slope) -------------------------------
  if (absSlope > profile.maxClimbDeg) {
    return {
      timeSeconds: Infinity, distM, slopeDeg, crossSlopeDeg, speedKmh: 0,
      trafficability: 'NO-GO', blockedReason: `climb ${absSlope.toFixed(1)}° exceeds ${profile.label} limit (${profile.maxClimbDeg}°)`,
      estimated: estimatedBase, dataTier: 0,
    };
  }
  if (crossSlopeDeg !== null && Math.abs(crossSlopeDeg) > profile.maxSideSlopeDeg) {
    return {
      timeSeconds: Infinity, distM, slopeDeg, crossSlopeDeg, speedKmh: 0,
      trafficability: 'NO-GO', blockedReason: `side-slope ${Math.abs(crossSlopeDeg).toFixed(1)}° exceeds ${profile.label} limit (${profile.maxSideSlopeDeg}°)`,
      estimated: estimatedBase, dataTier: 0,
    };
  }

  // --- Vegetation passability (wheeled = gap-width limited, tracked =
  // override-force limited — two different queries against the same
  // structure data, per docs §11.4). Skipped on a mapped trail — the ground
  // there is already broken. ---------------------------------------------
  let vegBlocked = false;
  let vegReason: string | undefined;
  const structureEstimated = true; // always true in Pass 1 — see module honesty note
  if (!from.onTrail || !to.onTrail) {
    const struct = estimateStructureFromVegetation(to.vegetation);
    if (profile.kind === 'wheeled') {
      if (struct.gapWidthEstimateM < profile.widthM) {
        vegBlocked = true;
        vegReason = `estimated gap width ${struct.gapWidthEstimateM.toFixed(1)} m < ${profile.label} width ${profile.widthM.toFixed(1)} m (Tier 0 estimate)`;
      }
    } else if (profile.kind === 'tracked') {
      const canOverride = profile.overrideStemDiameterMm !== undefined && struct.stemDiameterMedianMm <= profile.overrideStemDiameterMm;
      const gapWide = struct.gapWidthEstimateM >= profile.widthM;
      if (!canOverride && !gapWide) {
        vegBlocked = true;
        vegReason = `estimated stem diameter ${struct.stemDiameterMedianMm} mm exceeds override capability and estimated gap width ${struct.gapWidthEstimateM.toFixed(1)} m is too narrow (Tier 0 estimate)`;
      }
    }
    // foot profiles are not vegetation-blocked in Pass 1 — dense scrub slows
    // rather than stops a person; that's reflected in the speed model instead.
  }
  if (vegBlocked) {
    return {
      timeSeconds: Infinity, distM, slopeDeg, crossSlopeDeg, speedKmh: 0,
      trafficability: 'NO-GO', blockedReason: vegReason,
      estimated: true, dataTier: 0,
    };
  }

  // --- Speed ----------------------------------------------------------------
  let speedKmh: number;
  switch (profile.speedModel) {
    case 'irmischer-clarke-offpath':
      speedKmh = irmischerClarkeSpeedKmh(grade);
      break;
    case 'tobler':
      speedKmh = toblerSpeedKmh(grade);
      break;
    case 'doctrinal-unit-march':
    case 'vehicle-gradient': {
      const base = to.onTrail && from.onTrail ? profile.roadSpeedKmh : profile.roadSpeedKmh * profile.crossCountryFactor;
      const gradeFactor = vehicleGradeSpeedFactor(absSlope, profile.maxClimbDeg);
      speedKmh = base * Math.max(0.05, gradeFactor); // floor so a near-limit slope creeps rather than divides by ~0
      break;
    }
    default:
      speedKmh = profile.roadSpeedKmh;
  }
  if (profile.loadPenaltyFactor) speedKmh *= profile.loadPenaltyFactor;
  if (nightMode) speedKmh *= profile.nightFactor;
  speedKmh = Math.max(0.1, speedKmh);

  const timeSeconds = (distM / 1000 / speedKmh) * 3600;

  // --- Trafficability classification -----------------------------------
  const climbRatio = absSlope / profile.maxClimbDeg;
  const sideRatio = crossSlopeDeg !== null ? Math.abs(crossSlopeDeg) / profile.maxSideSlopeDeg : 0;
  const struct = estimateStructureFromVegetation(to.vegetation);
  const gapRatio = profile.kind === 'wheeled' ? profile.widthM / Math.max(0.1, struct.gapWidthEstimateM) : 0;
  const nearLimit = climbRatio > SLOW_GO_MARGIN || sideRatio > SLOW_GO_MARGIN || gapRatio > SLOW_GO_MARGIN;
  const heavyVeg = (to.vegetation === 'heavyforest' || to.vegetation === 'mediumscrub') && !to.onTrail;
  const trafficability: TrafficabilityClass = nearLimit || heavyVeg ? 'SLOW-GO' : 'GO';

  return {
    timeSeconds,
    distM,
    slopeDeg,
    crossSlopeDeg,
    speedKmh,
    trafficability,
    estimated: estimatedBase || structureEstimated,
    dataTier: 0,
  };
}
