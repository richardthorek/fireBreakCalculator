/**
 * Full OSM water-relation topology (docs/ROUTE_INTELLIGENCE.md §35 addendum,
 * 2026-07-28) — the stated scope cut from step 31 ("OSM water relations"):
 * a multi-part outer ring split across several way members was never
 * re-stitched, and island/inner members were simply excluded rather than
 * subtracted as real holes.
 *
 * Reading `distanceToNearestWater`'s OLD code closely (not just the doc
 * comment) surfaced a sharper finding than "islands over-block": an
 * UNCLOSED fragment (exactly what a multi-member outer ring's own pieces
 * usually are) was SKIPPED ENTIRELY by the point-in-polygon interior test —
 * so a point deep in the middle of a large multi-fragment lake, far from
 * any single fragment's own edge, was NOT reliably detected as water at
 * all. That is an UNDER-detection risk for a hard-block hydrology gate,
 * the opposite of the documented "safe direction to be wrong in".
 *
 * This proves, end to end through the PUBLIC `fetchCorridorWaterways` /
 * `distanceToNearestWater` API (global `fetch` stubbed, no real network —
 * same discipline as `waterRelations.test.ts`, which this extends):
 *  1. A multi-fragment outer ring (three way members, endpoints matching)
 *     stitches into ONE closed ring, and a point in the middle of the
 *     assembled shape — far from any individual fragment's own edge —
 *     correctly reads as water. THE fix.
 *  2. A real island (closed inner ring) is subtracted as a hole: a point on
 *     the island reads as NOT water; a point in the surrounding lake still
 *     does.
 *  3. Two disjoint outer rings in one relation each get only THEIR OWN
 *     island's hole — not cross-assigned.
 *  4. A genuinely unstitchable fragment (no matching endpoint) degrades to
 *     the same safe edge-only behaviour the old code gave EVERY fragment —
 *     no crash, no fabricated closure.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/waterRelationTopology.test.ts
 */
import * as assert from 'node:assert';
(globalThis as any).window = (globalThis as any).window ?? globalThis;
import { fetchCorridorWaterways, _clearInfrastructureCache, distanceToNearestWater } from '../src/utils/infrastructureService';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

function stubFetch(overpassBody: any): typeof fetch {
  return (async (url: any) => {
    const u = String(url);
    if (u.startsWith('/api') || u.includes('/api/infrastructure')) {
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }
    return { ok: true, status: 200, json: async () => overpassBody } as any;
  }) as unknown as typeof fetch;
}

console.log('Full OSM water-relation topology — multipolygon reassembly (§35 addendum):');

// A 2km-ish square lake, outer ring deliberately split into THREE way
// members whose endpoints chain together (a common real-world OSM pattern
// for a large lake mapped by several editors/imports).
const sw = { lat: -35.00, lon: 149.00 };
const se = { lat: -35.00, lon: 149.02 };
const ne = { lat: -34.98, lon: 149.02 };
const nw = { lat: -34.98, lon: 149.00 };
const outerFragmentA = [sw, se]; // south edge
const outerFragmentB = [se, ne]; // east edge
const outerFragmentC = [ne, nw, sw]; // north + west edges, closing back to sw

// The centre of the lake — genuinely far from any ONE fragment's own edge
// (each fragment is a single side of the square), so only a correctly
// STITCHED, fully-closed ring's interior test can find it.
const lakeCentre = { lat: -34.99, lng: 149.01 };

// A real island, well inside the lake, with its own closed inner ring — a
// simple square so its centre is unambiguously interior, not sitting on an
// edge/diagonal (a triangle's centroid can land exactly on the hypotenuse,
// which is a degenerate, boundary-dependent case for ray-casting — worth
// avoiding in a fixture that's supposed to give an unambiguous answer).
const islandSw = { lat: -34.991, lon: 149.008 };
const islandSe = { lat: -34.991, lon: 149.012 };
const islandNe = { lat: -34.989, lon: 149.012 };
const islandNw = { lat: -34.989, lon: 149.008 };
const islandRing = [islandSw, islandSe, islandNe, islandNw, islandSw]; // closed (first === last)
const islandCentre = { lat: -34.99, lng: 149.01 };

await test('a THREE-FRAGMENT outer ring stitches into one closed ring — a point at its centre (far from every individual fragment edge) reads as water', async () => {
  _clearInfrastructureCache();
  const body = {
    elements: [{
      type: 'relation',
      tags: { natural: 'water', name: 'Split-Ring Lake' },
      members: [
        { type: 'way', role: 'outer', geometry: outerFragmentA },
        { type: 'way', role: 'outer', geometry: outerFragmentB },
        { type: 'way', role: 'outer', geometry: outerFragmentC },
      ],
    }],
  };
  (globalThis as any).fetch = stubFetch(body);
  const result = await fetchCorridorWaterways(-35.1, 148.9, -34.8, 149.2);
  assert.ok(result.available && result.trails.length > 0, 'expected a stitched water trail');
  const dist = distanceToNearestWater(lakeCentre, result.trails);
  assert.strictEqual(dist, 0, `FAILED: lake centre should read as water (dist=0), got ${dist} — the multi-fragment outer ring did not stitch closed`);
});

await test('a real island (closed inner ring) is subtracted as a hole: island centre is NOT water, lake around it still is', async () => {
  _clearInfrastructureCache();
  const body = {
    elements: [{
      type: 'relation',
      tags: { natural: 'water', name: 'Lake With Island' },
      members: [
        { type: 'way', role: 'outer', geometry: [sw, se, ne, nw, sw] },
        { type: 'way', role: 'inner', geometry: islandRing },
      ],
    }],
  };
  (globalThis as any).fetch = stubFetch(body);
  const result = await fetchCorridorWaterways(-35.1, 148.9, -34.8, 149.2);
  const trail = result.trails.find(t => t.kind === 'water');
  assert.ok(trail, 'expected a water trail');
  assert.ok(trail!.holes && trail!.holes.length === 1, 'FAILED: expected exactly one hole ring attached to the outer trail');

  const islandDist = distanceToNearestWater(islandCentre, result.trails);
  assert.ok(islandDist > 0, `FAILED: a point on the island should NOT read as water (dist=0), got ${islandDist}`);

  const shoreNearOutsideEdge = { lat: -34.981, lng: 149.001 }; // just inside the outer ring, well away from the island
  const shoreDist = distanceToNearestWater(shoreNearOutsideEdge, result.trails);
  assert.strictEqual(shoreDist, 0, 'the rest of the lake (away from the island) must still read as water');
});

await test('two disjoint outer rings each get only their OWN island as a hole — never cross-assigned', async () => {
  _clearInfrastructureCache();
  // A second, entirely separate lake far to the east, with its own island.
  const sw2 = { lat: -35.00, lon: 150.00 };
  const se2 = { lat: -35.00, lon: 150.02 };
  const ne2 = { lat: -34.98, lon: 150.02 };
  const nw2 = { lat: -34.98, lon: 150.00 };
  const island2 = [
    { lat: -34.991, lon: 150.008 }, { lat: -34.991, lon: 150.012 }, { lat: -34.989, lon: 150.012 }, { lat: -34.991, lon: 150.008 },
  ];
  const body = {
    elements: [{
      type: 'relation',
      tags: { natural: 'water', name: 'Two Lakes' },
      members: [
        { type: 'way', role: 'outer', geometry: [sw, se, ne, nw, sw] },
        { type: 'way', role: 'inner', geometry: islandRing },
        { type: 'way', role: 'outer', geometry: [sw2, se2, ne2, nw2, sw2] },
        { type: 'way', role: 'inner', geometry: island2 },
      ],
    }],
  };
  (globalThis as any).fetch = stubFetch(body);
  const result = await fetchCorridorWaterways(-35.1, 148.9, -34.8, 150.2);
  const waterTrails = result.trails.filter(t => t.kind === 'water');
  assert.strictEqual(waterTrails.length, 2, `expected exactly 2 stitched outer rings, got ${waterTrails.length}`);
  for (const t of waterTrails) {
    assert.strictEqual(t.holes?.length ?? 0, 1, `FAILED: each lake should have exactly its own 1 island, got ${t.holes?.length ?? 0} on "${t.name}"`);
  }

  // The FIRST lake's island must NOT be treated as a hole of the SECOND lake
  // (which would wrongly make lake-2's own centre read as land near there —
  // not directly testable without lake-2's own centre, so instead check
  // structurally: lake-2's hole ring must be island2's ring, not islandRing).
  const lake2 = waterTrails.find(t => Math.abs(t.coords[0].lng - sw2.lon) < 1e-6);
  assert.ok(lake2, 'expected to find the second lake by its own coordinates');
  const holeLng = lake2!.holes![0][0].lng;
  assert.ok(Math.abs(holeLng - island2[0].lon) < 1e-6, 'FAILED: lake 2 got the WRONG island as its hole (cross-assigned)');
});

await test('an unstitchable outer fragment (no matching endpoint) degrades safely to an edge-only feature — no crash, no fabricated closure', async () => {
  _clearInfrastructureCache();
  const danglingFragment = [{ lat: -35.20, lon: 149.30 }, { lat: -35.19, lon: 149.31 }]; // matches nothing
  const body = {
    elements: [{
      type: 'relation',
      tags: { natural: 'water', name: 'Broken Relation' },
      members: [{ type: 'way', role: 'outer', geometry: danglingFragment }],
    }],
  };
  (globalThis as any).fetch = stubFetch(body);
  const result = await fetchCorridorWaterways(-35.3, 149.2, -35.1, 149.4);
  assert.strictEqual(result.trails.length, 1, 'the dangling fragment should still surface as ONE edge feature');
  assert.strictEqual(result.trails[0].holes, undefined, 'an open, unstitched fragment must never carry holes');
  // Must not crash on a subsequent distance query against it.
  const d = distanceToNearestWater({ lat: -35.195, lng: 149.305 }, result.trails);
  assert.ok(Number.isFinite(d) || d === Infinity);
});

if (process.exitCode === 1) {
  console.error(`\nFull water-relation topology is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} water-relation topology checks passed.`);
}
