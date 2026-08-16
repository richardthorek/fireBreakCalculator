/**
 * WP4 (movement-analysis performance work) proof for `mobilityWorkerPool.ts`
 * — key-terrain candidate scoring fanned out across multiple worker
 * instances instead of the single shared worker. The module itself spawns
 * a real `Worker` and so cannot be exercised end-to-end by a bare `tsx`
 * script (same established limitation as `mobilityAppreciation.ts`/
 * `mobilityGrid.ts` — see their own test files' headers). What CAN be
 * tested directly, and is the actual correctness surface of this module
 * (the header comment on `mobilityWorkerPool.ts` explains why), is the two
 * pure functions the pooled call is built from:
 *
 *  - `mergeKeyTerrainChunks` — re-ranks each worker's own chunk-local
 *    result into one globally-ranked result. A chunk-local `rank` is only
 *    correct WITHIN that chunk; failing to re-rank globally would produce
 *    duplicate/wrong ranks whenever more than one chunk returns a
 *    candidate.
 *  - `chunkCandidates` — order-preserving splitting, used alongside the
 *    caller's own pre-slice to `MAX_CANDIDATES_EVALUATED` (the pool
 *    function itself, `runKeyTerrainScoringPooled`, is what's not directly
 *    testable here — but the pre-slice-then-chunk arithmetic it relies on
 *    is exercised below).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/mobilityWorkerPool.test.ts
 */
import * as assert from 'node:assert';
import { KeyTerrainResult, ScoredKeyTerrainCandidate, CorridorComparison, MAX_CANDIDATES_EVALUATED } from '@firebreak/terrain';
import { chunkCandidates, mergeKeyTerrainChunks } from '../src/terrain/mobilityWorkerPool';

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

const EMPTY_COMPARISON: CorridorComparison = {
  effects: [],
  newCorridors: [],
  collapsedCount: 0,
  degradedCount: 0,
  displacedIntoCount: 0,
};

function candidate(id: string, impactScore: number, chunkLocalRank: number): ScoredKeyTerrainCandidate {
  return {
    id,
    source: 'chokepoint',
    cellKeys: [id],
    center: { lat: 0, lng: 0 },
    rank: chunkLocalRank,
    comparison: EMPTY_COMPARISON,
    impactScore,
    decisiveCandidate: false,
  };
}

function resultOf(candidates: ScoredKeyTerrainCandidate[]): KeyTerrainResult {
  return { candidates, candidatesConsidered: candidates.length, evaluationRouteCount: 6, missionCaveat: 'test' };
}

console.log('mobilityWorkerPool — key-terrain fan-out merge (WP4):');

test('chunkCandidates: order-preserving, no items lost or duplicated across chunks', () => {
  const items = Array.from({ length: 10 }, (_, i) => `c${i}`);
  const chunks = chunkCandidates(items, 3);
  assert.strictEqual(chunks.flat().length, items.length, 'chunking must not drop or duplicate items');
  assert.deepStrictEqual(chunks.flat(), items, 'chunking must preserve original relative order when flattened');
  assert.ok(chunks.length <= 3, `expected at most 3 chunks, got ${chunks.length}`);
});

test('chunkCandidates: n<=0 or empty input degrades safely, never throws', () => {
  assert.deepStrictEqual(chunkCandidates([], 4), [], 'empty input -> no chunks');
  assert.deepStrictEqual(chunkCandidates(['a'], 0), [['a']], 'n<=0 falls back to one chunk holding everything');
});

test('mergeKeyTerrainChunks: rank is reassigned GLOBALLY by impactScore, not left as each chunk\'s own local rank', () => {
  // Two "workers" each scored 2 candidates and ranked them 1,2 WITHIN their
  // own chunk. Globally, impact scores interleave: chunk B's best candidate
  // actually outranks chunk A's best.
  const chunkA = resultOf([candidate('a1', 50, 1), candidate('a2', 10, 2)]);
  const chunkB = resultOf([candidate('b1', 80, 1), candidate('b2', 5, 2)]);

  const merged = mergeKeyTerrainChunks([chunkA, chunkB], 4)!;
  assert.ok(merged, 'test setup: merge of two real chunks must not be null');
  assert.deepStrictEqual(
    merged.candidates.map(c => c.id),
    ['b1', 'a1', 'a2', 'b2'],
    'global order must be by impactScore descending, ACROSS chunks — not chunk A\'s items then chunk B\'s'
  );
  assert.deepStrictEqual(
    merged.candidates.map(c => c.rank),
    [1, 2, 3, 4],
    'rank must be reassigned 1..N globally — b1 (impactScore 80) must be rank 1, not keep its chunk-local rank of 1 alongside a1\'s own chunk-local rank of 1'
  );
});

test('mergeKeyTerrainChunks: candidatesConsidered uses the ORIGINAL pre-cap count, not any chunk-derived total', () => {
  const chunkA = resultOf([candidate('a1', 50, 1)]);
  const chunkB = resultOf([candidate('b1', 80, 1)]);
  // The caller's real candidate list was, say, 23 long before the
  // MAX_CANDIDATES_EVALUATED cap and chunking — candidatesConsidered must
  // report THAT, not chunkA.candidatesConsidered (1), chunkB's (1), their
  // sum (2), or the merged candidate count (2).
  const merged = mergeKeyTerrainChunks([chunkA, chunkB], 23)!;
  assert.strictEqual(merged.candidatesConsidered, 23);
});

test('mergeKeyTerrainChunks: null chunks (e.g. a profile that failed to resolve) are skipped, not thrown', () => {
  const chunkA = resultOf([candidate('a1', 50, 1)]);
  const merged = mergeKeyTerrainChunks([chunkA, null, null], 5)!;
  assert.ok(merged);
  assert.strictEqual(merged.candidates.length, 1);
  assert.strictEqual(merged.candidates[0].rank, 1);
});

test('mergeKeyTerrainChunks: every chunk null -> overall null, not an empty-but-truthy result', () => {
  const merged = mergeKeyTerrainChunks([null, null], 5);
  assert.strictEqual(merged, null);
});

test('pre-slice-then-chunk arithmetic: total candidates evaluated across chunks never exceeds MAX_CANDIDATES_EVALUATED even when the caller has far more', () => {
  // This is the exact sequence runKeyTerrainScoringPooled itself performs
  // (candidates.slice(0, MAX_CANDIDATES_EVALUATED) BEFORE chunking) — see
  // mobilityWorkerPool.ts's own header on why chunking the FULL list
  // without pre-slicing would let each of N chunks independently apply the
  // cap again, evaluating up to N x MAX_CANDIDATES_EVALUATED in total.
  const farMoreThanCap = Array.from({ length: MAX_CANDIDATES_EVALUATED * 5 }, (_, i) => `c${i}`);
  const evaluated = farMoreThanCap.slice(0, MAX_CANDIDATES_EVALUATED);
  const chunks = chunkCandidates(evaluated, 4);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  assert.strictEqual(total, MAX_CANDIDATES_EVALUATED, `pre-slice-then-chunk must total exactly the cap (${MAX_CANDIDATES_EVALUATED}), got ${total}`);
});

const TOTAL_TESTS = 7;
if (passed === TOTAL_TESTS) {
  console.log(`\nAll ${passed} mobilityWorkerPool checks passed.`);
} else {
  console.log(`\n${passed}/${TOTAL_TESTS} mobilityWorkerPool checks passed.`);
}
