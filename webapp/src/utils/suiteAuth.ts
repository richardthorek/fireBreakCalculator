/**
 * StationKit suite authentication client.
 *
 * Station Manager is the suite identity provider: users sign in with their
 * Station Manager account and this app validates that token and reads the
 * org's entitlements (`fireBreakEnabled` gates cloud saved plans). The token
 * is stored under the suite-wide localStorage key `auth_token`.
 *
 * Phase 2 — silent cross-subdomain SSO: `restoreSession()` first tries
 * Station Manager's `GET /api/auth/session` with `credentials: 'include'`,
 * which reads the shared `sk_session` httpOnly cookie (set on login/signup,
 * scoped to the `.stationkit.com.au` parent domain) and returns a fresh
 * bearer token if the visitor is already signed in elsewhere in the suite —
 * no redirect, no separate Fire Break Calculator login. Falls back to a
 * locally stored token (Phase 1 behaviour) when there's no cookie session
 * (different domain, signed out suite-wide, or cookies blocked).
 *
 * Passkey sign-in (signInWithPasskey): registration only happens in Station
 * Manager's own account settings, but sign-in works directly from this app's
 * own sign-in form — the WebAuthn Relying Party ID is the shared
 * `.stationkit.com.au` parent domain, so this page can run the ceremony
 * itself and just POST the resulting assertion to Station Manager
 * cross-origin. See suite-token-validation.md §1b in the Station-Manager repo.
 *
 * Configuration: VITE_SUITE_AUTH_URL — base URL of the Station Manager
 * deployment. When unset, account features are hidden entirely and the
 * calculator remains the fully anonymous public tool it always was.
 */

import { startAuthentication } from '@simplewebauthn/browser';

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

/** GET /api/auth/session response: the same identity shape as /me, plus a fresh token. */
interface SessionResponse extends MeResponse {
  token: string;
}

function toSuiteSession(token: string, me: MeResponse): SuiteSession {
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

/** Resolve a token into a full session via GET /api/auth/me. Returns null on 401. */
async function fetchSession(token: string): Promise<SuiteSession | null> {
  const res = await fetch(`${SUITE_AUTH_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error('Account service unavailable');
  const me = (await res.json()) as MeResponse;
  return toSuiteSession(token, me);
}

/**
 * Try to bootstrap a session from Station Manager's shared SSO cookie —
 * `credentials: 'include'` sends the httpOnly `sk_session` cookie (scoped to
 * the `.stationkit.com.au` parent domain) if the browser has one. Returns
 * null (never throws) when there's no cookie session, the request is
 * cross-origin without one, or Station Manager is unreachable — callers fall
 * back to the stored-token flow in that case.
 */
async function fetchSilentSession(): Promise<SuiteSession | null> {
  try {
    const res = await fetch(`${SUITE_AUTH_URL}/api/auth/session`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SessionResponse;
    if (!body.token) return null;
    const session = toSuiteSession(body.token, body);
    storeToken(body.token);
    return session;
  } catch {
    return null;
  }
}

/** Sign in with Station Manager credentials. Throws with a friendly message on failure. */
export async function signIn(username: string, password: string): Promise<SuiteSession> {
  let res: Response;
  try {
    res = await fetch('/api/auth/login', {
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

/**
 * Sign in with a passkey. No username is collected — the request carries no
 * allowCredentials, so the browser's own picker shows every passkey it holds
 * for the shared StationKit relying party (a "usernameless"/discoverable
 * flow). Calls the same-origin proxy endpoints, which forward to Station Manager
 * server-side to avoid CORS failures. Throws with a friendly message on failure;
 * a cancelled OS prompt throws a DOMException named 'NotAllowedError' — callers
 * should treat that as a silent no-op, not an error to display.
 */
export async function signInWithPasskey(): Promise<SuiteSession> {
  const optionsRes = await fetch('/api/auth/passkey/login/options', { method: 'POST' });
  if (!optionsRes.ok) throw new Error('Could not start passkey sign-in');
  const { flowId, options } = await optionsRes.json();

  const response = await startAuthentication({ optionsJSON: options });

  const verifyRes = await fetch('/api/auth/passkey/login/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId, response }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || 'Passkey sign-in failed');
  }

  const body = (await verifyRes.json()) as { token?: string };
  if (!body.token) throw new Error('Passkey sign-in failed');

  const session = await fetchSession(body.token);
  if (!session) throw new Error('Passkey sign-in failed');
  storeToken(body.token);
  return session;
}

/**
 * Restore a session, preferring silent cross-subdomain SSO (Station
 * Manager's shared cookie) over a locally stored token so a visitor already
 * signed into another suite app lands here already authenticated too.
 */
export async function restoreSession(): Promise<SuiteSession | null> {
  if (!isSuiteAuthConfigured()) return null;

  const silent = await fetchSilentSession();
  if (silent) return silent;

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

/**
 * Sign out locally and, best-effort, clear the shared suite SSO cookie so
 * other *.stationkit.com.au apps also see the sign-out on their next silent
 * restore — otherwise a page reload here would immediately sign back in via
 * that cookie.
 */
export async function signOut(): Promise<void> {
  const token = getStoredToken();
  clearStoredToken();
  if (!isSuiteAuthConfigured()) return;
  try {
    await fetch(`${SUITE_AUTH_URL}/api/auth/logout`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
  } catch {
    // Best-effort — the local token is already cleared.
  }
}
