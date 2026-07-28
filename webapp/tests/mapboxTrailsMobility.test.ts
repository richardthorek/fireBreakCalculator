/**
 * Live-tested finding (2026-07-28): a real, clearly-visible highway along a
 * Lake George shoreline was classified NO-GO end to end for a Terrain
 * Mobility run. Root cause traced to Overpass being unreachable for that
 * area (confirmed via this same session's console log — a 502 from our own
 * proxy, then every direct Overpass mirror failing CORS/timeout), which left
 * `onTrail` false for every cell. With no road data, the mapped-road
 * exemption on the hard slope/hydrology gates never fires, so a narrow,
 * engineered lake-edge shelf reads as NO-GO from raw DEM alone — even though
 * the SAME map tiles already loaded in the browser show the road plainly.
 *
 * Fix: `extractCorridorTrails` (mapboxTrails.ts) now accepts a `kind` and
 * widens to `MOBILITY_CLASSES` (motorway/trunk/primary included) for
 * `'highway-mobility'`, instead of being restricted to the fire-break-only
 * `REUSABLE_CLASSES`. This test exercises that against a stubbed Mapbox GL
 * map object (no real map/token needed — `querySourceFeatures` is the only
 * method this module calls).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/mapboxTrailsMobility.test.ts
 */
import * as assert from 'node:assert';
import { extractCorridorTrails } from '../src/utils/mapboxTrails';

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

console.log('Mapbox-tile trail fallback for Terrain Mobility (§35 addendum, 2026-07-28):');

// A stub map exposing exactly what extractCorridorTrails calls: getLayer
// (truthy => the query layer exists) and querySourceFeatures (returns a
// fixed feature set regardless of the filter argument, mirroring real Mapbox
// GL behaviour where the LAYER's own filter — not the query call — already
// narrowed what's queryable; extractCorridorTrails does its own per-call
// class filtering on top of whatever the layer returns).
function makeStubMap(features: any[]) {
  return {
    getLayer: () => true,
    querySourceFeatures: () => features,
  };
}

// A real highway class (motorway) alongside a plain residential street —
// coordinates chosen inside the query bbox used below.
const motorwayFeature = {
  id: 1,
  properties: { class: 'motorway', name: 'Federal Hwy' },
  geometry: { type: 'LineString', coordinates: [[149.300, -35.100], [149.301, -35.099]] },
};
const streetFeature = {
  id: 2,
  properties: { class: 'street', name: 'Local Rd' },
  geometry: { type: 'LineString', coordinates: [[149.300, -35.100], [149.302, -35.098]] },
};
const trackFeature = {
  id: 3,
  properties: { class: 'track' },
  geometry: { type: 'LineString', coordinates: [[149.300, -35.100], [149.303, -35.097]] },
};

const BBOX = { south: -35.2, west: 149.2, north: -35.0, east: 149.4 };

test("'highway' kind (fire-break) excludes motorway, matching the pre-existing REUSABLE_CLASSES behaviour", () => {
  const map = makeStubMap([motorwayFeature, streetFeature]);
  const trails = extractCorridorTrails(map, BBOX.south, BBOX.west, BBOX.north, BBOX.east, 'highway');
  assert.ok(trails, 'expected a non-null result');
  assert.ok(!trails!.some(t => t.kind === 'motorway'), 'motorway must NOT appear for the fire-break kind');
  assert.ok(trails!.some(t => t.kind === 'residential'), 'the street feature should still come through, translated to "residential"');
});

test("THE REPORTED SCENARIO: 'highway-mobility' kind DOES include motorway — the fix", () => {
  const map = makeStubMap([motorwayFeature, streetFeature, trackFeature]);
  const trails = extractCorridorTrails(map, BBOX.south, BBOX.west, BBOX.north, BBOX.east, 'highway-mobility');
  assert.ok(trails, 'expected a non-null result');
  const motorway = trails!.find(t => t.kind === 'motorway');
  assert.ok(motorway, 'FAILED: motorway must be present for highway-mobility — this is the exact live-reported gap');
  assert.strictEqual(motorway!.name, 'Federal Hwy');
});

test('Mapbox class -> OSM highway translation: "street" becomes "residential", classes that already match pass through unchanged', () => {
  const map = makeStubMap([streetFeature, trackFeature]);
  const trails = extractCorridorTrails(map, BBOX.south, BBOX.west, BBOX.north, BBOX.east, 'highway-mobility');
  assert.ok(trails);
  assert.ok(trails!.some(t => t.kind === 'residential'), 'Mapbox "street" should translate to OSM "residential"');
  assert.ok(trails!.some(t => t.kind === 'track'), 'Mapbox "track" already matches OSM "track" and should pass through unchanged');
});

test('surface/tracktype/smoothness are left undefined (Mapbox does not carry them), not fabricated', () => {
  const map = makeStubMap([motorwayFeature]);
  const trails = extractCorridorTrails(map, BBOX.south, BBOX.west, BBOX.north, BBOX.east, 'highway-mobility');
  assert.ok(trails && trails.length === 1);
  assert.strictEqual(trails![0].surface, undefined);
  assert.strictEqual(trails![0].tracktype, undefined);
  assert.strictEqual(trails![0].smoothness, undefined);
});

test('defaults to the "highway" (fire-break) kind when the caller omits it — backward compatible', () => {
  const map = makeStubMap([motorwayFeature]);
  const trails = extractCorridorTrails(map, BBOX.south, BBOX.west, BBOX.north, BBOX.east);
  assert.strictEqual(trails, null, 'motorway-only features with no kind argument should behave exactly like the old highway-only filter (empty -> null)');
});

test('an empty/absent feature set still returns null, never throws', () => {
  const map = makeStubMap([]);
  const trails = extractCorridorTrails(map, BBOX.south, BBOX.west, BBOX.north, BBOX.east, 'highway-mobility');
  assert.strictEqual(trails, null);
});

if (process.exitCode === 1) {
  console.error(`\nThe Mapbox-tile mobility fallback is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} Mapbox-tile mobility fallback checks passed.`);
}
