import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { enforceRateLimit } from '../services/rateLimit';
import {
  getNvisTile, getNswTile, getNvisLegend, isValidTileIndex,
  NVIS_TILE_DEG, NSW_TILE_DEG,
} from '../services/vegetationTileService';

/**
 * GET /api/vegetation/tile/{source}/{tx}/{ty}   (source: nvis | nsw)
 * GET /api/vegetation/legend
 *
 * Shared, cross-user vegetation tile cache (see vegetationTileService for
 * the why and the blob layout). Responses carry a long Cache-Control so each
 * browser also caches its own tiles; the blob layer is what makes an
 * incident area cheap for the SECOND user and everyone after.
 */
async function vegetationTile(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const limited = await enforceRateLimit(req, ctx, 'vegtile');
    if (limited) return limited;

    const source = req.params.source;
    const tx = Number(req.params.tx);
    const ty = Number(req.params.ty);
    if (source !== 'nvis' && source !== 'nsw') {
      return { status: 400, jsonBody: { error: 'source must be nvis or nsw' } };
    }
    const tileDeg = source === 'nvis' ? NVIS_TILE_DEG : NSW_TILE_DEG;
    if (!isValidTileIndex(tx, ty, tileDeg)) {
      return { status: 400, jsonBody: { error: 'tile index out of range' } };
    }

    const result = source === 'nvis' ? await getNvisTile(tx, ty) : await getNswTile(tx, ty);
    ctx.log(`vegetation tile ${source}/${tx}/${ty} ${result.cacheHit ? 'HIT' : 'MISS'}`);
    return {
      status: 200,
      body: result.bytes,
      headers: {
        'Content-Type': result.contentType,
        // Tiles are stable for months; the blob lifecycle rule (90 days) is
        // the source-data refresh. Browsers may hold them for a week.
        'Cache-Control': 'public, max-age=604800',
        'X-Tile-Cache': result.cacheHit ? 'hit' : 'miss',
      },
    };
  } catch (error: any) {
    ctx.warn('vegetation tile fetch failed', error?.message);
    // 502: the upstream (not us) failed — the client falls back to its
    // direct-to-service path, then per-point sampling.
    return { status: 502, jsonBody: { error: 'Upstream vegetation service unavailable' } };
  }
}

async function vegetationLegend(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  try {
    const limited = await enforceRateLimit(req, ctx, 'vegtile');
    if (limited) return limited;
    const result = await getNvisLegend();
    ctx.log(`vegetation legend ${result.cacheHit ? 'HIT' : 'MISS'}`);
    return {
      status: 200,
      body: result.bytes,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=604800',
        'X-Tile-Cache': result.cacheHit ? 'hit' : 'miss',
      },
    };
  } catch (error: any) {
    ctx.warn('vegetation legend fetch failed', error?.message);
    return { status: 502, jsonBody: { error: 'Upstream vegetation service unavailable' } };
  }
}

app.http('vegetationTile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'vegetation/tile/{source}/{tx}/{ty}',
  handler: vegetationTile,
});

app.http('vegetationLegend', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'vegetation/legend',
  handler: vegetationLegend,
});
