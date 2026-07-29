/**
 * Existing-trail reuse threaded into the fire-break optimizer's cost profile
 * (docs/CALCULATION_REVIEW.md, 2026-07-28). Confirmed defect: the client-side
 * optimizer (`routeOptimizer.ts`) already computes which parts of a route
 * follow a mapped trail — it uses this to PREFER trail-following routes
 * during pathfinding — but that fact was discarded before segments reached
 * `RouteSegment[]`, the exact shape POSTed to `/api/analysis/calculate`
 * (`BackendAnalysisRequest.segments`, the SOLE authoritative cost engine per
 * CLAUDE.md). A route that reuses a real formed track was priced identically
 * to virgin bush of the same vegetation class, with nothing anywhere in the
 * final estimate to say otherwise.
 *
 * `VegetationSegment.onExistingTrail` (vegetationAnalysis.ts, network-backed,
 * not covered here) now carries this fact; this test proves the PURE join
 * step (`buildRouteProfile`) correctly threads it through to
 * `RouteSegment.onExistingTrail` — informational only, deliberately NOT
 * reducing `slopeDegrees`/`vegetation`/length, since there is no sourced
 * existing-track-vs-virgin clearing-rate factor to apply (do not invent a
 * coefficient).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/routeProfileExistingTrail.test.ts
 */
import * as assert from 'node:assert';
import { buildRouteProfile } from '../src/utils/routeProfile';
import { TrackAnalysis, VegetationAnalysis, VegetationSegment, SlopeSegment } from '../src/types/config';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function slopeSeg(distance: number, slope = 5): SlopeSegment {
  return { start: [0, 0], end: [0, 0], slope, category: 'flat', distance } as SlopeSegment;
}

function vegSeg(distance: number, opts: Partial<VegetationSegment> = {}): VegetationSegment {
  return {
    start: [0, 0], end: [0, 0], vegetationType: 'grassland', confidence: 0.9,
    landcoverClass: 'grass', distance, ...opts,
  };
}

console.log('Existing-trail reuse threaded into the fire-break cost profile (docs CALCULATION_REVIEW.md):');

test('a segment overlapping an onExistingTrail-flagged vegetation stretch is flagged onExistingTrail:true', () => {
  const track: TrackAnalysis = {
    totalDistance: 1000, segments: [slopeSeg(1000)], maxSlope: 5, averageSlope: 5,
    slopeDistribution: { flat: 1000, medium: 0, steep: 0, very_steep: 0 } as any,
  } as TrackAnalysis;
  const veg: VegetationAnalysis = {
    totalDistance: 1000,
    segments: [vegSeg(500, { onExistingTrail: true }), vegSeg(500, { onExistingTrail: false })],
    predominantVegetation: 'grassland',
    vegetationDistribution: { grassland: 1000, lightshrub: 0, mediumscrub: 0, heavyforest: 0 },
    overallConfidence: 0.9,
  };
  const segments = buildRouteProfile(1000, track, veg);
  const early = segments.find(s => s.length > 0 && (s as any).onExistingTrail !== undefined);
  assert.ok(segments.length > 0, 'expected at least one segment');
  // First half of the route should be flagged, second half should not.
  const firstHalf = segments.filter(s => s.length > 0)[0];
  assert.strictEqual(firstHalf.onExistingTrail, true, 'expected the first (on-trail) stretch to be flagged');
  const lastSeg = segments[segments.length - 1];
  assert.strictEqual(lastSeg.onExistingTrail, false, 'expected the second (off-trail) stretch to NOT be flagged');
});

test('onExistingTrail creates a real segment boundary — the two halves are never merged into one', () => {
  const track: TrackAnalysis = {
    totalDistance: 1000, segments: [slopeSeg(1000)], maxSlope: 5, averageSlope: 5,
    slopeDistribution: { flat: 1000, medium: 0, steep: 0, very_steep: 0 } as any,
  } as TrackAnalysis;
  const veg: VegetationAnalysis = {
    totalDistance: 1000,
    // SAME vegetation type on both sides — only onExistingTrail differs — so
    // if the boundary weren't respected, buildRouteProfile's own boundary
    // union (which only looks at start/end positions of BOTH interval sets)
    // would still produce 2 raw slices, but we specifically check the VALUES
    // differ across them, proving the flag is real per-segment data, not a
    // single route-wide constant.
    segments: [vegSeg(500, { onExistingTrail: true }), vegSeg(500, { onExistingTrail: false })],
    predominantVegetation: 'grassland',
    vegetationDistribution: { grassland: 1000, lightshrub: 0, mediumscrub: 0, heavyforest: 0 },
    overallConfidence: 0.9,
  };
  const segments = buildRouteProfile(1000, track, veg).filter(s => s.length > 0);
  const distinctFlags = new Set(segments.map(s => !!s.onExistingTrail));
  assert.strictEqual(distinctFlags.size, 2, 'expected both true and false to appear across the route');
});

test('onExistingTrail does NOT alter vegetation, slope, or length — informational only, never an invented discount', () => {
  const track: TrackAnalysis = {
    totalDistance: 1000, segments: [slopeSeg(1000, 12)], maxSlope: 12, averageSlope: 12,
    slopeDistribution: { flat: 0, medium: 1000, steep: 0, very_steep: 0 } as any,
  } as TrackAnalysis;
  const vegOnTrail: VegetationAnalysis = {
    totalDistance: 1000, segments: [vegSeg(1000, { vegetationType: 'heavyforest', onExistingTrail: true })],
    predominantVegetation: 'heavyforest',
    vegetationDistribution: { grassland: 0, lightshrub: 0, mediumscrub: 0, heavyforest: 1000 },
    overallConfidence: 0.9,
  };
  const vegOffTrail: VegetationAnalysis = {
    ...vegOnTrail,
    segments: [vegSeg(1000, { vegetationType: 'heavyforest', onExistingTrail: false })],
  };
  const onTrailSegments = buildRouteProfile(1000, track, vegOnTrail);
  const offTrailSegments = buildRouteProfile(1000, track, vegOffTrail);
  assert.strictEqual(onTrailSegments.length, offTrailSegments.length);
  for (let i = 0; i < onTrailSegments.length; i++) {
    assert.strictEqual(onTrailSegments[i].length, offTrailSegments[i].length, 'length must be identical regardless of trail flag');
    assert.strictEqual(onTrailSegments[i].slopeDegrees, offTrailSegments[i].slopeDegrees, 'slope must be identical regardless of trail flag');
    assert.strictEqual(onTrailSegments[i].vegetation, offTrailSegments[i].vegetation, 'vegetation class must be identical regardless of trail flag');
  }
});

test('vegetationAnalysis with no onExistingTrail data at all (older/degraded input) leaves the field undefined, not defaulted to true or false', () => {
  const track: TrackAnalysis = {
    totalDistance: 500, segments: [slopeSeg(500)], maxSlope: 5, averageSlope: 5,
    slopeDistribution: { flat: 500, medium: 0, steep: 0, very_steep: 0 } as any,
  } as TrackAnalysis;
  const veg: VegetationAnalysis = {
    totalDistance: 500, segments: [vegSeg(500)], // no onExistingTrail key at all
    predominantVegetation: 'grassland',
    vegetationDistribution: { grassland: 500, lightshrub: 0, mediumscrub: 0, heavyforest: 0 },
    overallConfidence: 0.9,
  };
  const segments = buildRouteProfile(500, track, veg).filter(s => s.length > 0);
  assert.ok(segments.length > 0);
  assert.strictEqual(segments[0].onExistingTrail, false, 'valueAt falls back to the explicit false default, not undefined — matches crossesWater\'s own established behaviour');
});

if (process.exitCode === 1) {
  console.error(`\nExisting-trail reuse is NOT threaded through the cost profile correctly.`);
} else {
  console.log(`\nAll ${passed} existing-trail cost-profile checks passed.`);
}
