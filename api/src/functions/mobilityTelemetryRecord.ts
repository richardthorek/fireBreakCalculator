import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { RestError } from '@azure/data-tables';
import { enforceRateLimit } from '../services/rateLimit';
import { getMobilityTelemetryTableClient } from '../data/tableClient';
import { MobilityRunTelemetry, toTableEntity } from '../models/mobilityTelemetry';

/**
 * POST /api/mobility-telemetry
 *
 * Fire-and-forget sink for Terrain Mobility run scale/performance metadata —
 * cell counts, terrain/veg difficulty mix, elapsed time by phase, device
 * hints. No location, no user identity. Purpose: build the evidence base for
 * the cloud-offload threshold decision in docs/ROUTE_INTELLIGENCE.md "Cloud
 * offload for large-area analysis" — a fixed cell-count cutoff can't account
 * for the device-performance spread this is meant to characterise (a
 * high-end laptop and a mid-range one differ by more than any plausible
 * single threshold), so this collects real runs instead of guessing.
 *
 * Always returns 202 on a structurally valid payload, even if the table
 * write fails — telemetry must never surface as an error to the caller, and
 * the caller (webapp) already treats this as best-effort/fire-and-forget.
 */

let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  try {
    await getMobilityTelemetryTableClient().createTable();
  } catch (err) {
    if (!(err instanceof RestError && err.statusCode === 409)) {
      // fall through — the insert below will report a real failure
    }
  }
  tableEnsured = true;
}

function isValidPayload(body: unknown): body is MobilityRunTelemetry {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.sessionId === 'string' &&
    typeof b.timestamp === 'string' &&
    typeof b.profileId === 'string' &&
    typeof b.cellCount === 'number' &&
    typeof b.elapsedMs === 'number'
  );
}

async function mobilityTelemetryRecord(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const limited = await enforceRateLimit(req, ctx, 'telemetry');
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { status: 400, jsonBody: { error: 'invalid JSON body' } };
  }
  if (!isValidPayload(body)) {
    return { status: 400, jsonBody: { error: 'missing required telemetry fields' } };
  }

  try {
    await ensureTable();
    const client = getMobilityTelemetryTableClient();
    await client.createEntity(toTableEntity(body));
  } catch (err) {
    // Best-effort by design (see module comment) — log and still return 202.
    ctx.warn('mobility-telemetry write failed', err);
  }
  return { status: 202 };
}

app.http('mobilityTelemetryRecord', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'mobility-telemetry',
  handler: mobilityTelemetryRecord,
});
