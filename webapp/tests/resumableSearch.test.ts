/**
 * Resumable multi-source search (docs/ROUTE_INTELLIGENCE.md §35 — the lazy
 * grid's core mechanism, `mobilityLazyGrid.ts`): `runAccumulatedCostSearch`'s
 * `resumeFrom` option lets a later call, over a GROWN cell set, CONTINUE a
 * prior partial search rather than restart Dijkstra from the origin AOI at
 * cost 0 again. Correct because Dijkstra with non-negative edges never
 * revises a settled distance once popped — seeding a fresh heap from a prior
 * result's `best` map is equivalent to having relaxed through those cells
 * "for real" in one longer run.
 *
 * Proven at the engine level (no network), matching this suite's own
 * established precedent (`expandingSearchLakeGeorge.test.ts`,
 * `frontierEdgeGrowth.test.ts`) for exactly the same reason: the async
 * orchestration around it (`mobilityLazyGrid.ts`) is network-coupled and not
 * unit-testable without mocking every upstream fetch.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/resumableSearch.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint } from '../src/utils/hexGrid';
import { runAccumulatedCostSearch, extractPath, MobilityGridCell } from '../src/terrain/accumulatedCost';
import { MOVER_PROFILES } from '../src/terrain/moverProfiles';
import { LatLng } from '../src/utils/chainage';

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
const HEX_SIZE = 40;
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };

function cellsInBox(minPt: LocalPoint, maxPt: LocalPoint): MobilityGridCell[] {
  return generateBoxHexes(minPt, maxPt, HEX_SIZE)
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

console.log('Resumable multi-source search (§35, lazy grid core mechanism):');

test('resuming a full search over a GROWN cell set matches a from-scratch search over that same final set exactly', () => {
  const fullMin: LocalPoint = { x: 0, y: -200 };
  const fullMax: LocalPoint = { x: 1000, y: 200 };
  const allCells = cellsInBox(fullMin, fullMax);
  assert.ok(allCells.length > 50, 'test setup: need a real grid');

  // The "first round" only materialised the western half.
  const partialCells = allCells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 <= 500);
  assert.ok(partialCells.length > 0 && partialCells.length < allCells.length, 'test setup: partial set must be a genuine subset');

  const originKeys = allCells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 < 50).map(c => c.key);
  const objectiveKeys = allCells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 > 950).map(c => c.key);
  assert.ok(originKeys.length > 0 && objectiveKeys.length > 0);

  const fromScratch = runAccumulatedCostSearch(allCells, originKeys, foot, false);
  const partial = runAccumulatedCostSearch(partialCells, originKeys, foot, false);
  const resumed = runAccumulatedCostSearch(allCells, originKeys, foot, false, { resumeFrom: partial });

  assert.ok(fromScratch.best.size > partial.best.size, 'test setup: the full grid must reach cells the partial one could not');

  for (const [key, v] of fromScratch.best) {
    const r = resumed.best.get(key);
    assert.ok(r, `resumed search failed to reach cell ${key} that the from-scratch search reached`);
    assert.ok(
      Math.abs(r!.timeSeconds - v.timeSeconds) < 1e-6,
      `cell ${key}: from-scratch=${v.timeSeconds}s, resumed=${r!.timeSeconds}s — should be identical`
    );
  }
  // And no cell reached by the resumed search that the full one couldn't (no manufactured shortcuts).
  assert.strictEqual(resumed.best.size, fromScratch.best.size);

  const pathFull = extractPath(fromScratch, objectiveKeys);
  const pathResumed = extractPath(resumed, objectiveKeys);
  assert.ok(pathFull && pathResumed);
  assert.deepStrictEqual(pathResumed, pathFull, 'resumed search must backtrack the identical route');
});

test('resuming NEVER revises a distance the prior partial search already settled', () => {
  const fullMin: LocalPoint = { x: 0, y: -200 };
  const fullMax: LocalPoint = { x: 1000, y: 200 };
  const allCells = cellsInBox(fullMin, fullMax);
  const partialCells = allCells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 <= 400);
  const originKeys = allCells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 < 50).map(c => c.key);

  const partial = runAccumulatedCostSearch(partialCells, originKeys, foot, false);
  const resumed = runAccumulatedCostSearch(allCells, originKeys, foot, false, { resumeFrom: partial });

  for (const [key, v] of partial.best) {
    const r = resumed.best.get(key)!;
    assert.strictEqual(r.timeSeconds, v.timeSeconds, `cell ${key} was revised on resume — Dijkstra correctness violated`);
  }
});

test('THE LAZY-GRID CASE: a search boxed into a narrow (short) tile footprint finds no route; resuming with the next tile ring north (containing a real gap through a barrier) finds one', () => {
  // A vertical barrier (blocks WEST<->EAST movement) spanning the full
  // height of whatever box it's sampled over, except a gap band in y that's
  // simply outside round 1's shorter footprint — same barrier/gap pattern as
  // `expandingSearchLakeGeorge.test.ts`, but exercised via resumeFrom growth
  // across two cell sets instead of two independent from-scratch searches.
  const BARRIER_X_MIN = 440, BARRIER_X_MAX = 560;
  const BARRIER_Y_MAX_NARROW = 200; // round 1's own y ceiling — the barrier is solid up to here
  const GAP_Y_MIN = 200, GAP_Y_MAX = 300; // only visible once the footprint grows north past 200

  function buildBarrierGrid(minPt: LocalPoint, maxPt: LocalPoint): MobilityGridCell[] {
    return generateBoxHexes(minPt, maxPt, HEX_SIZE)
      .filter(c => c.center.x >= minPt.x && c.center.x <= maxPt.x && c.center.y >= minPt.y && c.center.y <= maxPt.y)
      .map(c => {
        const inBarrierX = c.center.x >= BARRIER_X_MIN && c.center.x <= BARRIER_X_MAX;
        const inGapY = c.center.y >= GAP_Y_MIN && c.center.y <= GAP_Y_MAX;
        const inWaterBody = inBarrierX && !inGapY;
        return {
          key: hexKey(c.hex), hex: c.hex,
          center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / 111320 },
          elevation: 0, vegetation: 'grassland' as const, vegEstimated: false, onTrail: false, nearestTrailTags: null,
          crossSlopeDeg: 0, waterDistanceM: inWaterBody ? 0 : Infinity, inWaterBody, nearestWaterwayKind: null, waterFrequency: null,
        };
      });
  }

  // Round 1 "tile footprint": full west-east extent (origin AND objective
  // both already inside it — a tile-growth loop only needs to widen an
  // AXIS that's actually blocking it, here north/south) but capped short in
  // y, exactly at the barrier's solid ceiling — matches what an initial
  // footprint sized off the direct origin<->objective span (which runs due
  // east, not north) would materialise before any tile growth.
  const round1Min: LocalPoint = { x: 0, y: -100 };
  const round1Max: LocalPoint = { x: 1000, y: BARRIER_Y_MAX_NARROW };
  const round1Cells = buildBarrierGrid(round1Min, round1Max);
  assert.ok(round1Cells.length > 20, 'test setup');

  const originKeys = round1Cells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 < 100).map(c => c.key);
  const objectiveKeys1 = round1Cells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 > 900).map(c => c.key);
  assert.ok(originKeys.length > 0 && objectiveKeys1.length > 0);

  const round1Result = runAccumulatedCostSearch(round1Cells, originKeys, foot, false);
  const pathRound1 = extractPath(round1Result, objectiveKeys1);
  assert.strictEqual(pathRound1, null, 'round 1 (before the gap-containing tile ring is materialised) must not find a route — the barrier is solid within its extent');

  // Round 2: materialise the next tile ring (north, where the gap actually
  // is) and RESUME — not restart — the search.
  const round2Min: LocalPoint = { x: 0, y: -100 };
  const round2Max: LocalPoint = { x: 1000, y: GAP_Y_MAX + 50 };
  const round2Cells = buildBarrierGrid(round2Min, round2Max);
  const objectiveKeys2 = round2Cells.filter(c => (c.center.lng - ANCHOR.lng) * 111320 > 900).map(c => c.key);
  assert.ok(objectiveKeys2.length > 0);

  const resumed = runAccumulatedCostSearch(round2Cells, originKeys, foot, false, { resumeFrom: round1Result });
  const path = extractPath(resumed, objectiveKeys2);
  assert.ok(path, 'FAILED: resuming with the gap-containing tile ring must find the route through it');

  const localY = (lat: number) => (lat - ANCHOR.lat) * 111320;
  const byKey = new Map(round2Cells.map(c => [c.key, c]));
  const passedThroughGap = path!.some(k => localY(byKey.get(k)!.center.lat) > BARRIER_Y_MAX_NARROW);
  assert.ok(passedThroughGap, 'the resumed route must genuinely pass through the newly-materialised gap band, not some other artefact');
});

if (process.exitCode === 1) {
  console.error(`\nSome resumable-search checks failed.`);
} else {
  console.log(`\nAll ${passed} resumable-search checks passed.`);
}
