/**
 * Live-tested regressions (2026-07-28), both the same root cause: a real,
 * signed highway was painted NO-GO end to end — once along a Lake George
 * shoreline shelf, once on a paved road descending a steep ridge. The
 * vegetation and hydrology gates in `edgeMobilityCost`/`classifyCellTerrain`
 * already exempt a mapped trail ("the ground here is already broken/
 * bridged"), but the hard climb/cross-slope gates did not — they applied to
 * the raw DEM-derived gradient regardless of `onTrail`, so a hex blending an
 * engineered road bed with the steep ground around it still hard-blocked.
 *
 * Fix: both gates now skip the hard climb/cross-slope check when the edge
 * (or cell) is on the mapped road/trail network — the road-CLASS speed model
 * (roadSpeedModel.ts) is what actually governs speed there, not a
 * recomputed raw-terrain slope estimate.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/slopeGateOnTrailExemption.test.ts
 */
import * as assert from 'node:assert';
import { edgeMobilityCost, MobilitySample } from '@firebreak/terrain';
import { MOVER_PROFILES } from '@firebreak/terrain';

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

const vehicle = MOVER_PROFILES.find(p => p.id === 'au-light-4wd')!;
assert.ok(vehicle);
// maxClimbDeg=22, maxSideSlopeDeg=18 for au-light-4wd.

const base = (overrides: Partial<MobilitySample> = {}): MobilitySample => ({
  lat: -35.0, lng: 148.0, elevation: 100, vegetation: 'grassland', vegEstimated: false,
  onTrail: true, ...overrides,
});

console.log('Hard slope gate onTrail exemption (§40 addendum, 2026-07-28):');

test('THE REPORTED SCENARIO: a steep climb that would hard-block off-trail is NOT blocked when both ends are on a mapped road', () => {
  // A climb well beyond the vehicle's 22° limit — genuinely NO-GO off-road.
  const from = base({ elevation: 0, onTrail: true, nearestTrailTags: { highway: 'primary' } });
  const to = base({ elevation: 500, onTrail: true, nearestTrailTags: { highway: 'primary' } }); // atan(500/100) ≈ 79°
  const r = edgeMobilityCost(vehicle, from, to, 100);
  assert.notStrictEqual(r.trafficability, 'severely-restricted',
    `FAILED: an onTrail edge was still hard-blocked by raw slope (${r.blockedReason})`);
  assert.ok(isFinite(r.timeSeconds), 'expected a finite travel time, not Infinity');
});

test('CONTROL: the IDENTICAL climb, off-trail, is still correctly hard-blocked — the exemption is onTrail-specific, not a blanket removal of the gate', () => {
  const from = base({ elevation: 0, onTrail: false });
  const to = base({ elevation: 500, onTrail: false });
  const r = edgeMobilityCost(vehicle, from, to, 100);
  assert.strictEqual(r.trafficability, 'severely-restricted', 'off-trail, the same steep climb must still be severely restricted');
  assert.strictEqual(r.timeSeconds, Infinity);
});

test('CONTROL: an edge with only ONE end on the trail is still gated (matches the vegetation/hydrology exemption\'s existing "both ends" rule)', () => {
  const from = base({ elevation: 0, onTrail: true });
  const to = base({ elevation: 500, onTrail: false });
  const r = edgeMobilityCost(vehicle, from, to, 100);
  assert.strictEqual(r.trafficability, 'severely-restricted', 'a road that doesn\'t continue at the arrival cell should not exempt a genuine off-road climb');
});

test('THE REPORTED SCENARIO (cross-slope): a side-slope well beyond the vehicle\'s roll-over limit is not blocked on a mapped road', () => {
  const from = base({ elevation: 100, onTrail: true, nearestTrailTags: { highway: 'primary' } });
  const to = base({ elevation: 100, onTrail: true, nearestTrailTags: { highway: 'primary' } });
  const r = edgeMobilityCost(vehicle, from, to, 100, { crossSlopeDeg: 40 }); // way past maxSideSlopeDeg=18
  assert.notStrictEqual(r.trafficability, 'severely-restricted', `FAILED: onTrail cross-slope still hard-blocked (${r.blockedReason})`);
});

test('CONTROL: the identical cross-slope off-trail is still NO-GO', () => {
  const from = base({ elevation: 100, onTrail: false });
  const to = base({ elevation: 100, onTrail: false });
  const r = edgeMobilityCost(vehicle, from, to, 100, { crossSlopeDeg: 40 });
  assert.strictEqual(r.trafficability, 'severely-restricted');
});

test('a mild, genuinely within-limits slope on-trail behaves exactly as before (this is not a general speed change)', () => {
  const from = base({ elevation: 0, onTrail: true, nearestTrailTags: null });
  const to = base({ elevation: 5, onTrail: true, nearestTrailTags: null }); // atan(5/100) ≈ 2.9°, well within 22°
  const r = edgeMobilityCost(vehicle, from, to, 100);
  assert.notStrictEqual(r.trafficability, 'severely-restricted');
  const expectedSeconds = (0.1 / vehicle.roadSpeedKmh) * 3600;
  assert.ok(Math.abs(r.timeSeconds - expectedSeconds) < 5,
    `expected the ordinary onTrail speed calc unaffected: ~${expectedSeconds}s, got ${r.timeSeconds}s`);
});

if (process.exitCode === 1) {
  console.error(`\nThe slope-gate onTrail exemption is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} slope-gate onTrail exemption checks passed.`);
}
