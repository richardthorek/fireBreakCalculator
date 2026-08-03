/**
 * OCOKA five-factor assembly (OCOKA 3, docs/ROUTE_INTELLIGENCE.md §47.1) —
 * `buildOcokaAppreciation` computes nothing new, so what needs proving is the
 * one real decision it makes: the `assessed`/`not-assessed` gate on Obstacles
 * and Avenues of approach, keyed off `result.path` (the exact condition
 * `mobilityAppreciation.ts` gates its own corridor/chokepoint/min-cut block
 * on) — and that Key terrain / Observation / Cover & concealment are always
 * `'not-assessed'` with their machine-readable flags, since none of the three
 * is built yet.
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
    cells: [],
    originKeys: [],
    objectiveKeys: [],
    hexSize: 100,
    proj: { originLat: 0, originLng: 0 },
    ...overrides,
  } as MobilityAppreciationResult;
}

test('objective unreachable (no path) → Obstacles and Avenues are not-assessed', () => {
  const result = baseResult({ path: null });
  const oakoc = buildOcokaAppreciation(result);
  assert.strictEqual(oakoc.obstacles.state, 'not-assessed');
  assert.strictEqual(oakoc.avenuesOfApproach.state, 'not-assessed');
});

test('reachable objective, nothing to sever → assessed, not conflated with not-assessed', () => {
  // A real, legitimate outcome: the search ran (path exists) but the min-cut
  // found nothing worth severing (barrier null) — this must read as
  // "assessed, nothing found", never "not assessed".
  const result = baseResult({
    path: [{ lat: 0, lng: 0, cumulativeSeconds: 0 }],
    barrier: null,
    roadNetworkBarrier: null,
    corridorField: null,
  });
  const oakoc = buildOcokaAppreciation(result);
  assert.strictEqual(oakoc.obstacles.state, 'assessed');
  assert.strictEqual(oakoc.obstacles.existing.barrier, null);
  assert.strictEqual(oakoc.avenuesOfApproach.state, 'assessed');
  assert.strictEqual(oakoc.avenuesOfApproach.unrestricted, null);
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

test('Key terrain / Observation / Cover & concealment are always not-assessed, with their honesty flags', () => {
  const oakoc = buildOcokaAppreciation(baseResult({}));
  assert.strictEqual(oakoc.keyTerrain.state, 'not-assessed');
  assert.strictEqual(oakoc.observationAndFieldsOfFire.state, 'not-assessed');
  assert.strictEqual(oakoc.observationAndFieldsOfFire.fieldsOfFireAssessed, false);
  assert.strictEqual(oakoc.coverAndConcealment.state, 'not-assessed');
  assert.strictEqual(oakoc.coverAndConcealment.coverAssessed, false);
});

console.log(`\n${passed} assertion group(s) passed.`);
