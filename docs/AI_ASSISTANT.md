# AI Assistant (LLM Layer) — As-Built & Design

**Status:** Core shipped July 2026 (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163)): IaC, backend proxy endpoints, grounding-validation gate, curated knowledge base, frontend briefing/chat UI. The deterministic Plan Assistant (rule engine, `planInsights.ts`) remains the always-available core and is never replaced by this layer — only narrated by it.
**Owner doc for:** LLM architecture, knowledge base, guardrails, hosting/IaC.

**Prime directive (extends the project's data-honesty rule):**
> **The model narrates and cites. It never computes, never estimates, never fills gaps.**
> Every number in an AI response must exist verbatim in the deterministic analysis payload; every doctrine claim must cite a retrieved source. Anything else is a guardrail failure, not a feature.

---

## 1. Hosting & API shape — ✅ built

- **Azure AI Foundry** hosts the model deployment (`infra/main.bicep`, `deployAiAssistant` param — **off by default**, so existing environments don't pick up cost on redeploy); consumed through the **OpenAI-compatible chat completions REST API**, so the model choice stays swappable via `aiModelName`/`aiModelVersion` without code changes. Local-auth (API key) for simplicity, matching this project's other external integrations; managed identity is a documented hardening follow-up.
- **Backend proxy only** (`api/src/functions/assistantBriefing.ts`, `assistantChat.ts`): the webapp never talks to the model directly.
  - `POST /api/assistant/briefing` — one-shot field briefing from an `AssistantPayload`
  - `POST /api/assistant/chat` — grounded Q&A over the current plan, with a capped conversation history (6 turns, 800 chars/turn) passed by the caller each call — no server-side session store
- **Verification note:** this was built and unit-tested without access to a live Foundry endpoint or an `az`/Bicep compiler in the build session — the grounding/knowledge-base logic is fully unit-tested (pure functions, no network), but an actual model call has not been exercised end-to-end. **Before relying on this in the field:** deploy with `deployAiAssistant=true`, run a `--what-if` first, and manually sanity-check a few real briefings/questions.
- **Not yet built:** per-session rate limiting (Consumption-plan Functions don't hold reliable in-memory state across instances; a real limiter needs Table Storage or APIM) and response caching. Today's guardrails are request-size caps only (question ≤500 chars, history ≤6×800 chars). Treat as a known gap, not an oversight.

## 2. Knowledge base (RAG) — ✅ built (keyword), 📋 vector upgrade designed

`api/src/services/knowledgeBase.ts` — an **11-chunk curated corpus**, hand-written from facts this codebase already relies on and cites: NWCG 2021 production tables, DELWP Report 56, this project's own calibrated fuel/slope factors (`productionModel.ts`), the NVIS vegetation spine, the route optimizer's corridor model, and the data-honesty principle itself. Every chunk's `source` field is a real, checkable reference — nothing generated.

Retrieval (`retrieveDoctrine(query, topK)`) is **keyword-overlap scoring today**, deliberately: no embeddings, no vector store, no network call, fully unit-tested. This is a placeholder by design — the function signature (`string` query → ranked `DoctrineChunk[]`) is the swap point for a real Azure AI Search vector index later; no caller changes when that lands. **Azure AI Search itself is not provisioned** — adding it (integrated vectorization, a real corpus loading pipeline, licensed doctrine beyond this project's own model) is the next increment, not done in this pass.

## 3. Grounding contract & anti-hallucination controls — ✅ built (heuristic)

`api/src/services/aiGrounding.ts`. Each request carries the `AssistantPayload` (distance, slope, vegetation, top equipment, top insights — a distilled, prompt-sized subset of the full analysis) and the retrieved doctrine chunks.

1. **System contract** (`buildSystemPrompt`): numbers only from the payload; cite doctrine via an exact `[[doc:ID]]` marker for every claim; say "I don't know" and point at a UI tab rather than guess; low temperature (0.1).
2. **Post-response validation** (`validateGroundedResponse`): extracts every numeric claim from the response (`extractNumericClaims` — decimals, currency, percentages, degrees, metres/km/hours, with a 1% relative + rounding tolerance so "4 h" validates against a payload value of 4.2) and rejects if any claim isn't traceable to the payload; extracts `[[doc:ID]]` citations (`extractCitationIds`) and rejects if any ID wasn't in the retrieved set. **This is a heuristic, not a formal proof** — regex-based extraction and literal ID matching, documented as such in the module's own comments.
3. **Failure handling:** briefing endpoint falls back to `buildTemplateBriefing` — a fully deterministic, no-AI summary built straight from the payload, so the endpoint *always* returns something useful. Chat has no template equivalent (arbitrary Q&A can't be templated); a failed/unconfigured/unreachable call returns a plain `source: 'unavailable'` message pointing back at the deterministic tabs — never a guess dressed up as an answer.
4. **UI labelling** (`AiAssistantCard.tsx`): every response carries a visible source badge — "AI-generated — verify on the ground" / "Template summary (from the analysis, no AI)" / "No grounded answer available" — plus citation chips. The rule-based insight cards (`AdvisorPanel.tsx`) are a separate, always-present section; AI output is never mixed into them.
5. **Offline/failure degradation:** unconfigured Foundry endpoint, network failure, timeout (15 s), non-2xx, or a failed grounding check all resolve to the same graceful fallback — the app never blocks on the model.
6. **Not yet built:** an automated eval suite (golden payloads + question sets run against the live deployed model, gating deploy promotion on a zero grounding-violation rate). The unit tests cover the *validation logic* exhaustively; they cannot exercise a live model's actual output without a deployed Foundry endpoint.

## 4. Surfaces — ✅ built

`webapp/src/components/AiAssistantCard.tsx`, inside the Assistant tab, below the deterministic insight cards:
1. **Generate briefing** — one button, one field-briefing paragraph (situation / terrain+fuel / recommended resource / cautions), source-badged, with citation chips, regenerable.
2. **Grounded chat** — a small conversational thread ("why is the D6 excluded here?"), each turn source-badged independently, capped history sent back per request.

**Not yet built:** doctrine callouts enriching the rule-based insight cards themselves (e.g. the slope-limit insight quoting the machinery guidance it derives from) — the two systems currently sit side by side rather than being woven together; audience-selectable briefing tone (crew leader / IC / landholder); export into the print-briefing/KMZ flows.

## 5. Data flow

```
AnalysisPanel (assessment + calculations)
  → buildAssistantPayload()            [webapp/src/utils/assistantApi.ts]
  → POST /api/assistant/briefing|chat
      → retrieveDoctrine(query)        [knowledgeBase.ts — keyword match]
      → buildSystemPrompt(chunks)      [aiGrounding.ts]
      → callChatCompletion(messages)   [aiFoundryClient.ts — null if unconfigured/failed]
      → validateGroundedResponse(...)  [aiGrounding.ts — reject on any unmatched number/citation]
      → AssistantResponse { source: 'ai'|'template'|'unavailable', text, citations }
```

## Update policy
Update when the model deployment, KB corpus, grounding contract, or endpoints change. Confirmed endpoint shapes go in `api-register.md` as usual.
