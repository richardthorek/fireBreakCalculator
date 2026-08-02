/**
 * Slice B remainder (docs/ROUTE_INTELLIGENCE.md §35, owner 2026-07-29:
 * "ensure every analysis result has 2-5 corridors surfaced... we should be
 * seeing a 'most likely' and 'most risky' type of option to inform our
 * planning") — proves the per-corridor `riskScore` composite and the
 * `mostLikelyCorridorId`/`mostRiskyCorridorId` selection on `CorridorField`,
 * plus the `clusterRoutes` export `mobilityLazyGrid.ts`'s own interim
 * corridor-count check depends on.
 *
 * Reuses `corridorClustering.test.ts`'s proven two-gap barrier fixture (a
 * due-east crossing forced through EITHER a north or a south gap — two
 * genuinely distinct avenues), then makes the SOUTH gap hazardous (a mapped
 * stream ford, still passable for a profile with fording capability, but a
 * real, computed hazard signal) while leaving the NORTH gap clean. This is
 * not a synthetic score — it is a genuine consequence of a real per-cell
 * hydrology fact flowing through `carriesWaterSignal` into the corridor
 * aggregate, exactly the same predicate the GIS export/AI briefing already
 * use.
 *
 * `au-light-4wd` (fordingDepthM 0.7) is used instead of the unladen-foot
 * profile this suite's other fixtures favour, specifically because a mapped
 * stream (assumed depth 0.4 m) needs to be PASSABLE-BUT-HAZARDOUS here, not
 * a hard NO-GO — a foot profile with no stated fording capability blocks on
 * ANY water signal at all (mobilityCost.ts), which would sever the south
 * route entirely rather than merely marking it riskier.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/corridorRiskAndCount.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint, makeProjection } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { MOVER_PROFILES } from '../src/terrain/moverProfiles';
import { buildCorridorField, clusterRoutes, Corridor, CorridorCell } from '../src/terrain/corridorField';
import { findKDissimilarPaths } from '../src/terrain/corridorAnalysis';
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

const vehicle = MOVER_PROFILES.find(p => p.id === 'au-light-4wd')!;
assert.ok(vehicle && vehicle.fordingDepthM === 0.7, 'test setup: need a profile that can ford a shallow stream but not deep water');

const HEX_SIZE = 30;
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };
const proj = makeProjection(ANCHOR);

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
      // The south gap is a real, mapped, shallow stream crossing — passable
      // for `vehicle` (0.7 m capability > the stream's 0.4 m assumed depth)
      // but a genuine hydrology hazard `carriesWaterSignal` picks up. The
      // north gap stays completely clean, matching the original fixture.
      const onSouthFord = inBarrierX && inSouthGap;
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
        waterDistanceM: inWaterBody ? 0 : (onSouthFord ? 0 : Infinity),
        inWaterBody,
        nearestWaterwayKind: onSouthFord ? 'stream' : null,
        waterFrequency: null,
      };
      return cell;
    });
}

console.log('Corridor risk scoring + most-likely/most-risky (§35 remainder):');

const cells = buildGrid();
const originKeys = cells
  .filter(c => c.center.lng < ANCHOR.lng + 60 / 111320 && Math.abs((c.center.lat - ANCHOR.lat) * 111320 - 300) < 60)
  .map(c => c.key);
const objectiveKeys = cells
  .filter(c => c.center.lng > ANCHOR.lng + 1040 / 111320 && Math.abs((c.center.lat - ANCHOR.lat) * 111320 - 300) < 60)
  .map(c => c.key);
assert.ok(originKeys.length > 0 && objectiveKeys.length > 0, 'test setup: seed sets must be non-empty');

const field = buildCorridorField(cells, originKeys, objectiveKeys, vehicle, false, HEX_SIZE, proj, { routeCount: 14 });
assert.ok(field, 'test setup: a corridor field must be built at all');
assert.ok(field!.corridors.length >= 2, `test setup: need at least two corridors, got ${field?.corridors.length ?? 0}`);

const localY = (lat: number) => (lat - ANCHOR.lat) * 111320;
const meanY = (corridorCells: CorridorCell[]) =>
  corridorCells.reduce((s, c) => s + localY(c.center.lat), 0) / corridorCells.length;
const corridors: Corridor[] = field!.corridors;
const northCorridor = corridors.reduce((best, c) => (meanY(c.cells) < meanY(best.cells) ? c : best), corridors[0]);
const southCorridor = corridors.reduce((best, c) => (meanY(c.cells) > meanY(best.cells) ? c : best), corridors[0]);

test('test setup: north and south corridors are genuinely distinct (not the same corridor picked twice)', () => {
  assert.ok(northCorridor && southCorridor && northCorridor.id !== southCorridor.id);
});

test('the SOUTH corridor (the one crossing the mapped stream) carries a real, higher waterCrossingFraction than the clean north one', () => {
  assert.ok(southCorridor!.waterCrossingFraction > northCorridor!.waterCrossingFraction,
    `south=${southCorridor!.waterCrossingFraction}, north=${northCorridor!.waterCrossingFraction} — the ford should show up as a real hydrology signal on the corridor that actually crosses it`);
  assert.ok(southCorridor!.waterCrossingFraction > 0, 'south corridor must show SOME water crossing — this is the entire premise of the fixture');
});

test('riskScore is strictly higher for the corridor that fords the stream, all else being structurally symmetric', () => {
  assert.ok(southCorridor!.riskScore > northCorridor!.riskScore,
    `FAILED: south riskScore=${southCorridor!.riskScore.toFixed(3)} should exceed north riskScore=${northCorridor!.riskScore.toFixed(3)}`);
});

test('riskScore is a real fraction in [0, 1] for every corridor, not an unbounded or negative artefact', () => {
  for (const c of field!.corridors) {
    assert.ok(c.riskScore >= 0 && c.riskScore <= 1, `corridor ${c.id} riskScore out of range: ${c.riskScore}`);
    assert.ok(c.pinchRatio >= 0 && c.pinchRatio <= 1, `corridor ${c.id} pinchRatio out of range: ${c.pinchRatio}`);
    assert.ok(c.waterCrossingFraction >= 0 && c.waterCrossingFraction <= 1, `corridor ${c.id} waterCrossingFraction out of range: ${c.waterCrossingFraction}`);
  }
});

test('mostLikelyCorridorId is exactly the rank-1 corridor', () => {
  assert.strictEqual(field!.mostLikelyCorridorId, field!.corridors[0]!.id);
});

test('mostRiskyCorridorId is exactly the corridor with the highest riskScore among all built corridors', () => {
  const maxRisk = Math.max(...field!.corridors.map(c => c.riskScore));
  const riskiest = field!.corridors.find(c => c.riskScore === maxRisk)!;
  assert.strictEqual(field!.mostRiskyCorridorId, riskiest.id);
});

test('THE ACTUAL PLANNING VALUE: mostRiskyCorridorId points at the south (ford) corridor specifically', () => {
  assert.strictEqual(field!.mostRiskyCorridorId, southCorridor!.id);
});

// --- clusterRoutes: the exact building block mobilityLazyGrid.ts's own
// interim "do we have enough distinct corridors yet" check is built on.
console.log('clusterRoutes (the lazy-grid corridor-count check\'s own building block):');

test('two routes through genuinely different gaps cluster into TWO groups, not one', () => {
  const routes = findKDissimilarPaths(cells, originKeys, objectiveKeys, vehicle, false, 5);
  assert.ok(routes.length >= 2, 'test setup: need at least two distinct routes');
  const hexWidthM = HEX_SIZE * Math.sqrt(3);
  const clusters = clusterRoutes(routes, hexWidthM);
  assert.ok(clusters.length >= 2, `FAILED: expected >= 2 route clusters (matching >= 2 corridors), got ${clusters.length}`);
});

test('CONTROL: routes that are all trivial variants of the SAME avenue cluster into ONE group', () => {
  // Seal the south gap — only the north route exists, so every k-dissimilar
  // route the search finds must be a minor variant of the same avenue.
  const oneGapCells = cells.map(c => {
    const localX = (c.center.lng - ANCHOR.lng) * 111320;
    const localY = (c.center.lat - ANCHOR.lat) * 111320;
    const inBarrierX = localX >= BARRIER_X_MIN && localX <= BARRIER_X_MAX;
    const inNorthGap = localY >= NORTH_GAP.min && localY <= NORTH_GAP.max;
    if (inBarrierX && !inNorthGap) return { ...c, inWaterBody: true, waterDistanceM: 0, nearestWaterwayKind: null };
    return c;
  });
  const routes = findKDissimilarPaths(oneGapCells, originKeys, objectiveKeys, vehicle, false, 5);
  assert.ok(routes.length >= 1, 'test setup: at least one route must still exist via the remaining north gap');
  const hexWidthM = HEX_SIZE * Math.sqrt(3);
  const clusters = clusterRoutes(routes, hexWidthM);
  assert.strictEqual(clusters.length, 1, `FAILED: a single-avenue grid should cluster to exactly 1, got ${clusters.length}`);
});

if (process.exitCode === 1) {
  console.error(`\nSome corridor risk/count checks failed.`);
} else {
  console.log(`\nAll ${passed} corridor risk/count checks passed.`);
}
