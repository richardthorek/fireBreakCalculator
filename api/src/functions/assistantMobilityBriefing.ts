import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { MobilityAssistantPayload, isMobilityAssistantPayload } from '../types/mobilityAssistant';
import { AssistantResponse } from '../types/assistant';
import { retrieveDoctrine } from '../services/knowledgeBase';
import { buildSystemPrompt, validateGroundedResponse, extractCitationIds } from '../services/aiGrounding';
import { callChatCompletion, isAiAssistantConfigured } from '../services/aiFoundryClient';
import { buildTemplateMobilityBriefing } from '../services/mobilityBriefingTemplate';
import { enforceRateLimit } from '../services/rateLimit';

const AUDIENCE = 'a ground commander appreciating terrain mobility and siting counter-mobility measures';

/** Build the doctrine-retrieval query from the payload's own real content. */
function buildQuery(payload: MobilityAssistantPayload): string {
  const easeWords = payload.topCorridors.map((c) => c.easeClass).join(' ');
  const measureWords = payload.placements.map((p) => p.measureLabel).join(' ');
  return `mobility corridor route pathfinding obstacle counter-mobility ${easeWords} ${measureWords}`.trim();
}

/**
 * POST /api/assistant/mobility-briefing
 * Body: { payload: MobilityAssistantPayload }
 * Returns: AssistantResponse — always 200 with SOMETHING useful, mirroring
 * assistantBriefing.ts exactly: a validated AI narration when the model is
 * configured and stays grounded, otherwise the deterministic template built
 * straight from the payload. Never a dead end.
 */
export async function assistantMobilityBriefing(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  const limited = await enforceRateLimit(req, ctx, 'assistant-mobility');
  if (limited) return limited;

  let body: { payload?: MobilityAssistantPayload };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
  }
  if (!isMobilityAssistantPayload(body.payload)) {
    return { status: 400, jsonBody: { error: 'payload is required and must match MobilityAssistantPayload' } };
  }
  const payload = body.payload;

  const chunks = retrieveDoctrine(buildQuery(payload), 3);

  if (isAiAssistantConfigured()) {
    try {
      const systemPrompt = buildSystemPrompt(chunks, AUDIENCE);
      const userMessage =
        `ANALYSIS DATA (JSON):\n${JSON.stringify(payload)}\n\n` +
        'Write a short plain-language appreciation (situation, movement/corridors, denial siting, counter-measure effect, cautions) ' +
        'for a ground commander proposing a course of action to deter and deny access. This is a rapid appreciation for further scouting, not a tasking.';
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
        ctx.warn('Mobility assistant briefing failed grounding check, falling back to template', check);
      }
    } catch (error: any) {
      ctx.warn('Mobility assistant briefing AI call failed, falling back to template', error?.message);
    }
  }

  let text: string;
  try {
    text = buildTemplateMobilityBriefing(payload);
  } catch (error: any) {
    ctx.error('Template mobility briefing formatting failed unexpectedly', error?.message);
    text = 'Briefing unavailable for this appreciation — check the Terrain Appreciation and Counter-Mobility tabs directly.';
  }
  const response: AssistantResponse = { source: 'template', text, citations: [] };
  return { status: 200, jsonBody: response, headers: { 'Content-Type': 'application/json' } };
}

app.http('assistantMobilityBriefing', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'assistant/mobility-briefing',
  handler: assistantMobilityBriefing,
});
