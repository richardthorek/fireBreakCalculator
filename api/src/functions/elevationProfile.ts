import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getElevationProfile, LatLng } from '../services/elevationService';

/**
 * POST /api/elevation/profile
 * Body: { points: [{ lat, lng }, ...] }
 * Returns: { elevations: number[], source, estimated }
 *
 * One request per drawn line instead of hundreds of client-side tile fetches.
 * When no DEM endpoint is configured (DEM_IMAGESERVER_URL) the response is
 * `source: 'unavailable'` and the client falls back to Terrain-RGB sampling.
 */
async function elevationProfile(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    let body: { points?: LatLng[] };
    try {
      body = JSON.parse(await req.text());
    } catch {
      return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
    }

    const points = Array.isArray(body.points) ? body.points : [];
    if (points.length === 0) {
      return { status: 400, jsonBody: { error: 'points[] is required' } };
    }
    if (points.length > 5000) {
      return { status: 400, jsonBody: { error: 'Too many points (max 5000)' } };
    }
    for (const p of points) {
      if (typeof p?.lat !== 'number' || typeof p?.lng !== 'number') {
        return { status: 400, jsonBody: { error: 'Each point needs numeric lat and lng' } };
      }
    }

    const result = await getElevationProfile(points);
    return {
      status: 200,
      jsonBody: result,
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (error: any) {
    ctx.error('Elevation profile failed', error);
    return { status: 500, jsonBody: { error: 'Failed to fetch elevation profile', details: error?.message } };
  }
}

app.http('elevationProfile', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'elevation/profile',
  handler: elevationProfile,
});
