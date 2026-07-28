/**
 * The "genuinely mixed hex+road-graph adjacency" slice (docs §42b, 2026-07-28)
 * — the piece §42/§42a explicitly deferred as real, larger, riskier work:
 * the movement ensemble now actually walks the road graph's own exact edges
 * when a mover is on a linked onTrail cell, and a SEPARATE road-network-exact
 * min-cut can target a real road segment narrower than a hex.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/roadGraphMixedAdjacency.test.ts
 */
import * as assert from 'node:assert';
import { hexKey, AxialCoord } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { simulateMovementEnsemble } from '../src/terrain/movementSimulation';
import { computeRoadNetworkMinCut } from '../src/terrain/minCutBarrier';
import { getMoverProfile } from '../src/terrain/moverProfiles';
import { RoadGraph, RoadEdge, RoadNode } from '../src/terrain/roadGraph';

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

function cell(hex: AxialCoord, lat: number, lng: number, opts: Partial<MobilityGridCell> = {}): MobilityGridCell {
  return {
    key: hexKey(hex),
    hex,
    center: { lat, lng },
    elevation: 0,
    vegetation: 'grassland',
    vegEstimated: false,
    onTrail: true,
    nearestTrailTags: { highway: 'residential' },
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
    ...opts,
  };
}

function addBidirectionalEdge(
  adjacency: Map<string, RoadEdge[]>,
  a: string, b: string, distanceM: number, highway = 'residential'
): void {
  const wayTags = { highway };
  const forward: RoadEdge = { from: a, to: b, distanceM, wayTags };
  const backward: RoadEdge = { from: b, to: a, distanceM, wayTags };
  const aList = adjacency.get(a) ?? [];
  aList.push(forward);
  adjacency.set(a, aList);
  const bList = adjacency.get(b) ?? [];
  bList.push(backward);
  adjacency.set(b, bList);
}

const vehicle = getMoverProfile('au-light-4wd')!;

// ===========================================================================
// PART 1: Ensemble mixed-mode movement — the road graph bridges a gap pure
// hex adjacency structurally cannot cross in one step.
// ===========================================================================
console.log('Ensemble mixed-mode movement (§42b):');

// H1 and H2 are deliberately NOT hex-adjacent and NO intermediate hex cells
// exist between them at all — an extreme, deliberately isolated fixture (a
// real AOI grid would have a continuous cell array) chosen specifically so
// "did the road graph bridge this" gives an unambiguous yes/no signal, not a
// statistical shift to interpret.
const H1: AxialCoord = { q: 0, r: 0 };
const H2: AxialCoord = { q: 10, r: 0 };
const H1_LAT = -35.05, H1_LNG = 149.30;
// ~4.56 km east of H1 (0.05deg lng * 111320 * cos(-35.05deg)).
const H2_LAT = -35.05, H2_LNG = 149.35;

const bridgeCells: MobilityGridCell[] = [
  cell(H1, H1_LAT, H1_LNG),
  cell(H2, H2_LAT, H2_LNG),
];

// Road graph: N0 (at H1) -- N1 (a pass-through vertex, deliberately >150m
// from both hexes so it is never itself a landing) -- N2 (at H2). Proves the
// BOUNDED WALK actually chains through an intermediate node, not just a
// single-hop shortcut.
const N0 = 'n0', N1 = 'n1', N2 = 'n2';
const roadNodes = new Map<string, RoadNode>([
  [N0, { id: N0, lat: H1_LAT, lng: H1_LNG }],
  [N1, { id: N1, lat: H1_LAT, lng: (H1_LNG + H2_LNG) / 2 }],
  [N2, { id: N2, lat: H2_LAT, lng: H2_LNG }],
]);
const roadAdjacency = new Map<string, RoadEdge[]>();
addBidirectionalEdge(roadAdjacency, N0, N1, 2280);
addBidirectionalEdge(roadAdjacency, N1, N2, 2280);
const bridgeGraph: RoadGraph = { nodes: roadNodes, adjacency: roadAdjacency, wayCount: 1 };

// Expected exact travel time: 2 edges of 2280m each on a `residential` way
// (25 km/h ceiling, composed with the vehicle's own road speed) — computed
// independently here (not by calling the code under test) as the ground truth
// to check the ensemble's real elapsed time against.
const RESIDENTIAL_KMH = Math.min(vehicle.roadSpeedKmh, 25);
const EXPECTED_SECONDS = 2 * (2280 / ((RESIDENTIAL_KMH * 1000) / 3600));

test('BASELINE (no road graph): the two hexes are genuinely unreachable from each other — proves the fixture has no hidden hex-adjacency shortcut', () => {
  const ensemble = simulateMovementEnsemble(
    bridgeCells, [hexKey(H1)], [hexKey(H2)], vehicle, false, 200, { origin: { lat: H1_LAT, lng: H1_LNG }, mPerDegLat: 111320, mPerDegLng: 111320 },
    { moverCount: 30, seed: 1, keepTrajectories: 0 }
  );
  assert.ok(ensemble, 'expected a non-null ensemble result');
  assert.strictEqual(ensemble!.arrivedCount, 0, 'no mover should be able to cross a gap with no hex adjacency and no road graph');
  assert.strictEqual(ensemble!.lostCount, ensemble!.moverCount);
});

test('WITH road graph: movers bridge the gap via the real road-graph edges', () => {
  const ensemble = simulateMovementEnsemble(
    bridgeCells, [hexKey(H1)], [hexKey(H2)], vehicle, false, 200, { origin: { lat: H1_LAT, lng: H1_LNG }, mPerDegLat: 111320, mPerDegLng: 111320 },
    { moverCount: 30, seed: 1, keepTrajectories: 0, roadGraph: bridgeGraph }
  );
  assert.ok(ensemble, 'expected a non-null ensemble result');
  assert.strictEqual(ensemble!.arrivedCount, ensemble!.moverCount, 'every mover should now cross via the road graph');
  assert.strictEqual(ensemble!.lostCount, 0);
});

test('the crossing takes the EXACT road-graph travel time, not a hex-approximated distance (there is no hex edge to approximate from at all)', () => {
  const ensemble = simulateMovementEnsemble(
    bridgeCells, [hexKey(H1)], [hexKey(H2)], vehicle, false, 200, { origin: { lat: H1_LAT, lng: H1_LNG }, mPerDegLat: 111320, mPerDegLng: 111320 },
    { moverCount: 10, seed: 7, keepTrajectories: 0, roadGraph: bridgeGraph }
  )!;
  for (const track of ensemble.tracks) {
    assert.ok(
      Math.abs(track.totalSeconds - EXPECTED_SECONDS) < 1,
      `expected ~${EXPECTED_SECONDS.toFixed(1)}s, got ${track.totalSeconds.toFixed(1)}s`
    );
  }
});

test('SAFETY GATE: a defined (even empty) blockedEdges set disables mixed-mode entirely — a restriction can never be silently bypassed by the road-graph shortcut', () => {
  const ensemble = simulateMovementEnsemble(
    bridgeCells, [hexKey(H1)], [hexKey(H2)], vehicle, false, 200, { origin: { lat: H1_LAT, lng: H1_LNG }, mPerDegLat: 111320, mPerDegLng: 111320 },
    { moverCount: 20, seed: 1, keepTrajectories: 0, roadGraph: bridgeGraph, blockedEdges: new Set() }
  );
  assert.ok(ensemble, 'expected a non-null ensemble result');
  assert.strictEqual(ensemble!.arrivedCount, 0, 'mixed-mode must be off whenever blockedEdges is defined, matching restrictionPlanner.ts usage');
});

test('an off-trail current cell never gets road-graph candidates even when a road graph is supplied', () => {
  const offTrailCells: MobilityGridCell[] = [
    cell(H1, H1_LAT, H1_LNG, { onTrail: false, nearestTrailTags: null }),
    cell(H2, H2_LAT, H2_LNG, { onTrail: false, nearestTrailTags: null }),
  ];
  const ensemble = simulateMovementEnsemble(
    offTrailCells, [hexKey(H1)], [hexKey(H2)], vehicle, false, 200, { origin: { lat: H1_LAT, lng: H1_LNG }, mPerDegLat: 111320, mPerDegLng: 111320 },
    { moverCount: 20, seed: 1, keepTrajectories: 0, roadGraph: bridgeGraph }
  );
  assert.ok(ensemble, 'expected a non-null ensemble result');
  assert.strictEqual(ensemble!.arrivedCount, 0, 'an off-trail cell has no linked road node, so no bridge should be offered');
});

// ===========================================================================
// PART 2: Road-network-exact min-cut — targets a real road edge, narrower
// than a hex, using the same proven max-flow machinery as the hex cut.
// ===========================================================================
console.log('\nRoad-network-exact min-cut (§42b):');

function linearGraph(highway = 'residential'): RoadGraph {
  const nodes = new Map<string, RoadNode>([
    ['a', { id: 'a', lat: -35.0, lng: 149.0 }],
    ['b', { id: 'b', lat: -35.0, lng: 149.01 }],
    ['c', { id: 'c', lat: -35.0, lng: 149.02 }],
  ]);
  const adjacency = new Map<string, RoadEdge[]>();
  addBidirectionalEdge(adjacency, 'a', 'b', 900, highway);
  addBidirectionalEdge(adjacency, 'b', 'c', 900, highway);
  return { nodes, adjacency, wayCount: 1 };
}

test('a single-path chain: exactly one segment severs it, and removing it genuinely disconnects origin from objective', () => {
  const cut = computeRoadNetworkMinCut(linearGraph(), ['a'], ['c'], vehicle);
  assert.ok(cut, 'expected a real cut on a single connecting path');
  assert.strictEqual(cut!.segments.length, 1, 'a chain has exactly one bottleneck, regardless of its length in nodes');
  const cutKeys = new Set(cut!.segments.map(s => `${s.fromNodeId}|${s.toNodeId}`));
  const remaining = new Map<string, RoadEdge[]>();
  for (const [from, edges] of linearGraph().adjacency) {
    remaining.set(from, edges.filter(e => !cutKeys.has(`${e.from}|${e.to}`) && !cutKeys.has(`${e.to}|${e.from}`)));
  }
  // BFS from 'a' over the post-cut graph must never reach 'c'.
  const seen = new Set(['a']);
  const queue = ['a'];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    for (const e of remaining.get(u) ?? []) {
      if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
  }
  assert.ok(!seen.has('c'), 'removing the reported cut segment(s) must genuinely disconnect origin from objective');
});

test('a motorway chain carries strictly more min-cut capacity than an identical residential chain', () => {
  const motorwayCut = computeRoadNetworkMinCut(linearGraph('motorway'), ['a'], ['c'], vehicle);
  const residentialCut = computeRoadNetworkMinCut(linearGraph('residential'), ['a'], ['c'], vehicle);
  assert.ok(motorwayCut && residentialCut);
  assert.ok(
    motorwayCut!.cutValue > residentialCut!.cutValue,
    `expected motorway (${motorwayCut!.cutValue}) > residential (${residentialCut!.cutValue})`
  );
});

test('two parallel paths between origin and objective require severing BOTH — cut value is their combined capacity', () => {
  const nodes = new Map<string, RoadNode>([
    ['a', { id: 'a', lat: -35.0, lng: 149.0 }],
    ['b1', { id: 'b1', lat: -35.001, lng: 149.01 }],
    ['b2', { id: 'b2', lat: -34.999, lng: 149.01 }],
    ['c', { id: 'c', lat: -35.0, lng: 149.02 }],
  ]);
  const adjacency = new Map<string, RoadEdge[]>();
  addBidirectionalEdge(adjacency, 'a', 'b1', 900, 'residential');
  addBidirectionalEdge(adjacency, 'b1', 'c', 900, 'residential');
  addBidirectionalEdge(adjacency, 'a', 'b2', 900, 'residential');
  addBidirectionalEdge(adjacency, 'b2', 'c', 900, 'residential');
  const diamond: RoadGraph = { nodes, adjacency, wayCount: 1 };

  const single = computeRoadNetworkMinCut(linearGraph('residential'), ['a'], ['c'], vehicle)!;
  const cut = computeRoadNetworkMinCut(diamond, ['a'], ['c'], vehicle);
  assert.ok(cut);
  assert.strictEqual(cut!.segments.length, 2, 'both branches must be cut, one segment each');
  assert.strictEqual(cut!.cutValue, single.cutValue * 2, 'two parallel equal-capacity branches sum their capacity');
});

test('an impassable (smoothness=impassable) edge is excluded from the flow graph — never traversed, never available to cut', () => {
  const nodes = new Map<string, RoadNode>([
    ['a', { id: 'a', lat: -35.0, lng: 149.0 }],
    ['b', { id: 'b', lat: -35.0, lng: 149.01 }],
  ]);
  const adjacency = new Map<string, RoadEdge[]>();
  const wayTags = { highway: 'residential', smoothness: 'impassable' };
  adjacency.set('a', [{ from: 'a', to: 'b', distanceM: 900, wayTags }]);
  adjacency.set('b', [{ from: 'b', to: 'a', distanceM: 900, wayTags }]);
  const blockedGraph: RoadGraph = { nodes, adjacency, wayCount: 1 };
  const cut = computeRoadNetworkMinCut(blockedGraph, ['a'], ['b'], vehicle);
  assert.strictEqual(cut, null, 'an already-impassable-only graph has nothing left to cut — origin and objective are already disconnected');
});

test('an empty road graph returns null, not a crash', () => {
  const empty: RoadGraph = { nodes: new Map(), adjacency: new Map(), wayCount: 0 };
  assert.strictEqual(computeRoadNetworkMinCut(empty, ['a'], ['b'], vehicle), null);
});

if (process.exitCode === 1) {
  console.error(`\nThe mixed hex+road-graph adjacency is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} checks passed.`);
}
