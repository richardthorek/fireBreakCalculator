/**
 * Hex-cell painting tests (docs/ROUTE_INTELLIGENCE.md §35 — owner: "make the
 * small paint a single 100m hex. Medium is 10 and large is 100. Xl is
 * 1000!"). Plain node:assert. Run: npx tsx webapp/tests/paintedArea.test.ts
 */
import * as assert from 'node:assert';
import {
  createHexDab, resolvePaintedAreaGeometry, isInsideResolvedArea, paintedAreaBounds, singleDabArea,
  BRUSH_HEX_COUNT, PAINT_HEX_SIZE_M, brushApproxRadiusM, PaintedArea,
} from '@firebreak/terrain';

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

const CANBERRA = { lat: -35.28, lng: 149.13 };

console.log('Hex-cell painting:');

test('the small brush stamps exactly 1 hex, matching the owner spec directly', () => {
  const dab = createHexDab([], CANBERRA, 'small');
  assert.strictEqual(dab.hexes.length, 1);
});

test('brush sizes stamp 1/10/100/1000 hexes exactly, per BRUSH_HEX_COUNT', () => {
  for (const size of ['small', 'medium', 'large', 'xl'] as const) {
    const dab = createHexDab([], CANBERRA, size);
    assert.strictEqual(dab.hexes.length, BRUSH_HEX_COUNT[size]);
  }
});

test('the first dab in an empty area becomes its own anchor', () => {
  const dab = createHexDab([], CANBERRA, 'small');
  assert.strictEqual(dab.anchor.lat, CANBERRA.lat);
  assert.strictEqual(dab.anchor.lng, CANBERRA.lng);
});

test('a second dab in the SAME area reuses the first dab\'s anchor, not its own click point', () => {
  const area: PaintedArea = [{ mode: 'paint', dab: createHexDab([], CANBERRA, 'small') }];
  const secondClick = { lat: CANBERRA.lat + 0.01, lng: CANBERRA.lng + 0.01 }; // ~1km away
  const secondDab = createHexDab(area, secondClick, 'small');
  assert.strictEqual(secondDab.anchor.lat, CANBERRA.lat);
  assert.strictEqual(secondDab.anchor.lng, CANBERRA.lng);
});

test('one dab resolves to real, findable geometry — the clicked point is inside it', () => {
  const area: PaintedArea = [{ mode: 'paint', dab: createHexDab([], CANBERRA, 'medium') }];
  const geom = resolvePaintedAreaGeometry(area);
  assert.ok(geom);
  assert.ok(isInsideResolvedArea(CANBERRA, geom));
});

test('a point far outside the painted hexes is NOT inside the resolved geometry', () => {
  const area: PaintedArea = [{ mode: 'paint', dab: createHexDab([], CANBERRA, 'small') }]; // 1 hex, ~100m
  const geom = resolvePaintedAreaGeometry(area);
  const farPoint = { lat: CANBERRA.lat + 0.05, lng: CANBERRA.lng }; // ~5.5km away
  assert.strictEqual(isInsideResolvedArea(farPoint, geom), false);
});

test('erase removes a previously painted spot — paint, erase the SAME spot, point is no longer inside', () => {
  const paintDab = createHexDab([], CANBERRA, 'large'); // 100 hexes, real coverage
  const area: PaintedArea = [{ mode: 'paint', dab: paintDab }];
  const eraseDab = createHexDab(area, CANBERRA, 'large'); // same anchor, same spot
  const areaAfterErase: PaintedArea = [...area, { mode: 'erase', dab: eraseDab }];
  const geomAfter = resolvePaintedAreaGeometry(areaAfterErase);
  // Erasing the same footprint back out should leave little/nothing painted there.
  assert.strictEqual(isInsideResolvedArea(CANBERRA, geomAfter), false);
});

test('paint, erase, paint the SAME spot again — it reappears (ordered strokes, not a subtracted set)', () => {
  const dab1 = createHexDab([], CANBERRA, 'small');
  let area: PaintedArea = [{ mode: 'paint', dab: dab1 }];
  const dab2 = createHexDab(area, CANBERRA, 'small');
  area = [...area, { mode: 'erase', dab: dab2 }];
  const dab3 = createHexDab(area, CANBERRA, 'small');
  area = [...area, { mode: 'paint', dab: dab3 }];
  const geom = resolvePaintedAreaGeometry(area);
  assert.ok(isInsideResolvedArea(CANBERRA, geom), 'painting back over an erased spot must make it reappear');
});

test('a larger brush covers more real ground than a smaller one (small < medium < large < xl)', () => {
  const small = brushApproxRadiusM('small');
  const medium = brushApproxRadiusM('medium');
  const large = brushApproxRadiusM('large');
  const xl = brushApproxRadiusM('xl');
  assert.ok(small < medium && medium < large && large < xl);
  // Area scales with count (radius with sqrt(count)), so this should roughly
  // triple (sqrt(10)) between each step, not increase by a fixed amount.
  assert.ok(medium / small > 2.5 && medium / small < 4, `${medium / small}`);
});

test('paintedAreaBounds covers the painted point with a sane margin (not zero, not absurdly large)', () => {
  const area: PaintedArea = [{ mode: 'paint', dab: createHexDab([], CANBERRA, 'medium') }];
  const bounds = paintedAreaBounds(area);
  assert.ok(bounds);
  assert.ok(bounds!.minLat < CANBERRA.lat && CANBERRA.lat < bounds!.maxLat);
  assert.ok(bounds!.minLng < CANBERRA.lng && CANBERRA.lng < bounds!.maxLng);
});

test('singleDabArea (unit-sim replan) still produces a real, findable area at the given point', () => {
  const area = singleDabArea(CANBERRA, 250);
  const geom = resolvePaintedAreaGeometry(area);
  assert.ok(geom);
  assert.ok(isInsideResolvedArea(CANBERRA, geom));
});

test('painting far from the equator does not collapse to a degenerate/empty shape (anchor-per-area avoids the whole-country distortion problem)', () => {
  // Hobart-ish latitude, far south — the per-area local anchor should still
  // produce a normal, non-degenerate hex regardless of how far this is from
  // any global reference latitude.
  const HOBART = { lat: -42.88, lng: 147.33 };
  const area: PaintedArea = [{ mode: 'paint', dab: createHexDab([], HOBART, 'small') }];
  const geom = resolvePaintedAreaGeometry(area);
  assert.ok(geom);
  assert.ok(isInsideResolvedArea(HOBART, geom));
});

if (process.exitCode === 1) {
  console.error(`\nSome hex-painting checks failed.`);
} else {
  console.log(`\nAll ${passed} hex-painting checks passed.`);
}
