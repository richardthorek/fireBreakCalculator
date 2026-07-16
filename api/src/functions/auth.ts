import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

/**
 * POST /api/auth/login
 *
 * Browser-side proxy for Bushie Tools (Station Manager) authentication.
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

app.http('auth', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: authLogin,
});
