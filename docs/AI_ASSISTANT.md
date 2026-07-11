# AI Assistant (LLM Layer) — Design

**Status:** 📋 Designed, not built. The deterministic Plan Assistant (rule engine, `planInsights.ts`) shipped July 2026 and remains the always-available core.
**Owner doc for:** LLM architecture, knowledge base, guardrails, hosting/IaC.

**Prime directive (extends the project's data-honesty rule):**
> **The model narrates and cites. It never computes, never estimates, never fills gaps.**
> Every number in an AI response must exist verbatim in the deterministic analysis payload; every doctrine claim must cite a retrieved source. Anything else is a guardrail failure, not a feature.

---

## 1. Hosting & API shape

- **Azure AI Foundry** hosts the model deployment; consumed through the **OpenAI-compatible API specification** (chat completions + embeddings), so the model choice stays swappable (Foundry model catalog) without code changes.
- Delivered through **IaC**: extend the existing Bicep in `infra/` — Foundry project/model deployment, Azure AI Search (vector index), and app settings. No portal-clicked resources; keys via managed identity / app settings, never client-side.
- **Backend proxy only:** new Azure Functions under `/api/assistant/*`. The webapp never talks to the model directly.
  - `POST /api/assistant/briefing` — one-shot SMEACS-style briefing from an analysis payload
  - `POST /api/assistant/chat` — grounded Q&A over the current plan (session-scoped, rate-limited)
- Cost/ops: per-session rate limits, token budgets, response caching keyed on analysis hash.

## 2. Knowledge base (RAG)

Curated doctrine corpus, chunked + embedded in Azure AI Search (integrated vectorization):
- NWCG Fireline Handbook & production tables (already the basis of the estimate model)
- AFAC / state agency doctrine (RFS operational guidance, safe machinery use on slopes)
- DELWP Report 56 (production study underpinning our rates)
- Equipment spec sheets for the configured fleet
- AFDRS fuel-type behaviour documentation (display-level, see `GIS_INTEROP.md`)

Rules: licensed/public documents only, source + version recorded per chunk, retrieval returns citations (doc, section) that the UI renders as links. Corpus updates are PRs (a `knowledge/` manifest), so the KB is reviewable like code.

## 3. Grounding contract & anti-hallucination controls

Each request carries a structured payload: the deterministic analysis JSON (segments, chainages, equipment results, flags, difficulty), the rule-engine insights, and the retrieved doctrine chunks. Controls, in order of enforcement:

1. **System contract:** numbers only from the payload; cite doctrine for every recommendation; if the payload lacks the answer, say so and point to the relevant tool surface; low temperature.
2. **Post-response validation (backend):** extract numeric tokens from the response and verify each exists in the payload (with unit normalization); verify citation IDs exist in the retrieved set. Violations → response rejected and regenerated once, then degraded to rule-engine output. Log every rejection.
3. **UI labelling:** AI output is visually distinct, marked "AI-generated — verify on the ground", and each message carries its citations. The deterministic insight cards are never mixed into AI output.
4. **Offline/failure degradation:** no connectivity or Foundry outage → rule engine only. The app never blocks on the LLM.
5. **Eval suite:** golden analysis payloads + question sets run in CI against the deployed model (grounding-violation rate must be 0 on numeric checks before deploy promotion).

## 4. Surfaces (in order of delivery)

1. **Generated briefing** — SMEACS-format text from the current plan, audience-selectable (crew leader / IC / landholder), exportable into the existing print-briefing and KMZ description flows.
2. **Doctrine callouts** — rule-engine insights enriched with a cited doctrine sentence (e.g. slope-limit insight quotes the machinery guidance it derives from).
3. **Grounded chat** — "why is the D6 excluded here?", "what does a 12 m break buy me in this fuel?" answered from payload + doctrine with citations.

## Update policy
Update when the model deployment, KB corpus, grounding contract, or endpoints change. Confirmed endpoint shapes go in `api-register.md` as usual.
