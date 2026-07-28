/**
 * `chaikinSmoothRing`/`smoothPolygonGeometry` (`polygonSmoothing.ts`, docs
 * /ROUTE_INTELLIGENCE.md §28, "Smooth the corridor band's own outline" — the
 * lower-priority remainder of the 2026-07-28 corridor-route-rendering fix).
 * A corridor's outline is a genuine `@turf/union` of its own hex cells — a
 * real dissolved shape, not an approximation — but the hex tessellation
 * still leaves it visibly blocky at close zoom. This proves the smoothing
 * pass rounds off that blockiness (measured the same way
 * `pathSmoothing.test.ts` measures route zig-zag: total turning angle),
 * keeps the ring closed and roughly the same shape/area, and that
 * `smoothPolygonGeometry` correctly walks every ring of both `Polygon` and
 * `MultiPolygon` geometries (a real `@turf/union` can produce either).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/polygonSmoothing.test.ts
 */
import * as assert from 'node:assert';
import { chaikinSmoothRing, smoothPolygonGeometry } from '../src/utils/polygonSmoothing';
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

console.log('Polygon corner-smoothing (§28 — corridor outline):');

/** A blocky, hex-tessellation-like ring: a staircase octagon-ish shape with
 *  sharp right-angle steps, closed (first === last). */
function buildStaircaseRing(): LatLng[] {
  const raw: [number, number][] = [
    [0, 0], [0, 2], [1, 2], [1, 3], [2, 3], [2, 5], [3, 5], [3, 6],
    [5, 6], [5, 5], [6, 5], [6, 3], [5, 3], [5, 2], [3, 2], [3, 0],
  ];
  const scale = 0.001; // degrees, small enough to stay a sane lat/lng fixture
  const ring = raw.map(([x, y]) => ({ lat: -35 + y * scale, lng: 149 + x * scale }));
  return [...ring, ring[0]];
}

/** Per-vertex unsigned turning angle (deg). NOTE: the SUM of these is a
 *  near-invariant of a closed polygon's own topology (a rectilinear
 *  staircase sums to the same total before and after Chaikin smoothing —
 *  each 90° corner splits into two ~45°(-ish) turns rather than the total
 *  shrinking), so summing is the WRONG "how blocky is this" measure for a
 *  closed ring, unlike `pathSmoothing.test.ts`'s open-path case. The
 *  MAXIMUM single-vertex turn is what actually captures "still has sharp
 *  staircase corners vs. reads as a smooth curve", and is what these tests
 *  check. */
function turningAnglesDeg(coords: LatLng[]): number[] {
  const n = coords.length - 1; // last === first for a closed ring
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = coords[(i - 1 + n) % n];
    const b = coords[i];
    const c = coords[(i + 1) % n];
    const h1 = Math.atan2(b.lat - a.lat, b.lng - a.lng);
    const h2 = Math.atan2(c.lat - b.lat, c.lng - b.lng);
    let diff = ((h2 - h1) * 180) / Math.PI;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    out.push(Math.abs(diff));
  }
  return out;
}
function maxTurningDeg(coords: LatLng[]): number {
  return Math.max(...turningAnglesDeg(coords));
}

/** Shoelace formula — signed area, absolute value used for magnitude checks. */
function ringArea(coords: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    sum += coords[i].lng * coords[i + 1].lat - coords[i + 1].lng * coords[i].lat;
  }
  return Math.abs(sum) / 2;
}

const staircase = buildStaircaseRing();

test('setup: the fixture ring is closed and genuinely blocky (sanity)', () => {
  assert.strictEqual(staircase[0].lat, staircase[staircase.length - 1].lat);
  assert.strictEqual(staircase[0].lng, staircase[staircase.length - 1].lng);
  assert.strictEqual(maxTurningDeg(staircase), 90, 'FAILED: fixture must be a pure right-angle staircase');
});

test('chaikinSmoothRing reduces the MAXIMUM single-corner turn — no more sharp staircase corners', () => {
  const before = maxTurningDeg(staircase);
  const oneIteration = maxTurningDeg(chaikinSmoothRing(staircase, 1));
  const twoIterations = maxTurningDeg(chaikinSmoothRing(staircase, 2));
  const threeIterations = maxTurningDeg(chaikinSmoothRing(staircase, 3));
  assert.ok(oneIteration < before, `FAILED: 1 pass should already round off the 90° corners, got ${oneIteration.toFixed(1)}°`);
  // Monotonically smoother with more passes — converging toward a curve.
  assert.ok(twoIterations < oneIteration, 'FAILED: 2 passes should be smoother than 1');
  assert.ok(threeIterations < twoIterations, 'FAILED: 3 passes should be smoother than 2');
  assert.ok(threeIterations < 20, `FAILED: expected near-flat corners after 3 passes, max turn was ${threeIterations.toFixed(1)}°`);
});

test('chaikinSmoothRing keeps the ring closed', () => {
  const smoothed = chaikinSmoothRing(staircase, 2);
  assert.strictEqual(smoothed[0].lat, smoothed[smoothed.length - 1].lat);
  assert.strictEqual(smoothed[0].lng, smoothed[smoothed.length - 1].lng);
});

test('chaikinSmoothRing does not balloon or collapse the shape — area stays close to the original', () => {
  const before = ringArea(staircase);
  const after = ringArea(chaikinSmoothRing(staircase, 3));
  const ratio = after / before;
  // Corner-cutting always shrinks area slightly (it cuts corners, never
  // adds); a real bug (geometry inversion, degenerate collapse) would show
  // up as either a near-zero or a wildly larger area.
  assert.ok(ratio > 0.85 && ratio <= 1.001, `FAILED: area ratio ${ratio.toFixed(3)} is outside a sane range for corner-cutting`);
});

test('chaikinSmoothRing with 0 iterations is a no-op', () => {
  const smoothed = chaikinSmoothRing(staircase, 0);
  assert.deepStrictEqual(smoothed, staircase);
});

test('chaikinSmoothRing leaves a too-small ring (<4 points) unchanged rather than degenerating', () => {
  const tiny: LatLng[] = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 0 }];
  assert.deepStrictEqual(chaikinSmoothRing(tiny, 3), tiny);
});

test('smoothPolygonGeometry smooths every ring of a Polygon (outer + hole)', () => {
  const hole: LatLng[] = [
    { lat: -34.999, lng: 149.001 }, { lat: -34.999, lng: 149.002 },
    { lat: -34.998, lng: 149.0015 }, { lat: -34.999, lng: 149.001 },
  ];
  const geometry = {
    type: 'Polygon',
    coordinates: [staircase.map(p => [p.lng, p.lat]), hole.map(p => [p.lng, p.lat])],
  };
  const smoothed = smoothPolygonGeometry(geometry, 2) as { type: string; coordinates: [number, number][][] };
  assert.strictEqual(smoothed.type, 'Polygon');
  assert.strictEqual(smoothed.coordinates.length, 2, 'FAILED: expected both the outer ring and the hole to survive');
  assert.ok(smoothed.coordinates[0].length > staircase.length, 'FAILED: outer ring should have more points after smoothing (corner-cutting doubles them per pass)');
  assert.ok(smoothed.coordinates[1].length > hole.length, 'FAILED: hole ring should also be smoothed');
});

test('smoothPolygonGeometry smooths every polygon of a MultiPolygon', () => {
  const second = staircase.map(p => ({ lat: p.lat + 0.01, lng: p.lng + 0.01 }));
  const geometry = {
    type: 'MultiPolygon',
    coordinates: [
      [staircase.map(p => [p.lng, p.lat])],
      [second.map(p => [p.lng, p.lat])],
    ],
  };
  const smoothed = smoothPolygonGeometry(geometry, 2) as { type: string; coordinates: [number, number][][][] };
  assert.strictEqual(smoothed.type, 'MultiPolygon');
  assert.strictEqual(smoothed.coordinates.length, 2);
  assert.ok(smoothed.coordinates[0][0].length > staircase.length);
  assert.ok(smoothed.coordinates[1][0].length > second.length);
});

test('smoothPolygonGeometry passes an unrecognised geometry type through unchanged', () => {
  const geometry = { type: 'Point', coordinates: [149, -35] };
  const result = smoothPolygonGeometry(geometry, 2);
  assert.deepStrictEqual(result, geometry);
});

if (process.exitCode === 1) {
  console.error(`\nPolygon corner-smoothing did NOT hold.`);
} else {
  console.log(`\nAll ${passed} polygon corner-smoothing checks passed.`);
}
