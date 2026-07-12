/**
 * Unit tests for the saved-plans feature's pure/network-mockable parts:
 * input validation, table-entity mapping, and the suite auth service
 * (Station Manager token validation with a stubbed fetch). Plain node +
 * assert (matches the project's framework-free test convention).
 * Run after build: node ./dist/src/test/savedPlans.test.js
 */

import * as assert from 'node:assert';
import {
  MAX_PLAN_DATA_LENGTH,
  MAX_PLAN_NAME_LENGTH,
  fromTableEntity,
  toTableEntity,
  validateSavedPlanInput,
} from '../models/savedPlan';
import {
  _clearSuiteAuthCache,
  extractBearerToken,
  validateSuiteToken,
} from '../services/suiteAuthService';

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ME_PAYLOAD = {
  id: 'user-1',
  username: 'captain',
  organizationId: 'org-1',
  organization: { planCode: 'basic' },
  entitlements: { fireBreakEnabled: true },
};

async function main() {
  console.log('Saved-plan input validation:');

  await test('accepts a well-formed plan', () => {
    assert.strictEqual(validateSavedPlanInput({ name: 'North break', data: 'eyJ2IjoxfQ' }), null);
  });

  await test('rejects missing/blank name and over-long name', () => {
    assert.ok(validateSavedPlanInput({ data: 'abc' }));
    assert.ok(validateSavedPlanInput({ name: '   ', data: 'abc' }));
    assert.ok(validateSavedPlanInput({ name: 'x'.repeat(MAX_PLAN_NAME_LENGTH + 1), data: 'abc' }));
  });

  await test('rejects missing, oversized, or non-base64url data', () => {
    assert.ok(validateSavedPlanInput({ name: 'p' }));
    assert.ok(validateSavedPlanInput({ name: 'p', data: 'a'.repeat(MAX_PLAN_DATA_LENGTH + 1) }));
    assert.ok(validateSavedPlanInput({ name: 'p', data: 'not+base64url/=' }));
    assert.ok(validateSavedPlanInput({ name: 'p', data: '<script>' }));
  });

  await test('rejects non-object bodies', () => {
    assert.ok(validateSavedPlanInput(null));
    assert.ok(validateSavedPlanInput('str'));
  });

  console.log('Table entity mapping:');

  await test('round-trips a plan through the table entity shape', () => {
    const plan = {
      id: 'p1',
      userId: 'u1',
      name: 'Ridge line',
      data: 'eyJ2IjoxfQ',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T01:00:00.000Z',
    };
    const entity = toTableEntity(plan);
    assert.strictEqual(entity.partitionKey, 'u1');
    assert.strictEqual(entity.rowKey, 'p1');
    assert.deepStrictEqual(fromTableEntity(entity), plan);
  });

  console.log('Suite auth service:');

  await test('extracts bearer tokens case-insensitively', () => {
    assert.strictEqual(extractBearerToken('Bearer abc.def'), 'abc.def');
    assert.strictEqual(extractBearerToken('bearer xyz'), 'xyz');
    assert.strictEqual(extractBearerToken('Basic xyz'), null);
    assert.strictEqual(extractBearerToken(null), null);
  });

  await test('unauthorized without a token; unconfigured without SUITE_AUTH_URL', async () => {
    _clearSuiteAuthCache();
    delete process.env.SUITE_AUTH_URL;
    assert.deepStrictEqual(await validateSuiteToken(null), { status: 'unauthorized' });
    assert.deepStrictEqual(await validateSuiteToken('Bearer t'), { status: 'unconfigured' });
  });

  await test('resolves identity + fireBreakEnabled from /api/auth/me', async () => {
    _clearSuiteAuthCache();
    process.env.SUITE_AUTH_URL = 'https://sm.example/';
    let requestedUrl = '';
    const result = await validateSuiteToken('Bearer tok-1', (async (url: unknown) => {
      requestedUrl = String(url);
      return jsonResponse(200, ME_PAYLOAD);
    }) as typeof fetch);
    assert.strictEqual(requestedUrl, 'https://sm.example/api/auth/me');
    assert.deepStrictEqual(result, {
      status: 'ok',
      user: {
        userId: 'user-1',
        username: 'captain',
        organizationId: 'org-1',
        fireBreakEnabled: true,
        planCode: 'basic',
      },
    });
  });

  await test('treats null entitlements (no org) as fireBreakEnabled=false', async () => {
    _clearSuiteAuthCache();
    process.env.SUITE_AUTH_URL = 'https://sm.example';
    const result = await validateSuiteToken('Bearer tok-2', (async () =>
      jsonResponse(200, { id: 'u2', username: 'solo', organization: null, entitlements: null })) as typeof fetch);
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(result.status === 'ok' && result.user.fireBreakEnabled, false);
  });

  await test('maps 401 to unauthorized and 500/network errors to unavailable', async () => {
    _clearSuiteAuthCache();
    process.env.SUITE_AUTH_URL = 'https://sm.example';
    assert.deepStrictEqual(
      await validateSuiteToken('Bearer bad', (async () => jsonResponse(401, { error: 'nope' })) as typeof fetch),
      { status: 'unauthorized' }
    );
    _clearSuiteAuthCache();
    assert.deepStrictEqual(
      await validateSuiteToken('Bearer sad', (async () => jsonResponse(500, {})) as typeof fetch),
      { status: 'unavailable' }
    );
    _clearSuiteAuthCache();
    assert.deepStrictEqual(
      await validateSuiteToken('Bearer down', (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch),
      { status: 'unavailable' }
    );
  });

  await test('caches a positive validation (second call skips fetch)', async () => {
    _clearSuiteAuthCache();
    process.env.SUITE_AUTH_URL = 'https://sm.example';
    let calls = 0;
    const stub = (async () => {
      calls++;
      return jsonResponse(200, ME_PAYLOAD);
    }) as typeof fetch;
    await validateSuiteToken('Bearer cached', stub);
    await validateSuiteToken('Bearer cached', stub);
    assert.strictEqual(calls, 1);
  });

  await test('does not cache failures', async () => {
    _clearSuiteAuthCache();
    process.env.SUITE_AUTH_URL = 'https://sm.example';
    let calls = 0;
    const stub = (async () => {
      calls++;
      return jsonResponse(503, {});
    }) as typeof fetch;
    await validateSuiteToken('Bearer flaky', stub);
    await validateSuiteToken('Bearer flaky', stub);
    assert.strictEqual(calls, 2);
  });

  console.log(`\n${passed} tests passed${process.exitCode ? ' (with failures)' : ''}`);
}

main();
