/**
 * Road graph construction tests (docs/ROUTE_INTELLIGENCE.md §35 "Slice A").
 * Plain node:assert. Run: npx tsx webapp/tests/roadGraph.test.ts
 */
import * as assert from 'node:assert';
import { buildRoadGraph, nearestNode, RoadWay } from '@firebreak/terrain';

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

console.log('Road graph construction:');

test('a single way with 3 vertices produces 3 nodes and 2 bidirectional edge pairs', () => {
  const way: RoadWay = {
    kind: 'track',
    coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.01, lng: 148.0 }, { lat: -35.02, lng: 148.0 }],
  };
  const g = buildRoadGraph([way]);
  assert.strictEqual(g.nodes.size, 3);
  // Each of the 2 segments contributes a bidirectional pair -> 4 directed edges total.
  const totalDirectedEdges = [...g.adjacency.values()].reduce((s, e) => s + e.length, 0);
  assert.strictEqual(totalDirectedEdges, 4);
});

test('two ways sharing an endpoint coordinate become connected through one shared node', () => {
  const junction = { lat: -35.5, lng: 148.5 };
  const wayA: RoadWay = { kind: 'residential', coords: [{ lat: -35.49, lng: 148.5 }, junction] };
  const wayB: RoadWay = { kind: 'track', coords: [junction, { lat: -35.51, lng: 148.5 }] };
  const g = buildRoadGraph([wayA, wayB]);
  // 2 endpoints from A + 2 from B, minus 1 shared junction = 3 distinct nodes.
  assert.strictEqual(g.nodes.size, 3);
  const junctionId = [...g.nodes.values()].find(n => Math.abs(n.lat - junction.lat) < 1e-6)!.id;
  // The junction node must have edges going BOTH ways (into A's other end and into B's other end).
  const edgesFromJunction = g.adjacency.get(junctionId) ?? [];
  assert.strictEqual(edgesFromJunction.length, 2, 'junction should connect both ways');
});

test('a Y-junction PARTWAY along a way (not at either endpoint) is still captured', () => {
  const mid = { lat: -35.2, lng: 148.2 };
  const wayA: RoadWay = {
    kind: 'unclassified',
    coords: [{ lat: -35.19, lng: 148.2 }, mid, { lat: -35.21, lng: 148.2 }],
  };
  const branch: RoadWay = { kind: 'track', coords: [mid, { lat: -35.2, lng: 148.25 }] };
  const g = buildRoadGraph([wayA, branch]);
  const midId = [...g.nodes.values()].find(n => Math.abs(n.lat - mid.lat) < 1e-6 && Math.abs(n.lng - mid.lng) < 1e-6)!.id;
  const edgesFromMid = g.adjacency.get(midId) ?? [];
  // mid connects to both ends of wayA (2 edges) plus the branch (1 edge) = 3.
  assert.strictEqual(edgesFromMid.length, 3, 'mid-way junction should have 3 outgoing edges');
});

test('a zero-length duplicate consecutive point in a way\'s own geometry creates no self-edge', () => {
  const way: RoadWay = {
    kind: 'track',
    coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.0, lng: 148.0 }, { lat: -35.01, lng: 148.0 }],
  };
  const g = buildRoadGraph([way]);
  assert.strictEqual(g.nodes.size, 2, 'the duplicate point must not create a spurious extra node');
  for (const edges of g.adjacency.values()) {
    for (const e of edges) assert.notStrictEqual(e.from, e.to, 'no self-edge should ever exist');
  }
});

test('edge distanceM is a real haversine distance, not zero or NaN', () => {
  const way: RoadWay = { kind: 'primary', coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.1, lng: 148.1 }] };
  const g = buildRoadGraph([way]);
  const anyEdge = [...g.adjacency.values()][0][0];
  assert.ok(Number.isFinite(anyEdge.distanceM) && anyEdge.distanceM > 0);
  // ~0.1 deg lat + ~0.1 deg lng at this latitude is roughly 11-15 km — sanity bound, not exact.
  assert.ok(anyEdge.distanceM > 5000 && anyEdge.distanceM < 20000, `${anyEdge.distanceM}`);
});

test('edges carry the owning way\'s tags for the speed model to consume', () => {
  const way: RoadWay = {
    kind: 'track', surface: 'gravel', tracktype: 'grade4',
    coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.01, lng: 148.0 }],
  };
  const g = buildRoadGraph([way]);
  const anyEdge = [...g.adjacency.values()][0][0];
  assert.strictEqual(anyEdge.wayTags.highway, 'track');
  assert.strictEqual(anyEdge.wayTags.surface, 'gravel');
  assert.strictEqual(anyEdge.wayTags.tracktype, 'grade4');
});

test('nearestNode finds the closest node within the radius, and null beyond it', () => {
  const way: RoadWay = { kind: 'track', coords: [{ lat: -35.0, lng: 148.0 }, { lat: -35.01, lng: 148.0 }] };
  const g = buildRoadGraph([way]);
  const close = nearestNode(g, { lat: -35.0001, lng: 148.0 }, 100);
  assert.ok(close);
  assert.strictEqual(close!.lat, -35.0);

  const farAway = nearestNode(g, { lat: -36.0, lng: 149.0 }, 100);
  assert.strictEqual(farAway, null, 'must not return a node far outside the search radius');
});

test('an empty way list produces an empty, well-formed graph (not a crash)', () => {
  const g = buildRoadGraph([]);
  assert.strictEqual(g.nodes.size, 0);
  assert.strictEqual(g.wayCount, 0);
});

if (process.exitCode === 1) {
  console.error(`\nSome road-graph checks failed.`);
} else {
  console.log(`\nAll ${passed} road-graph checks passed.`);
}
