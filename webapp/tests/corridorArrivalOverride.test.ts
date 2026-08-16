/**
 * WP5 Tier B, Fix 1 (`corridorField.ts#computeCellFacts`) — proves the new
 * `arrivalSecondsOverride` option lets `buildCorridorField` skip its own
 * internal accumulated-cost search WITHOUT changing a single observable
 * field of the result, and — separately, this is the important half —
 * proves the override is actually WIRED IN rather than silently ignored.
 *
 * WHY BOTH HALVES MATTER (see WP2's own post-mortem, this work package's
 * process note): a test that only checks "correct override in ⇒ same
 * output" would ALSO pass if `computeCellFacts` quietly kept running its own
 * search and threw the override away — the numbers would still match,
 * because a matching override and a fresh internal search compute the exact
 * same thing by construction. That test alone proves nothing about whether
 * the fast path is actually taken. The second half closes that gap: feed in
 * a DELIBERATELY WRONG override (every arrival time collapsed to the same
 * constant) and confirm the output changes in the exact way only consuming
 * that wrong map — not a fresh, correct search — could produce. If the
 * override is ever silently ignored, this half fails.
 *
 * Fixture: `corridorClustering.test.ts`'s own two-gap barrier (reused
 * verbatim) — a due-east crossing forced through a north OR south gap in a
 * barrier. Chosen here (rather than a fresh one) specifically because that
 * module's own doc comment and `corridorField.ts`'s "degeneracy test" note
 * both establish that this shape produces a GENUINE pinch (routes fan out
 * either side of the barrier before funnelling through the gap), which is
 * exactly the property the wrong-override half needs: a real
 * `bottleneckCells < widestCells` in the correct run to contrast against the
 * forced `bottleneckCells === cells.length` an all-equal arrival map produces
 * (`corridorField.ts#buildCorridor`: iso-arrival slicing only fires when
 * `span = hi - lo > 0`; a constant map makes every arrival tie, so `span`
 * collapses to 0 and the function falls back to "the whole corridor is the
 * only honest slice available").
 *
 * Plain node:assert. Run: npx tsx webapp/tests/corridorArrivalOverride.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint } from '@firebreak/terrain';
import { MobilityGridCell } from '@firebreak/terrain';
import { MOVER_PROFILES } from '@firebreak/terrain';
import { makeProjection } from '@firebreak/terrain';
import { buildCorridorField, ensembleTracksToRoutes } from '@firebreak/terrain';
import { runAccumulatedCostSearch, extractPath } from '@firebreak/terrain';
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
assert.ok(foot);

const HEX_SIZE = 30;
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };
const proj = makeProjection(ANCHOR);

// Verbatim from corridorClustering.test.ts — see that file for the shape's
// own rationale.
const BARRIER_X_MIN = 460;
const BARRIER_X_MAX = 640;
const NORTH_GAP = { min: 0, max: 90 };
const SOUTH_GAP = { min: 510, max: 600 };
const BOX_MIN: LocalPoint = { x: 0, y: -20 };
const BOX_MAX: LocalPoint = { x: 1100, y: 620 };

function buildGrid(): MobilityGridCell[] {
  const cellsRaw = generateBoxHexes(BOX_MIN, BOX_MAX, HEX_SIZE);
  return cellsRaw
    .filter(c => c.center.x >= BOX_MIN.x && c.center.x <= BOX_MAX.x && c.center.y >= BOX_MIN.y && c.center.y <= BOX_MAX.y)
    .map(c => {
      const inBarrierX = c.center.x >= BARRIER_X_MIN && c.center.x <= BARRIER_X_MAX;
      const inNorthGap = c.center.y >= NORTH_GAP.min && c.center.y <= NORTH_GAP.max;
      const inSouthGap = c.center.y >= SOUTH_GAP.min && c.center.y <= SOUTH_GAP.max;
      const inWaterBody = inBarrierX && !inNorthGap && !inSouthGap;
      const cell: MobilityGridCell = {
        key: hexKey(c.hex),
        hex: c.hex,
        center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / 111320 },
        elevation: 0,
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

console.log('computeCellFacts arrival-time override (WP5 Tier B, Fix 1):');

const cells = buildGrid();
const originKeys = cells
  .filter(c => c.center.lng < ANCHOR.lng + 60 / 111320 && Math.abs((c.center.lat - ANCHOR.lat) * 111320 - 300) < 60)
  .map(c => c.key);
const objectiveKeys = cells
  .filter(c => c.center.lng > ANCHOR.lng + 1040 / 111320 && Math.abs((c.center.lat - ANCHOR.lat) * 111320 - 300) < 60)
  .map(c => c.key);
assert.ok(originKeys.length > 0 && objectiveKeys.length > 0, 'test setup: seed sets must be non-empty');

// The "already-run search" a real routesOverride caller (the movement
// ensemble, the road-route-refold, the restricted re-run) would have lying
// around — the SAME inputs `computeCellFacts` would otherwise search with
// itself: same cells, same originKeys, same profile, no night mode, no
// edgePenalties.
const reach = runAccumulatedCostSearch(cells, originKeys, foot, false);
const path = extractPath(reach, objectiveKeys);
assert.ok(path && path.length > 1, 'test setup: a route must exist between origin and objective');

// A plausible routesOverride payload — one real route through the grid,
// shaped exactly like `ensembleTracksToRoutes` produces for a simulated
// mover, which is what `mobilityAppreciation.ts` actually feeds in at every
// one of the three call sites this fix touches.
const reachedObjectiveKey = path![path!.length - 1];
const totalSeconds = reach.best.get(reachedObjectiveKey)!.timeSeconds;
const routesOverride = ensembleTracksToRoutes([{ keys: path!, totalSeconds }], cells);
assert.strictEqual(routesOverride.length, 1, 'test setup: exactly one override route expected');

const correctArrivalSeconds = new Map<string, number>();
for (const [key, v] of reach.best) correctArrivalSeconds.set(key, v.timeSeconds);

const buildOpts = {
  routesOverride,
  evidence: 'simulated-movers' as const,
  weightByAttractiveness: false,
};

const fieldNoOverride = buildCorridorField(cells, originKeys, objectiveKeys, foot, false, HEX_SIZE, proj, buildOpts);
const fieldWithCorrectOverride = buildCorridorField(
  cells, originKeys, objectiveKeys, foot, false, HEX_SIZE, proj,
  { ...buildOpts, arrivalSecondsOverride: correctArrivalSeconds }
);

assert.ok(fieldNoOverride, 'test setup: a corridor field must build with no override');
assert.ok(fieldWithCorrectOverride, 'test setup: a corridor field must build with the correct override');

// --- Half 1: a CORRECT override must not move a single observable field.
test('a correct arrivalSecondsOverride reproduces the field built by the internal search bit-for-bit', () => {
  assert.strictEqual(fieldWithCorrectOverride!.corridors.length, fieldNoOverride!.corridors.length);
  for (let i = 0; i < fieldNoOverride!.corridors.length; i++) {
    const a = fieldNoOverride!.corridors[i];
    const b = fieldWithCorrectOverride!.corridors[i];
    assert.strictEqual(b.id, a.id, `corridor ${i} id`);
    assert.strictEqual(b.bottleneckCells, a.bottleneckCells, `corridor ${i} bottleneckCells`);
    assert.strictEqual(b.widestCells, a.widestCells, `corridor ${i} widestCells`);
    assert.strictEqual(b.bottleneckWidthM, a.bottleneckWidthM, `corridor ${i} bottleneckWidthM`);
    assert.deepStrictEqual([...b.bottleneckCellKeys].sort(), [...a.bottleneckCellKeys].sort(), `corridor ${i} bottleneckCellKeys`);
    assert.strictEqual(b.unrestrictedFraction, a.unrestrictedFraction, `corridor ${i} unrestrictedFraction`);
    assert.strictEqual(b.restrictedFraction, a.restrictedFraction, `corridor ${i} restrictedFraction`);
    assert.strictEqual(b.severelyRestrictedFraction, a.severelyRestrictedFraction, `corridor ${i} severelyRestrictedFraction`);
    assert.strictEqual(b.easeClass, a.easeClass, `corridor ${i} easeClass`);
    assert.strictEqual(b.pinchRatio, a.pinchRatio, `corridor ${i} pinchRatio`);
    assert.strictEqual(b.riskScore, a.riskScore, `corridor ${i} riskScore`);
  }
  assert.strictEqual(fieldWithCorrectOverride!.pinchRatio, fieldNoOverride!.pinchRatio);
  assert.strictEqual(fieldWithCorrectOverride!.unconstrained, fieldNoOverride!.unconstrained);
});

// --- Test-setup sanity the wrong-override half depends on: the correct
// field must have a REAL pinch (bottleneckCells strictly less than
// widestCells for at least one corridor) — otherwise the two behaviours
// below could accidentally coincide and the test would be vacuous.
test('test setup: the correct field has a genuine pinch somewhere (not a vacuous fixture)', () => {
  const hasRealPinch = fieldNoOverride!.corridors.some(c => c.bottleneckCells < c.widestCells);
  assert.ok(hasRealPinch, 'FAILED (test setup): fixture must produce a real bottleneck < widest split for this test to mean anything');
});

// --- Half 2: a WRONG override must actually be CONSUMED, not silently
// discarded in favour of a fresh internal search. Collapsing every arrival
// time to the same constant forces `span = hi - lo === 0` in every
// corridor's iso-arrival-time bucketing, which — per `buildCorridor`'s own
// fallback — makes `bottleneckCells === widestCells === cells.length` for
// EVERY corridor, a result the correct search could not produce (it has a
// real pinch, proven above). If a future change reintroduces the bug this
// fix removes (i.e. `computeCellFacts` ignores the override and always runs
// its own search), this assertion fails because the field reverts to the
// CORRECT, pinched numbers instead.
test('a WRONG arrivalSecondsOverride is actually used — it visibly changes the bottleneck/widest split', () => {
  const wrongArrivalSeconds = new Map<string, number>();
  for (const key of correctArrivalSeconds.keys()) wrongArrivalSeconds.set(key, 100);
  const fieldWithWrongOverride = buildCorridorField(
    cells, originKeys, objectiveKeys, foot, false, HEX_SIZE, proj,
    { ...buildOpts, arrivalSecondsOverride: wrongArrivalSeconds }
  );
  assert.ok(fieldWithWrongOverride, 'test setup: a corridor field must build with the wrong override too');
  for (const c of fieldWithWrongOverride!.corridors) {
    assert.strictEqual(c.bottleneckCells, c.cells.length,
      `FAILED: corridor ${c.id} bottleneckCells=${c.bottleneckCells} should equal cells.length=${c.cells.length} ` +
      `when every arrival time ties — the override is not being consumed (still using a fresh, correct internal search)`);
    assert.strictEqual(c.widestCells, c.cells.length, `FAILED: corridor ${c.id} widestCells should also equal cells.length under a constant-arrival override`);
  }
  // And the field-level pinchRatio (busiest corridor's own bottleneck/widest)
  // must read as 1 (no pinch at all) — the direct opposite of the correct
  // field, whose pinchRatio is strictly below 1 because of the real gap.
  assert.strictEqual(fieldWithWrongOverride!.pinchRatio, 1, 'FAILED: field pinchRatio should read "no pinch" under the collapsed override');
  assert.ok(fieldNoOverride!.pinchRatio < 1, 'test setup: the correct field must have pinchRatio < 1 for this contrast to mean anything');
});

// --- Reviewer addendum: the fixture above builds its override from
// `reach.best` directly, which — like `computeCellFacts`'s own internal
// path — has NO entry at all for an unreachable cell (Dijkstra's `best`
// only ever contains settled/reached cells). The REAL production caller
// (`mobilityAppreciation.ts`'s `baselineArrivalSeconds`) does not build its
// override this way: it comes from `assembleMobilityResults`'s own output
// (`results.map(r => [r.key, r.timeSeconds])`), and `assembleMobilityResults`
// (accumulatedCost.ts) emits ONE ENTRY PER GRID CELL, with
// `timeSeconds: Infinity` for an unreached cell rather than omitting it —
// a structurally different map (every key present) that happens to behave
// identically here only because both real read sites of `arrivalSeconds`
// (`corridorField.ts`'s width/bottleneck slicing) filter with `isFinite`,
// never `.has()`. That equivalence is real today but was never exercised by
// the test above, which never puts an unreachable-with-Infinity entry into
// its override map at all. Proven directly here, against the SAME
// production-shaped override the real call sites actually send.
test('a production-shaped override (every cell PRESENT, unreachable ones Infinity — not simply absent) is handled identically to one that omits unreachable cells', () => {
  // Build the "every grid cell present" shape assembleMobilityResults
  // actually produces: every cell in `cells` gets an entry, Infinity for
  // anything `reach.best` never reached.
  const productionShapedOverride = new Map<string, number>();
  for (const c of cells) {
    const arrival = reach.best.get(c.key);
    productionShapedOverride.set(c.key, arrival ? arrival.timeSeconds : Infinity);
  }
  assert.ok(
    productionShapedOverride.size > correctArrivalSeconds.size,
    'test setup: the production-shaped map must be STRICTLY LARGER than the reached-only map, or this fixture has no unreachable cells to actually test'
  );

  const fieldWithProductionShapedOverride = buildCorridorField(
    cells, originKeys, objectiveKeys, foot, false, HEX_SIZE, proj,
    { ...buildOpts, arrivalSecondsOverride: productionShapedOverride }
  );
  assert.ok(fieldWithProductionShapedOverride, 'test setup: a corridor field must build with the production-shaped override');

  for (let i = 0; i < fieldNoOverride!.corridors.length; i++) {
    const a = fieldNoOverride!.corridors[i];
    const b = fieldWithProductionShapedOverride!.corridors[i];
    assert.strictEqual(b.bottleneckCells, a.bottleneckCells, `corridor ${i} bottleneckCells (production-shaped override)`);
    assert.strictEqual(b.widestCells, a.widestCells, `corridor ${i} widestCells (production-shaped override)`);
    assert.strictEqual(b.pinchRatio, a.pinchRatio, `corridor ${i} pinchRatio (production-shaped override)`);
  }
});

if (process.exitCode === 1) {
  console.error(`\nSome corridor arrival-override checks failed.`);
} else {
  console.log(`\nAll ${passed} corridor arrival-override checks passed.`);
}
