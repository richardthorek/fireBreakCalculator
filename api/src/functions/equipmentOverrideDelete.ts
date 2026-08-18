import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { requireFireBreakUser } from './planGate';
import { deleteOverride } from '../services/equipmentOverridesStore';

/** Revert one item to the platform default by deleting the caller's override. */
async function equipmentOverrideDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const gate = await requireFireBreakUser(req);
  if ('response' in gate) return gate.response;

  const equipmentId = req.params.id;
  if (!equipmentId) return { status: 400, jsonBody: { error: 'Equipment id is required' } };

  try {
    await deleteOverride(gate.user.userId, equipmentId);
    // Idempotent revert-to-default: no override present is not an error.
    return { status: 204 };
  } catch (err: unknown) {
    ctx.error('Equipment override delete failed', err);
    return { status: 500, jsonBody: { error: 'Failed to revert equipment override' } };
  }
}

app.http('equipmentOverrideDelete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'equipment/overrides/{id}',
  handler: equipmentOverrideDelete,
});
