/**
 * Hydrology attributes in the AI briefing payload (docs/ROUTE_INTELLIGENCE.md
 * §34) — `buildMobilityAssistantPayload` (mobilityAssistantApi.ts) is the
 * function that actually turns a `MobilityAppreciationResult` into what gets
 * POSTed to the assistant endpoint; this proves it correctly computes
 * `hydrologyAvailable`/`waterAffectedCellCount`/`waterBodyCellCount` from the
 * result's own cells, using the SAME `carriesWaterSignal` predicate the run's
 * own assessment log and the GIS export both use — not a second,
 * independently-tuned copy.
 *
 * Plain node:assert. Run: npx tsx webapp/tests/mobilityHydrologyBriefing.test.ts
 */
import * as assert from 'node:assert';
import { hexKey, AxialCoord, makeProjection } from '../src/utils/hexGrid';
import { MobilityGridCell } from '../src/terrain/accumulatedCost';
import { MobilityAppreciationResult } from '../src/terrain/mobilityAppreciation';
import { buildMobilityAssistantPayload } from '../src/utils/mobilityAssistantApi';
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

function cell(q: number, opts: Partial<MobilityGridCell> = {}): MobilityGridCell {
  const hex: AxialCoord = { q, r: 0 };
  return {
    key: hexKey(hex),
    hex,
    center: { lat: -35.0 + q * 0.001, lng: 149.0 },
    elevation: 0,
    vegetation: 'grassland',
    vegEstimated: false,
    onTrail: false,
    nearestTrailTags: null,
    crossSlopeDeg: 0,
    waterDistanceM: Infinity,
    inWaterBody: false,
    nearestWaterwayKind: null,
    waterFrequency: null,
    ...opts,
  };
}

const profile = getMoverProfile('au-light-4wd')!;
const ANCHOR = { lat: -35.0, lng: 149.0 };

function baseResult(cells: MobilityGridCell[], hydrologyAvailable: boolean): MobilityAppreciationResult {
  return {
    results: [],
    bands: [],
    profile,
    usedEstimatedData: false,
    infrastructureAvailable: true,
    hydrologyAvailable,
    waterFeatures: [],
    roadWays: [],
    cellCount: cells.length,
    reachableCount: cells.length,
    severelyRestrictedCount: 0,
    restrictedCount: 0,
    path: null,
    roadRoute: null,
    usedExpandedSearch: false,
    searchAttempts: 1,
    fidelity: 'standard',
    targetCellCount: cells.length,
    dissimilarRoutes: [],
    corridorField: null,
    optimiserCorridorField: null,
    ensemble: null,
    restrictionPlan: null,
    restrictedCorridorField: null,
    chokepoints: [],
    barrier: null,
    roadNetworkBarrier: null,
    cells,
    originKeys: [],
    objectiveKeys: [],
    hexSize: 30,
    proj: makeProjection(ANCHOR),
  };
}

console.log('Hydrology attributes in the AI briefing payload (docs §34):');

test('hydrologyAvailable passes through unchanged from the result', () => {
  const payload = buildMobilityAssistantPayload(baseResult([cell(0)], false), false, null);
  assert.strictEqual(payload.hydrologyAvailable, false);
  const payload2 = buildMobilityAssistantPayload(baseResult([cell(0)], true), false, null);
  assert.strictEqual(payload2.hydrologyAvailable, true);
});

test('waterAffectedCellCount / waterBodyCellCount are computed from the result\'s own cells, not invented', () => {
  const cells = [
    cell(0),
    cell(1, { inWaterBody: true }),
    cell(2, { nearestWaterwayKind: 'river' }),
    cell(3, { waterFrequency: 0.5 }), // >= 0.15 threshold — counts
    cell(4, { waterFrequency: 0.05 }), // below threshold — does NOT count
  ];
  const payload = buildMobilityAssistantPayload(baseResult(cells, true), false, null);
  assert.strictEqual(payload.waterAffectedCellCount, 3, `expected 3 water-affected cells, got ${payload.waterAffectedCellCount}`);
  assert.strictEqual(payload.waterBodyCellCount, 1, `expected 1 standing-water-body cell, got ${payload.waterBodyCellCount}`);
});

test('zero water cells reports zero, not omitted/undefined', () => {
  const payload = buildMobilityAssistantPayload(baseResult([cell(0), cell(1)], true), false, null);
  assert.strictEqual(payload.waterAffectedCellCount, 0);
  assert.strictEqual(payload.waterBodyCellCount, 0);
});

if (process.exitCode === 1) {
  console.error(`\nHydrology briefing payload is NOT working as expected.`);
} else {
  console.log(`\nAll ${passed} hydrology briefing payload checks passed.`);
}
