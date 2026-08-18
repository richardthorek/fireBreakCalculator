/**
 * Incident box geometry tests (see docs/ROUTE_INTELLIGENCE.md "Incident box").
 * Plain node:assert. Run: npx tsx webapp/tests/incidentBoxGeometry.test.ts
 */
import * as assert from 'node:assert';
import {
  bearingBetween,
  destinationPoint,
  classifySectors,
  offsetBySector,
  toClosedRing,
  centroidOf,
  BoxSector,
} from '../src/utils/incidentBoxGeometry';

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

console.log('Incident box geometry:');

test('bearingBetween: due north is ~0deg, due east is ~90deg', () => {
  const origin = { lat: -33.0, lng: 149.0 };
  const north = { lat: -32.9, lng: 149.0 };
  const east = { lat: -33.0, lng: 149.15 };
  assert.ok(Math.abs(bearingBetween(origin, north) - 0) < 1);
  assert.ok(Math.abs(bearingBetween(origin, east) - 90) < 2);
});

test('destinationPoint round-trips with bearingBetween (short distance)', () => {
  const origin = { lat: -33.0, lng: 149.0 };
  const dest = destinationPoint(origin, 45, 1000);
  const backBearing = bearingBetween(origin, dest);
  assert.ok(Math.abs(backBearing - 45) < 1, `expected ~45deg, got ${backBearing}`);
});

test('destinationPoint moves roughly the requested distance', () => {
  const origin = { lat: -33.0, lng: 149.0 };
  const dest = destinationPoint(origin, 90, 500);
  // Rough haversine check
  const R = 6371000;
  const dLat = (dest.lat - origin.lat) * Math.PI / 180;
  const dLng = (dest.lng - origin.lng) * Math.PI / 180;
  const lat1 = origin.lat * Math.PI / 180, lat2 = dest.lat * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(a));
  assert.ok(Math.abs(dist - 500) < 5, `expected ~500m, got ${dist}`);
});

test('classifySectors: vertex directly downwind of a north wind is head', () => {
  // Wind FROM north (0deg) blows fire south — head is south of centroid.
  const perimeter = [
    { lat: 0.001, lng: 0 },   // north of centroid
    { lat: -0.001, lng: 0 },  // south of centroid (downwind = head)
    { lat: 0, lng: 0.001 },   // east (flank)
    { lat: 0, lng: -0.001 },  // west (flank)
  ];
  const wind = { directionFromDeg: 0 };
  const classified = classifySectors(perimeter, wind);
  const south = classified.find(v => v.sourcePoint.lat < 0)!;
  const north = classified.find(v => v.sourcePoint.lat > 0)!;
  assert.strictEqual(south.sector, 'head');
  assert.strictEqual(north.sector, 'rear');
});

test('offsetBySector pushes each vertex outward by its own sector distance', () => {
  const perimeter = [{ lat: -0.001, lng: 0 }, { lat: 0.001, lng: 0 }];
  const wind = { directionFromDeg: 0 };
  const classified = classifySectors(perimeter, wind);
  const distances: Record<BoxSector, number> = { head: 200, leftFlank: 50, rightFlank: 50, rear: 10 };
  const offset = offsetBySector(classified, distances);
  for (const o of offset) {
    assert.ok(o.offsetM === distances[o.vertex.sector]);
    // Offset point should differ from source when distance > 0
    if (o.offsetM > 0) {
      assert.notStrictEqual(o.point.lat, o.vertex.sourcePoint.lat);
    }
  }
});

test('toClosedRing closes the ring (first === last)', () => {
  const points = [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }];
  const ring = toClosedRing(points);
  assert.strictEqual(ring.length, 4);
  assert.deepStrictEqual(ring[0], ring[3]);
});

test('centroidOf averages the vertices', () => {
  const c = centroidOf([{ lat: 0, lng: 0 }, { lat: 2, lng: 4 }]);
  assert.strictEqual(c.lat, 1);
  assert.strictEqual(c.lng, 2);
});

console.log(`\n${passed} checks passed`);
