import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { AssistantPayload, AssistantResponse, isAssistantPayload } from '../types/assistant';
import { retrieveDoctrine } from '../services/knowledgeBase';
import { buildSystemPrompt, validateGroundedResponse, extractCitationIds } from '../services/aiGrounding';
import { callChatCompletion, isAiAssistantConfigured } from '../services/aiFoundryClient';
import { buildTemplateBriefing } from '../services/briefingTemplate';

/** Build the doctrine-retrieval query and a compact JSON rendering of the payload for the model. */
function buildQuery(payload: AssistantPayload): string {
  const equipmentTypes = payload.topEquipment.map((e) => e.type).join(' ');
  const slopeWord = payload.maxSlopeDeg >= 25 ? 'steep slope safety' : 'slope';
  return `${equipmentTypes} ${payload.predominantVegetation} ${slopeWord} fire break production rate`;
}

/**
 * POST /api/assistant/briefing
 * Body: { payload: AssistantPayload }
 * Returns: AssistantResponse — always 200 with SOMETHING useful: a validated
 * AI narration when the model is configured and stays grounded, otherwise a
 * deterministic template built straight from the payload. Never a dead end.
 */
export async function assistantBriefing(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
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
      const systemPrompt = buildSystemPrompt(chunks);
      const userMessage = `ANALYSIS DATA (JSON):\n${JSON.stringify(payload)}\n\nWrite a short field briefing (SMEACS-lite: situation, terrain/fuel, recommended resource, cautions) for a crew leader planning this fire break.`;
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
        ctx.warn('Assistant briefing failed grounding check, falling back to template', check);
      }
    } catch (error: any) {
      ctx.warn('Assistant briefing AI call failed, falling back to template', error?.message);
    }
  }

  // isAssistantPayload already validates topEquipment/insights element shape,
  // but this is the endpoint's last resort before returning — a future edit
  // to buildTemplateBriefing() shouldn't be able to turn "always 200" into a
  // 500, so it gets one more safety net here.
  let text: string;
  try {
    text = buildTemplateBriefing(payload);
  } catch (error: any) {
    ctx.error('Template briefing formatting failed unexpectedly', error?.message);
    text = 'Briefing unavailable for this plan — check the Terrain and Equipment tabs directly.';
  }
  const response: AssistantResponse = { source: 'template', text, citations: [] };
  return { status: 200, jsonBody: response, headers: { 'Content-Type': 'application/json' } };
}

app.http('assistantBriefing', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'assistant/briefing',
  handler: assistantBriefing,
});
