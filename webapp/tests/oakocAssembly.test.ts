/**
 * OCOKA five-factor assembly (OCOKA 3, docs/ROUTE_INTELLIGENCE.md §47.1) —
 * `buildOcokaAppreciation` computes nothing new, so what needs proving is the
 * one real decision it makes: the `assessed`/`not-assessed` gate on Obstacles
 * and Avenues of approach, keyed off `result.path` (the exact condition
 * `mobilityAppreciation.ts` gates its own corridor/chokepoint/min-cut block
 * on) — that Key terrain (OCOKA 4) rides the SAME gate as Obstacles/Avenues
 * (unlike Observation/Cover & concealment, which stay permanently
 * `'not-assessed'` — OCOKA 6/7 aren't built yet) — and that Key terrain's
 * `result === null` under `state === 'assessed'` reads as its own distinct,
 * honest outcome, never conflated with the not-assessed gate above it.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/oakocAssembly.test.ts
 */
import * as assert from 'node:assert';
import { buildOcokaAppreciation } from '../src/terrain/oakoc';
import { MobilityAppreciationResult } from '../src/terrain/mobilityAppreciation';
import { getMoverProfile } from '../src/terrain/moverProfiles';

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

const profile = getMoverProfile('au-light-4wd')!;

/** Minimal but real `MobilityAppreciationResult` — every field the assembly
 *  function actually reads is set explicitly; the rest are honest empty
 *  defaults for a shape this large. */
function baseResult(overrides: Partial<MobilityAppreciationResult>): MobilityAppreciationResult {
  return {
    results: [],
    bands: [],
    profile,
    usedEstimatedData: false,
    infrastructureAvailable: true,
    hydrologyAvailable: true,
    waterFeatures: [],
    roadWays: [],
    cellCount: 0,
    reachableCount: 0,
    severelyRestrictedCount: 0,
    restrictedCount: 0,
    path: null,
    roadRoute: null,
    usedExpandedSearch: false,
    searchAttempts: 1,
    fidelity: 'standard',
    targetCellCount: 0,
    dissimilarRoutes: [],
    corridorField: null,
    optimiserCorridorField: null,
    ensemble: null,
    restrictionPlan: null,
    restrictedCorridorField: null,
    chokepoints: [],
    barrier: null,
    roadNetworkBarrier: null,
    keyTerrain: null,
    cells: [],
    originKeys: [],
    objectiveKeys: [],
    hexSize: 100,
    proj: { originLat: 0, originLng: 0 },
    ...overrides,
  } as MobilityAppreciationResult;
}

test('objective unreachable (no path) → Obstacles, Avenues and Key terrain are all not-assessed', () => {
  const result = baseResult({ path: null });
  const oakoc = buildOcokaAppreciation(result);
  assert.strictEqual(oakoc.obstacles.state, 'not-assessed');
  assert.strictEqual(oakoc.avenuesOfApproach.state, 'not-assessed');
  assert.strictEqual(oakoc.keyTerrain.state, 'not-assessed');
  assert.strictEqual(oakoc.keyTerrain.result, null);
});

test('reachable objective, nothing to sever/score → assessed, not conflated with not-assessed', () => {
  // A real, legitimate outcome: the search ran (path exists) but the min-cut
  // found nothing worth severing (barrier null) and no key terrain candidates
  // were nominated (keyTerrain null) — this must read as "assessed, nothing
  // found", never "not assessed".
  const result = baseResult({
    path: [{ lat: 0, lng: 0, cumulativeSeconds: 0 }],
    barrier: null,
    roadNetworkBarrier: null,
    corridorField: null,
    keyTerrain: null,
  });
  const oakoc = buildOcokaAppreciation(result);
  assert.strictEqual(oakoc.obstacles.state, 'assessed');
  assert.strictEqual(oakoc.obstacles.existing.barrier, null);
  assert.strictEqual(oakoc.avenuesOfApproach.state, 'assessed');
  assert.strictEqual(oakoc.avenuesOfApproach.unrestricted, null);
  assert.strictEqual(oakoc.keyTerrain.state, 'assessed');
  assert.strictEqual(oakoc.keyTerrain.result, null);
});

test('re-presents existing products without altering them', () => {
  const restrictionPlan = {
    restrictions: [], blockedEdges: [], scenario: null,
    baselineMedianSeconds: null, scenarioMedianSeconds: null,
    baselineArrivedFraction: 0, scenarioArrivedFraction: 0,
    baselineCrossCountryFraction: 0, scenarioCrossCountryFraction: 0,
    bypassNote: 'terrain offers a free bypass', evaluationMoverCount: 70,
    networkUnavailable: false,
  };
  const result = baseResult({
    path: [{ lat: 0, lng: 0, cumulativeSeconds: 0 }],
    restrictionPlan,
  } as any);
  const oakoc = buildOcokaAppreciation(result);
  assert.strictEqual(oakoc.obstacles.reinforcing.plan, restrictionPlan);
});

test('Observation / Cover & concealment are always not-assessed regardless of path, with their honesty flags', () => {
  const reachable = buildOcokaAppreciation(baseResult({ path: [{ lat: 0, lng: 0, cumulativeSeconds: 0 }] }));
  const unreachable = buildOcokaAppreciation(baseResult({ path: null }));
  for (const oakoc of [reachable, unreachable]) {
    assert.strictEqual(oakoc.observationAndFieldsOfFire.state, 'not-assessed');
    assert.strictEqual(oakoc.observationAndFieldsOfFire.fieldsOfFireAssessed, false);
    assert.strictEqual(oakoc.coverAndConcealment.state, 'not-assessed');
    assert.strictEqual(oakoc.coverAndConcealment.coverAssessed, false);
  }
});

test('Key terrain re-presents a real KeyTerrainResult verbatim, under the assessed state', () => {
  const keyTerrain = {
    candidates: [], candidatesConsidered: 3, evaluationRouteCount: 6,
    missionCaveat: 'a fixed caveat string',
  };
  const result = baseResult({
    path: [{ lat: 0, lng: 0, cumulativeSeconds: 0 }],
    keyTerrain,
  });
  const oakoc = buildOcokaAppreciation(result);
  assert.strictEqual(oakoc.keyTerrain.state, 'assessed');
  assert.strictEqual(oakoc.keyTerrain.result, keyTerrain);
});

console.log(`\n${passed} assertion group(s) passed.`);
