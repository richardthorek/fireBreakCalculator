import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { AssistantPayload, AssistantResponse, isAssistantPayload } from '../types/assistant';
import { retrieveDoctrine } from '../services/knowledgeBase';
import { buildSystemPrompt, validateGroundedResponse, extractCitationIds } from '../services/aiGrounding';
import { callChatCompletion, isAiAssistantConfigured, ChatMessage } from '../services/aiFoundryClient';

const MAX_QUESTION_LENGTH = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_MESSAGE_LENGTH = 800;

const UNAVAILABLE_TEXT =
  "I can't give a grounded answer to that right now — check the Assistant tab's insight cards, or the Terrain/Equipment tabs, for what the analysis actually shows.";

interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

function isValidHistory(v: any): v is ChatHistoryTurn[] {
  if (v === undefined) return true;
  if (!Array.isArray(v) || v.length > MAX_HISTORY_TURNS) return false;
  return v.every(
    (t) =>
      t &&
      (t.role === 'user' || t.role === 'assistant') &&
      typeof t.content === 'string' &&
      t.content.length <= MAX_HISTORY_MESSAGE_LENGTH
  );
}

/**
 * POST /api/assistant/chat
 * Body: { payload: AssistantPayload, question: string, history?: {role,content}[] }
 * Returns: AssistantResponse. Unlike the briefing endpoint there is no
 * deterministic template for arbitrary Q&A — when the model is unconfigured,
 * unreachable, or fails the grounding check, the response is a plain
 * `source: 'unavailable'` message pointing back at the deterministic UI,
 * never a guess dressed up as an answer.
 */
export async function assistantChat(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  let body: { payload?: AssistantPayload; question?: string; history?: ChatHistoryTurn[] };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
  }
  if (!isAssistantPayload(body.payload)) {
    return { status: 400, jsonBody: { error: 'payload is required and must match AssistantPayload' } };
  }
  if (typeof body.question !== 'string' || body.question.trim().length === 0) {
    return { status: 400, jsonBody: { error: 'question is required' } };
  }
  if (body.question.length > MAX_QUESTION_LENGTH) {
    return { status: 400, jsonBody: { error: `question exceeds ${MAX_QUESTION_LENGTH} characters` } };
  }
  if (!isValidHistory(body.history)) {
    return { status: 400, jsonBody: { error: `history must be at most ${MAX_HISTORY_TURNS} turns of ≤${MAX_HISTORY_MESSAGE_LENGTH} chars each` } };
  }

  const payload = body.payload;
  const question = body.question.trim();

  if (!isAiAssistantConfigured()) {
    const response: AssistantResponse = { source: 'unavailable', text: UNAVAILABLE_TEXT, citations: [] };
    return { status: 200, jsonBody: response, headers: { 'Content-Type': 'application/json' } };
  }

  const chunks = retrieveDoctrine(`${question} ${payload.predominantVegetation}`, 3);

  try {
    const systemPrompt = buildSystemPrompt(chunks);
    const contextMessage: ChatMessage = {
      role: 'user',
      content: `ANALYSIS DATA (JSON) — the only source of numbers for your answer:\n${JSON.stringify(payload)}`,
    };
    const history: ChatMessage[] = (body.history ?? []).map((t) => ({ role: t.role, content: t.content }));
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      contextMessage,
      ...history,
      { role: 'user', content: question },
    ];

    const aiText = await callChatCompletion(messages);
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
      ctx.warn('Assistant chat response failed grounding check', check);
    }
  } catch (error: any) {
    ctx.warn('Assistant chat AI call failed', error?.message);
  }

  const response: AssistantResponse = { source: 'unavailable', text: UNAVAILABLE_TEXT, citations: [] };
  return { status: 200, jsonBody: response, headers: { 'Content-Type': 'application/json' } };
}

app.http('assistantChat', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'assistant/chat',
  handler: assistantChat,
});
