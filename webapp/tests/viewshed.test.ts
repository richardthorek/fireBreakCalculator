/**
 * Viewshed (OCOKA 6, docs/ROUTE_INTELLIGENCE.md §47/§8) — proves
 * `computeViewshedForObserver`/`buildObservationResult` against real,
 * geometrically-obvious fixtures: a ridge blocks line of sight, vegetation
 * canopy blocks the SCREENED surface but not bare-earth, and Earth
 * curvature+refraction eventually blocks a sightline over flat ground alone.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/viewshed.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { VegetationType } from '../src/config/classification';
import { computeViewshedForObserver, buildObservationResult, DEFAULT_MAX_RANGE_M } from '../src/terrain/viewshed';
import { CorridorField, CorridorCell } from '../src/terrain/corridorField';
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

const HEX_SIZE = 30;
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };

/** Build a flat-corridor grid at `hexSize` resolution, `elevationAt`/
 *  `vegetationAt` sampled per LOCAL (x, y). Returns both the `MobilityGridCell`
 *  array AND a `pickNearestX` helper that resolves the real cell nearest a
 *  given local x (y = 0) — selection MUST use the raw local point, since
 *  `MobilityGridCell.center` is a LatLng (no `.x`/`.y`) once built. */
function buildCorridorGrid(
  minPt: LocalPoint, maxPt: LocalPoint, hexSize: number, yHalfWidth: number,
  elevationAt: (x: number) => number, vegetationAt: (x: number) => VegetationType
): { cells: MobilityGridCell[]; pickNearestX: (x: number) => MobilityGridCell } {
  const raw = generateBoxHexes(minPt, maxPt, hexSize).filter(c => Math.abs(c.center.y) <= yHalfWidth);
  const cells: MobilityGridCell[] = raw.map(c => ({
    key: hexKey(c.hex),
    hex: c.hex,
    center: { lat: ANCHOR.lat + c.center.y / 111320, lng: ANCHOR.lng + c.center.x / 111320 },
    elevation: elevationAt(c.center.x),
    vegetation: vegetationAt(c.center.x),
    vegEstimated: false,
    onTrail: false,
    nearestTrailTags: null,
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
  }));
  const byHexKey = new Map(cells.map(c => [c.key, c]));
  const pickNearestX = (x: number): MobilityGridCell => {
    const nearestRaw = raw.reduce((best, c) =>
      Math.abs(c.center.x - x) < Math.abs(best.center.x - x) ? c : best
    );
    return byHexKey.get(hexKey(nearestRaw.hex))!;
  };
  return { cells, pickNearestX };
}

console.log('Viewshed (OCOKA 6):');

// ---------------------------------------------------------------------------
// Test 1+2: a ridge blocks a distant target, an unblocked target before the
// ridge is visible — a straight flat corridor along +x, elevation 0
// everywhere except a raised band partway out.
// ---------------------------------------------------------------------------
{
  const RIDGE_X_MIN = 900, RIDGE_X_MAX = 1000, RIDGE_ELEVATION = 200;
  const { cells, pickNearestX } = buildCorridorGrid(
    { x: -50, y: -50 }, { x: 2050, y: 50 }, HEX_SIZE, 40,
    x => (x >= RIDGE_X_MIN && x <= RIDGE_X_MAX ? RIDGE_ELEVATION : 0),
    () => 'grassland'
  );
  const observer = pickNearestX(0);
  const nearTarget = pickNearestX(400);
  const farTarget = pickNearestX(1900);

  const view = computeViewshedForObserver(observer.key, cells, HEX_SIZE, { maxRangeM: 5000 });

  test('a target well before the ridge is visible (control)', () => {
    assert.ok(view);
    assert.ok(view!.screenedVisibleKeys.has(nearTarget.key));
    assert.ok(view!.bareEarthVisibleKeys.has(nearTarget.key));
  });

  test('a target beyond a 200 m ridge is blocked on BOTH surfaces — real terrain obstruction, not vegetation', () => {
    assert.ok(view);
    assert.ok(!view!.screenedVisibleKeys.has(farTarget.key));
    assert.ok(!view!.bareEarthVisibleKeys.has(farTarget.key));
  });
}

// ---------------------------------------------------------------------------
// Test 3: vegetation canopy blocks the SCREENED surface but not bare-earth —
// flat ground throughout, a heavyforest patch between observer and target.
// ---------------------------------------------------------------------------
{
  const FOREST_X_MIN = 200, FOREST_X_MAX = 320;
  const { cells, pickNearestX } = buildCorridorGrid(
    { x: -50, y: -50 }, { x: 650, y: 50 }, HEX_SIZE, 40,
    () => 0,
    x => (x >= FOREST_X_MIN && x <= FOREST_X_MAX ? 'heavyforest' : 'grassland')
  );
  const observer = pickNearestX(0);
  const target = pickNearestX(600);

  const view = computeViewshedForObserver(observer.key, cells, HEX_SIZE, { maxRangeM: 2000 });

  test('a target behind a heavyforest patch is blocked on the SCREENED surface', () => {
    assert.ok(view);
    assert.ok(!view!.screenedVisibleKeys.has(target.key));
  });

  test('the SAME target is visible on bare earth — the canopy has no elevation, only screening height', () => {
    assert.ok(view);
    assert.ok(view!.bareEarthVisibleKeys.has(target.key));
  });
}

// ---------------------------------------------------------------------------
// Test 4: curvature + refraction genuinely limits range over flat, open,
// unobstructed ground — not a no-op correction. Grassland's own screening
// height (0.5 m) is negligible next to the curvature drop at this distance.
// ---------------------------------------------------------------------------
{
  const wideHexSize = HEX_SIZE * 6;
  const { cells, pickNearestX } = buildCorridorGrid(
    { x: -50, y: -50 }, { x: 18050, y: 50 }, wideHexSize, 80,
    () => 0,
    () => 'grassland'
  );
  const observer = pickNearestX(0);
  const nearTarget = pickNearestX(2000);
  const farTarget = pickNearestX(17500);

  const view = computeViewshedForObserver(observer.key, cells, wideHexSize, { maxRangeM: DEFAULT_MAX_RANGE_M });

  test('a near target on flat, open ground is visible', () => {
    assert.ok(view);
    assert.ok(view!.screenedVisibleKeys.has(nearTarget.key));
  });

  test('curvature+refraction alone blocks a far (~17.5 km) target on the SAME flat, open ground', () => {
    assert.ok(view);
    assert.ok(!view!.screenedVisibleKeys.has(farTarget.key), 'far target should be below the curved horizon');
    assert.ok(!view!.bareEarthVisibleKeys.has(farTarget.key), 'curvature is a geometry effect, not a vegetation one');
  });
}

// ---------------------------------------------------------------------------
// Test 5: observerKey not present in cells returns null, not a crash.
// ---------------------------------------------------------------------------
test('an unknown observer key returns null cleanly', () => {
  const { cells } = buildCorridorGrid({ x: -10, y: -10 }, { x: 10, y: 10 }, HEX_SIZE, 10, () => 0, () => 'grassland');
  assert.strictEqual(computeViewshedForObserver('nope', cells, HEX_SIZE, {}), null);
});

// ---------------------------------------------------------------------------
// Test 6: buildObservationResult unions two observers and rolls up real
// corridor coverage.
// ---------------------------------------------------------------------------
{
  const a = { observerKey: 'a', screenedVisibleKeys: new Set(['x1', 'x2']), bareEarthVisibleKeys: new Set(['x1', 'x2', 'x3']), cellsConsidered: 3 };
  const b = { observerKey: 'b', screenedVisibleKeys: new Set(['x3']), bareEarthVisibleKeys: new Set(['x3']), cellsConsidered: 1 };

  test('the union spans both observers, not just one', () => {
    const result = buildObservationResult([a, b], null);
    assert.deepStrictEqual([...result.screenedUnionKeys].sort(), ['x1', 'x2', 'x3']);
    assert.strictEqual(result.corridorCoverageFraction, null);
  });

  const fakeCorridorCells = (keys: string[]): CorridorCell[] =>
    keys.map(key => ({ key, center: { lat: 0, lng: 0 }, polygon: [], density: 1 } as unknown as CorridorCell));
  const corridorField = {
    corridors: [{ id: 'c1', cells: fakeCorridorCells(['x1', 'x2', 'x4']) }],
  } as unknown as CorridorField;

  test('corridor coverage is a real fraction of THIS corridor\'s own cells seen, not the whole grid', () => {
    const result = buildObservationResult([a, b], corridorField);
    // x1, x2 covered (screened union); x4 not — 2/3
    assert.ok(result.corridorCoverageFraction !== null);
    assert.ok(Math.abs(result.corridorCoverageFraction! - 2 / 3) < 1e-9);
  });
}

console.log(`\n${passed} assertion group(s) passed.`);
