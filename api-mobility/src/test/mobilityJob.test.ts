/**
 * Unit tests for `isMobilityJobRequest` — the third webapp/api must-match
 * pair's validator (docs/ROUTE_INTELLIGENCE.md §47.3/§47.6). Plain node +
 * assert, matching the project's framework-free convention.
 * Run after build: node ./dist/api-mobility/src/test/mobilityJob.test.js
 */

import * as assert from 'node:assert';
import { isMobilityJobRequest, MobilityJobRequest } from '../types/mobilityJob';

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

const validRequest: MobilityJobRequest = {
  originBounds: { minLat: -35.3, minLng: 149.1, maxLat: -35.29, maxLng: 149.11 },
  objectiveBounds: { minLat: -35.31, minLng: 149.12, maxLat: -35.3, maxLng: 149.13 },
  moverProfileId: 'foot-standard',
  nightMode: false,
  fidelity: 'standard',
};

console.log('MobilityJobRequest validator:');

test('accepts a well-formed request', () => {
  assert.strictEqual(isMobilityJobRequest(validRequest), true);
});

test('rejects missing originBounds', () => {
  const { originBounds, ...rest } = validRequest;
  assert.strictEqual(isMobilityJobRequest(rest), false);
});

test('rejects an inverted bounding box (maxLat <= minLat)', () => {
  const bad = { ...validRequest, originBounds: { minLat: -35.29, minLng: 149.1, maxLat: -35.3, maxLng: 149.11 } };
  assert.strictEqual(isMobilityJobRequest(bad), false);
});

test('rejects an unknown fidelity value', () => {
  const bad = { ...validRequest, fidelity: 'ultra' };
  assert.strictEqual(isMobilityJobRequest(bad), false);
});

test('rejects a non-boolean nightMode', () => {
  const bad = { ...validRequest, nightMode: 'false' };
  assert.strictEqual(isMobilityJobRequest(bad), false);
});

test('rejects an empty moverProfileId', () => {
  const bad = { ...validRequest, moverProfileId: '' };
  assert.strictEqual(isMobilityJobRequest(bad), false);
});

test('rejects null/undefined/non-object input', () => {
  assert.strictEqual(isMobilityJobRequest(null), false);
  assert.strictEqual(isMobilityJobRequest(undefined), false);
  assert.strictEqual(isMobilityJobRequest('not an object'), false);
});

if (passed === 7) {
  console.log(`All ${passed} tests passed.`);
} else {
  process.exitCode = 1;
}
