/**
 * Thin client for an Azure AI Foundry model deployment, via the OpenAI-compatible
 * chat completions REST API (works for any Foundry-hosted chat model, not tied
 * to a specific one — swap `AI_FOUNDRY_DEPLOYMENT_NAME` to change models).
 *
 * Configured entirely through environment variables (see infra/main.bicep's
 * `deployAiAssistant` block, which wires these when provisioned). When unset —
 * the default, since that Bicep flag defaults to off — every call here returns
 * `null` immediately, no network attempted. Callers always have a deterministic
 * fallback (see `briefingTemplate.ts`), so an unconfigured or failing model
 * never breaks the assistant, only narrows it back to the rule engine.
 */

const AI_FOUNDRY_ENDPOINT = process.env.AI_FOUNDRY_ENDPOINT || '';
const AI_FOUNDRY_API_KEY = process.env.AI_FOUNDRY_API_KEY || '';
const AI_FOUNDRY_DEPLOYMENT_NAME = process.env.AI_FOUNDRY_DEPLOYMENT_NAME || '';
const API_VERSION = '2024-10-21';
const REQUEST_TIMEOUT_MS = 15000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function isAiAssistantConfigured(): boolean {
  return !!(AI_FOUNDRY_ENDPOINT && AI_FOUNDRY_API_KEY && AI_FOUNDRY_DEPLOYMENT_NAME);
}

/**
 * Call the configured Foundry deployment's chat completions endpoint.
 * Returns the assistant's text, or `null` on any failure (not configured,
 * network error, timeout, non-2xx, unexpected shape) — never throws, so
 * callers can always fall back cleanly.
 */
export async function callChatCompletion(messages: ChatMessage[]): Promise<string | null> {
  if (!isAiAssistantConfigured()) return null;

  const url = `${AI_FOUNDRY_ENDPOINT.replace(/\/$/, '')}/openai/deployments/${AI_FOUNDRY_DEPLOYMENT_NAME}/chat/completions?api-version=${API_VERSION}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': AI_FOUNDRY_API_KEY,
      },
      body: JSON.stringify({
        messages,
        // Low temperature: the grounding contract wants faithful restatement
        // of the payload, not creative variation.
        temperature: 0.1,
        max_tokens: 700,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    const text = json?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim().length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
