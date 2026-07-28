/**
 * The claim that matters most for §35 Slice A (docs/ROUTE_INTELLIGENCE.md,
 * "Slice A — road network graph: full design" § Tests).
 *
 * Field report that started this whole design: a west→east crossing of Lake
 * George, NSW returned "no route" because the AOI's padding was proportional
 * to the origin↔objective span, so a ~25 km obstacle north-south got ~400 m
 * of room to route around. That defect lived in `mobilityGrid.ts`'s
 * bounding-box construction — the HEX grid's problem.
 *
 * The road graph built in this slice (`roadGraph.ts`/`roadRouting.ts`) never
 * had a bounding box to begin with — a vehicle follows a road wherever it
 * leads. This test proves that claim directly, at Lake-George scale: a
 * synthetic road network with NO direct west↔east road at all (exactly what
 * a real lake produces — nobody builds a road across open water), only a
 * long connector around the northern end. If this test passes, the road
 * graph finds the detour unprompted, with no box, no padding parameter, and
 * no awareness that a "lake" is involved at all — it only ever sees roads.
 *
 * Includes the control the project's own hydrology smoke test established as
 * the right discipline (docs §34): remove the ONE connecting road and prove
 * the SAME network now returns no route — confirming this test is actually
 * exercising real connectivity, not succeeding for some unrelated reason.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/lakeGeorgeRoadRouting.test.ts
 */
import * as assert from 'node:assert';
import { buildRoadGraph, nearestNode, RoadWay } from '../src/terrain/roadGraph';
import { findRoadRoute } from '../src/terrain/roadRouting';
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
assert.ok(vehicle);

// --- Synthetic geometry, Lake-George order of magnitude -------------------
// "Lake" occupies roughly lng 149.33–149.52 (≈17 km wide at this latitude),
// lat -35.15 to -34.90 (≈28 km long) — no ways are ever placed inside it,
// the same way no OSM way crosses open water in reality.
const westOrigin = { lat: -35.05, lng: 149.30 };
const westNorth = { lat: -35.00, lng: 149.31 };
const eastObjective = { lat: -35.05, lng: 149.55 };
const eastNorth = { lat: -35.00, lng: 149.54 };
const connectorNW = { lat: -34.85, lng: 149.31 }; // north of the lake's northern tip
const connectorNE = { lat: -34.85, lng: 149.54 };

const westLocalRoad: RoadWay = { kind: 'residential', coords: [westOrigin, westNorth] };
const eastLocalRoad: RoadWay = { kind: 'residential', coords: [eastNorth, eastObjective] };
// The ONLY thing connecting the two shores — deliberately a single tertiary
// road, the long way around the top.
const northConnector: RoadWay = { kind: 'tertiary', coords: [westNorth, connectorNW, connectorNE, eastNorth] };

console.log('The Lake George claim (§35 Slice A):');

test('a route IS found around a ~25 km obstacle with no direct road, no box, no padding parameter', () => {
  const graph = buildRoadGraph([westLocalRoad, eastLocalRoad, northConnector]);
  const originNode = nearestNode(graph, westOrigin, 50)!;
  const objectiveNode = nearestNode(graph, eastObjective, 50)!;
  assert.ok(originNode && objectiveNode, 'test setup: origin/objective must snap onto the synthetic network');

  const route = findRoadRoute(graph, [originNode.id], [objectiveNode.id], vehicle);
  assert.ok(route, 'FAILED: no route found — this is the exact failure mode the owner reported at Lake George');

  const nwId = [...graph.nodes.values()].find(n => Math.abs(n.lat - connectorNW.lat) < 1e-6)!.id;
  const neId = [...graph.nodes.values()].find(n => Math.abs(n.lat - connectorNE.lat) < 1e-6)!.id;
  assert.ok(route!.nodeIds.includes(nwId) && route!.nodeIds.includes(neId),
    'the route must genuinely pass through the northern connector, not some other path');
});

test('the route is a REAL detour — meaningfully longer than the straight-line distance, not a shortcut', () => {
  const graph = buildRoadGraph([westLocalRoad, eastLocalRoad, northConnector]);
  const originNode = nearestNode(graph, westOrigin, 50)!;
  const objectiveNode = nearestNode(graph, eastObjective, 50)!;
  const route = findRoadRoute(graph, [originNode.id], [objectiveNode.id], vehicle)!;

  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(eastObjective.lat - westOrigin.lat);
  const dLng = toRad(eastObjective.lng - westOrigin.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(westOrigin.lat)) * Math.cos(toRad(eastObjective.lat)) * Math.sin(dLng / 2) ** 2;
  const straightLineM = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const routeSeconds = route.totalSeconds;
  const straightLineSecondsAtRoadSpeed = straightLineM / ((vehicle.roadSpeedKmh * 1000) / 3600);
  assert.ok(routeSeconds > straightLineSecondsAtRoadSpeed * 1.5,
    `the detour (${routeSeconds}s) should cost noticeably more than a hypothetical straight line (${straightLineSecondsAtRoadSpeed}s) — ` +
    `if it doesn't, the test geometry isn't actually forcing a real detour`);
});

// --- The control: remove the ONE connecting road, prove the SAME network ---
// now genuinely fails. This is what proves the test above is exercising real
// connectivity — not succeeding for an unrelated reason (e.g. a bug that
// makes findRoadRoute return SOMETHING regardless of actual graph structure).
test('CONTROL: remove the northern connector — the identical network now correctly finds NO route', () => {
  const graph = buildRoadGraph([westLocalRoad, eastLocalRoad]); // northConnector omitted
  const originNode = nearestNode(graph, westOrigin, 50)!;
  const objectiveNode = nearestNode(graph, eastObjective, 50)!;
  assert.ok(originNode && objectiveNode);

  const route = findRoadRoute(graph, [originNode.id], [objectiveNode.id], vehicle);
  assert.strictEqual(route, null,
    'without the connector the two shores are genuinely disconnected — a route here would mean the test is not exercising what it claims to');
});

if (process.exitCode === 1) {
  console.error(`\nThe Lake George claim did NOT hold.`);
} else {
  console.log(`\nAll ${passed} checks passed — the Lake George claim holds.`);
}
