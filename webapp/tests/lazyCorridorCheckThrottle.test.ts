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
  assert.strictEqual(shouldCheckCorridorCount(false, 500, 0, 1, false), true);
  assert.strictEqual(shouldCheckCorridorCount(false, 1, 0, 1, false), true);
});

test('a round with TINY growth since the last check is skipped once at least one check has already run', () => {
  // 2000 cells now, 1980 at the last check — 1% growth, well under the 20% threshold.
  assert.strictEqual(shouldCheckCorridorCount(true, 2000, 1980, 5, false), false);
});

test('a round whose growth crosses the threshold DOES check', () => {
  const lastCheck = 1000;
  const now = lastCheck + Math.ceil(CORRIDOR_CHECK_MIN_GROWTH_FRACTION * lastCheck) + 50; // comfortably over 20% growth
  assert.strictEqual(shouldCheckCorridorCount(true, now, lastCheck, 5, false), true);
});

test('a round whose growth sits exactly AT the threshold checks (>=, not >)', () => {
  // Solve for `now` such that (now - lastCheck) / now === CORRIDOR_CHECK_MIN_GROWTH_FRACTION exactly.
  const lastCheck = 800;
  const now = lastCheck / (1 - CORRIDOR_CHECK_MIN_GROWTH_FRACTION);
  const growth = now - lastCheck;
  assert.ok(Math.abs(growth / now - CORRIDOR_CHECK_MIN_GROWTH_FRACTION) < 1e-9, 'test setup: growth fraction must land exactly on the threshold');
  assert.strictEqual(shouldCheckCorridorCount(true, now, lastCheck, 5, false), true);
});

test('SAFETY NET: a round within one of MAX_LAZY_ROUNDS always checks, even with ZERO growth since the last check', () => {
  assert.strictEqual(shouldCheckCorridorCount(true, 5000, 5000, MAX_LAZY_ROUNDS - 1, false), true);
  assert.strictEqual(shouldCheckCorridorCount(true, 5000, 5000, MAX_LAZY_ROUNDS, false), true);
});

test('a mid-run round with small growth, safely below the round cap, is genuinely throttled (the safety net does not fire early)', () => {
  assert.strictEqual(shouldCheckCorridorCount(true, 5000, 4995, 3, false), false);
});

test('SAFETY NET (found in review — originally missing entirely): a round about to exit via frontier exhaustion always checks, even with tiny growth and far from the round cap', () => {
  // Neither of the other two nets can fire here: growth is 0.1% (well under
  // the 20% threshold) and round=3 is nowhere near MAX_LAZY_ROUNDS. Only
  // frontierExhausted=true can force this check — this is the exact gap a
  // fresh review found: the loop's own "enclosed by terrain, or the α×C*
  // budget genuinely exhausted" exit was not covered by either original
  // safety net, so `corridorCountAtStop` could be stale at the one moment
  // the run's own log asserts it reflects the final grid.
  assert.strictEqual(shouldCheckCorridorCount(true, 5001, 5000, 3, true), true);
  assert.strictEqual(shouldCheckCorridorCount(true, 5001, 5000, 3, false), false, 'test setup: confirms the OTHER two nets genuinely do not fire in this fixture, isolating frontierExhausted as the only reason');
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
 * predicate the production loop calls. Returns `{ stopRound, checkedOnExhaustionRound }`
 * — `stopRound` is the first round, at or after `trueCountBecomesSufficientAtRound`,
 * where a check happens AND the true count is already sufficient (or `null`
 * if it never stops within `maxRounds`); `checkedOnExhaustionRound` is
 * whether a check actually ran on `frontierExhaustedAtRound` itself — the
 * property this test suite exists to prove is never false when it matters
 * (see the frontier-exhaustion test below).
 */
function simulateStopRound(
  cellCountByRound: number[], // 1-indexed via cellCountByRound[round-1]
  trueCorridorCountByRound: (round: number) => number,
  minTarget: number,
  frontierExhaustedAtRound: number | null = null
): { stopRound: number | null; checkedOnExhaustionRound: boolean } {
  let everChecked = false;
  let lastCheckSize = 0;
  let checkedOnExhaustionRound = false;
  for (let round = 1; round <= cellCountByRound.length; round++) {
    const materializedCellCount = cellCountByRound[round - 1];
    const frontierExhausted = round === frontierExhaustedAtRound;
    const checked = shouldCheckCorridorCount(everChecked, materializedCellCount, lastCheckSize, round, frontierExhausted);
    if (checked) {
      everChecked = true;
      lastCheckSize = materializedCellCount;
      if (frontierExhausted) checkedOnExhaustionRound = true;
      if (trueCorridorCountByRound(round) >= minTarget) return { stopRound: round, checkedOnExhaustionRound };
    }
    // The real loop's `if (nextNeeded.size === 0) break;` runs regardless of
    // whether a corridor check happened this round — replay that here too,
    // so a round that exhausts the frontier WITHOUT a sufficient corridor
    // count still ends the simulation (matching the real loop actually
    // stopping there, corridor target or not).
    if (frontierExhausted) return { stopRound: round, checkedOnExhaustionRound };
  }
  return { stopRound: null, checkedOnExhaustionRound };
}

test('a REALISTIC slow-growth tail (3%/round) still stops within a handful of rounds of the true count becoming sufficient, not at the MAX_LAZY_ROUNDS ceiling', () => {
  const GROWTH_PER_ROUND = 0.03;
  const TRUE_COUNT_READY_AT_ROUND = 5;
  const cellCountByRound: number[] = [100];
  for (let r = 1; r < MAX_LAZY_ROUNDS; r++) {
    cellCountByRound.push(Math.round(cellCountByRound[r - 1] * (1 + GROWTH_PER_ROUND)));
  }
  const { stopRound } = simulateStopRound(
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
  const { stopRound } = simulateStopRound(
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
  const { stopRound } = simulateStopRound(cellCountByRound, () => 1, 2); // never reaches the target of 2
  assert.strictEqual(stopRound, null, 'a loop whose true corridor count never reaches the target must never report a stop round');
});

test('FOUND IN REVIEW — the gap this suite originally missed: frontier exhaustion on an otherwise-throttled round must still produce a FRESH corridorCountAtStop, not a stale one', () => {
  // Growth is a flat 0.5 cells/round (nowhere near the 20% threshold) and
  // the frontier exhausts at round 6 — well before MAX_LAZY_ROUNDS, so
  // NEITHER of the other two safety nets can be what saves this. This is
  // exactly the scenario the removed-behaviour audit identified: a slow,
  // gradually-plateauing AOI that happens to hit a real boundary (a lake,
  // a map edge) on a round the growth throttle would otherwise have
  // skipped. Before the fix, `shouldCheckCorridorCount` had no way to know
  // this round was terminal, so `corridorCountAtStop` could be several
  // rounds stale at exactly the moment `mobilityAppreciation.ts` asserts,
  // with specific confidence, that the count reflects the genuinely
  // exhausted final grid.
  const EXHAUSTED_AT_ROUND = 6;
  const cellCountByRound = [1000, 1000.5, 1001, 1001.5, 1002, 1002.5, 1003, 1003.5];
  const TRUE_COUNT_ONLY_VISIBLE_FROM_ROUND = EXHAUSTED_AT_ROUND; // the real, final count only becomes true exactly on the exhaustion round
  const { checkedOnExhaustionRound } = simulateStopRound(
    cellCountByRound,
    round => (round >= TRUE_COUNT_ONLY_VISIBLE_FROM_ROUND ? 2 : 1),
    2,
    EXHAUSTED_AT_ROUND
  );
  assert.strictEqual(
    checkedOnExhaustionRound, true,
    'FAILED: the frontier-exhaustion round did not get a fresh corridor-count check — corridorCountAtStop would be stale at the exact moment the loop reports the budget as genuinely exhausted'
  );
});

if (process.exitCode === 1) {
  console.error(`\nSome corridor-check throttle checks failed.`);
} else {
  console.log(`\nAll ${passed} corridor-check throttle checks passed.`);
}
