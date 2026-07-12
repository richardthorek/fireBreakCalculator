import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { requireFireBreakUser } from './planGate';
import { listPlansForUser } from '../services/savedPlansStore';

async function planList(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const gate = await requireFireBreakUser(req);
  if ('response' in gate) return gate.response;

  try {
    const plans = await listPlansForUser(gate.user.userId);
    return { status: 200, jsonBody: plans };
  } catch (err: unknown) {
    ctx.error('Saved-plan list failed', err);
    return { status: 500, jsonBody: { error: 'Failed to list saved plans' } };
  }
}

app.http('planList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'plans',
  handler: planList,
});
