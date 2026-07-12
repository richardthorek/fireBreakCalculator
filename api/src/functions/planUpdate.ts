import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { requireFireBreakUser } from './planGate';
import { SavedPlanInput, validateSavedPlanInput } from '../models/savedPlan';
import { getPlan, updatePlan } from '../services/savedPlansStore';

async function planUpdate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const gate = await requireFireBreakUser(req);
  if ('response' in gate) return gate.response;

  const planId = req.params.id;
  if (!planId) return { status: 400, jsonBody: { error: 'Plan id is required' } };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { status: 400, jsonBody: { error: 'Request body must be valid JSON' } };
  }

  const validationError = validateSavedPlanInput(body);
  if (validationError) return { status: 400, jsonBody: { error: validationError } };
  const input = body as SavedPlanInput;

  try {
    // Partition-scoped lookup: a user can only ever address their own plans.
    const existing = await getPlan(gate.user.userId, planId);
    if (!existing) return { status: 404, jsonBody: { error: 'Plan not found' } };

    const updated = {
      ...existing,
      name: input.name.trim(),
      data: input.data,
      updatedAt: new Date().toISOString(),
    };
    await updatePlan(updated);
    return { status: 200, jsonBody: updated };
  } catch (err: unknown) {
    ctx.error('Saved-plan update failed', err);
    return { status: 500, jsonBody: { error: 'Failed to update plan' } };
  }
}

app.http('planUpdate', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'plans/{id}',
  handler: planUpdate,
});
