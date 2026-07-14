/**
 * Bushie Tools suite authentication client (Phase 1 federation).
 *
 * Station Manager is the suite identity provider: users sign in with their
 * Station Manager account and this app validates that token and reads the
 * org's entitlements (`fireBreakEnabled` gates cloud saved plans). The token
 * is stored under the suite-wide localStorage key `auth_token`.
 *
 * Configuration: VITE_SUITE_AUTH_URL — base URL of the Station Manager
 * deployment. When unset, account features are hidden entirely and the
 * calculator remains the fully anonymous public tool it always was.
 */

const RAW_URL = (import.meta.env.VITE_SUITE_AUTH_URL as string | undefined) || '';
export const SUITE_AUTH_URL = RAW_URL.trim().replace(/\/+$/, '');

/** Suite-wide token storage key (see Station Manager's suite-token-validation doc). */
const TOKEN_KEY = 'auth_token';

export interface SuiteSession {
  token: string;
  userId: string;
  username: string;
  organizationId?: string;
  organizationName?: string;
  planCode: string | null;
  /** True when the org's plan includes the Fire Break Calculator. */
  fireBreakEnabled: boolean;
}

/** Whether suite sign-in is configured for this deployment. */
export function isSuiteAuthConfigured(): boolean {
  return SUITE_AUTH_URL.length > 0;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode) — session lasts until reload only.
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/**
 * Authorization header for the metered API endpoints (analysis, assistant,
 * elevation). A valid token lifts the caller into the higher server-side rate
 * limit tier; anonymous callers simply send no header and get the anon tier.
 * Returns an empty object when signed out so callers can always spread it.
 */
export function authHeader(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface MeResponse {
  id: string;
  username: string;
  organizationId?: string;
  organization?: { name?: string; planCode?: string } | null;
  entitlements?: { fireBreakEnabled?: boolean } | null;
}

/** Resolve a token into a full session via GET /api/auth/me. Returns null on 401. */
async function fetchSession(token: string): Promise<SuiteSession | null> {
  const res = await fetch(`${SUITE_AUTH_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error('Account service unavailable');
  const me = (await res.json()) as MeResponse;
  return {
    token,
    userId: me.id,
    username: me.username,
    organizationId: me.organizationId,
    organizationName: me.organization?.name,
    planCode: me.organization?.planCode ?? null,
    fireBreakEnabled: me.entitlements?.fireBreakEnabled === true,
  };
}

/** Sign in with Station Manager credentials. Throws with a friendly message on failure. */
export async function signIn(username: string, password: string): Promise<SuiteSession> {
  let res: Response;
  try {
    res = await fetch(`${SUITE_AUTH_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('Could not reach the account service. Check your connection.');
  }
  if (res.status === 401) throw new Error('Invalid username or password');
  if (res.status === 429) throw new Error('Too many attempts — wait a minute and try again');
  if (!res.ok) throw new Error('Sign-in failed. Try again shortly.');

  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('Sign-in failed. Try again shortly.');

  const session = await fetchSession(body.token);
  if (!session) throw new Error('Sign-in failed. Try again shortly.');
  storeToken(body.token);
  return session;
}

/** Restore a session from a stored token; clears the token if it has expired. */
export async function restoreSession(): Promise<SuiteSession | null> {
  if (!isSuiteAuthConfigured()) return null;
  const token = getStoredToken();
  if (!token) return null;
  try {
    const session = await fetchSession(token);
    if (!session) clearStoredToken();
    return session;
  } catch {
    // Service unreachable — keep the token; the user may be offline.
    return null;
  }
}

export function signOut(): void {
  clearStoredToken();
}
