/**
 * POST /api/assistant/smeacs
 * SMEACS-structured briefing with six NSW RFS doctrinal sections.
 * Body: { payload: AssistantPayload }
 * Returns: SmeacsBriefing — always 200 with a deterministic template (no AI layer yet).
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { AssistantPayload, SmeacsBriefing, isAssistantPayload } from '../types/assistant';
import { buildSmeacsBriefing } from '../services/smeacsBriefingBuilder';

export async function assistantSmeacsBriefing(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  let body: { payload?: AssistantPayload };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
  }

  if (!isAssistantPayload(body.payload)) {
    return { status: 400, jsonBody: { error: 'payload is required and must match AssistantPayload' } };
  }

  const payload = body.payload;

  let briefing: SmeacsBriefing;
  try {
    briefing = buildSmeacsBriefing(payload);
  } catch (error: any) {
    ctx.error('SMEACS briefing builder failed', error?.message);
    return {
      status: 500,
      jsonBody: { error: 'Failed to build briefing' },
      headers: { 'Content-Type': 'application/json' },
    };
  }

  return {
    status: 200,
    jsonBody: briefing,
    headers: { 'Content-Type': 'application/json' },
  };
}

app.http('assistantSmeacsBriefing', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'assistant/smeacs',
  handler: assistantSmeacsBriefing,
});
