/**
 * `smoothFreeVertices`/`RefineOptions.cornerSmoothingIterations`
 * (`pathRefinement.ts`, docs/ROUTE_INTELLIGENCE.md §28 addendum, 2026-07-28).
 *
 * Added for Terrain Mobility corridor routes: the existing `refinePath`
 * pipeline only fixed the ON-ROAD portion of a route (`snapPathToTrails`) —
 * an OVERLAND stretch, with no nearby mapped trail at all, kept the raw
 * hex-centre zig-zag untouched. Owner, live: "there may not always be a
 * road to snap to, noting some corridors may be overland." This proves the
 * corner-smoothing pass fixes exactly that case, without touching a
 * genuinely road-snapped stretch, and without moving either endpoint.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/pathSmoothing.test.ts
 */
import * as assert from 'node:assert';
import { smoothFreeVertices, refinePath, resamplePath } from '../src/utils/pathRefinement';
import { InfrastructureTrail } from '../src/utils/infrastructureService';
import { LatLng } from '@firebreak/terrain';
import { calculateDistance } from '../src/utils/slopeCalculation';

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

console.log('Path corner-smoothing (§28 addendum — overland corridors):');

// A hex-centre-style zig-zag: alternating north/south offset every step
// while making net eastward progress — exactly what a Dijkstra path over a
// hex grid produces when the true cheapest direction is "roughly east".
function buildZigZag(steps: number, stepM: number, zigM: number): LatLng[] {
  const start: LatLng = { lat: -35.0, lng: 149.0 };
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((start.lat * Math.PI) / 180);
  const coords: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = i * stepM;
    const y = i % 2 === 0 ? 0 : zigM;
    coords.push({ lat: start.lat + y / mPerDegLat, lng: start.lng + x / mPerDegLng });
  }
  return coords;
}

/** Sum of absolute turning angle (deg) at each interior vertex — a genuine,
 *  simple "how zig-zaggy is this line" measure: a straight line scores 0, a
 *  line that reverses direction every step scores close to 180 per vertex. */
function totalTurningDeg(coords: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const a = coords[i - 1], b = coords[i], c = coords[i + 1];
    const h1 = Math.atan2(b.lat - a.lat, b.lng - a.lng);
    const h2 = Math.atan2(c.lat - b.lat, c.lng - b.lng);
    let diff = ((h2 - h1) * 180) / Math.PI;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    total += Math.abs(diff);
  }
  return total;
}

const zigzag = buildZigZag(20, 30, 15); // 20 steps of 30m, zig-zagging 15m off-axis

test('setup: the synthetic path really is zig-zaggy (sanity)', () => {
  assert.ok(totalTurningDeg(zigzag) > 500, 'FAILED: fixture must actually zig-zag for this test to mean anything');
});

test('smoothFreeVertices reduces total turning — the line reads straighter', () => {
  const smoothed = smoothFreeVertices(zigzag, new Set(), 3, 0.5);
  const before = totalTurningDeg(zigzag);
  const after = totalTurningDeg(smoothed);
  assert.ok(after < before * 0.5, `FAILED: expected turning to drop by at least half, got ${before.toFixed(0)} -> ${after.toFixed(0)}`);
});

test('smoothFreeVertices never moves the two endpoints', () => {
  const smoothed = smoothFreeVertices(zigzag, new Set(), 3, 0.5);
  assert.deepStrictEqual(smoothed[0], zigzag[0], 'FAILED: start vertex moved');
  assert.deepStrictEqual(smoothed[smoothed.length - 1], zigzag[zigzag.length - 1], 'FAILED: end vertex moved');
});

test('smoothFreeVertices never moves a LOCKED (snapped-to-trail) vertex', () => {
  const locked = new Set([5, 10, 15]);
  const smoothed = smoothFreeVertices(zigzag, locked, 3, 0.5);
  for (const i of locked) {
    assert.deepStrictEqual(smoothed[i], zigzag[i], `FAILED: locked vertex ${i} moved`);
  }
});

test('refinePath with cornerSmoothingIterations=0 (default) leaves an overland path exactly as un-smoothed as before this change', () => {
  const refined = refinePath(zigzag, [], { snapToTrails: false, resampleM: 30 });
  // resamplePath at 30m spacing on a fixture already spaced ~30m should be
  // close to a no-op; turning should be essentially unchanged from the raw
  // zig-zag, proving the DEFAULT behaviour (fire-break optimizer, unchanged)
  // really is "off unless asked for".
  const before = totalTurningDeg(zigzag);
  const after = totalTurningDeg(refined);
  assert.ok(after > before * 0.8, `FAILED: default refinePath should not meaningfully smooth an overland path, got ${before.toFixed(0)} -> ${after.toFixed(0)}`);
});

test('refinePath with cornerSmoothingIterations>0 smooths an OVERLAND path with no nearby trail at all', () => {
  const refined = refinePath(zigzag, [], { snapToTrails: false, resampleM: 30, cornerSmoothingIterations: 3 });
  const before = totalTurningDeg(zigzag);
  const after = totalTurningDeg(refined);
  assert.ok(after < before * 0.5, `FAILED: expected real smoothing with no trail data present, got ${before.toFixed(0)} -> ${after.toFixed(0)}`);
});

test('refinePath still snaps to a real nearby trail even with corner smoothing enabled — a genuine road-following stretch is not blurred off it', () => {
  // A straight trail running exactly along the fixture's own mean heading,
  // close enough for every vertex to snap.
  const trail: InfrastructureTrail = {
    kind: 'track',
    coords: [
      { lat: -35.0, lng: 149.0 },
      { lat: -35.0, lng: 149.0 + (20 * 30) / (111320 * Math.cos((-35.0 * Math.PI) / 180)) },
    ],
  };
  const refined = refinePath(zigzag, [trail], {
    snapToTrails: true, snapThresholdM: 50, maxSnapAngleDeg: 60, resampleM: 30, cornerSmoothingIterations: 3,
  });
  // Every interior point should now sit almost exactly on the trail's own
  // latitude (-35.0), not smeared somewhere between the trail and the
  // original zig-zag.
  const maxLatDeviation = Math.max(...refined.slice(1, -1).map(p => Math.abs(p.lat - -35.0)));
  const maxDeviationM = maxLatDeviation * 111320;
  assert.ok(maxDeviationM < 5, `FAILED: expected the route to sit on the trail (within ~5m), max deviation was ${maxDeviationM.toFixed(1)}m`);
});

test('resamplePath sanity: still preserves endpoints exactly (regression guard for the new pipeline ordering)', () => {
  const resampled = resamplePath(zigzag, 10);
  assert.deepStrictEqual(resampled[0], zigzag[0]);
  assert.deepStrictEqual(resampled[resampled.length - 1], zigzag[zigzag.length - 1]);
  assert.ok(resampled.length > zigzag.length, 'FAILED: densifying at a finer spacing should add points');
});

if (process.exitCode === 1) {
  console.error(`\nPath corner-smoothing did NOT hold.`);
} else {
  console.log(`\nAll ${passed} path corner-smoothing checks passed.`);
}
