import { randomUUID } from 'node:crypto';
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { requireFireBreakUser } from './planGate';
import { MAX_PLANS_PER_USER, SavedPlan, SavedPlanInput, validateSavedPlanInput } from '../models/savedPlan';
import { createPlan, listPlansForUser } from '../services/savedPlansStore';

async function planCreate(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const gate = await requireFireBreakUser(req);
  if ('response' in gate) return gate.response;

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
    const existing = await listPlansForUser(gate.user.userId);
    if (existing.length >= MAX_PLANS_PER_USER) {
      return {
        status: 409,
        jsonBody: { error: `Plan limit reached (${MAX_PLANS_PER_USER}). Delete a saved plan to make room.` },
      };
    }

    const now = new Date().toISOString();
    const plan: SavedPlan = {
      id: randomUUID(),
      userId: gate.user.userId,
      name: input.name.trim(),
      data: input.data,
      createdAt: now,
      updatedAt: now,
    };
    await createPlan(plan);
    return { status: 201, jsonBody: plan };
  } catch (err: unknown) {
    ctx.error('Saved-plan create failed', err);
    return { status: 500, jsonBody: { error: 'Failed to save plan' } };
  }
}

app.http('planCreate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'plans',
  handler: planCreate,
});
