/**
 * Road-class speed model tests (docs/ROUTE_INTELLIGENCE.md §35 "Slice A").
 * Plain node:assert, framework-free, matching the project's test convention
 * (api/src/test/analysis.test.ts). Pure logic, no network — run directly:
 *
 *   npx tsx webapp/tests/roadSpeedModel.test.ts
 */
import * as assert from 'node:assert';
import {
  roadClassCeiling,
  setRoadSpeedOverrides,
  HIGHWAY_SPEED_KMH,
  TRACKTYPE_SPEED_CAP_KMH,
  UNTAGGED_TRACK_FALLBACK_KMH,
} from '@firebreak/terrain';

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

console.log('Road-class speed model:');

test('a bare motorway with no other tags returns the published motorway speed', () => {
  const r = roadClassCeiling({ highway: 'motorway' });
  assert.ok(r);
  assert.strictEqual(r!.speedKmh, 90);
  assert.strictEqual(r!.confidence, 'published');
});

test('the four sourced tables win as the MIN, not the highway-tag speed alone', () => {
  // A "motorway" (90) with a mud surface (10) and bad smoothness (40) —
  // the mud is the binding constraint.
  const r = roadClassCeiling({ highway: 'motorway', surface: 'mud', smoothness: 'bad' });
  assert.ok(r);
  assert.strictEqual(r!.speedKmh, 10);
  assert.strictEqual(r!.confidence, 'published');
});

test('smoothness=impassable is a genuine sourced NO-GO (0), regardless of highway class', () => {
  const r = roadClassCeiling({ highway: 'primary', smoothness: 'impassable' });
  assert.ok(r);
  assert.strictEqual(r!.speedKmh, 0);
});

test('a track with an explicit tracktype uses the tracktype cap, published', () => {
  const r = roadClassCeiling({ highway: 'track', tracktype: 'grade5' });
  assert.ok(r);
  assert.strictEqual(r!.speedKmh, TRACKTYPE_SPEED_CAP_KMH.grade5);
  assert.strictEqual(r!.confidence, 'published');
});

test('an untagged track (no surface/tracktype/smoothness) falls back to the Tier 0 grade3 assumption, ESTIMATED not published', () => {
  const r = roadClassCeiling({ highway: 'track' });
  assert.ok(r);
  assert.strictEqual(r!.speedKmh, UNTAGGED_TRACK_FALLBACK_KMH);
  assert.strictEqual(r!.confidence, 'estimated');
});

test('a completely untagged way (no highway tag at all) returns null, not a fabricated number', () => {
  const r = roadClassCeiling({});
  assert.strictEqual(r, null);
});

test('every MOBILITY_HIGHWAYS class except track/path/road has a HIGHWAY_SPEED_KMH entry', () => {
  const mobilityClasses = [
    'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
    'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
    'residential', 'living_street', 'service',
  ];
  for (const cls of mobilityClasses) {
    assert.ok(cls in HIGHWAY_SPEED_KMH, `missing HIGHWAY_SPEED_KMH entry for ${cls}`);
  }
});

test('a user override wins over the sourced default and flips confidence', () => {
  const r = roadClassCeiling(
    { highway: 'residential' },
    { highway: { residential: 5 } } // e.g. a known-poor local road
  );
  assert.ok(r);
  assert.strictEqual(r!.speedKmh, 5);
  assert.strictEqual(r!.confidence, 'user-override');
});

test('a user override on a non-binding tag still flips confidence (the way WAS edited)', () => {
  // motorway (90, unedited) with an overridden surface cap that happens not
  // to bind (60 > nothing else present) — still user-override, because the
  // caller changed something about this way's speed, even if a different
  // sourced tag ends up being the actual ceiling.
  const r = roadClassCeiling(
    { highway: 'residential', surface: 'gravel' }, // gravel caps at 40, binds
    { surface: { gravel: 999 } } // override raises the surface cap so it no longer binds
  );
  assert.ok(r);
  assert.strictEqual(r!.speedKmh, 25); // residential's own 25 now binds instead
  assert.strictEqual(r!.confidence, 'user-override');
});

// --- The claim that will matter most once composed into mobilityCost.ts ---
test('composition scenarios: vehicle-limited vs road-limited both bind correctly', () => {
  // A light 4WD (60 km/h capability) on a motorway (90 ceiling) — vehicle-limited.
  const motorway = roadClassCeiling({ highway: 'motorway' })!;
  assert.strictEqual(Math.min(60, motorway.speedKmh), 60);

  // The same 4WD on a grade5 track (20 ceiling) — road-limited.
  const grade5Track = roadClassCeiling({ highway: 'track', tracktype: 'grade5' })!;
  assert.strictEqual(Math.min(60, grade5Track.speedKmh), 20);
});

// --- The global-override singleton (docs §35 config UI, mobilityWorker.ts's
// worker-boundary problem) — setRoadSpeedOverrides is how a caller who
// doesn't want to thread an explicit `overrides` argument through every
// intermediate function still gets picked up. ---------------------------
test('setRoadSpeedOverrides makes roadClassCeiling pick up an override with NO explicit argument', () => {
  setRoadSpeedOverrides({ highway: { residential: 5 } });
  try {
    const r = roadClassCeiling({ highway: 'residential' }); // no second argument at all
    assert.ok(r);
    assert.strictEqual(r!.speedKmh, 5);
    assert.strictEqual(r!.confidence, 'user-override');
  } finally {
    setRoadSpeedOverrides(null); // never leak state into a later test
  }
});

test('an explicit overrides argument still wins over whatever the global was last set to', () => {
  setRoadSpeedOverrides({ highway: { residential: 5 } });
  try {
    const r = roadClassCeiling({ highway: 'residential' }, { highway: { residential: 12 } });
    assert.ok(r);
    assert.strictEqual(r!.speedKmh, 12, 'the explicit argument must win, not the global');
  } finally {
    setRoadSpeedOverrides(null);
  }
});

test('setRoadSpeedOverrides(null) clears it — a call after clearing sees the sourced default again', () => {
  setRoadSpeedOverrides({ highway: { residential: 5 } });
  setRoadSpeedOverrides(null);
  const r = roadClassCeiling({ highway: 'residential' });
  assert.ok(r);
  assert.strictEqual(r!.speedKmh, 25); // the sourced default, not 5
  assert.strictEqual(r!.confidence, 'published');
});

if (process.exitCode === 1) {
  console.error(`\nSome road-speed-model checks failed.`);
} else {
  console.log(`\nAll ${passed} road-speed-model checks passed.`);
}
