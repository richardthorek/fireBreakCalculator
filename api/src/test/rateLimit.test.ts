/**
 * Unit tests for the rate limiter's pure window logic + IP extraction.
 * Plain node + assert (matches the project's framework-free convention).
 * Run after build: node ./dist/src/test/rateLimit.test.js
 */

import * as assert from 'node:assert';
import { HttpRequest } from '@azure/functions';
import { hitRateLimit, getClientIp, _clearRateLimitBuckets } from '../services/rateLimit';

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

/** Minimal HttpRequest stand-in exposing just the header lookup the code uses. */
function reqWithHeaders(headers: Record<string, string>): HttpRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null } } as unknown as HttpRequest;
}

async function run() {
  console.log('Rate limiter:');

  await test('allows requests up to the limit, then denies', () => {
    _clearRateLimitBuckets();
    const key = 'analysis:anon:1.2.3.4';
    for (let i = 1; i <= 3; i++) {
      const d = hitRateLimit(key, 3);
      assert.strictEqual(d.allowed, true, `request ${i} should be allowed`);
    }
    const over = hitRateLimit(key, 3);
    assert.strictEqual(over.allowed, false, '4th request should be denied');
    assert.ok(over.retryAfterSec >= 1, 'retryAfterSec should be set');
    assert.strictEqual(over.remaining, 0);
  });

  await test('separate keys have independent budgets', () => {
    _clearRateLimitBuckets();
    assert.strictEqual(hitRateLimit('a:anon:ip1', 1).allowed, true);
    assert.strictEqual(hitRateLimit('a:anon:ip1', 1).allowed, false);
    // Different IP — fresh budget.
    assert.strictEqual(hitRateLimit('a:anon:ip2', 1).allowed, true);
    // Different tier tag — fresh budget (authed users aren't capped by anon use).
    assert.strictEqual(hitRateLimit('a:authed:ip1', 1).allowed, true);
  });

  await test('extracts the first hop from x-forwarded-for and strips port', () => {
    assert.strictEqual(getClientIp(reqWithHeaders({ 'x-forwarded-for': '9.9.9.9:443, 10.0.0.1' })), '9.9.9.9');
    assert.strictEqual(getClientIp(reqWithHeaders({ 'x-forwarded-for': '  8.8.8.8  ' })), '8.8.8.8');
    assert.strictEqual(getClientIp(reqWithHeaders({ 'x-client-ip': '7.7.7.7' })), '7.7.7.7');
    assert.strictEqual(getClientIp(reqWithHeaders({})), 'unknown');
  });

  console.log(`\n${passed} checks passed`);
}

run();
