/**
 * Targeted edge-growth (docs/ROUTE_INTELLIGENCE.md §35, 2026-07-27 — owner,
 * live-testing the real Lake George after the square-box fix: "I think we
 * need both, a large uniform box... and then the ability to extend out when
 * we hit edges... if it still hits the edge then it loads a new [area] from
 * the point of where it hit. Repeat until we get there.").
 *
 * `frontierTouchedEdges` reads back which side of a search box the
 * reachable frontier actually got to (not blocked by terrain — genuinely
 * ran out of box); `growBoundsTowardFrontier` extends specifically that
 * side for the next attempt. Plain node:assert.
 * Run: npx tsx webapp/tests/frontierEdgeGrowth.test.ts
 */
import * as assert from 'node:assert';
import { frontierTouchedEdges, growBoundsTowardFrontier, PaddedBounds } from '../src/terrain/mobilityGrid';

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

const bounds: PaddedBounds = {
  boundsSw: { lat: -35.10, lng: 149.30 },
  boundsNe: { lat: -35.00, lng: 149.40 },
};

console.log('Targeted frontier edge-growth (§35):');

test('a reachable cell near the NORTH edge marks only north as touched', () => {
  const results = [
    { center: { lat: -35.001, lng: 149.35 }, timeSeconds: 120 }, // right at the north edge
    { center: { lat: -35.05, lng: 149.35 }, timeSeconds: 60 },   // interior, not near any edge
  ];
  const edges = frontierTouchedEdges(bounds, results);
  assert.deepStrictEqual(edges, { north: true, south: false, east: false, west: false });
});

test('an UNREACHABLE cell at the edge (Infinity timeSeconds) does NOT count — terrain-blocked, not box-limited', () => {
  const results = [
    { center: { lat: -35.001, lng: 149.35 }, timeSeconds: Infinity }, // at the edge, but never reached
  ];
  const edges = frontierTouchedEdges(bounds, results);
  assert.deepStrictEqual(edges, { north: false, south: false, east: false, west: false });
});

test('multiple edges can be touched at once (e.g. a corner)', () => {
  const results = [
    { center: { lat: -35.001, lng: 149.399 }, timeSeconds: 200 }, // north-east corner
  ];
  const edges = frontierTouchedEdges(bounds, results);
  assert.deepStrictEqual(edges, { north: true, south: false, east: true, west: false });
});

test('growBoundsTowardFrontier extends ONLY the touched edge, leaving the others exactly as they were', () => {
  const edges = { north: true, south: false, east: false, west: false };
  const grown = growBoundsTowardFrontier(bounds, edges, 5000); // 5km
  assert.ok(grown.boundsNe.lat > bounds.boundsNe.lat, 'north edge must move outward');
  assert.strictEqual(grown.boundsSw.lat, bounds.boundsSw.lat, 'south edge (not touched) must stay exactly put');
  assert.strictEqual(grown.boundsSw.lng, bounds.boundsSw.lng, 'west edge (not touched) must stay exactly put');
  assert.strictEqual(grown.boundsNe.lng, bounds.boundsNe.lng, 'east edge (not touched) must stay exactly put');
});

test('growBoundsTowardFrontier grows a MEASURABLE amount proportional to growM', () => {
  const edges = { north: true, south: false, east: false, west: false };
  const grownSmall = growBoundsTowardFrontier(bounds, edges, 1000);
  const grownBig = growBoundsTowardFrontier(bounds, edges, 10000);
  const deltaSmall = grownSmall.boundsNe.lat - bounds.boundsNe.lat;
  const deltaBig = grownBig.boundsNe.lat - bounds.boundsNe.lat;
  assert.ok(deltaBig > deltaSmall * 5, `expected roughly proportional growth, got ${deltaSmall} vs ${deltaBig}`);
});

test('when NO edge was touched at all, growBoundsTowardFrontier falls back to growing every edge (a fully terrain-boxed attempt)', () => {
  const edges = { north: false, south: false, east: false, west: false };
  const grown = growBoundsTowardFrontier(bounds, edges, 5000);
  assert.ok(grown.boundsNe.lat > bounds.boundsNe.lat);
  assert.ok(grown.boundsSw.lat < bounds.boundsSw.lat);
  assert.ok(grown.boundsNe.lng > bounds.boundsNe.lng);
  assert.ok(grown.boundsSw.lng < bounds.boundsSw.lng);
});

if (process.exitCode === 1) {
  console.error(`\nSome frontier edge-growth checks failed.`);
} else {
  console.log(`\nAll ${passed} frontier edge-growth checks passed.`);
}
