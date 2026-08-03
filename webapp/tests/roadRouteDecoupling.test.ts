/**
 * Road-route decoupling (docs §38's stated remainder, closed 2026-07-28) —
 * owner: pick something that "improves confidence or accuracy... and
 * visually sells it." The box-free vehicle road route never actually
 * depended on the hex-grid retry loop, only on the road-network fetch, but
 * was computed AFTER the whole grid/search pipeline settled purely because
 * of where the code sat. `findEarlyVehicleRoadRoutePreview` (roadRouteSearch.ts)
 * fetches for the SAME first-attempt bounding box `mobilityAppreciation.ts`'s
 * retry loop will also request, so a real road route can appear on the map
 * seconds in rather than tens of seconds in.
 *
 * Global `fetch` stubbed, no real network — same discipline as
 * `waterRelations.test.ts`, which this borrows its stub pattern from.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/roadRouteDecoupling.test.ts
 */
import * as assert from 'node:assert';
// infrastructureService.ts calls window.setTimeout/clearTimeout for the
// per-attempt fetch timeout — see waterRelations.test.ts's identical polyfill.
(globalThis as any).window = (globalThis as any).window ?? globalThis;
import { findEarlyVehicleRoadRoutePreview } from '../src/terrain/roadRouteSearch';
import { computePaddedBounds } from '../src/terrain/mobilityGrid';
import { _clearInfrastructureCache } from '../src/utils/infrastructureService';
import { singleDabArea, paintedAreaBounds } from '@firebreak/terrain';
import { MOVER_PROFILES } from '@firebreak/terrain';

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

console.log('Road-route decoupling — early vehicle road route preview (docs §38):');

const vehicle = MOVER_PROFILES.find(p => p.id === 'au-light-4wd')!;
const foot = MOVER_PROFILES.find(p => p.speedModel === 'irmischer-clarke-offpath')!;
assert.ok(vehicle && foot);

// Same style synthetic network as roadRouteSearch.test.ts: two local roads
// joined by a connector, requiring a genuine detour.
const westOrigin = { lat: -35.05, lng: 149.30 };
const westNorth = { lat: -35.00, lng: 149.31 };
const eastObjective = { lat: -35.05, lng: 149.55 };
const eastNorth = { lat: -35.00, lng: 149.54 };
const connectorNW = { lat: -34.85, lng: 149.31 };
const connectorNE = { lat: -34.85, lng: 149.54 };

const overpassBody = {
  elements: [
    { type: 'way', tags: { highway: 'residential' }, geometry: [westOrigin, westNorth] },
    { type: 'way', tags: { highway: 'residential' }, geometry: [eastNorth, eastObjective] },
    { type: 'way', tags: { highway: 'tertiary', name: 'North Loop Rd' }, geometry: [westNorth, connectorNW, connectorNE, eastNorth] },
  ].map(w => ({ ...w, geometry: w.geometry.map(p => ({ lat: p.lat, lon: p.lng })) })),
};
const emptyBody = { elements: [] };

let fetchCallCount = 0;
let lastQueryBodies: string[] = [];
function stubFetch(highwayBody: any, waterBody: any): typeof fetch {
  return (async (url: any, init?: any) => {
    fetchCallCount++;
    const u = String(url);
    if (u.startsWith('/api') || u.includes('/api/infrastructure')) {
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }
    const body = typeof init?.body === 'string' ? decodeURIComponent(init.body) : '';
    lastQueryBodies.push(body);
    const isWaterQuery = body.includes('natural');
    return { ok: true, status: 200, json: async () => (isWaterQuery ? waterBody : highwayBody) } as any;
  }) as unknown as typeof fetch;
}

const BOUNDS_PAD_FACTOR = 0.3;
const DETOUR_PAD_M = 0;

await test('a foot profile never fetches anything — returns null immediately', async () => {
  fetchCallCount = 0;
  (globalThis as any).fetch = stubFetch(overpassBody, emptyBody);
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = await findEarlyVehicleRoadRoutePreview(origin, objective, foot, BOUNDS_PAD_FACTOR, DETOUR_PAD_M);
  assert.strictEqual(result, null);
  assert.strictEqual(fetchCallCount, 0, 'a foot profile must never trigger a road-network fetch at all');
});

await test('a vehicle profile finds the real road route via the early, independent fetch', async () => {
  _clearInfrastructureCache();
  lastQueryBodies = [];
  (globalThis as any).fetch = stubFetch(overpassBody, emptyBody);
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = await findEarlyVehicleRoadRoutePreview(origin, objective, vehicle, BOUNDS_PAD_FACTOR, DETOUR_PAD_M);
  assert.ok(result, 'FAILED: the early preview did not find the route the live pipeline finds');
  assert.ok(result!.totalDistanceM > 0);
  assert.ok(result!.wayNames.includes('North Loop Rd'));
});

await test('the bbox requested is EXACTLY computePaddedBounds\'s own output for the same inputs — proves the cache-collapse claim, not just asserts it', async () => {
  _clearInfrastructureCache();
  lastQueryBodies = [];
  (globalThis as any).fetch = stubFetch(overpassBody, emptyBody);
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  await findEarlyVehicleRoadRoutePreview(origin, objective, vehicle, BOUNDS_PAD_FACTOR, DETOUR_PAD_M);

  const originBounds = paintedAreaBounds(origin)!;
  const objectiveBounds = paintedAreaBounds(objective)!;
  const expected = computePaddedBounds(originBounds, objectiveBounds, BOUNDS_PAD_FACTOR, DETOUR_PAD_M)!;

  const highwayQuery = lastQueryBodies.find(b => !b.includes('natural'));
  assert.ok(highwayQuery, 'expected at least one highway-mobility query to have been sent');
  // The query embeds "(south,west,north,east)" per buildQuery — parse it back
  // out and compare against the independently-computed expected box, to 3dp
  // (this module's own bbox rounding precision).
  const match = highwayQuery!.match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/);
  assert.ok(match, `could not find a bbox in the query: ${highwayQuery}`);
  const [, south, west, north, east] = match!.map(Number.parseFloat) as unknown as [number, number, number, number, number];
  assert.ok(Math.abs(south - expected.boundsSw.lat) < 1e-3, `south mismatch: ${south} vs ${expected.boundsSw.lat}`);
  assert.ok(Math.abs(west - expected.boundsSw.lng) < 1e-3, `west mismatch: ${west} vs ${expected.boundsSw.lng}`);
  assert.ok(Math.abs(north - expected.boundsNe.lat) < 1e-3, `north mismatch: ${north} vs ${expected.boundsNe.lat}`);
  assert.ok(Math.abs(east - expected.boundsNe.lng) < 1e-3, `east mismatch: ${east} vs ${expected.boundsNe.lng}`);
});

await test('CONTROL: without the connector, the early preview also correctly finds no route (not a false positive)', async () => {
  _clearInfrastructureCache();
  const noConnectorBody = { elements: overpassBody.elements.slice(0, 2) };
  (globalThis as any).fetch = stubFetch(noConnectorBody, emptyBody);
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = await findEarlyVehicleRoadRoutePreview(origin, objective, vehicle, BOUNDS_PAD_FACTOR, DETOUR_PAD_M);
  assert.strictEqual(result, null, 'the two shores are genuinely disconnected without the connector');
});

await test('no road data at all for this AOI returns null cleanly, not a crash', async () => {
  _clearInfrastructureCache();
  (globalThis as any).fetch = stubFetch(emptyBody, emptyBody);
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = await findEarlyVehicleRoadRoutePreview(origin, objective, vehicle, BOUNDS_PAD_FACTOR, DETOUR_PAD_M);
  assert.strictEqual(result, null);
});

await test('a network failure never throws — resolves null, a best-effort preview only', async () => {
  _clearInfrastructureCache();
  (globalThis as any).fetch = (async () => { throw new Error('simulated network failure'); }) as unknown as typeof fetch;
  const origin = singleDabArea(westOrigin, 50);
  const objective = singleDabArea(eastObjective, 50);
  const result = await findEarlyVehicleRoadRoutePreview(origin, objective, vehicle, BOUNDS_PAD_FACTOR, DETOUR_PAD_M);
  assert.strictEqual(result, null);
});

if (process.exitCode === 1) {
  console.error(`\nRoad-route decoupling is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} road-route decoupling checks passed.`);
}
