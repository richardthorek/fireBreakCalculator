/**
 * Concealment (OCOKA 7, docs/ROUTE_INTELLIGENCE.md §47) — proves
 * `buildConcealmentResult`'s two independent sources and their union against
 * a small, hand-built fixture: dead ground is the exact complement of
 * `ObservationResult.screenedUnionKeys`; vegetation concealment follows the
 * SCREENING_HEIGHT_M threshold (heavyforest/mediumscrub conceal, grassland/
 * lightshrub don't); the combined set is a real union (a cell concealed by
 * BOTH sources counts once, not twice).
 *
 * Plain node:assert. Run: npx tsx webapp/tests/concealment.test.ts
 */
import * as assert from 'node:assert';
import { buildConcealmentResult } from '@firebreak/terrain';
import { ObservationResult } from '@firebreak/terrain';
import { MobilityGridCell } from '@firebreak/terrain';
import { VegetationType } from '@firebreak/terrain';

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

console.log('Concealment (OCOKA 7):');

function cell(key: string, vegetation: VegetationType): MobilityGridCell {
  return {
    key,
    hex: { q: 0, r: 0 },
    center: { lat: 0, lng: 0 },
    elevation: 0,
    vegetation,
    vegEstimated: false,
    onTrail: false,
    nearestTrailTags: null,
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
  };
}

// a: grassland, visible — concealed by neither source.
// b: grassland, NOT visible — dead ground only.
// c: heavyforest, visible — vegetation-concealed only (terrain doesn't hide it, the canopy does).
// d: heavyforest, NOT visible — BOTH sources (proves the union dedups, not double-counts).
// e: lightshrub, NOT visible — dead ground only (below the concealment height threshold).
const cells: MobilityGridCell[] = [
  cell('a', 'grassland'),
  cell('b', 'grassland'),
  cell('c', 'heavyforest'),
  cell('d', 'heavyforest'),
  cell('e', 'lightshrub'),
];

const observation: ObservationResult = {
  observers: [],
  screenedUnionKeys: new Set(['a', 'c']),
  bareEarthUnionKeys: new Set(['a', 'c']),
  corridorCoverageFraction: null,
};

const result = buildConcealmentResult(cells, observation);

test('dead ground is exactly the complement of screenedUnionKeys', () => {
  assert.deepStrictEqual([...result.deadGroundKeys].sort(), ['b', 'd', 'e']);
});

test('vegetation concealment follows the height threshold — heavyforest conceals, grassland/lightshrub don\'t', () => {
  assert.deepStrictEqual([...result.vegetationConcealedKeys].sort(), ['c', 'd']);
});

test('the combined set is a real union — a cell hidden by BOTH sources counts once, not twice', () => {
  assert.deepStrictEqual([...result.concealedKeys].sort(), ['b', 'c', 'd', 'e']);
  assert.strictEqual(result.concealedKeys.size, 4);
});

test('a visible, open cell (grassland, in the union) is concealed by neither source', () => {
  assert.ok(!result.deadGroundKeys.has('a'));
  assert.ok(!result.vegetationConcealedKeys.has('a'));
  assert.ok(!result.concealedKeys.has('a'));
});

test('cellsConsidered matches the real input size', () => {
  assert.strictEqual(result.cellsConsidered, 5);
});

test('no observers at all (empty union) makes every cell dead ground — an honest, if extreme, case', () => {
  const noObservers: ObservationResult = {
    observers: [], screenedUnionKeys: new Set(), bareEarthUnionKeys: new Set(), corridorCoverageFraction: null,
  };
  const r = buildConcealmentResult(cells, noObservers);
  assert.strictEqual(r.deadGroundKeys.size, cells.length);
});

console.log(`\n${passed} assertion group(s) passed.`);
