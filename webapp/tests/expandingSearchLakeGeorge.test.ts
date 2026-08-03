/**
 * The off-road/foot half of the Lake George claim (docs/ROUTE_INTELLIGENCE.md
 * §35 — Slice A.9 fixed vehicles via the box-free road graph; this is the
 * off-road case roads can't answer: a foot mover facing a barrier that spans
 * a NARROW search box entirely, but has a real gap once the box is widened).
 *
 * `mobilityAppreciation.ts`'s scoped fix (docs §35, "expand-and-retry" rather
 * than the full lazy-grid/cost-budget/corridor-termination architecture the
 * section also designs) is: retry `buildMobilityGrid` + the worker search at
 * an escalating `boundsPadFactor` when a search finds no route, instead of
 * paying (or being limited to) one fixed pad on every run. That orchestration
 * itself is network-coupled (elevation/vegetation/trail/water fetches) and
 * not unit-testable without mocking every one of them — so, matching
 * `lakeGeorgeRoadRouting.test.ts`'s own precedent for the road-graph half,
 * this proves the mechanism at the ENGINE level: a synthetic hex grid with a
 * water barrier that completely blocks a NARROW box but has a real gap once
 * the box is widened — exactly what one retry step buys a real run.
 *
 * `runAccumulatedCostSearch`/`extractPath` are the exact functions
 * `mobilityWorker.ts` calls on every attempt; this test calls them directly,
 * synchronously, no network — the same "prove the search itself, not the
 * orchestration around it" discipline the road-graph proof used.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/expandingSearchLakeGeorge.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint } from '@firebreak/terrain';
import { runAccumulatedCostSearch, extractPath, MobilityGridCell } from '@firebreak/terrain';
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

// `foot-individual-unladen` has no fordingDepthM — a standing water body is
// therefore an unconditional NO-GO for it (mobilityCost.ts: no capability at
// all means every ford fails outright), exactly what a real lake produces.
const foot = MOVER_PROFILES.find(p => p.id === 'foot-individual-unladen')!;
assert.ok(foot && foot.fordingDepthM === undefined);

const HEX_SIZE = 40;
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };

// Barrier: a vertical strip of standing water spanning y = -100..200, with a
// gap only at y = 200..300 — reachable only once the search box is widened
// enough to include it. x = 480..520 is the strip's width.
const BARRIER_X_MIN = 440;
const BARRIER_X_MAX = 560;
const BARRIER_Y_MAX_NARROW = 200; // the barrier is solid up to here
const GAP_Y_MIN = 200;
const GAP_Y_MAX = 300; // the gap — only inside a WIDENED box

function buildSyntheticGrid(minPt: LocalPoint, maxPt: LocalPoint): MobilityGridCell[] {
  const cellsRaw = generateBoxHexes(minPt, maxPt, HEX_SIZE);
  return cellsRaw
    .filter(c => c.center.x >= minPt.x && c.center.x <= maxPt.x && c.center.y >= minPt.y && c.center.y <= maxPt.y)
    .map(c => {
      const inBarrierX = c.center.x >= BARRIER_X_MIN && c.center.x <= BARRIER_X_MAX;
      const inGapY = c.center.y >= GAP_Y_MIN && c.center.y <= GAP_Y_MAX;
      const inWaterBody = inBarrierX && !(inGapY && c.center.y <= maxPt.y);
      const cell: MobilityGridCell = {
        key: hexKey(c.hex),
        hex: c.hex,
        center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / 111320 },
        elevation: 0, // flat — no slope gates fire, only the water barrier matters
        vegetation: 'grassland',
        vegEstimated: false,
        onTrail: false,
        nearestTrailTags: null,
        crossSlopeDeg: 0,
        waterDistanceM: inWaterBody ? 0 : Infinity,
        inWaterBody,
        nearestWaterwayKind: null,
        waterFrequency: null,
      };
      return cell;
    });
}

console.log('Off-road expanding-search claim (§35, scoped Slice B):');

test('a NARROW box (matching the old fixed-pad behaviour) finds NO route — the barrier is solid within it', () => {
  const minPt: LocalPoint = { x: 0, y: -100 };
  const maxPt: LocalPoint = { x: 1000, y: BARRIER_Y_MAX_NARROW }; // y caps BEFORE the gap
  const cells = buildSyntheticGrid(minPt, maxPt);
  assert.ok(cells.length > 20, 'test setup: the synthetic grid must have real cells to search over');

  const originKeys = cells.filter(c => c.center.lng < ANCHOR.lng + 100 / 111320).map(c => c.key);
  const objectiveKeys = cells.filter(c => c.center.lng > ANCHOR.lng + 900 / 111320).map(c => c.key);
  assert.ok(originKeys.length > 0 && objectiveKeys.length > 0, 'test setup: origin/objective seed sets must be non-empty');

  const reach = runAccumulatedCostSearch(cells, originKeys, foot, false);
  const path = extractPath(reach, objectiveKeys);
  assert.strictEqual(path, null, 'FAILED: the narrow box should NOT find a route — the barrier is solid within its extent');
});

test('a WIDER box (one retry step) finds a route THROUGH THE GAP the narrow box could not see', () => {
  const minPt: LocalPoint = { x: 0, y: -100 };
  const maxPt: LocalPoint = { x: 1000, y: GAP_Y_MAX + 50 }; // now includes the gap
  const cells = buildSyntheticGrid(minPt, maxPt);

  const originKeys = cells.filter(c => c.center.lng < ANCHOR.lng + 100 / 111320).map(c => c.key);
  const objectiveKeys = cells.filter(c => c.center.lng > ANCHOR.lng + 900 / 111320).map(c => c.key);
  assert.ok(originKeys.length > 0 && objectiveKeys.length > 0);

  const reach = runAccumulatedCostSearch(cells, originKeys, foot, false);
  const path = extractPath(reach, objectiveKeys);
  assert.ok(path, 'FAILED: the wider box should find the detour through the gap — this is the whole point of expanding the search');

  // Confirm it's a REAL detour through the gap, not a fluke: at least one
  // cell on the path must actually sit in the gap band. `cell.center` is
  // {lat,lng} by this point (the real MobilityGridCell shape), so recover
  // the local y this cell was built at via the exact inverse of the
  // encoding used above, rather than comparing against a field that no
  // longer exists on this shape.
  const localY = (lat: number) => (lat - ANCHOR.lat) * 111320;
  const gapKeys = new Set(cells.filter(c => localY(c.center.lat) > BARRIER_Y_MAX_NARROW).map(c => c.key));
  assert.ok(path!.some(k => gapKeys.has(k)), 'the path must genuinely pass through the gap band the narrow box excluded');
});

test('CONTROL: seal the gap too (an unbroken barrier) — the WIDE box now correctly finds NO route either', () => {
  const minPt: LocalPoint = { x: 0, y: -100 };
  const maxPt: LocalPoint = { x: 1000, y: GAP_Y_MAX + 50 };
  const cellsRaw = generateBoxHexes(minPt, maxPt, HEX_SIZE);
  const cells: MobilityGridCell[] = cellsRaw
    .filter(c => c.center.x >= minPt.x && c.center.x <= maxPt.x && c.center.y >= minPt.y && c.center.y <= maxPt.y)
    .map(c => {
      // No gap at all this time — solid barrier across the full widened extent.
      const inWaterBody = c.center.x >= BARRIER_X_MIN && c.center.x <= BARRIER_X_MAX;
      return {
        key: hexKey(c.hex), hex: c.hex,
        center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / 111320 },
        elevation: 0, vegetation: 'grassland', vegEstimated: false, onTrail: false, nearestTrailTags: null,
        crossSlopeDeg: 0, waterDistanceM: inWaterBody ? 0 : Infinity, inWaterBody, nearestWaterwayKind: null, waterFrequency: null,
      };
    });

  const originKeys = cells.filter(c => c.center.lng < ANCHOR.lng + 100 / 111320).map(c => c.key);
  const objectiveKeys = cells.filter(c => c.center.lng > ANCHOR.lng + 900 / 111320).map(c => c.key);
  assert.ok(originKeys.length > 0 && objectiveKeys.length > 0);

  const reach = runAccumulatedCostSearch(cells, originKeys, foot, false);
  const path = extractPath(reach, objectiveKeys);
  assert.strictEqual(path, null,
    'without a real gap, widening the box must NOT manufacture a route — this proves the test is exercising real connectivity, not a bug that finds SOMETHING regardless');
});

if (process.exitCode === 1) {
  console.error(`\nThe off-road expanding-search claim did NOT hold.`);
} else {
  console.log(`\nAll ${passed} checks passed — the off-road expanding-search claim holds.`);
}
