/**
 * Live-pipeline wiring proof (docs/ROUTE_INTELLIGENCE.md §35 Slice A —
 * "Slice A.9", 2026-07-27). `roadGraph.ts`/`roadRouting.ts` were proven
 * correct in isolation by `lakeGeorgeRoadRouting.test.ts`, working directly
 * with graph node IDs — but nothing in the running app ever called them
 * before this. `roadRouteSearch.ts` is the actual function the app calls
 * (`mobilityAppreciation.ts`), taking PAINTED AREAS and raw fetched OSM ways
 * (`InfrastructureTrail[]`), exactly the shapes a real run has in hand. This
 * test re-proves the Lake George claim through THAT function, at that
 * boundary — the thing that was actually missing.
 *
 * Same synthetic geometry as lakeGeorgeRoadRouting.test.ts, deliberately not
 * re-derived independently, so both tests are provably about the same claim.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/roadRouteSearch.test.ts
 */
import * as assert from 'node:assert';
import { findVehicleRoadRoute } from '../src/terrain/roadRouteSearch';
import { singleDabArea } from '../src/terrain/paintedArea';
import { InfrastructureTrail } from '../src/utils/infrastructureService';
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
const foot = MOVER_PROFILES.find(p => p.speedModel === 'irmischer-clarke-offpath')!;
assert.ok(vehicle && foot);

// Identical geometry to lakeGeorgeRoadRouting.test.ts.
const westOrigin = { lat: -35.05, lng: 149.30 };
const westNorth = { lat: -35.00, lng: 149.31 };
const eastObjective = { lat: -35.05, lng: 149.55 };
const eastNorth = { lat: -35.00, lng: 149.54 };
const connectorNW = { lat: -34.85, lng: 149.31 };
const connectorNE = { lat: -34.85, lng: 149.54 };

const westLocalRoad: InfrastructureTrail = { kind: 'residential', coords: [westOrigin, westNorth] };
const eastLocalRoad: InfrastructureTrail = { kind: 'residential', coords: [eastNorth, eastObjective] };
const northConnector: InfrastructureTrail = { name: 'North Loop Rd', kind: 'tertiary', coords: [westNorth, connectorNW, connectorNE, eastNorth] };
const allWays = [westLocalRoad, eastLocalRoad, northConnector];

console.log('Live-pipeline road-route wiring (§35 Slice A.9):');

test('findVehicleRoadRoute finds the Lake George detour from PAINTED AREAS, not raw node IDs', () => {
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = findVehicleRoadRoute(origin, objective, allWays, vehicle);
  assert.ok(result, 'FAILED: the live-pipeline wiring did not find the route the isolated router finds');
  assert.ok(result!.totalDistanceM > 0);
  assert.ok(result!.totalSeconds > 0);
  assert.ok(result!.waypoints.length >= 2);
});

test('a foot profile NEVER gets a road-graph route, regardless of road data present', () => {
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = findVehicleRoadRoute(origin, objective, allWays, foot);
  assert.strictEqual(result, null, 'roadSpeedModel.ts is explicit: road class must never modulate foot movement');
});

test('no road data fetched for this AOI returns null cleanly, not a crash', () => {
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = findVehicleRoadRoute(origin, objective, [], vehicle);
  assert.strictEqual(result, null);
});

test('CONTROL: without the northern connector, the live wiring also correctly finds no route', () => {
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = findVehicleRoadRoute(origin, objective, [westLocalRoad, eastLocalRoad], vehicle);
  assert.strictEqual(result, null, 'without the connector the two shores are genuinely disconnected');
});

test('an override on the binding road class changes the reported travel time', () => {
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const baseline = findVehicleRoadRoute(origin, objective, allWays, vehicle)!;
  const overridden = findVehicleRoadRoute(origin, objective, allWays, vehicle, { highway: { tertiary: 5 } })!;
  assert.ok(overridden, 'route must still be found with an override in place');
  assert.ok(overridden.totalSeconds > baseline.totalSeconds,
    `slowing the connector's speed to 5 km/h should make the route take LONGER (baseline ${baseline.totalSeconds}s, overridden ${overridden.totalSeconds}s)`);
});

test('a painted area far from any road returns null (no road within snapping distance), not a false match', () => {
  const farFromRoads = { lat: -36.5, lng: 148.0 }; // nowhere near the synthetic network
  const origin = singleDabArea(farFromRoads, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = findVehicleRoadRoute(origin, objective, allWays, vehicle);
  assert.strictEqual(result, null);
});

if (process.exitCode === 1) {
  console.error(`\nSome live-pipeline road-route checks failed.`);
} else {
  console.log(`\nAll ${passed} live-pipeline road-route checks passed.`);
}
