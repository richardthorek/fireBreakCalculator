import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { AssistantPayload, AssistantResponse, isAssistantPayload } from '../types/assistant';
import { retrieveDoctrine } from '../services/knowledgeBase';
import { buildRealityCheckSystemPrompt, validateGroundedResponse, extractCitationIds } from '../services/aiGrounding';
import { callChatCompletion, isAiAssistantConfigured } from '../services/aiFoundryClient';
import { buildTemplateRealityCheck } from '../services/realityCheckTemplate';
import { enforceRateLimit } from '../services/rateLimit';

function buildQuery(payload: AssistantPayload): string {
  const equipmentTypes = payload.topEquipment.map((e) => e.type).join(' ');
  const slopeWord = payload.maxSlopeDeg >= 25 ? 'steep slope safety' : 'slope';
  return `${equipmentTypes} ${payload.predominantVegetation} ${slopeWord} fire break production rate`;
}

/**
 * POST /api/assistant/reality-check
 * Body: { payload: AssistantPayload }
 * Returns: AssistantResponse — the "Col" field-veteran sanity check, same
 * always-something-useful contract as assistant/briefing: a validated AI
 * critique when the model is configured and stays grounded, otherwise a
 * deterministic template built straight from the payload's own honesty
 * flags. Never a dead end, never a fabricated critique.
 */
export async function assistantRealityCheck(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const limited = await enforceRateLimit(req, ctx, 'assistant');
  if (limited) return limited;

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

  const chunks = retrieveDoctrine(buildQuery(payload), 3);

  if (isAiAssistantConfigured()) {
    try {
      const systemPrompt = buildRealityCheckSystemPrompt(chunks);
      const userMessage = `ANALYSIS DATA (JSON):\n${JSON.stringify(payload)}\n\nGive this plan its field reality check before it reaches a crew or operator — a short, blunt, grounded critique (2-4 sentences), not a restatement of the briefing.`;
      const aiText = await callChatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ]);

      if (aiText) {
        const check = validateGroundedResponse(aiText, payload, chunks);
        if (check.ok) {
          const citedIds = new Set(extractCitationIds(aiText));
          const response: AssistantResponse = {
            source: 'ai',
            text: aiText,
            citations: chunks.filter((c) => citedIds.has(c.id)).map((c) => ({ id: c.id, title: c.title, source: c.source })),
          };
          return { status: 200, jsonBody: response, headers: { 'Content-Type': 'application/json' } };
        }
        ctx.warn('Reality check failed grounding check, falling back to template', check);
      }
    } catch (error: any) {
      ctx.warn('Reality check AI call failed, falling back to template', error?.message);
    }
  }

  let text: string;
  try {
    text = buildTemplateRealityCheck(payload);
  } catch (error: any) {
    ctx.error('Template reality-check formatting failed unexpectedly', error?.message);
    text = 'Reality check unavailable for this plan — check the estimated-data and confidence flags on the Terrain/Equipment tabs directly.';
  }
  const response: AssistantResponse = { source: 'template', text, citations: [] };
  return { status: 200, jsonBody: response, headers: { 'Content-Type': 'application/json' } };
}

app.http('assistantRealityCheck', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'assistant/reality-check',
  handler: assistantRealityCheck,
});
