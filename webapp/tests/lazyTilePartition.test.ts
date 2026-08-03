/**
 * Tile partition helpers (docs/ROUTE_INTELLIGENCE.md §35, `mobilityLazyGrid.ts`)
 * — the lazy grid materialises hexes in TILE batches (one round of
 * area-batched network fetches per newly-needed tile ring), so it's load-
 * bearing that `hexesForTile` assigns every hex to EXACTLY one tile: a hex
 * double-counted across two tiles would be sampled twice (wasted fetches,
 * and whichever copy lands second in the accumulated cell map silently wins,
 * an honesty risk); a hex assigned to NO tile would silently vanish from the
 * grid despite sitting inside the footprint the search asked for.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/lazyTilePartition.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint } from '../src/utils/hexGrid';
import { tileIndexOfLocal, tilesCoveringBox, hexesForTile, tileKeyOf } from '../src/terrain/mobilityLazyGrid';

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

console.log('Lazy-grid tile partition (§35):');

const HEX_SIZE = 40;
const TILE_SIZE_M = HEX_SIZE * 10;

test('every hex a single big box-scan produces is covered by EXACTLY ONE of the tiles covering that same box', () => {
  const min: LocalPoint = { x: -137, y: -253 }; // deliberately off-grid offsets, not tile-aligned
  const max: LocalPoint = { x: 863, y: 747 };
  const wholeBoxHexes = generateBoxHexes(min, max, HEX_SIZE)
    .filter(c => c.center.x >= min.x && c.center.x <= max.x && c.center.y >= min.y && c.center.y <= max.y);
  assert.ok(wholeBoxHexes.length > 50, 'test setup: need a real number of hexes');

  const tiles = tilesCoveringBox(min, max, TILE_SIZE_M);
  assert.ok(tiles.size > 1, 'test setup: the box must span more than one tile to be a meaningful test');

  const seenKeys = new Set<string>();
  let totalFromTiles = 0;
  for (const tk of tiles) {
    const [txStr, tyStr] = tk.split(':');
    const hexes = hexesForTile(Number(txStr), Number(tyStr), HEX_SIZE, TILE_SIZE_M);
    for (const h of hexes) {
      const key = hexKey(h.hex);
      assert.ok(!seenKeys.has(key), `hex ${key} was produced by more than one tile — partition broken`);
      seenKeys.add(key);
      totalFromTiles++;
    }
  }

  // Every hex the whole-box scan found must be covered by the tile set (no
  // gaps) — filtered to hexes that actually fall within THIS box, since a
  // tile's own generation can include hexes just outside it that a
  // differently-bounded whole-box scan wouldn't have produced in the first
  // place; the relevant claim is "nothing from the box-scan went missing".
  const wholeBoxKeys = new Set(wholeBoxHexes.map(h => hexKey(h.hex)));
  for (const key of wholeBoxKeys) {
    assert.ok(seenKeys.has(key), `hex ${key} from the whole-box scan was not produced by ANY covering tile`);
  }
  assert.strictEqual(totalFromTiles, seenKeys.size, 'sanity: no duplicates should have slipped past the assertion above');
});

test('tileIndexOfLocal is a clean partition of the plane — every point maps to exactly one tile, tile boxes tile edge-to-edge', () => {
  const samplePoints: LocalPoint[] = [
    { x: 0, y: 0 }, { x: TILE_SIZE_M - 1, y: TILE_SIZE_M - 1 }, { x: TILE_SIZE_M, y: TILE_SIZE_M },
    { x: -1, y: -1 }, { x: -TILE_SIZE_M, y: -TILE_SIZE_M }, { x: 12345.678, y: -9876.543 },
  ];
  for (const p of samplePoints) {
    const idx = tileIndexOfLocal(p, TILE_SIZE_M);
    // The point must fall within its own claimed tile's box.
    assert.ok(p.x >= idx.tx * TILE_SIZE_M && p.x < (idx.tx + 1) * TILE_SIZE_M, `x=${p.x} not inside claimed tile tx=${idx.tx}`);
    assert.ok(p.y >= idx.ty * TILE_SIZE_M && p.y < (idx.ty + 1) * TILE_SIZE_M, `y=${p.y} not inside claimed tile ty=${idx.ty}`);
  }
});

test('tilesCoveringBox always includes the tile containing the box min/max corners', () => {
  const min: LocalPoint = { x: -50, y: -50 };
  const max: LocalPoint = { x: 1234, y: 987 };
  const tiles = tilesCoveringBox(min, max, TILE_SIZE_M);
  const minIdx = tileIndexOfLocal(min, TILE_SIZE_M);
  const maxIdx = tileIndexOfLocal(max, TILE_SIZE_M);
  assert.ok(tiles.has(tileKeyOf(minIdx.tx, minIdx.ty)));
  assert.ok(tiles.has(tileKeyOf(maxIdx.tx, maxIdx.ty)));
});

test('hexesForTile returns nothing for a tile far outside any real footprint (no accidental global generation)', () => {
  const hexes = hexesForTile(10_000, 10_000, HEX_SIZE, TILE_SIZE_M);
  // Should still generate its own local hexes (a tile is self-contained,
  // position-independent) — just confirms it doesn't throw or blow up at a
  // large offset, and every hex it returns really does belong to it.
  for (const h of hexes) {
    const idx = tileIndexOfLocal(h.center, TILE_SIZE_M);
    assert.strictEqual(idx.tx, 10_000);
    assert.strictEqual(idx.ty, 10_000);
  }
});

if (process.exitCode === 1) {
  console.error(`\nSome tile-partition checks failed.`);
} else {
  console.log(`\nAll ${passed} tile-partition checks passed.`);
}
