/**
 * onTrail hex-corner sampling (2026-08-03 fix) — reported live: a road
 * painted straight through an analysed area came out NO-GO/severely-
 * restricted on both sides of the real, unbroken road. Root cause:
 * `onTrail` was tested only at a hex's CENTRE point, unlike `waterDistanceM`
 * (already centre+corners). A road threading diagonally across a hex easily
 * misses its centroid by more than TRAIL_SNAP_M (30 m) while still visibly
 * crossing real hex area, so those hexes fell back to vegetation/slope-only
 * classification and got hard-gated at full severity despite sitting right
 * on a mapped road. `sampleOnTrail` (mobilityGrid.ts) fixes this the same
 * way the water scan already was fixed — centre + six hex corners, minimum
 * distance wins.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/onTrailHexCorners.test.ts
 */
import * as assert from 'node:assert';
import { hexCorners, makeProjection, toLatLng, LocalPoint } from '../src/utils/hexGrid';
import { sampleOnTrail } from '../src/terrain/mobilityGrid';
import { InfrastructureTrail } from '../src/utils/infrastructureService';
import { LatLng } from '../src/utils/chainage';

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

console.log('onTrail hex-corner sampling (live-reported fix):');

const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };
const proj = makeProjection(ANCHOR);
const HEX_SIZE = 50; // circumradius, metres — comfortably > TRAIL_SNAP_M (30 m)
const TRAIL_SNAP_M = 30;

const centerLocal: LocalPoint = { x: 0, y: 0 };
const cornerLocals = hexCorners(centerLocal, HEX_SIZE); // each exactly 50 m from centre
const center = toLatLng(proj, centerLocal);
const corners = cornerLocals.map(p => toLatLng(proj, p));

// A short "road" segment sitting exactly AT the first corner — 0 m from that
// corner, ~50 m (or more, adjacent-corner spacing on a regular hexagon is on
// the same order) from every other sample point including the centre.
const road: InfrastructureTrail = {
  kind: 'tertiary',
  coords: [corners[0], { lat: corners[0].lat + 0.00001, lng: corners[0].lng + 0.00001 }],
  surface: 'asphalt',
};

test('centre-only sampling (the pre-fix behaviour) misses a road that only clips a hex corner', () => {
  const result = sampleOnTrail([center], [road], TRAIL_SNAP_M);
  assert.strictEqual(result.onTrail, false);
  assert.strictEqual(result.nearestTrailTags, null);
});

test('centre + six corners (the fix) correctly finds the SAME road', () => {
  const result = sampleOnTrail([center, ...corners], [road], TRAIL_SNAP_M);
  assert.strictEqual(result.onTrail, true);
  assert.ok(result.nearestTrailTags);
  assert.strictEqual(result.nearestTrailTags!.highway, 'tertiary');
  assert.strictEqual(result.nearestTrailTags!.surface, 'asphalt');
});

test('a road genuinely nowhere near ANY sample point is correctly off-trail (control, not a false positive)', () => {
  const farRoad: InfrastructureTrail = {
    kind: 'tertiary',
    coords: [
      { lat: ANCHOR.lat + 1, lng: ANCHOR.lng + 1 },
      { lat: ANCHOR.lat + 1.001, lng: ANCHOR.lng + 1.001 },
    ],
  };
  const result = sampleOnTrail([center, ...corners], [farRoad], TRAIL_SNAP_M);
  assert.strictEqual(result.onTrail, false);
  assert.strictEqual(result.nearestTrailTags, null);
});

test('no trails at all is a clean false, not a crash', () => {
  const result = sampleOnTrail([center, ...corners], [], TRAIL_SNAP_M);
  assert.strictEqual(result.onTrail, false);
  assert.strictEqual(result.nearestTrailTags, null);
});

console.log(`\n${passed} assertion group(s) passed.`);
