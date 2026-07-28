/**
 * Road routing tests (docs/ROUTE_INTELLIGENCE.md §35 "Slice A").
 * Plain node:assert. Run: npx tsx webapp/tests/roadRouting.test.ts
 */
import * as assert from 'node:assert';
import { buildRoadGraph, RoadWay } from '../src/terrain/roadGraph';
import { findRoadRoute, findKDissimilarRoadRoutes, edgeTravelTime } from '../src/terrain/roadRouting';
import { MOVER_PROFILES } from '../src/terrain/moverProfiles';

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
assert.ok(vehicle && footUnit, 'test setup: expected mover profiles missing');

console.log('Road routing (A* + k-alternatives):');

test('finds a route along a simple two-segment road', () => {
  const way: RoadWay = {
    kind: 'residential',
    coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.01, lng: 148.0 }, { lat: -35.02, lng: 148.0 }],
  };
  const g = buildRoadGraph([way]);
  const originId = [...g.nodes.values()].find(n => n.lat === -35.0)!.id;
  const objectiveId = [...g.nodes.values()].find(n => n.lat === -35.02)!.id;
  const route = findRoadRoute(g, [originId], [objectiveId], vehicle);
  assert.ok(route);
  assert.strictEqual(route!.nodeIds[0], originId);
  assert.strictEqual(route!.nodeIds[route!.nodeIds.length - 1], objectiveId);
  assert.ok(route!.totalSeconds > 0);
});

test('a genuinely disconnected road network returns null, not a crash', () => {
  const wayA: RoadWay = { kind: 'residential', coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.01, lng: 148.0 }] };
  const wayB: RoadWay = { kind: 'residential', coords: [{ lat: -10.0, lng: 100.0 }, { lat: -10.01, lng: 100.0 }] };
  const g = buildRoadGraph([wayA, wayB]);
  const originId = [...g.nodes.values()].find(n => n.lat === -35.0)!.id;
  const objectiveId = [...g.nodes.values()].find(n => n.lat === -10.0)!.id;
  const route = findRoadRoute(g, [originId], [objectiveId], vehicle);
  assert.strictEqual(route, null);
});

test('a faster-but-longer road beats a shorter-but-impassable one — composition matters, not just distance', () => {
  //        A ---(short, but smoothness=impassable)--- B
  //        A ---(longer, but a clean tertiary road)--- C --- B
  const A = { lat: -35.0, lng: 148.0 };
  const B = { lat: -35.0, lng: 148.02 };
  const C = { lat: -35.02, lng: 148.01 }; // detour south, then back up to B

  const directBlocked: RoadWay = { kind: 'track', smoothness: 'impassable', coords: [A, B] };
  const detour: RoadWay = { kind: 'tertiary', coords: [A, C, B] };

  const g = buildRoadGraph([directBlocked, detour]);
  const originId = [...g.nodes.values()].find(n => Math.abs(n.lat - A.lat) < 1e-6 && Math.abs(n.lng - A.lng) < 1e-6)!.id;
  const objectiveId = [...g.nodes.values()].find(n => Math.abs(n.lat - B.lat) < 1e-6 && Math.abs(n.lng - B.lng) < 1e-6)!.id;

  const route = findRoadRoute(g, [originId], [objectiveId], vehicle);
  assert.ok(route, 'must find the detour — the direct edge is a real NO-GO, not just slow');
  // The route must go via C (3 nodes), not a nonexistent 2-node direct hop.
  assert.strictEqual(route!.nodeIds.length, 3);
});

test('foot profiles are NOT slowed by a low road-class ceiling — only vehicles are', () => {
  const way: RoadWay = { kind: 'track', smoothness: 'bad', coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.0, lng: 148.01 }] };
  const g = buildRoadGraph([way]);
  const edge = [...g.adjacency.values()][0][0];

  const footResult = edgeTravelTime(edge, footUnit);
  const expectedFootSeconds = edge.distanceM / ((footUnit.roadSpeedKmh * 1000) / 3600);
  assert.ok(Math.abs(footResult.seconds - expectedFootSeconds) < 0.01,
    'foot travel time must come from the profile\'s own roadSpeedKmh alone, unaffected by smoothness=bad');

  const vehicleResult = edgeTravelTime(edge, vehicle);
  const expectedVehicleSeconds = edge.distanceM / ((40 * 1000) / 3600); // smoothness=bad caps at 40, below the 4WD's 60
  assert.ok(Math.abs(vehicleResult.seconds - expectedVehicleSeconds) < 0.01,
    'vehicle travel time must be road-limited by the smoothness cap');
});

test('smoothness=impassable is a hard block for vehicles (Infinity/blocked), not merely slow', () => {
  const way: RoadWay = { kind: 'track', smoothness: 'impassable', coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.0, lng: 148.01 }] };
  const g = buildRoadGraph([way]);
  const edge = [...g.adjacency.values()][0][0];
  const result = edgeTravelTime(edge, vehicle);
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.seconds, Infinity);
});

test('k-dissimilar routes finds both branches of a diamond, second route avoids the first', () => {
  //   A --- B --- D   (branch 1)
  //   A --- C --- D   (branch 2, same length)
  const A = { lat: -35.0, lng: 148.0 };
  const B = { lat: -34.99, lng: 148.01 };
  const C = { lat: -35.01, lng: 148.01 };
  const D = { lat: -35.0, lng: 148.02 };
  const branch1: RoadWay = { kind: 'tertiary', coords: [A, B, D] };
  const branch2: RoadWay = { kind: 'tertiary', coords: [A, C, D] };
  const g = buildRoadGraph([branch1, branch2]);

  const originId = [...g.nodes.values()].find(n => Math.abs(n.lat - A.lat) < 1e-6 && Math.abs(n.lng - A.lng) < 1e-6)!.id;
  const objectiveId = [...g.nodes.values()].find(n => Math.abs(n.lat - D.lat) < 1e-6 && Math.abs(n.lng - D.lng) < 1e-6)!.id;

  const routes = findKDissimilarRoadRoutes(g, [originId], [objectiveId], vehicle, 3);
  assert.strictEqual(routes.length, 2, 'exactly 2 genuinely distinct branches exist — a 3rd search must find nothing new and stop');

  const midNode1 = routes[0].nodeIds[1];
  const midNode2 = routes[1].nodeIds[1];
  assert.notStrictEqual(midNode1, midNode2, 'the two routes must go via DIFFERENT branches, not the same one twice');
});

test('multi-source: the nearer of several origin candidates is used', () => {
  const way: RoadWay = {
    kind: 'residential',
    coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.01, lng: 148.0 }, { lat: -35.02, lng: 148.0 }],
  };
  const g = buildRoadGraph([way]);
  const nearId = [...g.nodes.values()].find(n => n.lat === -35.01)!.id; // closer to objective
  const farId = [...g.nodes.values()].find(n => n.lat === -35.0)!.id;
  const objectiveId = [...g.nodes.values()].find(n => n.lat === -35.02)!.id;

  const route = findRoadRoute(g, [nearId, farId], [objectiveId], vehicle);
  assert.ok(route);
  assert.strictEqual(route!.nodeIds[0], nearId, 'A* should reach the objective via the cheaper of the two seeded origins');
});

if (process.exitCode === 1) {
  console.error(`\nSome road-routing checks failed.`);
} else {
  console.log(`\nAll ${passed} road-routing checks passed.`);
}
