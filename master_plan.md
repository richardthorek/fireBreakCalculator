# Fire Break Calculator — Master Plan

**Last Updated**: August 18, 2026 — step 61: new fire-break feature, "incident box" — draw or import a fire perimeter, get wind (live or manual), enter a manual rate of spread per sector, and get a conservative standoff box ("rate of spread + build time = minimum distance") pathfound into a real buildable corridor via the existing optimizer + production-time engine. Owner-directed, out of queue order. Follows step 60 (Col persona review), step 59 (machinery-defaults visibility/persistence/accuracy review) and step 58 (fire-break efficiency/accuracy pass). See Recent Updates for the dated history, including OCOKA 5 (step 57), OCOKA 2/6/7 (steps 56, 52–53), the OCOKA programme, and its same-day terminology correction (OAKOC/IPOE → OCOKA/IPB for the ADF audience this product actually serves).
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
- **Terrain Mobility:** M1–M4 shipped (mobility core, corridors/chokepoints, trafficability uplift, counter-mobility planner). Being restructured around **OCOKA/IPB** — the terminology the Australian Army (this product's actual audience) currently teaches, per The Cove — with its compute moved to a parallel Azure backend. See the OCOKA programme at the top of "Next up". The mode now presents all five OCOKA factors by name (`OakocPanel.tsx`), and all five are real: Obstacles, Avenues of approach and Key terrain are assembled from (or, for Key terrain, scored from) existing products; Observation (`viewshed.ts`, a third "observe" paint role) and Concealment (`concealment.ts`, dead ground + vegetation structure) are now real too, both gated on whether an observer was painted rather than on the origin/objective search. Only Cover (protection from fire) remains a genuine, permanent, honestly-flagged gap — a bare-earth DEM cannot see a rock, bund or building.

## The Plan

### Next up

Sorted **smallest effort first**, ready-to-start items ahead of blocked ones. Size is rough shirt-sizing (S/M/L), not a time estimate. "Depends on" names a real prerequisite, not just a related area. **Exception: a defect that produces a confidently-wrong answer jumps the queue regardless of size** — see the first row.

**Owner-directed programme (2026-08-02), takes priority over the general queue below.** Terrain Mobility mode is being restructured around **OCOKA** — the *military aspects of terrain* framework the Australian Army currently teaches (Observation and fields of fire, Cover and concealment, Obstacles, Key terrain, Avenues of approach), within **IPB** (*Intelligence Preparation of the Battlespace*) — and its compute moved to a parallel Azure backend with a warm-run latency contract. (The US Army uses the reordered OAKOC and has renamed its own process IPOE — different armies' current terminology, not old vs new; this product follows the ADF's, since that is its audience.) The mode already implements Obstacles and Avenues without naming them; this finishes the set. Fire-break mode is out of scope and does not change. Stages are ordered and each is independently shippable.

| Item | Scope | Size | Depends on | Detail |
|------|-------|------|------------|--------|
| ~~OCOKA 1 — mobility-class vocabulary migration~~ | **Shipped — step 48.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47 |
| ~~OCOKA 2 — extract `shared/@firebreak/terrain` workspace package~~ | **Shipped — step 56.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| ~~OCOKA 3 — five-factor framing over existing products~~ | **Shipped — step 49.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.7 |
| ~~OCOKA 4 — key terrain~~ | **Shipped — step 50.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.8 |
| ~~OCOKA 5 — backend protocol + tier-2 execution (no fan-out yet)~~ | **Shipped — step 57.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §49 |
| ~~OCOKA 6 — `viewshed.ts` + Observation & fields of fire~~ | **Shipped — step 52.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.9 |
| ~~OCOKA 7 — cover & concealment~~ | **Shipped — step 53.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.10 |
| **OCOKA 8 — backend fan-out** | Parallelise what genuinely parallelises: tile sampling (capped at 2–3 concurrent on Overpass), viewshed by observer, mover ensemble by chunk, key-terrain candidates. Dijkstra and the k-dissimilar loop are sequential by construction and stay that way | M | OCOKA 5, 6 (✅) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| **OCOKA 9 — Container Apps Job tier (still gated)** | Unchanged gate: build only on tier-2 evidence of a real tail of oversized runs. Same protocol as OCOKA 5, so it becomes a compute swap rather than new plumbing | L | tier-2 evidence | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| ~~Road-speed `user-override` confidence into GIS export + AI briefing~~ | **Shipped — step 54.** | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| **Movement-analysis performance + progressive-painting programme** | WP1–WP5 shipped (PR [#210](https://github.com/richardthorek/fireBreakCalculator/pull/210), merged); a real progressive-paint regression found via live production testing then fixed (PR [#214](https://github.com/richardthorek/fireBreakCalculator/pull/214)); WP6 (coarse-to-fine search) still design-only — see detail | M/L | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §50 |
| End-user guide | Never existed; decide whether it lives here or in Station Manager's in-app wiki, then write it | S | — | docs/README.md |
| Restrictions costed against `delayLedger.ts` | Both pieces exist; wire the recommended-restriction set through the existing delay-cost model | S/M | restrictionPlanner.ts, delayLedger.ts (✅ both) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| Real mobilisation/transport cost as a modelled figure (not just a caveat) | Step 58 (Col reality check) surfaces the gap honestly (`mobilisationCostIncluded: false`, hero-caveat text) but doesn't model it. Add a flat per-resource fixed cost, shown as a distinct line, never blended silently into the existing per-segment total — keeps `equipmentAnalysis.ts` (CALCULATION_REVIEW.md's "sole accurate engine") as the only place a number is computed | S/M | Step 58 (✅) | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) F6 |
| Job-actuals log on saved plans | A crew logs what actually happened (hours, cost, ground condition note) against a saved plan — over a season this becomes real local calibration data, closing the "no one ever checks these numbers against reality" gap the Col persona review raised. Small schema add to `SavedPlan` (api + webapp must-match pair), no UI beyond one optional-fields form | S | Cloud saved plans (✅) | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) "Col persona review" |
| Per-equipment "field-verified" flag, distinct from "Modified" | The override system (step 58) shows *changed*, not *checked* — a crew that ran a job and confirmed a rate held up has no way to say so. Needs a small model decision: attribute on the override record itself, not a whitelisted Equipment field | S | Equipment overrides (✅, step 58) | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) "Col persona review" |
| Ground-condition modifier (dry/normal/wet) | The Col persona review's sharpest, least-solved point: slope alone doesn't predict trafficability — soil moisture does, and the app has zero awareness of it. A user-set, session/plan-level modifier flagged `estimated` (same data-honesty pattern as everything else) is the realistic scope; real soil-moisture data is a separate, much larger blocked item | M | — | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) "Col persona review" |
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

- ~~**OCOKA 2**~~ — **Shipped, step 56.** See Shipped table + `ROUTE_INTELLIGENCE.md` §38.

- ~~**OCOKA 3**~~ — **Shipped, step 49.** See Shipped table + `ROUTE_INTELLIGENCE.md` §47.7.

- ~~**OCOKA 4**~~ — **Shipped, step 50.** See Shipped table + `ROUTE_INTELLIGENCE.md` §47.8.

- ~~**OCOKA 5**~~ — **Shipped, step 57.** See Shipped table + `ROUTE_INTELLIGENCE.md` §49. Built as a new standalone `api-mobility/` package rather than inside `/api` (SWA allows exactly one backend type at a time — linking a custom backend is a real cutover, not an additive change; see §49's own runbook). All infra gated `deployMobilityBackend bool = false`, unverified by a live deployment. v1 scope: sequential Durable orchestration (route + corridors + hex chokepoints/min-cut + unscored key terrain), estimated-placeholder vegetation, manual trigger only — not yet: the movement ensemble, observation/concealment, road-network-exact min-cut, or export/briefing gating on `provisional`.

- ~~**OCOKA 6**~~ — **Shipped, step 52.** See Shipped table + `ROUTE_INTELLIGENCE.md` §47.9.

- ~~**OCOKA 7**~~ — **Shipped, step 53.** See Shipped table + `ROUTE_INTELLIGENCE.md` §47.10.

- **OCOKA 8 — backend fan-out** (Difficulty: M)
  - Outcome: large runs get materially faster without changing any number they produce.
  - Changes: fan out tile sampling (Overpass capped at 2–3 concurrent — it rate-limits, and this repo has already fought that), viewshed by observer, ensemble by chunk, key-terrain by candidate · pass a blob URI to activities, never the cell array.
  - Note: the multi-source Dijkstra and the k-dissimilar route loop are **sequential by construction** and are deliberately not parallelised. The restriction planner is the long pole; only the ensemble inside each evaluation parallelises.

- **OCOKA 9 — Container Apps Job tier** (Difficulty: L, gated)
  - Outcome: genuine outlier runs complete instead of timing out.
  - Changes: same artefact layout and status document as OCOKA 5, so this is a compute swap.
  - Note: gate unchanged — built only on tier-2 evidence, not speculatively.

##### General queue

- ~~**Road-speed user-override confidence into GIS export + AI briefing**~~ — **Shipped, step 54.** See Shipped table.

- **Movement-analysis performance + progressive-painting programme** (Difficulty: M/L, in progress)
  - Outcome: a Terrain Mobility run no longer hangs the tab, paints real progress on the map as it computes (not just a text log), and completes materially faster.
  - Design decisions (owner-directed): numeric drift from constant-factor optimisation is acceptable if tested, not required bit-identical (turned out unnecessary — see below); compute placement is hybrid client-first, chunk-decomposition kept compatible with OCOKA 8's eventual backend fan-out but the backend is not deployed as part of this programme (a cold Azure Function can't hit a sub-few-second first paint, so the early visible work must stay client-side regardless); search shape is multi-resolution coarse-to-fine, not narrowed to plausible agent paths (would risk silently missing a real avenue of approach).
  - Shipped, PR [#210](https://github.com/richardthorek/fireBreakCalculator/pull/210) (merged): map layers now update incrementally instead of rebuilding; a precomputed per-grid search index removes redundant work across a run's ~120 Dijkstra passes (≈2.2–2.5× on the search core alone); corridor-field construction and both min-cut solves moved off the main thread, which is the actual hang fix; mover-ensemble transit cells now stream to the map as movers complete (real interim data, not synthetic); key-terrain candidate scoring — the single largest chunk of a run's Dijkstra passes — now fans out across multiple worker instances; and all four Tier B redundant-pass fixes have landed (skip a redundant search when arrival times are already known, stop computing min-cut edge costs twice, recompute cross-slope only for new cells plus their halo instead of the whole grid every round, throttle the corridor-count check by real growth).
  - An 8-angle code review of the whole diff then found and fixed three further real correctness bugs (a restricted-corridor build was silently reusing unrestricted arrival-time data; pooled key-terrain scoring under-reported how many candidates it considered on single-core hardware; the corridor-count throttle's safety nets missed one of the loop's three exit paths, risking a stale count reported alongside an overconfident log message) — each verified against the actual code, fixed, and mutation-tested where the fix could regress silently. Five lower-severity findings from the same pass were reported but deliberately left unfixed (pre-existing patterns this PR only amplified, a latent gap with no current trigger, an exact-tie edge case, an architectural duplication trade-off, and a missed opportunity to reuse the incremental map-paint path for the new streaming feature) — see `ROUTE_INTELLIGENCE.md` §50 for the full list.
  - **2026-08-17 — live production report: no progressive paint visible at all.** After #210 merged, owner reported that during a real run the hex grid (GO/SLOW-GO/NO-GO colouring) either doesn't appear until well after the "widening the search" log lines start, or doesn't appear at all. Root cause: `mobilityHeatmapForMap` (`App.tsx`) is a `useMemo` that reads `mobilityPreviewCells` in its body but only listed `[mobilityResult]` as a dependency — since `mobilityResult` stays `null` for the entire search phase, React never recomputed the memo as `onPreviewCells` fired repeatedly, so the map stayed frozen at its initial `null` value until a route was finally confirmed. A production console log shared alongside the report (`/api/infrastructure` 502s, an Overpass CORS failure) was investigated and ruled out as the cause — `fetchCorridorInfrastructure`'s own contract ("every endpoint has failed; never throws") means an Overpass outage degrades gracefully and isn't on the hex-grid rendering path. Fixed by adding the missing dependency — PR [#214](https://github.com/richardthorek/fireBreakCalculator/pull/214).
  - **2026-08-17 — Overpass resilience at scale.** The same production log raised a real "what happens under real concurrent multi-user load" gap: `infrastructureService.ts`'s cache was in-process only (private per warm Function instance, so scale-out/cold starts re-pay the same fetch) and had no concurrency limit at all, even though Overpass's public mirrors enforce a per-IP CONCURRENT-connection cap (not a rate limit) — a handful of simultaneous users alone can trip it. Added a shared L2 blob cache (`infracache` container, `infra/main.bicep`, 7-day lifecycle expiry, same key as the existing L1) plus a small in-process semaphore (`OVERPASS_MAX_CONCURRENT`, default 2) queuing outbound Overpass calls instead of firing them all at once — the semaphore, not the cache, is what actually protects the quota under a cache-miss storm. See `docs/api-register.md`'s Infrastructure section for the full design.
  - **2026-08-17 — the actual root cause of "still frozen, still no map painting" after #214: elevation sampling silently fell off a cliff at scale.** A further owner report, WITH the #214 fix already live, showed the freeze and blank map persisting, plus a `POST /api/elevation/profile` 400 in the console. Root cause: `ROUTE_INTELLIGENCE.md`'s own "Data cost" section (written 2026-07-27) had already predicted this exact wall — the DEM primary path encodes every point into one request URL with a hard cap (5,000 points), and the two-pass coarse/fine split designed to avoid ever hitting it at scale was explicitly deferred when the lazy grid shipped 2026-07-29. `'standard'/'fine'` fidelity's own hard cell ceilings (12,000/50,000) are routinely past that cap, so a real run's elevation fetch 400'd outright, and the existing "DEM failed → fall back to per-point Mapbox" path then fired for the WHOLE oversized batch — a request-per-point tile fetch/decode loop, which is what was actually freezing the tab and starving the (correctly-fixed) progressive-paint pipeline of any data to paint. Fixed with client-side chunking (`sampleElevationsBatch`, `slopeCalculation.ts`) — splits any point set over the cap into multiple ≤5,000-point DEM requests instead of one oversized request, so every chunk still gets the fast batched path and per-point fallback only fires for a chunk whose OWN request genuinely fails. This is NOT the two-pass redesign (still unbuilt, still the real fix for DEM call *volume*) — it makes the current uniform-resolution pipeline correct and reasonably fast at any scale instead of silently breaking past 5,000 cells. See `ROUTE_INTELLIGENCE.md`'s "Data cost" section and `CALCULATION_REVIEW.md`'s A2/F4 note.
  - Remaining: the coarse-to-fine search itself — now fully designed (not yet implemented) in `ROUTE_INTELLIGENCE.md` §50's WP6 section: two passes over the existing pipeline at different `hexSize`s, fine-resolution materialisation restricted to the coarse pass's own multi-corridor candidate bands (not narrowed to one path), with the residual "a real avenue could be too narrow for the coarse pass to see" risk stated as a limitation rather than engineered away; frontier-streaming from the Dijkstra search phase is also still unbuilt. **This remains the actual fix for elevation-sampling volume at scale** — today's chunking fix only prevents it from breaking outright.
  - Note: while investigating, found `main` had not deployed since 2026-08-03 (unrelated pre-existing CI break, Oryx couldn't resolve `shared/terrain`'s own deps) — fixed and shipped separately as its own PR ([#211](https://github.com/richardthorek/fireBreakCalculator/pull/211), merged), off `main`, independent of this programme. Its own merge to `main` then failed `Build & Test` on a wall-clock-timing-dependent flaky test — fixed with a test-only dependency-injection seam, PR [#212](https://github.com/richardthorek/fireBreakCalculator/pull/212), merged.

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
| 51 | Fixed: `onTrail` detection was centre-point-only — a road threading across a hex without passing near its centroid read as off-trail and got hard-gated by vegetation/slope, painting a real, unbroken road NO-GO/severely-restricted (live bug report) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §48 |
| 52 (OCOKA 6) | Observation & fields of fire — `terrain/viewshed.ts` real front-to-back line-of-sight (curvature + refraction, screened vs bare-earth), third "observe" paint role, `SCREENING_HEIGHT_M` table; `OcokaObservationFactor` gated on whether an observer was painted, not on `path` | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.9 |
| 53 (OCOKA 7) | Cover & concealment split, never blended — `terrain/concealment.ts` derives dead ground from OCOKA 6's own visibility union and vegetation-structure concealment from the same screening-height table; cover stays permanently, honestly not computed | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47.10 |
| 54 | Road-speed user-override confidence carried into GIS export attributes and the AI briefing payload/template, mirroring the existing hydrology pattern | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 55 | Fixed a performance regression in step 51's own `onTrail` corner-sampling fix — 7× per-feature calls collapsed to 7 cheap whole-array calls + one tag-resolution pass, same correctness | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §48 |
| 56 (OCOKA 2) | `shared/@firebreak/terrain` extracted — 22 pure terrain/mobility modules moved out of `webapp/src/terrain`+`utils`+`config`, consumed via a TS path alias (not npm workspaces, to protect Azure SWA's Oryx deploy build); `ConfidenceTier` relocated out of a `.tsx` component; mover ensemble seeding made chunk-invariant (`hash(seed, moverIndex)`), a flagged one-time numbers change | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| 57 (OCOKA 5) | Tier-2 backend job protocol — new standalone `api-mobility/` package (Durable orchestrator, 5 sequential activities, blob artefacts, per-artefact SAS, Table-Storage rate limiting), `MobilityJobRequest` third must-match pair, webapp polling client + manual trigger panel, `infra/main.bicep` additions all gated `deployMobilityBackend bool = false`. No fan-out (OCOKA 8); v1 algorithmic subset only | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §49 |
| 58 | Fire-break efficiency/accuracy pass — manual-draw vegetation now pre-warms the area cache (was per-point only), slope+vegetation analysis run concurrently, frontend legacy calc no longer eagerly computed/shown while the backend is loading (was a live, not just offline, split-brain), cross-slope probes batched, an unsourced over-limit fallback rate named; water/existing-trail geometry (already fetched for the `isWater`/`onExistingTrail` flags) now drawn on the map, mirroring Terrain Mobility's own hydrology reference layer | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) |
| 59 | Machinery defaults: visibility, per-user customisation/persistence, accuracy review — closed a real anonymous-global-write gap on the standard catalogue, added a per-user override layer (session-only until signed in, account-persisted with `fireBreakEnabled`), and reviewed/cited all 15 standard items' sourcing in a visible UI tooltip | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) "Standard catalogue accuracy review" |
| 60 | Col persona review acted on: granular vegetation class (NVIS MVG/NSW SVTM PCT name) no longer silently discarded on segment-merge, now shown per-row and in GIS export; a headline-estimate caveat ("not one flat rate, excludes mobilisation"); new "Field reality check" AI persona/endpoint grounded in the same payload+contract as the narration assistant | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) "Col persona review", [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) §4b |
| 61 | Incident box — draw/import a fire perimeter, wind (live/manual), manual per-sector rate of spread, conservative standoff-distance solve ("ROS + build time = minimum distance"), pathfound into a buildable corridor via the existing optimizer + production-time engine; new `GET /api/wind` | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) "Incident box" |

## Recent Updates

Short rolling window — most recent first, oldest first pruned. Every entry's
full substance is preserved elsewhere: the **Shipped** table above (one line,
every step, permanent) and the linked as-built doc's own dated section. Full
history beyond this window: `git log`.

- **2026-08-18 — Incident box, a new fire-break feature (step 61,
  owner-directed).** Owner asked for: draw/paint the current fire perimeter,
  use current weather for wind, recommend a standoff "box" prioritising the
  head and flanks, account for build time given weather/terrain, be
  conservative, and let the box be adjusted before pathfinding specific
  corridors — then, mid-implementation, sharpened the core algorithm to
  "rate of spread plus construction time equals minimum distance" (rate of
  spread as a manual input, not predicted) and added "load a fire polygon,
  click a job, one button to draw containment."
  - **Perimeter**: manual multi-click polygon draw tool on the map (own
    armed state in `MapboxMapView.tsx`, finished by an explicit button, not
    a click-count/dblclick — dblclick already means zoom), OR import from
    the already-shipped `fetchFireBoundaries()` national live feed
    (`incidentBoundaryImport.ts`). Note: the NSW RFS "majorIncidents.json"
    feed named in the original ask is point-only (no polygon geometry) —
    `fetchFireBoundaries()` (Digital Atlas NRT) is the feed that actually
    carries fire polygons, and it's already national, not NSW-only, so
    every state it lists works identically with no extra code.
  - **Wind**: new `GET /api/wind` server-proxies Open-Meteo (live, free, no
    key) — deliberately not presented as a BOM/AFDRS product (that access
    is a separate, still-blocked item). Manual entry is a first-class
    fallback (`usedFallbackWind` flag, a must-match pair
    `api/src/types/incidentBox.ts` ↔ `webapp/src/utils/windService.ts`), so
    fire-break mode's zero-reception guarantee still holds if the fetch
    fails or the device is offline.
  - **The standoff-distance algorithm — not a fire-behaviour model.** This
    app's data-honesty rule (no fabricated analysis) rules out an invented
    spread-rate coefficient the same way it already rules out an invented
    fuel-age clearing-rate curve. Rate of spread is a manual, per-sector
    user input (head required; flank/rear default to head — the
    conservative choice). `incidentBoxGeometry.ts` (pure, unit-tested)
    classifies perimeter vertices into wind sectors; `incidentBoxPlanner.ts`
    solves each sector's standoff distance by fixed-point iteration against
    the EXISTING production-time engine (`analyzeTrackSlopes`/
    `analyzeTrackVegetation`/`calculateEquipmentAnalysis` — no new costing
    model), taking the conservative (max, never min) compatible-resource
    time each round and setting the next candidate distance to
    `rate-of-spread × that time`. A sector that doesn't converge within 3
    rounds is flagged `converged: false` — its distance is a lower bound,
    not a settled answer, same honesty discipline as OCOKA's cover/
    concealment gap.
  - **Pathfinding**: once distances settle, the box is pathfound ONCE
    through the existing corridor optimizer (`optimizeRoute`) as a closed
    loop — this is what snaps the recommended line onto existing roads/
    trails (already built, per the owner — reuses the optimizer's existing
    trail-discount behaviour) and routes around water, with no new
    pathfinding code. Falls back to the raw box ring if pathfinding fails
    (`usedFallbackRoute` flag).
  - **Adjustability**: the box is regenerated from adjustable rate-of-spread/
    wind inputs rather than draggable vertex editing — a deliberate scope
    choice for a first slice, and arguably better for touch/field use per
    this repo's own "touch-first" rule than fiddly vertex-dragging on a
    small screen; draggable editing is a possible follow-up, not shipped.
  - New `IncidentBoxPanel.tsx` (fire-break mode only, mutually exclusive
    with the existing area-recon tool and with Terrain Mobility mode, same
    pattern as the existing tool-exclusivity effect in `App.tsx`) shows the
    conservative headline time plus the same equipment-comparison table
    shape `AnalysisPanel.tsx` already renders — no second costing engine,
    no duplicated numbers. Gates green: webapp `npm test` (47/47, one new
    file, `incidentBoxGeometry.test.ts`) + `npm run build`, api `npm run
    build` (existing `test:unit` suite unaffected — zero risk, nothing in
    `/api` outside the new `wind.ts`/`windService.ts`/`incidentBox.ts`
    files was touched).
- **2026-08-18 — Col persona review acted on (step 60): vegetation
  granularity, headline caveat, "Field reality check" AI persona.** Owner
  ran a role-play critique exercise (a sceptical, forty-year heavy-plant/
  hand-crew veteran, "Col") against the app, then asked for the resulting
  recommendations to be implemented, with vegetation granularity called out
  as the priority and — a distinct follow-up ask — for that same reality-
  check *perspective* to be baked into the app itself rather than assumed
  present at every desk-planning decision. Six recommendations came out of
  the critique; three were implemented in full, three scoped down or
  deferred honestly (see the new "Next up" rows) rather than half-built
  under time pressure:
  1. **Granular vegetation class was already fetched and then silently
     discarded** — `VegetationSegment.displayLabel` (an NVIS MVG name or
     NSW SVTM PCT/formation name, populated since well before this session)
     was set but then erased by TWO separate merge steps that only compared
     the coarse 4-bucket `VegetationType`: `vegetationAnalysis.ts`'s
     rawSegments→mergedSegments merge, and `segmentJoin.ts`'s own
     slope×vegetation join merge (shared by the segment table AND every GIS
     export, `gisExport.ts`'s `vegetation_label` field). Both merges now
     also require the granular label to match — real classes stay visible
     wherever the app already threads them, no new data source, no change
     to the coarse costing bucket. `SegmentBreakdown.tsx` promotes the
     label from a hover-only tooltip to visible sub-text per row.
  2. **Headline-number caveat** — the hero time readout (`AnalysisPanel.tsx`)
     now states plainly it's a sum of N ground segments, not one flat rate,
     and that mobilisation/travel to site is excluded, with a one-click
     jump to the segment breakdown.
  3. **"Field reality check" (Col) — new AI persona, same grounding
     contract.** New `POST /api/assistant/reality-check`
     (`assistantRealityCheck.ts`) and `RealityCheckCard.tsx`, mounted in
     the Assistant tab beside (never merged into) the existing narration
     assistant. `buildRealityCheckSystemPrompt` (`aiGrounding.ts`) shares
     the exact STRICT_RULES block with the narration prompt (refactored
     into a single constant so the two personas' grounding contract cannot
     drift) — a critique persona is not licence to guess. `AssistantPayload`
     gained four optional reality-check fields (`segmentCount`,
     `lowConfidenceSegmentCount`, `equipmentCaveats`,
     `mobilisationCostIncluded`) — a must-match pair
     (`api/src/types/assistant.ts` ↔ `webapp/src/utils/assistantApi.ts`) —
     so the persona has real ammunition instead of a vague description:
     `equipmentCaveats` is populated by joining tasked equipment against
     the effective catalogue (overrides applied) and pulling each standard
     item's own `sourceNote` from step 59's accuracy review. A deterministic
     template fallback (`realityCheckTemplate.ts`) means the reality check
     works even with no AI model configured — the gaps it flags are already
     computed, the AI layer only adds plain-language framing. New
     `realityCheck.test.ts` (12 checks): prompt states the shared contract,
     template surfaces each flag with real counts/quoted text (never "some"),
     multiple concerns all list, a clean payload states there's nothing to
     flag rather than inventing one.
  4. **Deferred, not silently dropped** (new "Next up" rows, all citing this
     review): modelling mobilisation cost as a real fixed-cost line (today
     it's an honest caveat, not a number); a job-actuals log on saved plans
     so a season of real jobs becomes local calibration data; a
     per-equipment "field-verified" flag distinct from "Modified" (changed
     ≠ checked); a ground-condition (dry/normal/wet) modifier — the
     sharpest, least-solved point raised (the app has zero soil-moisture
     awareness; slope alone doesn't predict trafficability).
  Gates green: webapp `npm test` (45/45 files) + `npm run build`, api
  `npm run build` + `npm run test:unit` (12 new checks, all prior suites
  unaffected).
- **2026-08-18 — fire-break efficiency/accuracy pass (step 58).** A
  mobility-side-style deep review of fire-break mode's own logic (mirroring
  the movement-analysis performance programme, not re-litigating
  `CALCULATION_REVIEW.md`'s already-shipped F1–F8/A1–A7 items) found and
  fixed five real issues, plus a follow-on visualization request:
  **Efficiency** — `vegetationAnalysis.ts`'s manual-draw path
  (`analyzeTrackVegetation`, the primary fire-break flow) never called
  `fetchStateVegetationArea` before its per-segment point loop, so every
  drawn line fired one NSW/NVIS query per ~200 m sample even though
  `routeOptimizer.ts`'s own `sampleVegetation` had already solved exactly
  this with an area-first pre-warm; now pre-warmed the same way above
  `AREA_QUERY_MIN_POINTS`. `MapboxMapView.tsx`'s `analyzeAndRender` ran
  slope and vegetation analysis sequentially despite being independent data
  sources — now `Promise.all`'d. `slopeCalculation.ts`'s cross-slope probe
  resolution looped one `Promise.all` per probe instead of batching all of a
  segment's probes together — now one batched resolution per segment.
  **Accuracy** — confirmed the "A1 split-brain" documented as resolved in
  `CALCULATION_REVIEW.md` was still live in production, not just an offline
  fallback: `AnalysisPanel.tsx`'s frontend coarse single-bucket model was
  eagerly computed and shown during the real window before every backend
  response (and indefinitely on backend failure), silently swapping the
  displayed number between two different estimates depending on network
  timing. Fixed by gating the frontend calculation on the backend being
  genuinely unavailable/errored, never merely "hasn't answered yet" — the
  panel's own `isBackendLoading` diagnostic message was already designed
  for this and had been dead code until now. Also named
  `equipmentAnalysis.ts`'s previously-unlabelled `refRate × 0.1` over-limit
  notional-rate fallback as `OVER_LIMIT_NOTIONAL_RATE_FRACTION` with a
  provenance comment (still unsourced, same honesty as F3/F7's factors).
  **Visualization (follow-on request)** — fire-break mode already fetched
  real water and existing-trail/track geometry per line to derive each
  segment's `isWater`/`onExistingTrail` flags, then discarded it; that
  geometry is now carried through on `VegetationAnalysis`
  (`waterFeatures`/`trailFeatures`) and drawn on the map, reusing the exact
  technique Terrain Mobility's own hydrology reference layer already uses
  (filled polygon for water bodies, cased line for
  rivers/streams/tracks) — repurposed `MapboxMapView.tsx`'s previously-dead
  `vegetationAnalysis` state slot rather than adding a new one. Gates green:
  api `npm run build` + `npm run test:unit`, webapp `npm run build` +
  `npm test` (46/46). PR [#218](https://github.com/richardthorek/fireBreakCalculator/pull/218).
- **2026-08-18 — Deploy-failure assessment (owner-requested check).** Owner
  flagged "the latest deploys also had a failure" while this branch's work
  was in progress. Traced it: `main` run [#31999630017](https://github.com/richardthorek/fireBreakCalculator/actions/runs/31999630017)
  (2026-08-17T05:55Z, commit `bbf70d2`) failed — Dependabot PR #195 bumped
  `api`'s `typescript` devDependency to 7.0.2, which has stricter module
  resolution/type checking than 5.x and broke the api build (`node:assert`
  default-export import compatibility, missing `lib`/`types` compiler
  options). **Already fixed** by commit `ccbd862c` (PR #213, merged
  2026-08-17T06:17Z, 22 minutes later, well before this branch existed) —
  `api/tsconfig.json` gained `lib: ["es2017"]` + `types: ["node"]`, test
  files switched to default-import `assert`, `e2e.test.ts` got one type
  assertion. Every `main` run since (`ccbd862c` onward, including both
  runs today) is green. This branch's base commit already carries the fix
  — confirmed by this session's own `api` gates (`npm run build` +
  `npm run test:unit`) passing clean throughout. No new work needed; logged
  here because it hadn't been recorded in this file yet, and "assess and
  record" was the explicit ask, not "there's live breakage to fix."
- **2026-08-18 — Machinery defaults: visibility, customisation/persistence,
  accuracy review (step 59, owner-directed, out of queue order).** Two asks:
  (1) any user can adjust a standard machinery/aircraft/hand-crew item's
  cost/rate/limits; anonymous edits are session-only (`sessionStorage`,
  gone on tab close), signed-in users (Station Manager, `fireBreakEnabled`
  — same entitlement saved plans use) get it persisted per-account and
  restorable, with a "Reset to default" action — the intended sign-up
  incentive. (2) reviewed and cited the sourcing behind all 15 standard
  catalogue items, visible in the app (equipment panel "Std" badge
  tooltip), not just in a doc. **A real correctness gap found and fixed
  along the way:** `equipmentUpdate`/`equipmentDelete` were fully
  anonymous with no session/account distinction at all — any visitor
  editing a standard item permanently mutated the *shared* Table Storage
  row for every other user. Fixed by making standard rows read-only via
  those endpoints (`409 { standard: true }`, pointing to the new API
  instead) and adding a per-user override layer
  (`api/src/models/equipmentOverride.ts` + `equipmentOverridesStore.ts` +
  three new `equipmentOverride*` functions) that patches only the
  whitelisted fields a user actually changed — the platform default row is
  never touched, so deleting an override reverts exactly. Full detail,
  including the accuracy review's findings by confidence tier and what
  couldn't be verified in this pass (two source PDFs returned 403/binary
  in the review environment — corroborated via secondary sources instead,
  stated honestly per item, not glossed over): `CALCULATION_REVIEW.md`
  "Standard catalogue accuracy review" + "Customisation & persistence
  architecture". Gates green: webapp `npm test` (45/45 files) + `npm run
  build`, api `npm run test:unit`.
- **2026-08-03 — OCOKA 5 shipped (step 57): tier-2 backend job protocol.**
  New standalone `api-mobility/` package (not inside `/api` — researched
  against current Microsoft Learn docs first: a Static Web App allows
  exactly one backend type at a time, so linking a custom Function App as
  `/api`'s backend is an all-or-nothing cutover requiring the EXISTING
  managed-functions code to move onto the same app too, not an additive
  change like `deployAiAssistant`. Deferred to a documented manual runbook
  rather than automated blind — see `ROUTE_INTELLIGENCE.md` §49). Ships: a
  Durable orchestrator running 5 sequential activities (grid sample → cost
  field/route → corridors → chokepoints/hex min-cut → unscored key terrain),
  each threading heavy data via blob pointers rather than through Durable's
  own serialisation; `POST/GET /mobility/jobs` returning pointers only,
  never Durable internals; a per-artefact SAS reminted on every poll (a real
  refinement over the design's single-submit-time-SAS text — this storage
  account has no ADLS Gen2 directory-scoped SAS, so per-blob is what's
  actually job-scoped rather than container-wide); Table-Storage rate
  limiting + a concurrent-job cap; `MobilityJobRequest`, the third webapp/api
  must-match pair; a manual (not automatic-threshold) trigger panel in
  `MobilityPanel.tsx`, gated on `VITE_MOBILITY_API_BASE_URL` so no
  deployment shows a dead button. `infra/main.bicep` additions (storage,
  Flex Consumption Function App + plan, SWA linked-backend resource) all
  behind `deployMobilityBackend bool = false`, compiled clean with the
  standalone Bicep CLI but unverified by a live deployment. Deliberate v1
  scope cuts, each flagged in code/docs: vegetation ships as an estimated
  placeholder (no server-side NVIS/NSW classification yet), DEA water
  frequency isn't sampled server-side, origin/objective are bounding boxes
  not painted-dab membership, and the movement ensemble/restriction
  planner/observation/concealment/road-network-exact min-cut stay tier-1
  (client Worker) only for now. No fan-out — that's OCOKA 8, built once
  tier-2 has real usage evidence. Gates green: `api-mobility`'s own
  `npm test` (new package), webapp's `npm test` (38/38) + `npm run build`,
  `api`'s existing tests untouched (zero risk — nothing in the new package
  is imported by `/api`). PR
  [#207](https://github.com/richardthorek/fireBreakCalculator/pull/207).
- **2026-08-03 — OCOKA 2 shipped (step 56): `shared/@firebreak/terrain`
  extracted.** Prerequisite for OCOKA 5's server-side execution — the same
  algorithm code now has one home instead of risking a client/server fork.
  Moved (not copied) 22 pure-compute modules — `accumulatedCost.ts`,
  `concealment.ts`, `corridorAnalysis.ts`, `corridorField.ts`,
  `counterMeasures.ts`, `delayLedger.ts`, `keyTerrain.ts`,
  `minCutBarrier.ts`, `mobilityClass.ts`, `mobilityCost.ts`,
  `movementSimulation.ts`, `moverProfiles.ts`, `paintedArea.ts`,
  `restrictionPlanner.ts`, `roadGraph.ts`, `roadRouting.ts`,
  `roadSpeedModel.ts`, `viewshed.ts`, `dataLayers/demDerivatives.ts`,
  `dataLayers/structureTable.ts`, plus `utils/chainage.ts`,
  `utils/hexGrid.ts` and `config/classification.ts` (the "sampling
  utils"/shared vocabulary both modes' code touches) — into
  `shared/terrain/src`. Everything genuinely network-fetching or
  browser-API-coupled stayed in `webapp/src/terrain` (`mobilityGrid.ts`,
  `mobilityLazyGrid.ts`, `mobilityAppreciation.ts`, `mobilityWorker.ts`,
  `mobilityWorkerClient.ts`, `mobilityTelemetry.ts`, `roadRouteSearch.ts`,
  `unitSimulation.ts`) — plus `oakoc.ts`, a deliberate recorded exception:
  it only assembles the OCOKA view-model from an already-computed
  `MobilityAppreciationResult` for `OakocPanel.tsx`, never something a
  server independently computes. **Deviation from the original plan, made
  for safety:** no root npm workspace. Azure SWA's
  `Azure/static-web-apps-deploy@v1` runs an independent Oryx remote build
  scoped to `app_location`/`api_location` with no workspace awareness — a
  workspace install would risk silently breaking the live deploy. Instead
  `@firebreak/terrain` is a TS path alias (`webapp/tsconfig.json` paths +
  `vite.config.ts` resolve.alias) straight to the package's source; see
  `shared/terrain/README.md`. Two small pre-existing snags surfaced and were
  fixed in the move, not introduced by it: `SimPathNode` (was in
  `mobilityWorker.ts`) and `nearestCellKey` (was in `mobilityGrid.ts`) both
  had pure-module callers that would've had to import from a
  browser-coupled file, so both relocated to `accumulatedCost.ts` with the
  originals re-exporting for their own webapp callers; `ConfidenceTier`
  relocated out of `components/DataConfidenceBadge.tsx` (a `.tsx` file) into
  a plain type module, which re-exports it back for webapp use. Also
  shipped the roadmap's other OCOKA 2 requirement: the mover ensemble's
  seeded RNG was one `mulberry32(seed)` instance shared across the whole
  mover loop, so mover N's draws depended on how many draws movers 0..N-1
  had already consumed — inherently un-chunkable ahead of OCOKA 8's fan-out.
  Now each mover gets its own stream from `hash(seed, moverIndex)`
  (splitmix32-style avalanche) — **a flagged, deliberate one-time change to
  today's ensemble numbers**, not silent drift. Full detail:
  `ROUTE_INTELLIGENCE.md` §38.1. Gates green: `npm test` (38/38 files),
  `npm run build`, api `npm run test:unit`. PR
  [#206](https://github.com/richardthorek/fireBreakCalculator/pull/206).
- **2026-08-03 — Fixed a performance regression in step 51's own fix (step
  55, live report: "stuck at 20% on any reasonable sized run; very small
  areas still work").** Step 51's centre+corners `onTrail` fix was correct
  but called `distanceToNearestTrail` once per (sample point × trail
  feature) pair — 7× the original scan's cost, invisible on a small AOI's
  few cells/features but dominant on a "reasonable sized" one. Fixed
  without touching the correctness guarantee: `sampleOnTrail` now calls
  `distanceToNearestTrail` with the WHOLE trails array once per point (7
  cheap calls, same pattern the water scan's own corner loop already uses),
  then resolves `nearestTrailTags` with a single per-feature pass only for
  the one winning point. Same global minimum-distance-wins semantics, same
  37/37 test suite green. Full detail: `ROUTE_INTELLIGENCE.md` §48
  addendum.
- **2026-08-03 — Road-speed user-override confidence into GIS export + AI
  briefing (step 54).** The override mechanism itself has been shipped
  since step 21, visibly flagged in the panel/run log — this carries that
  same flag into export attributes (`road_speed_overrides_active`/
  `road_speed_override_count`, GeoJSON/KML) and the assistant payload/
  briefing template, mirroring how hydrology (step 42) already behaves.
  New `countActiveRoadSpeedOverrides()` (`roadSpeedModel.ts`) is the single
  source of truth both sides read, so GIS export and the briefing can't
  drift into disagreeing. Webapp+API `MobilityAssistantPayload` kept in
  lock-step per this repo's own must-match-pair rule.
- **2026-08-03 — OCOKA 6 (step 52) and OCOKA 7 (step 53) shipped.**
  Observation and Concealment are both real now — only Cover remains a
  genuine, permanent gap. `terrain/viewshed.ts`: a real per-target
  front-to-back line-of-sight trace (new `hexLine()` in `hexGrid.ts`),
  Earth curvature + refraction applied on top of the already-known
  bare-earth-DEM optimism, screened (vegetation-canopy-aware, via a new
  `SCREENING_HEIGHT_M` table cited to Specht 1970/Muir 1977 NVIS structural
  bands) and bare-earth surfaces both always computed. A third "observe"
  paint role (pink, `#EC4899`) lets a user place observers — resolved to
  cell keys the SAME real area-overlap way origin/objective already are.
  Caught before shipping: `mobilityLazyGrid.ts`'s observer resolution only
  ran once at round 1, so an observer sited off the direct route could
  silently never be materialised — fixed by unioning the observer paint's
  own bounds into the round-1 footprint. `terrain/concealment.ts` (OCOKA 7)
  derives dead ground almost for free — a set complement over
  Observation's own visibility union, since defilade only means something
  relative to a specified position, which the painted observers already
  are — plus vegetation-structure concealment from the same screening
  table. `OcokaObservationFactor`/concealment's own `state` gate is
  deliberately independent of `result.path`, unlike every other OCOKA
  factor: viewshed never depended on origin reaching objective. Cover
  (`coverAssessed: false`) stays permanently, honestly not computed — a
  bare-earth DEM and a 4-class vegetation taxonomy cannot see a rock, bund
  or building. Full detail: `ROUTE_INTELLIGENCE.md` §47.9/§47.10. Gates
  green: `npm test` (38/38 files, incl. new `viewshed.test.ts` and
  `concealment.test.ts`), `npm run build`.
- **2026-08-03 — Fixed: `onTrail` detection was centre-point-only (step 51,
  live bug report).** A road painted straight through an analysed area came
  out NO-GO/severely-restricted on both sides of the real, unbroken road,
  blocking a much more direct route. Root cause: `mobilityGrid.ts`'s
  `onTrail` scan tested only a hex's CENTRE point against the 30 m trail
  snap distance, unlike `waterDistanceM`'s equivalent scan (already
  centre + six hex corners). A road can thread diagonally across a hex
  without passing within 30 m of its centroid — especially once hex size
  grows past ~30 m on a wide-area run, since hex size scales with AOI span
  (`computeCellBudget`) — so those hexes fell back to vegetation/slope-only
  classification and got hard-gated at full severity by
  `mobilityCost.ts`'s onTrail-exempted slope/hydrology/vegetation gates,
  even though a real mapped road ran through them. Fix: extracted the scan
  into a small pure `sampleOnTrail()` (`mobilityGrid.ts`) using the same
  centre+corners, minimum-distance-wins pattern the water scan already had,
  so `mobilityLazyGrid.ts` (which calls the same shared
  `sampleCellsForHexes`) gets the fix too without a second copy. New
  `onTrailHexCorners.test.ts` proves the pre-fix centre-only behaviour
  missed a corner-clipping road and the fix finds it, plus a
  false-positive control. Full detail: `ROUTE_INTELLIGENCE.md` §48. Gates
  green: `npm test` (37/37 files), `npm run build`.
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
*(Full history for steps 0–47 — 2026-07-10 through 2026-08-02, including the
OCOKA programme's own kickoff (stages 1–9 scoped, owner decisions on
scale-to-zero and backend-only execution, the SWA Standard + Flex
Consumption Function App infra finding) — is in the
Shipped table above, each linked as-built doc's own dated section, and
`git log`. Pruned from this file 2026-08-03 to keep it agent-scannable; see
[docs/README.md](docs/README.md) if you need the narrative.)*
