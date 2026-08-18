import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { requireFireBreakUser } from './planGate';
import { sanitizeOverrideFields } from '../models/equipmentOverride';
import { upsertOverride } from '../services/equipmentOverridesStore';

const VALID_TYPES = ['Machinery', 'Aircraft', 'HandCrew'];
// Generous ceiling — a field patch is a handful of numbers/strings, never
// anywhere near this. Guards against a malformed/oversized body.
const MAX_FIELDS_JSON_LENGTH = 20_000;

async function equipmentOverrideSet(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const gate = await requireFireBreakUser(req);
  if ('response' in gate) return gate.response;

  const equipmentId = req.params.id;
  if (!equipmentId) return { status: 400, jsonBody: { error: 'Equipment id is required' } };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { status: 400, jsonBody: { error: 'Request body must be valid JSON' } };
  }

  const { equipmentType, fields } = (body || {}) as { equipmentType?: unknown; fields?: unknown };
  if (typeof equipmentType !== 'string' || !VALID_TYPES.includes(equipmentType)) {
    return { status: 400, jsonBody: { error: 'equipmentType must be one of Machinery, Aircraft, HandCrew' } };
  }
  const sanitized = sanitizeOverrideFields(fields);
  if (Object.keys(sanitized).length === 0) {
    return { status: 400, jsonBody: { error: 'fields must include at least one overridable value' } };
  }
  if (JSON.stringify(sanitized).length > MAX_FIELDS_JSON_LENGTH) {
    return { status: 400, jsonBody: { error: 'fields payload is too large' } };
  }

  try {
    const override = {
      userId: gate.user.userId,
      equipmentId,
      equipmentType: equipmentType as 'Machinery' | 'Aircraft' | 'HandCrew',
      fields: sanitized,
      updatedAt: new Date().toISOString(),
    };
    await upsertOverride(override);
    return { status: 200, jsonBody: override };
  } catch (err: unknown) {
    ctx.error('Equipment override set failed', err);
    return { status: 500, jsonBody: { error: 'Failed to save equipment override' } };
  }
}

app.http('equipmentOverrideSet', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'equipment/overrides/{id}',
  handler: equipmentOverrideSet,
});
