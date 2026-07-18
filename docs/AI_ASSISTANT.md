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

## 5. Operator briefing pack — SMEACS, PDF/text hand-off, access directions — 📋 planned ([issue #166](https://github.com/richardthorek/fireBreakCalculator/issues/166))

**Goal:** the briefing must be something a crew leader can *hand to an operator*: a SMEACS-structured briefing exportable as a PDF (with a static map image) or copied as plain text for SMS/WhatsApp, telling the operator where the job is, how to get there by road, where to enter, and the standard safety requirements that apply to the tasked resources.

### 5.1 SMEACS structure (deterministic first, AI narration second)

Six sections per NSW RFS doctrine ([Issuing Orders](https://www.rfs.nsw.gov.au/resources/publications/doctrine/foundational/issuing-orders)): **S**ituation, **M**ission, **E**xecution, **A**dministration & Logistics, **C**ommand & Communications, **S**afety. (Issue #166 says "Actions" and "Command and Control"; the doctrinal headings are Administration & Logistics and Command & Communications — use the doctrinal wording, noted back on the issue.)

- New `SmeacsBriefing` type (api + webapp): `{ section, heading, lines[], userEditable, citations[] }` per section.
- `buildSmeacsBriefing(payload)` in `briefingTemplate.ts` — pure, deterministic, unit-testable. Section content sources:
  - **Situation** — locality ("~N km *direction* of *place*", Mapbox reverse geocode + existing `gridReference.ts` UTM refs), line length/width, terrain (max/mean slope), predominant fuel + confidence, difficulty score, estimated-data caveat.
  - **Mission** — one templated sentence (construct N m fire break, width, from grid ref A to grid ref B) + a user-editable objective field.
  - **Execution** — recommended resource(s) + time estimates from `topEquipment`, chainage-located hazards from `insights`, suggested entry point + approach summary (§5.3), work direction.
  - **Administration & Logistics** — user-editable (staging area, fuel/water, timings); blank fields render as explicit "— confirm at briefing" placeholders, never invented.
  - **Command & Communications** — user-editable (IC/supervisor, callsigns, channels) with the same explicit-blank rule; auto-includes the doctrinal supervision thresholds when ≥3 plant are tasked (§5.2).
  - **Safety** — dynamic hazards (steep runs, heavy fuel, estimated data) + the standard doctrine checklist for the tasked resource types (§5.2), every standard item citation-chipped.
- **Honesty rule extended:** a field the app cannot know (callsign, staging) is shown as an editable blank, and user-entered text is labelled user-supplied in exports. The app never fabricates operational facts.
- **AI narration (optional layer):** the existing `/api/assistant/briefing` flow gains a `format: 'smeacs'` mode — the model narrates each section from the same payload under the existing grounding gate, falling back per-section to the deterministic template. The template version is the product; AI is polish.
- `AssistantPayload` grows: start/end coords + grid refs, locality string, access summary (§5.3), tasked-resource types. All new fields validated in `isAssistantPayload` (public endpoint).

### 5.2 Standard safety/logistics doctrine (knowledge-base expansion)

New curated `DoctrineChunk`s, same rules as the existing 11 (real checkable source, nothing generated), keyed to resource types so the Safety section pulls only what applies:

| Topic | Source to transcribe from | Facts (as researched, verify wording at implementation) |
|-------|---------------------------|------------------------|
| Plant protective structures | [NSW RFS Heavy Plant OPG](https://www.rfs.nsw.gov.au/resources/publications/doctrine/operational-protocols/rfs-opg-heavy-plant); AS 2294 / ISO 3471 (ROPS), ISO 3449 (FOPS) | ROPS + FOPS + Operator Protection Guarding compliant; seatbelt worn |
| Escort appliance | NSW RFS Heavy Plant OPG | 1 firefighting appliance per heavy plant where fire-impact risk exists; 1 per up to 5 plant where risk negligible (e.g. make-safe) |
| Supervision | NSW RFS Heavy Plant OPG | Heavy Plant Supervisor at ≥3 plant tasked; Plant Operations Manager in IMT at ≥5 |
| Comms | NSW RFS Heavy Plant OPG / Communications SOPs | Radio contact between operator, escort appliance and supervisor; fireground channel at briefing |
| Night ops / lighting | NSW RFS Heavy Plant OPG | Adequate work lighting for night operations |
| Hand crew / aircraft items | existing NWCG/DELWP chunks + RFS doctrine | slope limits, LACES/safety zones, drop-zone clearance |

**Constraint discovered while planning:** rfs.nsw.gov.au 403s automated fetches — the OPG wording must be **manually read and transcribed with attribution** at implementation time. Do not paraphrase from memory into fake "requirements"; anything unverified ships as "confirm against current OPG" or not at all.

### 5.3 Access directions (consumes Route Intelligence §"Road access & approach")

The briefing consumes, never computes, the access data: suggested entry point (road name/kind + grid ref + coords), approach summary from the nearest town/staging point (Mapbox Directions, summarised to road names + distances), and any user-drawn access lines. All labelled "indicative — verify locally"; omitted (stated as unavailable) when offline. Design detail lives in [ROUTE_INTELLIGENCE.md](ROUTE_INTELLIGENCE.md).

### 5.4 Outputs

1. **PDF** — client-side (`pdf-lib` or `jspdf`, lazy-loaded like `shp-write`), embedding a static map image + the six sections + citations + generated-timestamp + data-honesty banner. Supersedes the bare `printBriefing()` sheet (which stays as the no-dependency print fallback). This is a *plain briefing PDF* — the Avenza *geospatial* PDF spike ([GIS_INTEROP.md](GIS_INTEROP.md) §2) remains separate.
2. **Copy as text** — plain-text SMEACS renderer (short lines, no markdown, SMS-friendly), `navigator.clipboard` + `navigator.share()` on mobile; includes the existing share-link URL and the static-map image URL (so a text message carries the picture as a link).
3. **Static map image** — Mapbox Static Images API URL with plan line + access line + entry-point marker overlays (GeoJSON overlay params, token already in app). Offline fallback: `map.getCanvas().toDataURL()` snapshot (needs `preserveDrawingBuffer` only at capture time — investigate `preserveDrawingBuffer:false` + `map.triggerRepaint` capture pattern before accepting the perf cost).

### 5.5 Surface

A **Briefing** section in the Assistant tab (or promoted to its own tab if it crowds the card): Generate → six-section preview with editable blanks → Export PDF / Copy text / Share. Existing one-paragraph AI briefing remains as the "quick" variant.

### 5.6 Sequencing (3 PRs), tests, risks

1. **PR A — SMEACS core:** types, `buildSmeacsBriefing`, doctrine chunks (manually transcribed), payload extension, text renderer + copy/share, editable-blanks UI. Unit tests: section builder per payload permutation, explicit-blank rendering, payload validation, doctrine retrieval by resource type.
2. **PR B — access intelligence:** entry-point suggestion, Directions summary, access-line draw mode + exports (see ROUTE_INTELLIGENCE.md). Smoke checks in the existing optimizer suite pattern.
3. **PR C — PDF + static map + AI narration mode:** grounding tests extended to SMEACS mode (per-section fallback), static-map URL builder unit-tested, manual render check on phone-width.

Risks: Mapbox Directions/Static tile costs and token scopes (verify the public token's allowed APIs); `navigator.share` file-attach support varies (URL-in-text is the guaranteed path); RFS wording transcription is a manual gate; SMEACS heading divergence needs a nod from the issue author (asked on #166).

## 6. Data flow

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

## 7. Endpoint rate limiting, anonymous gating & observability — ✅ built (Step 8)
The assistant endpoints (`/api/assistant/briefing|chat|smeacs`) — along with `/api/analysis/calculate` and `/api/elevation/profile` — are `authLevel: 'anonymous'` and fan out to metered upstreams (AI Foundry tokens especially). They are now guarded:
- **Per-IP rate limiting** (`api/src/services/rateLimit.ts`, `enforceRateLimit(req, ctx, tag)` called first in each handler). Fixed window keyed by `x-forwarded-for`, env-tunable (`RATE_LIMIT_ANON_PER_MIN` default 30, `RATE_LIMIT_AUTHED_PER_MIN` default 300, `RATE_LIMIT_WINDOW_SEC` default 60, `RATE_LIMIT_DISABLED`). A valid StationKit token lifts the caller to the higher tier — the webapp sends the token via `authHeader()` on these calls. In-memory, so per Function instance (documented limitation; a durable store is the follow-up).
- **Anonymous single-break gating (webapp).** Applies to every signed-out user (`anonymousLimited = !suiteSession`): one non-persisted break, with cloud save (already entitlement-gated) and share-link prompting StationKit sign-in; a standing notice explains the break isn't saved and clears on reload. Deployments are expected to configure `VITE_SUITE_AUTH_URL` so a sign-in path exists.
- **SMEACS disclaimer.** `SmeacsBriefing` now always carries `disclaimer` + `provenance` (§6 in GIS_INTEROP). The pack looks like an official tasking, so the "planning aid, not an order" caveat rides at the foot of the text and PDF regardless of data quality.
- **Observability.** App Insights + Log Analytics in `infra/main.bicep` (on by default); the API emits `METRIC` lines (`api/src/services/telemetry.ts`) recording per-analysis fallback-data use so the **fallback rate** — a safety KPI, since the app degrades silently — is queryable/alertable (KQL in that file). Budget alerts are an optional Bicep backstop.

## Update policy
Update when the model deployment, KB corpus, grounding contract, or endpoints change. Confirmed endpoint shapes go in `api-register.md` as usual.
