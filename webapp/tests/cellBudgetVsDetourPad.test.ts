/**
 * Live-reported regression (2026-07-28), immediately after the profile-scaled
 * detour-pad fix (§39) shipped: "the default size of the hex is much larger
 * so legitimate pathways are not being picked up, e.g roads down a steep
 * hill... the whole 'ridge' is red instead and the legitimate gap through on
 * a paved road is not being picked up."
 *
 * Root cause: `buildMobilityGrid` derived its cell BUDGET from the raw
 * origin<->objective distance, then handed the FINAL PADDED BOX's own
 * (now much larger, for a vehicle profile's detour floor) dimensions to
 * `chooseHexSize` — the same small budget spread over a much bigger area
 * balloons hex size, coarsening resolution everywhere, including right along
 * the direct route where the narrow paved-road gap actually was.
 *
 * Fix: the budget is now derived from the ACTUAL padded box's own
 * dimensions (whatever inflated it — `boundsPadFactor`, the detour floor, or
 * a frontier-growth retry), not a stale pre-padding distance. This test
 * reproduces the exact reported scenario against the pure functions
 * (`computePaddedBounds`, `computeCellBudget`, `chooseHexSize`) that
 * `buildMobilityGrid` composes, without needing network mocking.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/cellBudgetVsDetourPad.test.ts
 */
import * as assert from 'node:assert';
import { computePaddedBounds, computeCellBudget, minDetourPadM } from '../src/terrain/mobilityGrid';
import { chooseHexSize } from '@firebreak/terrain';
import { calculateDistance } from '../src/utils/slopeCalculation';
import { getMoverProfile } from '@firebreak/terrain';

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

console.log('Cell budget vs. detour-pad regression (§39 addendum, 2026-07-28):');

// THE REPORTED SCENARIO: a short (~1.5km) trip by a fast vehicle profile,
// crossing a ridge with a real, narrow paved-road gap through it.
const ridgeOrigin = { minLat: -35.0500, maxLat: -35.0499, minLng: 149.3000, maxLng: 149.3001 };
const ridgeObjective = { minLat: -35.0500, maxLat: -35.0499, minLng: 149.3135, maxLng: 149.3136 }; // ~1.25km east
const INITIAL_PAD_FACTOR = 0.3;

function boxSideMetres(bounds: { boundsSw: { lat: number; lng: number }; boundsNe: { lat: number; lng: number } }): number {
  const widthM = calculateDistance(bounds.boundsSw.lat, bounds.boundsSw.lng, bounds.boundsSw.lat, bounds.boundsNe.lng);
  const heightM = calculateDistance(bounds.boundsSw.lat, bounds.boundsSw.lng, bounds.boundsNe.lat, bounds.boundsSw.lng);
  return Math.max(widthM, heightM);
}

test('THE BUG, DEMONSTRATED: budgeting off the raw span (old behaviour) over the NEW, wider box gives a much coarser hex than budgeting off the box itself', () => {
  const vehicle = getMoverProfile('au-light-4wd')!;
  const padded = computePaddedBounds(ridgeOrigin, ridgeObjective, INITIAL_PAD_FACTOR, minDetourPadM(vehicle))!;
  const boxSideM = boxSideMetres(padded);

  const rawSpanM = calculateDistance(-35.04995, 149.30005, -35.04995, 149.31355); // ~origin<->objective centroids

  const { targetCellCount: oldBuggyBudget } = computeCellBudget(rawSpanM, 'standard');
  const { targetCellCount: fixedBudget } = computeCellBudget(boxSideM, 'standard');

  const oldHexSize = chooseHexSize(boxSideM, boxSideM / 2, oldBuggyBudget);
  const newHexSize = chooseHexSize(boxSideM, boxSideM / 2, fixedBudget);

  assert.ok(fixedBudget > oldBuggyBudget,
    `the fix should spend meaningfully more cells on the enlarged box (old budget=${oldBuggyBudget}, fixed budget=${fixedBudget})`);
  assert.ok(newHexSize < oldHexSize * 0.9,
    `FAILED: the fixed hex size (${newHexSize.toFixed(0)}m) is not meaningfully finer than the buggy one (${oldHexSize.toFixed(0)}m) — this is the exact live-reported regression`);
});

test('THE FIX (part 1 of 2): the reported ridge-crossing scenario keeps the box, and therefore the hex size, BOUNDED — not the ~120km/859m the uncapped 1-hour version produced', () => {
  const vehicle = getMoverProfile('au-light-4wd')!;
  const padded = computePaddedBounds(ridgeOrigin, ridgeObjective, INITIAL_PAD_FACTOR, minDetourPadM(vehicle))!;
  const boxSideM = boxSideMetres(padded);
  const { targetCellCount } = computeCellBudget(boxSideM, 'standard');
  const hexSize = chooseHexSize(boxSideM, boxSideM / 2, targetCellCount);
  // Hex size alone was never going to fully solve "resolve a narrow road
  // gap" — see mobilityCostOnTrailSlopeExemption.test.ts for part 2 (the
  // onTrail slope exemption, which is what actually stops a hex spanning
  // road-plus-ridge from being averaged into NO-GO regardless of its size).
  // This assertion only checks that the 15-minute bound keeps the box (and
  // so the hex size) sane, unlike the uncapped 1-hour version.
  assert.ok(boxSideM < 40_000,
    `FAILED: box side ${boxSideM.toFixed(0)}m is not meaningfully bounded — the detour floor cap may have regressed`);
  assert.ok(hexSize < 350,
    `FAILED: hex size ${hexSize.toFixed(0)}m is not meaningfully improved over the uncapped version's ~859m`);
});

test('resolution is now CONSISTENT regardless of WHY the box got wide — a vehicle detour floor and an equivalent boundsPadFactor-only box of the same final size get the same hex size', () => {
  const vehicle = getMoverProfile('au-light-4wd')!;
  const paddedWithFloor = computePaddedBounds(ridgeOrigin, ridgeObjective, INITIAL_PAD_FACTOR, minDetourPadM(vehicle))!;
  const boxSideM = boxSideMetres(paddedWithFloor);

  // A boundsPadFactor alone that happens to produce the SAME final box side
  // for a similarly-short span — reverse-engineered from computePaddedBounds'
  // own targetSideM formula: side = spanM*(1+2f) => f = (side/spanM - 1) / 2.
  const rawSpanM = calculateDistance(-35.04995, 149.30005, -35.04995, 149.31355);
  const equivalentFactor = (boxSideM / rawSpanM - 1) / 2;
  const paddedFactorOnly = computePaddedBounds(ridgeOrigin, ridgeObjective, equivalentFactor)!;
  const boxSideM2 = boxSideMetres(paddedFactorOnly);

  const budget1 = computeCellBudget(boxSideM, 'standard').targetCellCount;
  const budget2 = computeCellBudget(boxSideM2, 'standard').targetCellCount;
  assert.ok(Math.abs(budget1 - budget2) / budget1 < 0.05,
    `two boxes of the same final size should get the same cell budget regardless of source (detour-floor budget=${budget1}, factor-only budget=${budget2})`);
});

test('a long-range trip (proportional term already dominates) is unaffected by the detour floor', () => {
  const farOrigin = { minLat: -35.150, maxLat: -35.149, minLng: 149.100, maxLng: 149.101 };
  const farObjective = { minLat: -35.150, maxLat: -35.149, minLng: 149.700, maxLng: 149.701 }; // ~55km east
  const foot = getMoverProfile('foot-individual-unladen')!;
  const rawSpanM = calculateDistance(-35.1495, 149.1005, -35.1495, 149.7005);
  const paddedNoFloor = computePaddedBounds(farOrigin, farObjective, INITIAL_PAD_FACTOR)!;
  const paddedWithFloor = computePaddedBounds(farOrigin, farObjective, INITIAL_PAD_FACTOR, minDetourPadM(foot))!;
  const boxSideNoFloorM = boxSideMetres(paddedNoFloor);
  const boxSideWithFloorM = boxSideMetres(paddedWithFloor);
  // The box is EXPECTED to be ~1.6x the raw span from boundsPadFactor alone
  // (spanM*(1+2*0.3)) — that's pre-existing, unrelated to this fix. What
  // this asserts is that the (tiny, foot-scaled) detour floor adds barely
  // anything ON TOP of that at long range, since the proportional term
  // already dwarfs it.
  assert.ok(Math.abs(boxSideWithFloorM - boxSideNoFloorM) / boxSideNoFloorM < 0.05,
    `expected the detour floor to add negligible extra room at long range (no-floor=${boxSideNoFloorM.toFixed(0)}m, with-floor=${boxSideWithFloorM.toFixed(0)}m)`);
});

if (process.exitCode === 1) {
  console.error(`\nThe cell-budget-vs-detour-pad regression is NOT fixed.`);
} else {
  console.log(`\nAll ${passed} cell-budget-vs-detour-pad checks passed.`);
}
