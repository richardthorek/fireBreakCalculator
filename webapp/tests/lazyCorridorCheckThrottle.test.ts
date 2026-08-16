/**
 * WP5 Tier B, Fix 4 (`mobilityLazyGrid.ts#shouldCheckCorridorCount`) —
 * `estimateDistinctCorridorCount` (up to 5 more Dijkstra searches + route
 * clustering) used to run on EVERY lazy-grid round, unthrottled, once a
 * route existed but the target corridor count hadn't been confirmed yet.
 * `shouldCheckCorridorCount` throttles it — this file proves the throttle
 * WITHOUT defeating the loop's own stop condition, which is the one thing
 * the task explicitly forbids: "must not change whether/when a real run
 * stops finding new corridors in any way that leaves genuine avenues
 * undiscovered".
 *
 * `runLazyMobilitySearch` itself is network-coupled (elevation/vegetation/
 * trail/water fetches) and not unit-testable without mocking every one of
 * them (same limitation `lazyTilePartition.test.ts` and
 * `expandingSearchLakeGeorge.test.ts` already state for this module/its
 * neighbours) — so, matching those files' own precedent, this tests the
 * exact PURE predicate the real loop calls (`shouldCheckCorridorCount`,
 * exported for exactly this reason — see its own doc comment), not a
 * second, possibly-disagreeing reimplementation of the throttle logic.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/lazyCorridorCheckThrottle.test.ts
 */
import * as assert from 'node:assert';
import {
  shouldCheckCorridorCount, CORRIDOR_CHECK_MIN_GROWTH_FRACTION, MAX_LAZY_ROUNDS,
} from '../src/terrain/mobilityLazyGrid';

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

console.log('Lazy-grid corridor-count-check throttle (WP5 Tier B, Fix 4):');

test('the VERY FIRST opportunity always checks, regardless of growth — matches unthrottled behaviour exactly for the common single-round case', () => {
  // everChecked=false, growth=0 (materialized just went from 0 to some
  // count this same round) — must still return true.
  assert.strictEqual(shouldCheckCorridorCount(false, 500, 0, 1), true);
  assert.strictEqual(shouldCheckCorridorCount(false, 1, 0, 1), true);
});

test('a round with TINY growth since the last check is skipped once at least one check has already run', () => {
  // 2000 cells now, 1980 at the last check — 1% growth, well under the 20% threshold.
  assert.strictEqual(shouldCheckCorridorCount(true, 2000, 1980, 5), false);
});

test('a round whose growth crosses the threshold DOES check', () => {
  const lastCheck = 1000;
  const now = lastCheck + Math.ceil(CORRIDOR_CHECK_MIN_GROWTH_FRACTION * lastCheck) + 50; // comfortably over 20% growth
  assert.strictEqual(shouldCheckCorridorCount(true, now, lastCheck, 5), true);
});

test('a round whose growth sits exactly AT the threshold checks (>=, not >)', () => {
  // Solve for `now` such that (now - lastCheck) / now === CORRIDOR_CHECK_MIN_GROWTH_FRACTION exactly.
  const lastCheck = 800;
  const now = lastCheck / (1 - CORRIDOR_CHECK_MIN_GROWTH_FRACTION);
  const growth = now - lastCheck;
  assert.ok(Math.abs(growth / now - CORRIDOR_CHECK_MIN_GROWTH_FRACTION) < 1e-9, 'test setup: growth fraction must land exactly on the threshold');
  assert.strictEqual(shouldCheckCorridorCount(true, now, lastCheck, 5), true);
});

test('SAFETY NET: a round within one of MAX_LAZY_ROUNDS always checks, even with ZERO growth since the last check', () => {
  assert.strictEqual(shouldCheckCorridorCount(true, 5000, 5000, MAX_LAZY_ROUNDS - 1), true);
  assert.strictEqual(shouldCheckCorridorCount(true, 5000, 5000, MAX_LAZY_ROUNDS), true);
});

test('a mid-run round with small growth, safely below the round cap, is genuinely throttled (the safety net does not fire early)', () => {
  assert.strictEqual(shouldCheckCorridorCount(true, 5000, 4995, 3), false);
});

// ===========================================================================
// THE STOP-CONDITION INVARIANT ITSELF: simulate a full round sequence and
// prove the throttle never lets a genuinely-sufficient corridor count go
// unnoticed for more than a small, bounded number of rounds — never
// "forever" (which would be the actual defect: a real avenue confirmed by
// the underlying search but never surfaced because the throttle silently
// skipped every remaining check).
// ===========================================================================
console.log('\nStop-condition invariant (throttling must not leave genuine avenues undiscovered):');

/**
 * Replays the REAL loop's own state machine (everChecked / lastCheckSize /
 * round) against a synthetic cell-growth curve and a synthetic "true
 * distinct corridor count" curve, calling the SAME `shouldCheckCorridorCount`
 * predicate the production loop calls. Returns the round the simulated loop
 * would actually stop on (the first round, at or after `trueCountBecomesSufficientAtRound`,
 * where a check happens AND the true count is already sufficient), or null
 * if it never stops within `maxRounds`.
 */
function simulateStopRound(
  cellCountByRound: number[], // 1-indexed via cellCountByRound[round-1]
  trueCorridorCountByRound: (round: number) => number,
  minTarget: number
): number | null {
  let everChecked = false;
  let lastCheckSize = 0;
  for (let round = 1; round <= cellCountByRound.length; round++) {
    const materializedCellCount = cellCountByRound[round - 1];
    if (shouldCheckCorridorCount(everChecked, materializedCellCount, lastCheckSize, round)) {
      everChecked = true;
      lastCheckSize = materializedCellCount;
      if (trueCorridorCountByRound(round) >= minTarget) return round;
    }
  }
  return null;
}

test('a REALISTIC slow-growth tail (3%/round) still stops within a handful of rounds of the true count becoming sufficient, not at the MAX_LAZY_ROUNDS ceiling', () => {
  const GROWTH_PER_ROUND = 0.03;
  const TRUE_COUNT_READY_AT_ROUND = 5;
  const cellCountByRound: number[] = [100];
  for (let r = 1; r < MAX_LAZY_ROUNDS; r++) {
    cellCountByRound.push(Math.round(cellCountByRound[r - 1] * (1 + GROWTH_PER_ROUND)));
  }
  const stopRound = simulateStopRound(
    cellCountByRound,
    round => (round >= TRUE_COUNT_READY_AT_ROUND ? 2 : 1),
    2
  );
  assert.ok(stopRound !== null, 'FAILED: the throttled loop never noticed the sufficient corridor count at all within MAX_LAZY_ROUNDS');
  assert.ok(stopRound! >= TRUE_COUNT_READY_AT_ROUND, `sanity: cannot stop before the true count is actually ready (round ${TRUE_COUNT_READY_AT_ROUND})`);
  assert.ok(
    stopRound! <= TRUE_COUNT_READY_AT_ROUND + 10,
    `FAILED: throttling delayed the stop far too long — true count ready at round ${TRUE_COUNT_READY_AT_ROUND}, but the loop did not stop until round ${stopRound}`
  );
  assert.ok(stopRound! < MAX_LAZY_ROUNDS - 1, 'the realistic case should stop well before the hard round-cap safety net has to intervene at all');
});

test('a PATHOLOGICAL zero-growth plateau (materialised cell count never changes) still stops — via the round-cap safety net, not growth', () => {
  // Growth-based checks can never fire here (0% growth every round) — only
  // `nearRoundCap` can save this scenario. If it didn't, this would be
  // EXACTLY the "genuine avenue left undiscovered" failure the task warns
  // against, and this assertion would time out at `stopRound === null`.
  const FLAT_COUNT = 3000;
  const cellCountByRound: number[] = new Array(MAX_LAZY_ROUNDS).fill(FLAT_COUNT);
  const TRUE_COUNT_READY_AT_ROUND = 4; // true corridor count becomes sufficient early, but growth never re-triggers a check
  const stopRound = simulateStopRound(
    cellCountByRound,
    round => (round >= TRUE_COUNT_READY_AT_ROUND ? 2 : 1),
    2
  );
  assert.ok(stopRound !== null, 'FAILED: a zero-growth plateau must still eventually notice a sufficient corridor count via the round-cap safety net');
  assert.ok(stopRound! <= MAX_LAZY_ROUNDS, `stop round ${stopRound} must be within MAX_LAZY_ROUNDS (${MAX_LAZY_ROUNDS})`);
  // It specifically stops at the round-cap safety net's own trigger point
  // (MAX_LAZY_ROUNDS - 1), not any earlier — proving THIS test genuinely
  // exercises the safety net, not an accidental growth-based check.
  assert.strictEqual(stopRound, MAX_LAZY_ROUNDS - 1, `expected the round-cap safety net to fire at exactly round ${MAX_LAZY_ROUNDS - 1}, got ${stopRound}`);
});

test('CONTROL: if the true count never becomes sufficient, the simulated loop never claims a stop either (the throttle does not fabricate a stop)', () => {
  const cellCountByRound: number[] = new Array(MAX_LAZY_ROUNDS).fill(3000);
  const stopRound = simulateStopRound(cellCountByRound, () => 1, 2); // never reaches the target of 2
  assert.strictEqual(stopRound, null, 'a loop whose true corridor count never reaches the target must never report a stop round');
});

if (process.exitCode === 1) {
  console.error(`\nSome corridor-check throttle checks failed.`);
} else {
  console.log(`\nAll ${passed} corridor-check throttle checks passed.`);
}
