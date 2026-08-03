/**
 * Hex ring/spiral tests (docs/ROUTE_INTELLIGENCE.md §35 — painting brush).
 * Plain node:assert. Run: npx tsx webapp/tests/hexRingSpiral.test.ts
 */
import * as assert from 'node:assert';
import { hexRing, hexSpiral, hexKey, AxialCoord } from '@firebreak/terrain';

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

const CENTER: AxialCoord = { q: 0, r: 0 };

console.log('Hex ring/spiral:');

test('ring 0 is just the centre', () => {
  const ring = hexRing(CENTER, 0);
  assert.strictEqual(ring.length, 1);
  assert.strictEqual(ring[0].q, 0);
  assert.strictEqual(ring[0].r, 0);
});

test('ring radius k has exactly 6k cells (standard hex-ring formula)', () => {
  for (const k of [1, 2, 3, 5, 10]) {
    const ring = hexRing(CENTER, k);
    assert.strictEqual(ring.length, 6 * k, `ring ${k} should have ${6 * k} cells, got ${ring.length}`);
  }
});

test('ring cells have no duplicates', () => {
  for (const k of [1, 2, 5]) {
    const ring = hexRing(CENTER, k);
    const keys = new Set(ring.map(hexKey));
    assert.strictEqual(keys.size, ring.length, `ring ${k} should have no duplicate cells`);
  }
});

test('every ring-k cell is genuinely k steps from centre (axial distance)', () => {
  const axialDistance = (a: AxialCoord, b: AxialCoord) => {
    const dq = a.q - b.q, dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  };
  for (const k of [1, 2, 3]) {
    for (const cell of hexRing(CENTER, k)) {
      assert.strictEqual(axialDistance(cell, CENTER), k, `${hexKey(cell)} should be exactly ${k} steps from centre`);
    }
  }
});

test('hexSpiral(1) is exactly the centre hex — the "small" brush', () => {
  const spiral = hexSpiral(CENTER, 1);
  assert.strictEqual(spiral.length, 1);
  assert.strictEqual(spiral[0].q, 0);
  assert.strictEqual(spiral[0].r, 0);
});

test('hexSpiral returns EXACTLY the requested count, even mid-ring (10, 100, 1000)', () => {
  for (const count of [1, 10, 100, 1000]) {
    const spiral = hexSpiral(CENTER, count);
    assert.strictEqual(spiral.length, count, `requested ${count}, got ${spiral.length}`);
  }
});

test('hexSpiral has no duplicate cells at any count', () => {
  for (const count of [10, 100, 1000]) {
    const spiral = hexSpiral(CENTER, count);
    const keys = new Set(spiral.map(hexKey));
    assert.strictEqual(keys.size, count, `spiral of ${count} should have ${count} distinct cells`);
  }
});

test('hexSpiral is deterministic — same inputs, same output, every time', () => {
  const a = hexSpiral(CENTER, 100).map(hexKey);
  const b = hexSpiral(CENTER, 100).map(hexKey);
  assert.deepStrictEqual(a, b);
});

test('hexSpiral centred on a non-origin hex still produces exactly `count` cells around it', () => {
  const off: AxialCoord = { q: 5, r: -3 };
  const spiral = hexSpiral(off, 10);
  assert.strictEqual(spiral.length, 10);
  assert.ok(spiral.some(c => c.q === off.q && c.r === off.r), 'the centre itself must be included');
});

if (process.exitCode === 1) {
  console.error(`\nSome hex-ring/spiral checks failed.`);
} else {
  console.log(`\nAll ${passed} hex-ring/spiral checks passed.`);
}
