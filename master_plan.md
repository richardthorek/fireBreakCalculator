# Fire Break Calculator — Master Plan

**Last Updated**: July 27, 2026 — roadmap reorganised into Shipped / Next up / Blocked, sorted by effort; see Recent Updates for the dated history.
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
4. Field-ready: offline-capable, touch-first, low data.

## Current state

- **Estimates:** per-segment production model in the API is the sole engine ([docs/CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md)).
- **Vegetation:** NVIS national spine + NSW SVTM overlay; state expansion frozen ([docs/NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md)).
- **Route intelligence:** corridor pathfinding, chainage-addressed segment detail, elevation profile, rule-based Plan Assistant, tabbed analysis UI — shipped in PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163) ([docs/ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md)). Infrastructure trail lookup (OSM/Overpass) is now multi-endpoint resilient after a live-tested rate-limiting bug was found and fixed 2026-07-12.
- **Live context:** national hotspots + fire/burn-area boundaries, plus incident/warning overlays for 5 of 8 states, are live on the map ([docs/GIS_INTEROP.md](docs/GIS_INTEROP.md) §4). AFDRS official fire-danger rating is **blocked on access** (BOM Registered User program), not effort — see the assessment in that doc.

## The Plan

### Shipped

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
| 16 | Fire-break: cross-slope (sidehill) safety gate | A distinct NWCG sidehill limit (~45% ≈ 24°) from the along-line uphill limit (~55% ≈ 29°, already gated) — DEM sampled either side of the line, gated independently | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) F2 |
| 17 | Fire-break: fire history (NAFI) as informational context | Most-recent-fire figure surfaced per line (northern Australia/rangelands coverage); deliberately NOT folded into time/cost — no sourced fuel-age→clearing-rate curve exists to apply | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md) |

### Next up

Sorted **smallest effort first**, ready-to-start items ahead of blocked ones. Size is rough shirt-sizing (S/M/L), not a time estimate. "Depends on" names a real prerequisite, not just a related area. **Exception: a defect that produces a confidently-wrong answer jumps the queue regardless of size** — see the first row.

| Item | Scope | Size | Depends on | Detail |
|------|-------|------|------------|--------|
| 🐞 **Terrain Mobility: the bounding box is the bug** | Field-reported (Lake George W→E): the AOI is padded by 20% *of the origin↔objective span*, so a straight run across a long perpendicular obstacle gets almost no room to detour and returns "no route" — unable to distinguish "there is no way" from "I wasn't allowed to look". Fix: lazy grid materialisation under an A* frontier, a **cost budget** (α·C\*, 2× default, user-adjustable) replacing the geometric bound, stop on **2–5 distinct corridors**, two uniform passes (coarse-wide then fine-narrow), eager coarse tiles + lazy fine cells, and an honest no-route report that paints the explored frontier | L | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| End-user guide | Never existed; decide whether it lives here or in Station Manager's in-app wiki, then write it | S | — | docs/README.md |
| Hydrology attributes in GIS export / AI briefing | Water-gate fields already computed (§34); not yet carried into export attributes or the briefing payload | S | Pass 6 (✅) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §34 |
| OSM water relations (multipolygon lakes) | Only `way`-tagged water features are fetched today; add relation support | S | Pass 6 (✅) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §34 |
| Vegetation NVIS-first uplift | Explicit `NoData` handling; flag cleared/modified segments distinctly | S | — | [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md) |
| Restrictions costed against `delayLedger.ts` | Both pieces exist; wire the recommended-restriction set through the existing delay-cost model | S/M | restrictionPlanner.ts, delayLedger.ts (✅ both) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| A real fuel-age → clearing-rate relationship | Genuinely blocked on **finding a sourced curve**, not on plumbing — NAFI fire-age and DEA fractional-cover are both fetched and surfaced as context (steps 10, 17) but nothing grounds how they should move the production rate; do not invent a coefficient | M+ | a citable source (research literature / agency guidance) | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md), [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §31 |
| UI/UX uplift, moves 4–5 | Shared type/confidence discipline across both modes; extend Terrain mode's mobile floating-overlay pattern to fire-break mode | M | moves 1–3 (✅) | master_plan Recent Updates, 2026-07-26 |
| Road class modelling | OSM `highway=*` is fetched and discarded — a highway and a farm track are identical to a mover; needs a speed/limit-by-class table | M | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| Vector RAG via Azure AI Search | Keyword KB works; RAG needs an Azure AI Search resource provisioned | M | Azure AI Search resource | [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) |
| Restriction siting at a surveyed point | Currently hex-cell resolution, not a specific point — an architecture change to the placement model | L | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| Field hardening | Offline-first PWA (cached tiles + analyses), WCAG 2.1 AA completion | L | — | [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md) |
| Agency hand-off | ArcGIS Online hosted-feature-layer push (OAuth PKCE); Avenza geospatial-PDF spike | L | — | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §2, §3 |

### Blocked

Not next regardless of size — each needs something outside this codebase to resolve first.

| Item | Blocked on |
|------|------------|
| AFDRS fire danger | BOM Registered User access — a sourcing decision, not effort (see 2026-07-12 update) |
| Water-point & cadastre advisory layers | Licensing check pending |
| AI live model verification + eval suite | Needs a deployed model endpoint |
| VCI/RCI-weighted min-cut capacity | Needs Pass 3's soil layers, not yet sampled |
| Real entitlement/backend gating for Terrain Mobility | Deliberately deferred pending a release decision — feasibility assessed (§14.1): entitlement source of truth lives in the separate Station Manager repo, and moving compute server-side trades away the offline/interactive properties the field tool depends on |

## Architecture snapshot

React 18 + Vite + TS (`/webapp`) · Azure Functions Node 22 (`/api`) · Azure Table Storage · Mapbox GL JS · Azure Static Web Apps, Bicep IaC (`/infra`, OIDC).
Data flow: draw line → slope (~10 m) + vegetation (~200 m) sampling → joined chainage profile → `POST /api/analysis/calculate` → per-segment estimates + flags → UI/assistant/exports.
Gates: `npm run build` (webapp, strict TS), `npm run test:unit` (api) — both in CI.

## Recent Updates

- **2026-07-27 — Fire history (NAFI) surfaced as context, deliberately not
  wired into the cost model (step 17)**: a third lesson-porting pass from
  Terrain Mobility. `nafiFireHistoryService.ts` (built for §31, live-verified)
  is now also queried per fire-break vegetation segment — short-circuits with
  zero network calls outside NAFI's northern-Australia/rangelands technical
  extent, so it's a genuine no-op for most of the app's core NSW/VIC/southern-
  SA userbase, not a wasted request. `AnalysisPanel.tsx` shows the most-
  recently-burnt figure found along the line. Deliberately stopped short of
  what the roadmap originally asked for ("wire fuel age into the fuel/time
  model"): there is no sourced fuel-accumulation-vs-clearing-rate curve to
  apply, unlike the NWCG/Report 56-grounded fuel-CLASS factors already in the
  model — inventing one would repeat exactly the "plausible-looking guess"
  problem `CALCULATION_REVIEW.md` F3 replaced. Surfaced as a fact for the
  user's own judgement instead; the real numeric integration stays open,
  blocked on finding a citable source, not on effort (see "Next up"). DEA
  fractional-cover has the identical live-but-uncalibrated status and was not
  touched this pass for the same reason.

- **2026-07-27 — Two lessons ported from Terrain Mobility into the primary
  fire-break calculator (steps 15–16), plus a roadmap cleanup**: reviewing
  Terrain Mobility's hydrology (§34) and cross-slope work for anything the
  primary use case was missing turned up two real gaps, both fixed. **(1)
  Water as a natural break**: NVIS/Mapbox landcover mislabel open water as
  low-confidence `grassland` — the same root cause §34 fixed for Terrain
  Mobility's cost model was still live in `vegetationAnalysis.ts`, so a
  fire-break line crossing a river or lake got costed as ordinary buildable
  ground. Fixed the same way: real OSM waterway/water-body geometry fetched
  once per line, crossing segments flagged and excluded from every resource's
  time/cost — but reframed positively per owner correction: damp ground
  doesn't carry fire, so this length already IS a break, not a capability
  gap. `AnalysisPanel.tsx` shows this as a blue informational note, not an
  amber warning. **(2) Cross-slope (sidehill) safety gate**: F2's along-line
  slope gate reused NWCG's ~45% *sidehill* figure to justify its own ~25°
  along-line default, conflating two different NWCG limits (sidehill ~45%/
  24° vs straight uphill ~55%/29°). Now genuinely measured: DEM sampled
  either side of the line's own bearing (batched into the existing one-request
  elevation profile call, no second network round trip), gated independently
  in `equipmentAnalysis.ts` via a new `resolveMaxSideSlopeDegrees`. Both
  shipped with test coverage (`api/src/test/analysis.test.ts`) and both
  packages building clean. **Also**: the roadmap below was reorganised from
  one sprawling numbered table (several cells had run to a paragraph of
  history) into Shipped / Next up / Blocked, "Next up" sorted smallest-effort-
  first with real dependencies noted — the history that used to live in the
  table itself is either already in an as-built doc or in this changelog.

- **2026-07-27 — Terrain Mobility Pass 6 follow-up: end-to-end review (code,
  UI wiring, mobile)**: full read-through of the hydrology pass (§34) below,
  the movement-simulation engine, restriction planner, worker, and the App/
  MapboxMapView/MobilityPanel/MobilityLegend wiring. Found and fixed two real
  logic gaps in `mobilityGrid.ts`: (1) `inWaterBody` was centre-only while
  `waterDistanceM` already sampled centre+corners, so a cell whose hex CORNER
  (not centre) clipped a lake edge got no fording gate at all; now checks all
  sample points. (2) `usedEstimatedData` only OR'd elevation/vegetation
  estimation, so a run entirely shaped by an assumed fording depth (always
  Tier 0) could show no "CAUTION — ESTIMATED DATA" warning; now folds in
  whether any cell carries a water signal. Also found and fixed a mobile
  layout bug in `styles-tactical.css`: the run-progress HUD and the map key
  were both pinned to the same `bottom: 12px` full-width position on narrow
  viewports, so they overlapped whenever both were on-screen (legend can show
  as soon as an area is painted; the HUD appears the moment a run starts) —
  now split left/right. UI wiring (prop interfaces vs. call sites, simulation-
  controller handlers, touch/pinch painting) reviewed and confirmed correct,
  no further gaps. `tsc --noEmit`/`npm run build` clean. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §34 follow-up.

- **2026-07-27 — Terrain Mobility Pass 6: hydrology — waterways as a real
  barrier (§34)**: owner, reviewing the shipped mode: "I can see substantial
  waterways in my sample area but they don't seem to form a 'barrier' in the
  overlay analysis. If they are being considered then we need to show more of
  that... I need to get credible buy-in for the analysis early." Investigation
  (not guesswork) found the actual mechanism: `nvisVegetationService.ts`
  mapped MVG code 24 ("Inland Aquatic") and any water/lake/estuary label to
  `vegetation: 'grassland'` — the LOWEST-friction class, so a river read as
  fast, easy ground, the functional opposite of a barrier. Three more signals
  existed and were dead code: a live-verified DEA Water Observations client,
  never called from grid sampling; `fordingDepthM` — real sourced figures on
  every mover profile — never read by the cost model; and no linear
  watercourse geometry fetched at all (Overpass only ever asked for
  `highway=*`). **Fixed end to end**: Overpass generalised (`kind: 'highway' |
  'water'`, one query branch, not a second endpoint) to fetch
  `waterway=river|canal|stream` and `natural=water`; `distanceToNearestWater`
  added point-in-polygon handling for lake bodies (edge-distance alone is
  backwards for a filled area — the middle of a lake IS water, not near it);
  a new DEA WOfS area-raster path was needed, but WCS `GetCoverage` — the
  path NAFI's own area raster uses — was LIVE-VERIFIED this session to reject
  PNG output for this layer (GeoTIFF/netCDF only, no browser decoder for
  that), so it uses WMS `GetMap` instead, decoded via the SAME colour-ramp
  technique already used for NVIS/NAFI's legend-coded rasters, with its
  control points sampled live from the style's own `legend.png` and
  sanity-checked against Lake Argyle (~0.91 at centre, plausible) and Sydney
  Harbour (363/400 land pixels correctly unmatched, real water pixels
  correctly matched). New `estimateFordingRequirement` (Tier 0, same honesty
  discipline as the existing vegetation-structure estimate) feeds a gate in
  `edgeMobilityCost` at the same severity as every other hard constraint
  there: NO-GO beyond the profile's fording capability, SLOW-GO with a real
  speed penalty within it, exempted where both ends of an edge are on the
  mapped trail network (assumed bridge/ford, the same idiom the vegetation
  gate already uses for `onTrail`). **Also answered, in the same round**: "do
  we need smaller grid cells... elevation specifics and smaller but
  significant landscape is being lost" — real numbers (a typical AOI's hexes
  run ~65–130 m flat-to-flat against `TARGET_CELL_COUNT`) confirmed the
  complaint, but the water fix specifically did NOT need a finer grid: it
  samples each cell's centre AND its six hex corners against the real vector
  geometry, which is resolution-INDEPENDENT for a linear barrier by
  construction — the same order-of-magnitude improvement a refined grid would
  buy, without the compute-budget cost. Uniform fine-grained resolution for
  AREAL micro-terrain (gullies, knolls) remains a separate, larger,
  deliberately-deferred architecture question (hex adjacency, DEM-derivative
  plane fits and corridor smoothing all assume a uniform hex size). One
  cross-cutting refactor fell out along the way: every place that built an
  edge's `from`/`to` sample for `edgeMobilityCost` was hand-writing a near-
  identical object literal (8 call sites across 4 files, already drifting
  from each other's exact field lists) — now one shared `toMobilitySample`.
  Verified: `tsc --noEmit`/`npm run build` clean on both packages,
  `npm run test:unit` unaffected. A 29-check standalone smoke test proved the
  claim that matters: a synthetic AOI with a real river band and one bridge
  finds a route that genuinely uses the bridge and never crosses off it;
  remove the bridge and the SAME river actually severs the AOI (`extractPath`
  returns null); as a control, the identical river with its water signal
  stripped (the pre-fix state) does NOT block movement — proving the test
  exercises the fix, not something else. Map rendering unverifiable in this
  sandbox — confirm the water reference layer and the GO/SLOW-GO/NO-GO
  overlay's reaction to a real waterway on the live preview. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §34.

- **2026-07-27 — Terrain Mobility Pass 5: the movement simulation becomes the
  engine (§32), plus a UI clarity pass (§33)**: owner asked for eight UI fixes
  and then reframed the biggest of them mid-flight — "that movement sim model
  should be the crux of the recommendations and the ultimate pathways through...
  you might take roads and highways as a preference until they're blocked or
  denied... I would expect our model to account for an 'unrestricted' set of
  movement corridors, and then add in a set of recommended restrictions like
  road blocking." **The honest gap**: everything this mode computed was an
  OPTIMISER's answer — cheapest path, or k cheapest paths — each a global
  optimum assuming perfect knowledge of the whole grid. A real unit does not
  solve Dijkstra over ground it has not seen. New `movementSimulation.ts` runs
  an ensemble of independent movers that each score their next cell by
  `edgeTime + perceivedToGo + turn + revisit + network`, sampled by softmax;
  the mover pays the REAL edge cost whatever it believed, so committing to a
  bearing and having to work around ground you could not see falls out rather
  than being scripted. **Road preference is the first-order term** and is what
  makes vegetation bind at the right time: with a road present a wheeled
  profile's movement is overwhelmingly on it, and only once it is denied does
  gap width/stem diameter/side-slope decide anything. At τ→0, k→1, road
  affinity→0 the model collapses to the single deterministic line it replaces
  — the old answer is a limiting case, not a competitor. New
  `restrictionPlanner.ts` produces the ranked restriction set by
  **re-simulation, not a formula**: greedily, each candidate is evaluated by
  re-running the ensemble with it emplaced alongside those already chosen, so
  each recommendation is made against the world the previous ones created —
  and it **refuses to pad the list**, stopping and reporting the bypass when
  the next-best site buys under 2 minutes. `buildCorridorField` gained
  `routesOverride`/`evidence`, so the identical presentation pipeline serves
  either evidence base and `CorridorField.evidence` travels into the panel,
  map key, GIS attributes and AI briefing — because "180" means something
  different when it counts simulated movers rather than optimal routes. **One
  supporting cost-model fix**: `mobilityCost.ts` used the OFF-path Irmischer &
  Clarke function for on-track foot movement, so a road was worth literally
  nothing to a foot profile; both published functions were already present with
  exactly that distinction documented, and each is now applied to the case it
  was calibrated for. **Honesty**: terrain stays real data with its Tier 0/1
  flags; every behaviour parameter is ASSUMED, unsourced, and flagged end to
  end (`behaviourModelled: true`, the behaviour selector leads the panel rather
  than a footnote, the map key marks modelled entries, GIS features carry
  `evidence`/`evidence_note`, the briefing states the caveat whenever a
  simulated figure appears). Verified: `tsc --noEmit`/`npm run build` clean on
  both packages; `npm run test:unit` green with 12 new API checks; a 39-check
  standalone smoke test over the real modules on a synthetic road-through-scrub
  AOI proved the claims that matter — movement stays on the road when one
  exists and is entirely cross-country when it does not, blocking the road both
  doubles the median journey and pushes movement cross-country (23%→41%),
  seeds are reproducible, and no mover ever crosses a blocked edge. **The test
  caught one real defect**: `crossCountryFraction` was a pooled step count, so
  a handful of stranded movers running to the full step budget outweighed
  everyone who succeeded — an ensemble whose every individual track was 4–7%
  off-road reported 46%; now a per-mover mean. Alongside it, the eight UI items
  (§33), of which two were also real bugs rather than missing features:
  painting lagged the drag because the render replayed every stroke through
  polygon booleans on every dab (quadratic — now incremental), and run progress
  showed nothing because `onProgress` existed but was never passed. Map
  rendering and touch/keyboard interaction are unverifiable in this sandbox —
  **confirm on the live preview**. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32–§33.
- **2026-07-27 — Terrain Mobility: NAFI time-since-fire area-query mechanism
  (§31)**: last backlog item from the "keep going, all scope" pass. Closes
  `nafiFireHistoryService.ts`'s own stated scope cut ("POINT query only...
  flagged as the concrete next step"). Live-verified against the real
  `firenorth.org.au` GeoServer via `curl`+Pillow before writing any resolution
  logic (matching this project's existing NAFI/DEA verification discipline):
  the module header's original guess (`WCS GetCoverage` as a raw GeoTIFF grid)
  was tried and rejected once the served GeoTIFF turned out to be **tiled**,
  not simply-stripped — real tile-decode risk not worth taking. Switched to
  **PNG**, decoded via the exact same `decodeImageBytes` canvas helper NVIS's
  own area raster already uses (now exported for reuse). Confirmed live: a
  1×1-pixel WCS request matches the trusted point-query's own value at the
  same coordinate; WCS 1.0.0's BBOX axis order for EPSG:4326 on this server is
  **(lng,lat)** — the opposite of WMS 1.3.0's convention for the same code,
  an easy silent-mirroring trap if assumed rather than checked; "no plausible
  answer" renders as PNG alpha=0, reusing NVIS's own NoData convention rather
  than inventing a new one; and a genuine **source-side ambiguity** — the
  long-term layer's own palette renders years 22-26 in one identical colour
  (confirmed from the raw GeoTIFF ColorMap tag, not a decode bug) — resolved
  to the conservative high end (26) and flagged `coarseBand` rather than
  silently picking one. New `fetchNAFITimeSinceFireArea`/`sampleNAFIAreaRaster`
  fetch BOTH windows as 2 requests total for a whole AOI (not one per cell) and
  return the same result shape the existing point-query function already
  uses. Deliberately **not** wired into `MobilityGridCell`/the cost model in
  this pass (the mechanism existing is what was asked for; deciding how
  years-since-fire should modulate trafficability alongside vegetation type is
  its own calibration decision) and DEA's own layers are untouched (different
  server, not investigated). Verified: `tsc --noEmit`/`npm run build` clean; a
  standalone smoke test covers every pure function (colour legend matching
  incl. the 22-26 tie, URL axis order, raster point-sampling) — the actual
  fetch+canvas-decode path is browser-only and unverified in this sandbox,
  same accepted limitation as NVIS's own equivalent.
- **2026-07-27 — Terrain Mobility: real entitlement/backend gating — feasibility
  assessed, not built (§14.1)**: last item on the "keep going on the backlog, all
  scope" pass. Checked §14's original plan ("server-side entitlement + route-level
  code-splitting, a known quantity") against what Passes 1–4 actually built.
  Four findings, in order: **(1)** the entitlement source of truth
  (`entitlements.fireBreakEnabled`, the existing precedent) lives in Station
  Manager — a separate sibling repo this app calls but doesn't own — so a new
  `terrainDenialEnabled` field is a cross-repo dependency, not a same-PR task;
  **(2)** there is no mobility-specific backend endpoint to gate — the entire
  corridor/min-cut/delay-ledger engine (~5,000 lines) runs client-side in a Web
  Worker, calling only the same shared, unauthenticated elevation/vegetation
  endpoints fire-break mode already uses; the ONE mobility-specific endpoint that
  now exists (`assistant/mobility-briefing`, added this session) genuinely can be
  gated the same way the saved-plans endpoints already are, but that alone
  doesn't protect the analysis itself; **(3)** code-splitting the counter-mobility
  modules behind a runtime entitlement check would raise the casual-discovery bar
  but is not a hard boundary in a pure SPA — a fetched chunk is still fetched, in
  the visitor's own browser; **(4)** the only way to make the logic genuinely
  inaccessible is to run it server-side, which is a real, deliberate architecture
  trade-off (it would reintroduce network latency per iteration and drop the
  offline-tolerant operation the product's field-use premise depends on), not a
  gating detail — so it needs its own scoped design decision, not implementation
  folded into this assessment. Recommendation: gate the one real endpoint now
  reusable pattern-wise once Station Manager exposes the entitlement; keep the
  `?ops=1` POC toggle and its existing residual-risk framing (unconditional
  disclaimer/egress-gate/fire-default-copy) until a release decision justifies
  the server-side move. No code changed for this item — the deliverable was the
  assessment itself. Full details: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §14.1.
- **2026-07-27 — Terrain Mobility: AI assistant narrative (closes Step 10's
  remaining backlog item on this front)**: continuing "keep going on the
  backlog, all scope" — a ground commander now gets a plain-language
  appreciation of the corridor/chokepoint/barrier/counter-measure results,
  not just panels of numbers. Wired into the **existing** grounding gate
  (`api/src/services/aiGrounding.ts` — "the model narrates and cites, it
  never computes, never estimates, never fills gaps") rather than a second
  contract: `buildSystemPrompt` gained one backward-compatible optional
  `audience` parameter (defaults to the existing fire-break wording, so no
  existing caller changes) so the same anti-hallucination rules can address
  "a ground commander appreciating terrain mobility and siting
  counter-mobility measures" instead. New `MobilityAssistantPayload` (api +
  webapp) is the mobility-mode counterpart to the fire-break `AssistantPayload`
  — mover profile, cell/reachable/NO-GO/SLOW-GO counts, the `unconstrained`
  finding, top corridors, chokepoint/barrier summary, and scored
  counter-measure placements, straight from the same results the panels
  already render. New endpoint `POST /api/assistant/mobility-briefing`
  mirrors `assistant/briefing`'s always-200 contract exactly (validated AI
  narration when grounded, deterministic template fallback otherwise). The
  template (`mobilityBriefingTemplate.ts`) is the piece that actually
  delivers the plain-language briefing unconditionally — it needs no model
  deployed at all, same as the fire-break assistant's own fallback, which
  matters because this sandbox cannot exercise a live Foundry call either
  (documented limitation, docs/AI_ASSISTANT.md §1). It leads with the
  `unconstrained` finding when present rather than burying it under corridor
  detail, and **refuses** to report delay figures for an egress-unsafe
  placement — states the refusal instead, mirroring the counter-mobility
  panel's own refusal-not-warning treatment of that gate. New
  `MobilityAssistantCard.tsx` is a briefing-only sibling of
  `AiAssistantCard.tsx` (same CSS/presentation), wired into
  `MobilityPanel.tsx`; grounded chat is deliberately not mirrored — scoped
  to what was actually asked. Verified: `tsc --noEmit`/`npm run build` clean
  on both `api/` and `webapp/`; a new 17-check test file
  (`api/src/test/mobilityAssistant.test.ts`, wired into `npm run test:unit`)
  caught one real bug along the way — the payload validator's `v && ...`
  short-circuit chain returned `v` itself (e.g. `null`) instead of a boolean
  on early rejection, fixed with an explicit `!!(...)` wrap. Full details:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §30.
- **2026-07-27 — Terrain Mobility: GIS export pack (MCOO/scouting handoff,
  closes Step 10's item 0)**: "keep going on the backlog, all scope" — the
  first backlog item, ranked opportunity #1 in the corridors review, was the
  concrete mechanism for "this will then be scouted and planned in more
  detail." New `utils/mobilityGisExport.ts`, mirroring `gisExport.ts`'s exact
  GeoJSON/KML/KMZ + provenance-stamp pattern rather than inventing a second
  one: **movement corridors** export as one `MultiPolygon` Feature per
  corridor (built from its own hex cells, deliberately undissolved — same
  "band not a line" honesty argument as the on-map render), each carrying its
  own `estimated_data` flag and the panel's own metrics (rank, ease, route
  share, median/fastest time, bottleneck width/abreast/frontage, GO/SLOW/NO-GO
  fractions); **chokepoints** and the **min-cut barrier** export as
  Polygon/LineString features; **counter-measure placements** export as a
  `LineString` between the two real cell centres the obstacle sits between
  (never an invented point along an edge), carrying that measure's own
  delay-ledger figures (delay imposed, bypass delay, egress-safe/warning) so
  the exported course of action is backed by the same bypass-rule and
  egress-gate numbers the Counter-Mobility panel shows — a placement not yet
  scored exports flagged `ledger_status: "not_scored"` with null figures
  rather than a stale or invented one, and a placement whose cell keys don't
  resolve against the current grid is skipped rather than mislocated.
  Shapefile deliberately **not** offered for this pack (mixed
  MultiPolygon/Polygon/LineString geometry needs `@mapbox/shp-write`'s
  per-type file-splitting confirmed for MultiPolygon specifically, which
  wasn't verified — left out rather than shipped untested; GeoJSON/KML/KMZ
  already cover the stated QGIS/FireMapper/Google Earth consumers). New
  `MobilityExportControls` component mirrors `ExportImportControls`'s dropdown
  UI exactly, wired into `MobilityPanel.tsx`'s RESULT section. Verified:
  `tsc --noEmit`/`npm run build` clean; a standalone Node smoke test (real
  modules, disposable vite lib-mode entry, deleted before commit) built a
  synthetic grid, ran the real corridor/chokepoint/min-cut/delay-ledger
  functions over it, and asserted feature counts match source data 1:1,
  honesty flags are present and correctly typed, the unscored/stale-key edge
  cases behave as above, and the KML carries all four folders. Full details:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §29. Live import into a
  real GIS client is not verified in this sandbox — **confirm on the live
  preview / a real GIS client** before relying on the exported files
  operationally.
- **2026-07-26 — Terrain mode default basemap: satellite, not dark vector**:
  owner: "bring back the satellite as the default map, seeing the terrain is
  the key." §13.1's original tactical-mode design called for a dark vector
  basemap for a restrained "ops HUD" look — the wrong trade for a tool whose
  whole analytical premise is reading real vegetation density, tracks and
  gaps off the ground. `MapboxMapView.tsx` now defaults Terrain mode to the
  SAME satellite imagery fire-break mode already uses, rather than a
  separate dark style — one real view of the ground in both modes. The dark
  panel/badge/log tactical theme is unaffected (separate overlaid DOM
  elements, not dependent on the basemap). `VITE_MAPBOX_TACTICAL_STYLE`
  remains available as an explicit override, just no longer the default.
  Verified: `tsc --noEmit`/`npm run build` clean; live rendering
  unverifiable in this sandbox (no Mapbox token) — confirm on the live
  preview.
- **2026-07-26 — Terrain Mobility: movement CORRIDORS (closes Pass 2's
  unfinished half)**: owner asked for the potential paths to be smoothed and
  presented as **corridors of possible movement** rather than a single optimal
  path, with individual pathways used for analysis and corridors for
  results/ease of movement; plus, once counter-measures are placed, the effect
  ON those corridors, iteratively. Framed by the intended user: a ground
  commander getting a rapid appreciation to propose a deter-and-deny course of
  action, before detailed scouting. **Checked against the roadmap first (as
  asked): this request WAS the roadmap** — Pass 2 (§15.2) scoped
  "route-preference surface … avenues of approach sized by echelon …
  baseline-vs-scenario swipe" and only the k-route/chokepoint/min-cut half was
  ever built, so these are the same work and this closes those items rather
  than adding a parallel feature. New `corridorField.ts`: 14 distinct routes
  (was 3) → weighted density (weight = bestTime/thisRouteTime, a real ratio)
  → Laplacian smoothing over hex adjacency → connected-component
  segmentation → per-corridor metrics, with width/bottleneck measured from
  iso-arrival-time cross-sections (the same principle the isochrones already
  use). **Corridors are an honesty improvement, not decoration**: a single
  polyline implies survey precision Tier 0/1 data cannot support, a band with
  fading edges states the uncertainty visually — which is exactly the owner's
  "UI must not communicate too high a fidelity, but the fidelity of ANALYSIS
  must be visible" constraint. The analysed routes render as faint hairlines
  *inside* the bands so the evidence stays visible under the abstraction.
  "Avenues sized by echelon" delivered only as far as data allows: `abreast`
  count is real arithmetic; doctrinal echelon labels, column throughput and
  VCI verdicts are explicitly **not** claimed (unsourced frontage/spacing,
  unsampled soil) and the caveat is stated in-panel. **Two findings worth
  noting, both caught by testing rather than assumed**: (1) on terrain that
  doesn't canalise movement, 14 routes covered 304/305 cells and
  segmentation reported "one corridor = the whole AOI" — arithmetically
  right, operationally useless; this is now a *reported finding*
  (`unconstrained`), prominently surfaced, because terrain with no chokepoints
  cannot be denied by siting obstacles and needs a different, costlier COA —
  something a commander needs told early. (2) Testing coverage alone for that
  was itself a bug: a ridge with one genuine gap still covered 80% of the
  area, so a coverage-only rule dismissed the most important chokepoint on the
  map; the test now also requires the busiest corridor to never actually pinch
  (`pinchRatio`). Counter-mobility is now **iterative**:
  `buildScenarioEdgePenalties` applies a whole placement set at once and
  `compareCorridorFields` diffs baseline vs scenario into collapsed /
  degraded / unchanged / **displaced-into** per corridor — the bypass rule
  asked spatially rather than as a single number — with a map-level
  Baseline/With-measures toggle. Panel colour semantics are from the
  planner's point of view (collapsed = green, displaced-into = red).
  Verified: `tsc --noEmit`/`npm run build` clean; a 40-check standalone smoke
  test over two deliberately different terrains (open plain vs ridge-with-gap)
  covering metric consistency, the routed-vs-smoothed distinction, both
  degeneracy conditions, and that empty/unknown/null inputs never fabricate
  an effect. Map rendering unverifiable in this sandbox — **confirm on the
  live preview**. Still open and stated: MCOO GIS export (the scouting
  handoff — corridors are now the right shape for it), assistant narrative,
  VCI capacity, Tier-1 per-cell wiring. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §28.
- **2026-07-26 — Terrain Mobility: analytical depth pass (cross-slope wired
  live, larger AOIs, edge cases)**: owner asked to re-read the original
  intent against what's been built and "take this up a notch... consider
  more factors, think about a larger area... ensure edge cases are thought
  about, and that the basic is not missed." The honest gap, on inspection,
  wasn't a missing capability — it was that real, already-verified Pass 3
  work (`demDerivatives.ts`) had never actually been wired into the search
  that needed it. Finishing verified work over fabricating new "10x"
  features: **cross-slope is now a real, live gate** — `MobilityGridCell`
  carries a genuine per-cell `crossSlopeDeg` (from the already-sampled
  elevation grid, no new network source), wired into all three places that
  call `edgeMobilityCost` directly (the main search, the terrain-only
  classifier, min-cut barrier siting) — previously always `null`, so the
  hard side-slope NO-GO gate (real roll-over-risk safety factor) had never
  fired in any run since Pass 1. The in-app disclaimer that said "cross-
  slope is not evaluated" is corrected. **Larger areas**: grid budget raised
  1400/1800 → 2200/2800 cells, justified specifically by the fact that both
  upstream sampling calls this depends on are already area-batched (not
  per-point) — the risk that keeps something like NAFI's point queries
  capped small doesn't apply here. **Two edge cases**: a grid that had to
  coarsen for a large AOI now says so (`usedCoarseGrid` flag + log line,
  instead of silently trusting a lower-resolution grid at full confidence);
  overlapping origin/objective areas now get an explicit log line
  explaining why the route is ~0 seconds, instead of looking like a bug.
  **Stated plainly, not silently dropped**: NAFI/DEA Tier-1 layers, VCI/
  RCI-weighted min-cut capacity, and imagery CV remain real, scoped,
  un-started next steps (see Step 10 above) — none of them a quick wire-up
  like cross-slope was. Verified: `tsc --noEmit`/`npm run build` clean; a
  10-check standalone Node smoke test against the real modules, centred on
  proving the exact documented contract ("crossSlopeDeg is evaluated at the
  FROM cell") rather than just "something got blocked somewhere" — a
  multi-hop-away objective is correctly unreachable once every approach is
  side-slope-blocked, while a flat origin's own immediate neighbours
  correctly remain reachable. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §27.
- **2026-07-26 — Terrain Mobility: mode-switch audit, control scheme,
  `?ops=1` default**: owner reported fire-break UI (Getting Started card,
  the pencil/trash draw control) still showing in Terrain mode, and asked
  for a full audit ("ensure everything switches... and back again") plus a
  consistent control scheme (general nav top-left, app-specific tools
  top-right, matching fire-break's own layout). Root-caused three real
  bugs, not just the one reported: **(1)** the §22 pencil/trash hide never
  actually worked — it targeted a wrapper class added via a
  `.mapbox-gl-draw_ctrl` selector that doesn't exist in this MapboxDraw
  version's real DOM (checked against its bundled source), so the class was
  silently never applied; replaced with a positional selector
  (`.tactical-mode .mapboxgl-ctrl-top-right { display:none }`) that can't
  have that failure mode. **(2)** `MapEmptyState` ("Get Started") was
  completely unconditional — now mode-aware, with Terrain-appropriate copy
  and its own "started" signal. **(3)** Armed-tool state (the paint role,
  the area-recon box tool) survived a mode switch and kept intercepting
  clicks meant for the other mode — new cleanup effect disarms the other
  mode's tool on every switch, in both directions; the Configuration panel
  had the same bug for a different reason, fixed by gating its `isOpen`
  with the current mode. **Control scheme**: fire-break's own "Scan area"
  button turned out to have the identical top-left-over-zoom-controls
  problem the owner flagged for Terrain mode, just never reported — moved
  both it and Terrain mode's overlay to top-right, stacked below each
  mode's own draw-style tool, so top-left is general navigation only, in
  either mode. Separately, owner asked `?ops=1` default straight into
  Terrain mode instead of just unlocking the toggle button — one-line fix
  reusing the existing `ops === '1'` check as the initial state. Verified:
  `tsc --noEmit`/`npm run build` clean; a live Playwright screenshot
  confirmed the mode toggle correctly swaps everything in both directions,
  the Terrain overlay sits top-right without overlapping where zoom
  controls belong, and `?ops=1`/no-param/`?ops=2` land in the right mode
  respectively. The map canvas itself still can't render pixel-for-pixel in
  this sandbox (no Mapbox token) — **confirm on the live preview**. Full
  detail: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §25–§26.
- **2026-07-26 — Terrain Mobility: two-finger map gestures, continuous
  painted shape, erase function**: owner asked for three refinements on the
  painted-area AOI tool in one round. **(1)** Two-finger pinch/pan was being
  read as a paint stroke instead of reaching the map — `MapboxMapView.tsx`'s
  paint handlers now check the touch point count and get out of the way
  (no painting, no `preventDefault()`) the moment a second finger joins,
  letting Mapbox's own (separate, never-disabled) `touchZoomRotate` handler
  take the gesture. **(2)** The painted area rendered as a cluster of
  overlapping circles, not one shape — replaced with a real geometric union
  (`@turf/union`, new dependency — chosen over a hand-rolled polygon-clip
  algorithm for the same correctness reasons §17 gives for standard
  max-flow/min-cut) via a new `resolvePaintedAreaGeometry` in
  `paintedArea.ts`. **(3)** Added an actual erase function, not just
  "clear everything": `PaintedArea` is now an ORDERED sequence of
  paint/erase strokes (`PaintStroke[]`), replayed via union (paint) /
  `@turf/difference` (erase) — the only model that gets "erase a mistake,
  then paint back over it" right, since a naive "painted set minus erased
  set" would keep that spot erased forever. A new "Erase" toggle button
  sits in the map's floating overlay controls (danger-red, matches this
  app's existing delete/danger colour). Grid-cell membership testing
  (`mobilityGrid.ts`) now resolves each area's geometry once and does a
  real point-in-polygon test (`@turf/boolean-point-in-polygon`) against it,
  replacing the old "distance to nearest dab centre" check, which would
  have been wrong the moment erase strokes exist. Verified: `tsc --noEmit`/
  `npm run build` clean; two standalone smoke tests against the real
  modules — one proving the union is a real merge (overlapping dabs sum to
  ~one circle's area, not double; disjoint dabs correctly stay a
  MultiPolygon), one proving the paint/erase replay's key property
  (erase then repaint the same spot brings it back; partial erase leaves
  the untouched side of a circle intact; erasing nothing yet is a safe
  no-op). Live touch-gesture testing remains blocked by this sandbox's lack
  of a real device/touch emulator — **confirm on a real phone against the
  live preview**. Full detail: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §23–§24.
- **2026-07-26 — Terrain Mobility: paint tool actually broken on mobile,
  two real bugs found and fixed**: owner reported that on a phone, "paint
  origin" was still drawing a fire-break line and "paint objective" did
  nothing at all. Root-caused, not patched around: **(1)** MapboxDraw's
  drawing mode was only ever read from `tacticalMode` once, at construction
  — correct for a fresh page load already in Terrain mode, but the in-app
  "Terrain mode" header toggle doesn't remount the map, so a session that
  starts in fire-break mode and then switches left MapboxDraw permanently
  armed to draw lines, eating every tap regardless of which paint role was
  selected. Fixed with a reactive `useEffect` that calls `draw.changeMode()`
  on every toggle; the pencil/trash control buttons (which can't be
  reconfigured post-construction at all) are now hidden via a
  `.tactical-mode` CSS rule instead. **(2)** The paint tool's
  mousedown/mousemove/mouseup handlers were mouse-only — Mapbox GL fires
  genuinely distinct event types for touch, so a phone tap never fired
  `mousedown` and the paint tool silently did nothing on touch devices at
  all (bug 1 was masking this for the origin role specifically, since
  MapboxDraw ate those taps first). Fixed by registering the same handler
  logic against `touchstart`/`touchmove`/`touchend`/`touchcancel` too.
  Verified: `tsc --noEmit`/`npm run build` clean; live touch-interaction
  testing itself remains blocked by this sandbox's lack of a real
  device/touch emulator — **confirm on a real phone against the live
  preview**. Full detail: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §22.
- **2026-07-26 — Step 11 first slice shipped**: owner said "build the next
  step" against the design review below. Shipped the three highest-impact,
  lowest-risk moves from that review, fire-break mode only: **hero readout**
  (`AnalysisPanel.tsx` — break length/max slope/primary equipment time as
  large tabular-nums figures with small captions, replacing the old
  same-weight text spans) that **counts up** into place via a new
  `useCountUp` hook (ease-out cubic, `prefers-reduced-motion`-aware,
  exported pure `tweenCountUp`/`easeOutCubic` verified with a standalone
  smoke test); the map's per-segment slope colouring (`slope-segments` layer
  in `MapboxMapView.tsx`) now **sweeps in** over a shared `REVEAL_DURATION_MS`
  via Mapbox GL feature-state (unrevealed segments show as a faint neutral
  preview line so the route's shape is visible immediately) instead of
  snapping to a finished state the instant analysis completes — timed to
  finish alongside the hero-readout's count-up, both driven off one shared
  constant so they can't drift apart; and the **map controls were re-skinned**
  onto the app's actual signal-red/hi-vis-amber brand. That last one turned
  up a genuine bug, not just a stale-screenshot impression: a second,
  later-in-source `.mapboxgl-ctrl-group { background:#fff }` rule was
  silently winning the cascade over the intended dark theme (equal
  `!important` specificity, later source order wins in a tie) — the literal
  reason draw/zoom controls rendered as plain white squares. Removed rather
  than patched around. Verified: `tsc --noEmit`/`npm run build` clean; a
  standalone Node smoke test against the real exported tween math; a
  Playwright screenshot of the live dev server confirmed no header/onboarding
  regression (the map canvas itself doesn't render in this sandbox — no
  Mapbox token available here — so the reveal animation and re-skinned
  control chrome couldn't be exercised pixel-for-pixel end-to-end; **confirm
  live** on the deployed preview). Remaining from the review: shared type/
  confidence discipline across both modes, and fire-break mode's own
  floating mobile controls (moves 4–5, still 📋).
- **2026-07-26 — UI/UX 10x design review (Step 11, new)**: owner asked for an
  honest assessment of both modes against a single bar — "instant buy on first
  demo" — and a concrete improvement direction, form and function. Reviewed
  the shipped fire-break panel (via its own `messagePreview.png`, annotated
  with six specific callouts) and the terrain-mobility tactical skin.
  Verdict: functionally solid, visually flat — no hierarchy, no sense of the
  engine computing in real time, and the map still wears Mapbox's factory-
  default control chrome. One thing already works and should spread further:
  the in-place machinery icon riding the planned line. Five prioritized moves
  recorded as **Step 11** in the table above, ranked by demo impact per hour
  of build time; all are CSS/motion/layout only — **no change to the
  calculation engine or any data-honesty flag**. Delivered as an illustrated
  Claude Code artifact (annotated screenshot + live CSS specimens of the
  "after" direction, including a working reveal-animation demo) rather than a
  new repo file, per this doc's own "no new planning docs" discipline — the
  roadmap row above is the durable record if the artifact link lapses.
  Reviewed and recorded only; **no code changed**, awaiting go-ahead to build
  the first slice (hero readout + reveal animation + re-skinned map controls).
- **2026-07-26 — Terrain Mobility: Pass 3/4 integrated + field-feedback round**
  (same branch/PR, following the Pass 1/2 entry below): two parts of work.
  **(1) Integration** of the two background agents' Pass 3/4 output, which had
  landed as new files not yet wired up: `dataLayers/structureTable.ts` (a
  cited, per-row-confidence vegetation structure table — Wood et al. 2015
  AusPlots figures for heavyforest, an NSW regulatory stem-retention floor for
  mediumscrub) now backs `mobilityCost.ts`'s `estimateStructureFromVegetation`
  in place of the hand-picked Tier 0 numbers (still Tier 0 per the doc's own
  tiering — a better-cited class-level figure applied to one cell is still an
  estimate, not a measurement); `counterMeasures.ts`/`delayLedger.ts`/
  `CounterMobilityPanel.tsx` (12-measure catalogue, the bypass rule, the
  egress-safety refusal gate) are now wired into `App.tsx` as a second tab
  alongside the terrain-appreciation panel, reusing the appreciation run's own
  sampled grid rather than resampling. The other four Pass 3 data-layer files
  (DEM derivatives, NAFI time-since-fire, DEA water/fractional-cover) were
  reviewed and committed but are **not yet** called from `mobilityGrid.ts`'s
  per-cell sampling — stated as a real next step, not silently dropped.
  **(2) Field feedback**, from the owner actually using the live preview on a
  phone: two critical bugs fixed (drawing an AOI was triggering the fire-break
  line tool, because `MapboxDraw` was unconditionally armed to draw lines; the
  objective-area tool stopped accepting clicks after the origin tool had been
  used, from a stale ref not reset on role change) and a full mobile-UX/
  interaction rework requested in the same round: primary controls (paint
  origin/objective, run/cancel) moved off the scrollable panel onto floating
  map-overlay buttons ("the scroll panel should only need to be expanded to
  change options or find detail"), and the AOI-selection gesture itself was
  replaced end to end — from a two-click rectangle to painting circular
  brush dabs whose on-screen size stays fixed across zoom while their real
  ground size scales with it ("zooming out effectively paints a larger area,
  zooming in gets more specific"), a new `paintedArea.ts` module. Verified:
  `npm run build`/`tsc --noEmit` clean; three rounds of standalone Node smoke
  tests against the real (not reimplemented) modules — 13 checks proving the
  brush's zoom-consistency property directly (same brush at zoom 10 covers
  exactly 64× the ground radius of zoom 16, the expected Mercator relationship)
  plus integration checks that the new structure table and delay ledger
  produce real, non-fabricated numbers. Live map-canvas interaction remains
  subject to the same sandbox proxy limitation recorded below — flagged for
  the owner to confirm outside this sandbox. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §19–§21.
- **2026-07-26 — Terrain Mobility Pass 2 shipped + Pass 3/4 in progress** (same
  branch/PR, same day as Pass 1 below): owner asked to run all four passes as
  parallel as possible, testing against the PR's live Azure Static Web Apps
  preview deployment. Pass 2 built solo (tightly coupled to Pass 1's search
  internals, kept centralized to avoid conflicting edits): `corridorAnalysis.ts`
  (k-dissimilar routes via iterative-penalty re-search — blocking the best route
  just pushes traffic to the second-best; betweenness chokepoints fall out of
  that route set) and `minCutBarrier.ts` (the cheapest cell set severing origin
  from objective — **the doc's own "hero" claim that a fire break and a movement
  barrier are the same object**). Implementation note recorded plainly: shipped
  via standard max-flow/min-cut (Edmonds-Karp) rather than the doc's original
  planar-dual-shortest-path framing, since getting that construction right for a
  HEX grid (whose dual is triangular, not square) under time pressure risked a
  subtly wrong answer — worse than a plainer, verifiably-correct algorithm.
  Verified with an 8-check smoke test on a synthetic single-cell-gap bottleneck,
  including the rigorous proof: penalising the returned cut's own edges to
  near-infinity and re-running the search confirms the objective genuinely
  becomes unreachable. Also shipped: provider-agnostic imagery interfaces
  (§12) — `ImageryProvider`/`MapboxImageryProvider`/`StructureAnalysisEngine`,
  the latter an honest `NotYetImplementedEngine` that reports its own absence
  rather than fabricate crown-detection output, since that's gated on a lidar
  calibration set no later pass has built yet. **In progress via two parallel
  background agents** on entirely new files (zero overlap with each other or
  with the above, to avoid merge conflicts): Pass 3's trafficability data layers
  (DEM derivatives, an AusPlots-cited structure table to replace the Tier 0
  vegetation placeholder, NAFI/fractional-cover/surface-water service modules)
  and Pass 4's counter-mobility catalogue + delay ledger + UI (doctrinal
  disrupt/turn/fix/block effects, the bypass rule, the egress-safety gate, all
  built against the real min-cut/search primitives above). **Live-preview
  testing attempted per the owner's request, conclusively blocked, root-caused
  precisely**: the identical sandbox proxy limitation already flagged for
  Mapbox also hit the PR's real deployed Azure Static Web Apps preview URL —
  confirmed NOT host-specific (same `ERR_CONNECTION_RESET` in headless
  Chromium against a genuine public HTTPS site, across multiple proxy
  configurations, while `curl` against the identical URL succeeded every
  time) — a Chromium-vs-policy-proxy incompatibility in this sandbox, not
  something further flag iteration was going to fix. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §17–§18.
- **2026-07-26 — Terrain Mobility Pass 1 shipped** (same branch, first code on top of
  the design work below): owner said "go, implement it all" and asked for a bonus
  RTS-style unit-movement simulation along the way. Built the Pass 1 vertical slice
  from `docs/ROUTE_INTELLIGENCE.md` §15: `webapp/src/terrain/` core (mover profile
  catalogue across all three requested families — foot done properly, AU
  agency/civilian fleet, ADF generic classes; injectable directional
  profile-parameterised cost model; multi-source area-to-area Dijkstra seeded from
  the whole origin AOI; a Web Worker for the search per the §8 CPU-vs-network
  reversal), a tactical UI skin (built in parallel by a background agent against a
  fixed prop contract — zero merge conflicts), `MobilityPanel.tsx`, and map wiring
  for AOI drawing + a GO/SLOW-GO/NO-GO ↔ isochrone-band heatmap toggle. **Plus the
  bonus**: `terrain/unitSimulation.ts` animates a unit along the real computed path
  in real time with a speed multiplier, and once it's covered half the estimated
  travel time triggers a **genuine second search** from its current position
  (not scripted) and splices the refined remainder onto the path it already walked —
  "the path may change as the unit gets more local fidelity" implemented for real.
  **Follow-up same day (owner):** the mode now swaps the *entire* app identity when
  active — header title/subtitle/icon (a `Radar` glyph replaces the fire-break logo),
  browser tab title, and favicon (inline SVG, no new asset), plus the fire-break-only
  Configuration button is hidden — nothing reads "Fire Break Calculator" while
  Terrain mode is on. Gate is still the §14 POC toggle (`?ops=1` URL query); the
  backend entitlement split stays a Pass 4 exit condition, deliberately deferred per
  the owner's explicit instruction to demo off current infrastructure with open data.
  **Verified two ways** since the build sandbox couldn't fully exercise the live map
  (see below): a strict-TS `npm run build` clean throughout, plus a 29-check
  standalone Vite-bundled Node smoke test against the REAL (not reimplemented)
  terrain modules — profile catalogue shape, signed-slope direction, both individual
  foot speed models, the wheeled-gap-width-vs-tracked-override-force NO-GO
  distinction (§11.4), multi-source seeding, path backtracking, isochrone banding,
  time-based simulation interpolation. Live-browser-verified separately: URL gate,
  mode toggle, full identity swap, tactical skin, mover-profile catalogue with
  sourced confidence badges, coordinate readout, assessment log — all confirmed
  rendering correctly via Playwright against a real dev server. **Root-caused and
  documented, not just observed:** the actual map-canvas interaction (drawing AOI
  boxes, running a live search) couldn't be verified live in this session — this
  sandbox's egress proxy only accepts HTTPS CONNECT tunnels, which `curl` handles
  transparently but which a Playwright-launched headless Chromium's own proxy path
  failed against even when explicitly configured (confirmed both the Mapbox token
  and custom style resolve fine over `curl` through the identical proxy) — flagged in
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §16 as **confirm live**, the
  same pattern this doc has used before when the sandbox couldn't reach Mapbox.
  Passes 2–4 (corridors/MCOO/min-cut, trafficability data uplift, counter-mobility
  planner + imagery CV) remain design-only, staged in §15.2.
- **2026-07-26 — Secondary use case analysed: terrain mobility & counter-mobility**
  (branch `claude/terrain-movement-analysis-xf1r3q`, docs only — no code): owner
  raised an alternative framing — instead of "where do I cut a break", use the same
  sampled terrain to answer "how do I move through this ground most efficiently,
  area to area, for a given mover" and its inverse "which ways will someone else
  move, and what engineering slows them down". Full design recorded as a new
  section in [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) (that doc already
  owns the cost surface; no new doc created) and added as **Step 10** above.
  Headline findings: (1) it's a **mode, not a fork** — the whole sampling substrate
  (DEM cache, area-query NVIS/SVTM, three-tier trail lookup, honesty flags,
  exports) is reused unchanged, and the 2026-07-14 area-query + retention work is
  what makes an AOI-scale product feasible on free upstream services at all;
  (2) the **area-to-area** constraint is solved by seeding Dijkstra with every
  origin-polygon cell (super-source) and, run to exhaustion from both areas and
  summed, yields a **route-preference surface** whose low band *is* the movement
  corridor — so you never have to guess an exact route; (3) `edgeCost` must become
  an **injectable, directional, profile-parameterised** cost strategy — the same
  refactor the "equipment-aware heatmap" follow-on already needs; (4) because the
  grid is planar, **min-cut = shortest path in the dual graph**, i.e. the cheapest
  counter-mobility barrier is found by the Dijkstra already in the repo — *a fire
  break and a movement barrier are the same object*, a line severing a plane;
  (5) the metric is **delay-per-dollar**, priced by the existing production engine,
  with a non-negotiable **bypass rule** (never report a measure's delay without
  re-running the search and reporting the bypass it creates) and an **egress-safety
  gate** (a barrier that blocks your own crews' way out is refused, not scored).
  Two integrity risks flagged as gating: obstacle **breach/delay values** must be
  sourced-and-cited or visibly user-entered, or M4's output is fabricated
  operational advice; and the "where will they go" half is tiered so the product
  models **terrain, not people** (no individuals, no personal data). Also noted:
  hazard-reduction burning *increases* cross-country mobility, which nothing else
  in the agency toolkit will tell a planner. Staged M1–M5.
  **Second pass same day, after owner feedback** (audience = defence /
  secure-facility / land managers; "blocking roads is easy, working out trenches and
  pushed-up scrub is hard"; "some vegetation is effectively grassland if the trees
  are spaced far enough apart"): added **§10, the fidelity problem**, now the
  analytical core of the mode, plus a throughput section (§6a) and a revised audience
  section (§7). Key conclusions: **NVIS cannot answer trafficability** — canopy cover
  ≠ stem spacing (a 10–30% cover woodland with stems 8–15 m apart *is* grassland for
  mobility, and the current fuel mapping gets this exactly backwards), multi-stemmed
  mallee/tea-tree/wattle thickets read as open while being a wall of stems, NVIS has
  no concept of **condition or time-since-fire** (young regrowth can be an order of
  magnitude denser than the mature stand of the same class), and its ~100 m raster
  cannot see a 30 m drivable lane. Trafficability is a **percolation** problem on the
  gap network, not a mean density, and it splits into **passability / pace / capacity
  / reliability** — with **VCI₁ vs VCI₅₀** (one-pass vs fifty-pass cone index, NRMM
  lineage) as the citable framing for "drivable vs drivable at scale". That reframes
  counter-mobility as achievable: denying one motorbike is prohibitive, denying
  *twenty wheeled vehicles inside two hours* is cheap, because you only have to break
  pace and capacity — so measures are scored against a **specified threat package**,
  not "anyone ever". On the three options asked about: **(a) current data** is worth
  more than we're extracting (a structural NVIS mapping table with a multi-stem flag,
  reusing the existing curated vegetation-mappings mechanism, plus unused DEM
  derivatives — cross-slope, roughness, topographic position, wetness index) but is
  **structurally incapable of tactical gap-finding**; **(b) Mapbox imagery CV** is
  feasible for crown delineation → gap-network percolation, plantation rows and
  unmapped "natural roadways", but hits three hard limits — **it cannot see the
  understorey at all** (so it is biased *optimistic*, dangerous for own-movement),
  remote-AU resolution/vintage must be probed per AOI rather than assumed, and
  **Mapbox derivative-works licensing is a gate, likely excluding defence use** (the
  defensible posture is client-side, ephemeral, nothing persisted, mirroring
  `mapboxTrails.ts`); **(c) other datasets** hold most of the win and most of it is
  **free** — the biggest fidelity gain per unit effort is **time-since-fire +
  fractional cover + surface-water frequency**, *not* computer vision, with airborne
  lidar (DSM−DEM canopy height model, and point-cloud 0.5–3 m return fraction =
  understorey density *measured*) as the gold-standard overlay where coverage
  permits. Recorded as a **5-tier trafficability stack** where every cell reports
  which tier answered it, its confidence and its vintage, and where **bias direction
  follows the question** — pessimistic for own movement, optimistic for adversary
  mobility, same data, opposite rounding. Two things flagged as required-before-CV:
  the **stem density research task** (field-plot-derived density/basal area/diameter
  distributions per NVIS MVS *with variance*, plus an analytic gap-width derivation —
  we do **not** have this today and it cannot be invented) and the lidar calibration
  set. Also noted: a stand's stem density is simultaneously **the obstacle and the
  construction material**, so the same structure layer prices pushed-up windrows and
  abatis siting; soil type determines whether a trench survives; and fences are an
  acknowledged blind spot invisible in every dataset. M3 re-staged as M3a–M3f,
  cheapest-and-most-defensible first.
  **Third pass same day** (owner: back every assumption with research; assume imagery
  licensing for the POC but architect for any provider; add tactical/defence UI for a
  funding demo; assess gating and pricing against the StationKit fire audience) —
  added **§11 research basis**, **§12 provider-agnostic imagery**, **§13 tactical UI**,
  **§14 gating and pricing**. Research findings that changed the design rather than
  just citing it: (1) **individual and unit foot movement are two different models** —
  Tobler (`6·exp(−3.5·|s+0.05|)`, peak 5.04 km/h at −2.86°, on-path/unladen/no
  vegetation term) and Irmischer & Clarke 2018 (`0.11 + exp(−(100s+2)²/1800)`, four
  functions by sex × on/off-path, measured on USMA cadets off-path in wooded terrain —
  the only military off-path-calibrated function found, so it becomes primary) cover
  the individual, while US Army foot-march doctrine covers a *unit* (roads 4.0 km/h
  day / 3.2 night; cross-country 2.4–2.6 day / 1.6 night; 20–32 km per 24 h) — and
  those doctrinal rates yield a **cross-country factor ~0.6 and night factor ~0.67**,
  so the profile catalogue's defaults are now doctrinally anchored instead of invented;
  (2) **wheeled and tracked vehicles are limited by different variables** — the
  literature states that trees large enough to stop wheeled vehicles are usually too
  closely spaced to pass, so **wheeled is gap-width-limited (percolation)** while
  **tracked is override-force-limited (stem-diameter threshold, per Mason et al. 2012:
  stem diameter × pushbar height × root stability; recent robotic work demonstrates
  override to ~82 mm)** — two queries against the same structure data, not one blended
  vegetation factor; (3) doctrine's **UNRESTRICTED class explicitly permits widely
  spaced trees**, independently confirming the "spaced trees behave as grassland"
  point, and its slope anchors (**≥7% slows most vehicles and counts as an
  obstruction**, ≥45% impedes) are far stricter than the current fire-calibrated
  `slopeCost` ramp — direct evidence for the profile-parameterised cost strategy;
  (4) adopt the closed doctrinal obstacle-effect set **disrupt / turn / fix / block**
  with intent = target + effect + location ("channel, don't seal" is doctrinally
  *turn*), **plus its caveat** — doctrine is explicit that obstacle effects come from
  obstacles *and fires* together, so an unobserved barrier must never be reported as
  **block**, at best *disrupt*, which closes the largest overclaim available to this
  tool; (5) **the AU structure data exists** — TERN AusPlots (442 × 1 ha plots, 22
  vegetation types, basal area by wedge sweep, programmatic access) plus 48 tall-forest
  plots, and those plots measure that **non-eucalypt understorey is ~60% of stems**,
  which is someone else's measured proof that canopy-only imagery analysis cannot
  stand alone; (6) confirmed free sources: **ELVIS** 1 m DEM/DSM + point clouds
  (15 cm vertical accuracy) and specifically **NSW state-forest lidar 2022–23 over
  ~250,000 ha / 27 state forests — the natural POC area of interest**, plus DEA WOfS
  and Fractional Cover at 25 m. Also carried: the VCI/RCI worked example (105 mm
  howitzer VCI₁ 21 / VCI₅₀ 49, trafficable at RCI 43 for one pass, **not** at RCI 48
  for fifty) is the one-slide demo of "drivable ≠ drivable at scale"; and Pandolf load
  carriage is retained only for endurance/relative comparison because it is published
  as 12–33% in error and under-predicting modern military loads. **Gating decision
  recorded:** the mobility half ships plainly to the fire audience as access/egress
  (genuinely useful, no defence vocabulary); the counter-mobility half is
  **server-gated on a new entitlement AND route-level code-split so the licensed build
  is the only bundle containing it** — a hidden client toggle is not a control, and
  discovering barrier planning inside a volunteer firefighting app is a reputational
  problem. Pricing follows that split, with the data uplift (commissioned lidar,
  licensed imagery, field validation) as a services line. *(Superseded for the POC only
  — see the fourth pass below.)*
  **Fourth pass same day** — owner answered the four blocking questions: **build
  everything**, split into 2–4 passes with assumption gates; real AOI is **most of
  northern Australia**, demo on best-available open data with **no custom lidar**; ship
  **all three mover-profile families** (foot done properly + AU agency fleet + ADF
  classes, the last with per-figure confidence and a generic width/weight fallback where
  a spec can't be sourced); and for the POC the gate is a **subtle toggle or URL query**
  on the existing infrastructure rather than an entitlement (recorded in §14 with its
  residual risk — a client flag is discoverable, so the counter-mobility surface is
  effectively public for the POC; the unconditional disclaimer/authority/egress-safety
  gates and defence-vocabulary-free default copy are the substantive protection, and
  conversion to a real entitlement + code-split is a Pass 4 exit condition). Added
  **§15: POC build plan** — recommended demo AOI is **Litchfield NP / Darwin hinterland,
  NT**, which beats the earlier NSW state-forest suggestion because it is *inside* the
  real theatre: representative frequently-burnt tropical savanna, and the **TERN
  Litchfield Savanna SuperSite** is a 5×5 km block with **airborne + terrestrial + UAV
  lidar, hyperspectral, SLATS transects and measured tree structure/LAI** — so Tier 2 is
  demonstrable *and* the imagery-CV calibration set is solved by site selection rather
  than budget. **NAFI** (fire scars 2000→present, 250 m with 20 m HiRes in places,
  ground-validated north of 20°S) supplies the top free understorey predictor for the
  actual theatre, and Top End wet/dry seasonality turns the trafficability toggle into
  the demo's strongest moment. Four passes, each independently demoable: (1) terrain
  core + mobility + isochrones + tactical skin + Web Worker; (2) corridors, capacity
  (VCI₁/VCI₅₀), chokepoints, min-cut, **MCOO** — the hero screenshot; (3) trafficability
  data uplift (Tier 0 structural NVIS + DEM derivatives, Tier 1 free layers, Tier 2
  lidar, AusPlots stem table, tier/confidence/vintage plumbing) — the defensibility
  pass; (4) counter-mobility planner + provider-agnostic imagery CV + entitlement
  conversion. Min-cut lands in Pass 2, so the distinctive analytic ships early while the
  parts depending on uncitable breach values sit behind the credibility pass.
  Per-boundary assumption-confirmation lists recorded in §15.3 (notably: **echelon
  width-per-corridor figures were NOT obtained in research and must be read off the
  source before coding**, same for the VCI probability banding table).
  **Also produced `docs/PITCH_TERRAIN_DENIAL.md`** — an owner-requested 2–3 page external
  pitch in Australian Defence terminology, aligned to the 2026 NDS Strategy of Denial and
  northern-approaches framing, the 2026 IIP northern-bases ($13–16bn) and
  theatre-logistics ($14–21bn) lines, with RFSG/NORFORCE, 1 CER, northern base force
  protection and Bradshaw training-area management as named users. A deliberate exception
  to the no-new-docs rule: it is an external commercial artefact, not planning or
  as-built content, and duplicates nothing here. It carries a standing note to verify
  NDS/IIP wording against the published documents before external use and to state
  plainly that the mobility mode is designed, not built.
- **2026-07-19 — Docs audit: fixed a badly stale root README** (cross-repo docs
  coverage pass, alongside Station Manager's in-app wiki work and Fire Santa
  Run's docs cleanup): `README.md` was dated January 2025 and pointed "For
  Users" at `webapp/Documentation/USER_GUIDE.md` and "For Developers" at
  `webapp/Documentation/ARCHITECTURE.md`/`Documentation/README.md` — **none of
  which exist on disk**; the repo consolidated onto `docs/` + `master_plan.md`
  at some point and the README was never updated. Also wrong: claimed
  "Leaflet with Mapbox tiles" (actually Mapbox GL JS; `MapView.tsx` doesn't
  exist, the real component is `MapboxMapView.tsx` — also fixed in
  `webapp/README.md`) and "Current: Mock elevation service for demonstration"
  (a real DEM via ArcGIS ImageServer has been the primary source for a while;
  mock is the fallback, flagged `usedMockElevation`). Rewrote the affected
  sections, removed the duplicate "Roadmap" list (was drifting from this
  file — several items it called "planned" were already shipped), and pointed
  everything at `docs/README.md` / `master_plan.md`. **Real gap, not just a
  broken link:** there is no end-user guide at all (the linked one never
  existed) — added as a roadmap candidate below. Verified: `grep` sweep found
  no remaining references to the nonexistent `Documentation/` paths.
- **2026-07-19 — "Sign in with a passkey" on the account sign-in form** (same branch/PR #184, paired Station-Manager PR #686 + Fire Santa Run PR #388): owner asked for suite-wide passkey support, additive to password. `webapp/src/utils/suiteAuth.ts` gained `signInWithPasskey()` (`@simplewebauthn/browser`), which runs the WebAuthn ceremony directly on this page — possible because the Relying Party ID is the shared `.stationkit.com.au` parent domain, same as the SSO cookie above — then POSTs the assertion to Station Manager's `/api/auth/passkey/login/verify` cross-origin (a plain fetch, not the `/api/auth/login` same-origin proxy `signIn()` uses, since the ceremony itself must run here and the CORS+credentials setup is already proven by the SSO cookie work). A successful verify behaves exactly like `signIn()` — same `SuiteSession` shape, same token storage. Usernameless/discoverable flow: no `allowCredentials`, so the browser's own picker shows every passkey it holds for the RP, no username field needed. `AccountControl.tsx` gained a "Sign in with a passkey" button (feature-detected via `browserSupportsWebAuthn()`) next to the existing sign-in form. **Registration is Station-Manager-only** — no "Add a passkey" UI exists here, since Station Manager's own account settings are the suite's sole identity provider. Verified: webapp strict-TS build + production `vite build` clean (no lint/test scripts exist in this package — build is the full local CI gate, per `CLAUDE.md`).
- **2026-07-19 — Silent cross-subdomain SSO (Phase 2)** (branch `claude/santa-run-auth-integration-fzba08`, PR [#184](https://github.com/richardthorek/fireBreakCalculator/pull/184), paired Station-Manager PR #686 + Fire Santa Run PR #388): part of unifying sign-in across all three StationKit apps under one Station Manager session. `webapp/src/utils/suiteAuth.ts`'s `restoreSession()` now tries Station Manager's `GET /api/auth/session` first, with `credentials: 'include'` so the browser sends Station Manager's shared `sk_session` httpOnly cookie (set on login/signup, scoped to the `.stationkit.com.au` parent domain) if present — a visitor already signed into Station Manager or Fire Santa Run lands here already authenticated, no separate Fire Break Calculator login. Falls back to the existing Phase 1 stored-token flow (`GET /api/auth/me` with the locally-stored `auth_token`) when there's no cookie session — different domain, signed out suite-wide, or cookies blocked — so a plain FBC-only sign-in still works exactly as before. `signOut()` is now async and also POSTs Station Manager's `/api/auth/logout` (best-effort, `credentials: 'include'`) to clear the shared cookie, otherwise a page reload here would immediately silently sign back in via that cookie after an explicit sign-out. No backend (`api/`) change needed — bearer-token validation via `GET /api/auth/me` is unchanged regardless of how the client obtained the token. **Not yet live:** the cookie is scoped to `.stationkit.com.au`, so it only actually reaches this app once it's deployed at `firebreak.stationkit.com.au` (see the entry below — that domain move is still open). Verified: webapp strict-TS build + production `vite build` clean; api tests unchanged/green (12 suite-auth tests, unaffected since this was a client-only change).
- **2026-07-18 — StationKit rebrand alignment: SSO endpoint + branding sweep** (no PR yet): Station Manager's public branding/URL moved to `stationkit.com.au`. Owner decided sibling apps (this one, Fire Santa Run) move to `stationkit.com.au` subdomains rather than keeping independent domains — this app becomes `firebreak.stationkit.com.au`. Updated the suite-auth default (`SUITE_AUTH_URL` in `.github/workflows/deploy.yml`, doc comment in `api/src/services/suiteAuthService.ts`) from the old `bungrfs-linux.azurewebsites.net`/`bungrfsstation.azurewebsites.net` Azure hostnames to `https://stationkit.com.au`. Swept remaining "Bushie Tools" branding (the suite's old name) to "StationKit" in user-facing copy (`AccountControl.tsx` sign-in prompt, `AnalysisPanel.tsx` anonymous-gate button, `rateLimit.ts`'s 429 error message) and doc/code comments (`App.tsx`, `webapp/src/utils/suiteAuth.ts`, `api/src/functions/auth.ts`, `infra/main.bicep` param description, `docs/AI_ASSISTANT.md` §7). **Station Manager** as the product name is unchanged — only the suite brand name and the SSO base URL moved. **Still open (infra/ops, not code):** Cloudflare DNS + TLS for `firebreak.stationkit.com.au` and binding it as this app's Static Web App custom domain (no domain config exists in `infra/main.bicep` today — this app's origin isn't pinned to a specific hostname in code); once live, add the new origin to Station Manager's `FRONTEND_URLS`; set the `SUITE_AUTH_URL`/`VITE_SUITE_AUTH_URL` GitHub Actions repo variable to `https://stationkit.com.au` (the workflow default is now correct, but the live deployed value may still be set to the old host). Companion changes: Station-Manager PR (suite app launcher links), Fire Santa Run PR (CORS allowlist).
- **2026-07-16 — Trails from Mapbox tiles (zero-network, offline) as the primary source** (branch `claude/project-blind-spots-67k7g3`, PR [#178](https://github.com/richardthorek/fireBreakCalculator/pull/178)): follow-up to the Overpass proxy below — "can we use the Mapbox data we're already pulling?" Yes. Mapbox Streets v8 is built from the same OSM data Overpass serves, and the map already loads it. New `webapp/src/utils/mapboxTrails.ts` adds the `mapbox-streets-v8` vector source with an invisible query layer (`line-opacity:0`, kept "visible" so its `road` tiles load and stay queryable — `visibility:none` would stop the tiles loading) and reads corridor trails straight from the loaded tiles via `querySourceFeatures`. Registered by `MapboxMapView` as the infrastructure service's `LocalTrailProvider`, consulted **before any network call**, so the common case (corridor within the loaded viewport) costs **zero extra network, has no CORS, and works OFFLINE** once the area's tiles are cached — the field-first win. When those tiles don't cover the corridor (zoomed out / not yet panned over), it falls through to the backend Overpass proxy, then direct Overpass. Purely additive: an empty/absent result just falls through, so the proxy/direct chain is unchanged. Verified: webapp strict-TS build clean; the optimizer smoke bundle still passes its infrastructure checks (provider defaults to unset in tests). As-built: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §Infrastructure (trail source priority).
- **2026-07-16 — Overpass CORS fix: backend proxy for corridor trail lookup** (branch `claude/project-blind-spots-67k7g3`, PR [#178](https://github.com/richardthorek/fireBreakCalculator/pull/178)): field report from the deployed staging site — every Overpass request failed with *"No 'Access-Control-Allow-Origin' header … blocked by CORS"*, so trail data never loaded (which silently disabled BOTH the trail-reuse discount and the new snap-to-trail refinement). Root cause: the public Overpass instances omit CORS headers on their rate-limited/error responses, so the browser turns every 429/504/timeout into an opaque CORS failure — and the client-side multi-endpoint fallback can't help, since CORS is enforced browser-side regardless of endpoint. Fix: a new server-side proxy **`GET /api/infrastructure`** (`api/src/functions/infrastructure.ts` + `services/infrastructureService.ts`) that runs the Overpass query server-side (no CORS on the server→Overpass hop) and pools all users behind one server IP with a shared 10-min in-process cache, so the public 2-slot-per-IP quota is spent once per corridor, not once per user. The webapp's `infrastructureService.ts` now calls the proxy first and only falls back to calling Overpass directly when the proxy is unreachable (offline/local-dev: a 404 disables it for the session; a 502/429 falls through for that call but keeps the proxy as primary). Rate-limited under a new `infra` tag. Verified: api build + 7 new unit tests (endpoint fallback, cache hit, non-OK fallover, honest `available:false`, failure-not-cached, lon→lng normalisation); webapp strict-TS build clean. Endpoint contract in [api-register.md](docs/api-register.md); as-built in [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §Infrastructure. **This is the recommended first escalation the vegetation docs anticipated** (browser CORS proving unreliable → add a backend proxy) — now done for Overpass; the same pattern already backs the vegetation tile cache.
- **2026-07-16 — Path refinement (snap-to-trail + local fuel nudge) & NVIS-first vegetation uplift** (branch `claude/project-blind-spots-67k7g3`, PR [#178](https://github.com/richardthorek/fireBreakCalculator/pull/178)): two field-reported items on the same branch as the tile-cache work.
  - **Optimized line now snaps to the roads it reuses + refines locally.** Field screenshot: a route that reused "Old Mill Rd" (a discounted trail edge) ran *alongside* the road in a blocky hex-centre zig-zag instead of tracing it. Root cause is inherent to grid search — the Dijkstra result rides hex cell CENTRES. New `webapp/src/utils/pathRefinement.ts` post-processes each leg's coarse line using data **already held locally** (the OSM trails fetched for the corridor + the session-retained vegetation rasters/polygons), so it adds **no network cost**: densify to ~20 m → **snap to trails** (within 35 m and within 40° of the local heading — an angle gate so crossing a road doesn't spike onto it, only following one collapses on) → **local fuel-aware nudge** (free vertices shift ≤8 m toward lower fuel via `resolveFromCachedAreas`, a finer line between hex centres without a finer-hex re-search). Per-leg so the user's drawn waypoints never move; effort/length/trail stats stay on the search nodes (refinement is geometric presentation within the already-priced corridor, not a re-route); the hex heatmap is untouched. Final Douglas-Peucker tightened 15 m → 8 m to preserve the road-following curves. Verified: webapp strict-TS build clean; a 16-check bundled smoke run (endpoint preservation, parallel-snap vs perpendicular-no-snap, distance gate, fuel nudge direction, locked-vertex hold, end-to-end road-hug 25 m → <8 m offset). As-built: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) "Path refinement".
  - **NVIS-first vegetation uplift — flag modified/low-fidelity segments** (completes the remaining [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md) acceptance criteria). Segments whose fuel came from an NVIS class that is cleared/aquatic/unclassified/bare/sea/unknown (MVG 24/25/26/27/28/99) now carry an `isModifiedOrLowFidelity` flag end-to-end (`StateVegetationResult` → `VegetationSegment` → joined segments), shown with a ⚠ marker in the segment breakdown ("cleared/modified land — verify locally") so a planner treats it as low-fidelity, not native fuel. Also corrected the fidelity test's Victoria "Mallee" point from `-36.0,141.0` (actually cleared Wimmera cropland → MVG 25) to genuine Mallee `-34.7,141.2`, removing a long-standing false-negative. **State-by-state expansion stays frozen** per the NVIS-first decision — NVIS is the uniform national spine and the earlier per-state plan was explicitly retired; this uplift makes NVIS honest, it does not resume state services.
- **2026-07-14 — Vegetation area-query: at most two upstream requests per optimize run** (same branch/PR as the entry below; field-reported from watching the live colour-in): per-point sampling was the wrong architecture — 1–2 upstream queries per hex cell (~650–1500 per run) scales linearly with corridor size and would overwhelm the free government services at any real scale. Fuel now resolves from **one NSW SVTM envelope feature-query** (polygons point-in-polygon'd app-side; discarded honestly on `exceededTransferLimit` rather than sampling a partial set) plus **one NVIS `export` raster image** (~100 m/px PNG of the whole bbox, pixel colours decoded against the service's own `legend` — never a hardcoded palette; transparent = NoData, unmatched = fall back, zero-match = contract drift, discard). Per-point identify is now only the fallback, reverted to concurrency 6, and **ordered line-outward** so offline/degraded runs sample the ground that decides the route first. New canary checks probe the export + legend contracts daily (the build sandbox can't reach the live services — **confirm the first green canary run**, this is the one unverified link). Endpoint detail: [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md); optimizer detail: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md). Smoke-verified (40 checks): 3-leg corridor = 1 area call + 0 point queries (was ~220 same line), fallback line-first ordering, PIP/colour-decode/raster-lookup pure functions, all prior progress/streaming/dedupe behaviour intact. **Follow-up (same day): area data retained session-wide** — fetched rasters/polygon sets are kept (bounded FIFO) and consulted by every subsequent lookup including plain point calls, so finer optimizer passes, per-segment analysis and re-runs sample locally with zero further upstream traffic, and full hex granularity is retained because local sampling is free. Verified by a second smoke bundle running the REAL router with stubbed network (9 checks: one envelope query total across repeat area fetches; a point inside retained polygons resolves with zero network; an uncovered point still falls through the proven identify chain).
- **2026-07-14 — Optimizer performance: route-wide sampling prefetch + genuinely granular progress** (branch `claude/project-blind-spots-67k7g3`, PR TBD): field report that the corridor search ("advanced analysis") sat at 0% "for minutes" before anything moved. Root cause was twofold: (a) all network work was serialised per leg — leg 0's wide pass paid the whole corridor's vegetation sweep (1–2 ArcGIS point-queries per hex cell, ~650+ cells, only 6 in flight) before continuing, then each later leg repeated the same wait for its own corridor; and (b) the first `onProgress` callback only fired after that entire wide pass finished, so the bar told the truth ("nothing has *completed*") in the least useful way possible. Now `optimizeRoute` prefetches up front: every leg's Overpass corridor fetch starts immediately (capped at 2 in flight per the public quota; `fetchCorridorInfrastructure` gained in-flight-promise dedupe so the legs' own calls join the prefetch rather than repeating it), and the entire shared wide grid is sampled in one batched elevation request plus one vegetation sweep at concurrency 16 (up from 6) whose **per-point progress drives a new `sampling` phase owning ~2–55% of the bar** — the % now tracks the actual fetch, and the bar moves off 0 within the first second. The per-leg searches then run almost entirely on cache hits; pass progress is weighted 45/30/25 (was equal thirds) with the wide pass's streamed scan events doubling as sub-pass movement. Area recon's bar got the same per-point treatment. Explicitly assessed and rejected: a Web Worker — CPU (Dijkstra over ≤1500 nodes) is milliseconds; the entire cost is network I/O, so the fix is batching/parallelising requests, not threads. **Follow-up (same day, field suggestion): the map is now the progress indicator** — the full corridor grid outline appears the moment a run starts, and every hex colours in live as its vegetation sample arrives (throttled `cells` scan events from the prefetch, objective-severity preview, ~450 ms per-cell fade-in on the map, first-reveal-only so refinements don't re-flash), instead of the corridor staying blank until each leg's wide pass finished sampling. Verified: strict-TS build clean; a stubbed-network rolldown smoke run (19 checks) confirms monotonic fine-grained progress reaching 1.0, first report ≤5%, the whole grid streamed at run start, incremental colour-in events with real vegetation/severity, exactly one Overpass query per leg despite prefetch+leg both asking, ≥10 vegetation requests genuinely concurrent, and a warm re-run issuing zero new queries. As-built detail: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
- **2026-07-14 — Step 8: Operational hardening (run-the-service properties)** (PR [#177](https://github.com/richardthorek/fireBreakCalculator/pull/177), merged): five cross-cutting gaps that were about the tool as an *operated, relied-upon service* rather than analysis-time correctness. All five shipped together.
  - **Liability framing (Item 1).** The only prior mention of liability anywhere was the MIT `LICENSE`. Added a single source of truth for the standing disclaimer (`webapp/src/config/provenance.ts`, mirrored in `api/src/services/provenance.ts`): "planning aid, not an operational tasking; verify on the ground." It now travels with **every** GIS export (GeoJSON/KML/KMZ/Shapefile properties), the print briefing, the SMEACS pack (text + PDF footer), and is shown standing in the analysis panel. The SMEACS pack especially *looks* official, so the caveat rides there unconditionally, estimated data or not.
  - **Reproducibility stamping (Item 2).** The estimate model is tuned over time (e.g. the 2026-07-13 `VEGETATION_COST` change), so the same drawn line yields different numbers across releases; nothing recorded which. Exports/briefings/analysis-response-metadata now carry `estimate_engine_version` (`ENGINE_VERSION` 1.3.0), the data sources, generation time, and datum. Built-in equipment `costPerHour` rates now declare a `COST_BASIS` (AUD, as-of month) so they can't rot silently.
  - **Production observability (Item 3).** No App Insights in the Bicep, no error service — every field bug so far was found by users. Added workspace-based Application Insights + Log Analytics to `infra/main.bicep` (on by default, wired via `APPLICATIONINSIGHTS_CONNECTION_STRING`; `host.json` already had sampling). The API now emits a structured `METRIC` line per analysis recording whether it ran on fallback/estimated data, so the **fallback rate** (a safety KPI, since the app degrades silently) is queryable — KQL + alert guidance in `api/src/services/telemetry.ts`.
  - **Anonymous gating + cost control (Item 4).** The public API was un-metered on consumption billing. Added a per-IP fixed-window rate limiter (`api/src/services/rateLimit.ts`) on the anonymous cost-bearing endpoints (analysis, assistant, elevation), with a higher tier for signed-in suite callers (the webapp now sends the suite token on those calls). Anonymous use — **every signed-out user** — is limited to a single, non-persisted break: cloud save (already gated) and share-link now prompt Bushie Tools sign-in, with a standing notice that the break isn't saved and clears on reload. (Deployments configure `VITE_SUITE_AUTH_URL` so a sign-in path exists.) Backstop: optional monthly **budget alerts** in Bicep. Mapbox token URL-restriction is an ops action, documented in `infra/README.md`.
  - **Upstream data-contract canary (Item 5).** ~10 free public endpoints with no SLA back the product, and the NVIS `NoData` bug + Overpass throttling change were both upstream drift the stubbed unit tests can't catch. Added `scripts/canary/upstreamCanary.mjs` (dependency-free) that probes each endpoint with a known input and asserts the shape/fields the code depends on, run daily by `.github/workflows/upstream-canary.yml` (fails → notifies).
  - **Datum in exports (Item 6).** Exports now declare WGS84 (EPSG:4326) explicitly in properties/metadata (Shapefile relies on shp-write's WGS84 `.prj`), pre-empting the GDA94↔GDA2020 question from agency GIS teams.
  - **Verification:** `api` build + `test:unit` green (incl. 3 new rate-limiter checks); `webapp` strict-TS build clean. The canary was exercised locally but the sandbox proxy blocks the AU-gov/Overpass/Mapbox hosts (uniform 403), so its live green run must be confirmed from CI — flagged for the first scheduled workflow run.
- **2026-07-13 — Field-reported analysis fixes: vegetation always medium scrub, empty recommendations, NVIS `NoData`, + optimizer fuel weighting** (branch `claude/nvis-vegetation-equipment-mapping-35bqqz`, PR [#173](https://github.com/richardthorek/fireBreakCalculator/pull/173)): several independent defects, all surfaced from field testing.
  - **Optimizer/heatmap fuel weighting.** Confirmed the hex-grid cost heatmap already fuses slope × vegetation (`edgeCost` drives both routing and colour), so the "vegetation not in the heatmap" symptom was really the always-medium-scrub sampling bug below. On top of the fix, raised `VEGETATION_COST` from `1.0/1.2/1.7/2.6` to `1.0/1.4/2.2/3.8` (grounded on a machinery↔hand-crew blend of the production model's inverse-speed effort) so heavy fuel matters more in both the optimized route choice and the heatmap colour. See [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
  - **Mobile "No option" for all resources.** Every equipment calculation (backend + frontend) was gated on `mapSettled` (the initial location-settle signal). That signal fires on geolocation success and failure, but if it's missed on a given mobile browser the panel wedges at "No option" forever — even on flat, easily-workable ground. A drawn line already proves the map is interactive, so the gate is now `mapSettled || distance > 0`: heavy analysis still doesn't fire during the initial pan, but a real line always produces estimates.
  - **Recommendations balance speed vs cost + composite plans.** The Plan Assistant recommended the *fastest* compatible resource, so a marginally quicker but far pricier option won by default. `pickByValue()` now prefers the cheapest option within 1.5× the fastest time (falling back to fastest when costs are unknown) and the card flags the faster-but-dearer alternative with its premium. New `composite-plan` insight recommends splitting the job — machinery on the workable bulk, aircraft/hand crews on the very-steep or heavy-timber pockets a dozer can't safely/effectively cut — locating the biggest pocket by chainage. See [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
  - **Vegetation analysis parallelised.** `analyzeTrackVegetation` sampled each segment's fuel with a sequential `await fetchStateVegetation` in a loop — a long line at 200 m spacing is dozens of ArcGIS round-trips paid one after another, the dominant cost of "analysis takes a long time". Now sampled with a bounded (8-wide) concurrency pool (mirroring what the route optimizer already did), ordering preserved for the merge step; lookups are cached/deduped so repeats stay free. Slope elevation was already batched.
  - **Heatmap dropped later legs of a multi-leg line** (field screenshot: legs 3 & 4 of a 4-leg line had no corridor coverage). `runHexPass` discarded its already-scanned `cells` whenever the leg's Dijkstra search failed to connect A→B (`return null`), so that leg contributed nothing to the heatmap even though its corridor was sampled — and later legs are the more likely to fail. Now the scanned cells are returned regardless of search success (only the optimized *path* falls back to the straight line), the `!best` leg fallback surfaces `widePassCells` instead of `[]`, and a leg whose shared-grid filter catches < 3 cells regenerates a dedicated finer corridor (keeping the shared projection) rather than dropping out. Every leg now renders its analysis coverage. See [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
  - **Corridor heatmap seams at multi-leg vertices.** Further field feedback: on a line with several vertices, the hex corridor around each leg was a straight-sided buffer, so at each joint two adjacent legs' buffers crossed at an angle instead of blending into one continuous shape — "several overlapping straight areas", not one corridor. Root cause: the July 12 WP1 fix (`buildSharedWideGrid`) solved grid *alignment* but each leg's wide-pass corridor MASK was still filtered against just that leg's own `[A, B]`. Fixed by extending the mask polyline with one neighbouring waypoint on each side before filtering, so the existing multi-segment-aware distance function rounds the mask through the joint — the Dijkstra search itself is unchanged (still strictly that leg's own A→B), only the rendered/searchable corridor shape softens at vertices. See [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
  - **Objective vs relative heatmap colour scale.** Follow-up field feedback: even with fuel weighted in, the heatmap's per-scan min/max stretch meant a flat heavy-timber cell could still render green whenever something steeper happened to sit elsewhere in the same corridor — the scale was relative to that scan, not to how hard the ground actually is. Added a second, FIXED severity per cell (`costNormalizedObjective`) built from vegetation severities and slope-severity anchors pinned to the same machinery/hand-crew safety limits the equipment engine already uses (25°/45°) — `max(veg, slope) + 0.3·min(veg, slope)`, so heavy forest is a guaranteed floor of "at least amber" and 45°+ slope is a guaranteed "red", independent of the rest of the scan. A toggle (defaults to **objective**) in the corridor-scan legend switches all three heatmap layers (final result, streamed scan, area recon) between objective and the original relative scale. Documented as relative to *standard* equipment capability, not the specific machines configured in a deployment — full equipment-specific tinting is a larger follow-on. See [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
  - **No equipment recommendations reached the analysis (production only).** The frontend keeps a built-in standard-equipment catalogue (`config/standardEquipment.ts`) as a resilient fallback so the resource list and estimates are "never blank", but `equipmentApi.ts`'s `withFallback` only applied it *in development* — in production a thrown `/api/equipment` call (backend down/erroring) propagated, left `equipment` empty, and since `defaultConfig` carries no equipment, **every** resource type (machinery, aircraft, hand crews) silently disappeared, not just machinery. Fix: reads now fall back to the standard catalogue in every environment; writes still fail loudly in production (no silent "pretend it saved").
  - **NSW SVTM mapping collapsed every formation to `mediumscrub @ 0.5`** (the actual "always medium scrub" root cause, found from field testing a 12 km grassland→heavy-timber line that read 100% one formation). `fetchNSWVegetation` calls the curated DB mapper `mapFormationToVegetationType` first, but that returned a hardcoded `mediumscrub @ 0.5` default on any miss (exact-string match, or empty/unreachable mappings DB) — and since it didn't *throw*, the good structural regex heuristic (`mapNSWToInternal`: forest→heavyforest, grassland→grassland) was never reached. So nearly every sample became medium scrub @ 50%, and the merge step then collapsed the whole line into one segment showing the start point's label ("Southern Escarpment Messmate Forest" → medium scrub; "Not classified" → 100%). Fix: the dynamic mapper now returns `null` on a miss and the NSW service falls through to the structural heuristic, restoring per-segment variety and correct confidence. Verified with a standalone repro (messmate/sclerophyll → heavyforest@0.95, grassland → grassland, "Not classified" → grassland@0.6).
  - **NVIS `NoData` fabricated a fuel class.** `extractMVGCode` fell through the `"NoData"` pixel value (correct) but then scanned unrelated numeric attributes and picked up `Raster.SORT_ORDER`/`COUNT`, resolving ocean/data-gaps to a bogus MVG (e.g. `SORT_ORDER 28` → "Sea and estuaries" → grassland). It now trusts the explicit pixel/code field only (guarding the `NoData` sentinel) and reserves the broad scan for old releases with no code field, so gaps fall through to the next source flagged `estimated` — satisfying the [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md) `NoData` acceptance criterion. Added a debug log of the resolved MVG code/name/fuel per point so the mapping can be verified in the field. Verified: standalone Node repro of the extractor (real MVGs resolve, `NoData` → null, old-release `gridcode` variant still resolves); `npm run build` (webapp, strict TS) clean. Flips roadmap Step 6 "vegetation NoData uplift" 📋 → ✅ for the `NoData` half.
- **2026-07-13 — Suite auth config wired into deploy pipeline + IaC** (PR [#172](https://github.com/richardthorek/fireBreakCalculator/pull/172), paired Station-Manager PR [#647](https://github.com/richardthorek/Station-Manager/pull/647)): the #169 integration required `VITE_SUITE_AUTH_URL` (webapp build) and `SUITE_AUTH_URL` (Functions API) but neither was set anywhere in `deploy.yml`/`infra/main.bicep`, so the deployed app hid account features and saved-plan endpoints 503'd. Now: workflow-level `SUITE_AUTH_URL` env (repo-variable override, defaults to SM prod `https://bungrfs-linux.azurewebsites.net`) baked into both webapp builds and passed to Bicep, which sets the `SUITE_AUTH_URL` app setting; `savedplans` table + `SAVED_PLANS_TABLE_NAME` made explicit in IaC. **Remaining ops (SM side):** add this app's origin to SM `FRONTEND_URLS`; run SM's `grant:firebreak` backfill so pre-#638 orgs pick up the entitlement.
- **2026-07-12 — Live layers button relocated into analysis panel** (PR [#171](https://github.com/richardthorek/fireBreakCalculator/pull/171)): moved the live context feeds control (hotspots, fire boundaries, incidents) from a fixed map overlay into a new "Live Layers" tab in the analysis panel, reducing visual clutter on the map and consolidating situational context with route analysis. State lifted to App component for access across MapboxMapView and AnalysisPanel; CSS scoped to panel context to re-style the control layout.
- **2026-07-12 — Suite subscription integration** (PR [#169](https://github.com/richardthorek/fireBreakCalculator/pull/169), paired Station-Manager PR [#638](https://github.com/richardthorek/Station-Manager/pull/638)): the calculator is now part of the Station Manager (Bushie Tools) subscription while staying fully usable anonymously.
  - **User recognition:** header `AccountControl` signs in against Station Manager (`POST /api/auth/login` → `GET /api/auth/me`), stores the JWT under the suite-wide `auth_token` localStorage key, restores the session on reload, and reads the org's `fireBreakEnabled` entitlement (granted by SM's Basic + AI Pro plans as of the paired SM change). Hidden entirely unless `VITE_SUITE_AUTH_URL` is configured.
  - **Cloud saved plans:** new `/api/plans` CRUD (Azure Functions + Table Storage, PartitionKey = SM user id) storing the *same* compact encoded payload the share-link feature produces, so a restore goes through the existing hardened `decodePlan()` path (line + break width + vegetation override together). "Save plan" button sits beside "Share link" in the analysis panel; load/delete live in the account panel. Server-side auth validates the bearer token against SM `GET /api/auth/me` (60 s positive cache, failures uncached) and enforces the entitlement (401/403/502/503 mapped to friendly messages); per-user cap 100 plans, payload cap 100 KB.
  - **Config:** API needs `SUITE_AUTH_URL` (+ optional `SAVED_PLANS_TABLE_NAME`, default `savedplans`); webapp needs `VITE_SUITE_AUTH_URL` at build; the FBC origin must be added to SM's `FRONTEND_URLS` for CORS. Fixed en route: a legacy absolute-position rule on `.config-panel-toggle` that overlaid anything else placed in the header's right slot.
  - **Verification:** api build + 12 new unit tests green (validation, entity mapping, suite-auth fetch/cache with stubbed network); webapp strict-TS build clean; full browser flow driven with Playwright against mocked SM + plans APIs (sign-in incl. bad-password error, entitlement badge, save→list→load-sets-`#plan=`-hash→reload, session restore, sign-out) — all 10 checks pass.
- **2026-07-12 — UI review: layout fixes + polish pass** (PR [#170](https://github.com/richardthorek/fireBreakCalculator/pull/170)): fixed the two reported layout bugs and did a broad visual tidy-up. **Analysis panel now fills the desktop side column** — the mobile-first `.analysis-section.expanded { max-height: 70vh }` / `.collapsed { max-height: fit-content }` rules out-specified the desktop media query's `max-height: none`, capping the panel and leaving dead space below it; the desktop rules now explicitly neutralise every state and the panel renders as a full-height floating card with a gutter. **iOS Safari URL bar no longer covers bottom content** — the shell was sized with `100vh` (which includes the area behind the collapsed URL bar); now `100dvh` with a `vh` fallback, `viewport-fit=cover`, and `env(safe-area-inset-bottom)` padding on the analysis section, config panel, and consent banner; remaining user-facing `vh` units (collapsed strip, live-feeds panel, equipment sidebar, config content) converted to paired `dvh`. Polish: consent banner rebuilt as a compact, wrap-on-phone toast in CSS classes (it used to cover the collapsed panel and swallow taps), search icon moved inside the input pill (lucide icon, was a stray emoji outside the field), header given a border+shadow for depth, live-feeds toggle restyled to match the scan-area button so map overlay controls share one language, slim theme-matched scrollbars on all scrolling panels, and an animated width transition on panel expand/collapse. Verified: `npm run build` (strict TS) clean; before/after Playwright screenshots at desktop/tablet/iPhone widths in all panel states.
- **2026-07-12 — Relocate live layers button into analysis panel** (PR [#171](https://github.com/richardthorek/fireBreakCalculator/pull/171)): moved the live context feeds control (hotspots, fire boundaries, incidents) from a fixed map overlay into a new "Live Layers" tab in the analysis panel. This prevents the button from obscuring map content and ensures the control scales as layer options grow. **Changes:** lifted `liveFeedData` state from MapboxMapView to App, added `onViewBoundsChange` callback so AnalysisPanel gets the current map viewport for hotspot queries, integrated LiveFeedsControl as a new tab with Flame icon, updated CSS to remove fixed positioning and adapt the panel styling for tabbed context. Verified: `npm run build` (strict TS) clean.
- **2026-07-12 — Step 7 shipped: Detailed-analysis experience uplift** (branch `claude/detailed-analysis-improvements-papfgj`, issue [#165](https://github.com/richardthorek/fireBreakCalculator/issues/165)): all seven work packages from the design. **Root cause fixed (WP1):** the optimizer used to build a fresh hex grid per leg (own projection origin, own hex size), so any line with ≥2 legs rendered two or more misaligned heatmaps overlapping at shared waypoints — now `buildSharedWideGrid()` builds one route-wide grid up front and every leg's wide pass filters cells down from it, deduped by cell centre. **Streamed, not end-of-run (WP2/WP3):** Dijkstra now yields every ~40 node-pops so the search visibly crawls the grid; the optimizer's `onScanEvent` streams grid build-out → cost-colouring → live frontier path to a dedicated map layer; the corridor sweep is one-directional and eases toward the real progress fraction instead of a fixed-clock ping-pong. **Plain language (WP4):** "Pass 1 of 3 — wide corridor scan" became phase-aware copy with no algorithm jargon. **Auto-run (WP5):** optimize starts ~800 ms after drawing a line ≥120 m, with a loop guard against the apply→re-trigger cycle and a visible Cancel. **Area recon (WP6):** a new "Scan area" box tool (`areaScan.ts`) scans terrain+vegetation only (no pathfinding) and shares its elevation/vegetation sample caches with the route optimizer — a new ~30 m elevation cache was added alongside the existing ~100 m vegetation cache specifically so this sharing has something to share. **Accept button (WP7):** was gated behind `improvement > 1%`, silently hiding whenever a result was close to the original or the user preferred their own line — now shows whenever the coordinates genuinely differ. **Verification:** `npm run build` (webapp, strict TS) clean; a standalone esbuild-bundled Node smoke test against the real hex-math module (10 checks — box-hex generation, the shared-grid dedup mechanism itself via simulated overlapping legs, axial round-trips, 6-neighbour equidistance) since the sandbox had no Mapbox token for a live browser pass — flagged in [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) as the one thing to confirm live. As-built: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
- **2026-07-12 — Step 3 live-context feeds shipped + OSM trail-lookup reliability fix** (branch `claude/live-context-feeds-research`, rebased onto the PR #163 branch): built on the 2026-07-11 endpoint research below —
  - **National + jurisdictional feeds live on the map:** `liveFeedsService.ts` (fetch/normalise), `liveFeedLayers.ts` (Mapbox sources/layers, canvas-drawn AWS-style warning triangles, XSS-safe popups via `textContent` only), `LiveFeedsControl.tsx` (toggle panel — per-source ✓/✗ status, "as of" timestamps, attribution, explicit "not covered" list). DEA Hotspots (bbox-queried, refetches on pan past a padded viewport) and Digital Atlas NRT boundaries are national; incidents/warnings are built for NSW, VIC, SA, WA, ACT (all confirmed CORS-clean — no backend aggregator needed). QLD (wrong CRS — EPSG:3857), TAS (no reachable public endpoint found) and NT (data is danger-rating warnings not incidents, and carries a "do not scrape/republish" notice — respected, not routed around) are explicitly flagged as gaps in the UI rather than silently absent.
  - **AFDRS assessment — stopped per instruction, needs your decision:** checked live whether the *official* rating/FBI product (not a spread rebuild — that was never in scope) is openly available the way hotspots/boundaries/incidents were. It isn't: `afdrs.com.au` is a public webpage with no API; BOM's actual machine-readable FDR products are gated behind BOM's Registered User program (cost-recovered, agency-oriented registration, not self-serve); no state agency was found republishing it as open data. This is an access-control barrier, not a discovery gap, so **nothing was built** — see the full assessment and options (apply for BOM access / deeper per-state search / third-party redistributor) in [GIS_INTEROP.md](docs/GIS_INTEROP.md) §4.
  - **OSM/Overpass trail lookup was reported broken — root-caused and fixed:** live testing reproduced it — the public `overpass-api.de` instance enforces a 2-concurrent-slot-per-IP quota and returns intermittent `406`s independent of rate limiting; a single bad response used to sink trail lookups for an entire optimize run. `infrastructureService.ts` now tries a short ordered list of endpoints (primary + two mirrors, overridable via `VITE_OVERPASS_URLS`), fails over immediately rather than retrying a struggling endpoint, and remembers whichever one last worked so a multi-leg route doesn't re-pay the primary's rate limit on every leg. Verified live: a simulated 3-leg run where the primary failed on leg 1 fell over to a mirror and stayed on it for legs 2–3 with full trail data, where the old code would have returned `infrastructureAvailable:false` for the whole route. Documented in [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
  - **Verification:** `npm run build` (webapp, strict TS) clean; standalone Node smoke test against real Overpass endpoints confirms the fallback/sticky-endpoint behaviour end-to-end (see PR for script). Live in-browser smoke test of the map UI itself was **not** done this session — flagged below as the one thing still to confirm.
- **2026-07-12 — Step 4b shipped** (PR [#167](https://github.com/richardthorek/fireBreakCalculator/pull/167)): SMEACS operator briefing pack — deterministic six-section builder (`buildSmeacsBriefing()`) with explicit user-editable blanks, never fabricated facts; 3 new heavy-plant doctrine chunks in KB (ROPS/FOPS/OPG, escort-appliance, supervision thresholds; NSW RFS OPG manually transcribed); road-access intelligence via Overpass + Mapbox Directions; user-drawn access lines (second drawing role, persisted in share links); PDF builder (lazy-loaded pdf-lib, printable A4 with all sections + citations); static map URL builder (Mapbox Static Images with line + markers + access overlays); all exports gracefully degrade if external services unavailable. Backend: 3 new service functions + `POST /api/assistant/smeacs` endpoint. Frontend: utilities ready for UI component wiring (deferred). Verified: api/webapp builds clean, unit tests pass.
- **2026-07-12 — Step 4b planned** (issue [#166](https://github.com/richardthorek/fireBreakCalculator/issues/166)): detailed design for the SMEACS operator briefing pack — deterministic six-section builder with explicit user-editable blanks (never fabricated operational facts), curated heavy-plant doctrine chunks (NSW RFS Heavy Plant OPG: ROPS/FOPS/OPG, escort-appliance ratios, supervision thresholds — wording to be manually transcribed, the RFS site blocks automated fetch), road-access entry-point suggestion + Mapbox Directions approach summary, a second `access` drawing role, and PDF/copy-as-text/static-map outputs. Split into 3 PRs. Design: [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) §5, [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) "Road access & approach".
- **2026-07-11 — Step 3 live-context feeds: research + endpoint testing** (branch `claude/live-context-feeds-research`): confirmed two **official national** situational feeds as the spine (mirrors the NVIS-first call) — **DEA Sentinel Hotspots** (Geoscience Australia WFS, `public:hotspots_three_days`, ~93.5k national detections/3 days, CORS-enabled, CC BY 4.0) and the **Digital Atlas of Australia near-real-time bushfire boundaries** (ArcGIS FeatureServer layer 3 "Extents", 467 national polygons, `f=geojson`, CORS `*`, CC BY 4.0/OFFICIAL, excludes NT). Both are browser-callable directly like NVIS. Established that **no single national incidents/warnings feed exists** — AWS is a vocabulary, not a feed — so incident points become a phased jurisdictional overlay (NSW/VIC/SA CORS-clean; QLD/WA/TAS/ACT/NT via backend aggregator normalised to AWS levels). Confirmed endpoint structures, quirks (unfiltered `hotspots` scan times out → always bbox/time-filter; epoch-ms dates on boundaries; `power = -1` sentinel; nullable state fields) recorded in [GIS_INTEROP.md](docs/GIS_INTEROP.md) §4. **AFDRS fire-danger split into its own next task (Step 3a).**
- **2026-07-11 — AI assistant core (Step 4) shipped** (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163)): Azure AI Foundry account + model deployment in Bicep (`deployAiAssistant`, off by default, no forced cost); `POST /api/assistant/briefing` and `/api/assistant/chat` backend proxies; an 11-chunk curated doctrine knowledge base (keyword retrieval today, designed as the swap point for Azure AI Search vector RAG later); a grounding-validation gate that extracts every numeric claim and citation from a model response and rejects it outright if either isn't traceable to the payload/retrieved doctrine — briefing falls back to a fully deterministic template, chat falls back to a plain "unavailable" message, never a guess. Frontend `AiAssistantCard` (briefing + chat) sits alongside, never replacing, the rule-based Plan Assistant, with every response source-badged. **Caveat, stated plainly:** built and unit-tested (grounding logic + KB retrieval, pure functions, no network) without access to a live Foundry endpoint or an `az`/Bicep compiler in the build session — the Bicep and a live model call are sanity-checked by hand, not mechanically verified; both need a real deploy + manual check before relying on them.
- **2026-07-11 — Hexagonal multi-pass optimizer + corridor scan visualization** (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163)): replaced the rectangular lattice+DP search with a hex-grid Dijkstra search (Uber H3-style tiling — 6 equidistant neighbours per cell instead of forward/lateral-only movement), run in three automatic passes per leg (wide scan → refine → polish, cheapest-wins safety net) so a single click now searches wider and deeper than the old single-pass search — addressing user feedback that manual re-runs were finding better paths than one run. Caught and fixed a real correctness bug along the way: an earlier fallback edge let the search "tunnel" through terrain between distant same-elevation points without sampling what was between them. Added on-map "scan theatre": an animated sweep across the search corridor while the optimizer runs, then a smooth green→amber→red hex heatmap (from the widest pass) showing exactly what terrain/fuel the search weighed — reduced-motion aware. Verified: 58-check smoke test (up from 22) plus a separate 12-check hex-math sanity pass, including a regression guard proving the wide multi-pass search never underperforms a narrow single pass, and heatmap validity (normalized costs, closed polygons, real gradient).
- **2026-07-11 — Steps 1–2 shipped** (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163)): GIS export pack (GeoJSON/KML/KMZ/Shapefile, provenance flags in every format) + file import (GeoJSON/KML/KMZ/GPX) as plan line or map overlay; optimizer now prices OSM-mapped trails as discounted edges (Overpass, graceful degradation, "verify trafficability" labelling) and the assistant flags unanchored ends in continuous fuel. Water/cadastre advisory layers deferred pending licensing check.
- **2026-07-11 — Route Intelligence & UI overhaul** (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163)): corridor pathfinding over real DEM + NVIS/NSW samples with apply/dismiss preview; rule-based Plan Assistant with chainage-located hazards; elevation profile + segment breakdown; tabbed analysis workspace. Verified: builds clean, API tests pass, 22-check optimizer smoke test. As-built: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md).
- **2026-07-11 — Master plan replaced** with the mitigation-copilot direction above (steps 1–6); detail moved to [AI_ASSISTANT.md](docs/AI_ASSISTANT.md), [GIS_INTEROP.md](docs/GIS_INTEROP.md), [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md). Prior plan content preserved in git history.
- **2026-07-11 — Vegetation strategy: NVIS-first confirmed**; per-state expansion frozen. See [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md).
- **2026-07-10 — Calculation engine overhaul** (PR [#148](https://github.com/richardthorek/fireBreakCalculator/pull/148)): per-segment grounded production model (NWCG 2021, DELWP 56), machinery slope limits, backend as sole engine. See [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md).

---

**Next review:** after Step 1 (GIS export pack) ships.
