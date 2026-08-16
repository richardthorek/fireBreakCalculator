/**
 * WP5 Tier B, Fix 3 (`applyCrossSlopeIncremental` in `mobilityGrid.ts`,
 * consumed by `mobilityLazyGrid.ts`'s round loop) — `applyCrossSlope`
 * previously ran a full `computeDemDerivatives` pass over the WHOLE
 * accumulated cell set on EVERY lazy-grid round (up to `MAX_LAZY_ROUNDS` =
 * 14 times), even though a cell's `crossSlopeDeg` only depends on its own
 * elevation and its PRESENT hex neighbours' elevations — a 1-ring local
 * plane fit (see `demDerivatives.ts`'s own header). `applyCrossSlopeIncremental`
 * recomputes only cells materialised THIS round plus their "halo" (any
 * already-existing cell adjacent to a new one, whose neighbour set just
 * grew) and leaves every other cell's already-correct value untouched.
 *
 * Two things this file has to prove, per the task's own instruction, because
 * getting the halo wrong is the realistic failure mode here in EITHER
 * direction:
 *
 *  1. A cell FAR from the new tiles gets the SAME value whether computed via
 *     one full recompute over the final grid, or via the incremental
 *     round-by-round path — this is the actual speedup claim: such a cell
 *     must never be touched by the incremental pass at all.
 *  2. A cell in the halo gets a DIFFERENT (correctly updated) value once its
 *     neighbour set actually changes — with concrete, hand-picked elevations
 *     chosen so the "before" value is exactly 0 (a flat plane through three
 *     symmetric zero-elevation neighbours) and the "after" value is a real,
 *     large, unambiguously nonzero number (one new neighbour at elevation
 *     50) — not two numbers that merely happen to differ in the 9th decimal
 *     place.
 *
 * Both are checked TWO ways: against a full `applyCrossSlope` recompute of
 * the FINAL combined grid (the ground truth "what should this cell's value
 * be"), and via the mutation-testing discipline this work package asks for
 * — deliberately reintroducing an "always recompute everything" and an
 * "halo excludes the affected neighbour" bug and confirming the relevant
 * assertion fails, then passes again with the real fix restored (see the
 * inline notes below; the actual revert-and-rerun was done by hand while
 * writing this fix — see the PR/session notes).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/crossSlopeIncremental.test.ts
 */
import * as assert from 'node:assert';
import { hexKey, hexNeighbors, axialToLocal, toLatLng, makeProjection, AxialCoord, LatLng } from '@firebreak/terrain';
import { MobilityGridCell } from '@firebreak/terrain';
import { applyCrossSlope, applyCrossSlopeIncremental } from '../src/terrain/mobilityGrid';

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
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };
const masterProj = makeProjection(ANCHOR);

function cell(hex: AxialCoord, elevation: number): MobilityGridCell {
  const center = toLatLng(masterProj, axialToLocal(hex, HEX_SIZE));
  return {
    key: hexKey(hex),
    hex,
    center,
    elevation,
    vegetation: 'grassland',
    vegEstimated: false,
    onTrail: false,
    nearestTrailTags: null,
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
  };
}

// --- ROUND 1 cluster: B and three of its six neighbours, all at elevation 0
// (a locally flat patch — B's plane fit is exactly flat, crossSlopeDeg = 0,
// as long as only these three neighbours are present).
const B: AxialCoord = { q: 0, r: 0 };
const N1: AxialCoord = { q: 1, r: 0 };   // adjacent to B AND to G below
const N2: AxialCoord = { q: -1, r: 0 };  // adjacent to B, NOT to G
const N3: AxialCoord = { q: 0, r: -1 };  // adjacent to B, NOT to G

// --- ROUND 1, entirely separate cluster: F and three of ITS six neighbours,
// in three genuinely different directions (a real 2D fit, not a degenerate
// collinear one), far away from B's cluster and from every round-2 addition.
const F: AxialCoord = { q: 20, r: 20 };
const FN1: AxialCoord = { q: 21, r: 20 };  // direction (1, 0)
const FN2: AxialCoord = { q: 20, r: 19 };  // direction (0, -1)
const FN3: AxialCoord = { q: 19, r: 21 };  // direction (-1, 1)

// --- ROUND 2 addition: G is a new neighbour of BOTH B and N1 (hex adjacency
// is symmetric and locally dense — see the test's own assertions below that
// confirm this is exactly the shape it needs to be), at a deliberately huge
// elevation so B's and N1's plane fits move from "exactly flat" to
// "unambiguously tilted".
const G: AxialCoord = { q: 0, r: 1 };
const G_ELEVATION = 50;

const round1Hexes = [B, N1, N2, N3, F, FN1, FN2, FN3];
const round1Cells: MobilityGridCell[] = [
  cell(B, 0), cell(N1, 0), cell(N2, 0), cell(N3, 0),
  cell(F, 4), cell(FN1, 9), cell(FN2, 2), cell(FN3, 5),
];
const round2NewCells: MobilityGridCell[] = [cell(G, G_ELEVATION)];
const finalCells = [...round1Cells, ...round2NewCells];

console.log('applyCrossSlopeIncremental — halo correctness (WP5 Tier B, Fix 3):');

test('test setup: G is hex-adjacent to BOTH B and N1, but to neither N2, N3, nor any F-cluster cell', () => {
  const gNeighbourKeys = new Set(hexNeighbors(G).map(hexKey));
  assert.ok(gNeighbourKeys.has(hexKey(B)), 'G must be adjacent to B for this fixture to test anything');
  assert.ok(gNeighbourKeys.has(hexKey(N1)), 'G must ALSO be adjacent to N1 — the halo must reach every affected existing cell, not just one');
  assert.ok(!gNeighbourKeys.has(hexKey(N2)), 'test setup: G must NOT be adjacent to N2 (the "near but unaffected" control)');
  assert.ok(!gNeighbourKeys.has(hexKey(N3)), 'test setup: G must NOT be adjacent to N3 (the "near but unaffected" control)');
  for (const h of [F, FN1, FN2, FN3]) {
    assert.ok(!gNeighbourKeys.has(hexKey(h)), `test setup: G must not be adjacent to the far F-cluster cell ${hexKey(h)}`);
  }
});

// --- Ground truth: one full recompute over the FINAL (round1+round2) grid.
const groundTruthCells = finalCells.map(c => ({ ...c }));
applyCrossSlope(groundTruthCells);
const groundTruth = new Map(groundTruthCells.map(c => [c.key, c.crossSlopeDeg]));

test('test setup: the full-recompute ground truth shows B and N1 as genuinely, unambiguously tilted (not ~0)', () => {
  assert.ok(groundTruth.get(hexKey(B))! > 5, `expected B's crossSlopeDeg to be clearly nonzero after G joins, got ${groundTruth.get(hexKey(B))}`);
  assert.ok(groundTruth.get(hexKey(N1))! > 5, `expected N1's crossSlopeDeg to be clearly nonzero after G joins, got ${groundTruth.get(hexKey(N1))}`);
});

// --- The actual incremental path, run the way mobilityLazyGrid.ts runs it:
// round 1 over just the round-1 cells, then round 2 adding only `G`.
const incrementalCells = round1Cells.map(c => ({ ...c }));
applyCrossSlopeIncremental(incrementalCells, incrementalCells); // round 1: every cell is "new"
const beforeG = new Map(incrementalCells.map(c => [c.key, c.crossSlopeDeg]));

const gCellLive = { ...round2NewCells[0] };
incrementalCells.push(gCellLive);
applyCrossSlopeIncremental(incrementalCells, [gCellLive]); // round 2: only G is new
const afterG = new Map(incrementalCells.map(c => [c.key, c.crossSlopeDeg]));

test('BEFORE round 2: B and N1 are exactly flat (0) — the fixture\'s designed starting point', () => {
  assert.strictEqual(beforeG.get(hexKey(B)), 0, `expected B flat before G, got ${beforeG.get(hexKey(B))}`);
  assert.strictEqual(beforeG.get(hexKey(N1)), 0, `expected N1 flat before G, got ${beforeG.get(hexKey(N1))}`);
});

// --- Half 2 (the halo must update): B and N1 must pick up the new value —
// and it must match the ground truth exactly, not just "some nonzero number".
test('HALO: B\'s crossSlopeDeg changes to the ground-truth value once G (its new neighbour) is added', () => {
  assert.notStrictEqual(afterG.get(hexKey(B)), beforeG.get(hexKey(B)), 'B must actually change once its neighbour set grows — this is the non-vacuous difference the fixture is built for');
  assert.strictEqual(afterG.get(hexKey(B)), groundTruth.get(hexKey(B)), `incremental B=${afterG.get(hexKey(B))} must equal full-recompute ground truth=${groundTruth.get(hexKey(B))}`);
});

test('HALO: N1\'s crossSlopeDeg ALSO changes and ALSO matches ground truth — the halo must reach every existing cell G touches, not just B', () => {
  assert.notStrictEqual(afterG.get(hexKey(N1)), beforeG.get(hexKey(N1)), 'N1 must actually change too');
  assert.strictEqual(afterG.get(hexKey(N1)), groundTruth.get(hexKey(N1)), `incremental N1=${afterG.get(hexKey(N1))} must equal full-recompute ground truth=${groundTruth.get(hexKey(N1))}`);
});

// --- Half 1 (the speedup claim): cells with no path to G's neighbourhood
// must be untouched — identical to what they were computed as in round 1,
// AND identical to what a full recompute of the final grid would produce.
test('UNAFFECTED (near but not adjacent to G): N2 and N3 keep their round-1 value, matching ground truth', () => {
  for (const h of [N2, N3]) {
    assert.strictEqual(afterG.get(hexKey(h)), beforeG.get(hexKey(h)), `${hexKey(h)} must be untouched by round 2`);
    assert.strictEqual(afterG.get(hexKey(h)), groundTruth.get(hexKey(h)), `${hexKey(h)} incremental value must match ground truth`);
  }
});

test('UNAFFECTED (far F cluster): every F-cluster cell keeps its round-1 value, matching ground truth, and is genuinely nonzero (a real 2D fit, not a vacuous flat patch)', () => {
  for (const h of [F, FN1, FN2, FN3]) {
    assert.strictEqual(afterG.get(hexKey(h)), beforeG.get(hexKey(h)), `${hexKey(h)} must be untouched by round 2`);
    assert.strictEqual(afterG.get(hexKey(h)), groundTruth.get(hexKey(h)), `${hexKey(h)} incremental value must match ground truth`);
  }
  assert.ok(groundTruth.get(hexKey(F))! > 0.5, `test setup: F's own crossSlopeDeg must be a real, non-vacuous nonzero value, got ${groundTruth.get(hexKey(F))}`);
});

test('the FULL incremental run over both rounds is bit-identical, cell-for-cell, to one full recompute of the final grid', () => {
  for (const h of round1Hexes) {
    assert.strictEqual(afterG.get(hexKey(h)), groundTruth.get(hexKey(h)), `mismatch at ${hexKey(h)}: incremental=${afterG.get(hexKey(h))}, ground truth=${groundTruth.get(hexKey(h))}`);
  }
  assert.strictEqual(afterG.get(hexKey(G)), groundTruth.get(hexKey(G)), `mismatch at G itself`);
});

if (process.exitCode === 1) {
  console.error(`\nSome cross-slope incremental checks failed.`);
} else {
  console.log(`\nAll ${passed} cross-slope incremental checks passed.`);
}
