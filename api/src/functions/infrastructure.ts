import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { enforceRateLimit } from '../services/rateLimit';
import { fetchCorridorInfrastructure } from '../services/infrastructureService';

/**
 * GET /api/infrastructure?s={south}&w={west}&n={north}&e={east}&kind={highway|water}
 *
 * Server-side Overpass proxy (see infrastructureService for the why). The
 * browser calls this same-origin endpoint instead of the public Overpass
 * instances directly, which removes the CORS failures those instances cause on
 * their rate-limited/error responses and pools every user behind one server IP
 * with a shared cache. The client falls back to its direct-to-Overpass path
 * when this endpoint is unreachable.
 *
 * `kind` (default `highway`): `water` fetches waterway/water-body geometry
 * for the Terrain Mobility hydrology gate (docs §34); `highway-mobility`
 * fetches the wider movement/denial road set — including motorway/trunk/
 * primary, each way carrying surface/tracktype/smoothness — for the road
 * network graph (docs §35). Same endpoint, same resilience, one extra query
 * branch each, rather than a second/third proxy route.
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
    const kindParam = req.query.get('kind');
    const kind =
      kindParam === 'water' ? 'water' :
      kindParam === 'highway-mobility' ? 'highway-mobility' :
      'highway';

    const result = await fetchCorridorInfrastructure(s, w, n, e, kind);
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
