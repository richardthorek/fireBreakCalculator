/**
 * Road-class composition inside edgeMobilityCost (docs/ROUTE_INTELLIGENCE.md
 * §35 "Slice A" — the hex-grid half: an onTrail hex's speed bonus now
 * reflects the ACTUAL road class, not a flat bonus regardless of whether the
 * trail is a motorway or a grade-5 track).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/roadClassOnTrailSpeed.test.ts
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
const footUnit = MOVER_PROFILES.find(p => p.id === 'foot-unit')!;
assert.ok(vehicle && footUnit);

const base = (overrides: Partial<MobilitySample> = {}): MobilitySample => ({
  lat: -35.0, lng: 148.0, elevation: 100, vegetation: 'grassland', vegEstimated: false,
  onTrail: true, ...overrides,
});

console.log('Road-class composition in edgeMobilityCost (onTrail hexes):');

test('onTrail with no trail tags at all behaves exactly as before (flat roadSpeedKmh)', () => {
  const from = base({ nearestTrailTags: null });
  const to = base({ nearestTrailTags: null });
  const r = edgeMobilityCost(vehicle, from, to, 1000);
  const expectedHours = 1 / vehicle.roadSpeedKmh;
  const expectedSeconds = expectedHours * 3600;
  assert.ok(Math.abs(r.timeSeconds - expectedSeconds) < 1, `${r.timeSeconds} vs ${expectedSeconds}`);
});

test('a motorway does not slow the vehicle below its own capability (vehicle-limited)', () => {
  const from = base({ nearestTrailTags: { highway: 'motorway' } });
  const to = base({ nearestTrailTags: { highway: 'motorway' } });
  const r = edgeMobilityCost(vehicle, from, to, 1000);
  // Vehicle's own roadSpeedKmh (60) is below the motorway ceiling (90), so
  // the vehicle's own capability binds — identical to the no-tags case.
  const expectedSeconds = (1 / vehicle.roadSpeedKmh) * 3600;
  assert.ok(Math.abs(r.timeSeconds - expectedSeconds) < 1);
});

test('a smoothness=bad track genuinely slows the vehicle below its own road capability', () => {
  const from = base({ nearestTrailTags: { highway: 'track', smoothness: 'bad' } });
  const to = base({ nearestTrailTags: { highway: 'track', smoothness: 'bad' } });
  const r = edgeMobilityCost(vehicle, from, to, 1000);
  // smoothness=bad caps at 40 km/h, below the 4WD's 60 km/h road capability.
  const expectedSeconds = (1 / 40) * 3600;
  assert.ok(Math.abs(r.timeSeconds - expectedSeconds) < 1,
    `expected ~${expectedSeconds}s (40 km/h ceiling), got ${r.timeSeconds}s`);
});

test('a foot unit on the SAME bad track is completely unaffected — its own doctrinal rate applies', () => {
  const from = base({ nearestTrailTags: { highway: 'track', smoothness: 'bad' } });
  const to = base({ nearestTrailTags: { highway: 'track', smoothness: 'bad' } });
  const r = edgeMobilityCost(footUnit, from, to, 1000);
  const expectedSeconds = (1 / footUnit.roadSpeedKmh) * 3600; // 4.0 km/h, untouched by smoothness
  assert.ok(Math.abs(r.timeSeconds - expectedSeconds) < 1,
    `foot-unit road speed must ignore road class entirely: expected ~${expectedSeconds}s, got ${r.timeSeconds}s`);
});

test('off-trail (not onNetwork) is unaffected by trail tags regardless of what they say', () => {
  const from = base({ onTrail: false, nearestTrailTags: null });
  const to = base({ onTrail: false, nearestTrailTags: { highway: 'motorway' } }); // present but irrelevant — onTrail is false
  const r = edgeMobilityCost(vehicle, from, to, 1000);
  const expectedSeconds = (1 / (vehicle.roadSpeedKmh * vehicle.crossCountryFactor)) * 3600;
  assert.ok(Math.abs(r.timeSeconds - expectedSeconds) < 1);
});

if (process.exitCode === 1) {
  console.error(`\nSome road-class-composition checks failed.`);
} else {
  console.log(`\nAll ${passed} road-class-composition checks passed.`);
}
