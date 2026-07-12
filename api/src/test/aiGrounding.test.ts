/**
 * Unit tests for the AI assistant's knowledge base retrieval and grounding
 * validation — the part of the AI feature that's fully testable without a
 * live model endpoint. Plain node + assert (matches the project's
 * framework-free test convention).
 * Run after build: node ./dist/src/test/aiGrounding.test.js
 */

import * as assert from 'node:assert';
import { retrieveDoctrine, getDoctrineChunk, DOCTRINE_CHUNKS } from '../services/knowledgeBase';
import {
  extractNumericClaims,
  extractCitationIds,
  flattenPayloadNumbers,
  validateGroundedResponse,
  buildSystemPrompt,
} from '../services/aiGrounding';

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

async function main() {
  console.log('Knowledge base retrieval:');

  await test('every chunk has a unique id and a real, checkable source', () => {
    const ids = DOCTRINE_CHUNKS.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    for (const c of DOCTRINE_CHUNKS) {
      assert.ok(c.source.length > 5, `chunk ${c.id} has a suspiciously short source`);
      assert.ok(c.tags.length > 0, `chunk ${c.id} has no tags`);
    }
  });

  await test('retrieves fuel/slope chunks for a machinery+heavy-forest query', () => {
    const results = retrieveDoctrine('machinery clearing rate in heavy forest', 3);
    assert.ok(results.length > 0);
    assert.ok(results.some((c) => c.id === 'machinery-fuel-factors'), JSON.stringify(results.map((c) => c.id)));
  });

  await test('retrieves slope-safety chunk for a steep-slope query', () => {
    const results = retrieveDoctrine('is it safe to run a dozer on a steep slope', 3);
    assert.ok(results.some((c) => c.id === 'machinery-slope-limits'), JSON.stringify(results.map((c) => c.id)));
  });

  await test('irrelevant query returns nothing (never forces a citation)', () => {
    const results = retrieveDoctrine('what is the capital of France', 3);
    assert.strictEqual(results.length, 0);
  });

  await test('respects topK', () => {
    const results = retrieveDoctrine('fuel slope rate production machinery handcrew aircraft vegetation', 2);
    assert.ok(results.length <= 2);
  });

  await test('getDoctrineChunk resolves a known id and rejects an unknown one', () => {
    assert.ok(getDoctrineChunk('nwcg-production-tables'));
    assert.strictEqual(getDoctrineChunk('not-a-real-id'), undefined);
  });

  console.log('Numeric claim extraction:');

  await test('extracts decimal + unit claims', () => {
    const claims = extractNumericClaims('The D8 Dozer takes 4.2 h at a cost of $2,100 over a 25° slope.');
    const values = claims.map((c) => `${c.value}${c.unit ?? ''}`);
    assert.ok(values.includes('4.2h'), values.join(", "));
    assert.ok(values.includes('2100$'), values.join(", "));
    assert.ok(values.includes('25°'), values.join(", "));
  });

  await test('extracts plain metre/percent/km values', () => {
    const claims = extractNumericClaims('The line is 943 m long, crossing 35% heavy forest, or 1.85 km total.');
    const values = claims.map((c) => `${c.value}${c.unit ?? ''}`);
    assert.ok(values.includes('943m'), values.join(", "));
    assert.ok(values.includes('35%'), values.join(", "));
    assert.ok(values.includes('1.85km'), values.join(", "));
  });

  await test('ignores bare small integers without units (low fabrication risk)', () => {
    const claims = extractNumericClaims('This is one of 3 compatible options out of 7 total.');
    assert.strictEqual(claims.length, 0, JSON.stringify(claims));
  });

  await test('does not ignore a bare integer with a unit or decimal', () => {
    const claims = extractNumericClaims('Max slope reaches 8° and the crew needs 2 h.');
    const values = claims.map((c) => `${c.value}${c.unit ?? ''}`);
    assert.ok(values.includes('8°'), values.join(", "));
    assert.ok(values.includes('2h'), values.join(", "));
  });

  await test('deduplicates repeated identical claims', () => {
    const claims = extractNumericClaims('4.2 h is the estimate. Again: 4.2 h.');
    assert.strictEqual(claims.length, 1);
  });

  console.log('Citation extraction:');

  await test('extracts one or more [[doc:ID]] markers', () => {
    const ids = extractCitationIds('Dozers slow on steep ground [[doc:machinery-slope-limits]] and in heavy fuel [[doc:machinery-fuel-factors]].');
    assert.deepStrictEqual(ids.sort(), ['machinery-fuel-factors', 'machinery-slope-limits']);
  });

  await test('returns no citations when none present', () => {
    assert.deepStrictEqual(extractCitationIds('No citations here.'), []);
  });

  console.log('Payload number flattening:');

  await test('flattens nested numbers from an arbitrary object/array payload', () => {
    const nums = flattenPayloadNumbers({
      distance: 943,
      trackAnalysis: { maxSlope: 25.4, segments: [{ slope: 3 }, { slope: 8.1 }] },
      calculations: [{ time: 4.2, cost: 2100 }],
    });
    assert.ok(nums.has(943));
    assert.ok(nums.has(25.4));
    assert.ok(nums.has(8.1));
    assert.ok(nums.has(4.2));
    assert.ok(nums.has(2100));
  });

  console.log('Grounded response validation (the anti-hallucination gate):');

  const chunks = retrieveDoctrine('machinery slope fuel', 3);
  const payload = { distance: 943, trackAnalysis: { maxSlope: 25.4 }, calculations: [{ time: 4.2, cost: 2100 }] };

  await test('accepts a response whose numbers all come from the payload', () => {
    const text = `At ${payload.distance} m with a max slope of 25° the fastest option is ${payload.calculations[0].time} h for $${payload.calculations[0].cost}.`;
    const result = validateGroundedResponse(text, payload, chunks);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
  });

  await test('accepts a rounded restatement of a payload number (tolerance)', () => {
    const text = `The line is roughly 943 m and takes about 4 h.`; // 4.2 rounds to 4
    const result = validateGroundedResponse(text, payload, chunks);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
  });

  await test('rejects a fabricated number not present anywhere in the payload', () => {
    const text = `This line is only ${payload.distance} m but will cost $9,999 — a bargain!`;
    const result = validateGroundedResponse(text, payload, chunks);
    assert.strictEqual(result.ok, false);
    assert.ok(result.unmatchedNumbers.some((n) => n.includes('9999') || n.includes('9,999')), JSON.stringify(result.unmatchedNumbers));
  });

  await test('rejects a citation to a doctrine chunk that was not retrieved', () => {
    const text = `Aircraft coverage drops in heavy forest [[doc:aircraft-coverage-model]].`; // not in `chunks` (machinery/slope/fuel query)
    const result = validateGroundedResponse(text, payload, chunks);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.unknownCitations, ['aircraft-coverage-model']);
  });

  await test('accepts a response with zero numeric claims and zero citations', () => {
    const result = validateGroundedResponse('Check the Equipment tab for compatible options.', payload, chunks);
    assert.strictEqual(result.ok, true);
  });

  console.log('System prompt contract:');

  await test('system prompt states the never-compute rule and inlines only retrieved citations', () => {
    const prompt = buildSystemPrompt(chunks);
    assert.ok(prompt.includes('Never compute, estimate'));
    assert.ok(prompt.includes('[[doc:'));
    for (const c of chunks) assert.ok(prompt.includes(c.id));
  });

  await test('system prompt with no retrieved chunks tells the model not to cite anything', () => {
    const prompt = buildSystemPrompt([]);
    assert.ok(prompt.toLowerCase().includes('do not cite'));
  });

  console.log(`\n${passed} checks passed`);
}

main();
