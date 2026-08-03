/**
 * Unit tests for the mobility job rate limiter's PURE parts. The Table-
 * Storage-backed window/concurrency logic needs a real (or Azurite)
 * connection, so it is not exercised here — this file covers `getClientIp`
 * only, same scope boundary as `/api`'s own `rateLimit.test.ts`.
 * Run after build: node ./dist/api-mobility/src/test/mobilityJobRateLimit.test.js
 */

import * as assert from 'node:assert';
import { HttpRequest } from '@azure/functions';
import { getClientIp } from '../services/mobilityJobRateLimit';

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

function reqWithHeaders(headers: Record<string, string>): HttpRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null } } as unknown as HttpRequest;
}

console.log('Mobility job rate limiter — getClientIp:');

test('takes the first hop of x-forwarded-for', () => {
  const req = reqWithHeaders({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' });
  assert.strictEqual(getClientIp(req), '203.0.113.5');
});

test('strips a trailing port', () => {
  const req = reqWithHeaders({ 'x-forwarded-for': '203.0.113.5:54321' });
  assert.strictEqual(getClientIp(req), '203.0.113.5');
});

test('falls back to x-client-ip when no forwarded-for header', () => {
  const req = reqWithHeaders({ 'x-client-ip': '198.51.100.9' });
  assert.strictEqual(getClientIp(req), '198.51.100.9');
});

test('falls back to "unknown" with no identifying headers', () => {
  const req = reqWithHeaders({});
  assert.strictEqual(getClientIp(req), 'unknown');
});

if (passed === 4) {
  console.log(`All ${passed} tests passed.`);
} else {
  process.exitCode = 1;
}
