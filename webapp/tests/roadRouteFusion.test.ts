/**
 * Road-graph fusion into chokepoint/corridor analysis (docs §42, 2026-07-28).
 * Owner: "why not just complete the grid over the top of [roads]... the
 * cross country corridors can be filled in as the focus of the broader
 * analysis" — the actual gap wasn't hex resolution (a fine hex grid would
 * still quantize the road, worse than the box-free road graph's exact
 * geometry), it was that the road-graph route sat only as a separate,
 * additive display — never counted by chokepoint analysis or corridor-band
 * clustering the way the hex-optimiser's own k routes are.
 *
 * `roadRouteToDissimilarRoute` (roadRouteSearch.ts) converts a
 * `RoadRouteSearchResult` into the identical `DissimilarRoute` shape those
 * consumers already expect, snapping resampled points onto the caller's own
 * hex grid so chokepoint counts are directly comparable to a hex-grid route.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/roadRouteFusion.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint, makeProjection } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { roadRouteToDissimilarRoute, RoadRouteSearchResult } from '../src/terrain/roadRouteSearch';
import { computeChokepoints } from '../src/terrain/corridorAnalysis';
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

const HEX_SIZE = 30;
const ANCHOR: LatLng = { lat: -35.05, lng: 149.30 };
const proj = makeProjection(ANCHOR);
const BOX_MIN: LocalPoint = { x: -50, y: -50 };
const BOX_MAX: LocalPoint = { x: 1200, y: 200 };

function buildGrid(): MobilityGridCell[] {
  const cellsRaw = generateBoxHexes(BOX_MIN, BOX_MAX, HEX_SIZE);
  return cellsRaw.map(c => ({
    key: hexKey(c.hex),
    hex: c.hex,
    center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / 111320 },
    elevation: 0,
    vegetation: 'grassland' as const,
    vegEstimated: false,
    onTrail: false,
    nearestTrailTags: null,
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
  }));
}

// A road route running roughly west->east through the grid's local-coord
// span (x=0..1000, y=0), converted to lat/lng the same way buildGrid does.
function localToLatLng(x: number, y: number): { lat: number; lng: number } {
  return { lat: ANCHOR.lat + y / 111320, lng: ANCHOR.lng + x / 111320 };
}

const straightRoadRoute: RoadRouteSearchResult = {
  waypoints: [
    localToLatLng(0, 0), localToLatLng(300, 0), localToLatLng(700, 0), localToLatLng(1000, 0),
  ],
  totalSeconds: 100,
  totalDistanceM: 1000,
  wayNames: ['Test Highway'],
};

console.log('Road-route -> DissimilarRoute fusion (§42):');

test('produces a real DissimilarRoute with keys spanning the route and matching totalSeconds', () => {
  const cells = buildGrid();
  const route = roadRouteToDissimilarRoute(straightRoadRoute, cells);
  assert.ok(route, 'expected a non-null DissimilarRoute');
  assert.ok(route!.keys.length > 1, 'expected the route to span more than one hex cell');
  assert.strictEqual(route!.totalSeconds, straightRoadRoute.totalSeconds);
});

test('cumulative seconds along the resampled path are monotonically non-decreasing and end at totalSeconds', () => {
  const cells = buildGrid();
  const route = roadRouteToDissimilarRoute(straightRoadRoute, cells)!;
  for (let i = 1; i < route.path.length; i++) {
    assert.ok(route.path[i].cumulativeSeconds >= route.path[i - 1].cumulativeSeconds,
      `cumulative time went backward at index ${i}`);
  }
  const last = route.path[route.path.length - 1];
  assert.ok(Math.abs(last.cumulativeSeconds - straightRoadRoute.totalSeconds) < 0.01);
});

test('consecutive duplicate hex keys are deduplicated, not repeated', () => {
  const cells = buildGrid();
  const route = roadRouteToDissimilarRoute(straightRoadRoute, cells)!;
  for (let i = 1; i < route.keys.length; i++) {
    assert.notStrictEqual(route.keys[i], route.keys[i - 1], 'adjacent keys should never be identical');
  }
});

test('degenerate inputs return null, not a crash: fewer than 2 waypoints', () => {
  const cells = buildGrid();
  const degenerate: RoadRouteSearchResult = { waypoints: [localToLatLng(0, 0)], totalSeconds: 10, totalDistanceM: 0, wayNames: [] };
  assert.strictEqual(roadRouteToDissimilarRoute(degenerate, cells), null);
});

test('degenerate inputs return null, not a crash: empty cell array', () => {
  assert.strictEqual(roadRouteToDissimilarRoute(straightRoadRoute, []), null);
});

test('THE FUSION ITSELF: injecting the road route into computeChokepoints makes its cells count toward chokepoint ranking', () => {
  const cells = buildGrid();
  const route = roadRouteToDissimilarRoute(straightRoadRoute, cells)!;
  const chokepoints = computeChokepoints(cells, HEX_SIZE, proj, [route]);
  assert.ok(chokepoints.length > 0, 'FAILED: the road route contributed no chokepoint cells at all — the fusion wiring is not working');
  assert.ok(chokepoints.every(c => c.passCount >= 1));
  // Every chokepoint cell reported must actually be one the route's own keys
  // touched — proves the counting is real, not coincidental.
  const routeKeySet = new Set(route.keys);
  assert.ok(chokepoints.every(c => routeKeySet.has(c.key)));
});

if (process.exitCode === 1) {
  console.error(`\nThe road-route fusion is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} road-route fusion checks passed.`);
}
