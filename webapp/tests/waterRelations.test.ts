/**
 * OSM water RELATIONS (docs/ROUTE_INTELLIGENCE.md §35 addendum, 2026-07-28)
 * — a real, live-confirmed gap: multipolygon water bodies come back from
 * Overpass as `relation` elements, not `way`. `fetchCorridorWaterways`
 * previously only ever requested/parsed `way`, so a lake mapped as a
 * relation was invisible to the hydrology gate entirely — the SAME failure
 * class as the Lake George road-crossing bug fixed earlier in this pass,
 * for the hex-grid water gate instead of the road graph.
 *
 * Confirmed live via Overpass while building this fix: Lake Tuggeranong and
 * Gungahlin Pond — both in the same Canberra region this project's own test
 * scenarios (Lake George, M23, Sutton, Bywong) already live in — are BOTH
 * mapped as `relation`, not `way`. A real risk for any demo covering that
 * area, not a hypothetical.
 *
 * This proves, end to end through the PUBLIC `fetchCorridorWaterways` API
 * (global `fetch` stubbed, no real network — same discipline as the API
 * package's own `infrastructure.test.ts`, which this mirrors):
 *  1. The query sent now actually asks for `relation["natural"="water"]`.
 *  2. A relation's `outer`-role members become real water-body
 *     `InfrastructureTrail`s; `inner` (island) members are excluded.
 *  3. The resulting trail correctly gates a hex-grid crossing via
 *     `distanceToNearestWater` — the exact function the search's own
 *     `inWaterBody` classification calls — closing the loop from "the
 *     query returns it" to "the search actually sees it".
 *
 * Plain node:assert. Run: npx tsx webapp/tests/waterRelations.test.ts
 */
import * as assert from 'node:assert';
// infrastructureService.ts calls `window.setTimeout`/`clearTimeout` for the
// per-attempt fetch timeout — a real browser global, not a Vite-only one
// (unlike the `import.meta.env` guard other terrain modules needed). A
// plain Node polyfill is enough to exercise it under `tsx`; nothing in the
// module itself changes.
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

console.log('OSM water relations (§35 addendum — the same gap class as the Lake George road fix):');

// A realistic Overpass 'out geom' response for a relation query: the
// relation carries its own tags, and EACH MEMBER carries its own inline
// node geometry (confirmed live — no separate recursion/`>` query needed).
const relationBody = {
  elements: [
    {
      type: 'relation',
      tags: { natural: 'water', name: 'Lake Testown' },
      members: [
        { type: 'way', role: 'outer', geometry: [
          { lat: -35.00, lon: 149.00 }, { lat: -35.00, lon: 149.10 },
          { lat: -34.90, lon: 149.10 }, { lat: -34.90, lon: 149.00 },
          { lat: -35.00, lon: 149.00 },
        ] },
        { type: 'way', role: 'inner', geometry: [
          { lat: -34.97, lon: 149.04 }, { lat: -34.97, lon: 149.05 }, { lat: -34.96, lon: 149.04 },
        ] },
      ],
    },
  ],
};

let lastDirectQueryBody = '';
function stubFetch(overpassBody: any): typeof fetch {
  return (async (url: any, init?: any) => {
    const u = String(url);
    if (u.startsWith('/api') || u.includes('/api/infrastructure')) {
      // Proxy not deployed in this test environment — 404 so the client
      // falls through to the direct Overpass endpoints, which is the code
      // path actually being tested here.
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }
    lastDirectQueryBody = typeof init?.body === 'string' ? decodeURIComponent(init.body) : '';
    return { ok: true, status: 200, json: async () => overpassBody } as any;
  }) as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;

await test("fetchCorridorWaterways' query now requests relation[natural=water]", async () => {
  _clearInfrastructureCache();
  (globalThis as any).fetch = stubFetch(relationBody);
  await fetchCorridorWaterways(-35.1, 148.9, -34.8, 149.2);
  assert.ok(lastDirectQueryBody.includes('relation["natural"="water"]'),
    `FAILED: query did not request water relations — got: ${lastDirectQueryBody}`);
});

await test('a relation\'s outer member becomes a real water trail; the inner (island) member does not', async () => {
  _clearInfrastructureCache();
  (globalThis as any).fetch = stubFetch(relationBody);
  const result = await fetchCorridorWaterways(-35.1, 148.9, -34.8, 149.2);
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.trails.length, 1, `FAILED: expected exactly 1 trail (the outer ring only), got ${result.trails.length}`);
  assert.strictEqual(result.trails[0].kind, 'water');
  assert.strictEqual(result.trails[0].name, 'Lake Testown');
  assert.strictEqual(result.trails[0].coords.length, 5);
});

await test('the parsed relation trail correctly gates a point via distanceToNearestWater — the SAME function the hex-grid search uses', async () => {
  _clearInfrastructureCache();
  (globalThis as any).fetch = stubFetch(relationBody);
  const result = await fetchCorridorWaterways(-35.1, 148.9, -34.8, 149.2);

  const centreOfLake = { lat: -34.95, lng: 149.05 }; // well inside the outer ring
  const farAway = { lat: -30.0, lng: 140.0 };

  assert.strictEqual(distanceToNearestWater(centreOfLake, result.trails), 0,
    'FAILED: a point inside the relation-derived water body should read as water (distance 0)');
  assert.notStrictEqual(distanceToNearestWater(farAway, result.trails), 0,
    'FAILED: a point far from the water body should not read as water');
});

await test('a way-tagged water body still works exactly as before (regression guard — relations are additive, not a replacement)', async () => {
  _clearInfrastructureCache();
  (globalThis as any).fetch = stubFetch({
    elements: [{
      type: 'way',
      tags: { natural: 'water', name: 'Plain Old Pond' },
      geometry: [
        { lat: -35.00, lon: 149.00 }, { lat: -35.00, lon: 149.01 },
        { lat: -34.99, lon: 149.01 }, { lat: -35.00, lon: 149.00 },
      ],
    }],
  });
  const result = await fetchCorridorWaterways(-35.1, 148.9, -34.8, 149.2);
  assert.strictEqual(result.trails.length, 1);
  assert.strictEqual(result.trails[0].name, 'Plain Old Pond');
});

(globalThis as any).fetch = originalFetch;

if (process.exitCode === 1) {
  console.error(`\nOSM water relations did NOT hold.`);
} else {
  console.log(`\nAll ${passed} OSM water relation checks passed.`);
}
