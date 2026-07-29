/**
 * Route profile builder.
 *
 * Slope and vegetation are sampled independently (every ~10 m and ~200 m
 * respectively) and merged into two separate segment lists. To estimate
 * production accurately the backend needs them JOINED onto a common chainage so
 * each slice of the line carries both its slope and its fuel type. This module
 * performs that join and produces the `RouteSegment[]` the analysis API expects.
 */

import { TrackAnalysis, VegetationAnalysis } from '../types/config';
import { VegetationType } from '../config/classification';
import { VegetationOverridesConfig, getEffectiveVegetation } from '../types/vegetationOverrides';

/** One resolved slice of the planned line with uniform-ish conditions. */
export interface RouteSegment {
  /** Length of this segment in metres. */
  length: number;
  /** Representative slope for the segment, in degrees. */
  slopeDegrees: number;
  /** Fuel / vegetation class for the segment. */
  vegetation: VegetationType;
  /** Detection confidence for the vegetation class (0..1). */
  vegetationConfidence?: number;
  /** True when this segment crosses a mapped waterway or water body — damp
   *  ground doesn't carry fire, so it already IS a fire break; excluded from
   *  every equipment's estimate (nothing to construct) rather than costed as
   *  ordinary fuel to clear. */
  crossesWater?: boolean;
  /** True when this segment is within snap distance of a mapped, reusable
   *  trail/track/road (docs/CALCULATION_REVIEW.md, 2026-07-28) — mirrors
   *  `VegetationSegment.onExistingTrail`. INFORMATIONAL ONLY: does NOT reduce
   *  this segment's time/cost — there is no sourced existing-track-vs-virgin
   *  clearing-rate factor to apply. Surfaced so a route that reuses a formed
   *  track no longer gets costed identically to virgin bush with nothing in
   *  the final estimate to say otherwise. */
  onExistingTrail?: boolean;
  /** Cross-slope (side-slope) in degrees, perpendicular to the line's own
   *  bearing — distinct from `slopeDegrees` (measured ALONG the line). The
   *  rollover-risk figure for machinery working a hillside contour. */
  crossSlopeDegrees?: number;
}

interface Interval<T> {
  start: number;
  end: number;
  value: T;
}

/** Turn an ordered list of {distance} segments into cumulative [start,end] intervals. */
function toIntervals<S extends { distance: number }, T>(
  segments: S[],
  pick: (s: S) => T
): { intervals: Interval<T>[]; total: number } {
  const intervals: Interval<T>[] = [];
  let cursor = 0;
  for (const s of segments) {
    const len = s.distance || 0;
    if (len <= 0) continue;
    intervals.push({ start: cursor, end: cursor + len, value: pick(s) });
    cursor += len;
  }
  return { intervals, total: cursor };
}

/** Value of the interval covering position `x` (nearest by midpoint if none strictly covers). */
function valueAt<T>(intervals: Interval<T>[], x: number, fallback: T): T {
  for (const iv of intervals) {
    if (x >= iv.start && x <= iv.end) return iv.value;
  }
  if (intervals.length === 0) return fallback;
  // Clamp to ends.
  if (x < intervals[0].start) return intervals[0].value;
  return intervals[intervals.length - 1].value;
}

/**
 * Build the joined per-segment profile for a drawn line.
 *
 * @param distance Total route length in metres (authoritative length to scale to).
 * @param trackAnalysis Slope analysis (segments carry `.slope` in degrees).
 * @param vegetationAnalysis Vegetation analysis (segments carry type + confidence).
 * @param overrideVegetation If the user has manually set a vegetation class, apply
 *        it uniformly (the auto-detected per-segment fuel is then ignored).
 * @param vegetationOverrides Advanced overrides supporting route-level and segment-level customization.
 */
export function buildRouteProfile(
  distance: number,
  trackAnalysis: TrackAnalysis | null,
  vegetationAnalysis: VegetationAnalysis | null,
  overrideVegetation?: VegetationType,
  vegetationOverrides?: VegetationOverridesConfig
): RouteSegment[] {
  if (!distance || distance <= 0) return [];

  const slope = toIntervals(
    trackAnalysis?.segments ?? [],
    (s) => ({ slope: s.slope ?? 0, crossSlope: s.crossSlopeDeg ?? 0 })
  );
  const veg = toIntervals(
    vegetationAnalysis?.segments ?? [],
    (s) => ({ type: s.vegetationType, confidence: s.confidence, isWater: !!s.isWater, onExistingTrail: !!s.onExistingTrail })
  );

  const predominant: VegetationType =
    overrideVegetation ?? vegetationAnalysis?.predominantVegetation ?? 'grassland';

  // Scale both interval sets onto the authoritative [0, distance] axis so that
  // differing sample totals still align.
  const slopeScale = slope.total > 0 ? distance / slope.total : 1;
  const vegScale = veg.total > 0 ? distance / veg.total : 1;
  const scaledSlope = slope.intervals.map((iv) => ({
    start: iv.start * slopeScale,
    end: iv.end * slopeScale,
    value: iv.value,
  }));
  const scaledVeg = veg.intervals.map((iv) => ({
    start: iv.start * vegScale,
    end: iv.end * vegScale,
    value: iv.value,
  }));

  // Union of all boundary positions.
  const boundaries = new Set<number>([0, distance]);
  for (const iv of scaledSlope) {
    boundaries.add(iv.start);
    boundaries.add(iv.end);
  }
  for (const iv of scaledVeg) {
    boundaries.add(iv.start);
    boundaries.add(iv.end);
  }
  const points = Array.from(boundaries)
    .filter((p) => p >= 0 && p <= distance)
    .sort((a, b) => a - b);

  const segments: RouteSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = b - a;
    if (len <= 0.001) continue;
    const mid = (a + b) / 2;

    const slopeAt = valueAt(scaledSlope, mid, { slope: trackAnalysis?.maxSlope ?? 0, crossSlope: 0 });
    const slopeDegrees = slopeAt.slope;
    const crossSlopeDegrees = slopeAt.crossSlope;
    let vegetation: VegetationType = predominant;
    let vegetationConfidence: number | undefined = vegetationAnalysis?.overallConfidence;
    // Whether this stretch physically crosses mapped water, or reuses a
    // mapped existing trail — both independent of any vegetation-CLASS
    // override below, since overriding the fuel class a user assigns doesn't
    // change whether the ground here is actually water or already tracked.
    const crossesWater = valueAt(
      scaledVeg, mid, { type: predominant, confidence: 0, isWater: false, onExistingTrail: false }
    ).isWater;
    const onExistingTrail = valueAt(
      scaledVeg, mid, { type: predominant, confidence: 0, isWater: false, onExistingTrail: false }
    ).onExistingTrail;

    if (!overrideVegetation) {
      const v = valueAt(scaledVeg, mid, { type: predominant, confidence: vegetationAnalysis?.overallConfidence ?? 0, isWater: false, onExistingTrail: false });
      vegetation = v.type;
      vegetationConfidence = v.confidence;

      // Apply user overrides if configured
      if (vegetationOverrides) {
        vegetation = getEffectiveVegetation(mid, vegetation, vegetationOverrides);
        // Increase confidence when user has explicitly overridden the value
        if (vegetationOverrides.isEnabled &&
            (vegetationOverrides.routeOverride ||
             vegetationOverrides.segmentOverrides?.some(seg => mid >= seg.startDistance && mid <= seg.endDistance))) {
          vegetationConfidence = 1.0; // User-provided overrides have maximum confidence
        }
      }
    } else {
      vegetationConfidence = 1;
    }

    segments.push({ length: len, slopeDegrees, vegetation, vegetationConfidence, crossesWater, onExistingTrail, crossSlopeDegrees });
  }

  // Degenerate case: no usable geometry — return a single representative segment.
  if (segments.length === 0) {
    segments.push({
      length: distance,
      slopeDegrees: trackAnalysis?.maxSlope ?? 0,
      vegetation: predominant,
      vegetationConfidence: overrideVegetation ? 1 : vegetationAnalysis?.overallConfidence,
      crossSlopeDegrees: trackAnalysis?.maxCrossSlope ?? 0,
    });
  }

  return segments;
}
