import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { enforceRateLimit } from '../services/rateLimit';
import { fetchWindObservation } from '../services/windService';
import { WindResponse } from '../types/incidentBox';

/**
 * GET /api/wind?lat={lat}&lng={lng}
 *
 * Live wind for the incident-box feature (docs/ROUTE_INTELLIGENCE.md
 * "Incident box"). Proxies Open-Meteo server-side so the browser gets a
 * same-origin, cached, rate-limited call instead of hitting a third-party
 * API directly from every client. Returns 502 on upstream failure — the
 * frontend falls back to manual wind entry, never silently to a guess.
 */
async function wind(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const limited = await enforceRateLimit(req, ctx, 'wind');
    if (limited) return limited;

    const lat = Number(req.query.get('lat'));
    const lng = Number(req.query.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { status: 400, jsonBody: { error: 'require numeric lat/lng query params' } };
    }

    const observation = await fetchWindObservation(lat, lng);
    if (!observation) {
      return { status: 502, jsonBody: { error: 'Upstream wind service unavailable' } };
    }

    const body: WindResponse = { ...observation, lat, lng };
    return {
      status: 200,
      jsonBody: body,
      headers: {
        // Wind moves fast; keep the browser cache short.
        'Cache-Control': 'public, max-age=300',
      },
    };
  } catch (error: any) {
    ctx.warn('wind fetch failed', error?.message);
    return { status: 502, jsonBody: { error: 'Upstream wind service unavailable' } };
  }
}

app.http('wind', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'wind',
  handler: wind,
});
