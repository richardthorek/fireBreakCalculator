# Fire Break Calculator — Master Plan

**Last Updated**: August 3, 2026 — OCOKA 4 (key terrain) shipped, step 50. See Recent Updates for the dated history, including the OCOKA programme and its same-day terminology correction (OAKOC/IPOE → OCOKA/IPB for the ADF audience this product actually serves).
**Related Docs**: [CLAUDE.md](CLAUDE.md) · [docs/README.md](docs/README.md)

---

## ⚠️ MANDATORY WORKFLOW

**Before starting:** read this document; take the top item in "Next up" unless told otherwise; check the linked design doc for detail.
**After finishing:** add a dated entry in Recent Updates, link the PR, move the item from "Next up" to "Shipped" (one line, per the existing style), and update the relevant design doc / register.
**Never create** new planning/status/summary docs — planning lives here; technical detail lives in the linked docs; everything else is doc sprawl.

---

## Vision

A **mitigation copilot** for rural firefighters: draw a line, get grounded time/cost/resource estimates, a smarter path, official fire-danger context, and a cited, plain-language briefing — then hand the plan to the tools agencies already use (FireMapper, ArcGIS, Avenza, GPS).

**Non-negotiable principles**
1. **Deterministic core.** All numbers come from the calculation engine and published models. The AI layer narrates and cites; it never computes ([docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md)).
2. **Data honesty.** Estimated/fallback data is always flagged, end to end — including in exports. A missing value is shown as missing, never defaulted silently.
3. **Don't rebuild what exists.** AFDRS/BOM own fire danger; Spark/Phoenix own spread prediction. We display official products and integrate.
4. Field-ready: touch-first, low data, and offline-capable — **with one stated exception**. From the OCOKA programme onward, Terrain Mobility mode runs its analysis on the backend and therefore **requires connectivity to produce a new result**; previously completed analyses stay readable offline. Fire-break mode is unchanged and remains fully offline-capable. This was an explicit owner decision (2026-08-02), traded for parallel compute and the warm-run latency contract — recorded here rather than left as a claim the code no longer honours.

## Current state

- **Estimates:** per-segment production model in the API is the sole engine ([docs/CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md)).
- **Vegetation:** NVIS national spine + NSW SVTM overlay; state expansion frozen ([docs/NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md)).
- **Route intelligence:** corridor pathfinding, chainage-addressed segment detail, elevation profile, rule-based Plan Assistant, tabbed analysis UI — shipped in PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163) ([docs/ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md)). Infrastructure trail lookup (OSM/Overpass) is now multi-endpoint resilient after a live-tested rate-limiting bug was found and fixed 2026-07-12.
- **Live context:** national hotspots + fire/burn-area boundaries, plus incident/warning overlays for 5 of 8 states, are live on the map ([docs/GIS_INTEROP.md](docs/GIS_INTEROP.md) §4). AFDRS official fire-danger rating is **blocked on access** (BOM Registered User program), not effort — see the assessment in that doc.
- **Terrain Mobility:** M1–M4 shipped (mobility core, corridors/chokepoints, trafficability uplift, counter-mobility planner). Being restructured around **OCOKA/IPB** — the terminology the Australian Army (this product's actual audience) currently teaches, per The Cove — with its compute moved to a parallel Azure backend. See the OCOKA programme at the top of "Next up". The mode now presents all five OCOKA factors by name (`OakocPanel.tsx`): Obstacles, Avenues of approach and Key terrain are real, assembled from (or, for Key terrain, scored from) existing products; Observation & fields of fire and Cover & concealment ship as explicit `'not-assessed'` placeholders pending OCOKA 6/7.

## The Plan

### Next up

Sorted **smallest effort first**, ready-to-start items ahead of blocked ones. Size is rough shirt-sizing (S/M/L), not a time estimate. "Depends on" names a real prerequisite, not just a related area. **Exception: a defect that produces a confidently-wrong answer jumps the queue regardless of size** — see the first row.

**Owner-directed programme (2026-08-02), takes priority over the general queue below.** Terrain Mobility mode is being restructured around **OCOKA** — the *military aspects of terrain* framework the Australian Army currently teaches (Observation and fields of fire, Cover and concealment, Obstacles, Key terrain, Avenues of approach), within **IPB** (*Intelligence Preparation of the Battlespace*) — and its compute moved to a parallel Azure backend with a warm-run latency contract. (The US Army uses the reordered OAKOC and has renamed its own process IPOE — different armies' current terminology, not old vs new; this product follows the ADF's, since that is its audience.) The mode already implements Obstacles and Avenues without naming them; this finishes the set. Fire-break mode is out of scope and does not change. Stages are ordered and each is independently shippable.

| Item | Scope | Size | Depends on | Detail |
|------|-------|------|------------|--------|
| ~~OCOKA 1 — mobility-class vocabulary migration~~ | **Shipped — step 48.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47 |
| **OCOKA 2 — extract `shared/@firebreak/terrain` workspace package** | Prerequisite for any server-side execution. §38's "just call the existing modules" is optimistic — they live in a different package with a different tsconfig. Extract rather than copy; copying would make the algorithm itself a drift surface | M | OCOKA 1 (✅) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| ~~OCOKA 3 — five-factor framing over existing products~~ | **Shipped — step 49.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.7 |
| ~~OCOKA 4 — key terrain~~ | **Shipped — step 50.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.8 |
| **OCOKA 5 — backend protocol + tier-2 execution (no fan-out yet)** | Job submit → Durable status polling carrying blob pointers → client reads artefacts direct from Blob with a job-scoped SAS. Ships **before** parallelism deliberately: a wrong partial-result rule is a safety bug, a slow correct run is only slow | L | OCOKA 2 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| **OCOKA 6 — `viewshed.ts` + Observation & fields of fire** | R3 line-of-sight over the hex grid (one elevation per hex centre, no raster in hand). Observers via a third paint role. Fields of fire computed **only** for user-stated ranges — never inferred | M/L | OCOKA 3 (✅) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §8 |
| **OCOKA 7 — cover & concealment** | Concealment from vegetation structure + dead ground. **Cover is not computed** — a bare-earth DEM cannot see a rock, bund or building — and `coverAssessed: false` ships as a machine-readable property in export and payload, not just UI prose | S/M | OCOKA 6 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47 |
| **OCOKA 8 — backend fan-out** | Parallelise what genuinely parallelises: tile sampling (capped at 2–3 concurrent on Overpass), viewshed by observer, mover ensemble by chunk, key-terrain candidates. Dijkstra and the k-dissimilar loop are sequential by construction and stay that way | M | OCOKA 5, 6 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| **OCOKA 9 — Container Apps Job tier (still gated)** | Unchanged gate: build only on tier-2 evidence of a real tail of oversized runs. Same protocol as OCOKA 5, so it becomes a compute swap rather than new plumbing | L | tier-2 evidence | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| Road-speed `user-override` confidence into GIS export + AI briefing | The override mechanism itself is shipped (step 21) and visibly flagged in the panel/run log; carrying the flag into export attributes and the briefing payload — matching how vegetation overrides are documented to behave — is the one piece not yet done | S | Slice A config UI (✅) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| End-user guide | Never existed; decide whether it lives here or in Station Manager's in-app wiki, then write it | S | — | docs/README.md |
| Restrictions costed against `delayLedger.ts` | Both pieces exist; wire the recommended-restriction set through the existing delay-cost model | S/M | restrictionPlanner.ts, delayLedger.ts (✅ both) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| A real fuel-age → clearing-rate relationship | Genuinely blocked on **finding a sourced curve**, not on plumbing — NAFI fire-age and DEA fractional-cover are both fetched and surfaced as context (steps 10, 17) but nothing grounds how they should move the production rate; do not invent a coefficient | M+ | a citable source (research literature / agency guidance) | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md), [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §31 |
| UI/UX uplift, moves 4–5 | Shared type/confidence discipline across both modes; extend Terrain mode's mobile floating-overlay pattern to fire-break mode | M | moves 1–3 (✅) | master_plan Recent Updates, 2026-07-26 |
| ~~Function-hosted (tier 2) mobility search~~ | **Superseded — now OCOKA 2 + 5 above.** The telemetry gate (step 32) was for deciding *when to switch*, not *whether to build*; owner direction on 2026-08-02 superseded the build gate. Telemetry is still the right evidence for the routing threshold, so tier 2 ships with an explicit user choice plus a conservative automatic threshold that telemetry tunes later | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| ~~On-demand Container Apps Job (tier 3)~~ | **Superseded — now OCOKA 9 above.** Scope and gate are unchanged (still built only on tier-2 evidence of a real tail); it moves into the programme so it shares OCOKA 5's protocol instead of defining its own | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| Vector RAG via Azure AI Search | Keyword KB works; RAG needs an Azure AI Search resource provisioned | M | Azure AI Search resource | [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) |
| Restriction siting at a surveyed point | Currently hex-cell resolution, not a specific point — an architecture change to the placement model | L | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| Field hardening | Offline-first PWA (cached tiles + analyses), WCAG 2.1 AA completion | L | — | [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md) |
| Agency hand-off | ArcGIS Online hosted-feature-layer push (OAuth PKCE); Avenza geospatial-PDF spike | L | — | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §2, §3 |

#### Next up — outcome, changes required, difficulty

##### OCOKA programme

- ~~**OCOKA 1**~~ — **Shipped, step 48.** See Shipped table + `ROUTE_INTELLIGENCE.md` §47.

- **OCOKA 2 — extract `shared/@firebreak/terrain`** (Difficulty: M)
  - Outcome: the same terrain code runs on the client and the server, so a server-side result cannot silently diverge from a client-side one.
  - Changes: move `terrain/*`, the sampling utils, `config/classification` into a workspace package · break the two type-only `ConfidenceTier` imports · make the seeded mover ensemble chunk-invariant (`hash(seed, moverIndex)`).
  - Note: the ensemble seeding fix **changes today's numbers once**. Flag it as a deliberate one-time change, never silent drift. `mapboxTrails.ts` stays client-only (it reads a live GL map) — a real capability difference to record, not hide.

- ~~**OCOKA 3**~~ — **Shipped, step 49.** See Shipped table + `ROUTE_INTELLIGENCE.md` §47.7.

- ~~**OCOKA 4**~~ — **Shipped, step 50.** See Shipped table + `ROUTE_INTELLIGENCE.md` §47.8.

- **OCOKA 5 — backend protocol + tier-2 execution** (Difficulty: L)
  - Outcome: analysis runs on the server with results streaming back progressively, and a dropped connection resumes instead of recomputing.
  - Changes: SWA Free→Standard + a Flex Consumption Function App behind `deployMobilityBackend bool = false` · Durable orchestration · append-only artefact blobs with a 24-hour lifecycle rule · job-scoped read-only SAS · `MobilityJobRequest` becomes the **third** must-match webapp/api pair · Table-Storage-backed rate limiting for the job endpoint (`rateLimit.ts`'s in-memory buckets under-enforce on a scaled-out plan).
  - Note: export and the AI briefing are **blocked while a run is provisional**, and the briefing block is enforced server-side, not just in the UI.

- **OCOKA 6 — viewshed + Observation & fields of fire** (Difficulty: M/L)
  - Outcome: the plan says what ground is observed, from where, and what sits in dead ground — and suggests where an observation post would actually see the corridor.
  - Changes: `terrain/viewshed.ts` (front-to-back R3 over the hex grid, written as a pure partitionable function from day one) · `hexLine()` added to `hexGrid.ts` · third paint role for observers · a `SCREENING_HEIGHT_M` table in `structureTable.ts` with per-row confidence · curvature + refraction.
  - Note: elevation is a **bare-earth DEM**, so sight lines are systematically optimistic — the error that leaves an approach unwatched. The screened (more pessimistic) surface is the default; bare-earth is a toggle; both export.

- **OCOKA 7 — cover & concealment** (Difficulty: S/M)
  - Outcome: concealment is reported honestly and cover is explicitly *not* claimed.
  - Changes: concealment index from vegetation structure + dead ground · defilade only relative to specified positions · `coverAssessed: false` as a machine-readable property in the GIS export, the assistant payload and the briefing.
  - Note: cover and concealment are doctrinally different things and must never be blended into one score.

- **OCOKA 8 — backend fan-out** (Difficulty: M)
  - Outcome: large runs get materially faster without changing any number they produce.
  - Changes: fan out tile sampling (Overpass capped at 2–3 concurrent — it rate-limits, and this repo has already fought that), viewshed by observer, ensemble by chunk, key-terrain by candidate · pass a blob URI to activities, never the cell array.
  - Note: the multi-source Dijkstra and the k-dissimilar route loop are **sequential by construction** and are deliberately not parallelised. The restriction planner is the long pole; only the ensemble inside each evaluation parallelises.

- **OCOKA 9 — Container Apps Job tier** (Difficulty: L, gated)
  - Outcome: genuine outlier runs complete instead of timing out.
  - Changes: same artefact layout and status document as OCOKA 5, so this is a compute swap.
  - Note: gate unchanged — built only on tier-2 evidence, not speculatively.

##### General queue

- **Road-speed user-override confidence into GIS export + AI briefing** (Difficulty: S)
  - Outcome: an edited road-speed table shows up in exported GIS attributes and the AI briefing text, not just the live panel.
  - Changes: add override/confidence fields to `mobilityGisExport.ts`'s GeoJSON/KML properties (mirrors step 42's hydrology pattern) · add the same fields to `MobilityAssistantPayload` (webapp+API, kept in lock-step) + validator · template narration line when overrides were used.

- **End-user guide** (Difficulty: S)
  - Outcome: a first-time user or a crew member handed a tablet in the field has a real written walkthrough instead of learning the tool from the UI alone.
  - Changes: decide where it lives — this repo's `docs/` vs Station Manager's in-app wiki · write it (draw/paint → read the estimate → read confidence flags → export/share).
  - Note: no code, but genuinely unstarted — needs an actual writing pass, not plumbing.

- **Restrictions costed against `delayLedger.ts`** (Difficulty: S/M)
  - Outcome: two equally-effective counter-mobility placements get a real $/time cost difference shown, so a commander can pick the cheaper one instead of guessing.
  - Changes: wire `restrictionPlanner.ts`'s ranked candidate set through the existing `computeDelayLedger` cost model · surface the cost alongside the existing delay-effectiveness ranking in `CounterMobilityPanel.tsx` · extend GIS export/AI briefing placement fields with the cost figure.

- **A real fuel-age → clearing-rate relationship** (Difficulty: M+, blocked on a source)
  - Outcome: fire-history age would actually move the time/cost estimate instead of only being shown as text — but only once there's a real number to move it by.
  - Changes: find a citable fuel-accumulation-vs-clearing-rate curve (research literature or agency guidance) — the actual blocker · once sourced, apply as a segment-level multiplier alongside the existing NWCG/Report 56 fuel-class factors · flag the applied adjustment as estimated, not measured (data-honesty rule).

- **UI/UX uplift, moves 4–5** (Difficulty: M)
  - Outcome: fire-break mode and Terrain Mobility mode feel like one consistent product — confidence badges, type labels, and control placement read the same regardless of mode.
  - Changes: align vegetation/data confidence display — fire-break's numeric "% confidence" badge vs Terrain Mobility's tiered `DataConfidenceBadge` (measured/published/estimated/generic-fallback) — pick one shared vocabulary · extend Terrain mode's mobile floating-overlay control pattern (§21) to fire-break mode's own panel/controls.
  - Note: genuinely fuzzy scope — the only existing documentation is this one roadmap line, no detailed design yet.

- **Function-hosted (tier 2) mobility search** — superseded, see **OCOKA 2 + 5**. One correction worth carrying forward: the old note claimed "no rewrite" because the API is already Node/TS. That was optimistic — `webapp/src/terrain/*` lives in a different package with a different tsconfig, so a shared workspace package has to be extracted first (OCOKA 2). Copying instead would make the algorithm itself a fourth must-match drift surface.

- **On-demand Container Apps Job (tier 3)** — superseded, see **OCOKA 9**. Gate unchanged.

- **Vector RAG via Azure AI Search** (Difficulty: M)
  - Outcome: AI assistant doctrine citations get measurably more relevant once retrieval is semantic instead of keyword-overlap, and the corpus can grow past what keyword scoring handles well.
  - Changes: provision an Azure AI Search resource + IaC (`infra/main.bicep`) · build a corpus-loading/indexing pipeline for the doctrine chunks (integrated vectorization) · swap `retrieveDoctrine(query, topK)`'s implementation — already the designed swap point, no caller changes needed.

- **Restriction siting at a surveyed point** (Difficulty: L)
  - Outcome: a recommended counter-mobility restriction points at an actual surveyed spot on a road, not "somewhere along this hex edge" — closes the gap between the recommendation and where a crew can actually place something.
  - Changes: change the placement model from grid-edge siting to a point on the underlying road-graph geometry · re-thread `restrictionPlanner.ts`/`delayLedger.ts`'s siting logic to the new representation · update map rendering + GIS export/briefing to carry a real point, not a cell reference.

- **Field hardening** (Difficulty: L)
  - Outcome: the tool keeps working — at least for reading a previously-run analysis — when a crew loses signal, and is usable regardless of assistive technology.
  - Changes: offline-first PWA — service worker caching of map tiles + completed analyses for offline reference · WCAG 2.1 AA completion, auditing across the app (some pieces, e.g. `ConfirmDialog`'s focus-trap/ARIA, are already built but unused — see step 44).
  - Note: no detailed design doc currently backs this row — the linked `NVIS_INTEGRATION.md` doesn't actually cover offline/WCAG specifics; scoping is itself part of the work.

- **Agency hand-off** (Difficulty: L)
  - Outcome: a plan can be pushed straight into an agency's existing GIS tooling (ArcGIS dashboards, Avenza on a phone) instead of a crew manually re-importing an export file.
  - Changes: ArcGIS Online — OAuth 2.0 PKCE sign-in (user's own AGOL org, no stored credentials) + REST create-feature-service/`addFeatures` push, one-way explicit action · Avenza — spike a server-side geo-registered PDF (Mapbox Static Images + `pdf-lib`) against a real Avenza import before committing; fall back to the existing KMZ-via-Avenza-import path if the spike fails.

### Blocked

Not next regardless of size — each needs something outside this codebase to resolve first.

| Item | Blocked on |
|------|------------|
| AFDRS fire danger | BOM Registered User access — a sourcing decision, not effort (see 2026-07-12 update) |
| Water-point & cadastre advisory layers | Licensing check pending |
| AI live model verification + eval suite | Needs a deployed model endpoint |
| VCI/RCI-weighted min-cut capacity | Needs Pass 3's soil layers, not yet sampled |
| Real entitlement/backend gating for Terrain Mobility | Deliberately deferred pending a release decision — feasibility assessed (§14.1): entitlement source of truth lives in the separate Station Manager repo, and moving compute server-side trades away the offline/interactive properties the field tool depends on |

#### Blocked — outcome, changes required, difficulty

- **AFDRS fire danger** (Difficulty: Blocked, not effort)
  - Outcome: the plan's district/date would show the OFFICIAL AFDRS fire-danger rating instead of nothing — display only, no rebuild of fire-behaviour prediction.
  - Changes: apply for BOM's Registered User program (or find a redistributor) — an organisational decision, not resolvable from inside the codebase; `afdrs.com.au` itself has no public API.
  - Note: once access exists, the display work itself is a small, well-scoped lift (same pattern as the existing hotspots/boundaries feeds).

- **Water-point & cadastre advisory layers** (Difficulty: Blocked, not effort)
  - Outcome: mapped water-fill points and cadastre boundaries show as advisory overlays when planning a break, plus a stronger waterway-based anchor rule for the optimizer.
  - Changes: licensing/attribution check with NSW DCS Spatial Services before any code is written.
  - Note: once cleared, the overlay work itself is S/M, reusing the existing OSM-overlay pattern.

- **AI live model verification + eval suite** (Difficulty: Blocked, not effort)
  - Outcome: confidence that the AI assistant's live model responses are actually accurate/grounded in practice, not just passing the deterministic-template tests that exist today.
  - Changes: deploy an actual Azure AI Foundry model endpoint (currently off by default, `deployAiAssistant` flag) — grounding gate and citation validation already exist and are unit-tested against it.
  - Note: the eval suite itself is S/M once a deployed endpoint exists to test against.

- **VCI/RCI-weighted min-cut capacity** (Difficulty: Blocked on data, then M)
  - Outcome: min-cut barrier siting weights capacity by real vehicle-class trafficability (VCI₁ one-pass vs VCI₅₀ fifty-pass) against actual soil strength, instead of the current flat/class-tiered capacity model.
  - Changes: sample Pass 3's soil layers (not yet built) for the AOI · join VCI/RCI verdict tables into `computeMinCutBarrier`'s capacity function.
  - Note: the model itself is already designed with a real, sourced worked example (105 mm howitzer VCI₁ 21 / VCI₅₀ 49 at RCI 43) in `ROUTE_INTELLIGENCE.md` — just unfed.

- **Real entitlement/backend gating for Terrain Mobility** (Difficulty: Blocked, release decision)
  - Outcome: Terrain Mobility becomes a properly licensed, server-enforced feature (like saved plans already are) instead of a client-side UI toggle discoverable by anyone who looks.
  - Changes: Station Manager (separate repo) needs to expose a `terrainMobilityEnabled` entitlement (`fireBreakEnabled` is the existing precedent) before this repo can gate server-side · then apply the same route-level code-split + entitlement check pattern already proven for saved plans.
  - Note: moving compute server-side also trades away the offline/interactive properties the field tool depends on — not a pure "just add a check" fix.

## Architecture snapshot

React 18 + Vite + TS (`/webapp`) · Azure Functions Node 22 (`/api`) · Azure Table Storage · Mapbox GL JS · Azure Static Web Apps, Bicep IaC (`/infra`, OIDC).
Data flow: draw line → slope (~10 m) + vegetation (~200 m) sampling → joined chainage profile → `POST /api/analysis/calculate` → per-segment estimates + flags → UI/assistant/exports.
Gates: `npm test` + `npm run build` (webapp, strict TS), `npm run test:unit` (api) — all in CI.

## Shipped

One line each — history and rationale live in the linked as-built doc and in Recent Updates below, not here.

| # | Step | Scope | Detail |
|---|------|-------|--------|
| 0 | Route intelligence & analysis UI | Corridor optimizer, Plan Assistant, tabbed workspace | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) |
| 1 | Universal GIS export pack | GeoJSON/KML/KMZ/SHP export + file import | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §1, §4 |
| 2 | Infrastructure-aware optimizer (core) | Existing trails/roads as discounted edges, unanchored-end insights | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) |
| 3 | National live context (core) | DEA Hotspots + Digital Atlas NRT boundaries; incident/warning overlay, 5/8 states | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §4 |
| 4 | AI assistant (core) | Azure AI Foundry briefing + chat, hard grounding gate, keyword KB | [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) |
| 4b | Operator briefing pack (SMEACS) | PDF/text briefing, road-access entry point, plant safety doctrine chunks | [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) §5 |
| 7 | Detailed-analysis experience uplift | Route-wide hex grid, streamed scan visualization, auto-run, area recon | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) |
| 8 | Operational hardening | Disclaimers, reproducibility stamping, observability, rate limiting, upstream canary | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §6, [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) §7 |
| 10 | Terrain mobility & counter-mobility, Passes 1–4 | Area→area movement planning per mover profile; approach corridors, chokepoints, counter-measures | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) "Terrain Mobility" §10, §§16–28 |
| 12 | Terrain Mobility Pass 5 — probabilistic movement as the engine | Ensemble of imperfectly-informed movers replaces the single optimal line; ranked recommended restrictions | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| 13 | Terrain-mode UI clarity pass | Brush cursor, paint-lag fix, run progress HUD, map key, corridor legibility | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §33 |
| 14 | Terrain Mobility Pass 6 — hydrology | Waterways/water bodies as a real movement barrier (was silently mislabelled as easy ground) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §34 |
| 15 | Fire-break: water as a natural break edge | Damp ground doesn't carry fire — water-crossing segments cost zero build time instead of being priced as clearable fuel | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) |
| 16 | Fire-break: cross-slope (sidehill) safety gate, distinct from the along-line uphill limit | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) F2 |
| 17 | Fire-break: NAFI fire history shown as context only — no sourced clearing-rate curve to apply it to cost | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) |
| 18 | Slice A — road network graph + A* routing, box-free by construction | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 19 | Painting uses real hex cells (`hexRing`/`hexSpiral`), not zoom-relative circles | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §36 |
| 20 | Paint↔analysis grid reconciliation via real geodesic area overlap, not centre-point test | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §36 |
| 21 | Slice A — road-speed override UI + config plumbing across the Worker boundary | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 22 | Slice A.9 — road-network routing actually wired into the live app (was correct in isolation, never called) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 23 | ~~Slice B v1 — expand-and-retry~~ (superseded by step 24, base padding formula still broken) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 24 | Slice B — square distance-based search box + targeted frontier-edge growth (the real Lake George fix) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 25 | Distance-scaled cell budget + quick/standard/fine analysis-depth selector | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 26 | Fixed corridors always collapsing to 1 (route-clustering) + corridor/trafficability colour collision | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 27 | Fixed progress-bar dead zones; real partial results now reach the map early | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §37 |
| 28 | Fixed road graph having zero water awareness (a vehicle route crossed Lake George) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §37 |
| 29 | Corridor rendering consolidated to 1 refined route per corridor (was up to 24 raw polylines) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §28 |
| 30 | Corridor band outline smoothed (Chaikin corner-cutting on the dissolved hex geometry) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §28 |
| 31 | OSM water `relation`s (not just `way`s) now block movement — fixed live, ahead of queue order, for 1.0 demo risk | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §34/§35 |
| 32 | Cloud-offload scoping (3-tier model) + mobility run telemetry collection started | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| 33 | ~~Small-AOI detour padding, uncapped~~ (revised step 35 same day — caused the page-hang regression) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §39/§41 |
| 34 | Mapbox-tile road fallback widened to Terrain Mobility (fixes a real highway painting NO-GO) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §40 |
| 35 | Fixed page-hang regression: detour floor capped, cell budget fixed, onTrail slope exemption added | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §41 |
| 36 | Road-graph route fused into chokepoint/corridor analysis (was display-only before) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42 |
| 37 | Corridor legibility pass — route line visibility + label/shape colour collision fixed | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §43 |
| 38 | Road-graph fusion extended: ensemble tie-break bias + min-cut road-class-tiered capacity | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42a |
| 39 | Genuinely mixed hex+road-graph adjacency in the ensemble and a road-network-exact min-cut, CLOSED | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42b |
| 40 | Road-route decoupling — instant road-network preview, seconds instead of tens of seconds | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §44 |
| 41 | Full OSM water-relation topology — multipolygon reassembly (fixed an under-block risk, not just the documented over-block one) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §45 |
| 42 | Hydrology attributes surfaced in GIS export + AI briefing (were computed, never reached either) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §46 |
| 43 | Existing-trail reuse now reaches the cost engine (was computed, silently discarded before costing) | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) |
| 44 | `api-register.md`/`component-register.md` corrected against the live codebase (both found stale) | [api-register.md](docs/api-register.md), [component-register.md](docs/component-register.md) |
| 45 | Slice B — lazy grid materialisation + resumable search (architectural half; remainder closed by step 46) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 46 | Slice B remainder — α·C* cost-budget, 2–5 corridor stop rule, "most likely"/"most risky" picks | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 47 | Mobile UI — quick mover-class selector + coordinate readout repositioned | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 48 (OCOKA 1) | Mobility-class vocabulary migration — one MCOO vocabulary instead of two; `webapp/tests/` wired into CI | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47 |
| 49 (OCOKA 3) | Five-factor OCOKA framing — `terrain/oakoc.ts` assembly + `OakocPanel.tsx`; `roadNetworkBarrier` gets its first map layer/legend/GIS export; `Corridor.bottleneckCellKeys` added | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.7 |
| 50 (OCOKA 4) | Key terrain — `terrain/keyTerrain.ts` nominates candidates from chokepoints/min-cut/corridor bottlenecks, scores each by a real worker-run re-search with it denied; `OakocPanel.tsx`'s Key terrain section now real, `decisiveCandidate` always framed as a candidate requiring confirmation | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.8 |

## Recent Updates

Short rolling window — most recent first, oldest first pruned. Every entry's
full substance is preserved elsewhere: the **Shipped** table above (one line,
every step, permanent) and the linked as-built doc's own dated section. Full
history beyond this window: `git log`.

- **2026-08-03 — OCOKA 4 shipped (step 50).** Key terrain — the one factor
  §47.1's audit called "~90% computable from existing chokepoint/min-cut
  machinery" is now real. New `terrain/keyTerrain.ts`:
  `generateKeyTerrainCandidates` nominates candidate ground (cheap, main
  thread) from chokepoints, the hex min-cut, the road-network min-cut and
  each top corridor's own `bottleneckCellKeys`; `scoreKeyTerrainCandidates`
  re-runs the search with each candidate denied and diffs the result against
  `optimiserCorridorField` via the existing `compareCorridorFields` — always
  the optimiser field, never the (possibly absent, possibly simulated-mover)
  headline one, a stated methodology choice. Denial uses an `Infinity` edge
  penalty, deliberately unlike every other (finite, "always breachable")
  penalty in this mode — a finite multiplier can never make `decisiveCandidate`
  mean anything, since Dijkstra will always find *some* route if one is
  topologically possible; caught by `keyTerrain.test.ts` before it could ship
  silently broken. Scoring runs in a new `mobilityWorker.ts` `'keyTerrain'`
  request kind (must not run on the main thread — reproduces step 41's
  page-hang otherwise). `mobilityAppreciation.ts` wires it in after
  chokepoints/barrier/roadNetworkBarrier compute, skipping the worker call
  entirely when zero candidates were nominated rather than round-tripping an
  empty request. `OakocPanel.tsx`'s Key terrain section renders real scored
  candidates with `KEY_TERRAIN_MISSION_CAVEAT` always shown and
  `decisiveCandidate` always worded as "candidate, requires a commander's
  confirmation" — never an assertion (doctrine reserves decisive terrain for
  a commander's designation, never a map's). `OcokaKeyTerrainFactor.result`
  can be `null` for two distinct honest reasons (objective unreachable vs. a
  reachable run with zero candidates); the renderer disambiguates rather than
  assuming one implies the other. Full detail: `ROUTE_INTELLIGENCE.md` §47.8.
  Gates green: `npm test` (35/35 files, incl. new `keyTerrain.test.ts` and an
  updated `oakocAssembly.test.ts`), `npm run build`.
- **2026-08-03 — OCOKA 3 shipped (step 49).** Five-factor OCOKA framing over
  existing products, no new computation. New `terrain/oakoc.ts`
  (`buildOcokaAppreciation`) names the existing-vs-reinforcing obstacle split
  the code already computed (`barrier`/`roadNetworkBarrier` vs
  `restrictionPlan`) and presents `corridorField` as Avenues of approach;
  Key terrain/Observation/Cover & concealment ship as explicit
  `'not-assessed'` placeholders (OCOKA 4/6/7), with `fieldsOfFireAssessed`/
  `coverAssessed` machine-readable flags landed early. New `OakocPanel.tsx`
  (third Terrain Mobility tab) renders it, visually distinguishing a real
  per-run `'not-assessed'` (objective unreachable) from the three
  permanently-not-yet-built factors. `roadNetworkBarrier` — computed on
  every vehicle run and discarded since OCOKA 1 — gets its first map layer
  (dashed purple, `MapboxMapView.tsx`), `MobilityLegend.tsx` entry, and
  GeoJSON/KML export feature. `Corridor.bottleneckCellKeys` added for
  OCOKA 4's future key-terrain scoring. Full detail:
  `ROUTE_INTELLIGENCE.md` §47.7. Gates green: `npm test` (34/34 files, incl.
  new `oakocAssembly.test.ts`), `npm run build`.
- **2026-08-02 — OCOKA 1 shipped (step 48).** Mobility-class vocabulary
  migration — one MCOO vocabulary (`unrestricted`/`restricted`/
  `severely-restricted`) instead of two, via new `terrain/mobilityClass.ts`,
  threaded through the search, corridors, map, panel, GIS export and the
  `MobilityAssistantPayload` must-match pair. Three contract risks handled:
  GIS export dual-emits old+new field names for one release
  (`schema_version: 2`); the API validator accepts a cached client's old
  field names via `normalizeLegacyMobilityFields()`, proven by a dedicated
  test; `mobilityTelemetry.ts`'s wire names stay frozen (an existing
  analytics series). Also wired `webapp/tests/` (33 files, previously
  hand-run only) into CI via `npm test`. Gates green: `npm test`,
  `npm run build`, `npm run test:unit`.
- **2026-08-02 — Terminology self-correction: OAKOC/IPOE → OCOKA/IPB.**
  Initial research checked only US Army doctrine; the Australian Army — this
  product's actual audience per `PITCH_TERRAIN_DENIAL.md` — currently
  teaches OCOKA/IPB, corroborated against The Cove. Not old-vs-new, two
  armies' current terms. All roadmap rows renumbered; stage content
  unchanged (same five factors, different letter order). Residual
  uncertainty stated in `ROUTE_INTELLIGENCE.md` §47.0 — corroborated via
  search snippets, not a primary doctrine publication; SME review still
  worth doing before external use.
- **2026-08-02 — OCOKA programme added to the roadmap (stages 1–9).** Owner
  asked how the mode's accidentally-implemented military terrain framework
  could reframe its analysis/presentation, plus a parallel-backend directive
  with a ~10 s first-paint / ~10 s update latency contract. Audit: Obstacles
  and Avenues of approach are largely built and unnamed; Key terrain is ~90%
  computable from existing chokepoint/min-cut machinery; Observation and
  Cover & concealment are the genuine gaps (ROUTE_INTELLIGENCE §9's M5).
  Owner decisions: scale-to-zero (contract is warm-run only) and
  backend-only execution (retires the offline Worker path — Vision
  principle 4 amended). Blocking infra finding: SWA Free/managed functions
  can't run Durable Functions and `/api` caps every request at 45 s — needs
  SWA Standard + a separate Flex Consumption Function App behind a
  `deployMobilityBackend` flag. Full detail: `ROUTE_INTELLIGENCE.md` §47.
- **2026-08-02 — Mobile UI (step 47):** quick mover-class selector (Foot/
  4×4/Medium/Heavy buttons) + `TacticalCoordinateReadout` relocated above
  AREAS OF INTEREST. PR #200.
- **2026-07-29 — Slice B remainder (step 46):** α·C* cost-budget + 2–5
  corridor stop rule; "most likely"/"most risky" corridor picks via a new
  per-corridor `riskScore` composite (documented weights, engineering
  judgement, not a probability). 9-check `corridorRiskAndCount.test.ts`
  added; full suite green.

*(Full history for steps 0–45 — 2026-07-10 through 2026-07-29 — is in the
Shipped table above, each linked as-built doc's own dated section, and
`git log`. Pruned from this file 2026-08-03 to keep it agent-scannable; see
[docs/README.md](docs/README.md) if you need the narrative.)*
