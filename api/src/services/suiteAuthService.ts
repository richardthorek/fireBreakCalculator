/**
 * Bushie Tools suite authentication (Phase 1 federation).
 *
 * Station Manager is the suite identity provider: a single sign-in there mints
 * a JWT, and sibling apps validate that same token by calling back into the
 * Station Manager API rather than sharing the signing secret. This service
 * validates a bearer token via `GET /api/auth/me` (identity + organization
 * entitlements in one call) and reports whether the caller's plan includes
 * the Fire Break Calculator (`fireBreakEnabled`).
 *
 * Contract: docs in the Station-Manager repo,
 * `docs/wiki/developer/suite-token-validation.md`.
 *
 * Configuration:
 *   SUITE_AUTH_URL — base URL of the Station Manager deployment
 *                    (e.g. https://bungrfsstation.azurewebsites.net).
 *                    When unset, saved-plan endpoints return 503.
 */

export interface SuiteUser {
  userId: string;
  username: string;
  organizationId?: string;
  /** True when the org's plan grants the Fire Break Calculator. */
  fireBreakEnabled: boolean;
  planCode: string | null;
}

export type SuiteAuthResult =
  | { status: 'ok'; user: SuiteUser }
  | { status: 'unauthorized' }        // missing/invalid/expired token
  | { status: 'unconfigured' }        // SUITE_AUTH_URL not set
  | { status: 'unavailable' };        // Station Manager unreachable / 5xx

interface CacheEntry {
  result: SuiteAuthResult;
  expiresAt: number;
}

/** Positive results cache briefly so a burst of plan operations makes one
 * round-trip to Station Manager, not one per request. Failures are not
 * cached: a just-upgraded plan or recovered network should apply at once. */
const CACHE_TTL_MS = 60_000;
const tokenCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;

function getSuiteAuthUrl(): string | null {
  const url = (process.env.SUITE_AUTH_URL || '').trim().replace(/\/+$/, '');
  return url || null;
}

/** Extract the bearer token from an Authorization header value. */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Test seam: clear the token cache. */
export function _clearSuiteAuthCache(): void {
  tokenCache.clear();
}

/**
 * Validate a Station Manager JWT and resolve the caller's suite identity and
 * Fire Break entitlement. Never throws — outcomes are encoded in the result.
 */
export async function validateSuiteToken(
  authorizationHeader: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<SuiteAuthResult> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) return { status: 'unauthorized' };

  const baseUrl = getSuiteAuthUrl();
  if (!baseUrl) return { status: 'unconfigured' };

  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { status: 'unavailable' };
  }

  if (res.status === 401 || res.status === 403) return { status: 'unauthorized' };
  if (!res.ok) return { status: 'unavailable' };

  let body: {
    id?: unknown;
    username?: unknown;
    organizationId?: unknown;
    organization?: { planCode?: unknown } | null;
    entitlements?: { fireBreakEnabled?: unknown } | null;
  };
  try {
    body = await res.json();
  } catch {
    return { status: 'unavailable' };
  }

  if (typeof body?.id !== 'string' || typeof body?.username !== 'string') {
    return { status: 'unavailable' };
  }

  const result: SuiteAuthResult = {
    status: 'ok',
    user: {
      userId: body.id,
      username: body.username,
      organizationId: typeof body.organizationId === 'string' ? body.organizationId : undefined,
      fireBreakEnabled: body.entitlements?.fireBreakEnabled === true,
      planCode: typeof body.organization?.planCode === 'string' ? body.organization.planCode : null,
    },
  };

  if (tokenCache.size >= MAX_CACHE_ENTRIES) tokenCache.clear();
  tokenCache.set(token, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
