/**
 * Unit tests for the Terrain Mobility assistant's payload validator and
 * deterministic template briefing — the part of the mobility AI feature
 * that's fully testable without a live model endpoint. Plain node + assert
 * (matches the project's framework-free test convention, mirrors
 * aiGrounding.test.ts).
 * Run after build: node ./dist/src/test/mobilityAssistant.test.js
 */

import * as assert from 'node:assert';
import { MobilityAssistantPayload, isMobilityAssistantPayload } from '../types/mobilityAssistant';
import { buildTemplateMobilityBriefing } from '../services/mobilityBriefingTemplate';
import { buildSystemPrompt } from '../services/aiGrounding';

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

const basePayload: MobilityAssistantPayload = {
  moverProfileLabel: 'Light 4WD',
  moverProfileConfidence: 'published',
  nightMode: false,
  cellCount: 400,
  reachableCount: 380,
  noGoCount: 15,
  slowGoCount: 40,
  estimatedData: false,
  unconstrained: false,
  coveragePercent: 22,
  topCorridors: [
    {
      rank: 1,
      easeClass: 'restricted',
      routeCount: 9,
      routeTotal: 14,
      medianTravelMin: 42,
      bottleneckWidthM: 30,
      bottleneckAbreast: 1,
      frontage: 'single-file',
      goFractionPct: 55,
    },
  ],
  chokepointCount: 6,
  topChokepointPassCount: 9,
  barrierSegmentCount: 3,
  barrierCutValue: 12,
  placements: [
    {
      measureId: 'abatis-felled-timber',
      measureLabel: 'Abatis (felled-timber obstacle)',
      delayImposedMin: 18,
      bypassDelayMin: 6,
      egressSafe: true,
    },
  ],
};

async function main() {
  console.log('Mobility assistant payload validation:');

  await test('accepts a fully-formed payload', () => {
    assert.strictEqual(isMobilityAssistantPayload(basePayload), true);
  });

  await test('rejects a payload missing a required field', () => {
    const { moverProfileLabel, ...rest } = basePayload as any;
    assert.strictEqual(isMobilityAssistantPayload(rest), false);
  });

  await test('rejects a corridor summary with a non-finite number', () => {
    const bad = { ...basePayload, topCorridors: [{ ...basePayload.topCorridors[0], medianTravelMin: NaN }] };
    assert.strictEqual(isMobilityAssistantPayload(bad), false);
  });

  await test('rejects a placement missing egressSafe', () => {
    const bad = { ...basePayload, placements: [{ measureId: 'x', measureLabel: 'X', delayImposedMin: 1, bypassDelayMin: 1 }] };
    assert.strictEqual(isMobilityAssistantPayload(bad), false);
  });

  await test('accepts null barrier/chokepoint fields (no separating cut found)', () => {
    const noBarrier = { ...basePayload, topChokepointPassCount: null, barrierSegmentCount: null, barrierCutValue: null };
    assert.strictEqual(isMobilityAssistantPayload(noBarrier), true);
  });

  await test('accepts a placement with a null bypassDelayMin (objective unreachable at baseline)', () => {
    const p = { ...basePayload, placements: [{ ...basePayload.placements[0], bypassDelayMin: null }] };
    assert.strictEqual(isMobilityAssistantPayload(p), true);
  });

  await test('rejects null and non-objects outright', () => {
    assert.strictEqual(isMobilityAssistantPayload(null), false);
    assert.strictEqual(isMobilityAssistantPayload('not a payload'), false);
    assert.strictEqual(isMobilityAssistantPayload(42), false);
  });

  console.log('Mobility template briefing:');

  await test('mentions the mover profile and reachability figures', () => {
    const text = buildTemplateMobilityBriefing(basePayload);
    assert.ok(text.includes('Light 4WD'));
    assert.ok(text.includes('380/400'));
  });

  await test('reports the primary corridor when movement is constrained', () => {
    const text = buildTemplateMobilityBriefing(basePayload);
    assert.ok(text.includes('restricted'));
    assert.ok(text.includes('single-file'));
    assert.ok(!text.includes('UNCONSTRAINED'));
  });

  await test('reports UNCONSTRAINED prominently and skips corridor detail when the AOI does not canalise movement', () => {
    const text = buildTemplateMobilityBriefing({ ...basePayload, unconstrained: true, coveragePercent: 78 });
    assert.ok(text.includes('UNCONSTRAINED'));
    assert.ok(text.includes('78%'));
  });

  await test('reports a scored counter-measure placement with its delay and bypass figures', () => {
    const text = buildTemplateMobilityBriefing(basePayload);
    assert.ok(text.includes('Abatis'));
    assert.ok(text.includes('18'));
    assert.ok(text.includes('6'));
  });

  await test('REFUSES an egress-unsafe placement rather than reporting its delay figures', () => {
    const unsafe = {
      ...basePayload,
      placements: [{ ...basePayload.placements[0], egressSafe: false }],
    };
    const text = buildTemplateMobilityBriefing(unsafe);
    assert.ok(text.includes('REFUSED'));
    assert.ok(text.toLowerCase().includes('egress'));
  });

  await test('carries the estimated-data caution when flagged', () => {
    const text = buildTemplateMobilityBriefing({ ...basePayload, estimatedData: true });
    assert.ok(text.toLowerCase().includes('estimated'));
  });

  await test('never fabricates a corridor when none was formed', () => {
    const text = buildTemplateMobilityBriefing({ ...basePayload, topCorridors: [] });
    assert.ok(text.includes('no corridor could be formed'));
  });

  await test('always states this is an appreciation, not a tasking', () => {
    const text = buildTemplateMobilityBriefing(basePayload);
    assert.ok(text.toLowerCase().includes('not a tasking'));
  });

  console.log('System prompt audience parameter:');

  await test('defaults to the fire-break audience when omitted (backward compatible)', () => {
    const prompt = buildSystemPrompt([]);
    assert.ok(prompt.includes('a firefighter planning a fire break'));
  });

  await test('states the mobility audience when passed explicitly', () => {
    const prompt = buildSystemPrompt([], 'a ground commander appreciating terrain mobility and siting counter-mobility measures');
    assert.ok(prompt.includes('ground commander'));
    assert.ok(prompt.includes('Never compute, estimate'));
  });

  console.log(`\n${passed} checks passed`);
}

main();
