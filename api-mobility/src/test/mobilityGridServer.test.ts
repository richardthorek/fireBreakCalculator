/**
 * Unit tests for the server-side grid sampler's pure/no-network paths.
 * A full `buildServerMobilityGrid` run needs real DEM/Overpass upstreams,
 * so this file covers the degenerate-input guard (fails before any fetch)
 * and the pure point-to-polyline distance helper.
 * Run after build: node ./dist/api-mobility/src/test/mobilityGridServer.test.js
 */

import * as assert from 'node:assert';
import { buildServerMobilityGrid, _distanceToNearestTrailForTest } from '../services/mobilityGridServer';

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

async function run() {
  console.log('mobilityGridServer:');

  await test('rejects a degenerate origin/objective box before any network call', async () => {
    const coincidentBounds = { minLat: -35.3, minLng: 149.1, maxLat: -35.3, maxLng: 149.1 };
    await assert.rejects(
      () => buildServerMobilityGrid(coincidentBounds, coincidentBounds, 'standard'),
      /degenerate/
    );
  });

  await test('distanceToNearestTrail: zero distance for a point on the line', () => {
    const trail = { kind: 'track', coords: [{ lat: -35.30, lng: 149.10 }, { lat: -35.30, lng: 149.11 }] };
    const onLine = { lat: -35.30, lng: 149.105 };
    const d = _distanceToNearestTrailForTest(onLine, [trail]);
    assert.ok(d < 1, `expected ~0m, got ${d}m`);
  });

  await test('distanceToNearestTrail: large distance far from any trail', () => {
    const trail = { kind: 'track', coords: [{ lat: -35.30, lng: 149.10 }, { lat: -35.30, lng: 149.11 }] };
    const far = { lat: -34.0, lng: 149.10 }; // ~145 km north
    const d = _distanceToNearestTrailForTest(far, [trail]);
    assert.ok(d > 100_000, `expected a large distance, got ${d}m`);
  });

  await test('distanceToNearestTrail: Infinity with no trails at all', () => {
    const d = _distanceToNearestTrailForTest({ lat: -35.3, lng: 149.1 }, []);
    assert.strictEqual(d, Infinity);
  });

  if (passed === 4) {
    console.log(`All ${passed} tests passed.`);
  } else {
    process.exitCode = 1;
  }
}

run();
