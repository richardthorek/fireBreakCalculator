import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { requireFireBreakUser } from './planGate';
import { deletePlan } from '../services/savedPlansStore';

async function planDelete(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const gate = await requireFireBreakUser(req);
  if ('response' in gate) return gate.response;

  const planId = req.params.id;
  if (!planId) return { status: 400, jsonBody: { error: 'Plan id is required' } };

  try {
    // Deletion is partition-scoped to the caller's own user id.
    const deleted = await deletePlan(gate.user.userId, planId);
    if (!deleted) return { status: 404, jsonBody: { error: 'Plan not found' } };
    return { status: 204 };
  } catch (err: unknown) {
    ctx.error('Saved-plan delete failed', err);
    return { status: 500, jsonBody: { error: 'Failed to delete plan' } };
  }
}

app.http('planDelete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'plans/{id}',
  handler: planDelete,
});
