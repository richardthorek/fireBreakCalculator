/**
 * Unit tests for the fireline production model and per-segment analysis.
 * Plain node + assert (matches the project's framework-free test convention).
 * Run after build:  node ./dist/src/test/analysis.test.js
 */

import * as assert from 'node:assert';
import {
  EquipmentAnalysisService,
  AnalysisRequest,
  EquipmentSpec,
  RouteSegment,
} from '../services/equipmentAnalysis';
import {
  effectiveRate,
  fuelFactor,
  slopeFactor,
  resolveMaxSlopeDegrees,
} from '../services/productionModel';
import { parseGetSamplesResponse, buildGetSamplesUrl } from '../services/elevationService';

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      console.error(`  ✗ ${name}`);
      console.error(e);
      process.exitCode = 1;
    });
}

const svc = new EquipmentAnalysisService();

function baseRequest(segments: RouteSegment[]): AnalysisRequest {
  const total = segments.reduce((a, s) => a + s.length, 0);
  return {
    distance: total,
    trackAnalysis: { maxSlope: 0, totalDistance: total, slopeDistribution: {} },
    vegetationAnalysis: { predominantVegetation: 'grassland', overallConfidence: 0.9 },
    segments,
  };
}

const dozer = (over: Partial<EquipmentSpec> = {}): EquipmentSpec => ({
  id: 'd', name: 'Dozer', type: 'Machinery',
  allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
  allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
  clearingRate: 800, costPerHour: 500, ...over,
});

async function main() {
  console.log('Production model:');

  await test('fuel factor is monotonic and ≤ 1 for machinery', () => {
    assert.strictEqual(fuelFactor('Machinery', 'grassland'), 1.0);
    assert.ok(fuelFactor('Machinery', 'lightshrub') < 1.0);
    assert.ok(fuelFactor('Machinery', 'mediumscrub') < fuelFactor('Machinery', 'lightshrub'));
    assert.ok(fuelFactor('Machinery', 'heavyforest') < fuelFactor('Machinery', 'mediumscrub'));
  });

  await test('hand crews are more fuel-sensitive than machinery', () => {
    assert.ok(fuelFactor('HandCrew', 'heavyforest') < fuelFactor('Machinery', 'heavyforest'));
  });

  await test('slope factor decreases with slope for machinery', () => {
    assert.strictEqual(slopeFactor('Machinery', 0), 1.0);
    assert.ok(slopeFactor('Machinery', 30) < slopeFactor('Machinery', 10));
    assert.ok(slopeFactor('Aircraft', 40) === 1.0); // aircraft overfly
  });

  await test('effective rate combines fuel and slope', () => {
    const r = effectiveRate(1000, 'Machinery', 'grassland', 0);
    assert.strictEqual(r, 1000);
    assert.ok(effectiveRate(1000, 'Machinery', 'heavyforest', 30) < 1000 * 0.35);
  });

  await test('slope limit derives from allowed terrain when maxSlope unset', () => {
    assert.ok(resolveMaxSlopeDegrees('Machinery', undefined, ['flat', 'medium']) <= 25);
    assert.ok(resolveMaxSlopeDegrees('Machinery', 30, ['flat']) === 30); // explicit wins
  });

  console.log('Per-segment integration:');

  await test('mixed route lands between all-easy and all-hard extremes', async () => {
    const easy = await svc.analyzeEquipment(
      baseRequest([{ length: 2000, slopeDegrees: 3, vegetation: 'grassland' }]),
      [dozer()]
    );
    const hard = await svc.analyzeEquipment(
      baseRequest([{ length: 2000, slopeDegrees: 30, vegetation: 'heavyforest' }]),
      [dozer()]
    );
    const mixed = await svc.analyzeEquipment(
      baseRequest([
        { length: 1000, slopeDegrees: 3, vegetation: 'grassland' },
        { length: 1000, slopeDegrees: 30, vegetation: 'heavyforest' },
      ]),
      [dozer()]
    );
    const t = (r: any) => r.calculations[0].time;
    assert.ok(t(easy) < t(mixed), 'mixed slower than easy');
    assert.ok(t(mixed) < t(hard), 'mixed faster than all-hard');
  });

  await test('a mostly-flat line clipping one steep gully is NOT billed as all-steep', async () => {
    // 95% flat grass, 5% steep forest.
    const mixed = await svc.analyzeEquipment(
      baseRequest([
        { length: 1900, slopeDegrees: 4, vegetation: 'grassland' },
        { length: 100, slopeDegrees: 40, vegetation: 'heavyforest' },
      ]),
      [dozer()]
    );
    const allSteep = await svc.analyzeEquipment(
      baseRequest([{ length: 2000, slopeDegrees: 40, vegetation: 'heavyforest' }]),
      [dozer()]
    );
    assert.ok(mixed.calculations[0].time < allSteep.calculations[0].time * 0.5,
      'clipping a gully must not cost like an all-steep route');
  });

  console.log('Slope safety gating:');

  await test('machine limited to flat/medium is incompatible when much of route is steep', async () => {
    const smallDozer = dozer({ allowedTerrain: ['flat', 'medium'] }); // ~25° limit
    const res = await svc.analyzeEquipment(
      baseRequest([
        { length: 1000, slopeDegrees: 5, vegetation: 'grassland' },
        { length: 1000, slopeDegrees: 40, vegetation: 'grassland' }, // 50% over limit
      ]),
      [smallDozer]
    );
    assert.strictEqual(res.calculations[0].compatibilityLevel, 'incompatible');
  });

  await test('a small over-limit fraction yields partial (not incompatible)', async () => {
    const smallDozer = dozer({ allowedTerrain: ['flat', 'medium'] });
    const res = await svc.analyzeEquipment(
      baseRequest([
        { length: 1900, slopeDegrees: 5, vegetation: 'grassland' },
        { length: 100, slopeDegrees: 40, vegetation: 'grassland' }, // 5% over limit
      ]),
      [smallDozer]
    );
    assert.strictEqual(res.calculations[0].compatibilityLevel, 'partial');
    assert.ok(res.calculations[0].compatible);
  });

  console.log('Aircraft coverage model:');

  await test('heavy forest needs more drops than grass for the same distance', async () => {
    const tanker: EquipmentSpec = {
      id: 'a', name: 'Tanker', type: 'Aircraft',
      allowedTerrain: ['flat', 'medium', 'steep', 'very_steep'],
      allowedVegetation: ['grassland', 'lightshrub', 'mediumscrub', 'heavyforest'],
      dropLength: 100, turnaroundMinutes: 15, costPerDrop: 1200,
    };
    const grass = await svc.analyzeEquipment(
      baseRequest([{ length: 1000, slopeDegrees: 5, vegetation: 'grassland' }]),
      [tanker]
    );
    const forest = await svc.analyzeEquipment(
      baseRequest([{ length: 1000, slopeDegrees: 5, vegetation: 'heavyforest' }]),
      [tanker]
    );
    assert.ok((forest.calculations[0].drops || 0) > (grass.calculations[0].drops || 0));
    assert.ok(grass.calculations[0].cost > 0, 'per-drop cost applied');
  });

  console.log('Break width / multi-pass:');

  await test('a wider break needs more machinery passes and more time', async () => {
    const req = (w: number) => ({
      ...baseRequest([{ length: 1000, slopeDegrees: 5, vegetation: 'grassland' as const }]),
      breakWidthMeters: w,
    });
    const single = await svc.analyzeEquipment(req(3), [dozer({ cutWidthMeters: 3.4 })]);
    const wide = await svc.analyzeEquipment(req(12), [dozer({ cutWidthMeters: 3.4 })]);
    assert.strictEqual(single.calculations[0].passes, 1);
    assert.ok((wide.calculations[0].passes || 0) >= 4);
    assert.ok(wide.calculations[0].time > single.calculations[0].time);
  });

  await test('metadata reports segment count and confidence', async () => {
    const res = await svc.analyzeEquipment(
      baseRequest([
        { length: 1000, slopeDegrees: 5, vegetation: 'grassland', vegetationConfidence: 0.8 },
        { length: 1000, slopeDegrees: 20, vegetation: 'mediumscrub', vegetationConfidence: 0.6 },
      ]),
      [dozer()]
    );
    assert.strictEqual(res.metadata.analysisParameters.segmentCount, 2);
    assert.strictEqual(res.metadata.analysisParameters.profileFromClient, true);
    assert.ok(res.metadata.analysisParameters.maxSlope >= 20);
  });

  console.log('Elevation profile parsing:');

  await test('getSamples response maps to ordered elevations by locationId', () => {
    const json = {
      samples: [
        { locationId: 2, value: 300 },
        { locationId: 0, value: 100 },
        { locationId: 1, value: '200.5' },
      ],
    };
    const out = parseGetSamplesResponse(json, 3);
    assert.deepStrictEqual(out, [100, 200.5, 300]);
  });

  await test('missing samples become NaN (caller falls back)', () => {
    const out = parseGetSamplesResponse({ samples: [{ locationId: 0, value: 50 }] }, 3);
    assert.strictEqual(out[0], 50);
    assert.ok(Number.isNaN(out[1]) && Number.isNaN(out[2]));
  });

  await test('getSamples URL is a multipoint getSamples query in lng,lat order', () => {
    const url = buildGetSamplesUrl('https://example.com/DEM/ImageServer', [
      { lat: -33.8, lng: 151.2 },
    ]);
    assert.ok(url.includes('/getSamples?'));
    assert.ok(url.includes('esriGeometryMultipoint'));
    assert.ok(decodeURIComponent(url).includes('[151.2,-33.8]'));
  });

  console.log(`\n${passed} checks passed`);
}

main();
