/**
 * Unit tests for the "Field Reality Check" (Col persona) — the part that's
 * fully testable without a live model endpoint: the system prompt contract
 * and the deterministic template fallback. Plain node + assert (matches the
 * project's framework-free test convention).
 * Run after build: node ./dist/src/test/realityCheck.test.js
 */

import assert from 'node:assert';
import { buildRealityCheckSystemPrompt } from '../services/aiGrounding';
import { buildTemplateRealityCheck } from '../services/realityCheckTemplate';
import { AssistantPayload } from '../types/assistant';

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

const basePayload: AssistantPayload = {
  distanceM: 1200,
  breakWidthM: 6,
  maxSlopeDeg: 18,
  meanSlopeDeg: 9,
  predominantVegetation: 'mediumscrub',
  vegetationConfidence: 0.8,
  estimatedData: false,
  difficultyScore: 40,
  difficultyLabel: 'Moderate',
  topEquipment: [
    { name: 'Medium Dozer (D6/D7 class)', type: 'Machinery', timeHours: 3.2, cost: 1024, compatibilityLevel: 'full' },
  ],
  insights: [],
};

async function main() {
  console.log('Reality-check system prompt:');

  await test('states the same strict grounding rules as the narration prompt (never fabricate a number)', () => {
    const prompt = buildRealityCheckSystemPrompt([]);
    assert.match(prompt, /MUST come verbatim from the ANALYSIS DATA/);
    assert.match(prompt, /Never compute, estimate, round differently, or invent a number/);
  });

  await test("frames the Col persona explicitly, not a generic narrator", () => {
    const prompt = buildRealityCheckSystemPrompt([]);
    assert.match(prompt, /'Col'/);
    assert.match(prompt, /reality check/i);
  });

  await test('instructs the model to ground its critique in the reality-check context fields', () => {
    const prompt = buildRealityCheckSystemPrompt([]);
    assert.match(prompt, /lowConfidenceSegmentCount/);
    assert.match(prompt, /equipmentCaveats/);
    assert.match(prompt, /mobilisationCostIncluded/);
  });

  await test('instructs the model not to invent a caveat when there is nothing to flag', () => {
    const prompt = buildRealityCheckSystemPrompt([]);
    assert.match(prompt, /clean bill/i);
  });

  console.log('\nReality-check deterministic template:');

  await test('a clean payload (no flags raised) states there is nothing to flag, not a fabricated concern', () => {
    const text = buildTemplateRealityCheck(basePayload);
    assert.match(text, /no known gap/i);
  });

  await test('estimatedData:true is surfaced as a concern', () => {
    const text = buildTemplateRealityCheck({ ...basePayload, estimatedData: true });
    assert.match(text, /estimated\/fallback data/);
  });

  await test('lowConfidenceSegmentCount is surfaced with the real count, not "some"', () => {
    const text = buildTemplateRealityCheck({ ...basePayload, segmentCount: 12, lowConfidenceSegmentCount: 3 });
    assert.match(text, /3 of 12 ground segments/);
  });

  await test('equipmentCaveats is quoted, not paraphrased away', () => {
    const caveat = 'No published production table specific to remote RAFT teams was found.';
    const text = buildTemplateRealityCheck({ ...basePayload, equipmentCaveats: [caveat] });
    assert.ok(text.includes(caveat));
  });

  await test('mobilisationCostIncluded:false is surfaced as a named cost-model gap', () => {
    const text = buildTemplateRealityCheck({ ...basePayload, mobilisationCostIncluded: false });
    assert.match(text, /does NOT include getting the resource to site/);
  });

  await test('mobilisationCostIncluded:true (or unset) does not raise the mobilisation concern', () => {
    const text = buildTemplateRealityCheck({ ...basePayload, mobilisationCostIncluded: true });
    assert.ok(!text.includes('does NOT include getting the resource to site'));
  });

  await test('multiple raised concerns are all listed, none silently dropped', () => {
    const text = buildTemplateRealityCheck({
      ...basePayload,
      estimatedData: true,
      mobilisationCostIncluded: false,
    });
    assert.match(text, /2 things worth a second look/);
    assert.match(text, /estimated\/fallback data/);
    assert.match(text, /does NOT include getting the resource to site/);
  });

  await test('always labels itself a template, not a claimed AI critique', () => {
    const text = buildTemplateRealityCheck(basePayload);
    assert.match(text, /template summary, not Col/);
  });

  console.log(`\n${passed} checks passed`);
}

main();
