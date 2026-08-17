/**
 * WP4 (movement-analysis performance/streaming work) proof: the baseline
 * mover ensemble (`simulateMovementEnsemble`) now supports an optional
 * `onPartialTracks` callback, throttled by real wall-clock time
 * (`PARTIAL_TRACKS_INTERVAL_MS`, movementSimulation.ts), so corridors can
 * visibly thicken on the map WHILE the ensemble runs instead of only
 * appearing once the whole run finishes.
 *
 * The wall-clock throttle is deliberately real time, not a mover-count
 * stride (see that constant's own doc comment) — which makes "did it fire
 * N times" inherently timing-dependent and a poor thing to assert on in a
 * unit test. What IS timing-independent, and is the actual correctness
 * risk of adding a callback into the hot per-mover loop, is:
 *
 *  1. `onPartialTracks` must be a pure OBSERVER — supplying it must never
 *     change the ensemble's own RNG draws or final result. Every mover's
 *     random stream is seeded independently (`hashSeedForMover`), and
 *     nothing about calling an extra callback should touch that, but this
 *     is exactly the kind of accidental coupling a refactor can introduce
 *     silently (e.g. if a future change moved state the RNG depends on
 *     next to the throttle check). Proven by running the SAME seeded
 *     ensemble with and without the callback and asserting byte-identical
 *     results.
 *  2. `buildTransitCells` (the pure snapshot builder both the streamed
 *     partials and the final result now share) must be correct in
 *     isolation: sorted by transitFraction descending, fractions computed
 *     against the denominator it was actually called with (which is
 *     "movers done so far" for a partial snapshot, not the eventual
 *     moverCount), real hex polygons.
 *  3. Any partial snapshots that DO fire during a real run must be
 *     individually well-formed and never regress moversDone.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/movementEnsembleStreaming.test.ts
 */
import * as assert from 'node:assert';
import {
  hexKey, AxialCoord, axialToLocal, makeProjection, toLatLng, generateBoxHexes, LocalPoint,
} from '@firebreak/terrain';
import { MobilityGridCell } from '@firebreak/terrain';
import { simulateMovementEnsemble, buildTransitCells, TransitCell } from '@firebreak/terrain';
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

const ANCHOR = { lat: -35.05, lng: 149.30 };
const PROJ = makeProjection(ANCHOR);
const HEX_SIZE = 30;

function cell(hex: AxialCoord, opts: Partial<MobilityGridCell> = {}): MobilityGridCell {
  const center = toLatLng(PROJ, axialToLocal(hex, HEX_SIZE));
  return {
    key: hexKey(hex),
    hex,
    center,
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

const BOX_MIN: LocalPoint = { x: -400, y: -400 };
const BOX_MAX: LocalPoint = { x: 400, y: 400 };
const grid: MobilityGridCell[] = generateBoxHexes(BOX_MIN, BOX_MAX, HEX_SIZE).map(h => cell(h.hex));
const foot = getMoverProfile('foot-individual-unladen')!;
const originKeys = grid.filter(c => c.center.lng < ANCHOR.lng - 0.0005).map(c => c.key);
const objectiveKeys = grid.filter(c => c.center.lng > ANCHOR.lng + 0.0005).map(c => c.key);

console.log('Movement ensemble streaming (WP4 — onPartialTracks):');

test('buildTransitCells: fractions computed against the supplied denominator, sorted descending, real polygons', () => {
  const byKey = new Map(grid.map(c => [c.key, c]));
  const counts = new Map<string, number>([
    [grid[0].key, 8],
    [grid[1].key, 3],
    [grid[2].key, 5],
  ]);
  const cells = buildTransitCells(counts, 10, byKey, HEX_SIZE, PROJ);
  assert.strictEqual(cells.length, 3, 'one TransitCell per counted key');
  assert.deepStrictEqual(
    cells.map(c => c.transitFraction),
    [0.8, 0.5, 0.3],
    'sorted descending by transitFraction, each = count / the supplied denominator'
  );
  for (const c of cells) {
    assert.strictEqual(c.moverCount, counts.get(c.key), 'moverCount is the raw count, not the fraction');
    assert.ok(c.polygon.length >= 6, `polygon for ${c.key} has too few vertices: ${c.polygon.length}`);
    assert.deepStrictEqual(c.polygon[0], c.polygon[c.polygon.length - 1], 'polygon ring must close');
  }
});

test('buildTransitCells: a key with no matching cell (stale/out-of-grid) is silently dropped, not thrown', () => {
  const byKey = new Map(grid.map(c => [c.key, c]));
  const counts = new Map<string, number>([[grid[0].key, 1], ['99,99', 1]]);
  const cells = buildTransitCells(counts, 2, byKey, HEX_SIZE, PROJ);
  assert.strictEqual(cells.length, 1, 'only the resolvable key produces a TransitCell');
  assert.strictEqual(cells[0].key, grid[0].key);
});

test('onPartialTracks is a pure observer: supplying it never changes the final ensemble result', () => {
  // FOUND ON CI (not locally): the original version of this test relied on
  // a 4000-mover run genuinely crossing the REAL 250ms wall-clock throttle
  // at least once, proven reliable on the machine this was authored on —
  // but wall-clock timing is not deterministic across machines, and on at
  // least one real GitHub Actions runner (evidently faster or differently
  // loaded) the same 4000-mover run completed without ever crossing 250ms,
  // so the callback never fired and this test's own precondition guard
  // correctly failed, but flakily — a real, reproducible CI-only failure
  // with no code defect behind it. Fixed with `partialTracksIntervalMsOverride:
  // 0` (movementSimulation.ts, a test-only seam) instead of a bigger mover
  // count: forces the throttle to fire on literally every mover,
  // deterministically, regardless of host speed — the comparison's
  // correctness no longer depends on timing at all.
  const runOpts = { moverCount: 300, seed: 7, keepTrajectories: 0 } as const;
  const withoutCallback = simulateMovementEnsemble(grid, originKeys, objectiveKeys, foot, false, HEX_SIZE, PROJ, runOpts)!;
  const partialCalls: { cells: TransitCell[]; moversDone: number }[] = [];
  const withCallback = simulateMovementEnsemble(grid, originKeys, objectiveKeys, foot, false, HEX_SIZE, PROJ, {
    ...runOpts,
    partialTracksIntervalMsOverride: 0,
    onPartialTracks: (cells, moversDone) => partialCalls.push({ cells, moversDone }),
  })!;
  assert.ok(withoutCallback && withCallback, 'test setup: both runs must produce a real ensemble');
  assert.strictEqual(partialCalls.length, 300, 'test setup: with the interval forced to 0, the callback must fire on EVERY mover, deterministically — not a timing-dependent count');
  assert.strictEqual(withCallback.arrivedCount, withoutCallback.arrivedCount, 'arrivedCount must be unaffected by the callback');
  assert.strictEqual(withCallback.lostCount, withoutCallback.lostCount, 'lostCount must be unaffected by the callback');
  assert.deepStrictEqual(
    withCallback.tracks.map(t => t.totalSeconds),
    withoutCallback.tracks.map(t => t.totalSeconds),
    'every mover\'s own elapsed time must be bit-for-bit identical with or without the callback — proves the RNG stream was untouched'
  );
  assert.deepStrictEqual(
    withCallback.cells.map(c => ({ key: c.key, moverCount: c.moverCount })),
    withoutCallback.cells.map(c => ({ key: c.key, moverCount: c.moverCount })),
    'the FINAL transit-cell picture must be identical too, not just per-mover outcomes'
  );
});

test('any partial snapshots that fire during a real run are individually well-formed', () => {
  // Large enough mover count that a real run plausibly crosses the 250ms
  // throttle interval on at least a slow CI runner — but this is
  // deliberately NOT asserted on (see module header): the throttle is real
  // wall-clock time, so "zero partial calls" is a legitimate outcome on a
  // fast machine, not a failure. What's tested is that IF any fired, each
  // one is internally consistent.
  const partialCalls: { cells: TransitCell[]; moversDone: number }[] = [];
  const result = simulateMovementEnsemble(grid, originKeys, objectiveKeys, foot, false, HEX_SIZE, PROJ, {
    moverCount: 4000,
    seed: 11,
    keepTrajectories: 0,
    onPartialTracks: (cells, moversDone) => partialCalls.push({ cells, moversDone }),
  })!;
  assert.ok(result, 'test setup: must produce a real ensemble');

  let prevMoversDone = 0;
  for (const call of partialCalls) {
    assert.ok(call.moversDone > prevMoversDone, `moversDone must strictly increase across snapshots, got ${call.moversDone} after ${prevMoversDone}`);
    assert.ok(call.moversDone <= result.moverCount, `moversDone (${call.moversDone}) cannot exceed the run's own moverCount (${result.moverCount})`);
    prevMoversDone = call.moversDone;
    for (const c of call.cells) {
      assert.ok(c.transitFraction > 0 && c.transitFraction <= 1, `transitFraction out of (0,1] for ${c.key}: ${c.transitFraction}`);
      assert.ok(c.moverCount <= call.moversDone, `a cell's own crossing count (${c.moverCount}) cannot exceed moversDone (${call.moversDone})`);
    }
    for (let i = 1; i < call.cells.length; i++) {
      assert.ok(
        call.cells[i - 1].transitFraction >= call.cells[i].transitFraction,
        'each snapshot must itself be sorted descending by transitFraction'
      );
    }
  }
  console.log(`  (info: ${partialCalls.length} partial snapshot(s) fired during a ${result.moverCount}-mover run)`);
});

const TOTAL_TESTS = 4;
if (passed === TOTAL_TESTS) {
  console.log(`\nAll ${passed} movement ensemble streaming checks passed.`);
} else {
  console.log(`\n${passed}/${TOTAL_TESTS} movement ensemble streaming checks passed.`);
}
