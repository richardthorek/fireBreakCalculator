import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { requireFireBreakUser } from './planGate';
import { listOverridesForUser } from '../services/equipmentOverridesStore';

async function equipmentOverrideList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const gate = await requireFireBreakUser(req);
  if ('response' in gate) return gate.response;

  try {
    const overrides = await listOverridesForUser(gate.user.userId);
    return { status: 200, jsonBody: overrides };
  } catch (err: unknown) {
    ctx.error('Equipment override list failed', err);
    return { status: 500, jsonBody: { error: 'Failed to list equipment overrides' } };
  }
}

app.http('equipmentOverrideList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'equipment/overrides',
  handler: equipmentOverrideList,
});
