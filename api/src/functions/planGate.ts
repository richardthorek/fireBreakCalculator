// Shared auth gate for the saved-plans endpoints. Not an Azure Function
// itself — it registers nothing; the plan* function files import it.

import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { SuiteUser, validateSuiteToken } from '../services/suiteAuthService';

export type GateResult = { user: SuiteUser } | { response: HttpResponseInit };

/**
 * Resolve the Station Manager identity for a request and enforce the
 * fireBreakEnabled entitlement. Returns either the authenticated user or the
 * HTTP response to send straight back.
 */
export async function requireFireBreakUser(req: HttpRequest): Promise<GateResult> {
  const result = await validateSuiteToken(req.headers.get('authorization'));

  switch (result.status) {
    case 'ok':
      if (!result.user.fireBreakEnabled) {
        return {
          response: {
            status: 403,
            jsonBody: {
              error: 'Your plan does not include the Fire Break Calculator. Upgrade your Station Manager subscription to save plans.',
              feature: 'fireBreakEnabled',
            },
          },
        };
      }
      return { user: result.user };
    case 'unauthorized':
      return { response: { status: 401, jsonBody: { error: 'Sign in with your Station Manager account to use saved plans.' } } };
    case 'unconfigured':
      return { response: { status: 503, jsonBody: { error: 'Saved plans are not configured on this deployment (SUITE_AUTH_URL is unset).' } } };
    case 'unavailable':
      return { response: { status: 502, jsonBody: { error: 'Could not reach the subscription service. Try again shortly.' } } };
  }
}
