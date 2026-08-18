/**
 * Elevation batch chunking (2026-08-17) — a real production 400 on
 * `/api/elevation/profile` was traced to `sampleElevationsBatch` sending an
 * ENTIRE Terrain Mobility grid round's points as one request. The API's own
 * hard cap (`elevationProfile.ts`, 5000 points — a real upstream constraint:
 * the ArcGIS `getSamples` call encodes every point into one request URL) then
 * rejects it outright, and `sampleElevationsBatch`'s existing "DEM failed →
 * fall back to per-point Mapbox sampling" path kicked in for the WHOLE
 * oversized set — a request-per-point tile fetch/decode loop that plausibly
 * explains reports of the tab freezing and the map never painting during a
 * real run. 'standard'/'fine' fidelity's own hard cell ceilings
 * (mobilityGrid.ts) are 12,000/50,000 — both routinely over the cap.
 *
 * The fix: split any point set over the cap into chunks, each still going
 * through the fast batched-DEM path independently; per-point Mapbox fallback
 * now only fires for a chunk whose OWN DEM request genuinely fails, not for
 * the whole set merely because it didn't fit in one request.
 *
 * Global `fetch` stubbed, no real network — same discipline as
 * `waterRelations.test.ts`/`roadRouteDecoupling.test.ts`.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/elevationChunking.test.ts
 */
import * as assert from 'node:assert';
import { sampleElevationsBatch } from '../src/utils/slopeCalculation';

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

const originalFetch = (globalThis as any).fetch;

console.log('Elevation batch chunking (2026-08-17 — /api/elevation/profile 400 at scale):');

await test('a point set at or under the cap makes exactly ONE request', async () => {
  let calls = 0;
  let lastCount = 0;
  (globalThis as any).fetch = async (_url: string, init: any) => {
    calls++;
    const body = JSON.parse(init.body);
    lastCount = body.points.length;
    return {
      ok: true,
      json: async () => ({
        elevations: body.points.map((_: any, i: number) => i),
        source: 'dem',
        estimated: false,
      }),
    };
  };
  const points = Array.from({ length: 5000 }, (_, i) => ({ lat: -35 + i * 0.0001, lng: 149 }));
  const result = await sampleElevationsBatch(points);
  assert.strictEqual(calls, 1, `expected exactly one request at the cap, got ${calls}`);
  assert.strictEqual(lastCount, 5000, 'the single request must carry every point');
  assert.strictEqual(result.elevations.length, 5000, 'every point gets an elevation back');
  assert.strictEqual(result.estimated, false, 'a clean DEM response is not estimated');
});

await test('a point set over the cap splits into multiple requests, each ≤ the cap', async () => {
  let calls = 0;
  const chunkSizes: number[] = [];
  (globalThis as any).fetch = async (_url: string, init: any) => {
    calls++;
    const body = JSON.parse(init.body);
    chunkSizes.push(body.points.length);
    return {
      ok: true,
      json: async () => ({
        elevations: body.points.map(() => 100),
        source: 'dem',
        estimated: false,
      }),
    };
  };
  // 12,000 — exactly 'standard' fidelity's own hard cell ceiling
  // (mobilityGrid.ts FIDELITY_TIERS.standard.hardCeiling) — the concrete
  // real-world size that was tripping the 400.
  const points = Array.from({ length: 12_000 }, (_, i) => ({ lat: -35 + i * 0.0001, lng: 149 }));
  const result = await sampleElevationsBatch(points);
  assert.strictEqual(calls, 3, `12000 points at a 5000 cap must be 3 requests, got ${calls}`);
  assert.ok(chunkSizes.every(n => n <= 5000), `every chunk must be ≤ 5000, got ${JSON.stringify(chunkSizes)}`);
  assert.deepStrictEqual(chunkSizes.sort((a, b) => b - a), [5000, 5000, 2000], `unexpected chunk split: ${JSON.stringify(chunkSizes)}`);
  assert.strictEqual(result.elevations.length, 12_000, 'every point across every chunk gets an elevation back — none dropped');
});

await test('chunk results are concatenated in the ORIGINAL point order, not request-completion order', async () => {
  (globalThis as any).fetch = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    // Distinguishable per-chunk value: the elevation IS the point's own index
    // within the ORIGINAL points array (encoded via lat), so a mis-ordered
    // concatenation is caught even if requests resolve out of order.
    return {
      ok: true,
      json: async () => ({
        elevations: body.points.map((p: any) => Math.round((p.lat + 90) * 10000)),
        source: 'dem',
        estimated: false,
      }),
    };
  };
  const n = 11_000;
  const points = Array.from({ length: n }, (_, i) => ({ lat: -90 + i / 10000, lng: 149 }));
  const result = await sampleElevationsBatch(points);
  assert.strictEqual(result.elevations.length, n);
  for (let i = 0; i < n; i += 1000) {
    assert.strictEqual(result.elevations[i], i, `point ${i} came back out of order: got elevation ${result.elevations[i]}`);
  }
});

await test('a chunk whose OWN request fails degrades independently — does not fail the whole batch', async () => {
  // First chunk's DEM call fails (non-ok); second succeeds. Only the failed
  // chunk should fall back to per-point sampling (estimated=true covers it);
  // the successful chunk's elevations must still be the real DEM values, not
  // discarded or overwritten.
  let call = 0;
  (globalThis as any).fetch = async (_url: string, init: any) => {
    call++;
    const body = JSON.parse(init.body);
    if (call === 1) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ elevations: body.points.map(() => 777), source: 'dem', estimated: false }) };
  };
  const points = Array.from({ length: 6000 }, (_, i) => ({ lat: -35 + i * 0.0001, lng: 149 }));
  const result = await sampleElevationsBatch(points);
  assert.strictEqual(result.elevations.length, 6000, 'both chunks still contribute all their points');
  // Second chunk (points 5000..5999) got the real DEM value.
  assert.ok(result.elevations.slice(5000).every(e => e === 777), 'the chunk whose DEM call succeeded keeps its real values');
  assert.strictEqual(result.estimated, true, 'the whole result is flagged estimated because at least one chunk fell back');
});

(globalThis as any).fetch = originalFetch;

if (passed === 4) {
  console.log(`\nAll ${passed} elevation chunking checks passed.`);
} else {
  console.log(`\n${passed}/4 elevation chunking checks passed.`);
  process.exitCode = 1;
}
