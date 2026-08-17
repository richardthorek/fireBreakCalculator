/**
 * WP5 Tier B, Fix 2 (`minCutBarrier.ts`) — `computeMinCutBarrier` and
 * `computeRoadNetworkMinCut` used to call `edgeMobilityCost`/`edgeTravelTime`
 * TWICE per directed edge: once at graph-build time, once again at
 * boundary-segment-extraction time, from scratch, for the identical inputs.
 * Both now cache the build-time passability verdict and reuse it at
 * extraction instead.
 *
 * THE REAL RISK OF THIS FIX (stated per this work package's process note): a
 * pure memoisation of a pure function is safe by construction PROVIDED the
 * cache key genuinely identifies one edge. The hex grid is safe with a
 * `${fromKey}|${toKey}` string key — `hexNeighbors` returns exactly six
 * DISTINCT neighbour directions per cell, so no two edges from the same cell
 * can ever share a key. The ROAD graph is not: it is a real OSM-derived
 * multigraph where two different mapped ways can produce two separate
 * `RoadEdge` objects between the exact same node pair (a junction), each with
 * its own tags and its own independent `blocked` verdict. A string-keyed
 * cache would let the second edge processed silently overwrite the first's
 * cached verdict — exactly the "presence-check collides with a legitimate,
 * distinct value" failure class this work package's process note calls out
 * from WP2. The fix keys the road cache by the `RoadEdge` OBJECT itself,
 * which cannot collide. This file's road-side tests exist specifically to
 * prove that: they build TWO parallel edges between the same node pair with
 * OPPOSITE passability, in BOTH array orders, and check the reported
 * segment is exactly the passable one — a string-keyed cache fails at least
 * one of these two orderings (see the mutation-testing note before each
 * test).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/minCutEdgeCache.test.ts
 */
import * as assert from 'node:assert';
import { hexKey, AxialCoord } from '@firebreak/terrain';
import { MobilityGridCell } from '@firebreak/terrain';
import { computeMinCutBarrier, computeRoadNetworkMinCut } from '@firebreak/terrain';
import { getMoverProfile } from '@firebreak/terrain';
import { RoadGraph, RoadEdge, RoadNode } from '@firebreak/terrain';

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

const vehicle = getMoverProfile('au-light-4wd')!;
const foot = getMoverProfile('foot-individual-unladen')!;

// ===========================================================================
// PART 1: hex `computeMinCutBarrier` — a simple, single-gap barrier so the
// cut, its value, and its segments are all independently predictable by
// hand, unaffected by the extraction-cache change (regression coverage: the
// existing road-class-tier tests in roadGraphEnsembleMinCutFusion.test.ts
// already exercise `cutValue`; this adds an explicit check on `segments`
// itself, the field the cache change actually touches).
// ===========================================================================
console.log('Hex min-cut (`computeMinCutBarrier`) — segments still correct after the extraction-cache change:');

function cell(hex: AxialCoord, opts: Partial<MobilityGridCell> = {}): MobilityGridCell {
  return {
    key: hexKey(hex),
    hex,
    center: { lat: -35 + hex.r * 0.001, lng: 149 + hex.q * 0.001 },
    elevation: 0,
    vegetation: 'grassland',
    vegEstimated: false,
    onTrail: false,
    nearestTrailTags: null,
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
    ...opts,
  };
}

test('a single-hex-wide chain: exactly one segment severs it, at the geometrically correct pair', () => {
  const hexes: AxialCoord[] = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
  const cells = hexes.map(h => cell(h));
  const cut = computeMinCutBarrier(cells, [hexKey(hexes[0])], [hexKey(hexes[2])], foot, false);
  assert.ok(cut, 'expected a real cut on a single connecting chain');
  assert.strictEqual(cut!.segments.length, 1, 'a 1-wide chain has exactly one bottleneck');
  const seg = cut!.segments[0];
  // Origin side is {q:0,r:0}; the cut edge must run FROM the origin side
  // INTO the far side — i.e. from {0,0} or {1,0} into the next hex along the
  // chain, never a segment pointing the wrong way or off-chain entirely.
  assert.ok(
    (seg.fromKey === hexKey({ q: 0, r: 0 }) && seg.toKey === hexKey({ q: 1, r: 0 })) ||
    (seg.fromKey === hexKey({ q: 1, r: 0 }) && seg.toKey === hexKey({ q: 2, r: 0 })),
    `segment ${seg.fromKey} -> ${seg.toKey} is not a real edge on this chain`
  );
});

test('a wider parallel-chain grid: cut value and segment count scale with real capacity, not an artefact of caching', () => {
  // Two fully independent 1-wide chains sharing no cells — origin/objective
  // seeded from both, so a correct cut must sever BOTH chains (2 segments,
  // each unit capacity for an off-trail edge).
  const chainA: AxialCoord[] = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
  const chainB: AxialCoord[] = [{ q: 0, r: 5 }, { q: 1, r: 5 }, { q: 2, r: 5 }];
  const cells = [...chainA, ...chainB].map(h => cell(h));
  const origin = [hexKey(chainA[0]), hexKey(chainB[0])];
  const objective = [hexKey(chainA[2]), hexKey(chainB[2])];
  const cut = computeMinCutBarrier(cells, origin, objective, foot, false);
  assert.ok(cut, 'expected a real cut across both parallel chains');
  assert.strictEqual(cut!.cutValue, 2, 'two independent off-trail (unit-capacity) chains sum to cutValue 2');
  assert.strictEqual(cut!.segments.length, 2, 'both chains must each contribute exactly one severing segment');
});

// ===========================================================================
// PART 2: road `computeRoadNetworkMinCut` — the multigraph collision risk.
// ===========================================================================
console.log('\nRoad min-cut (`computeRoadNetworkMinCut`) — parallel edges with DIFFERENT passability must not collide:');

function nodesAB(): Map<string, RoadNode> {
  return new Map<string, RoadNode>([
    ['a', { id: 'a', lat: -35.0, lng: 149.0 }],
    ['b', { id: 'b', lat: -35.0, lng: 149.01 }],
  ]);
}

const PASSABLE_TAGS = { highway: 'residential' };
const BLOCKED_TAGS = { highway: 'residential', smoothness: 'impassable' };

/**
 * Builds a graph with TWO separate `RoadEdge`s from 'a' to 'b' — a real,
 * legitimate shape (two mapped ways meeting at the same junction pair), one
 * passable, one blocked — in the given array order. `passableFirst` controls
 * which is processed first by the build loop, so both orderings can be
 * proven safe independently (a string-keyed `${from}|${to}` cache is
 * last-write-wins and gets EXACTLY ONE of the two orderings wrong in an
 * observably different way — see the two tests below).
 */
function parallelEdgeGraph(passableFirst: boolean): RoadGraph {
  const passable: RoadEdge = { from: 'a', to: 'b', distanceM: 900, wayTags: PASSABLE_TAGS, wayName: 'Good Rd' };
  const blocked: RoadEdge = { from: 'a', to: 'b', distanceM: 900, wayTags: BLOCKED_TAGS, wayName: 'Bad Rd' };
  const adjacency = new Map<string, RoadEdge[]>();
  adjacency.set('a', passableFirst ? [passable, blocked] : [blocked, passable]);
  return { nodes: nodesAB(), adjacency, wayCount: 2 };
}

// Mutation-testing note (passable listed SECOND): under the old, buggy
// string-keyed design this ordering leaves the cache holding `passable=true`
// for key `a|b` (the LAST edge processed wins) — but that `true` gets read
// back for BOTH edge objects during extraction, so the BLOCKED edge would
// ALSO wrongly emit a segment: `segments.length` would be 2, one of them
// fabricated ("Bad Rd" reported as a real severing barrier segment when it
// was never traversable at all — exactly the "present fabricated data as
// real analysis" failure this project forbids). The object-identity cache
// used here reports exactly 1.
test('blocked edge listed AFTER the passable one: only the passable edge is reported (not the blocked duplicate, not both)', () => {
  const graph = parallelEdgeGraph(true);
  const cut = computeRoadNetworkMinCut(graph, ['a'], ['b'], vehicle);
  assert.ok(cut, 'expected a real cut — the passable edge connects a to b');
  assert.strictEqual(cut!.segments.length, 1, `expected exactly 1 segment, got ${cut!.segments.length}`);
  assert.strictEqual(cut!.segments[0].wayName, 'Good Rd', 'the reported segment must be the PASSABLE edge, never the blocked duplicate');
});

// Mutation-testing note (passable listed FIRST): under the old, buggy
// string-keyed design this ordering leaves the cache holding
// `passable=false` (blocked, processed last, wins) for key `a|b` — read back
// for BOTH edges, so even the genuinely passable "Good Rd" edge would be
// wrongly EXCLUDED from `segments`, leaving `segments.length === 0` despite a
// real cut existing (cutValue > 0 from a correctly-built flow graph, since
// the BUILD loop never used the cache — only extraction did). That
// contradiction (a nonzero cut with no reported segments) is exactly the
// silent, hard-to-notice defect this test guards against.
test('blocked edge listed BEFORE the passable one: only the passable edge is reported (order-independence proves no key collision)', () => {
  const graph = parallelEdgeGraph(false);
  const cut = computeRoadNetworkMinCut(graph, ['a'], ['b'], vehicle);
  assert.ok(cut, 'expected a real cut — the passable edge connects a to b');
  assert.strictEqual(cut!.segments.length, 1, `expected exactly 1 segment, got ${cut!.segments.length}`);
  assert.strictEqual(cut!.segments[0].wayName, 'Good Rd', 'the reported segment must be the PASSABLE edge, never the blocked duplicate');
});

test('a genuinely single, unambiguous passable edge still cuts and reports correctly (baseline, no parallel edges)', () => {
  const nodes = nodesAB();
  const adjacency = new Map<string, RoadEdge[]>();
  adjacency.set('a', [{ from: 'a', to: 'b', distanceM: 900, wayTags: PASSABLE_TAGS, wayName: 'Only Rd' }]);
  const graph: RoadGraph = { nodes, adjacency, wayCount: 1 };
  const cut = computeRoadNetworkMinCut(graph, ['a'], ['b'], vehicle);
  assert.ok(cut, 'expected a real cut');
  assert.strictEqual(cut!.segments.length, 1);
  assert.strictEqual(cut!.segments[0].wayName, 'Only Rd');
});

if (process.exitCode === 1) {
  console.error(`\nSome min-cut edge-cache checks failed.`);
} else {
  console.log(`\nAll ${passed} min-cut edge-cache checks passed.`);
}
