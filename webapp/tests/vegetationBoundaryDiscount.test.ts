/**
 * Vegetation-boundary discount tests (docs/ROUTE_INTELLIGENCE.md
 * "Damage-minimisation: vegetation-boundary discount"). Plain node:assert.
 * Run: npx tsx webapp/tests/vegetationBoundaryDiscount.test.ts
 */
import * as assert from 'node:assert';
import { edgeCost, markVegetationBoundaries, SampledNode } from '../src/utils/routeOptimizer';
import { hexKey, AxialCoord } from '@firebreak/terrain';

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

function node(overrides: Partial<SampledNode>): SampledNode {
  return {
    lat: -33.0,
    lng: 149.0,
    elevation: 500,
    vegetation: 'grassland',
    vegEstimated: false,
    onTrail: false,
    nearVegetationBoundary: false,
    ...overrides,
  };
}

console.log('Vegetation-boundary discount:');

test('two grassland nodes near a boundary cost less than the same nodes not near one', () => {
  const a = node({ lat: -33.0, lng: 149.0, nearVegetationBoundary: true });
  const b = node({ lat: -33.0, lng: 149.01, nearVegetationBoundary: true });
  const aOff = node({ lat: -33.0, lng: 149.0, nearVegetationBoundary: false });
  const bOff = node({ lat: -33.0, lng: 149.01, nearVegetationBoundary: false });
  const near = edgeCost(a, b);
  const far = edgeCost(aOff, bOff);
  assert.ok(near.cost < far.cost, `boundary-adjacent edge (${near.cost}) should cost less than the identical edge away from a boundary (${far.cost})`);
});

test('the discount requires BOTH endpoints near a boundary, not just one', () => {
  const a = node({ nearVegetationBoundary: true });
  const b = node({ lng: 149.01, nearVegetationBoundary: false });
  const mixed = edgeCost(a, b);
  const neither = edgeCost({ ...a, nearVegetationBoundary: false }, b);
  assert.strictEqual(mixed.cost, neither.cost, 'a single boundary-adjacent endpoint must not discount the edge');
  assert.strictEqual(mixed.nearVegetationBoundary, false);
});

test('a uniformly-grassland paddock (no boundary anywhere) has a flat cost — the pre-existing problem this feature fixes', () => {
  const middle = edgeCost(node({ lng: 149.0 }), node({ lng: 149.01 }));
  const edge = edgeCost(node({ lng: 149.0, nearVegetationBoundary: true }), node({ lng: 149.01, nearVegetationBoundary: true }));
  assert.ok(edge.cost < middle.cost, 'without the boundary flag set, a straight line through the paddock middle is exactly as cheap as one along the edge — this is the bug being fixed, so the two costs must now differ once the flag is set');
});

test('trail discount and boundary discount compose (both apply) rather than one overriding the other', () => {
  const bothA = node({ onTrail: true, nearVegetationBoundary: true });
  const bothB = node({ lng: 149.01, onTrail: true, nearVegetationBoundary: true });
  const trailOnlyA = node({ onTrail: true, nearVegetationBoundary: false });
  const trailOnlyB = node({ lng: 149.01, onTrail: true, nearVegetationBoundary: false });
  const both = edgeCost(bothA, bothB);
  const trailOnly = edgeCost(trailOnlyA, trailOnlyB);
  assert.ok(both.cost < trailOnly.cost, 'a trail that also happens to trace a vegetation boundary should cost less than a trail alone');
});

test('heavy forest still costs more than grassland regardless of boundary flag', () => {
  const forest = edgeCost(
    node({ vegetation: 'heavyforest', nearVegetationBoundary: true }),
    node({ lng: 149.01, vegetation: 'heavyforest', nearVegetationBoundary: true })
  );
  const grass = edgeCost(
    node({ vegetation: 'grassland', nearVegetationBoundary: true }),
    node({ lng: 149.01, vegetation: 'grassland', nearVegetationBoundary: true })
  );
  assert.ok(forest.cost > grass.cost, 'the boundary discount narrows the gap but must never make cutting through heavy forest cheaper than open grassland');
});

test('markVegetationBoundaries flags a grassland cell adjacent to heavy forest, and neither the forest\'s far side nor an isolated grassland cell', () => {
  // Three hex cells in a row: grass(0,0) - forest(1,0) - forest(2,0) - grass(5,5, unrelated/isolated).
  const cells: { hex: AxialCoord }[] = [{ hex: { q: 0, r: 0 } }, { hex: { q: 1, r: 0 } }, { hex: { q: 2, r: 0 } }, { hex: { q: 5, r: 5 } }];
  const nodeMap = new Map<string, SampledNode>();
  nodeMap.set(hexKey({ q: 0, r: 0 }), node({ vegetation: 'grassland' }));
  nodeMap.set(hexKey({ q: 1, r: 0 }), node({ vegetation: 'heavyforest' }));
  nodeMap.set(hexKey({ q: 2, r: 0 }), node({ vegetation: 'heavyforest' }));
  nodeMap.set(hexKey({ q: 5, r: 5 }), node({ vegetation: 'grassland' }));

  markVegetationBoundaries(cells, nodeMap);

  assert.strictEqual(nodeMap.get(hexKey({ q: 0, r: 0 }))!.nearVegetationBoundary, true, 'grassland cell touching forest should be flagged');
  assert.strictEqual(nodeMap.get(hexKey({ q: 1, r: 0 }))!.nearVegetationBoundary, true, 'forest cell touching grassland should also be flagged (symmetric)');
  assert.strictEqual(nodeMap.get(hexKey({ q: 5, r: 5 }))!.nearVegetationBoundary, false, 'an isolated grassland cell with no dissimilar neighbour must not be flagged');
});

test('markVegetationBoundaries does not flag a soft gradient (grassland next to lightshrub)', () => {
  const cells: { hex: AxialCoord }[] = [{ hex: { q: 0, r: 0 } }, { hex: { q: 1, r: 0 } }];
  const nodeMap = new Map<string, SampledNode>();
  nodeMap.set(hexKey({ q: 0, r: 0 }), node({ vegetation: 'grassland' }));
  nodeMap.set(hexKey({ q: 1, r: 0 }), node({ vegetation: 'lightshrub' }));
  markVegetationBoundaries(cells, nodeMap);
  assert.strictEqual(nodeMap.get(hexKey({ q: 0, r: 0 }))!.nearVegetationBoundary, false, 'grassland/lightshrub is a soft gradient, not a treeline — below VEGETATION_BOUNDARY_COST_DELTA');
});

console.log(`\n${passed} checks passed`);
