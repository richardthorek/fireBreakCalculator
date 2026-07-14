/**
 * Lightweight per-client rate limiting for the anonymous-accessible,
 * cost-bearing endpoints (analysis, assistant, elevation).
 *
 * Why: these endpoints are `authLevel: 'anonymous'` and fan out to metered
 * upstreams (AI Foundry tokens, DEM/ArcGIS, Mapbox) on serverless consumption
 * billing. Without a cap, a scraped client bundle or a scripted caller is an
 * unmetered wallet-drain. This is the first, cheap layer: a fixed-window
 * counter keyed by client IP, with a generous tier for signed-in suite users.
 *
 * Limitations (documented deliberately, not hidden):
 *  - In-memory, so the window is per Function *instance*. On scale-out an
 *    abuser spread across instances gets a higher effective ceiling. It still
 *    caps a single hot caller hitting one instance, which is the common case,
 *    and degrades safely. A durable store (Table Storage) is the follow-up if
 *    precise global limits are ever needed.
 *  - Best-effort IP extraction from x-forwarded-for; behind some proxies this
 *    is a chain — we take the first hop.
 *
 * All thresholds are env-overridable so an operator can tighten or loosen
 * without a code change.
 */

import { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateSuiteToken } from './suiteAuthService';

interface WindowState {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, WindowState>();
// Bound memory: clear the whole map if it grows pathologically (a crude but
// safe guard — worst case a brief window reset for everyone on that instance).
const MAX_BUCKETS = 10_000;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Window length shared by both tiers. */
function windowMs(): number {
  return intFromEnv('RATE_LIMIT_WINDOW_SEC', 60) * 1000;
}
/** Requests/window allowed for anonymous (no valid suite token) callers. */
function anonLimit(): number {
  return intFromEnv('RATE_LIMIT_ANON_PER_MIN', 30);
}
/** Requests/window allowed for signed-in suite callers. */
function authedLimit(): number {
  return intFromEnv('RATE_LIMIT_AUTHED_PER_MIN', 300);
}

/** Best-effort client IP for keying. Falls back to a shared bucket. */
export function getClientIp(req: HttpRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    // "client, proxy1, proxy2" — the first hop is the caller. SWA may append a
    // port (ip:port); strip it.
    const first = fwd.split(',')[0].trim();
    return first.replace(/:\d+$/, '') || 'unknown';
  }
  return req.headers.get('x-client-ip')?.trim() || 'unknown';
}

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

/** Fixed-window check + increment. */
export function hitRateLimit(key: string, limit: number): RateDecision {
  const now = Date.now();
  const win = windowMs();
  let state = buckets.get(key);
  if (!state || state.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
    state = { count: 0, resetAt: now + win };
    buckets.set(key, state);
  }
  state.count += 1;
  const remaining = Math.max(0, limit - state.count);
  const retryAfterSec = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  return { allowed: state.count <= limit, limit, remaining, retryAfterSec };
}

/** Test seam. */
export function _clearRateLimitBuckets(): void {
  buckets.clear();
}

/**
 * Guard a handler. Resolves the caller's tier (signed-in suite users get the
 * higher ceiling), applies the fixed-window limit, and returns a 429 response
 * to send back when exceeded — or null to proceed. Never throws: on any
 * internal error it fails open so a limiter bug can't take the endpoint down.
 */
export async function enforceRateLimit(
  req: HttpRequest,
  ctx: InvocationContext,
  routeTag: string
): Promise<HttpResponseInit | null> {
  try {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return null;

    let tier = 'anon';
    let limit = anonLimit();
    // A present, valid suite token lifts the tier. No token → cheap short
    // circuit inside validateSuiteToken (no network call).
    const auth = req.headers.get('authorization');
    if (auth) {
      const result = await validateSuiteToken(auth);
      if (result.status === 'ok') {
        tier = 'authed';
        limit = authedLimit();
      }
    }

    const key = `${routeTag}:${tier}:${getClientIp(req)}`;
    const decision = hitRateLimit(key, limit);
    if (decision.allowed) return null;

    ctx.warn('Rate limit exceeded', { routeTag, tier, limit });
    return {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(decision.retryAfterSec),
      },
      jsonBody: {
        error:
          tier === 'anon'
            ? 'Rate limit reached for anonymous use. Sign in with your Bushie Tools account for a higher limit, or wait a moment and try again.'
            : 'Rate limit reached. Wait a moment and try again.',
        retryAfterSec: decision.retryAfterSec,
      },
    };
  } catch (err) {
    ctx.warn('Rate limiter error — failing open', err);
    return null;
  }
}
