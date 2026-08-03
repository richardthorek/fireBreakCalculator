/**
 * `runAccumulatedCostSearch`'s `onProgress` (docs/ROUTE_INTELLIGENCE.md §35
 * addendum, 2026-07-27) — the multi-source Dijkstra field build previously
 * reported NOTHING while it ran, the single largest silent stretch in a
 * Terrain Mobility run's progress bar (owner: "the 'progress' indicator
 * stopped well before the result loaded in with a long 'nothing' time").
 *
 * This proves, at the engine level (the exact function `mobilityWorker.ts`
 * calls), that the new callback is REAL progress — monotonically
 * non-decreasing, reaches a meaningful final value, actually fires more than
 * once on a grid with enough cells to matter — and that passing it changes
 * nothing about the search's own result (same reachability field, with or
 * without a caller listening).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/searchProgress.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint } from '@firebreak/terrain';
import { runAccumulatedCostSearch, MobilityGridCell } from '@firebreak/terrain';
import { MOVER_PROFILES } from '@firebreak/terrain';
import { LatLng } from '@firebreak/terrain';

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

const foot = MOVER_PROFILES.find(p => p.id === 'foot-individual-unladen')!;
const HEX_SIZE = 30;
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };

// Open ground, no barriers — every cell should end up reachable, so
// `best.size` genuinely climbs to the full cell count rather than stalling
// part-way through because of terrain.
function buildOpenGrid(): MobilityGridCell[] {
  const minPt: LocalPoint = { x: 0, y: 0 };
  const maxPt: LocalPoint = { x: 900, y: 900 };
  const cellsRaw = generateBoxHexes(minPt, maxPt, HEX_SIZE);
  return cellsRaw
    .filter(c => c.center.x >= minPt.x && c.center.x <= maxPt.x && c.center.y >= minPt.y && c.center.y <= maxPt.y)
    .map(c => ({
      key: hexKey(c.hex),
      hex: c.hex,
      center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / 111320 },
      elevation: 0,
      vegetation: 'grassland' as const,
      vegEstimated: false,
      onTrail: false,
      nearestTrailTags: null,
      crossSlopeDeg: 0,
      waterDistanceM: Infinity,
      inWaterBody: false,
      nearestWaterwayKind: null,
      waterFrequency: null,
    }));
}

console.log('Search progress reporting (§35 addendum — the search dead-zone fix):');

const cells = buildOpenGrid();
const originKeys = cells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 < 60).map(c => c.key);
assert.ok(cells.length > 100, 'test setup: grid must have enough cells for progress to be meaningful');
assert.ok(originKeys.length > 0, 'test setup: origin seed set must be non-empty');

test('onProgress is never called before this session\'s change would have reported anything — sanity: search still returns a full field', () => {
  const reach = runAccumulatedCostSearch(cells, originKeys, foot, false);
  assert.strictEqual(reach.best.size, cells.length, 'FAILED: open ground should make every cell reachable');
});

test('onProgress fires repeatedly, not once — real incremental reporting, not a single completion ping', () => {
  const calls: number[] = [];
  runAccumulatedCostSearch(cells, originKeys, foot, false, { onProgress: f => calls.push(f) });
  assert.ok(calls.length >= 10, `FAILED: expected many progress ticks over ${cells.length} cells, got ${calls.length}`);
});

test('onProgress is monotonically non-decreasing throughout the search', () => {
  const calls: number[] = [];
  runAccumulatedCostSearch(cells, originKeys, foot, false, { onProgress: f => calls.push(f) });
  for (let i = 1; i < calls.length; i++) {
    assert.ok(calls[i] >= calls[i - 1], `FAILED: progress went backward at tick ${i}: ${calls[i - 1]} -> ${calls[i]}`);
  }
});

test('onProgress reaches (at or near) 1.0 once the whole open grid is settled', () => {
  const calls: number[] = [];
  runAccumulatedCostSearch(cells, originKeys, foot, false, { onProgress: f => calls.push(f) });
  const last = calls[calls.length - 1];
  assert.ok(last >= 0.99, `FAILED: expected the final tick close to 1.0 on fully-reachable open ground, got ${last}`);
});

test('onProgress values are all valid fractions in [0, 1]', () => {
  const calls: number[] = [];
  runAccumulatedCostSearch(cells, originKeys, foot, false, { onProgress: f => calls.push(f) });
  for (const f of calls) {
    assert.ok(f >= 0 && f <= 1, `FAILED: progress fraction out of range: ${f}`);
  }
});

test('supplying onProgress does not change the search result — same reachability field either way', () => {
  const withoutCallback = runAccumulatedCostSearch(cells, originKeys, foot, false);
  const withCallback = runAccumulatedCostSearch(cells, originKeys, foot, false, { onProgress: () => {} });
  assert.strictEqual(withCallback.best.size, withoutCallback.best.size, 'FAILED: best map size differs');
  for (const [key, v] of withoutCallback.best) {
    const withCb = withCallback.best.get(key);
    assert.ok(withCb, `FAILED: cell ${key} present without callback but missing with it`);
    assert.strictEqual(withCb!.timeSeconds, v.timeSeconds, `FAILED: arrival time for ${key} differs`);
  }
});

if (process.exitCode === 1) {
  console.error(`\nSearch progress reporting did NOT hold.`);
} else {
  console.log(`\nAll ${passed} search progress checks passed.`);
}
