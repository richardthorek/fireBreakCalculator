/**
 * Distance-scaled cell budget + fidelity tiers (docs/ROUTE_INTELLIGENCE.md
 * §35, owner 2026-07-27: "Work out a sensible scaling of the cell budget
 * for distance noting big areas should take longer. Let the user select a
 * scale of something like 'quick' to 'fine' for analysis depth. Processing
 * half the country for a few minutes is perfectly acceptable once we have
 * the data locally.").
 *
 * Plain node:assert. Run: npx tsx webapp/tests/cellBudgetScaling.test.ts
 */
import * as assert from 'node:assert';
import { computeCellBudget } from '../src/terrain/mobilityGrid';

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

console.log('Distance-scaled cell budget (§35):');

test('standard fidelity at short range (<=10km) matches the original fixed budget almost exactly', () => {
  const budget = computeCellBudget(5_000, 'standard'); // 5km, well under the 10km reference
  assert.strictEqual(budget.targetCellCount, 2200, 'a short-range standard run must behave exactly like before this change');
  assert.ok(budget.maxHexCells >= 2700 && budget.maxHexCells <= 2900,
    `expected ~2800 (the original MAX_HEX_CELLS), got ${budget.maxHexCells}`);
});

test('cell budget GROWS with distance — a 500km run gets meaningfully more cells than a 5km one', () => {
  const near = computeCellBudget(5_000, 'standard');
  const far = computeCellBudget(500_000, 'standard');
  assert.ok(far.targetCellCount > near.targetCellCount * 2,
    `expected a real increase, got ${near.targetCellCount} (near) vs ${far.targetCellCount} (far)`);
});

test('growth is SUB-LINEAR (sqrt-based), not proportional to distance — a 100x distance increase must not mean a 100x cell increase', () => {
  const near = computeCellBudget(5_000, 'standard');
  const far = computeCellBudget(500_000, 'standard'); // 100x further
  const ratio = far.targetCellCount / near.targetCellCount;
  assert.ok(ratio < 20, `expected sub-linear growth (ratio well under 100x), got ${ratio.toFixed(1)}x`);
});

test('every tier respects its own hard ceiling, however extreme the distance', () => {
  const continental = 4_000_000; // ~4000km, roughly Australia's own extent
  const quick = computeCellBudget(continental, 'quick');
  const standard = computeCellBudget(continental, 'standard');
  const fine = computeCellBudget(continental, 'fine');
  assert.ok(quick.targetCellCount <= 5_000, `quick exceeded its ceiling: ${quick.targetCellCount}`);
  assert.ok(standard.targetCellCount <= 12_000, `standard exceeded its ceiling: ${standard.targetCellCount}`);
  assert.ok(fine.targetCellCount <= 50_000, `fine exceeded its ceiling: ${fine.targetCellCount}`);
});

test('fidelity tiers are properly ordered at the SAME distance — quick < standard < fine, at both short and long range', () => {
  for (const spanM of [5_000, 200_000, 2_000_000]) {
    const quick = computeCellBudget(spanM, 'quick');
    const standard = computeCellBudget(spanM, 'standard');
    const fine = computeCellBudget(spanM, 'fine');
    assert.ok(quick.targetCellCount < standard.targetCellCount,
      `at ${spanM}m, quick (${quick.targetCellCount}) should be less than standard (${standard.targetCellCount})`);
    assert.ok(standard.targetCellCount < fine.targetCellCount,
      `at ${spanM}m, standard (${standard.targetCellCount}) should be less than fine (${fine.targetCellCount})`);
  }
});

test('"fine" gives genuinely higher resolution even at SHORT range, not just steeper scaling', () => {
  const shortRange = 5_000; // 5km — below the reference distance, so this is testing the BASE budget only
  const standard = computeCellBudget(shortRange, 'standard');
  const fine = computeCellBudget(shortRange, 'fine');
  assert.ok(fine.targetCellCount > standard.targetCellCount,
    `'fine' must be a genuinely higher baseline, not just a steeper distance curve (standard=${standard.targetCellCount}, fine=${fine.targetCellCount})`);
});

test('maxHexCells is always >= targetCellCount (headroom for the coarsening loop to have something to work with)', () => {
  for (const spanM of [1_000, 50_000, 1_000_000, 5_000_000]) {
    for (const fidelity of ['quick', 'standard', 'fine'] as const) {
      const budget = computeCellBudget(spanM, fidelity);
      assert.ok(budget.maxHexCells >= budget.targetCellCount,
        `${fidelity} at ${spanM}m: maxHexCells (${budget.maxHexCells}) must be >= targetCellCount (${budget.targetCellCount})`);
    }
  }
});

if (process.exitCode === 1) {
  console.error(`\nSome cell-budget scaling checks failed.`);
} else {
  console.log(`\nAll ${passed} cell-budget scaling checks passed.`);
}
