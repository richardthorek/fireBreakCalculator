import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

/**
 * POST /api/auth/login
 *
 * Browser-side proxy for StationKit (Station Manager) authentication.
 * The browser calls this same-origin endpoint instead of Station Manager
 * directly, avoiding CORS failures. The backend forwards the request to
 * Station Manager server-side where CORS doesn't apply.
 */
async function authLogin(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const suiteAuthUrl = process.env.SUITE_AUTH_URL?.trim().replace(/\/+$/, '');
    if (!suiteAuthUrl) {
      return { status: 501, jsonBody: { error: 'Suite authentication not configured' } };
    }

    const body = (await req.json()) as any;
    const { username, password } = body;
    if (!username || !password) {
      return { status: 400, jsonBody: { error: 'username and password required' } };
    }

    const res = await fetch(`${suiteAuthUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const responseBody = await res.json();
    return {
      status: res.status,
      jsonBody: responseBody,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (error: any) {
    ctx.warn('Auth login proxy failed', error?.message);
    return { status: 502, jsonBody: { error: 'Account service unavailable' } };
  }
}

/**
 * POST /api/auth/passkey/login/options
 *
 * Server-side proxy for WebAuthn passkey login ceremony options.
 * The browser calls this same-origin endpoint to get the credential request
 * options from Station Manager, avoiding CORS failures on the options endpoint.
 */
async function passkeyLoginOptions(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const suiteAuthUrl = process.env.SUITE_AUTH_URL?.trim().replace(/\/+$/, '');
    if (!suiteAuthUrl) {
      return { status: 501, jsonBody: { error: 'Suite authentication not configured' } };
    }

    const res = await fetch(`${suiteAuthUrl}/api/auth/passkey/login/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const responseBody = await res.json();
    return {
      status: res.status,
      jsonBody: responseBody,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (error: any) {
    ctx.warn('Passkey login options proxy failed', error?.message);
    return { status: 502, jsonBody: { error: 'Account service unavailable' } };
  }
}

/**
 * POST /api/auth/passkey/login/verify
 *
 * Server-side proxy for WebAuthn passkey login verification.
 * The browser calls this same-origin endpoint to verify the passkey
 * assertion with Station Manager, avoiding CORS failures on the verify endpoint.
 */
async function passkeyLoginVerify(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const suiteAuthUrl = process.env.SUITE_AUTH_URL?.trim().replace(/\/+$/, '');
    if (!suiteAuthUrl) {
      return { status: 501, jsonBody: { error: 'Suite authentication not configured' } };
    }

    const body = (await req.json()) as any;
    const { flowId, response } = body;
    if (!flowId || !response) {
      return { status: 400, jsonBody: { error: 'flowId and response required' } };
    }

    const res = await fetch(`${suiteAuthUrl}/api/auth/passkey/login/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flowId, response }),
    });

    const responseBody = await res.json();
    return {
      status: res.status,
      jsonBody: responseBody,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (error: any) {
    ctx.warn('Passkey login verify proxy failed', error?.message);
    return { status: 502, jsonBody: { error: 'Account service unavailable' } };
  }
}

app.http('auth', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: authLogin,
});

app.http('passkeyLoginOptions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/passkey/login/options',
  handler: passkeyLoginOptions,
});

app.http('passkeyLoginVerify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/passkey/login/verify',
  handler: passkeyLoginVerify,
});
