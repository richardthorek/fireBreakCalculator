/**
 * Corridor segmentation must not merge genuinely distinct avenues of
 * approach just because they share an origin/objective (docs
 * ROUTE_INTELLIGENCE.md §28 addendum, 2026-07-27). Owner, live-testing a
 * real west<->east Lake George crossing with visibly distinct east-shore
 * and west-shore detour tracks on the map: "it only generated 1 corridor,
 * we need two minimum... consider how corridors and alternative pathways
 * are explored and identified."
 *
 * ROOT CAUSE: every route between the SAME origin and objective necessarily
 * shares cells at both ends. The old segmentation connected any two
 * geometrically-adjacent high-density cells regardless of which route put
 * them there, so the west-shore and east-shore detours were always found
 * "connected" through their shared endpoints and collapsed into one
 * component — reproducible on ANY compact origin/objective pair with two
 * real detours, not an edge case.
 *
 * This test builds a synthetic barrier with TWO gaps (north and south) wide
 * apart, so two genuinely distinct detours exist, and proves
 * `buildCorridorField` reports (at least) two SPATIALLY DISTINCT corridors,
 * not one merged blob.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/corridorClustering.test.ts
 */
import * as assert from 'node:assert';
import { generateBoxHexes, hexKey, LocalPoint } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { MOVER_PROFILES } from '../src/terrain/moverProfiles';
import { makeProjection } from '../src/utils/hexGrid';
import { buildCorridorField } from '../src/terrain/corridorField';
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
assert.ok(foot && foot.fordingDepthM === undefined);

const HEX_SIZE = 30;
const ANCHOR: LatLng = { lat: -35.28, lng: 149.13 };
const proj = makeProjection(ANCHOR);

// Barrier strip in the middle third of the box (x = 480..620), with TWO
// gaps: one near the top (y = 0..80) and one near the bottom (y = 520..600)
// — wide apart, so a real west<->east crosser must pick EITHER the north
// route OR the south route, never both at once, exactly like two shores of
// a lake.
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

console.log('Corridor clustering — distinct avenues stay distinct (§28 addendum):');

const cells = buildGrid();
// Compact origin/objective near the vertical MIDDLE of the box — a due-east
// crossing (like the real Lake George report), forcing any route to detour
// through EITHER the north or south gap, never straight across.
const originKeys = cells
  .filter(c => c.center.lng < ANCHOR.lng + 60 / 111320 && Math.abs((c.center.lat - ANCHOR.lat) * 111320 - 300) < 60)
  .map(c => c.key);
const objectiveKeys = cells
  .filter(c => c.center.lng > ANCHOR.lng + 1040 / 111320 && Math.abs((c.center.lat - ANCHOR.lat) * 111320 - 300) < 60)
  .map(c => c.key);

test('test setup: origin and objective seed sets are non-empty and sit at the SAME (middle) latitude', () => {
  assert.ok(originKeys.length > 0, 'origin seed set must be non-empty');
  assert.ok(objectiveKeys.length > 0, 'objective seed set must be non-empty');
});

const field = buildCorridorField(cells, originKeys, objectiveKeys, foot, false, HEX_SIZE, proj, { routeCount: 14 });

test('a compact origin/objective pair with two real detours produces AT LEAST TWO corridors, not one merged blob', () => {
  assert.ok(field, 'FAILED: no corridor field was built at all');
  assert.ok(field!.corridors.length >= 2,
    `FAILED: only ${field?.corridors.length ?? 0} corridor(s) found — this is the exact live-reported regression (owner: "it only generated 1 corridor, we need two minimum")`);
});

test('the two busiest corridors are SPATIALLY DISTINCT — one genuinely north, one genuinely south, not the same band counted twice', () => {
  const [first, second] = field!.corridors;
  assert.ok(first && second, 'need at least two corridors for this check');
  const localY = (lat: number) => (lat - ANCHOR.lat) * 111320;
  const meanY = (corridorCells: typeof first.cells) =>
    corridorCells.reduce((s, c) => s + localY(c.center.lat), 0) / corridorCells.length;
  const firstMeanY = meanY(first.cells);
  const secondMeanY = meanY(second.cells);
  // The gaps are centred at y~45 (north) and y~555 (south) — the box's own
  // middle is y~300. Two GENUINELY distinct corridors should have mean
  // y-positions on OPPOSITE sides of that middle, not clustered together.
  assert.ok((firstMeanY - 300) * (secondMeanY - 300) < 0,
    `expected corridors on opposite sides of the middle (y=300); got means ${firstMeanY.toFixed(0)} and ${secondMeanY.toFixed(0)}`);

  // And they should not just be the identical cell set reported twice.
  const firstKeys = new Set(first.cells.map(c => c.key));
  const overlap = second.cells.filter(c => firstKeys.has(c.key)).length;
  const overlapFraction = overlap / Math.min(first.cells.length, second.cells.length);
  assert.ok(overlapFraction < 0.3,
    `corridors overlap too much to be genuinely distinct (${(overlapFraction * 100).toFixed(0)}% shared cells)`);
});

test('CONTROL: sealing one gap collapses the field back down toward a single corridor', () => {
  const cellsOneGap = buildGrid().map(c => {
    // Seal the south gap too — only the north route now exists.
    const localX = (c.center.lng - ANCHOR.lng) * 111320;
    const localY = (c.center.lat - ANCHOR.lat) * 111320;
    const inBarrierX = localX >= BARRIER_X_MIN && localX <= BARRIER_X_MAX;
    const inNorthGap = localY >= NORTH_GAP.min && localY <= NORTH_GAP.max;
    if (inBarrierX && !inNorthGap) return { ...c, inWaterBody: true, waterDistanceM: 0 };
    return c;
  });
  const controlField = buildCorridorField(cellsOneGap, originKeys, objectiveKeys, foot, false, HEX_SIZE, proj, { routeCount: 14 });
  assert.ok(controlField, 'a route must still exist via the remaining north gap');
  // With only one real detour, the routes should cluster back into ONE
  // primary corridor (small numeric variations from the search may still
  // produce a tiny second sliver, but it must not look like two co-equal
  // avenues the way the two-gap case does).
  assert.ok(controlField!.corridors.length <= 2,
    `expected the single-detour control to stay close to one corridor, got ${controlField!.corridors.length}`);
});

if (process.exitCode === 1) {
  console.error(`\nCorridor clustering did NOT hold.`);
} else {
  console.log(`\nAll ${passed} corridor clustering checks passed.`);
}
