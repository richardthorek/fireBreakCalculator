import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { enforceRateLimit } from '../services/rateLimit';
import { fetchCorridorInfrastructure } from '../services/infrastructureService';

/**
 * GET /api/infrastructure?s={south}&w={west}&n={north}&e={east}
 *
 * Server-side Overpass proxy (see infrastructureService for the why). The
 * browser calls this same-origin endpoint instead of the public Overpass
 * instances directly, which removes the CORS failures those instances cause on
 * their rate-limited/error responses and pools every user behind one server IP
 * with a shared cache. The client falls back to its direct-to-Overpass path
 * when this endpoint is unreachable.
 */
async function infrastructure(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const limited = await enforceRateLimit(req, ctx, 'infra');
    if (limited) return limited;

    const s = Number(req.query.get('s'));
    const w = Number(req.query.get('w'));
    const n = Number(req.query.get('n'));
    const e = Number(req.query.get('e'));
    if (![s, w, n, e].every(Number.isFinite) || s >= n || w >= e) {
      return { status: 400, jsonBody: { error: 'require numeric s<n and w<e query params' } };
    }
    // Guard against an accidental continental query that would time out
    // upstream — corridors are small; anything huge is a bug, not a request.
    if (n - s > 3 || e - w > 3) {
      return { status: 400, jsonBody: { error: 'bounding box too large (max 3° per side)' } };
    }

    const result = await fetchCorridorInfrastructure(s, w, n, e);
    if (!result.available) {
      // Upstream (not us) failed — the client falls back to its direct path.
      return { status: 502, jsonBody: { error: 'Upstream infrastructure service unavailable' } };
    }
    return {
      status: 200,
      jsonBody: result,
      headers: {
        // OSM ways are stable for a rural area; let the browser hold a corridor
        // for a day so repeat/nearby runs are free.
        'Cache-Control': 'public, max-age=86400',
      },
    };
  } catch (error: any) {
    ctx.warn('infrastructure fetch failed', error?.message);
    return { status: 502, jsonBody: { error: 'Upstream infrastructure service unavailable' } };
  }
}

app.http('infrastructure', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'infrastructure',
  handler: infrastructure,
});
