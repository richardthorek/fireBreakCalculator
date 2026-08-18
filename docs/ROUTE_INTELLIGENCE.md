# Route Intelligence — As-Built & Design

**Status:** Corridor optimizer + Plan Assistant shipped (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163), July 2026), since upgraded from a rectangular lattice to a hexagonal multi-pass search + on-map scan visualization. Infrastructure-aware cost surface is built (trails), hardened 2026-07-12 with multi-endpoint Overpass resilience after live testing showed the single public instance rate-limits and intermittently fails; water/cadastre overlays remain designed. Detailed-analysis experience uplift (issue [#165](https://github.com/richardthorek/fireBreakCalculator/issues/165)) shipped 2026-07-12: one route-wide grid (no more layered heatmaps), a live streamed scan, auto-run on draw, area recon, and a fixed accept button.
**Owner doc for:** pathfinding, chainage model, insight engine, terrain UI, and their planned extensions.

---

## As-built (July 2026)

### Chainage model (`webapp/src/utils/chainage.ts`)
Every along-line location is addressed by **chainage** (metres from line start). One index (`buildChainageIndex`) converts chainage ↔ coordinates; the elevation profile, segment table, insights, and map highlights all reference the same chainage so every surface points at the same ground.

### Corridor optimizer (`webapp/src/utils/routeOptimizer.ts`, `hexGrid.ts`)
**Hexagonal multi-pass search** (superseded the original rectangular lattice+DP in July 2026, same PR). Waypoints are fixed — the optimizer refines *between* consecutive pairs, never replaces the user's intent.

- **Grid — one route-wide shared grid for the wide pass (2026-07-12, issue #165 WP1):** `buildSharedWideGrid()` builds a single tangent-plane projection and a single hex size (pointy-top axial hexagons, `hexGrid.ts` — Red Blob Games reference formulas; the same tiling style Uber's H3 uses for spatial routing, ~1500-cell cap) across the *whole* drawn line, sized off the widest of every leg's own wide-pass corridor. Each leg's wide pass filters cells down from this shared grid instead of building its own projection+size. This fixed a real defect: previously each leg called `chooseHexSize`/`generateCorridorHexes` independently (its own projection origin at the leg midpoint, its own hex size from leg length), so any line with ≥2 legs rendered two or more misaligned, differently-sized heatmaps overlapping at shared waypoints. The heatmap output is deduped by cell centre so a cell straddling two legs' corridors is counted once. Refine/polish passes keep their own finer per-leg grids — they're never rendered, so there's nothing to misalign.
- **Corridor mask follows the bend at vertices (2026-07-13):** WP1 fixed grid *alignment*, but each leg's wide-pass corridor MASK (which shared-grid cells fall inside that leg's search/heatmap) was still filtered by distance to that leg's own straight `[A, B]` — a sharp-cornered "sausage" per leg. At a multi-leg vertex, two independently-straight buffers crossing at an angle read as visibly separate, overlapping areas rather than one continuous corridor (reported from the field on a multi-vertex line). Fixed by extending the wide pass's mask polyline with one waypoint of context on each side (the previous leg's start / next leg's end — `wideGuideWaypoints` in `optimizeLegHex`) before filtering; `distanceToPolylineLocal` (already multi-segment-aware, same function `buildSharedWideGrid` uses for the whole route) then naturally rounds the mask through the joint, matching the neighbouring leg's mask there. The Dijkstra SEARCH is untouched — `A`/`B` are still that leg's own endpoints, so only the rendered/searchable corridor *shape* softens at joints; a leg's search still cannot "shortcut" through a distant, unrelated leg's territory (the extension is capped at one neighbouring waypoint, not the whole route). Verified geometrically: a cell 30 m off a 90° bend's second segment sat 104 m from the first leg's own straight line (correctly excluded from a 60 m corridor under the old filter) vs 30 m from the extended mask (correctly included) — the exact seam the report described.
- **Three passes per leg, automatic:** *wide* (half-width up to min(900 m, 45% of leg length), ~650 cells, drawn from the shared grid) → *refine* (32% of the wide width, ~480 cells, corridor re-centred on the wide pass's own path) → *polish* (14% of the wide width, ~320 cells, centred on the refine pass's path). The cheapest of the three always wins — later passes can only match or beat the wide pass, never lose ground to it. This intentionally spreads further than a cautious single pass would, and bakes into one click what used to take a couple of manual re-runs to stumble into.
- **Search:** Dijkstra over the hex adjacency graph; start/end connect to every hex within reach (not just the nearest) so the search picks whichever entry/exit is genuinely cheapest. **No direct start→end shortcut edge** — an earlier version had one as a connectivity fallback and it silently "tunnelled" through terrain by comparing only the two endpoint elevations (caught by the smoke test: two waypoints at equal elevation either side of a ridge produced a zero-slope "path" that was actually just the raw straight line). A pass that can't connect is treated as failed, not patched over. Since 2026-07-12 the search yields to the event loop every ~40 node-pops (negligible overhead at ≤1500 nodes) so a caller-supplied `onYield` can stream frontier/partial-path snapshots — this is what makes the wide pass's search visibly crawl the grid (see scan visualization below) instead of resolving silently.
- **Sampling:** elevations via ONE batched `POST /api/elevation/profile` per pass (falls back to Terrain-RGB tiles), now behind a shared **~30 m elevation cache** (`sampleElevationsCached`, 2026-07-12) alongside the existing ~100 m vegetation cache (`fetchStateVegetation`, NSW SVTM → NVIS) — both caches are shared with the area recon scan (below), so a box scanned before drawing a line through it turns that line's search into mostly cache hits. The infrastructure (trail) fetch runs once per leg and is reused across all three passes.
- **Route-wide sampling prefetch (2026-07-14, perf):** the run no longer serialises its network work per leg. Field report: a run sat on 0% "for minutes" before anything moved — the cause was leg 0's wide pass paying the whole corridor's vegetation sweep (one to two point-queries per hex cell, only 6 in flight) before the first progress callback ever fired, then each later leg repeating the same wait for its own corridor. `optimizeRoute` now, up front: (1) kicks off **every** leg's Overpass corridor fetch (capped at 2 in flight to respect the public instances' per-IP slot quota; `fetchCorridorInfrastructure` gained an in-flight-promise dedupe so each leg's own later call joins the prefetch request instead of repeating it), and (2) samples the **entire shared wide grid** in one batched elevation request plus one vegetation sweep at concurrency 16 (up from 6 — 1–2 small GETs per point against HTTP/2 gov ArcGIS servers). Each leg's passes then run almost entirely on cache hits, so the per-leg searches that used to re-pay sampling now take seconds. CPU was checked and is NOT the bottleneck (Dijkstra over ≤1500 nodes is milliseconds), so no Web Worker — the win is batching/parallelising the network I/O. Verified by a stubbed-network smoke run: 3-leg line → exactly 3 Overpass queries (dedupe), ≥10 vegetation queries genuinely in flight, warm re-run issues zero new queries.
- **Granular progress (2026-07-14, same change):** `onProgress` now reports a new `sampling` phase driven per-point by the vegetation sweep (the actual long haul, so the % genuinely tracks the fetch), owning ~2–55% of the bar; the search phase spans the rest, weighted per pass (wide 45% / refine 30% / polish 25% of a leg — replacing the old equal thirds that parked the bar during the expensive pass) with the wide pass's streamed scan events doubling as sub-pass progress. The bar moves off 0 within the first second (grid layout reports 2%). Area recon's bar is likewise driven per-point through its 0.1→0.7 sampling span instead of one end-of-fetch jump.
- **Area-query vegetation — at most TWO upstream requests per run (2026-07-14, field-reported):** watching the live colour-in exposed the real cost of per-point sampling: one to two upstream queries **per hex cell** (~650–1500 per run), which scales linearly with corridor size and "at any sort of scale will overwhelm the upstream API" (free government servers, no SLA, no quota owed to us). `sampleVegetation` now takes the corridor's bbox and resolves fuel from **one NSW SVTM envelope feature-query + one NVIS `export` raster image**, both decoded/sampled app-side (point-in-polygon for NSW polygons; legend-driven pixel colour-decode for the NVIS raster — endpoint contracts, safeguards and canary coverage in [NVIS_INTEGRATION.md](NVIS_INTEGRATION.md)). Per-point identify remains ONLY the fallback (area data unavailable/offline, unmatched pixels), at concurrency 6 (the raise to 16 is reverted — it optimised the wrong thing), and **ordered line-outward**: the prefetch sorts the sweep by distance to the drawn line, so whatever per-point work happens samples the ground that actually decides the route first, and the streamed colour-in sweeps outward from the line. Positive NoData from the raster (ocean/gaps) short-circuits to the flagged conservative assumption without wasting a point query. Smoke-verified: whole 3-leg corridor resolved from exactly 1 area call and 0 point queries (was ~220 on the same synthetic line); fallback run confirms line-first ordering (first-quartile mean distance ≪ last-quartile) and the concurrency cap. **Retention (same day):** fetched area datasets are kept for the session and consulted by every later lookup — including plain point calls — so the finer refine/polish passes, per-segment analysis on an applied line, and re-runs all sample the locally-held data with zero further upstream traffic; the full hex granularity is retained because local sampling is free (see NVIS_INTEGRATION.md "Retention").
- **Live colour-in during sampling (2026-07-14, field suggestion):** the map itself is now the progress indicator. The route-wide prefetch emits a `grid` scan event for the WHOLE shared grid the moment it's built (the full corridor outline appears at run start, where previously the map was blank until each leg's wide pass), then streams throttled (~120 ms) `cells` events as **each vegetation sample lands** — every hex colours in as its data arrives, sweeping across the corridor with the fetch. Per-cell slope comes from the batched elevation request (resolves in one round trip; early veg arrivals buffer until it does); the streamed preview colours on the **objective** severity for both scales, since a per-scan relative stretch is undefined until the scan finishes — each pass's own `cells` events later overwrite with the true pair, and the final heatmap replaces the lot. `MapboxMapView` fades each newly revealed cell in over ~450 ms (per-feature time-based opacity — data-driven paint can't use layer transitions, so the opacity expression is re-set per frame with the current clock; the loop self-terminates when the youngest reveal finishes and is skipped under `prefers-reduced-motion`); `App.tsx` stamps `revealedAt` on first reveal only, so later refinements don't re-flash a cell.
- **Cost:** metres × traversal-slope factor (quadratic ramp, ×1.6 ≥25°, ×3 ≥45°) × fuel factor (grass 1.0 / light 1.2 / medium 1.7 / heavy 2.6), discounted on mapped trail (see below). Douglas-Peucker simplify (8 m) on the final output — tightened from 15 m once the output became a refined line (below) rather than raw hex centres.
- **Path refinement — coarse hex line → realistic line (2026-07-16, field-reported: `pathRefinement.ts`):** the Dijkstra search routes at grid resolution, so its result rides the hex cell CENTRES — a slightly blocky zig-zag, and where it chose to reuse a trail (a discounted edge) the line runs roughly *alongside* the road rather than on it (field screenshot: a route paralleling "Old Mill Rd" instead of tracing it). After the per-leg search, each leg's coarse line is refined into a realistic one using data **already held locally**, so refinement costs no extra network round trips: (1) densify to ~20 m spacing; (2) **snap to trails** — pull vertices onto a mapped trail/road when it's within 35 m *and* runs within 40° of the local path heading (an angle gate so a route that merely *crosses* a road doesn't spike onto it, only one *following* it collapses on); (3) **local fuel-aware nudge** — each still-free vertex may shift ≤8 m perpendicular toward lower-fuel ground, resolved from the session-retained area vegetation data (`resolveFromCachedAreas`, zero-network), giving a finer, more realistic line between hex centres without re-running the search at a finer hex size. Done **per-leg** so each leg's endpoints — which ARE the user's drawn waypoints — never move. The effort/length/trail-reuse stats stay computed on the search nodes: refinement is a geometric presentation pass *within* the corridor the search already priced, not a re-route, so it must not restate the costed result. The hex heatmap is untouched (it still shows the full scanned corridor). Verified by a 16-check bundled smoke run: endpoint preservation, parallel-run snap-on vs perpendicular-crossing snap-off, distance gate, monotone fuel nudge toward the cheaper side, locked (snapped) vertices held, and end-to-end road-hugging (mean offset from the road 25 m → <8 m).
- **Honesty:** any estimated elevation or vegetation sample → `usedEstimatedData: true`, surfaced in the UI. Missing vegetation data is assumed `mediumscrub` **and flagged estimated** — never silently optimistic.
- **Lifecycle:** result is a dashed map preview + original-vs-optimized stats (length, max slope, steep metres, heavy-timber metres, trail reused, effort score). Apply = replace drawn line and re-run the full analysis pipeline; Dismiss = discard. Since 2026-07-12, **Apply shows whenever the optimized coordinates genuinely differ from the original line**, not gated on a minimum improvement percentage — it used to hide behind an `improvement > 1%` threshold, which meant a result within ~1% of the original (or one the user still preferred over their own line) offered no way to accept it; it now hides only in the true fallback case where the search failed and the "optimized" line is just the original re-sampled.
- **Auto-run on draw (2026-07-12, WP5):** `App.tsx` starts an optimize automatically ~800 ms after the user finishes drawing a line ≥120 m (the optimizer's own minimum), aborting any in-flight run first. A suppress-ref guards the loop that would otherwise fire when the user applies an optimized result (apply replaces the line → same draw-change path → would re-trigger auto-optimize → apply again). The manual "Find smarter path" button remains as the retry path; a **Cancel** button is visible for the duration of an auto- or manual run.

### Corridor scan visualization ("watch it happen", not decoration)
The scan is now a genuinely staged visualization rather than an end-of-run reveal (2026-07-12, issue #165 WP2/WP3/WP4):

- **Streamed scan events (WP2):** `optimizeRoute`'s `onScanEvent` callback emits, for the wide pass only, `grid` (uncoloured hex outlines as the shared grid's leg-slice is filtered), `cells` (real cost-normalised colours once elevation/vegetation sampling resolves — computed *before* the search starts, so colouring always precedes pathfinding), and `search` (the live Dijkstra frontier's current best-guess path, emitted every ~40 node-pops) events. `MapboxMapView.tsx` renders these on their own `hex-scan` source — unrevealed cells sit at a neutral grey, revealed ones pick up the same green→amber→red gradient the final heatmap uses — plus a `scan-frontier` line for the crawling best-guess path. This is a separate source from the final `hex-heatmap`, which only appears once the whole result lands; the parent clears the streamed state at that point.
- **Progress-synced sweep (WP3):** the translucent band + bright leading edge that sweeps the drawn line's bounding envelope is now **one-directional** and eases toward the real `optimizerProgress` fraction every frame (`scanEasedTRef`, `progress += (target - progress) * 0.08`) instead of ping-ponging on a fixed 2.6 s clock — the sweep's position now means something. Skipped outright under `prefers-reduced-motion` (the heatmap still appears, just without the animated build-up).
- **Plain-English progress (WP4):** `AdvisorPanel.tsx`'s `phaseMessage()` replaced "Pass 1 of 3 — wide corridor scan" with phase-aware, jargon-free copy ("Laying out a survey grid over your corridor…", "Wide scan — exploring broadly…", "Refining — narrowing in on the best…", "Polishing — fine-tuning…"). The optimizer-card caption no longer name-drops Uber's H3 (the internal hex-tiling approach is unchanged and still documented as such here, for engineers).
- Final result: the wide-pass hex cells double as the on-map heatmap: each cell's cost is the average cost-per-metre over its incident edges (a genuine terrain+vegetation difficulty metric, not a proxy — `edgeCost` = distance × `slopeCost(slope)` × `VEGETATION_COST[fuel]`), rendered with a Mapbox `interpolate` expression (smooth gradient, not discrete buckets) — `hex-heatmap` layer, fading in over ~900 ms. **Fuel weighting (2026-07-13):** `VEGETATION_COST` was raised from `1.0/1.2/1.7/2.6` to `1.0/1.4/2.2/3.8` (grass/light/medium/heavy). The old weights tracked only the machinery end of the production model's inverse-speed effort (machinery `1.0/1.25/1.82/2.86`, hand crew `1.0/1.61/2.63/4.55`); heavy fuel is the primary obstacle a break is cut through, so the new values sit on a machinery↔hand-crew blend. This makes fuel matter more in BOTH the Dijkstra route choice (it works harder to route around heavy timber) and the heatmap colour.
- **Objective vs relative colour scale (2026-07-13):** every cell now carries TWO independent normalisations, computed once and switchable without re-running the search:
  - `costNormalized` — the original per-scan MIN/MAX stretch (0 = easiest cell found in THIS scan, 1 = hardest). Good for comparing paths within one corridor, but on its own a flat heavy-forest cell can render green purely because something steeper happens to sit elsewhere in the same scan — fuel/slope severity isn't comparable across different scans or lines.
  - `costNormalizedObjective` — a FIXED, absolute severity (`objectiveSeverity()` in `routeOptimizer.ts`), independent of anything else in the scan. Vegetation severities (`VEG_SEVERITY`: grass 0, light 0.18, medium 0.38, **heavy 0.55**) and slope severity anchors (0°→0, 10°→0.14, **25°→0.5**, 35°→0.78, **45°→1.0** — the same machinery/hand-crew safety limits `productionModel.ts`'s `DEFAULT_MAX_SLOPE_DEGREES` uses) combine as `max(veg, slope) + 0.3·min(veg, slope)`, a max-based floor so **heavy forest is guaranteed to read at least amber (0.55) and a 45°+ slope is guaranteed red (1.0), regardless of what else is in the scan.** "Objective" here means relative to standard equipment capability, not the specific machines configured in a deployment — a fully equipment-aware heatmap (recolouring for whichever resource is selected) is a larger follow-on, not attempted.
  - A user-facing toggle (`heatmapColorMode`, state in `App.tsx`, control in `AdvisorPanel.tsx`'s corridor-scan legend) switches all three heatmap layers (final result, streamed scan cells, area recon) between the two. **Defaults to `objective`** per field feedback that the old always-relative scale let a flat heavy-timber patch read as "easy" whenever a steeper section happened to be nearby in the same corridor.

### Area recon (`webapp/src/utils/areaScan.ts`, 2026-07-12, issue #165 WP6)
A "draw a box, get the heatmap first" tool, separate from the line-based optimizer: a **Scan area** toggle button in `MapboxMapView.tsx` arms a two-click box tool (first click sets one corner, mousemove previews the rectangle, second click finishes it and fires the scan). `scanArea()` tiles the box with the same hex machinery (`generateBoxHexes` — same axial-range-then-filter approach as the corridor generator, but a plain bbox test instead of a polyline-distance test), samples elevation + vegetation only (no trail lookup, no pathfinding — nothing here claims to find a route), and returns a heatmap in the same shape the optimizer renders. It shares both sample caches with the route optimizer, so scanning a box before drawing a line through it turns that line's search into mostly cache hits. Rendered on its own `area-recon-heatmap` source so it persists independently of any route search (neither clears the other); a status badge shows while scanning, a "Clear scan" button once done.

### Plan Assistant (`webapp/src/utils/planInsights.ts`)
Deterministic rules over the existing analyses (never new data): steep/very-steep runs and heavy-timber pockets located by chainage; estimated-data and low-confidence caveats; crewing strategy from equipment results; optimize nudge; 0–100 difficulty score. Rendered as severity-ranked cards (`AdvisorPanel.tsx`) with locate/optimize actions.

**Recommendation by value, not raw speed (2026-07-13):** the crewing strategy previously recommended the *fastest* compatible resource, which meant an option that was marginally quicker at a large cost premium (e.g. an aircraft beating a dozer by an hour at 10× the price) won by default. `pickByValue()` in `planInsights.ts` now prefers the cheapest option whose time is still within `SPEED_TOLERANCE` (1.5×) of the fastest, falling back to the fastest only when no option carries a cost; when the fastest and best-value picks differ, the card names the faster option and the premium so the planner can make the call. **Composite plan:** a new `composite-plan` insight recommends splitting the job when there's meaningful hard ground — machinery on the workable majority, and aircraft (or, absent aircraft, hand crews) on the very-steep / heavy-timber pockets a dozer can't safely or effectively cut — locating the biggest such pocket by chainage. Triggers when a compatible machine and an air/hand option both exist and steep+heavy ground exceeds ~6% of the line (min 200 m).

### Terrain UI
`ElevationProfile.tsx` (SVG, slope-colored, vegetation band, hover → map marker via chainage) and `SegmentBreakdown.tsx` (joined slope×vegetation slices with chainage, grade, fuel, confidence, estimated flags, locate). `analyzeTrackSlopes` emits a ≤600-point `elevationProfile` for the chart.

### Verification
Two Node smoke scripts (rolldown-bundled, stubbed DEM/vegetation/infrastructure): a 12-check hex-math sanity pass (axial↔local round-trips, 6-neighbour adjacency, corridor coverage) run in isolation before wiring the grid into the optimizer, plus a 58-check main suite covering the optimizer against a synthetic ridge + timber pocket (reduces steep ground and heavy timber, keeps endpoints fixed, preserves honesty flags, heatmap cells are valid normalised/closed polygons with a real gradient, a wide multi-pass search matches-or-beats a narrow single-pass corridor), OSM trail detection/reuse/economics, GIS export/import round-trips, and Plan Assistant insights. Re-run pattern documented in PR #163.

**2026-07-12 (issue #165):** `npm run build` (webapp, strict TS) clean throughout. A standalone esbuild-bundled Node smoke test against the real `hexGrid.ts` (no network dependency, so runnable in any sandbox) added 10 checks: `generateBoxHexes` returns cells within bounds with unique keys (WP6); a shared-grid dedup simulation confirms two overlapping legs' wide-pass slices collapse to one entry per physical cell (WP1's actual fix mechanism, not just code review); axial↔local round-trip and 6-neighbour equidistance (regression guard on existing hex math). Full in-browser pass (auto-run timing, streamed scan visuals, area-recon box interaction) was **not** done this session — no Mapbox token / network egress in the sandbox — flagged as the one thing to confirm live before relying on the UI polish.

---

## Infrastructure-aware cost surface

**Trails + anchors are ✅ built** (July 2026, PR #163):

1. **Existing trails/roads as discounted edges** (`infrastructureService.ts`): one Overpass query per leg's widest corridor bbox (`highway ~ track|path|service|unclassified|road|tertiary|secondary|residential`, `out geom`, 12 s server timeout, bbox-cached), reused across all three passes. Hex cells within **30 m** of a mapped way count as on-trail; edges with both ends on-trail get **×0.35 on the fuel factor** (the ground is already broken; slope still applies). `RouteComparisonStats.existingTrailDistance` reports metres reused; the AdvisorPanel shows an "Existing trail used" before/after row.
2. **Trail source priority (2026-07-16, field-reported CORS fix) — Mapbox tiles → backend proxy → direct Overpass.** A field report from the deployed site showed EVERY Overpass request failing with *"No 'Access-Control-Allow-Origin' header … blocked by CORS"*: the public Overpass instances don't send CORS headers on their error/rate-limited responses (429/504/timeout), so the browser turns every such failure into an opaque CORS error — and because the app leans on Overpass exactly when it's rate-limited, the old client-side multi-endpoint fallback couldn't help (CORS is enforced browser-side regardless of endpoint). Trail lookup now resolves in three tiers, each a fallback for the last:
   1. **Mapbox vector tiles already on the map (primary, `mapboxTrails.ts`).** Mapbox Streets v8 is built from the SAME OSM data Overpass serves, and the map already loads it. We add the `mapbox-streets-v8` vector source with an INVISIBLE query layer (`line-opacity:0`, kept "visible" so its `road` tiles load — `visibility:none` would stop them loading and make `querySourceFeatures` return nothing) and read corridor trails straight from the loaded tiles via `querySourceFeatures` (road `class` ∈ track/path/service/street/street_limited/tertiary/secondary/primary/road, bbox-filtered, dupes across tile edges deduped). This is **zero extra network, no CORS (Mapbox serves its own tiles with the token), and works OFFLINE** once the area's tiles are cached — the field-first win (a crew that panned over the ground before losing reception keeps trail-aware optimization). Registered by `MapboxMapView` as the infrastructure service's `LocalTrailProvider`; consulted before any network call. A returned EMPTY set can't distinguish "no roads" from "tiles not loaded", so empty → fall through to (2).
   2. **Backend Overpass proxy `GET /api/infrastructure`** (`api/src/services/infrastructureService.ts`). Server-side Overpass query — the browser calls this same-origin (no CORS), and one server IP with a shared 10-min in-process cache spends the public 2-slot-per-IP quota once per corridor, not once per user. Validates bbox (≤3°/side), returns `{ trails, available }`, `502`s on total upstream failure, rate-limited under the `infra` tag.
   3. **Direct Overpass** (offline/local-dev deployments without the API): a `404` from the proxy disables it for the session; a `502`/`429` falls through for that call while keeping the proxy primary. Original resilience kept — endpoint list (`overpass-api.de` → `maps.mail.ru` mirror → `overpass.kumi.systems`, overridable via `VITE_OVERPASS_URLS`), 10 s per-attempt timeout, immediate fail-over, sticky to whichever last worked.
3. **Honesty:** failure across ALL three tiers returns `available:false` (never cached) → the result carries `infrastructureAvailable:false` and the UI says trail data was unavailable rather than implying no trails exist. Reused trails are labelled "OSM-mapped — verify trafficability" regardless of which tier supplied them (Mapbox Streets and Overpass share the OSM lineage and staleness caveat).
4. **Anchor insights** (`planInsights.ts`): when either end of a >400 m line terminates in medium scrub or heavy forest, a chainage-located warning explains the outflanking risk and suggests tying into a road, waterway or cleared ground.

**Estimate-honesty gap closed (2026-07-28, docs/CALCULATION_REVIEW.md)**: point 1's `×0.35` discount only ever applied inside the OPTIMIZER's own pathfinding graph — it steered which route got suggested, but was discarded before segments reached `/api/analysis/calculate`, the sole authoritative cost engine. A route that reuses a real formed track (including the app's own optimized suggestion) was costed identically to virgin bush, with the AdvisorPanel's "existing trail used" stat left disconnected from the $ / hours shown next to it. `vegetationAnalysis.ts` now flags each segment (`VegetationSegment.onExistingTrail` → `RouteSegment.onExistingTrail`), surfaced in `AnalysisPanel.tsx` — but deliberately NOT wired into the time/cost number itself, since (unlike this section's own `×0.35`) there is no sourced existing-track-vs-virgin clearing-rate figure to apply.

**Still designed (📋):** water fill points and cadastre boundaries as advisory overlays (NSW DCS Spatial Services — **licensing/attribution check required before shipping**), and waterway/cleared-land anchor *detection* (current anchor rule is fuel-based only; OSM waterways would let the assistant name the feature to tie into).

---

## Road access & approach — 📋 planned ([issue #166](https://github.com/richardthorek/fireBreakCalculator/issues/166), PR B of the operator-briefing plan)

Feeds the SMEACS operator briefing ([AI_ASSISTANT.md](AI_ASSISTANT.md) §5); the briefing consumes this data, it never computes it.

### Suggested entry point (automatic)
`webapp/src/utils/accessRoutingService.ts` (new, mirrors `infrastructureService.ts` patterns — bbox-cached Overpass, graceful `available:false`, never throws):
1. One Overpass query for **drivable public roads** around the plan line (a wider class set than the optimizer's reusable-trail list: include `primary|secondary|tertiary|unclassified|residential|track|service`), bbox = line envelope + ~2 km pad.
2. Nearest-point math (reuse `chainage.ts` projection helpers): for each line end, the closest point on a mapped road + straight-line gap distance. Rank by gap distance and road class; emit a **suggested entry point** `{ coords, roadName?, roadKind, gapM, forLineEnd }`.
3. The gap between road and line start is exactly what the user should ground-truth — surface it verbatim ("entry ~350 m from Falls Rd — verify gate/terrain on approach"). OSM completeness caveat applies; label every output "OSM-mapped — verify locally".

### Approach directions (online-only, indicative)
Mapbox Directions API (same token; **verify token scope covers Directions before building**) from the nearest geocoded locality — or a user-set staging point — to the entry point. Keep only the summary the briefing needs: ordered road names + distances ("Bells Line of Rd → Mount Irvine Rd, ~12 km, last 3 km unsealed *if OSM says so*"). Offline or API failure ⇒ the briefing states directions are unavailable — never a guessed route. This is *approach guidance for a driver*, not routing doctrine; no turn-by-turn replication in the UI beyond the summary lines.

### User-drawn access lines (manual markup)
The user often knows the real gate/track. Add a second drawing role next to the existing plan-line tool:
- `MapboxDraw` feature tagging: `properties.role: 'plan' | 'access'`; a small mode toggle next to the existing Draw button ("Break" / "Access"). Access lines styled distinctly (dashed blue), multiple allowed, deletable individually; **no analysis pipeline runs on them** — they are annotation, not plan geometry.
- Persisted in the share-link payload (`planSharing.ts` v2 field, backward-compatible decode) and exported in every GIS format with `role: access` (`gisExport.ts`), so FireMapper/QGIS shows them.
- Rendered on the static briefing map and listed in the Execution section ("marked access: 2 lines, longest 400 m").

### Verification
Extend the optimizer smoke-suite pattern: synthetic road grid → nearest-entry correctness (right road, right end, gap distance); Overpass-failure honesty (`available:false` ⇒ briefing says unknown, not "no access"); share-link round-trip with access lines; export round-trip preserves `role`.

---

## Terrain Mobility & Counter-Mobility — 🚧 Pass 1 shipped (secondary use case)

**Status:** Passes 1 and 2 of the §15 build plan are built and merged (§16, §17), plus
provider-agnostic imagery interfaces from Pass 4 (§18). Shipped: mover profile
catalogue, directional profile-parameterised cost model, multi-source area-to-area
search (Web Worker), GO/SLOW-GO/NO-GO + isochrone rendering, k-dissimilar routes,
betweenness chokepoints, min-cut barrier siting, tactical UI skin with a full
app-identity swap, and the bonus unit-movement simulation with a real mid-course
replan. In progress (background agents): the rest of Pass 3 (trafficability data
layers) and the rest of Pass 4 (counter-mobility catalogue + delay ledger + UI).
Recorded here rather than in a new doc because it is the same cost surface this doc
already owns, read with a different objective. Roadmap entry: `master_plan.md` Step 10.
**Primary audience:** defence, secure-facility operators, land managers (§7).
**Start with §10 if you only read one part** — vegetation structure/trafficability
fidelity is the constraint everything else depends on.

**The ask.** Instead of "where do I cut a break through this ground", answer two
inverse questions over the same sampled terrain:

- **Mobility** — my people are *in this area* and need to get *to that area*. What
  is the most efficient way through, for a given mover (person on foot, ute,
  truck, tracked plant), including where new trail must be **engineered** to get
  through heavy timber or around steep ground?
- **Counter-mobility** — someone else is *in this area*, wants to reach *that
  area* (or an area I want to keep them out of). Which ways are they likely to
  move, and what engineering or other counter-measures slow them down, for what
  cost?

Both are **area-to-area, not point-to-point** — that constraint drives most of the
design below.

### 1. Why this is a mode, not a fork

The expensive, fragile, hard-won part of this repo is **not** the pathfinding — it
is the sampling substrate: ~10 m DEM batching + cache, NVIS/SVTM area-query
vegetation (one raster + one polygon query per bbox, session-retained), the
three-tier trail lookup (Mapbox tiles → proxy → Overpass), the honesty flags, the
rate limiting, the export pack. **All of that is reused unchanged.** A fork would
re-inherit every upstream break (which has been the majority of the work here) and
fix it twice.

Recommended shape: extract a shared `webapp/src/terrain/` core (grid, sampling,
cost strategies, heatmap normalisation) and sit two feature surfaces on it —
`breakPlanning/` (today's product) and `mobility/`. One app shell, one mode
switch, one data layer. The vocabulary, drawing tools and outputs differ ~80%; the
data plumbing differs ~0%.

**Two things already banked make this feasible at all.** (a) The 2026-07-14
area-query vegetation architecture — per-point sampling at AOI scale would have
been tens of thousands of upstream requests against free government services with
no SLA; one raster + one feature query per bbox scales to an area product, and
session retention makes repeated scenario runs free. (b) `areaScan.ts` is
*already* an area-based scan sharing the optimizer's caches — it is the seed of
this whole mode.

### 2. Cost surface: from "cost to cut" to "cost to move"

`edgeCost()` today prices **clearing**: metres × slope factor × fuel factor, with a
trail discount. Movement is a different function over the same samples, and needs
three structural changes:

1. **Parameterise by mover profile.** `edgeCost` becomes injectable (a cost
   strategy selected per run) rather than one module-level formula. This is the
   single biggest refactor and it is one the *primary* product already wants — the
   "equipment-aware heatmap" follow-on noted above is the same change.
2. **Make it directional (anisotropic).** Clearing cost is symmetric, so the
   current model uses `|slope|`. Movement is not: uphill, downhill and *cross*-slope
   are three different problems, and a vehicle's roll-over limit on side-slope is
   usually stricter than its climb limit. Cost must be evaluated per **directed**
   edge, using slope along the direction of travel plus the cross-slope of the
   cell. (Hex tiling helps here — six equidistant neighbours give less direction
   bias than a square lattice's mixed 4/8 neighbourhood. The existing grid choice
   pays off; residual hex path-length bias is a few percent and `pathRefinement.ts`
   already smooths the geometry.)
3. **Reclassify vegetation from "volume to remove" to "trafficability".** NVIS
   gives *formation*, not stem spacing or understorey density. This is the hardest
   and most consequential data problem in the whole mode — it gets its own
   treatment in **§10 below**, including what today's data can and cannot support,
   whether satellite imagery can resolve trunk-level gaps, and which additional
   datasets buy real fidelity. Anything inferred here is `estimated` and must be
   flagged — same rule as everywhere else.

**Trafficability is not one number.** "Drivable" conflates four things that come
apart badly in practice, and the model must keep them separate (see §10.6):
**passability** (can one vehicle get through at all, creeping, with spotters and a
winch), **pace** (sustainable km/h, which is what sets travel time), **capacity**
(vehicles per hour, and how many passes before the surface fails), and
**reliability** (the same ground wet vs dry, day vs night). A 4 m gap network
through woodland may pass one motorbike easily, one 4WD slowly, and a twenty-vehicle
convoy never.

**Speed, not effort score.** The primary product's output is an effort score and a
production estimate. Mobility's output must be **time**, because delay is the
currency of the whole counter-mobility half. That needs a defensible basis, the
same way `productionModel.ts` is grounded in NWCG 2021 / DELWP 56:

- **On foot:** published terrain-adjusted walking models — Tobler's hiking
  function (naturally asymmetric, fastest at ~−3° downhill) or Naismith +
  Langmuir corrections, with vegetation and load penalties layered on. Dense scrub
  legitimately drops foot movement below 1 km/h; that must be expressible.
- **Vehicles:** a documented surface/class speed table (sealed / formed unsealed /
  4WD track / cross-country by fuel class) with the same "COST_BASIS"-style
  as-of stamping the equipment rates already carry.
- **Calibration path:** compare predicted vs actual travel times against recorded
  agency vehicle/crew GPS tracks. This is the difference between a toy and a tool,
  and it is achievable with data agencies already hold.

**Mover profile catalogue** (mirrors the equipment catalogue's shape — editable,
with a built-in standard set as resilient fallback): max climb gradient, max
side-slope, width, height clearance, turning radius, ground pressure / max soil
wetness class, fording depth, minimum surface class, breach capability (chainsaw?
winch? blade?), endurance/range, night factor. Foot laden/unladen, motorbike,
quad, 4WD ute, 6×6, semi + low-loader, tracked plant, mounted, watercraft on
navigable water, and drone/aerial as a separate class that ignores ground cost but
carries its own limits.

### 3. Area-to-area: the algorithm change that makes it work

The start and finish are **areas**, not points. The correct answer is not to try
point pairs — it is three small, well-understood changes to the existing Dijkstra:

- **Multi-source / multi-target search.** Seed the priority queue with *every* cell
  inside the origin polygon at cost 0 (a virtual super-source); terminate when the
  first cell inside the objective polygon is settled. One pass returns the genuine
  best area→area route, whatever entry/exit it chooses. The existing search already
  connects start/end to *every* hex within reach rather than the nearest — this is
  that idea generalised.
- **Accumulated cost surface (run to exhaustion, no target).** Multi-source
  Dijkstra over the whole AOI produces a **cost-to-reach field** from the origin
  area — render it as **isochrones** ("20 min / 1 hr / 3 hr on foot from here").
  This alone is directly useful to the *existing* fire product: "can plant reach
  that ridge, and how long from the staging area".
- **Route-preference surface.** Run the field twice — once from the origin area,
  once from the objective area — and **sum them**. Every cell's value is then the
  total cost of the best route *through that cell*. Cells within X% of the global
  minimum form the **mobility corridor** — a *band*, not a line. This is the single
  most important analytic for the inverse use case: you never have to guess an
  exact route, you get the whole plausible band with a defensible threshold.

Cross-country vs existing route is then just an edge-class distinction rather than
a separate mode: trail edges are cheap and fast, cross-country edges are slow, and
**"engineer a new trail" edges** carry the *construction* cost from the existing
production model amortised over the movement it enables. That is a genuinely nice
closure — the fire-break estimator becomes the trail-cutting estimator inside the
mobility search, so "cut 400 m of new track here and save 40 min of detour" is
computable with what already exists.

**Ranked, dissimilar routes.** Blocking the best route just pushes traffic to the
second. Get the top *N* genuinely distinct routes by iterative penalty: take the
best path, multiply its cells' costs, re-run, repeat. A ranked route set is the
input to everything in §5.

### 4. Mobility classification & chokepoints

**GO / SLOW-GO / NO-GO per profile.** This is the standard trafficability product
(a combined obstacle overlay), and the app is one step from it: the existing
`objectiveSeverity()` fixed-scale heatmap already renders absolute difficulty
against standard equipment limits. Rebind those anchors to a *mover profile's*
limits and the same three heatmap layers render a mobility classification — green
GO, amber SLOW-GO, grey/red NO-GO — switchable per profile, exportable as polygons
for agency GIS.

**Chokepoints, computed two ways:**

- **Betweenness over the route set** — for each cell, how many of the top-*N*
  dissimilar routes pass through it. High count = the ground everything funnels
  through. Cheap to compute once §3 exists.
- **Minimum cut** — the rigorous version. Treat the AOI as a flow network from
  origin area to objective area, each cell's capacity being how much movement it
  can carry. **The min-cut is literally the cheapest set of places to block.**
  And because the grid is planar, min-cut in the primal is a **shortest path in the
  dual graph** — i.e. *the cheapest barrier is found by the same Dijkstra already
  in the repo, run on a rotated cost space.*

That last point is the conceptual centre of this whole idea, and worth stating
plainly: **a fire break and a counter-mobility barrier are the same object** — a
line driven across country to sever a plane. One severs the passage of fire, the
other the passage of vehicles. This app already prices exactly that line. The
counter-mobility planner *is* the fire break calculator with a different
resistance layer and an inverted objective.

### 5. Counter-mobility: measures, delay, and the honesty rule

**The metric is delay per dollar, not "blocked".** Nothing is impassable; obstacles
impose time. So every measure set is scored by re-running the search:

- `T₀` = best route time for profile P, origin area → objective area, today.
- `T₁` = the same search with the measure set applied to the cost surface.
- **Delay imposed = T₁ − T₀**; **cost to impose** comes from the existing
  equipment/production engine (dozer hours, crew hours, AUD, machine availability).
- Rank packages by **minutes of delay per machine-hour / per dollar**. Deterministic,
  reproducible, and it fits the "engine computes, AI narrates" principle exactly.

**Breach time is a matrix, not a property.** An obstacle's effect depends entirely
on who meets it and what they carry: a felled-tree abatis costs a 4WD crew with a
chainsaw ~20 minutes and a low-loader "not today". So the model is
`obstacle type × mover profile × breach capability → delay minutes + turn-back
likelihood`. **This table is the project's main integrity risk** — invented numbers
here would produce confident, fabricated operational output, which is exactly what
the repo's first principle forbids. It must be either sourced and cited (engineering
doctrine, agency track-closure practice) or presented as **user-entered planning
assumptions**, visibly flagged, with the ledger showing which values are defaults.

**The bypass rule (non-negotiable).** A single obstacle's delay figure in isolation
is misleading, because the honest answer is usually "they drive around it". The app
must never show a measure's delay without re-running the search and reporting the
**bypass it creates**: *"this block adds 12 min; the bypass it opens costs them
4 min."* Measures are only ever assessed as **sets, in depth**, and a set whose
bypass is cheap must be labelled ineffective rather than quietly scored well.

**Counter-measure catalogue, by mechanism.** Each entry carries: geometry (point /
line / area), which profile classes it actually stops, delay + breach method,
resources and time to emplace (priced by the existing engine), reversibility, and
legal/environmental prerequisites.

- **Obstruct a defined route.** Abatis — interlocked felled timber across the
  track, butts toward the approach, high stumps so it can't be shouldered aside,
  several in depth. *The app can site these:* trail segments with heavy forest
  within ~15 m on **both** sides **and** side-slope above ~15° on both flanks are
  non-bypassable abatis candidates, and every one of those inputs is already
  sampled. Also: anti-vehicle ditches and craters cut wide enough that momentum
  can't cross, spoil on the far side; log cribs and tank traps; concrete Jersey/F-type
  barriers, gabions, filled shipping containers; pipe bollards set in concrete;
  buried rail; cable or chain at axle height on deadman anchors; immobilised
  vehicles or farm plant as hulks — noting that a hulk not chained to an anchor,
  with wheels on and an accessible engine bay, is a ten-minute winch job, so the
  measure's *effectiveness* is in the detail, not the object.
- **Remove the route instead of blocking it** — usually cheaper and far more
  durable. Culvert removal, bridge deck removal, cattle-grid removal, and
  **ripping/cross-draining the road surface**. This is what land managers actually
  do to close illegal tracks, it doubles as erosion control, and it is the
  legitimate headline application of the whole counter-mobility half.
- **Deny by terrain modification** — rip, scarify, windrow, mound, contour-bank;
  or hydrological: pond water behind a blocked culvert, divert a channel, saturate
  a flat, turning a dry-season GO into a wet NO-GO. (Environmental and legal flags
  here are severe and must be surfaced hard, not footnoted.)
- **Regenerative denial** — let or help vegetation close the track: brush-matting
  the entry, direct seeding. Slow, cheap, permanent, and the most defensible
  measure available to a land manager.
- **Deter and inform first** — gates, locks, signage, formal closure instruments.
  A locked gate turns away most casual traffic for a fraction of any engineering
  cost, and the ledger should say so by ranking it on delay-per-dollar like
  everything else.
- **Detect and observe** — trail cameras, gate counters, seismic/tripwire sensors,
  drone patrol lines, observation posts. Optimal siting is computable: highest
  betweenness cells, or the cells with maximum cumulative viewshed over the
  corridor band.
- **Channel, don't seal.** The highest-value analytic in the whole mode. Don't try
  to block everything — deliberately leave one route open, easy, and *where you
  want it*, so movement funnels into an observation point, a checkpoint, or a
  single managed access gate. The app can compute this directly: *"measure set C
  makes route 3 dominant; route 3 passes your OP at chainage 2.1 km."* Denial
  becomes control.

**A counterintuitive insight the app is uniquely placed to make:** hazard-reduction
burning *increases* cross-country mobility. A burnt understorey is more trafficable,
not less. Since the tool already models fuel, it should say this plainly when a
planned burn overlaps a corridor someone is trying to deny — nothing else in the
agency toolkit will.

**Safety gate (must ship with the feature, not after).** Every proposed measure is
checked against **your own** egress and emergency access. A barrier that isolates a
block, blocks the only way out of a valley, or sits on a crew's escape route must
be blocked in the UI with an explicit warning — not scored and listed. An abatis is
also a fuel concentration and a hazard in its own right. This is the same class of
property as the existing estimated-data flags: a safety feature, not a nicety.

### 6. "Where will they go" — three tiers of honesty

The inverse question invites exactly the kind of confident fabrication this repo's
first principle exists to prevent. The tiering must be explicit in the product:

- **Tier 1 — deterministic and defensible.** Corridor bands, isochrones,
  GO/SLOW-GO/NO-GO, chokepoint rankings, min-cut barrier sets, delay ledgers.
  All computed from sampled terrain, all reproducible, all stamped with engine
  version and data sources like every other output.
- **Tier 2 — named scenarios with visible assumptions.** Route choice isn't pure
  least-time. Movement that wants to avoid being seen weights **concealment** over
  speed, which means a cost blend of `time + exposure + detection risk`, where
  exposure comes from **viewshed analysis over the DEM already in hand** (cumulative
  visibility from your observation posts, patrol routes, camera positions, or public
  roads). So the product offers a small set of *named* scenarios — "on foot, in a
  hurry", "on foot, avoiding observation", "in a 4WD, night" — and never blends them
  into one answer. The genuinely useful output is the **consensus corridor**: ground
  that lies in the top-*N* band under *every* scenario. Agreement across assumptions
  is where investment is safe; disagreement is where you need eyes, not concrete.
- **Tier 3 — out of scope, by design.** The tool models **terrain, not people**. It
  must not name individuals, ingest personal data, or present any output as
  knowledge of where a specific person is or will be. Terrain analysis dressed as
  intelligence about real people is the failure mode to design out, and stating the
  boundary in the product is what keeps it defensible.

Standing framing on every export and briefing, alongside the existing disclaimer:
authority prerequisites (obstructing a public road, works in a waterway, tree
felling, native vegetation clearing all require authority in Australia), and the
egress check result.

### 7. Audience

**Primary: defence, secure-facility operators, and land managers.** That choice
sharpens several design decisions, so it is recorded here rather than left implicit.

- **Defence.** Terrain appreciation and mobility/counter-mobility planning at the
  scale of an area of operations: which approaches carry which vehicle classes, in
  what numbers, and what engineering effort denies or channels them. The framing
  that matters for this audience is **not "can something get through"** but *"where
  could a hostile force come from **in numbers**, in **which vehicle types**, and how
  fast"* — a throughput and vehicle-class question, not a binary. See §6a.
- **Secure-facility operators** (bases, mines, ports, substations, data centres,
  correctional and critical infrastructure). This audience has a decisive
  advantage the others don't: **the AOI is fixed and small.** You are not solving
  continental coverage, you are solving the 10–30 km around one site, once. That
  makes commissioned lidar, a field validation survey and periodic imagery refresh
  entirely affordable — which converts every estimate in §10 from *inference* to
  *measurement*. For a fixed site, the fidelity problem is a budget line, not a
  research problem, and the product should be built so customer-supplied survey
  data slots straight in as the top tier (§10.5, Tier 4).
- **Land managers** closing illegal 4WD and trail-bike access, denying arson
  ingress on high-risk corridors, and controlling feral-animal and weed vectors.
  Everyday funded work, and the mildest-consequence setting to validate the model in.

Secondary, same machinery: **fire agencies** for the mobility half directly (can
plant reach that ridge, by which route, how long, and what has to be cut to make it
possible — a gap in today's product, not a new use case); **SES/police search and
rescue**, where "how does a person move through terrain" is the core of lost-person
behaviour modelling and reverse isochrones from a last known position are the
standard containment tool; and evacuation/access planning.

### 6a. "In numbers, in what vehicle types" — throughput, not possibility

For the defence and secure-facility audience the useful output is a **capacity**
statement per approach, per vehicle class:

- **Corridor capacity is a min over its links.** The throughput of an approach is
  set by its worst chokepoint — same logic as the min-cut in §4, and computed from
  the same graph. A corridor is characterised as *"passable by ≤2.5 m wheeled, single
  file, ~8 km/h, ~15 veh/h, dry only"*, not as "trafficable".
- **Passes degrade the surface.** Soft ground that takes one vehicle becomes a bog
  after ten. The established framework here is exactly right and citable: **Vehicle
  Cone Index vs Rating Cone Index** (the NATO Reference Mobility Model lineage),
  where **VCI₁ and VCI₅₀** — the soil strength a vehicle needs for *one* pass versus
  *fifty* — is literally the "drivable versus drivable at scale" distinction the
  product needs. Adopt that vocabulary rather than inventing one, and it plugs
  straight into the soil layers in §10.4.
- **Convoy geometry, not just tyre width.** Capacity also needs lane width
  (single-file vs two-abreast), passing/turning/reversing room, recovery space (a
  bogged vehicle in a single-file lane closes the approach, so *recoverability* is a
  capacity property), and bridge/culvert **load** ratings — which OSM tags
  (`maxweight`, `maxheight`, `ford`, `bridge`) partly carry already.
- **This reframes counter-mobility as an achievable engineering objective.**
  Denying a single motorbike to a determined rider is prohibitively expensive.
  Denying *twenty wheeled vehicles arriving inside two hours* is cheap, because you
  only have to break **pace and capacity**, not passability. So measures are scored
  against a **specified threat package** (n vehicles of class X, arriving within T),
  not against "anyone, ever". That is both more tractable and more honest, and it is
  what makes the delay ledger in §5 mean something.

### 8. Architecture delta

| Reused unchanged | New | Changed |
|---|---|---|
| `hexGrid.ts`, `sampleElevationsCached`, `sampleVegetation` + retention, NVIS/SVTM services, `infrastructureService.ts`, `mapboxTrails.ts`, `normalizeHeatmap`, heatmap layers, `gisExport/gisImport`, provenance/honesty plumbing, rate limiting, auth, AI grounding gate | `moverProfiles.ts` (catalogue), `mobilityCost.ts` (directional, profile-parameterised), `accumulatedCost.ts` (multi-source Dijkstra → cost field + isochrones), `corridorAnalysis.ts` (route-preference surface, band extraction, k-dissimilar routes, betweenness), `barrierPlanner.ts` (dual-graph min-cut, measure siting), `counterMeasures.ts` (catalogue + breach/delay matrix), `viewshed.ts` (§47), `oakoc.ts` (§47), `keyTerrain.ts` (§47), `mobilityClass.ts` (§47), `denialLedger.ts` | `edgeCost` → injectable cost strategy; `optimizeRoute` → multi-source/multi-target; **the AOI role gains `observe`** — see the correction below; `areaScan.ts` generalised from box to polygon AOI |

**Correction (2026-08-02, §47).** This table originally said *"MapboxDraw `role` gains
`origin`/`objective`/`deny`/`observe`/`measure`"*. There is no MapboxDraw role concept in the
live code — AOIs are specified with the **paint tool** (`mobilityBoxRole: 'origin' |
'objective'`, painted as real hex dabs by `paintedArea.ts`). So `observe` lands as a **third
paint role**, not a MapboxDraw role. That is also the better outcome: the paint UX already
exists, is mobile-friendly, and an observation post is exactly the kind of thing it already
produces — a place on the ground.

**New data layers required** (and the honest state of each): directional slope and
cross-slope — derivable from the DEM in hand, no new source. Soil and wetness —
the dominant control on real trafficability, and the biggest genuine unknown;
candidates are the CSIRO/TERN Soil and Landscape Grid plus a soil-moisture or
recent-rainfall modifier for a wet/dry season toggle, all needing a licensing and
CORS assessment like every source before it. OSM road *attributes* (surface,
tracktype, 4wd_only, smoothness, barrier=gate/bollard, and especially
bridge/ford/culvert with maxweight/maxheight) — already reachable through the
existing three-tier lookup, just not requested today, and bridges and fords are
the natural chokepoints. National hydrology (BOM Geofabric) for streams as linear
obstacles with discrete crossing points. Cadastre as a fence-line proxy — already
noted above as licensing-pending.

**The performance problem, stated honestly.** The corridor search caps at ~1500
cells; an AOI-wide accumulated-cost surface wants 10k–100k. Three responses:
(a) **multi-resolution** — coarse AOI-wide field, fine re-solve inside the
extracted corridor band, which is the existing three-pass idea applied spatially;
(b) **revisit the Web Worker decision** — it was correctly rejected for the
corridor case because the cost there is network I/O, but exhaustive area search
flips that and makes CPU the bottleneck, so the earlier call needs reversing *for
this mode only*; (c) the area-query vegetation architecture and session retention
already solve the upstream-quota half, which is what makes the rest tractable.

### 9. Staging

| Stage | Scope | Notes |
|---|---|---|
| M1 | Mobility core — mover profiles, directional cost strategy, multi-source area→area search, isochrones | Highest value per effort; immediately useful to the *existing* fire product |
| M2 | Corridor & chokepoint analytics — route-preference surface, k-dissimilar routes, betweenness, GO/SLOW-GO/NO-GO overlay + export | Pure compute on M1; no new data sources |
| M3 | **Trafficability & vegetation structure** — the fidelity problem. Splits into M3a–M3f; see **§10.7** | The real unknown, and the analytical core. NVIS cannot answer trafficability (§10.1); the biggest free wins are time-since-fire, fractional cover and surface-water frequency, *not* computer vision (§10.3c) |
| M4 | Counter-mobility planner — measure catalogue, breach/delay matrix, min-cut siting, delay ledger, bypass rule, egress-safety gate | **Gated on a sourced delay basis** (§5) — without it, output is fabricated |
| M5 | Intent & observation — **split at §47**: **M5a** OCOKA/IPB framing + mobility-class vocabulary migration · **M5b** `viewshed.ts` + Observation and fields of fire · **M5c** key terrain · **M5d** cover & concealment · **M5e** exposure-weighted cost blend, named scenarios, consensus corridors, sensor/OP siting | Tier-2 framing must ship with M5e. **M5e is deferred** — it changes `edgeMobilityCost`'s inputs, and therefore corridors → min-cut → restrictions → delay ledger → every exported number, so it must not ride along with a presentation restructure. M5a–M5d are roadmap rows OCOKA 1/3/4/6/7 |

Two hard dependencies to settle before M4 is worth starting: a citable or
explicitly user-entered basis for breach/delay values, and the CPU/scale work in
§8. The AI layer's role is unchanged throughout — it narrates the ledger and cites
doctrine, it never computes, and the grounding gate applies as-is (a mobility
doctrine knowledge base would need the same manual-transcription treatment the
RFS heavy-plant chunks got).

---

## 10. The fidelity problem: vegetation structure and real trafficability

Blocking a road is easy to reason about and easy to price. **The hard question is
the scrub** — whether 400 m of woodland is a lane a 6×6 drives through at 20 km/h,
a creeping single-file crawl, or a wall; and, on the counter-mobility side, where
a trench or a pushed-up windrow actually has to go. Everything in §§3–6 is only as
good as the answer to that, so this section is the analytical core of the whole
mode.

### 10.1 Why NVIS cannot answer this

NVIS is the right spine for **fuel**, which is why the repo committed to it. It is
the wrong instrument for **trafficability**, for four independent reasons:

1. **Canopy cover ≠ stem spacing.** NVIS describes formation via growth form,
   height and projective-cover class. What stops a wheeled vehicle is *trunk
   spacing at bumper height* and *understorey stem density* — different variables.
   A woodland at 10–30% cover typically has mature stems 8–15 m apart: trivially
   drivable, potentially at speed. This is exactly the case raised — **a woodland
   whose trees are spaced widely enough behaves as grassland for mobility** — and
   the current fuel-oriented mapping (which would call it `mediumscrub` or
   `lightshrub` and slow the route down) gets it precisely backwards.
2. **The inverse case is worse, and it is the dangerous one.** Multi-stemmed and
   thicket formations — mallee, tea-tree/melaleuca, wattle regrowth, lantana,
   blackberry, bracken — can read as low cover while being a solid wall of stems at
   0–2 m. Cover class actively misleads here. A `multiStem` / `thicket` flag per
   NVIS sub-group is cheap and is the single highest-value correction available at
   Tier 0.
3. **NVIS has no concept of condition or disturbance history.** It maps vegetation
   *type*, not *state*. Two stands of identical MVS differ by an order of magnitude
   in stem density depending on time since fire or logging: young regrowth can run
   to many thousands of stems per hectare where the mature stand it will become
   carries a few hundred. **Mature open eucalypt forest is frequently more drivable
   than young regrowth of the same NVIS class.** NVIS cannot see this at all.
4. **Resolution.** The NVIS raster is sampled at roughly 100 m. A 30 m-wide
   drivable lane — which is a highway, operationally — is invisible inside a single
   pixel. Tier 0 is structurally incapable of tactical-scale gap finding, and the
   product must say so rather than rendering a confident colour.

### 10.2 What actually stops a vehicle (the physics to model)

Getting the model right matters more than getting more data, so state the mechanics
explicitly:

- **Gap width versus vehicle width + margin.** Roughly: quad/bike ~1.2 m, 4WD ute
  ~2.0 m, protected/6×6 wheeled ~2.5 m, tracked AFV ~3.0–3.7 m, low-loader ~2.5 m
  plus a much larger *swept path* on turns. Add a real-world margin (mirrors, driver
  skill, night) of ~0.5 m. So the question per stand is: *what fraction of gaps
  exceed the threshold, and do they connect?*
- **Stem diameter sets whether an obstacle can be pushed, not just avoided.** A
  soft-skin 4WD is stopped by anything much over ~100 mm DBH; a tracked dozer or
  AFV flattens stems well above that. **The same stand is NO-GO for one profile and
  SLOW-GO for another**, purely on diameter distribution — so the model needs a stem
  *diameter distribution*, not a stem count.
- **Connectivity, not average density — this is a percolation problem.** Mean
  stems/ha is nearly useless on its own. What matters is whether a connected chain
  of gaps ≥ vehicle width crosses the stand. Two stands at identical density differ
  enormously by spatial pattern, and **clumping helps mobility** (open interstices
  between thickets). So the derived metric should be something like *maximum
  clearance width along the best available channel*, computed from the point
  pattern — not a class average.
- **The 0–3 m stratum dominates and is the hardest to observe.** Understorey, not
  canopy, is what a vehicle hits. Every remote-sensing option below is judged
  primarily on whether it sees this layer.
- **Ground surface and deadfall.** Fallen timber, rock, gullies, termite mounds,
  and — decisively — **soil strength when wet**. Surface roughness and soil moisture
  routinely matter more than vegetation.
- **"Natural roadways" are real and mostly unmapped.** Ridge lines (drier, more
  open, less understorey), grassy flats and floodplain, dry creek beds (open gravel,
  but bank entry/exit and often dense riparian scrub — cuts both ways), salt pans
  (highway dry, deathtrap wet), old logging coupes and snig tracks, powerline and
  pipeline easements, fence lines and firebreaks, stock routes and cattle pads, and
  **fire scars 2–4 years old** where the understorey is down. None of these are in
  OSM, all of them change an answer, and several are detectable (§10.3).
- **Plantations are anisotropic.** Planted rows are freely drivable *along* the row
  and impassable *across* it. Row spacing and bearing are strongly visible in
  imagery (a dominant spatial periodicity), so this is detectable and is a clean
  demonstration of why the cost surface had to become directional (§2).

### 10.3 Option-by-option assessment

#### (a) Current data only — DEM + NVIS/SVTM + OSM

Worth doing first, because a surprising amount is being left on the table:

- **Re-map NVIS onto a structural axis.** Build a *second* curated lookup — NVIS
  MVS → `{ canopy cover class, dominant growth form, expected understorey type,
  multiStem/thicket flag, expected stem density range, expected DBH distribution }`
  — separate from the existing fuel mapping. The mechanism already exists: the app
  has a curated, editable vegetation-mappings store (`/api/vegetation-mappings`,
  `mapFormationToVegetationType`), so this is a new table in a proven pattern, not
  new architecture. NSW SVTM's much finer formations feed the same table at higher
  fidelity where available.
- **DEM derivatives are free fidelity and currently unused.** From the ~10 m DEM
  already in hand: cross-slope (roll-over risk, usually a stricter limit than
  climb), **surface roughness** (standard deviation of elevation residuals — a
  genuine proxy for rock and dissection), **topographic position** (ridge / mid-slope
  / valley floor, which correlates strongly with both understorey density and
  wetness), and **topographic wetness index** (upslope contributing area ÷ slope),
  which flags the flats and drainage lines that go to mud. TWI in particular is
  cheap, needs no new source, and predicts the failure mode that actually strands
  vehicles.
- **Honest ceiling.** This tier supports **strategic and operational** work well —
  which side of the range an approach comes from, corridor bands, chokepoint
  ranking, isochrones at coarse resolution. It **cannot** answer "can a 6×6 cross
  this 300 m of scrub", and must be labelled that way in the UI rather than
  rendering a confident cell colour. Tier 0 alone is a corridor-finding instrument,
  not a trafficability instrument.

#### (b) A second pass over Mapbox satellite imagery — crown-level computer vision

Genuinely feasible in part, and genuinely dangerous in part. Both need stating.

**What is detectable at ~0.5–1 m/px RGB:**

- **Individual tree crowns in open woodland — yes.** Mature eucalypt crowns are
  5–15 m across, so 10–30 px at 0.5 m/px. Standard individual-tree-crown
  delineation (smoothing → local-maxima seeding → watershed segmentation) works on
  this, and open-source pretrained RGB crown detectors exist (DeepForest and
  similar) as a starting point, though **any of them needs Australian fine-tuning —
  they are trained mostly on Northern Hemisphere canopies.**
- **The negative space is the actual product.** Crown polygons invert to a **gap
  network**, and the percolation question in §10.2 is then answered directly by
  connected-component / widest-path analysis on that network. This is the single
  most useful output of the whole imagery pass.
- **Plantation row detection** — dominant periodicity and bearing via a Radon or
  FFT pass per tile. Cheap, robust, and yields anisotropic mobility.
- **Linear-feature detection for "natural roadways"** — old snig tracks, cattle
  pads, cleared lanes, easements, dry creek beds. Ridge/line filters on a
  greenness/brightness channel, cross-checked against the DEM's drainage network.
  High value precisely because none of it is in OSM.
- **Texture classification as a robust fallback tier.** Where resolution won't
  support individual crowns, texture statistics (local variance, edge density,
  co-occurrence contrast/homogeneity) still separate smooth grassland from mottled
  woodland from rough closed forest reliably, and it is far cheaper than ITCD.
  This tier should exist regardless, because it degrades gracefully where ITCD
  simply fails.

**The three hard limits — all of which must be designed for, not footnoted:**

1. **Imagery cannot see the understorey. At all.** Nadir RGB under any canopy tells
   you nothing about the 0–3 m layer that actually stops vehicles. "Open woodland,
   grassy understorey" and "open woodland with a 3 m wattle thicket beneath" are
   near-identical from above. So an imagery-only "drivable" verdict is not merely
   uncertain, it is **biased optimistic**, and in the wrong direction for one of the
   two questions this product answers (see the bias rule below). Crown gaps are also
   a *conservative* proxy for trunk gaps in the opposite sense — crowns touch long
   before trunks do — so closed canopy should resolve to **unknown**, never to
   NO-GO-by-inference or GO-by-inference.
2. **Resolution and vintage are not what you'd hope in remote Australia.** Mapbox
   Satellite is a mosaic whose native resolution varies enormously by region —
   sub-metre over settled areas, far coarser over remote interior and forest, with
   mixed acquisition dates. **This must be probed per AOI, not assumed**: check
   whether the highest zoom actually carries new detail or is an upsample of a
   coarser tile (a high-frequency-energy test on the tile distinguishes them), and
   surface the answer to the user. An AOI served at 10 m cannot support crown
   detection and the product must decline rather than produce shapes.
3. **Licensing is a hard gate, not a formality.** Mapbox Satellite is third-party
   imagery (Maxar and others) sublicensed principally for *display* in Mapbox-rendered
   maps; **extracting derived datasets from it, and especially storing or
   redistributing them, is restricted**, and defence use may fall outside the standard
   terms entirely. This needs a written answer before anything ships — the same
   discipline already applied to the pending water-point/cadastre licensing check.
   Two consequences: the defensible technical posture is **client-side, ephemeral,
   on tiles the user is already viewing, nothing persisted** (which mirrors
   `mapboxTrails.ts` exactly — read what's already loaded — and is also the
   offline-friendliest design); and for **defence customers, expect to need a
   different imagery source with explicit derivative-works rights.**

**Engineering shape.** A 5×5 km AOI at 0.5 m/px is ~10⁸ pixels — this is the
largest single build item in the mode. Run it **client-side, tiled and progressive,
WebGPU/WebGL for the classical filters** (local maxima, texture, Radon are all
shader-friendly), with a small ONNX/TF.js model only where a CNN earns its place.
The app's existing streamed-scan UX ("watch the grid colour in") is an ideal fit,
and results land in the existing session-retention cache so scenario re-runs are
free. Note this reinforces §8's conclusion: CPU becomes the bottleneck in this
mode, so the earlier (correct, for the corridor case) decision to skip a Web Worker
must be reversed here.

**Validation is not optional.** A crown detector shipped without a validation set
produces confident polygons of unknown accuracy — precisely the "fabricated data
presented as real analysis" the project's first principle forbids. Imagery CV is
therefore **gated on having reference truth to calibrate against**, which is where
(c) comes in — lidar and field plots, even if they never ship as production layers,
are required as the calibration set.

**Verdict on (b):** a legitimate *tactical upgrade pass* over a small, chosen AOI —
"is this 400 m crossing actually open, and where is the lane" — layered on top of a
Tier 0/1 base. Not a base layer, not a substitute for structure data, and not
trustworthy for understorey in any canopy.

#### (c) Additional datasets — where the real fidelity is, and most of it is free

The honest headline: **the biggest fidelity gains per unit of effort are not in
computer vision.** They are in three free national layers nobody has wired up yet.

**Highest value, lowest cost — do these before any CV work:**

- **Time since fire.** State fire-history polygons plus national burnt-area
  mapping. Time-since-fire combined with vegetation type is a **far better
  understorey predictor than vegetation type alone**, and it directly resolves both
  cases in §10.1 — the widely-spaced woodland that behaves as grassland, and the
  regrowth thicket that reads as open. Free, national, well-maintained, and the app
  already consumes fire products from the same publishers.
- **Fractional cover (bare / green vegetation / dry vegetation, 25 m Landsat,
  seasonal time series).** Separates green grass from dry grass from bare ground —
  operationally the difference between a highway, a fire risk, and a bog. The
  **seasonal series answers "drivable in February vs August"**, which is a real
  planning question this product currently cannot touch.
- **Surface-water observation frequency (25 m, full Landsat archive).** How often
  each pixel has been *observed as water* over decades. A pixel wet 40% of the time
  is a seasonal trap, and this needs no modelling at all — it is measurement.
  Extremely high value for the wet/dry toggle, and the publisher (Digital Earth
  Australia) is already a trusted source in this repo via the hotspots feed.

**Structure and condition:**

- **Airborne lidar where it exists — the gold standard.** Australia's national
  elevation holdings distribute 1–2 m lidar-derived DEM/DSM and, increasingly, point
  clouds. Two derived products matter enormously: **DSM − DEM = a 1 m canopy height
  model**, on which crown delineation and canopy-gap mapping are far more reliable
  than on RGB; and, where the **point cloud** is available, the **fraction of returns
  in the 0.5–3 m band — which is the understorey density variable directly measured
  rather than inferred.** Nothing else on this list comes close. Coverage is patchy
  (largely coastal, populated and floodplain, driven by flood-mapping programs) and
  vintage varies, so it is an **overlay where available, not a spine** — exactly the
  NVIS-spine + NSW-SVTM-overlay pattern this repo already committed to. Coverage
  extent and acquisition date must both be shown.
- **Spaceborne lidar (GEDI, ICESat-2) as calibration and regional statistics.**
  Sampled transects rather than wall-to-wall, but GEDI in particular provides
  **vertical foliage profiles by height stratum**, including near-ground — which is
  the right variable. Ideal for calibrating and validating imagery-derived models
  and for deriving structure statistics per vegetation class.
- **Wall-to-wall canopy height (10–30 m, satellite + spaceborne-lidar fusion).**
  Better than NVIS cover class, still too coarse for gap finding. Useful as a
  Tier 1 structural prior.
- **Radar (Sentinel-1, 10 m, ~weekly, all-weather/night).** Sensitive to vegetation
  volume and, importantly, to **soil moisture** — so it supplies a *current
  conditions* wetness signal that optical imagery cannot, including through cloud
  and at night.

**Ground and soil — the variable that most often decides the outcome:**

- **National soil grids** (~90 m: clay/sand fractions, bulk density, depth) feeding
  a soil-strength class, and **daily national soil-moisture products** (landscape
  water-balance and soil-moisture prediction systems, ~1 km). Together these
  populate the **RCI side of the VCI/RCI comparison in §6a** — i.e. the one-pass vs
  fifty-pass capacity question — with real, dated, national inputs.
- **Land use (~50 m, national).** Cropping vs modified pasture vs grazed native
  vegetation vs plantation vs conservation. Strong mobility signal, and crop type
  plus season matters: the same paddock is a highway in stubble, a bog under
  irrigation, and a screen under a standing crop.
- **Plantation and forest-estate extent** — flags the anisotropic row structure of
  §10.2 without needing to detect it in imagery.
- **Fences: an acknowledged blind spot with real consequences.** Not systematically
  mapped anywhere. Cadastral boundaries are a proxy (licensing already pending);
  OSM has fragments; imagery sometimes shows the vegetation contrast line rather
  than the fence. **A fence stops a convoy about as effectively as a ditch does, and
  it is invisible in every dataset** — this must be stated as a known limitation, not
  quietly omitted, and it is a prime candidate for customer-supplied data (§10.5
  Tier 4). The same goes for gates, locked infrastructure, culvert load ratings and
  known bog holes.

**Commercial and customer-supplied, for the defence and secure-facility audience:**
high-resolution imagery under licences that *do* grant derivative-works rights;
commissioned lidar over a fixed site's approaches; field validation plots. As noted
in §7, for a **fixed facility this is decisive** — one flight over 300 km² converts
the whole model from inference to measurement, and the architecture should be built
so that data drops in as the authoritative top tier rather than requiring a
different product.

### 10.4 The research question: "do we actually know stem density?"

Stated plainly: **not today, and it cannot be invented.** A stems-per-hectare
number attached to a vegetation class with no source is exactly the failure this
project's first principle exists to prevent. The credible, citable route:

- **Australia has real field-plot data with stem counts, diameters and basal area
  by vegetation type** — national ecological plot networks (rangelands and forest
  plot systems, biomass plot libraries) and state forest inventories. The deliverable
  is a lookup of **stem density, basal area, and stem-diameter distribution per NVIS
  MVS, with sample counts and variance**, so every Tier 0 cell carries a real
  distribution and an honest error bar rather than a single fabricated figure.
- **Basal area is the right summary variable** — it couples stem count and diameter,
  it is the standard forest-inventory measure (so the literature is in those units),
  and it converts directly to "fraction of ground blocked at bumper height".
- **Then derive gap statistics analytically rather than guessing them.** For a stand
  of density λ with a known diameter distribution, the nearest-neighbour and
  free-path distributions follow from a spatial point process, so *"expected fraction
  of straight 50 m crossings with clearance ≥ 2.5 m"* is computable from λ and DBH
  under an explicit clustering assumption — and that assumption is then **testable
  against lidar-derived stem maps**. This gives Tier 0 a physically meaningful,
  falsifiable trafficability estimate instead of a hand-assigned class, and it makes
  the uncertainty explicit.

This is a genuine, bounded research task with a citable output, and it is the thing
that makes everything above defensible. It should be scheduled *before* the imagery
CV work, not after.

### 10.5 The trafficability stack (recommended architecture)

Layered tiers with explicit confidence, mirroring the NVIS-spine + overlay pattern
already committed to:

| Tier | Source | Resolution | Sees understorey? | Confidence | Role |
|---|---|---|---|---|---|
| **0** | NVIS MVS → new structural mapping; NSW SVTM where available; DEM derivatives (cross-slope, roughness, topographic position, TWI); OSM/Mapbox roads | ~100 m | No (inferred) | Low | Always-available base. Corridor bands, strategic approaches. **Not** tactical. |
| **1** | Time since fire; fractional cover (seasonal); surface-water frequency; land use; plantation extent; soil grids + soil moisture; Sentinel-1; wall-to-wall canopy height | 10–90 m | Partly (inferred, much better) | Medium | **Where most of the win is, and it's free.** Do this first. |
| **2** | Airborne lidar: DSM−DEM canopy height model; point-cloud 0.5–3 m return fraction | 1 m | **Yes, measured** | High | Overlay where coverage and vintage permit. Also the calibration set for Tier 3. |
| **3** | Imagery CV on demand: crown delineation → gap network percolation; plantation rows; linear features; texture fallback | 0.5–1 m | **No** | Medium for openness, **none for understorey** | Tactical upgrade pass over a chosen crossing. Never the base layer. |
| **4** | Customer-supplied: commissioned lidar, field plots, fence/gate/culvert/bog-hole GIS, historical vehicle track logs | site-specific | Yes | Authoritative | For a fixed facility, this is the answer. |

**Two properties this stack must carry end to end:**

1. **Every cell reports which tier answered it, its confidence, and its data
   vintage** — a direct extension of the existing `estimated` / `usedFallbackData`
   flags, and the same safety property. A 2012 lidar tile over ground that burnt in
   2019 must not silently outrank a current coarse layer.
2. **Bias direction follows the question being asked.** For **own-movement**
   planning, round **pessimistic** — an optimistic error strands your own vehicles.
   For **adversary-mobility** assessment, round **optimistic** — assume they get
   through, because a pessimistic error under-rates the threat and leaves an approach
   unguarded. **Same data, opposite rounding, and the app knows which question the
   user asked.** This is a first-class model feature, not a UI nicety, and it is the
   honest way to handle §10.3(b)'s optimistic bias rather than pretending it away.

### 10.6 What better structure data buys the counter-mobility side

Worth making explicit, because it is not obvious and it doubles the return on all
of the above: **a stand's stem density is simultaneously the obstacle and the
construction material.**

- **Pushed-up windrows.** Scrub pushed into a windrow is a genuine wheeled-vehicle
  stopper and a minor tracked-vehicle inconvenience, and its effectiveness is a
  function of height, width and butt-diameter mix. The volume of material available
  comes straight from the stand's biomass/basal area — so **the same structure layer
  that tells you what you can drive through tells you how much obstacle you can
  build from it, and how many dozer hours it takes**, priced by the production model
  already in the API.
- **Trenches and ditches.** Effectiveness is geometric relative to the target
  vehicle (width against wheelbase or track length, wall angle, depth, spoil on the
  far side); siting is a *terrain* question the app already answers (non-bypassable
  flanks = steep side-slope plus dense stand on both sides, §5). And durability is a
  **soil** question — a ditch in sand self-ramps and collapses, so the soil layer
  from §10.3(c) serves both sides of the model too.
- **The abatis siting rule in §5 becomes computable properly** once stem diameter is
  available: an abatis needs stems of usable diameter *adjacent to* the track, which
  is a structure query, not a fuel query.
- **And the fire insight from §5 sharpens:** a recently burnt stand is both more
  trafficable *and* has less material available to build obstacles from — the worst
  of both, and something no other tool in the toolkit will tell a planner.

### 10.7 Revised sequencing consequence

M3 in §9 was written as one "trafficability data uplift" stage. It splits, and the
order matters — cheapest and most defensible first:

- **M3a — Tier 0 done properly.** Structural NVIS mapping table (with the
  multi-stem/thicket flag) + DEM derivatives (cross-slope, roughness, topographic
  position, TWI). No new external sources, no licensing, immediate improvement.
- **M3b — the stem-density research task (§10.4).** Field-plot-derived density /
  basal area / diameter distributions per MVS with variance, plus the analytic
  gap-width derivation. Gates the honesty of everything downstream.
- **M3c — Tier 1 free national layers.** Time since fire, fractional cover,
  surface-water frequency, land use, soil + soil moisture, Sentinel-1. **Biggest
  fidelity gain per unit effort in the entire mode.** Each needs the standard
  endpoint/CORS/licensing assessment this repo applies to every source.
- **M3d — Tier 2 lidar overlay** where coverage exists, including the canopy height
  model and (where point clouds are published) the 0.5–3 m understorey return
  fraction. Also stands up the calibration set.
- **M3e — Tier 3 imagery CV**, gated on: the Mapbox derivative-works licensing
  answer, the per-AOI resolution probe, and the M3d calibration set. Texture tier
  first (robust, cheap), crown delineation + gap percolation second, plantation-row
  and linear-feature detection alongside.
- **M3f — Tier 4 customer data ingest**, which for the secure-facility audience may
  well be worth pulling *earlier* than M3c–M3e, since it makes them unnecessary
  for that customer.

---

## 11. Research basis — every movement assumption, sourced

Nothing in §§2–6 may ship on an invented constant. This section is the register of
what the literature and doctrine actually support, **including the published
limitations of each source** — the limitations matter as much as the values, because
a defence audience will probe them and a stated caveat is what makes the rest
credible.

### 11.1 Movement on foot — the individual

| Model | Form / values | Source | Stated limitation |
|---|---|---|---|
| **Tobler's hiking function** | `v (km/h) = 6 · exp(−3.5 · |s + 0.05|)`, where `s` = dh/dx. Peak ~5.04 km/h at **−2.86°** (−5% grade), i.e. genuinely asymmetric — gentle downhill is faster than flat | Tobler 1993 | On-path, unladen, empirically fitted rather than experimentally derived; **no vegetation term at all**. Use as the slope-anisotropy shape, not as an absolute speed |
| **Irmischer & Clarke terrain-adjusted speed** | `v (m/s) = 0.11 + exp(−(100s + 2)² / 1800)`. Published as **four functions** — male/female × **on-path/off-path** | Irmischer & Clarke 2018, measured from US Military Academy cadets navigating hilly, wooded terrain on foot | Young, fit, single-cohort, specific terrain. **But it is the only widely-used slope-speed function calibrated off-path with a military cohort** — which is precisely our case, so it should be the primary individual-movement model, with Tobler as the cross-check |
| **Márquez-Pérez modified Tobler** | Double-exponential, same three parameters (max speed, rate of change with slope, slope of max speed); the most slope-selective of the common functions | Márquez-Pérez, Vallejo-Villalta & Álvarez-Francoso 2017 | Favours gentler routes, producing longer-but-easier paths. Useful as a selectable "prefers easy ground" variant rather than a default |
| **Load-carriage energetics** | Pandolf equation (1977) with Soule & Goldman (1972) terrain coefficients — body mass, load mass, velocity, grade, terrain factor | US Army ARIEM | **Published error 12–33%**, best (12–17%) at 4.5–5.5 km/h, and it **under-predicts contemporary military load carriage**. Therefore: use for *endurance limits and relative comparison between routes*, never as an absolute energy or fatigue claim, and label it as such |

### 11.2 Movement on foot — the unit (different model, deliberately)

Doctrinal march rates are not individual speeds; they include column effects, halts,
and planning conservatism. **They are the correct basis for "a unit on foot", where
Tobler/Irmischer are correct for one person** — so the product must carry both and
say which it is using.

| Condition | Rate | Source |
|---|---|---|
| Roads, day | **4.0 km/h** | US Army foot-march doctrine (FM 21-18, superseded by ATP 3-21.18) |
| Roads, limited visibility | **3.2 km/h** | " |
| Cross-country, day | **2.4–2.6 km/h** | " |
| Cross-country, night | **1.6 km/h** | " |
| Sustained daily distance | **20–32 km per 24 h**, on 5–8 h of marching | " |

Two derived factors fall straight out of these and are therefore **doctrinally
anchored rather than invented** — which is exactly what §2 needed: a **cross-country
factor of ~0.6** relative to roads, and a **night factor of ~0.67**. Use these as the
defaults for the profile catalogue's `nightFactor` and cross-country penalty.

### 11.3 Vehicles — terrain classification and soil

- **The doctrinal classification is three-valued and qualitative:** UNRESTRICTED
  (no characteristic significantly impedes movement — may be moderately sloping with
  *widely spaced* trees, and note the doctrine explicitly allows widely-spaced trees
  in the *unrestricted* class, which is the direct doctrinal confirmation of the
  "spaced trees behave as grassland" point in §10.1), RESTRICTED (hinders movement;
  formations cannot move at preferred speed or change formation; for mounted forces,
  steep slopes or *moderate to densely spaced* trees/rocks/buildings), SEVERELY
  RESTRICTED (steep slopes, densely spaced trees or rocks, little or no supporting
  roads). This is the GO/SLOW-GO/NO-GO mapping in §4, and adopting the doctrinal
  three-class vocabulary is free credibility.
- **Slope anchors from the same doctrine:** most vehicles negotiating **≥7%** for any
  significant distance will be slowed, and 7% is treated as an *obstruction*;
  **≥45%** impedes cross-terrain movement. Note how much stricter the 7% figure is
  than the existing fire-oriented model's first breakpoint — the current
  `slopeCost` ramp is calibrated for *machinery working a break*, not for *movement
  at pace*, which is direct evidence for the profile-parameterised cost strategy in §2.
- **Soil strength is the VCI/RCI comparison, and the decision rule is explicit:**
  *if the vehicle cone index exceeds the (rating) cone index for the critical layer,
  the soil is not trafficable for that number of passes.* The worked doctrinal
  example is exactly the demonstration this product needs — a 105 mm howitzer with
  **VCI₁ = 21** and **VCI₅₀ = 49** on fine-grained soil at **RCI 43** is *trafficable
  for one pass* (43 > 21) and, at **RCI 48**, **not trafficable for fifty passes**
  (48 < 49). One vehicle yes, the column no, on the same ground. **That single
  example should be in the demo**, because it makes "drivable ≠ drivable at scale"
  concrete in one slide.
- Published tables also band VCI values against probability of traversing an area.
  **The exact banding must be read off the source table rather than a secondary
  summary** before it is coded — flagged as a verification item, not treated as known.
- Framework lineage: NATO Reference Mobility Model and its NG-NRMM successor. We are
  not rebuilding NRMM; we are using its *indices and vocabulary* so outputs are
  legible to people who already use them.

### 11.4 Vegetation as a vehicle obstacle — two different mechanisms

This is the most important research finding for §10, because it changes the model
shape rather than just supplying a constant:

- **Override force is a real, published model.** The force required to push over a
  vertically embedded obstacle is a function of **stem diameter** and the vehicle's
  **pushbar height**, plus root/soil stability governing mechanical tree stability
  (Mason et al. 2012, developed to support movement-capability determination for
  ground vehicles; validated against a large test programme with tracked and wheeled
  vehicles). Recent robotic off-road work demonstrates controlled override of stems
  up to ~**82 mm** diameter, which is a useful concrete anchor for the small-vehicle
  push-through threshold.
- **And the two vehicle classes are limited by different variables.** The literature
  states it plainly: *small trees can be pushed over by large tracked vehicles
  depending on diameter, while trees large enough to stop wheeled vehicles are
  usually too closely spaced to allow passage.* So:
  - **Wheeled profiles are gap-width-limited** → the binding computation is the
    percolation/widest-channel analysis in §10.2.
  - **Tracked profiles are override-force-limited** → the binding computation is a
    stem-diameter-distribution threshold.
  
  **These are two different queries against the same structure data**, and the model
  must implement both rather than applying one blended "vegetation factor". This is a
  concrete design consequence that would have been missed without the research.

### 11.5 Counter-mobility — use the doctrinal taxonomy, and its caveat

- **Obstacle effects are a closed four-value set: disrupt, turn, fix, block**, and
  **obstacle intent = target + effect + location** (FM 90-7 lineage, current
  ATP 3-90.8 / MCWP 3-17.5). This replaces the ad-hoc vocabulary in §5 — "channel,
  don't seal" is doctrinally **turn**, and every measure in the catalogue should
  declare which of the four effects it is intended to achieve. Standard obstacle
  symbology exists for all four, which the UI should use (§13).
- **The caveat that keeps us honest:** doctrine is explicit that obstacle effects
  arise from **obstacles *and* fires together**, not obstacles alone. This product
  models only the obstacle contribution. Therefore an unobserved, unanswered barrier
  must never be reported as **block** — absent an observation-and-response plan it is
  at best **disrupt**. Encoding that rule prevents the single largest overclaim
  available to this tool, and it is the sort of restraint a professional audience
  reads as competence.
- **Published obstacle geometry** (to be used as *defaults with citation*, and
  overridable): anti-vehicle ditch approximately **4 m wide × 1.5 m deep** for a
  triangular profile, or **4.5–6 m wide × 1.8 m deep** rectangular; hasty crater on
  the order of **1.5 m wide × 2.4 m deep × 6 m long**. Abatis: trees felled with tops
  crisscrossed toward the expected approach, most effective in forest or on narrow
  routes. Road craters are only effective where the flanks tie into steep slopes or
  are otherwise covered — which is precisely the non-bypassability test in §5, and
  the doctrine says so independently.
- **Breach/delay values remain the gap.** The geometry above is sourced; the
  *delay imposed on a given mover with given breaching equipment* is not, in any
  open source we have found. So §5's gating stands: user-entered planning assumptions,
  visibly flagged, until a citable basis exists.

### 11.6 Vegetation structure — the Australian data actually exists

The §10.4 research task is more tractable than it looked:

- **TERN AusPlots** — a standardised continental plot network: **442 one-hectare
  plots** across 22 major vegetation types (savanna, eucalypt woodland, chenopod
  shrubland, grassland), with a 1,010-point point-intercept survey per plot recording
  substrate, species, growth form and height, plus **stand basal area measured by
  basal wedge sweep at nine points per plot**. The data is programmatically
  accessible (the `ausplotsR` package exposes a `basal_area` function). This is
  exactly the citable, variance-bearing basis §10.4 requires.
- **AusPlots Forest Monitoring Network** — **48 one-hectare permanent plots** in
  mature tall eucalypt forest across cool temperate, Mediterranean, subtropical and
  tropical climates.
- **And it quantifies the understorey claim.** In those tall-forest plots, eucalypts
  hold ~90% of above-ground carbon, while **non-eucalypt understorey accounts for
  ~84% of species and ~60% of stems**. A canopy-derived structure estimate is
  therefore missing the majority of the stems — which is the numerical case for why
  imagery crown detection (§10.3b) cannot stand alone, stated in someone else's
  measured data rather than as our assertion.

### 11.7 Confirmed Australian data sources for the trafficability stack

| Source | Confirmed specifics | Tier |
|---|---|---|
| **ELVIS** (Elevation and Depth, ICSM/Geoscience Australia, `elevation.fsdf.org.au`) | Free lidar point clouds + **1 m DEM/DSM**, ~**15 cm vertical / 45 cm horizontal** accuracy, 15 GB per request; coverage concentrated on coastal Australia | 2 |
| **NSW state-forest lidar 2022–23** (via ELVIS/SEED) | Point cloud **and** 1 m DEM over ~**250,000 ha across 27 state forests** in 7 regions (Eden, Batemans Bay, Bulahdelah, Wauchope, Coffs Harbour, Styx River, Casino) | 2 — **and the natural POC area of interest: real, free, current, forested, Australian** |
| **DEA Water Observations from Space** | Per-pixel wet/dry classification at **25 m** (Landsat); annual and all-time **summaries give frequency of wet observations** as clear-wet ÷ clear-total | 1 |
| **DEA Fractional Cover** | Per-pixel **bare soil / photosynthetic vegetation / non-photosynthetic vegetation** percentages at **25 m** | 1 |
| **DEA Land Cover** | Annual national land cover | 1 |
| **NAFI** (North Australian Fire Information, Charles Darwin University, `firenorth.org.au`) | **Fire scar mapping 2000→present** at **250 m** (MODIS-derived), with **20 m HiRes in some regions**; covers NT to 26°S, far-northern WA to 21°S, all Qld to 29°S, northern SA to 29°S (since 2012); **validated by aerial and on-ground transects north of 20°S** | 1 — and **the single most valuable layer for the real theatre**: purpose-built northern-Australia time-since-fire, which §10.3(c) identified as the top free predictor of understorey density |
| **TERN Litchfield Savanna SuperSite** (Litchfield NP, NT, ~80 km south of Darwin, managed by Charles Darwin University) | A **5 × 5 km block of open-forest savanna** with **airborne lidar (ALS, 2013), terrestrial lidar (TLS, 2018) and UAV lidar (2018)**, hyperspectral imagery, SLATS star transects, and measured **tree structure and LAI**; flux tower; data via TERN under its fair-use policy | 2 **and** validation — measured structure *and* measured understorey on representative northern savanna, with no custom acquisition |

Every one of these still needs the standard endpoint/CORS/licensing assessment this
repo applies to any new source before it is wired in.

### 11.8 Mover profile catalogue scope (owner decision, 2026-07-26)

All three families ship, because they serve different conversations. Each profile
carries a per-figure source and confidence, and the UI shows it:

- **Foot, done properly.** Individual movement on the Irmischer & Clarke off-path
  function (primary) with Tobler as cross-check and Márquez-Pérez as the
  "prefers-easy-ground" variant; laden endurance via Pandolf with its published error
  band shown, never as an absolute; **unit** movement on the doctrinal march rates in
  §11.2, clearly labelled as unit-not-individual.
- **AU agency / civilian fleet.** The vehicles the StationKit audience actually
  operates. Specs are largely published by manufacturers and the existing equipment
  catalogue already carries some of them, so confidence is high and this family also
  serves the fire product's access/egress use.
- **ADF-relevant vehicle classes.** Sourced from open material only, and this is the
  one family where **individual figures may not be reliably citable** — so each is
  entered with an explicit confidence and, where a real figure can't be sourced, the
  profile falls back to its **generic width/weight class** rather than a guessed
  number. A generic-class fallback is the honest answer to an unsourceable spec, and
  it keeps the model usable without asserting anything we can't defend.

---

## 12. Imagery: provider-agnostic by construction

**Decision (owner, 2026-07-26): assume imagery licensing is in hand for the POC, and
architect so the provider is swappable.** The licensing analysis in §10.3(b) is not
withdrawn — it becomes a *deployment-time* concern rather than a design blocker, and
the architecture is what makes that switch cheap.

Two interfaces, deliberately narrow:

```
ImageryProvider          →  supplies georeferenced raster tiles for a bbox+zoom
  .describeCoverage(bbox) →  native resolution, acquisition date(s), attribution,
                             licence class, whether derivative analysis is permitted
  .fetchTiles(bbox, zoom) →  tiles, or a "not available at this fidelity" refusal

StructureAnalysisEngine  →  consumes tiles, returns structure observations
  .analyse(tiles, aoi)    →  crown polygons | gap network | row structure |
                             linear features | texture class, each with confidence
                             and the tier/provenance stamp from §10.5
```

Consequences worth stating:

- **`describeCoverage` is a first-class capability, not metadata.** It is what
  implements the §10.3(b) resolution probe and the *"decline rather than produce
  shapes"* rule — an AOI served at 10 m returns a refusal, and the UI says so.
  It also carries the **licence class**, so a provider that forbids derivative
  analysis can be used for *display only* and the analysis engine simply won't run
  against it. The honesty property is enforced by the interface rather than by
  remembering to check.
- **Provider implementations are small and independent:** Mapbox (POC — reads tiles
  already loaded on the map, mirroring `mapboxTrails.ts`, so zero extra network and
  offline-capable), and thereafter any WMTS/XYZ/COG source, a state imagery service,
  a commercial provider with explicit derivative rights, or a customer's own
  offline tile pack. Defence deployments will use the last two.
- **The analysis engine is separately swappable** — classical CV (WebGL/WebGPU
  shaders for local maxima, texture, Radon), a small ONNX model in-browser, or a
  licensed/server-side engine for customers who require it. The "licenced engine
  layer" is therefore a second implementation of one interface, not a rewrite.
- **Nothing persists by default.** Analysis output is session-scoped and lands in
  the existing retention cache; persisting derived structure data is a per-deployment
  switch that a licence review has to turn on. This keeps the POC defensible under
  the most restrictive plausible reading of any imagery licence.

---

## 13. Tactical UI — what actually impresses this audience

Target: an interface that reads as a **professional geospatial intelligence product**
with a genuinely intelligent assistant on top. The blunt version of the advice first,
because it determines everything else:

> **Credibility comes from doctrinal correctness; the visual polish amplifies it.**
> A defence or secure-facility audience recognises MCOO layout, obstacle symbology,
> MGRS and GO/SLOW-GO vocabulary instantly, and recognises their absence just as
> fast. Sci-fi chrome over wrong doctrine reads as amateur; correct doctrine with
> restrained, dense, fast visuals reads as a real capability. Build the doctrine
> layer first, then make it beautiful.

### 13.1 Map surface

- ~~Dark tactical basemap~~ **Superseded 2026-07-26** (owner: "bring back the
  satellite as the default map, seeing the terrain is the key.") The original
  plan below traded real ground imagery for a restrained dark-chrome look —
  the wrong trade for a product whose entire analytical premise is reading
  actual vegetation density, tracks and gaps off the map. Terrain mode now
  defaults to the SAME satellite basemap fire-break mode uses (as-built §27
  area). The panel/badge/log dark theme (everything else in this section) is
  UNAFFECTED — those are separate overlaid DOM elements with their own
  background, not dependent on the basemap being dark. `VITE_MAPBOX_TACTICAL_STYLE`
  remains available as an explicit env override for anyone who wants a
  different tactical-specific basemap later; it is no longer the default.
- **Military map furniture, because its absence is conspicuous:** MGRS grid overlay
  (`gridReference.ts` already exists), grid-square labels, scale bar, north arrow,
  and a live coordinate readout in **MGRS + lat/long + decimal degrees** under the
  cursor.
- **MCOO as the hero artifact.** GO / SLOW-GO / NO-GO fills per selected profile;
  **mobility corridors as bands**, not lines; **avenues of approach as arrows sized
  by the echelon they support**; numbered chokepoint symbols; the obstacle plan drawn
  in **standard disrupt/turn/fix/block symbology** (§11.5). This one view is the
  screenshot that gets the second meeting.
- **Isochrone rings** with time labels, blooming outward from the origin area on
  first render.
- **Baseline vs after-measures comparison** as a draggable swipe divider on the same
  map, with the **consensus corridor** (§6) as a hatched overlay — agreement across
  scenarios is the most persuasive single graphic in the whole product, because it
  visibly distinguishes "we know" from "we assume".

### 13.2 The analysis feels like reasoning, because it is

The app already streams a staged scan (grid build-out → live colouring → live
pathfinding → progress-synced sweep). That machinery is most of the "Jarvis" effect
already built; it needs an operator-grade re-skin rather than new invention:

- **A running assessment log** in terse operator register, one line per real event:
  `SAMPLING 1,284 CELLS · NVIS MVS 14 · TSF 3 YR · RCI EST 41 (TIER 1) · 2 CHOKEPOINTS RESOLVED`.
  Every line corresponds to a genuine computation — no theatre lines.
- **Phase captions in the same register**, replacing the current plain-English fire
  copy in this mode only.
- **Profile switching recolours the whole surface instantly** from cached samples
  (the retention cache makes this free), which demonstrates the profile-parameterised
  cost model viscerally in about one second of demo time.

### 13.3 The assistant layer — "Cortana", honestly

The existing AI architecture is already the right shape and its constraint is the
feature, not the limitation: **the engine computes, the assistant narrates and
cites, and the grounding gate rejects any numeric claim not traceable to the
payload.** For this mode:

- A persistent **assessment narrative** panel that reads the deterministic outputs
  back as a written appreciation, streamed token-by-token (which is what actually
  sells "intelligence" in a live demo) with **every number click-through to its
  source cell, tier, vintage and citation.**
- Answers questions over the computed surface — *"why does the corridor favour the
  eastern spur?"*, *"what changes if it's been raining for a week?"* — where the
  reply is a re-run plus narration, never a guess.
- **A deliberate "what we don't know" panel.** Counter-intuitive but true: with this
  audience, an explicit uncertainty statement is the strongest credibility move
  available, and it is what earns the next conversation. Show the tier mix, the data
  vintages, the assumed values, and the named blind spots (understorey under canopy,
  fences, breach times).

### 13.4 Data-rich panels

- **Delay ledger** as a dense, sortable table: measure · doctrinal effect · resources ·
  emplacement time · delay imposed · cost · **delay per machine-hour** · residual best
  route · **bypass warning**. Sparklines per row.
- **Corridor capacity card** per approach: profile class, lane width, single-file vs
  two-abreast, veh/h, **VCI₁/VCI₅₀ pass verdict**, wet/dry variance.
- **Data confidence gauge**, always visible: which tier answered what fraction of the
  AOI, and the oldest vintage in the mix.
- **Profile "loadout" rail** — icons plus the handful of specs that drive the model.

### 13.5 Demo discipline

Three rules, learned from how these demos fail: no fabricated numbers anywhere, even
in screenshots (a probed fake number ends the conversation); every headline claim
traceable in two clicks; and one deliberate limitation slide. Everything in §§11–12
exists to make those three rules survivable.

---

## 14. Product gating and pricing

**Assessment: neither raw nor merely hidden. Split the mode in two and gate the
halves differently.**

- **The mobility half ships plainly to the existing StationKit fire audience.**
  Access and egress, "can plant reach that ridge and how long", isochrones from a
  staging area, and where trail has to be cut are *directly* useful fire-agency
  capability and strengthen the core product. No gate, no defence vocabulary — the
  copy stays "access and egress".
- **The counter-mobility half needs a real gate before any wide release**, and the
  proven pattern is here already: server-side entitlement enforced at the endpoint
  (`suiteAuthService` validating a bearer token against Station Manager, the
  `fireBreakEnabled` org entitlement, the saved-plans gate returning 401/403 — a new
  `terrainDenialEnabled` entitlement is a known quantity, not new architecture),
  plus route-level code-splitting so the licensed build is the only bundle that
  contains it. Server gating protects the compute; not shipping the code protects
  the framing.
- **POC exception — owner decision, 2026-07-26.** The demo must run **off the current
  deployed infrastructure**, using **only openly discoverable data**, so for the POC
  the gate is a **subtle UI toggle or a URL query parameter**, not an entitlement.
  Recorded plainly with its residual risk: a client-side flag in a shipped bundle is
  discoverable by anyone who reads the JS, so for the duration of the POC the
  counter-mobility surface should be treated as *effectively public*. Two mitigations
  that cost nothing and should ship with it: keep the standing disclaimer, authority
  prerequisites and egress-safety gate unconditional (they are the substantive
  protection, and they don't depend on the gate), and keep the **fire product's
  default copy free of defence vocabulary** so the public surface reads as access and
  egress regardless of who finds the toggle. **Convert to the real entitlement +
  code-split before any release beyond demo use** — tracked as a Pass 4 exit
  condition in §15.
- **Pricing separation follows the architecture**, which is what makes it credible:
  mobility as an uplift on the existing StationKit tier; counter-mobility licensed
  per site or per seat with support, positioned against the geospatial-intelligence
  tooling this audience already buys rather than against a fire app; and the **data
  uplift as a services line** — commissioned lidar, imagery with derivative rights,
  and a field validation survey. For a fixed facility that services line is both the
  highest-value attach and the thing that converts the whole model from inference to
  measurement (§7), so it is a genuine deliverable rather than a markup.

### 14.1 Feasibility check against the actual current codebase (2026-07-27)

§14's plan ("server-side entitlement + route-level code-splitting, `suiteAuthService`
is a known quantity") was written before any of Passes 1–4 existed. Now that they do,
here is what a real gate concretely requires and what it can and cannot achieve —
assessed, not built, per the backlog item asking for a feasibility check first.

**Finding 1 — the entitlement source of truth is not in this repo.** `fireBreakEnabled`
(the existing precedent) is a field on the JSON `GET /api/auth/me` returns from
**Station Manager** — a separate, sibling repo this codebase calls but does not own
(`api/src/services/suiteAuthService.ts`, `webapp/src/utils/suiteAuth.ts`). A
`terrainDenialEnabled` entitlement would need to be added to Station Manager's own
entitlements schema and org-plan admin UI first. This repo's half is genuinely small
once that exists — `SuiteUser`/`MeResponse` gain one more boolean field, read exactly
like `fireBreakEnabled` is today (a few lines in `suiteAuthService.ts` and
`suiteAuth.ts`) — but **that half cannot ship before the Station Manager change does**,
so "add a real gate" is a cross-repo dependency, not a same-PR task.

**Finding 2 — there is no mobility-specific backend endpoint to gate.** Server-side
entitlement enforcement protects a *server-side computation*. Checking `api/src/functions/`
today: the entire terrain mobility & counter-mobility engine — grid sampling
orchestration, the accumulated-cost search, `corridorField.ts`, `minCutBarrier.ts`,
`delayLedger.ts`, the counter-measure catalogue — runs **client-side**, in-browser, via
a Web Worker (`mobilityWorkerClient.ts`/`mobilityWorker.ts`), calling only the *same*
shared, unauthenticated elevation/vegetation/infrastructure endpoints fire-break mode
already uses. The one mobility-*specific* server endpoint that exists as of this pass —
`POST /api/assistant/mobility-briefing` (§30) — **can** be gated the same way
`planCreate.ts`'s saved-plans gate already is (require a valid bearer token, check
`entitlements.terrainDenialEnabled`, 401/403 otherwise): that part is genuinely the
"known quantity" §14 described. But gating that one endpoint does not protect the
actual analysis — a client can still run the full corridor/min-cut/delay-ledger
computation locally without ever calling it, because none of that logic makes a
network call to anything mobility-specific in the first place.

**Finding 3 — code-splitting raises the bar but is not a hard boundary in a pure SPA.**
Dynamic `import()`-ing the counter-mobility modules (`counterMeasures.ts`,
`delayLedger.ts`, `corridorField.ts`, `minCutBarrier.ts` — ~5,000 lines of
`webapp/src/terrain/*`) behind a runtime entitlement check would stop the code from
sitting in the main bundle everyone downloads, which is a real, worthwhile improvement
over today (currently zero split — anyone who loads the page and finds `?ops=1` gets
the whole engine, as §14 already flags as the accepted POC risk). But the check that
decides whether to fetch that chunk still runs **in the visitor's own browser**: an
entitled user's browser fetches the chunk over plain HTTP, and nothing stops that
response from being saved, and nothing stops a modified client from requesting the
chunk directly regardless of what the UI's own gate decided. Code-splitting protects
against a casual "view page source" discovery; it does not protect against a
motivated one. **The only way to make the counter-mobility logic genuinely
inaccessible to an unentitled party is to run it server-side**, behind the same
entitlement check that already protects saved plans.

**Finding 4 — moving the engine server-side is a real architecture change, not a
gating detail.** The search/corridor/min-cut pipeline runs in a Web Worker specifically
so the iterative propose → assess → revise loop (§28's baseline/scenario toggle) stays
interactive — sub-second, no round trip, works with patchy field connectivity. Moving
it into an Azure Function reintroduces network latency on every "what if I move this
obstacle" iteration and removes the offline-tolerant operation this product's whole
premise (docs' opening line: "must work in the field with poor or no reception")
depends on. That is a genuine, non-trivial trade-off to make deliberately, not a side
effect of "adding a gate" — it would need its own design pass (what stays client-side
for responsiveness vs. what moves server-side for protection; whether a hybrid, e.g.
gating only the counter-measure catalogue/delay-ledger scoring while corridors stay
client-side, is defensible) before implementation, not folded into this assessment.

**Conclusion:** a real entitlement gate is feasible in the narrow sense §14 described
(the `suiteAuthService` pattern genuinely is reusable, and IS now applied to the one
mobility-specific endpoint that exists), but it is **not sufficient on its own** to
protect the counter-mobility IP, because that IP is not behind any server endpoint
today. Recommended sequencing, in order: (1) gate `assistant/mobility-briefing` on
`terrainDenialEnabled` once Station Manager exposes it — cheap, real, and consistent
with the existing pattern; (2) code-split the counter-mobility modules behind the same
entitlement check — cheap, raises the casual-discovery bar, still not a hard boundary;
(3) treat "move the compute server-side" as its own scoped design decision, made
deliberately against the offline/latency trade-off above, only if the business case for
a hard boundary (rather than a raised bar) justifies it. Continuing to ship as a
`?ops=1` POC toggle with the existing residual-risk framing (disclaimer, egress gate
and fire-product-default-copy unconditional regardless of the toggle) remains a
legitimate choice until that business case is made — this assessment does not
recommend building (1)–(3) speculatively ahead of a release decision.

---

## 15. POC build plan — 4 passes, on hold pending "go"

**Owner decisions, 2026-07-26:** build **all** features described above; split into
2–4 major passes; the real area of interest is **most of northern Australia**; the
demo runs on the **best available open data** with **no custom lidar acquisition**;
gate for the POC is a subtle toggle or URL parameter (§14).

### 15.1 Demo AOI: Litchfield National Park / Darwin hinterland, NT

Recommended, and it beats the earlier NSW state-forest suggestion on every criterion
that matters here — most importantly, **it is inside the real theatre rather than a
southern proxy**:

- **Representative of the actual AOI.** Litchfield is high-rainfall, frequently burnt
  **tropical savanna — the dominant ecosystem type across northern Australia** — so
  what the demo shows generalises to the stated theatre instead of arguing by analogy.
- **Measured ground truth already exists, free, no acquisition.** The TERN Litchfield
  Savanna SuperSite is a **5 × 5 km block with airborne, terrestrial *and* UAV lidar,
  hyperspectral imagery, SLATS star transects, and measured tree structure and LAI**
  (§11.7). That means Tier 2 (canopy height model, understorey return fraction) can be
  *demonstrated* rather than described, **and** it doubles as the calibration set the
  imagery CV work is gated on — the single biggest blocker in §10.3(b), solved by site
  selection rather than by budget.
- **It is the ideal ground for the headline insight.** Open-forest savanna with widely
  spaced stems is exactly the "spaced trees behave as grassland for mobility" case
  (§10.1) — the model's most counter-intuitive claim, demonstrable on real terrain.
- **Fire history is free, purpose-built and dramatic.** NAFI covers it with annual
  fire-scar mapping back to 2000, 20 m HiRes in places, validated on the ground north
  of 20°S. In savanna that burns most years, **time-since-fire varies visibly across
  a single AOI**, so the top free predictor of understorey density (§10.3c) produces a
  striking, defensible visual rather than a subtle one.
- **Seasonality is a feature, not a caveat.** Top End wet-versus-dry is the most
  operationally consequential trafficability swing in the country. The wet/dry toggle
  driven by fractional cover, surface-water frequency and soil moisture becomes the
  most compelling single moment in the demo, and it is *true*.
- **Defence relevance is inherent to the geography** and needs no special pleading.

**To confirm in Pass 1** (do not assume): ELVIS lidar/1 m DEM coverage and vintage for
the specific demo box; TERN data-access terms under the fair-use policy for
programmatic use; NAFI service endpoint form and CORS behaviour; NVIS MVS classes
present in the box; and whether Mapbox satellite resolution over the box supports
crown work at all (the §12 `describeCoverage` probe).

### 15.2 The four passes

Each pass is independently demoable — that matters, because it means a funding
conversation can happen after any of them.

| Pass | Theme | Scope | Demo you can give at the end |
|---|---|---|---|
| **1** | **Terrain core + mobility** | Extract shared `terrain/` core from the existing sampling stack; mover profile catalogue (all three families, §11.8); **injectable, directional, profile-parameterised cost strategy** (replacing the single `edgeCost` formula); multi-source area→area search; accumulated cost field → **isochrones**; GO/SLOW-GO/NO-GO per profile; AOI polygon drawing roles; **Web Worker** for the exhaustive search (the §8 reversal); tactical skin v1 — dark theme, MGRS grid + coordinate readout, assessment log; POC toggle/URL gate | *"My people are here. On foot, and in a 4WD, here is how far they get in 30 / 60 / 180 minutes, and here is the best way through."* |
| **2** | **Corridors, capacity, MCOO** | Route-preference surface; k-dissimilar ranked routes; betweenness chokepoints; **dual-graph min-cut → cheapest barrier locations**; corridor capacity card with **VCI₁/VCI₅₀ pass verdict**; avenues of approach sized by echelon; **MCOO overlay + GIS export**; baseline-vs-scenario swipe with **consensus corridor**; assistant narrative wired through the existing grounding gate | *The hero screenshot.* Full MCOO with corridors, chokepoints and capacity per vehicle class — plus *"block these four places and the approach collapses."* |
| **3** | **Trafficability data uplift (the defensibility pass)** | Tier 0 structural NVIS mapping + multi-stem flag + DEM derivatives (cross-slope, roughness, topographic position, TWI); Tier 1 free layers — **NAFI time-since-fire**, fractional cover, surface-water frequency, land use, soil + soil moisture, Sentinel-1; Tier 2 lidar overlay — ELVIS + Litchfield ALS → canopy height model + **understorey return fraction**; the **AusPlots-derived stem density / basal area / diameter table with variance**; tier + confidence + vintage plumbing end to end; **bias-direction switch** | *"Here is why you should believe it"* — the wet/dry swing, the fire-history effect on understorey, and measured lidar understorey density against inferred, with the data-confidence gauge visible throughout. |
| **4** | **Counter-mobility + imagery CV (the differentiators)** | Counter-measure catalogue with **doctrinal disrupt/turn/fix/block effects** and obstacle symbology; **delay ledger + bypass rule + egress-safety gate**; provider-agnostic imagery (§12) with the Mapbox provider and the CV engine — texture tier first, then crown delineation → gap-network percolation, then plantation rows and linear features; "what we don't know" panel; briefing + export pack; **convert the POC toggle to the real entitlement + code-split** | *"And here is what it costs to stop them, what delay it buys, and where they'd go instead."* |

Rationale for that order, since it isn't the obvious one: **Pass 2 already delivers
the analytic core of counter-mobility** (min-cut tells you *where* to block), so the
commercially distinctive story lands early. Pass 4 adds *what to build, what it costs
and what delay it buys* — which is the part that depends on breach/delay values we
cannot yet cite, so it belongs behind the data-credibility pass rather than in front
of it. And imagery CV sits in Pass 4 because Pass 3 is what produces its calibration
set.

### 15.3 Assumptions to confirm at each pass boundary

Listed here so they are settled deliberately rather than discovered late.

**Before Pass 1 starts:**
- The AOI verification list in §15.1.
- Whether the existing `edgeCost` refactor should also be adopted by the fire product
  immediately (it unblocks the equipment-aware heatmap) or kept parallel until proven.
- Foot-profile defaults: confirm the doctrinal cross-country ~0.6 and night ~0.67
  factors are acceptable as shipped defaults (§11.2).

**Before Pass 2:**
- **Echelon sizing for avenues of approach and mobility corridors.** Doctrine sizes
  corridors by the force that can move through them, but the specific width-per-echelon
  figures were **not** obtained in the research above — they must be read off the
  source publication before being coded, or the feature ships as "corridor width" with
  no echelon claim.
- The VCI probability-banding table must be read off the source rather than a
  secondary summary (§11.3).
- Which GIS/export targets the defence audience actually wants (the existing pack is
  fire/agency-oriented).

**Before Pass 3:**
- TERN fair-use terms for programmatic access, and NAFI endpoint/licensing.
- Soil-moisture product choice and its update cadence.
- Whether the AusPlots stem-density derivation is done in-repo or as a one-off
  offline analysis producing a checked-in table with provenance (recommend the
  latter — it's a research artefact, not runtime code).

**Before Pass 4:**
- **The breach/delay basis.** Still the single largest integrity gate. Either a citable
  source is found, or the ledger ships with visibly user-entered planning assumptions.
  This decision cannot be deferred past Pass 4's start.
- Imagery provider and licence class for the demo, and whether any derived structure
  data may be persisted (§12 defaults to no).
- Confirmation that the POC toggle converts to a real entitlement before any
  non-demo release.

### 15.4 Standing constraints for every pass

Non-negotiable, and they are what make the demo survive being probed: no fabricated
numbers anywhere including in screenshots; every headline claim traceable in two
clicks to cell, tier, vintage and citation; the egress-safety gate and authority
prerequisites unconditional; the assistant narrates and cites but never computes; and
one deliberate limitation panel in every demo.

---

## 16. Pass 1 — as-built (2026-07-26)

Shipped: mover profile catalogue and directional cost strategy, multi-source
area-to-area search running in a Web Worker, GO/SLOW-GO/NO-GO + isochrone
rendering, a full tactical UI skin including a complete app-identity swap, and —
added as an owner-requested bonus during the build — an RTS-style unit movement
simulation with a genuine mid-course replan.

### New modules (`webapp/src/terrain/`)

- **`moverProfiles.ts`** — ~18 profiles across all three requested families (foot
  individual/unit, AU agency/civilian fleet, ADF-relevant generic classes), each
  carrying `confidence` (`measured`/`published`/`estimated`/`generic-fallback`) and a
  `source` string. Foot-unit figures are the doctrinal march rates from §11.2
  (4.0/2.4/1.6 km/h, cross-country factor 0.6, night factor 0.67); AU dozer classes
  reuse the exact `maxSlope` values already in `webapp/src/config/standardEquipment.ts`
  so the fire and mobility modes never assert two numbers for the same machine; ADF
  classes are generic width/weight bands per the §11.8 fallback rule, with
  `overrideStemDiameterMm` present only on tracked profiles and absent on wheeled —
  the §11.4 "two different mechanisms" finding encoded directly in the type.
- **`mobilityCost.ts`** — the injectable, directional, profile-parameterised
  replacement for `routeOptimizer.ts`'s fixed `edgeCost` (§2). `signedSlopeDegrees`
  gives climb direction; `irmischerClarkeSpeedKmh`/`toblerSpeedKmh` implement the two
  individual foot models from §11.1; `vehicleGradeSpeedFactor` is an engineering
  interpolation between a profile's doctrinal slope anchors (stated as such, not
  itself a doctrinal figure); `estimateStructureFromVegetation` is an explicitly
  labelled **Tier 0 placeholder** (NVIS-formation-only, per §10.1) pending the Pass 3
  AusPlots-derived table — every result this module produces carries
  `dataTier: 0` and `estimated: true` so nothing downstream can silently treat it as
  measured. `edgeMobilityCost` classifies GO/SLOW-GO/NO-GO with separate gap-width
  (wheeled) and override-force (tracked) checks, per §11.4.
- **`accumulatedCost.ts`** — the area-to-area engine from §3: `runAccumulatedCostSearch`
  is a multi-source Dijkstra (a binary min-heap, self-contained) seeded from every
  cell in the origin AOI at cost 0; `extractPath` backtracks the single cheapest
  origin→objective route from the same predecessor map the isochrone field already
  built — no second search. `classifyCellTerrain` is a separate, direction-agnostic
  terrain-only GO/SLOW-GO/NO-GO classifier (steepest local gradient in any direction),
  kept deliberately distinct from the directional reachability search per the
  worked-example rationale in §3 (a terrain property vs a reachability property).
  Cross-slope gating is **not implemented for the search** in Pass 1 (only for the
  terrain-only overlay) — stated as a scope cut, not silently dropped.
- **`mobilityGrid.ts`** — grid sampling that mirrors `areaScan.ts`'s box-scan pattern
  exactly (same hex machinery, same elevation/vegetation caches — a mobility run
  shares cache hits with any prior fire-break analysis over the same ground) but
  additionally resolves trail proximity per cell, which `areaScan.ts` deliberately
  skips.
- **`mobilityWorker.ts`** / **`mobilityWorkerClient.ts`** — the §8 Web Worker reversal:
  sampling (network I/O) stays on the main thread using the existing caches; the
  search itself (CPU-bound at AOI scale, unlike the corridor case) runs in a worker.
- **`unitSimulation.ts`** — the bonus feature. `positionAtElapsed` interpolates a
  unit's position from the path's real cumulative arrival times (not a distance
  proxy). `UnitSimulationController` drives a `requestAnimationFrame` loop with a
  speed multiplier and, once the unit has covered `replanAtFraction` (default 0.5) of
  the *original* estimated travel time, triggers a **genuine second search** from a
  small AOI box around the unit's current position to the same objective, splicing
  the result onto the already-travelled prefix. The path only ever changes because a
  real recomputation happened — nothing here is scripted or simulated theatre.

### UI

`MobilityPanel.tsx` (profile picker grouped by family with confidence badge +
source citation, origin/objective AOI draw buttons, run/cancel, assessment log,
result stats, GO/SLOW-GO/NO-GO ↔ isochrone toggle, unit-simulation controls, a
standing POC-limitations disclaimer — **the draw/run/cancel controls were later
moved to floating map-overlay buttons, §21, so the scroll panel is options/detail
only**) plus three small tactical-skin components
(`TacticalCoordinateReadout`, `AssessmentLog`, `DataConfidenceBadge`) and
`styles-tactical.css`, built in parallel by a background agent against a fully
specified prop contract while the algorithm core was written — zero merge conflicts,
confirmed by a clean `npm run build` from each side independently before integration.

**Full app-identity swap** (owner follow-up, 2026-07-26): activating the mode swaps
the header title/subtitle/icon (a lucide `Radar` glyph replacing the app logo), the
browser tab title, and the favicon (an inline SVG data URI, no new asset file), and
hides the fire-break-specific Configuration button. Nothing in the active UI reads
"Fire Break Calculator" while the mode is on. Gate remains the POC toggle from §14
(`?ops=1` URL query) — entitlement/backend split is explicitly deferred to Pass 4.

`MapboxMapView.tsx` gained: an origin/objective AOI box-draw tool (clone of the
existing area-recon two-click pattern — **superseded by the painted-area brush
tool, §21**), a `mobility-heatmap` layer switchable between
trafficability colouring and isochrone-band colouring (same cells, two paint
expressions — mirrors the existing `heatmapColorMode` pattern), a persistent
unit-simulation path line, and a pulsing unit marker moved via direct
`mapboxgl.Marker.setLngLat()` per animation frame so 60fps position updates never
touch React state.

### Verification

`npm run build` (webapp, strict TS) clean throughout, including a live-browser check
of every panel/state change (URL gate → mode toggle → full identity swap → tactical
skin → mover-profile catalogue rendering with sourced confidence badges → coordinate
readout → assessment log), driven with Playwright against a real dev server. A
standalone Vite-lib-mode-bundled Node smoke test against the real (not
reimplemented) `terrain/` modules — 29 checks: profile catalogue shape and doctrinal
figures, signed-slope direction, both individual foot speed models' asymmetry,
directional profile-parameterised NO-GO gating (including the wheeled-gap-width vs
tracked-override-force distinction from §11.4, and a genuinely-impassable-for-
everyone case that looked like a bug on first run and turned out to be correct
behaviour against the Tier 0 placeholder numbers), multi-source seeding, path
backtracking, isochrone banding, and time-based simulation interpolation — all pass.

**Known verification gap, stated plainly:** the actual map-canvas interaction (drawing
AOI boxes, running a live search, watching the heatmap/simulation render) could not
be exercised end-to-end in the build sandbox. Root-caused, not just observed: this
sandbox's outbound HTTPS goes through a policy-enforcing relay proxy that only
accepts HTTPS CONNECT tunnels; `curl` respects that transparently, but a
Playwright-launched headless Chromium's own HTTPS-through-proxy path failed against
this specific relay even when explicitly configured with the same proxy (confirmed:
both the Mapbox token and the custom style resolve fine over plain `curl` through the
identical proxy). This is the same class of gap this doc has flagged before when the
sandbox couldn't reach Mapbox — **confirm live** before relying on the map-interaction
UI, same as those earlier entries. **Confirmed NOT host-specific**: the identical
`ERR_CONNECTION_RESET` also hit the real deployed Azure Static Web Apps PR-preview
URL (a genuine public HTTPS site, not localhost) across multiple proxy
configurations, while `curl` against that exact URL succeeded every time — this is a
Chromium-vs-policy-proxy incompatibility in this specific sandbox, not anything
host- or code-specific, and not something further proxy-flag iteration inside this
sandbox is expected to fix.

## 17. Pass 2 — as-built (2026-07-26)

Shipped on top of Pass 1: k-dissimilar routes, betweenness chokepoints, and
min-cut counter-mobility barrier siting — the "hero" analytic from §4 (a fire
break and a movement barrier are the same object).

- **`corridorAnalysis.ts`** — `findKDissimilarPaths` gets up to 3 genuinely
  distinct origin→objective routes via iterative-penalty re-search: extract the
  best path, penalise its edges (accumulating multiplicatively across
  iterations), re-run. `computeChokepoints` is betweenness over that route
  set — cheap, and it's the ground "everything funnels through" per §4.
- **`minCutBarrier.ts`** — the cheapest set of cells severing the origin AOI
  from the objective AOI for a given profile. **Implementation choice,
  documented rather than silently substituted:** this ships via the standard
  max-flow/min-cut equivalence (Edmonds-Karp augmenting paths) rather than
  the elegant planar-dual-shortest-path construction this doc's §4 originally
  described. Implementing that construction correctly for a HEX grid (whose
  dual is a triangular tiling, not the square-grid case most references cover)
  under time pressure was judged a real risk of a subtly wrong answer — exactly
  the "confident but incorrect" failure this project's data-honesty principle
  exists to prevent. Max-flow/min-cut is standard, well-understood, and its
  correctness is checked by construction in the smoke test below. The
  dual-graph form remains a valid future performance optimisation.
  **Capacity model, also stated plainly:** unit capacity per passable edge
  (GO/SLOW-GO only — NO-GO edges carry no traffic and are excluded), tripled
  when both ends are on a mapped trail (real sampled data, not invented).
  This is **not yet** weighted by real vehicle capacity (VCI/RCI, §6a) — that
  needs the soil layers a later pass brings in. Today's min-cut answers "the
  fewest, most trail-favouring chokepoints that fully sever this corridor",
  not yet "the cheapest to physically build".
- `accumulatedCost.ts`'s search gained an `edgePenalties` option (a
  multiplier per directed edge) — the single mechanism both the k-route
  search and the min-cut correctness check are built on.
- UI: chokepoints render as sized/coloured map markers; the barrier plan
  renders as a map line layer; `MobilityPanel.tsx` shows route/chokepoint
  counts and the min-cut result with its capacity-model caveat surfaced, not
  buried, via `DataConfidenceBadge`.

**Verification:** `npm run build` clean. An 8-check standalone Node smoke test
against the real modules, using a synthetic single-cell-gap bottleneck grid:
every found route converges on the gap; the gap is identified as the top
chokepoint; and — the rigorous check — penalising the min-cut's own edges to
near-infinity and re-running the search confirms the objective genuinely
becomes unreachable, proving the returned cut is a real separator, not merely
plausible-looking.

**Not yet done:** the VCI₁/VCI₅₀ corridor-capacity card and full MCOO GIS
export/symbology are deferred, not built with placeholder numbers — the
former needs real soil data (Pass 3), and fabricating a capacity figure
without it would be exactly the kind of invented-precision this project
forbids.

## 18. Pass 4 (partial) — provider-agnostic imagery, as-built (2026-07-26)

`webapp/src/terrain/imagery/`: `ImageryProvider` (bbox+zoom → pixels, with a
mandatory `describeCoverage` step gating resolution/vintage/licence class
before any analysis runs — the §12 "decline rather than produce shapes" rule
enforced by the interface, not by remembering to check), `MapboxImageryProvider`
(reads tiles already loaded on the map, mirroring `mapboxTrails.ts`'s
zero-extra-network pattern; honestly detects a blank canvas capture rather
than claim success — flags that `MapboxMapView.tsx` doesn't yet set
`preserveDrawingBuffer: true`, needed for real pixel capture, as a follow-up
rather than editing that shared file here), and `StructureAnalysisEngine`
(the interface a real engine would implement, plus the only engine actually
shipped: `NotYetImplementedEngine`, which reports its own absence — imagery
CV stays gated on the lidar calibration set §10.3(b) requires).

## 19. Pass 3 — trafficability data layers, as-built (2026-07-26)

"Tier 0 done properly" (§10.7 M3a) plus the free Tier 1 national layers
(M3c) and the DEM derivatives M3a also called for. Built by a background
agent against a fully specified module contract, verified and wired into
the cost model in this pass.

- **`dataLayers/structureTable.ts`** — replaces `mobilityCost.ts`'s
  hand-picked Tier-0 numbers with a small, per-row-cited table, still keyed
  by the 4-class `VegetationType` (not NVIS MVG code — see the file's own
  header for why an MVG-keyed table wasn't attempted this pass: the
  DCCEEW/agriculture.gov.au MVG fact sheets returned HTTP 503 from every
  host tried this sandbox all session, and no citable source resolves to a
  single MVG code anyway). `heavyforest`'s `stemsPerHectare`/`basalAreaM2PerHa`
  are the Wood, Prior, Stephens & Bowman (2015, PLOS ONE) AusPlots Forest
  Monitoring Network's own reported network means (48 one-ha plots,
  confidence `published`); `stemDiameterMedianMm` (610mm) is *derived* from
  those two figures via the standard quadratic-mean-diameter back-calculation
  (`d = sqrt(4·BA/(π·N))`), cross-checked against the paper's own "50–100cm
  DBH" prose description. `mediumscrub` uses a real NSW Government minimum
  stem-retention regulatory floor (150 stems/ha) as an order-of-magnitude
  anchor only (confidence `estimated` — it's a legal floor for an adjacent
  vegetation formation, not a natural mean density for this exact class).
  `lightshrub`/`grassland` are unchanged from the Tier-0 placeholder
  (confidence `generic-fallback`) — no citable figure was found in the time
  available, stated plainly rather than padded. `gapWidthEstimateM` is
  unchanged for every row: deriving it analytically from density+diameter is
  its own bounded research task (§10.4), out of scope for this pass.
  **Wired into `mobilityCost.ts`'s `estimateStructureFromVegetation`** in
  this pass (was previously a standalone module someone else had to swap
  in) — `edgeMobilityCost` now gates wheeled/tracked passability against
  these real cited numbers instead of an uncited guess, and continues
  reporting `estimated: true`/`dataTier: 0` (applying a class-level figure
  to one cell is still an estimate regardless of how well the class-level
  figure is cited — the tier does not bump; only M3d's measured lidar
  understorey fraction is the actual tier bump).
- **`dataLayers/demDerivatives.ts`** — local least-squares plane fit per
  cell for cross-slope/roughness/topographic position, plus a real
  multiple-flow-direction topographic wetness index (TWI) accumulation —
  not yet wired into the search (cross-slope gating for the search itself
  remains a stated Pass 1 scope cut, §16), available for a future pass.
- **`dataLayers/nafiFireHistoryService.ts`** — North Australia & Rangelands
  Fire Information time-since-fire, queried live against
  `firenorth.org.au`'s GeoServer WMS (confirmed reachable this session,
  unlike the .gov.au hosts). Two precomputed rasters
  (`tslb_last10_250m`/`tslb_longterm_250m`) queried via `GetFeatureInfo`,
  cross-checked against six annual fire-scar layers at a live test point.
  Confidence is `published` inside a coarse single-latitude approximation of
  §11.7's ground-validated coverage band, `estimated` south of it but still
  inside the layer's technical extent. The no-fire/NoData sentinel encoding
  was **not** observed live this session (only a positive hit was tested) —
  stated as an open item, not guessed at: any implausible value is treated
  as "no answer", never silently as "never burnt".
- **`dataLayers/deaOwsClient.ts`** (shared client) +
  **`deaWaterObservationsService.ts`** / **`deaFractionalCoverService.ts`** —
  Digital Earth Australia's `datacube-ows` WMS instance, live-verified this
  session: current Collection-3 products only (`ga_ls_wo_fq_myear_3`,
  `ga_ls_fc_pc_cyear_3`), deliberately excluding several older layers on the
  same server explicitly titled "...(Landsat, DEPRECATED)" in their own
  capabilities document. `EPSG:4326` in WMS 1.3.0's (lat, lon) axis order
  (this instance rejects `CRS:84`, confirmed live via a real
  `ServiceException`). Masked/invalid pixels return the literal string
  `"n/a"` for every band (observed live over open water) — every band read
  is type-guarded rather than assumed numeric.
- **Not yet wired into `mobilityGrid.ts`'s per-cell sampling** — these three
  Tier 1 layers are built and verified standalone but the grid builder does
  not yet call them per sampled point (a real next step, not silently
  dropped: NAFI's point-query form would need an area/tile variant — see
  its own file header — before per-cell calls at grid scale are practical
  without overwhelming the upstream API, the same "one area request, not one
  per point" discipline `mobilityGrid.ts` already follows for vegetation).

**Verification:** `npm run tsc --noEmit` and `npm run build` clean across
the whole module set including the four new data-layer files. The
structure-table wiring was additionally checked with a standalone Node
smoke test against the real (not reimplemented) modules: confirms
`estimateStructureFromVegetation('heavyforest')` now returns the derived
610mm figure (not the old 350mm placeholder) and that a heavy dozer is
correctly still NO-GO off-trail through heavyforest under the new number
(610mm exceeds the dozer's 300mm override capability) — the same
genuinely-impassable result as Pass 1, now resting on a cited figure
instead of a guess.

## 20. Pass 4 — counter-mobility catalogue, delay ledger and UI wired in (2026-07-26)

Completes the Pass 4 counter-mobility work §18 left partial (imagery
interfaces only). Built by a background agent against a fully specified
prop/module contract, wired into `App.tsx` in this pass.

- **`counterMeasures.ts`** — 12-entry catalogue (abatis, anti-vehicle ditch,
  road crater, log crib/tank trap, concrete barriers, immobilised-vehicle
  hulk, culvert/bridge/cattle-grid removal, terrain ripping, locked
  gate+signage, sensor/observation post), each with an `ObstacleEffect`
  (`disrupt`/`turn`/`fix`/`block`), a relative emplacement-effort figure,
  reversibility, legal prerequisites and a `DataConfidenceBadge` tier.
  **Zero entries are rated `block`** — deliberate doctrinal restraint per
  §11.5's own caveat that obstacle effects arise from obstacles *and*
  observation/fires together, never an unobserved obstacle alone.
- **`delayLedger.ts`** — `computeDelayLedger` scores a set of proposed
  placements against the same `runAccumulatedCostSearch` engine the rest of
  the mode uses: T0 (baseline best time) vs T1 (best time with the measure's
  own large edge-penalty applied), **the bypass rule** (a separately
  computed, smaller-penalty alternate-route search — the mandatory
  "never show a measure's delay in isolation" rule from §5), and **the
  egress-safety gate** (reuses the exhaustive reachability field already
  computed for T1 to check the origin AOI can still reach ground outside
  the measure's own footprint — a real computed refusal, never a hardcoded
  `true`).
- **`CounterMobilityPanel.tsx`** — candidate segment picker (seeded from
  `MinCutResult.segments`, the same min-cut siting hint §17 already
  computes — this panel does not resite anything itself), the full measure
  catalogue with effect/confidence/effort/legal-prerequisite detail, a
  delay-ledger table ranked by delay-per-effort-unit, and **the egress
  refusal rendered as a hard UI refusal banner replacing the "add to plan"
  action entirely** — not a warning icon, per §5/§15.4's unconditional
  framing.
- **Wired into `App.tsx` in this pass**: a two-tab switcher ("Terrain
  appreciation" / "Counter-mobility planner") inside the Terrain-mode
  analysis panel. The planner reuses the **exact sampled grid** the last
  appreciation run produced (`MobilityAppreciationResult` was extended to
  carry `cells`/`originKeys`/`objectiveKeys` alongside its existing
  `barrier` result) rather than resampling — the min-cut segments'
  cell keys must refer to the same grid the ledger searches over. A fresh
  appreciation run clears any pending segment selection/placements/ledger,
  since they'd otherwise silently reference cells from a stale grid.

**Verification:** `npm run tsc --noEmit` and `npm run build` clean. A
standalone Node smoke test against the real modules builds a synthetic
corridor grid, sites one measure across it, and confirms
`computeDelayLedger` returns a real (non-fabricated) delay/bypass/egress
result — `egressSafe` a genuine computed boolean, `bypassDelaySeconds`
never a fabricated negative.

## 21. Field feedback round — bug fixes, mobile UX, painted-area AOI selection (2026-07-26)

Three issues reported from real device testing of the live PR preview,
addressed in this pass.

**Bug 1 — drawing an AOI triggered the fire-break line analysis.**
Root cause: `MapboxDraw` was initialised with `defaultMode: 'draw_line_string'`
unconditionally, so it was *always* armed to interpret map clicks as
fire-break line vertices regardless of which other tool (the AOI tool) was
supposedly active. Fix: `MapboxMapView.tsx` now initialises MapboxDraw with
`defaultMode: 'simple_select'` and hides its pencil/trash controls whenever
`tacticalMode` is on — Terrain mode and fire-break mode no longer compete
for the same click stream.

**Bug 2 — the objective-area tool stopped accepting clicks after the
origin tool had been used.** Root cause: the (now superseded) two-click
box tool's "first corner" ref was never reset when the armed role changed,
so switching from origin to objective left a stale first-corner from the
*previous* attempt, corrupting the next click. Fix (carried forward into
the paint tool below): the relevant ref is explicitly reset in the
role-change effect, not left to accumulate stale state across role
switches.

**Mobile UX — primary controls moved off the scroll panel.** Owner
feedback: "on mobile I had to scroll to find buttons... the scroll panel
should only need to be expanded to change options or find detail."
`MapboxMapView.tsx` gained a `.mobility-overlay-controls` floating button
stack (top-left, absolute-positioned, matching the existing fire-break
mode's own "Scan area" button placement so both modes share one map-overlay
language): paint-origin/paint-objective toggle buttons showing live dab
counts, a brush-size row, and run/cancel — all reachable without touching
the panel. `MobilityPanel.tsx`/`CounterMobilityPanel.tsx` now hold options
and result detail only.

**Painted-area AOI selection, replacing the two-click box tool.** Owner
feedback: "selecting the origin and destination areas should be like
colouring in cells on the map rather than drawing a line, with options for
size of brush that remain consistent as I zoom in and out." New module
**`paintedArea.ts`**: a painted area is the union of circular "dabs" laid
down while dragging over the map. Each dab's *on-screen* radius is one of
three fixed pixel sizes (`BRUSH_PIXEL_RADIUS`: 18/34/60px), but its *ground*
radius is computed from the map's zoom/latitude at the instant it's
painted via the standard Web Mercator metres-per-pixel relationship
(`metersPerPixel`/`brushRadiusMeters`) — so the same brush paints a bigger
real area zoomed out and a more precise one zoomed in, exactly as asked,
and a painted dab's ground size stays fixed once laid down rather than
resizing as the user continues zooming. `mobilityGrid.ts`, `mobilityAppreciation.ts`
and `unitSimulation.ts` (its mid-course replan AOI) were all rewired from
the old `MobilityAoi {sw, ne}` box type to `PaintedArea`, with cell
membership now a real union-of-circles test (`isInsidePaintedArea`) rather
than a bbox check. `MapboxMapView.tsx`'s click handling was replaced
end-to-end: `mousedown` arms painting and lays the first dab,
throttled-by-pixel-distance `mousemove` lays further dabs while dragging,
`mouseup`/`mouseleave` end the stroke (without disarming the role, so a
user can paint several strokes before running the appreciation); rendered
as `mobility-origin-paint`/`mobility-objective-paint` MultiPolygon sources
(cyan/amber, matching the mode's existing colour convention), each dab
approximated as a closed N-gon in real lat/lng via `dabToPolygon`.

**Verification:** `npm run tsc --noEmit` and `npm run build` clean. A
standalone Node smoke test against the real `paintedArea.ts` (13 checks)
confirms the zoom-consistency property directly: the same brush painted at
zoom 10 covers exactly 2⁶=64× the ground radius of zoom 16 (the expected
Web Mercator doubling-per-zoom-level relationship), brush sizes order
correctly at a fixed zoom, union-of-circles membership works across
multiple dabs, and `dabToPolygon` produces a closed ring. Live map-canvas
interaction remains subject to the same sandbox proxy limitation recorded
in §16 — **confirm live** before demoing the brush/paint gesture itself,
though the underlying geometry it depends on is verified above.

## 22. Field feedback round 2 — the paint tool didn't actually work on mobile (2026-07-26)

The §21 paint tool shipped with two bugs that only show up on a real phone,
both traced to their actual root cause rather than patched symptomatically.

**Bug 1 — "paint origin" still drew a fire-break line, after switching
modes mid-session.** §16's own fix comment for the *first* version of this
bug (MapboxDraw unconditionally armed to draw lines) said the plainly:
"`tacticalMode` is a load-time decision here, same as the basemap style
choice" — i.e. `new MapboxDraw({ defaultMode: tacticalMode ? 'simple_select'
: 'draw_line_string', ... })` only reads `tacticalMode` once, at
construction. That's correct for a fresh page load already in Terrain mode,
but the in-app "Terrain mode" header button doesn't remount the map — it
just flips a prop on an already-mounted one — so a session that starts in
fire-break mode (the default) and then switches to Terrain mode left
MapboxDraw permanently armed in `draw_line_string`, silently eating every
subsequent tap regardless of which paint role was selected. Fixed with a
`useEffect` on `[tacticalMode]` in `MapboxMapView.tsx` that calls
`draw.changeMode(...)` reactively on every toggle, in either direction — not
just at construction. The pencil/trash control *buttons* have the same
problem for a different reason (MapboxDraw's `controls` option can't be
changed after construction at all), so they're hidden by CSS instead:
`.tactical-mode .mapboxgl-ctrl-group-draw { display: none !important; }` in
`styles-tactical.css`, targeting a wrapper class the draw-control setup
already adds unconditionally, so it works regardless of which mode the map
happened to construct in.

**Bug 2 — "paint objective" did nothing at all, on mobile.** The paint
tool's `mousedown`/`mousemove`/`mouseup`/`mouseleave` handlers were
mouse-only. Mapbox GL JS fires genuinely distinct event types for mouse vs.
touch input — a touch tap never fires `mousedown` — so on a touchscreen
device the paint handlers simply never ran, for *either* role; bug 1 masked
this for the origin role because MapboxDraw was intercepting those taps
first, but with bug 1 fixed, origin would have shown the same "nothing
happens" as objective. Fixed by registering the same handler bodies
(`handlePaintStart`/`handlePaintMove`/`handlePaintEnd`) against
`touchstart`/`touchmove`/`touchend`/`touchcancel` as well — Mapbox's
`MapTouchEvent` carries the same `.lngLat` shape as `MapMouseEvent`, so no
coordinate-conversion logic had to change, only which event names the
existing logic is attached to.

**Verification:** `npm run tsc --noEmit` / `npm run build` clean. Live
touch-interaction testing remains subject to the sandbox proxy limitation
recorded in §16 (no path to a real device/touch emulator from this build
environment) — **confirm on a real phone against the live preview**, same
caveat as §21's own paint gesture.

## 23. Field feedback round 3 — two-finger map gestures and a continuous painted shape (2026-07-26)

Two more owner-tested refinements on top of §22's touch fixes.

**Two-finger gestures were still being intercepted as painting.** §22 wired
the paint tool's handlers to `touchstart`/`touchmove`/`touchend` so a
single-finger tap/drag paints — but with no finger-count check, a
two-finger pinch-zoom or two-finger pan (the gesture a user reaches for
specifically to move the map, since one-finger drag is dedicated to
painting while a role is armed) was *also* read as a paint stroke,
fighting the native gesture. Mapbox's own `touchZoomRotate` handler is a
separate handler from `dragPan` and stays enabled throughout (only
`dragPan` is disabled while a role is armed, deliberately, so one-finger
drag paints instead of panning) — the fix only needed the paint handlers to
get out of the way, not any change to what Mapbox itself listens for.
`MapboxMapView.tsx`'s `handlePaintStart`/`handlePaintMove` now check
`e.points?.length` (Mapbox's own per-touch screen-point array on a touch
event) and bail out — without painting, without `preventDefault()` — the
moment more than one finger is down, including a second finger joining
mid-stroke. The gesture then falls straight through to Mapbox's native
pinch/pan handling exactly as it would outside the paint tool.

**The painted area rendered as a cluster of overlapping circles, not one
shape.** Each dab was rendered as its own independent circle polygon inside
a `MultiPolygon` — geometrically correct for the `isInsidePaintedArea`
membership test (§21, a real union-of-circles test), but visually every
overlap showed a doubled fill and a stray outline seam, reading as "a pile
of circles" rather than one painted patch of ground. Fixed with a real
geometric union, not a rendering trick: new `paintedAreaToUnionGeometry`
in `paintedArea.ts` builds one polygon per dab and merges them with
`@turf/union` (new dependency — chosen over hand-rolling a polygon-clipping
algorithm for the same correctness reasons §17 gives for using standard
max-flow/min-cut rather than a bespoke construction: this is exactly the
kind of computational-geometry code where a subtly-wrong DIY implementation
is a real risk, and a widely-used, well-tested library is the safer choice).
Two touching/overlapping dabs merge into one continuous `Polygon`; two
genuinely separate strokes correctly stay a `MultiPolygon` — union only
merges where geometry actually overlaps or touches, so a real gap in the
painted area still renders as a real gap. `MapboxMapView.tsx`'s rendering
effects for `mobility-origin-paint`/`mobility-objective-paint` now feed this
unioned geometry to the map source instead of the raw per-dab circles.

**Verification:** `npm run tsc --noEmit` / `npm run build` clean. A
standalone Node smoke test against the real union geometry function
(9 checks): two identical overlapping dabs union to within 3% of a single
circle's own area (not double); two partially-overlapping dabs union to
strictly less area than the sum of both circles yet more than one circle
alone (the overlap is counted once, not zero or twice); two dabs far enough
apart to never touch correctly stay a `MultiPolygon` rather than being
forced together. Live two-finger touch-gesture testing remains subject to
the same sandbox device/touch-emulator limitation as §22 — **confirm on a
real phone against the live preview**.

## 24. Erase function (2026-07-26)

Owner asked, in the same round as §23: "add an erase function." The paint
tool (§21) was add-only — the only way to correct a mistake was "Clear
origin"/"Clear objective", which wipes the *entire* area, not a targeted fix.

**Design: an ordered stroke log, not two standing sets.** The obvious first
model — a "painted" dab list and a separate "erased" dab list, final area =
union(painted) minus union(erased) — gets the expected eraser behaviour
*wrong*: erase a mistake, then paint back over the same spot, and under that
model it stays erased forever (the point is permanently in the "erased"
set). Every real paint/eraser tool (MS Paint, Procreate, any raster editor)
instead treats strokes as an ordered sequence of operations replayed in
time — erase, then paint over the same spot, and it comes back, because the
paint stroke is simply the *last* operation touching that area. `PaintedArea`
is now `PaintStroke[]` (`{ mode: 'paint' | 'erase', dab: PaintDab }`, ordered
by the time they were laid down) instead of a flat `PaintDab[]`, and
`resolvePaintedAreaGeometry` (`paintedArea.ts`) replays the sequence:
`@turf/union` on a `paint` stroke, `@turf/difference` on an `erase` stroke,
each folded onto the running accumulated shape. New dependency
(`@turf/difference`, alongside the `@turf/union` §23 already added) chosen
for the same correctness reason as §17's max-flow/min-cut and §23's union
choice: this is real computational geometry, and a hand-rolled polygon-clip
implementation is exactly the kind of code where a subtle bug produces a
confident-looking but wrong shape.

**Membership testing moved off the raw dab list.** The old
`isInsidePaintedArea` tested "is this point within *any* dab's radius" —
correct for a paint-only, flat model, but wrong the moment erase exists (a
point inside a painted dab that a later erase stroke removed would still
read as "inside"). Replaced with `isInsideResolvedArea(point, geometry)`, a
`@turf/boolean-point-in-polygon` test against the *resolved* shape.
`mobilityGrid.ts` now resolves each painted area's geometry **once** (not
per grid cell) before filtering cells — the boolean-ops replay is real work;
membership testing against an already-resolved shape is cheap, so this
keeps the same "resolve once, test many points" performance shape the
codebase already uses elsewhere (e.g. one area-query per corridor scan
rather than one per sampled point).

**UI:** a new "Erase" toggle button in the map's floating overlay controls
(shown alongside the brush-size row whenever an AOI role is armed — §21's
"primary actions live on the map overlay" pattern, not a new location),
styled in the app's existing danger-red (`--tac-nogo`) so it reads clearly
as "about to remove area," not just another equal-weight mode button. Brush
size is shared between paint and erase — no separate "erase brush size" —
since the same on-screen/ground-radius relationship applies to
subtracting area as adding it. `MobilityPanel.tsx`'s stroke-count display
was relabelled from "N dabs painted" to "N strokes (paint + erase)" since
the count now covers both kinds honestly rather than implying every entry
added area.

**Verification:** `npm run tsc --noEmit` / `npm run build` clean. A
standalone Node smoke test against the real `resolvePaintedAreaGeometry` /
`isInsideResolvedArea` (7 checks) — critically, the exact property a naive
two-set model would get wrong: paint a spot, erase it, **paint the same
spot again**, and it correctly reads as inside once more; also verifies
erasing bigger than what was painted clears it entirely, erasing before
anything is painted is a safe no-op (resolves to `null`, not a crash or
phantom shape), and a *partial* erase removes only its own bite while the
opposite edge of the original painted circle stays intact (a real boolean
subtraction, not an all-or-nothing clear).

## 25. Mode-switch audit and control scheme (2026-07-26)

Owner: "there are still fire-break UI tools like getting started and the
draw line button appearing when in this new mode, ensure everything
switches from A to B and back again... instead of the buttons for the new
mode sitting on top of the map controls like zoom in and out on the left,
we should use roughly the same control scheme as the fire break so we have
the general map controls in the top left and special controls in the top
right." Two real, distinct bugs plus a genuine control-scheme
inconsistency, all found by actually auditing every mode-conditional
element rather than patching the one symptom reported.

**The pencil/trash hide from §22 never actually worked.** It added a
wrapper class to the draw control's container by querying
`.mapboxgl-ctrl-top-right .mapbox-gl-draw_ctrl` — a class that does not
exist in this MapboxDraw version's real DOM output at all (checked against
its bundled source: the actual constant is `mapboxgl-ctrl-group`, not
`mapbox-gl-draw_ctrl`). The query silently matched nothing, the wrapper
class was never applied, and the CSS rule built on it never fired — the
pencil/trash controls kept showing (and, if clicked, kept re-arming
`draw_line_string` mode, undoing §22's `changeMode` fix). Replaced with a
positional selector that can't have that failure mode:
`.tactical-mode .mapboxgl-ctrl-top-right { display: none !important; }` —
targeting Mapbox's own top-right control-position container directly.
Nothing else in this app is ever added to `top-right`, so this can't
over-hide anything else either.

**"Getting Started" was completely unconditional.** `MapEmptyState.tsx`
(a "Get Started" card overlaid on the map, telling the user to "use the
drawing tool above") never checked which mode was active — it showed in
Terrain mode too, with fire-break-only instructions that make no sense
there. Given a `tacticalMode`/`mobilityStarted` prop pair and now branches
to Terrain-appropriate copy ("Use the Paint origin / Paint objective
buttons") with its own "started" signal (at least one area painted, rather
than fire-break's own "a line has been drawn").

**Armed-tool state survives a mode switch and keeps intercepting clicks.**
Hiding a mode's *controls* isn't the same as disarming its *tool state* —
the paint tool's touch/mouse handlers and the area-recon (Scan area) box
tool's click handlers are both registered unconditionally and only check
their own armed-state ref, never which mode is active. Left armed across a
switch, either would keep hijacking clicks meant for the other mode's own
tool. New cleanup effect in `App.tsx`, keyed on `mobilityModeActive`:
entering Terrain mode disarms `areaReconActive`; leaving it disarms
`mobilityBoxRole`. The Configuration panel has the same shape of bug for a
different reason (`isConfigOpen` is a plain boolean with no mode
awareness at all, so leaving it open before switching to Terrain mode left
it rendering on top of the Terrain UI) — fixed by gating its `isOpen` prop
with `&& !mobilityModeActive` rather than adding another effect, since
render-gating is sufficient there (no click-handler state to leak).

**Control scheme, made consistent and explicit as a rule, not per-button
judgement calls:** general map navigation (zoom, compass, fullscreen,
geolocate) stays top-left in every mode — unchanged, was already correct.
Every app-specific TOOL now lives top-right instead: fire-break's own
"Scan area" button/badges (which, on inspection, had exactly the same
top-left-overlapping-zoom-controls problem the owner flagged for Terrain
mode, just never reported) moved from top-left to top-right, stacked below
the draw/trash control that already lived there; Terrain mode's paint/
erase/run overlay moved from top-left to top-right to match — and no
longer needs to dodge the draw control at all, since that's now hidden
outright in Terrain mode (previous bug above). `MapEmptyState`'s own
position was pushed down (`top: 230px`) to clear this now-taller top-right
tool stack in both modes rather than overlapping it.

**Verification:** `npm run tsc --noEmit` / `npm run build` clean. A
Playwright screenshot of the live dev server confirmed, end to end: the
mode toggle correctly swaps header/title/controls in both directions; the
Terrain-mode overlay renders at the top-right of the map area (not
overlapping where zoom controls sit); no fire-break "Welcome"/"Get
Started" card bleeds into a Terrain-mode screenshot. The map canvas itself
(and therefore the actual pencil/trash controls and the Mapbox-native zoom
controls) still can't render pixel-for-pixel in this sandbox — no Mapbox
token available here — so the CSS-hide fix and the real control-scheme
spacing are verified by code inspection against the real MapboxDraw source
and by the screenshot evidence above, not a full live render. **Confirm on
the live preview.**

## 26. `?ops=1` now defaults straight into Terrain mode (2026-07-26)

Owner: "make the ops equals one URL modifier default to the new mode... if
that is not present or set to anything else we get fire break, and if it
is set then we go straight into the new mode." Previously `?ops=1` only
made the header toggle button *available*; the app still landed in
fire-break mode either way, requiring an extra click to actually reach
Terrain mode. `mobilityModeActive`'s initial state is now a lazy
`useState(() => mobilityModeAvailable)` — `mobilityModeAvailable` is the
exact same `ops === '1'` check §14/§16 already used to gate the toggle
button's visibility, so this is a one-line change reusing an existing,
already-correct check rather than a new URL-parsing path. The toggle
button still works normally after the initial load — this only changes
which mode the app lands in, not whether the user can switch afterward.
Verified live: `?ops=1` alone (no click) now shows "Terrain Mobility" in
the header on first load; no `ops` param, and `?ops=2` (anything other
than exactly `"1"`), both still correctly land in "Fire Break Calculator".

## 27. Analytical depth pass — cross-slope wired live, larger AOIs, edge cases (2026-07-26)

Owner: "have a look at the original intent... take this up a notch, make
the analysis better, consider more factors, think about a larger area...
ensure the edge cases are thought about, and that the basic is not
missed." Read against §1's original intent and §10's own fidelity-stack
plan, the honest gap was never "invent a new capability" — it was that
several things §10.7/§16 already flagged as real, cited, *built* work
(Pass 3's `demDerivatives.ts`) had never actually been wired into the
search that uses them. Finishing already-verified work beats fabricating
new "10x" features that can't be checked, so that's what this pass does,
plus two genuine edge cases and one honest capacity increase.

**Cross-slope is now a real, live gate, not a permanently-inert one.**
§3/§16 stated plainly that the search only gated on climb-slope and
vegetation — cross-slope was always passed as `null` ("unknown") to
`edgeMobilityCost`, so its hard side-slope NO-GO gate (roll-over risk, a
real safety factor for wheeled/tracked movers) never fired, ever, in any
run. `MobilityGridCell` now carries a real `crossSlopeDeg` field, computed
once per grid build from `dataLayers/demDerivatives.ts`'s local plane fit
over the elevation grid already sampled (no new network source, no new
dependency) — wired into all three places that call `edgeMobilityCost`
directly: the main search (`accumulatedCost.ts`, which everything else —
k-dissimilar routes, the delay ledger — already goes through), the
terrain-only GO/SLOW-GO/NO-GO classifier (`classifyCellTerrain`, which
previously double-used one steepest-neighbour number for both the climb
AND side-slope checks, conflating two different physical failure modes —
now uses the real plane-fit value for the side-slope check specifically),
and min-cut barrier siting (`minCutBarrier.ts`, both its flow-graph
construction and its final segment-extraction pass). Still a direction-
agnostic "worst-case in this cell's steepest direction" proxy, not a true
per-directed-edge perpendicular-to-travel calculation (stated in
`demDerivatives.ts`'s own docs) — but deliberately the conservative choice
for a hard safety gate: it can only over-estimate roll-over risk, never
under-estimate it. The in-app "POC limitations" disclaimer (which
previously said outright "cross-slope is not evaluated") is corrected to
describe what actually runs now, not what used to.

**Larger areas, argued from what the sampling pipeline can actually
sustain, not an arbitrary bump.** `TARGET_CELL_COUNT`/`MAX_HEX_CELLS`
raised from 1400/1800 to 2200/2800. This is safe specifically because both
upstream sampling calls this grid depends on are already area-batched
(`sampleVegetation` resolves from at most two area requests once enough
points are uncached; `sampleElevationsCached` batches its cache misses in
one call) — the "hundreds of upstream requests" risk that keeps something
like NAFI's point-query mechanism deliberately capped small (see its own
module header) does not apply here. The search itself and
`demDerivatives.ts`'s per-cell plane fit + one MFD accumulation pass are
both O(cells log cells) in a Web Worker — negligible at this size.

**A grid that had to coarsen for a large AOI now says so.** The existing
hex-size-doubling loop (up to 5 tries, already there since Pass 1) never
surfaced whether it actually fired. `MobilityGridResult.usedCoarseGrid` is
now a real flag (`tries > 0`), surfaced as a log line
("CAUTION — AOI IS LARGE, GRID COARSENED…") — a coarsened grid is still a
genuine search over genuine samples, just at lower spatial resolution than
the target, so a narrow gap or a short obstacle may not survive being
averaged into a bigger cell. Silently trusting a coarse grid at full-
fidelity confidence would have been exactly the kind of unflagged
degradation this project's data-honesty principle forbids.

**Edge case: overlapping origin/objective areas.** A painted origin and
objective that touch or overlap share at least one cell, so the cheapest
route between them is genuinely ~0 seconds — correct behaviour, not a bug,
but confusing to see with no explanation. `runMobilityAppreciation` now
detects the shared-cell case and logs it plainly
("ORIGIN AND OBJECTIVE OVERLAP — N SHARED CELL(S), ROUTE IS TRIVIAL BY
DESIGN") rather than leaving the user to guess why a route looks
suspiciously instant.

**What this pass deliberately does NOT do, stated plainly rather than
rushed:** NAFI/DEA time-since-fire, fractional-cover and surface-water
(Tier 1, §10.7 M3c) are built and verified (§19) but still not wired into
per-cell sampling — that needs a genuine new area-query mechanism for
NAFI specifically (its own module header explains why the point-query form
can't just be called per cell at grid scale), which is real, scoped,
un-started work, not a quick wire-up like the DEM derivatives above were.
Min-cut capacity is still unit/trail-weighted, not real VCI/RCI vehicle
capacity (§17, needs Pass 3's soil layers — not yet sampled either).
Imagery CV remains gated on a lidar calibration set per §12/§18. All three
are real, prioritized next steps, not silently dropped — see the roadmap
entry in `master_plan.md`.

**Verification:** `npm run tsc --noEmit` / `npm run build` clean. A
standalone Node smoke test against the real modules (10 checks) — the
central claim: passing a synthetic `crossSlopeDeg` that exceeds a mover's
`maxSideSlopeDeg` now genuinely blocks the edge in `edgeMobilityCost`
directly, in the full multi-source search (a multi-hop-away objective
becomes correctly unreachable once every approach is side-slope-blocked,
while immediate one-hop neighbours of a flat origin correctly remain
reachable — proving the "at the FROM cell" contract is honoured, not just
that something got blocked somewhere), in the terrain-only classifier (more
cells read NO-GO once real values exceed the limit), and in min-cut (a
flow graph with every edge blocked correctly returns no barrier to site,
rather than silently ignoring the block).

## 28. Movement corridors — Pass 2's unfinished half (2026-07-26)

Owner: "smooth out the potential paths that someone might move through the
terrain, noting there will be several, across a large area, and present them
as sensibly displayed **corridors** of possible movement rather than the
single optimal path. Use the individual pathways to analyse, corridors for
likely results / ease of movement. Once countermeasures are in place, show
how that affects the corridor and the relative difficulty it adds at those
points... this analysis may need to be iterative." Framed by the intended
user: *"As a ground commander I will use this tool to get a rapid
appreciation of the broad area to propose a course of action to deter and
deny access. This will then be scouted and planned in more detail."*

**This request was already on the roadmap.** Checked against §15.2 before
building: Pass 2 scoped *"route-preference surface … avenues of approach
sized by echelon … baseline-vs-scenario swipe"* and only the k-route /
chokepoint / min-cut half was ever built. So the roadmap items that serve
this ask **are** this ask, and this section closes them rather than adding a
parallel feature.

### Why corridors are an HONESTY improvement, not decoration

A single cheapest-path polyline implies survey precision this product does
not have and never claims — §10 establishes that Tier 0/1 data cannot
resolve a 30 m drivable lane. A **band** is the honest spatial statement:
"movement will happen somewhere in here, most probably along its spine."
Doctrine agrees (a mobility corridor and an avenue of approach are both
bands; a line is a route order — a later, scouted product). So: **analysis on
individual routes, where the maths is exact; presentation as corridors, where
the uncertainty is visible.** This directly answers the owner's constraint
that "the UI isn't communicating too high a level of fidelity but the
fidelity of ANALYSIS is inherently visible".

### `corridorField.ts` — the pipeline

1. **k routes** (raised 3 → 14, `DEFAULT_CORRIDOR_ROUTE_COUNT`) from the
   existing `findKDissimilarPaths`, which gained an `initialEdgePenalties`
   parameter so a scenario can start from an already-obstructed picture.
2. **Weighted density** per cell — each route contributes to every cell it
   crosses, weighted by `bestTime / thisRouteTime`, so a route twice as slow
   as the best counts half. A real computed ratio, not a rank decay.
3. **Smoothing** — discrete Laplacian diffusion over hex adjacency
   (3 passes, weight 0.5). This is literally the "smooth out the potential
   paths" step, and its fuzzy output edges are the uncertainty statement.
   Adjacency is precomputed over cells that actually exist, so a boundary
   cell is never dragged toward zero by phantom off-grid neighbours (that bug
   would have carved a false low-density rim around every AOI).
4. **Segmentation** — connected components over hex adjacency above 12% of
   the field's own peak; components under 4 cells dropped as noise.
5. **Per-corridor metrics** — width and bottleneck from **iso-arrival-time
   slices**: arrival time rises monotonically along travel, so cells sharing
   an arrival-time band form a cross-section. That is the same principle the
   isochrone display already uses, reused as a measurement.

Each corridor reports: route count and share of the analysed set, median and
fastest travel time, bottleneck/widest width (cells and metres),
`bottleneckAbreast`, `frontage`, real GO/SLOW-GO/NO-GO fractions, an
`easeClass`, and its own `usedEstimatedData` flag so a Tier-0 caveat lands on
the specific corridor it applies to.

### "Avenues sized by echelon", delivered only as far as the data allows

`bottleneckAbreast` is `floor(bottleneckWidthM / profile.widthM)` —
arithmetic over two real numbers. **Deliberately NOT claimed**: a doctrinal
echelon label (platoon/company/battalion frontage), column throughput per
hour, or a VCI₁/VCI₅₀ pass verdict. The first two need sourced doctrinal
frontage and march-spacing figures (§11.2 sources march *rates*, not
frontages); the third needs the soil data Pass 3 has not sampled. Printing
"company-sized avenue" off unsourced arithmetic would be exactly the
invented precision this project forbids, so the UI states the caveat inline
rather than omitting it.

### The unconstrained-terrain finding (caught by testing, kept as a feature)

Testing this module against a featureless plain exposed a genuine weakness:
14 distinct routes covered 304 of 305 cells, and segmentation duly reported
"one corridor" containing the entire AOI — arithmetically correct,
operationally useless. Rather than tune it away, this is now a **reported
finding**: `CorridorField.unconstrained`, surfaced as a prominent panel
callout and a log line. It matters because terrain that does not canalise
movement *cannot be denied by siting obstacles at chokepoints* — there are
none. Denial there needs observation and fires, or a continuous barrier: a
materially different and more expensive course of action, which is precisely
what a commander needs told early.

The test is deliberately **two conditions**, and testing only the first was a
real bug the smoke test caught: the synthetic ridge-with-one-gap case still
covered 80% of the area (routes fan out across open ground either side before
funnelling), so a coverage-only rule called it "unconstrained" while it held
the most important chokepoint on the map. Unconstrained now requires high
coverage **and** `pinchRatio > 0.35` — i.e. the busiest corridor never
actually narrows. "Wide everywhere" is unconstrained; "wide but with a
throat" is the ground you want.

### Iterative counter-mobility: the effect ON the corridors

`buildScenarioEdgePenalties` (in `delayLedger.ts`) builds one combined
penalty map for an entire placement set — compounding multiplicatively where
placements share an edge, matching the convention `findKDissimilarPaths`
already uses. `compareCorridorFields` then diffs baseline against scenario,
matching corridors by cell overlap (≥25% — they are the same *ground*, not
the same object; a measure can shrink, split or shift a corridor) and
classifying each: **collapsed / degraded / unchanged / displaced-into**.

`displaced-into` is the bypass rule (§5) asked **spatially** rather than as a
single number — a corridor that now carries *more* of the route set is where
the measures pushed traffic, and `newCorridors` are bands that appeared on
ground carrying no movement at baseline. Colour semantics in the panel are
deliberately from the **planner's** point of view, not the mover's: a
collapsed corridor is green (good outcome for whoever sited the obstacle), a
displaced-into corridor is red (the warning — expect to be flanked there).

Critically, the scenario is **the same computation with a different edge-cost
view**, never a separate estimate that could disagree with the baseline; and
because the whole set is applied together, it captures what per-measure
ledger rows cannot — blocking two of three corridors pushes everything onto
the third. A map-level Baseline / With-measures toggle closes the
propose → assess → revise loop.

### Verification

`npm run tsc --noEmit` / `npm run build` clean. A 40-check standalone Node
smoke test against the real modules, over **two deliberately different
terrains**: an open plain (degenerate case) and an impassable ridge with one
gap (the constrained case corridors exist for). It asserts smoothing genuinely
widens routes into bands (band cells > routed cells) rather than redrawing
them; that the band keeps routed and smoothing-only fringe cells
distinguishable; rank ordering by movement carried; internal consistency of
every metric (bottleneck ≤ widest, fractions summing to 1, fastest ≤ median,
`abreast` agreeing with the width it came from, densities normalised);
that the ridge yields a genuinely narrower bottleneck and harder pinch than
the plain; that the plain **is** flagged unconstrained and the ridge **is
not**; and that measures emplaced in a real bottleneck produce a non-empty
corridor effect while an empty placement set, an unknown measure id, and a
null after-field are all handled without fabricating an effect. Map rendering
itself remains unverifiable in this sandbox (no Mapbox token) — **confirm on
the live preview**.

### Still open after this pass

Deliberately not built, and not silently dropped: **MCOO overlay + GIS
export** (the "then scouted and planned in more detail" handoff — corridors
are now the right shape to export, so this is genuinely next — done in §29),
**assistant narrative through the grounding gate**, **VCI/RCI capacity**
(blocked on soil sampling), and the Tier-1 NAFI/DEA per-cell wiring from §27.

## 29. GIS export for the Terrain Mobility appreciation (2026-07-27)

Closes the "MCOO overlay + GIS export" item above: the "this will then be
scouted and planned in more detail" handoff (§28's framing) needed a real
mechanism, not just a shape corridors happened to be ready for. Mirrors
`gisExport.ts`'s exact pattern (GeoJSON/KML/KMZ, provenance stamps, per-feature
honesty flags) via a new sibling module, `utils/mobilityGisExport.ts`, rather
than inventing a second export convention — same consumers (QGIS, FireMapper,
Google Earth), same contract.

**What is exported**, one Feature/Placemark per item, every one carrying
`provenanceProperties()`/`provenanceStamp()`:
- **Movement corridors** → one `MultiPolygon` Feature per corridor, built from
  its own hex cells **undissolved**. Deliberate: a smoothed/dissolved outline
  would claim a boundary precision the hex grid doesn't have — the same
  "band, not a line" honesty argument §28 makes for the on-map render applies
  identically to the exported geometry. Properties carry the same figures the
  panel card shows (rank, ease class, route count/share, median/fastest time,
  bottleneck width/abreast/frontage, GO/SLOW/NO-GO fractions) plus a
  **per-corridor** `estimated_data` flag — some corridors sit entirely on
  surveyed cells, others don't, so one blanket flag for the whole export would
  either hide a real caveat or over-warn on clean ground.
- **Chokepoints** → one `Polygon` Feature per top route-crossing hex cell.
- **Min-cut barrier** → one `LineString` Feature per severing-cut segment.
- **Counter-measure placements** → one `LineString` Feature per placed edge.
  An obstacle is sited *at an edge between two cells* (`delayLedger.ts`'s
  `segmentFromKey`/`segmentToKey`), so a line between their real centres is
  what was actually computed — never an invented point partway along it, even
  for a catalogue measure whose doctrinal `geometry` is `'point'` (that field
  is carried through as `measure_geometry` so a GIS user still knows what kind
  of obstacle it doctrinally is). Each placement carries **that measure's own
  delay-ledger figures** (`delay_imposed_min`, `bypass_delay_min`,
  `egress_safe`, `egress_warning`) so the exported course of action is backed
  by the same bypass-rule and egress-gate numbers the Counter-Mobility panel
  shows, not a stripped subset. A placement whose measure hasn't been scored
  yet (ledger not run, or run against a different placement set) still
  exports — flagged `ledger_status: "not_scored"` with null figures, never a
  stale or invented number.
- **Mission metadata** — a geometry-`null` Feature (valid GeoJSON per RFC 7946
  §3.2) carrying mover profile, night mode, and the grid-level
  `usedEstimatedData` flag, so the file's own top-level properties don't need
  a nonstandard `FeatureCollection.properties` extension to answer "what was
  this appreciation run with".

**A stale placement key is skipped, never invented a location for**: if
`segmentFromKey`/`segmentToKey` doesn't resolve against the `cells` passed in
(e.g. a placement kept in state after a fresh appreciation resampled the
grid), that placement is silently dropped from the export rather than guessing
coordinates — verified in the smoke test below.

**Shapefile is deliberately NOT offered** for this pack (unlike
`gisExport.ts`'s route export, which does offer it): mixing
MultiPolygon/Polygon/LineString in one set needs `@mapbox/shp-write`'s
per-geometry-type file-splitting to be confirmed working for MultiPolygon
specifically, which wasn't verified — left out rather than shipped untested.
GeoJSON/KML/KMZ already cover this module's stated consumers.

**UI**: a new `MobilityExportControls` component (mirrors
`ExportImportControls`'s dropdown exactly — menu, per-format handler, loading
state, outside-click dismiss) sits in `MobilityPanel.tsx`'s RESULT section,
enabled once a result exists. It folds in `cmPlacements`/`cmLedger` from the
Counter-Mobility tab (passed down from `App.tsx`, both optional/default-empty
so the appreciation tab's export works standalone before any measure is even
proposed).

**Verification**: `tsc --noEmit`/`npm run build` clean. A standalone Node
smoke test (real modules, disposable vite lib-mode entry, deleted before
commit — this session's established pattern) built a small synthetic flat-open
grid, ran the real `buildCorridorField`/`computeChokepoints`/
`computeMinCutBarrier`/`computeDelayLedger` over it, then exported: asserts
feature counts match source data 1:1 for every category, corridor geometry is
`MultiPolygon` with a boolean `estimated_data`, the mission feature has null
geometry and a real provenance stamp, a scored placement's delay/bypass/egress
figures are present and typed correctly, an *unscored* placement (ledger
passed as `null`) exports with `ledger_status: "not_scored"` and null figures
rather than stale ones, a placement with a key not present in the grid is
dropped rather than mislocated, and the KML contains all four folders plus the
scored placement's delay text. Live import into QGIS/Google Earth is not
verified in this sandbox (no Mapbox token, no GIS desktop tooling here) —
**confirm on the live preview / a real GIS client** before relying on the
exported files operationally.

**Addendum (2026-08-02, OCOKA 1, §47).** The `GO`/`SLOW-GO`/`NO-GO` fractions
this section describes are superseded by the current MCOO vocabulary
(`unrestricted`/`restricted`/`severely-restricted`) — `corridorProperties()`
now dual-emits both the current field names (`mobility_class`,
`unrestricted_fraction`, `restricted_fraction`, `severely_restricted_fraction`)
and the legacy ones (`ease_class`, `go_fraction`, `slow_go_fraction`,
`no_go_fraction`) for one release, since a saved external symbology may key off
the attribute name. `missionProperties()` gained `schema_version: 2`. This
section's own text above is left as the original as-built record; see §47.6
for the full migration and its contract risks.

## 30. AI assistant narrative for Terrain Mobility results (2026-07-27)

Closes the "assistant narrative through the grounding gate" backlog item: a
ground commander gets a plain-language appreciation, not just panels of
corridor/chokepoint/barrier/ledger numbers. Wires into the **existing**
grounding gate (`api/src/services/aiGrounding.ts`) rather than building a
second one — `buildSystemPrompt`/`validateGroundedResponse`/
`flattenPayloadNumbers` already operate on `unknown`/any-shaped payload, so
the fire-break assistant's own anti-hallucination contract ("the model
narrates and cites, it never computes, never estimates, never fills gaps",
docs/AI_ASSISTANT.md's prime directive) applies to mobility results with no
changes to that module beyond one backward-compatible addition:
`buildSystemPrompt(citations, audience?)` — an optional `audience` string
(defaults to the existing fire-break wording, so no existing caller changes)
so the same contract rules can be stated for "a ground commander appreciating
terrain mobility and siting counter-mobility measures" instead.

**New pieces, one per existing counterpart** (api-side, mirroring
`assistant.ts`/`briefingTemplate.ts`/`assistantBriefing.ts` exactly):
- `api/src/types/mobilityAssistant.ts` — `MobilityAssistantPayload`: mover
  profile + confidence, cell/reachable/NO-GO/SLOW-GO counts, the
  `unconstrained` flag and coverage percent, up to 3 top corridors (rank,
  ease, route share, median time, bottleneck width/abreast/frontage, GO
  fraction), chokepoint/barrier summary, and scored counter-measure
  placements (delay imposed, bypass delay, egress-safe) — the exact same
  figures the panels already render, never a second computation. Its
  validator (`isMobilityAssistantPayload`) is the same untrusted-boundary
  shape check `isAssistantPayload` does for the fire-break payload.
- `api/src/services/mobilityBriefingTemplate.ts` —
  `buildTemplateMobilityBriefing(payload)`: the deterministic, no-AI
  fallback, and the piece that actually delivers "plain-language briefing"
  unconditionally, since it needs no model deployed at all (this sandbox
  cannot exercise a live Foundry call either — same documented limitation as
  the fire-break assistant, docs/AI_ASSISTANT.md §1). Leads with the
  `unconstrained` finding when present (never buries it under corridor
  detail that would overstate structure the terrain doesn't have), and
  **refuses** to report delay figures for an egress-unsafe placement — it
  states the refusal instead, mirroring the panel's own refusal-not-warning
  treatment of that gate (§ counter-mobility panel notes above).
- `api/src/functions/assistantMobilityBriefing.ts` — `POST
  /api/assistant/mobility-briefing`, same always-200 shape as
  `assistantBriefing.ts`: rate-limited, validates the payload, retrieves
  doctrine via the existing keyword-overlap `retrieveDoctrine` (same
  11-chunk KB — `route-optimizer-corridor`'s tags already cover
  corridor/route/pathfinding), attempts a grounded AI call under the
  mobility audience string, falls back to the template on any failure or
  grounding-check rejection.
- Frontend: `webapp/src/utils/mobilityAssistantApi.ts` builds the payload
  straight from `MobilityAppreciationResult` + the counter-mobility ledger
  (reuses `assistantApi.ts`'s `postAssistant`/`AssistantResponse` directly —
  both already generic over payload shape, so no duplicated fetch plumbing),
  and `MobilityAssistantCard.tsx` is a briefing-only sibling of
  `AiAssistantCard.tsx` (same CSS classes/source-badge/citation-chip
  presentation), wired into `MobilityPanel.tsx` after the chokepoints/barrier
  section.

**Deliberately scoped out**: grounded chat (open-ended Q&A) over the
mobility payload — the fire-break assistant's chat endpoint isn't mirrored
here. A one-shot briefing directly answers what was asked ("a plain-language
briefing, not just panels of numbers"); chat is a natural follow-up, not
built in this pass so as not to expand scope past the actual ask.

**Verification**: `tsc --noEmit`/`npm run build` clean on both `api/` and
`webapp/`. New `api/src/test/mobilityAssistant.test.ts` (plain node+assert,
matches the project's framework-free convention, wired into
`npm run test:unit`) — 17 checks: payload validator accepts a well-formed
payload and rejects a missing field, a non-finite corridor number, a
placement missing `egressSafe`, and non-objects (`null`/string/number)
outright (a real bug caught here: the validator's `v && ...` chain returned
`v` itself — e.g. `null` — instead of a boolean on early rejection, fixed
with an explicit `!!(...)` wrap); accepts the legitimate null cases (no
barrier found, bypass meaningless because baseline was already unreachable);
template briefing checks mention the mover profile and reachability figures,
report the primary corridor OR the `unconstrained` finding correctly
(never both), report a scored placement's delay/bypass figures, **refuse**
an egress-unsafe placement's figures instead of reporting them, carry the
estimated-data caution, never fabricate a corridor when none formed, and
always state the "appreciation, not a tasking" caveat; system-prompt checks
confirm the `audience` parameter is backward-compatible (existing fire-break
wording by default) and correctly substituted when passed. Actually exercising
a live Foundry deployment remains unverified in this sandbox, same as the
rest of the AI assistant feature (docs/AI_ASSISTANT.md §1) — **sanity-check a
real briefing once `deployAiAssistant=true` is provisioned**.

## 31. NAFI time-since-fire — a real area-query mechanism (2026-07-27)

Closes the backlog item `nafiFireHistoryService.ts`'s own module header left
open: "SCOPE CUT, stated plainly: POINT query only, not an area/tile query
... flagged here as the concrete next step for whoever wires an area form
in". Built and **live-verified this session** (via `curl` + Pillow against
the real `firenorth.org.au` GeoServer, not inferred from documentation) —
same discipline the point-query module itself set.

**What was tried first and rejected, stated rather than hidden**: the module
header's own guess was a `WCS GetCoverage` raw-grid extract. `DescribeCoverage`
confirms GeoTIFF is a supported format, but the actual served GeoTIFF turned
out to be a **tiled** (not simply-stripped) 8-bit palette raster (`TileWidth`/
`TileOffsets` present) — a real TIFF-tile decoder is meaningfully more
implementation risk than this repo's already-trusted pattern, so that path
was dropped in favour of **PNG**, which the coverage also serves and which
decodes with the exact same `decodeImageBytes` canvas helper NVIS's own area
raster already uses (now exported from `nvisVegetationService.ts` for reuse,
rather than a second copy of the canvas-decode boilerplate).

**What was verified live, precisely, before writing any resolution logic**:
- A 1×1-pixel `WCS GetCoverage` request at a known coordinate returned the
  identical raw value (`1`) as the point-query function's own `GetFeatureInfo`
  call at the same coordinate — confirming the PNG path answers the same
  question as the trusted point path, just needing a colour-legend match
  (RGB) rather than exposing the raw index directly (GD renumbers its own
  per-image palette, so the *index* isn't portable across requests — the
  *colour* is).
- **WCS 1.0.0's BBOX axis order for `CRS=EPSG:4326` on this server is
  (lng,lat)** — confirmed by a live request that correctly returned the
  known point's value. This is the OPPOSITE of what WMS 1.3.0 uses for the
  same EPSG code (which is exactly why the point-query function sidesteps
  the ambiguity with `CRS:84` instead) — an easy way to silently mirror the
  whole sampled grid if assumed rather than checked, so it's called out
  explicitly in `buildNAFIAreaCoverageUrl`'s own doc comment.
- **The "no plausible answer" signal is PNG alpha, not a specific colour**:
  a known open-ocean point (raw value `11` via `GetFeatureInfo`, i.e. past
  `MAX_PLAUSIBLE_YEARS.last10`) rendered fully **transparent** (alpha 0) via
  the PNG area path at the identical coordinate — so the area path reuses
  exactly the same "positive NoData short-circuits, never treated as a
  fabricated value" convention NVIS's own raster already established,
  rather than inventing a new one.
- **The colour legend was read from the server's own GeoTIFF `ColorMap` tag**
  directly (not eyeballed off a rendered image) — 10 distinct colours for
  `tslb_last10_250m` (years 1-10), 26 for `tslb_longterm_250m` (years 1-26),
  transcribed verbatim into `NAFI_LEGEND_LAST10`/`NAFI_LEGEND_LONGTERM`.
- **A genuine, source-side ambiguity found and preserved, not smoothed over**:
  `tslb_longterm_250m`'s palette renders years 22-26 in the IDENTICAL colour
  `(53,80,89)` — confirmed from the raw ColorMap tag, so it's the source's
  own design choice (a flattened ramp tail), not a decode bug. A colour match
  against that shared colour genuinely cannot recover which of the five
  years it is. Resolved to the **highest** tied year (26), flagged
  `coarseBand: true` per-pixel — the conservative direction for a mobility
  tool (longer time-since-fire generally means more regrowth/harder going,
  and this project's standing rule is to never understate difficulty on
  ambiguous data, the same reasoning the cross-slope proxy's own
  "worst-case in this cell's direction" choice used in §27).

**API shape** (`nafiFireHistoryService.ts`): `fetchNAFITimeSinceFireArea(bounds)`
fetches BOTH windows as ONE PNG each — **2 upstream requests total for a
whole grid, not one per cell** (the exact discipline the module header
demanded, matching NVIS's "one export image per corridor" convention) —
decodes both, and resolves a per-pixel `NAFIAreaRaster` (`years` Int16Array,
`-1` sentinel for no plausible answer; `window` Int8Array recording WHICH
layer actually answered each pixel — tracked directly during resolution,
not inferred from the years value afterward, since last10 and longterm's
legends overlap in range and a post-hoc guess would be wrong for a real
fraction of pixels; `coarseBand`/`estimated` Uint8Arrays). `sampleNAFIAreaRaster(raster, lat, lng)`
mirrors NVIS's `rasterCodeAt` contract exactly (null outside the raster's own
bounds, same pixel-index arithmetic) and returns the *same*
`NAFITimeSinceFireResult` shape the point-query function already returns, so
a caller can use either interchangeably. Export sized to a request-count-
bounded cap (`MAX_AREA_PX = 400`, mirroring NVIS's own `MAX_EXPORT_PX`) —
large AOIs get a coarser raster, never a bigger request.

**Deliberately NOT done in this pass, stated plainly rather than silently
dropped:**
- **Not wired into `mobilityGrid.ts`/`MobilityGridCell`/the cost model.** The
  backlog item asked specifically for "an area-query mechanism... so Tier 1
  data CAN be sampled per grid cell" — that mechanism is what this section
  delivers. Actually consuming it (adding a years-since-fire field to
  `MobilityGridCell`, and deciding HOW it should modulate structure/
  trafficability alongside vegetation type — docs §10.3(c) names the
  combination as the target, but the actual weighting is its own calibration
  decision) is a separate design pass, not folded in here under time
  pressure — doing that hastily is exactly the kind of under-verified
  wiring this project's data-honesty rule warns against.
- **DEA's own fractional-cover/water-observations layers are NOT covered.**
  `deaOwsClient.ts` is a genuinely different server (`datacube-ows`, not
  GeoServer), a different response shape, and was not re-investigated for an
  area-query form this pass — its own area mechanism, if built, needs its
  own live verification pass exactly like this one, not an assumption that
  NAFI's approach transfers.

**Verification**: `tsc --noEmit`/`npm run build` clean. A standalone Node
smoke test (real module, disposable vite lib-mode entry, deleted before
commit) covers everything that's pure and doesn't need a browser: exact and
near (anti-aliased) colour matches for both legends, the 22-26 tie resolving
to 26 with `coarseBand: true`, no match for an unrelated colour, the WCS URL's
`(lng,lat)` BBOX order and PNG format, and `sampleNAFIAreaRaster` against a
hand-built synthetic raster (a `-1`-sentinel pixel returns null rather than a
fabricated year, a resolved pixel carries the right window/confidence/coarse
caveat, a point outside the raster's bounds returns null). The actual
`fetch()` + canvas-decode path (`fetchNAFITimeSinceFireArea` itself) is
**not** testable in this sandbox — browser-only, the same accepted limitation
`decodeImageBytes`'s own doc comment already states for NVIS's equivalent —
**confirm the live fetch path once deployed** (the URL construction, colour
legend and pixel arithmetic it depends on are what's actually verified here).

---

## 32. Probabilistic movement — the simulation becomes the engine (2026-07-27)

Owner, in two parts on the same day:

> "The simulate movement draws a single line very quickly. This app is trying
> to simulate *likely* movement pathways. To an extent there is a degree of
> probability that over the course of many simulations units take common paths
> through the various starting and end points. Moving more slowly or around
> obstacles... We need to account for the unknown of what the moving unit will
> TRY to do, as they progress from cell to cell and make the next routing
> decision."

> "That movement sim model should be the crux of the recommendations and the
> ultimate pathways through. Think of it as if you were in that vehicle and set
> off in the direction of where you were heading, you might take roads and
> highways as a preference until they're blocked or denied. A longer route
> would be assumed to be quicker on a road. Going cross country then brings
> into scope all of the vegetation and landscape elements. I would expect our
> model to account for an 'unrestricted' set of movement corridors, and then
> add in a set of recommended restrictions like road blocking."

### The gap this closes

Everything this mode computed before Pass 5 was an **optimiser's** answer: the
cheapest path (`extractPath`), or k cheapest paths under iterative edge
penalties (`corridorField.ts` §28). Those are correct as analysis, and the
corridor bands honestly widened them — but every one of them is a global
optimum computed with perfect knowledge of the whole grid. A real unit does not
solve Dijkstra over ground it has not seen. It heads for the objective, prefers
the road it is on, decides from what it can perceive, and finds out about the
gully when it reaches the gully.

### `movementSimulation.ts` — the model

A mover on cell `u` scores each traversable neighbour `v` by the total
remaining time it *believes* that step commits it to, and samples:

```
score(v) = edgeTime(u→v) + perceivedToGo(v) + turn + revisit + network
P(v)     ∝ exp( −score(v) / τ )
```

Four terms, each carrying one idea:

| Term | What it represents | Parameter |
|---|---|---|
| `network` | Road preference. Leaving the trail/road network costs believed time; rejoining credits it. **The first-order route decision.** | `roadAffinitySeconds`, from the profile's kind × the spread |
| `perceivedToGo` | `k · trueToGo + (1−k) · naiveToGo`. `trueToGo` is the exact reverse cost field (`runCostToGoSearch`); `naiveToGo` is straight-line ÷ nominal speed — a map-and-compass estimate. | `terrainKnowledge` k ∈ [0,1] |
| softmax `τ` | Decision noise, in SECONDS of believed journey time: "differences smaller than ~τ do not reliably decide which way this mover turns." | `decisionTemperatureSeconds` |
| `turn` / `revisit` | Momentum, and not orbiting the same few cells. | assumed constants |

**The property that makes it work: the mover pays the REAL edge cost whatever
it believed.** Belief steers the choice; terrain charges for it. A
low-knowledge mover commits to a bearing, walks into ground that costs more
than it expected, and works around it — arriving later than the optimiser's
figure. Nothing is scripted; it falls out of the same `edgeMobilityCost`
everything else in this mode uses, so the ensemble can never show movement the
analysis calls impossible.

At τ→0, k→1, road affinity→0, this collapses to the deterministic single line
that used to be the whole answer. The old result is a limiting case of the new
one, not a competing one.

**Road preference is why vegetation matters at the right time.** With a road
present, a wheeled profile's simulated movement is overwhelmingly on it, and
the vegetation/structure model barely binds. Deny the road, and movement is
pushed into ground where gap width, stem diameter and side-slope decide
everything. That ordering is the owner's stated mental model, and it is now the
model's behaviour rather than a description of it.

### One supporting fix in the cost model

`mobilityCost.ts` used the **off-path** Irmischer & Clarke function for every
foot movement, including movement along a formed track — so a road was worth
literally nothing to a foot profile. Both published functions were already in
the module with exactly that distinction documented (Tobler is the *on-path*
hiking function). Each is now applied to the case it was calibrated for. This
was invisible while movement was solved as a cost field and became obvious the
moment it was simulated as a route *choice*.

### `restrictionPlanner.ts` — recommended restrictions

The actionable half. Not a scoring formula — **re-simulation**:

1. Rank candidate edges by how many simulated movers actually crossed them
   (`edgeTransit` from the baseline), preferring edges where both cells are on
   the network: a road block is cheap, doctrinally ordinary, and per the
   baseline is where the traffic is.
2. Greedily, one at a time: re-run a reduced ensemble (70 movers — enough to
   *rank*) with each shortlisted candidate added to the set already chosen,
   keep the one that hurts movement most, record its **marginal** effect,
   repeat. The chosen set is then re-run at full mover count for the figures
   actually shown.

Greedy and iterative for the reason that justifies simulating at all: blocking
the best road does not remove that traffic, it **moves** it — onto the next
road, and eventually into the bush where a different set of terrain factors
binds. Only re-running against the partially-restricted world shows where it
went, so each recommendation is made against the world the previous ones
created.

**What it refuses to do**: if the best remaining candidate buys less than
`MIN_MEANINGFUL_EFFECT_SECONDS` (2 min of median delay), planning stops and
reports the bypass. Terrain that offers a free bypass cannot be denied by
blocking points, and padding the list with measures that achieve nothing would
be worse than a short list — the same finding §28's `unconstrained` reports,
reached from the other direction.

### Corridors are now built from the simulation

`buildCorridorField` gained `routesOverride` / `evidence` /
`weightByAttractiveness`, so the **identical** density → smooth → segment →
metrics pipeline serves either evidence base. `CorridorField.evidence`
(`'optimiser-routes' | 'simulated-movers'`) travels with the field and is
surfaced in the panel, the map key, the GIS export attributes
(`evidence` + `evidence_note`) and the assistant briefing — because
"180" means something different when it counts simulated movers rather than
computed optimal routes, and a reader has no other way to tell.

The optimiser field is still computed and kept as `optimiserCorridorField`:
chokepoints and the min-cut are graph properties of the *route* set, and
"where the best routes are" vs "where movers went" is itself informative.

### Honesty boundary — the part that must not be lost

The **terrain** is the same measured/estimated data with the same Tier 0/1
flags. The **behaviour** parameters (τ, the k distribution, road affinity, turn
and revisit penalties, step budget, the unreachable-lookahead constant, and the
denial-equivalent seconds the planner ranks with) are **ASSUMED**. No source
was found that calibrates how a real unit trades believed remaining time
against local effort, and none is claimed. The ordering of the road-affinity
figures by mover kind is defensible from the physical facts the profiles
already encode; the magnitudes are engineering choices.

Therefore a transit frequency is *"the share of simulated movers under this
behaviour model that crossed this cell"*, never *"the probability a real unit
goes here"*. Everything the module returns carries `behaviourModelled: true`,
the panel leads with the behaviour selector rather than burying it in a
footnote, the map key marks the modelled entries, and the assistant template
states the caveat whenever a simulated figure appears. The restriction
planner's delay figures are siting **priorities**, deliberately distinct from
`delayLedger.ts`'s engineering build/breach ledger — different questions, kept
apart.

### Verification

`tsc --noEmit` and `npm run build` clean on `webapp/` and `api/`;
`npm run test:unit` green (12 new checks added to
`api/src/test/mobilityAssistant.test.ts` covering the new payload blocks, the
evidence labelling, the bypass finding, backward compatibility with payloads
that lack them, and validator rejection of half-formed ones).

A 39-check standalone Node smoke test over the real modules (disposable vite
lib-mode entry, deleted before commit) built a synthetic AOI with a road across
otherwise heavy scrub and asserted: every mover accounted for; percentiles
ordered; simulated median ≥ the optimiser's best; same seed → identical
ensemble and different seed → a different one; **a wheeled profile's movement
stays on the road when one exists and is entirely cross-country when it does
not, and the road makes the journey faster**; familiar movers spread over less
ground and arrive sooner than unfamiliar ones; no mover ever crosses a blocked
edge; corridors build from ensemble tracks; the planner prefers road blocks,
ranks 1..n, blocks both directions, and blocking the road both **doubles the
median journey and pushes movement cross-country** (23% → 41%); and empty
origin/objective return null rather than an invented ensemble.

**One real defect the test caught.** `crossCountryFraction` was first
implemented as a pooled count of every step by every mover. A mover that never
arrives runs to the full step budget (~130 steps) while one that drives down
the road finishes in ~29, so a handful of stranded movers thrashing in the bush
outweighed everyone who succeeded: an ensemble whose every individual track was
4–7% off-road reported **46% off-road overall**. Now a per-mover mean — one
mover, one vote — which still counts a stranded mover at 1.0 but never more.

Map rendering is unverifiable in this sandbox (no Mapbox token) — **confirm on
the live preview**.

### Still open

- Road **class** is not modelled: `onTrail` is a single boolean from OSM, so a
  highway and a farm track are the same thing to the mover. Road affinity and
  speed should differ between them, and the data to do it (OSM `highway=*`) is
  already being fetched and discarded. This is the largest remaining fidelity
  gap in the new model and the natural next step.
- Restrictions are sited on grid EDGES, so a recommendation's spatial precision
  is the hex resolution, not a surveyed point on a road.
- The recommended set is not costed. Which of two equally-effective blocks is
  cheaper to emplace is `delayLedger.ts`'s question and the two are not yet
  joined up.

---

## 33. Terrain-mode UI clarity pass (2026-07-27)

Eight field-reported items, all in one round. Recorded together because they
share one cause: the mode had accumulated real analytical depth with no
corresponding investment in reading it.

1. **Brush cursor.** A ring drawn at the brush's actual on-screen radius
   (`BRUSH_PIXEL_RADIUS`), coloured by role and switching to a dashed danger
   ring for erase. Since the brush is *defined* in screen pixels, the ring is
   an exact preview of the next dab at any zoom, not an approximation.
2. **Painting guidance, and painting during the drag.** A dismissible hint
   while a role is armed. The "happens at the end" symptom was a real
   performance bug, not a missing feature: painting did fire per dab, but the
   render replayed **every** stroke through `@turf`'s polygon booleans on every
   one of them — quadratic, and real work each time, so a long stroke fell
   behind the finger and the shape landed in a lump at mouse-up. A drag only
   ever *appends*, so `applyStrokes` now folds new strokes onto a cached
   accumulator; any other change still does a full replay.
3. **Hold to pan.** Space (or Alt) temporarily hands `dragPan` back and
   suppresses painting, with a badge while held. Registered on `window` (the
   canvas is not focusable), guarded against firing inside form fields, and
   released on window blur so a lost keyup cannot strand the tool in pan mode.
4. **Progress.** `runMobilityAppreciation` never emitted progress at all — the
   option existed and App.tsx did not pass it. Now: named stages
   (`MobilityStage`), a bar and the latest real log line in an on-map HUD, and
   — the part that actually helps — `onPreviewCells` paints the terrain-only
   classified grid as soon as sampling finishes, so the map fills in while the
   search, ensemble and planner are still working. The progress budget was
   rebalanced (sampling 0→0.45) because the simulation stages are now real work
   of comparable length.
5. **Map key.** `MobilityLegend.tsx`, listing only what is actually drawn — a
   key showing absent symbols is worse than none — and marking which entries
   are modelled behaviour rather than a property of the ground.
6. **Overlay opacity.** One slider, applied as a **multiplier** on each layer's
   own designed opacity (`registerOverlayOpacity`), so the meanings already
   encoded in opacity — the corridor density gradient, the isochrone field's
   unreached dimming — survive being faded. Painted AOIs are deliberately
   excluded: they are the user's input, not a result.
7. See §32.
8. **Corridors made legible.** The band-only render was the right honesty
   statement and unreadable as a shape. Now four paired layers: the density
   fill (unchanged in meaning), a **dissolved outline** per corridor (a real
   `@turf/union` of its own hexes, so it is the actual extent), a brighter
   spine at high density, and the analysed tracks as hairlines on top. Plus an
   on-map label per corridor and a selection that dims every band but one,
   driven from either the panel card or the band itself.

Recommended restrictions render as numbered heavy bars between two real cell
centres — never an invented point along an edge, matching §29's export rule.

**Verification**: `tsc --noEmit`/`npm run build` clean. Map rendering and the
touch/keyboard interactions are unverifiable in this sandbox — **confirm on the
live preview**.


---

## 34. Hydrology — waterways as a real barrier, not silently invisible (2026-07-27)

Owner, reviewing the shipped Terrain Mobility mode:

> "I can see substantial waterways in my sample area but they don't seem to
> form a 'barrier' in the overlay analysis. If they are being considered then
> we need to show more of that. This is an initial planning aid and
> considerations tool, not necessarily down to the specific plan being spit
> out. I need to get credible buy-in for the analysis early."

And, in the same round:

> "Do we need smaller grid sample areas for specifics along corridors etc. At
> the moment the cells are very large so elevation specifics and smaller but
> significant landscape is being lost."

### The finding, before any fix

Investigation (not guesswork) turned up four independent facts, each verified
by reading the actual code and, where a new endpoint was needed, by live
`curl` against the real service — this project's standing discipline for a new
data source:

1. **NVIS actively mislabels water as the EASIEST terrain.**
   `nvisVegetationService.ts`'s MVG code 24 ("Inland Aquatic — freshwater, salt
   lakes, lagoons") and any label matching `water|lake|sea|estuar|salt lake`
   resolved to `vegetation: 'grassland'` — the same bucket as open, fast,
   easy-to-cross ground. A river read to the cost model as GO terrain, not an
   obstacle. Not a gap — an active mislabel, and the actual mechanism behind
   the symptom reported.
2. **A live-verified DEA Water Observations client existed and was never
   called.** `deaWaterObservationsService.ts`'s point-query function was
   built, tested, cited — and never wired into `mobilityGrid.ts`'s sampling.
3. **`fordingDepthM` — real, sourced figures on every mover profile — was
   never read anywhere.** Declared on the profile schema, populated (0.7 m for
   a light 4WD, 1.2 m for a tracked IFV, …), and dead: no caller of
   `edgeMobilityCost` ever consulted it.
4. **No linear watercourse geometry was fetched at all.** The Overpass query
   in `infrastructureService.ts` only ever asked for `highway=*`.

The panel's own limitations footer already half-admitted this ("surface-water
(Tier 1)... built but not yet sampled per cell") — but a footnote nobody reads
undersold how bad it actually was: a river wasn't unsampled ground, it was
coded as *easier* than the vegetation on either bank.

### Why this did NOT need a finer grid (answering the second question first)

The grid-resolution question is real and worth its own numbers: at
`TARGET_CELL_COUNT = 2200`, a typical 4 km × 2 km two-AOI run produces hexes
roughly **65 m flat-to-flat**; an 8 km × 4 km AOI coarsens to roughly **130 m**.
A 10–30 m river sits well inside a single hex alongside dry land on both
sides — genuinely too coarse to resolve as an AREAL classification.

But a watercourse is not an areal property, it's a **linear barrier**, and the
existing per-cell architecture (classify the ground a hex sits on) was never
going to represent that well at ANY affordable resolution — uniformly
shrinking the grid to catch a 20 m river would blow the 2200–2800 cell compute
budget this mode is deliberately capped at (docs §8). The right fix is
resolution-INDEPENDENT: test proximity to the real vector geometry at multiple
points per cell (its centre AND its six hex corners — not centre alone, which
is what `onTrail` already accepts as adequate for the identical problem with
roads), so a narrow feature clipping a hex's edge is still caught even when
the hex's centre sits on dry land. This is the same order-of-magnitude
resolution improvement a full grid refinement would have bought, without the
compute-budget cost or the risk of touching the hot-path search's core
tiling assumptions. **Uniform grid refinement for fine elevation detail (a
genuinely separate ask — gullies, knolls, micro-terrain) remains open**, and
is recorded under "Still open" below rather than folded into this pass.

### The fix

**`waterInfrastructure` (via `infrastructureService.ts`, both API and
webapp)**: the existing Overpass proxy/direct-endpoint machinery generalised
with a `kind: 'highway' | 'water'` parameter rather than a second endpoint —
`waterway=river|canal|stream` and `natural=water` queried the same way roads
already are. `distanceToNearestWater` extends the existing polyline-distance
test with a point-in-polygon check (`@turf/boolean-point-in-polygon`, already
a project dependency) for `natural=water` bodies — a lake's EDGE-distance
alone would say a point in the middle of a large lake is far from "the trail",
which is backwards for a filled body; a mover standing in the middle of a lake
IS water, not near it.

**`deaWaterObservationsService.ts` gained an area-raster path
(`fetchSurfaceWaterFrequencyArea`)** for AOIs where OSM tagging is sparse —
ONE request regardless of grid size, matching the discipline `mobilityGrid.ts`
already holds every other sampling call to. LIVE-VERIFIED this session that
this could NOT reuse NAFI's WCS `GetCoverage` pattern: `ga_ls_wo_fq_myear_3`'s
`DescribeCoverage` advertises only GeoTIFF/netCDF, and a live `FORMAT=PNG`
WCS request is rejected outright (confirmed by `curl`) — there is no
browser-native GeoTIFF decoder in this project and one was deliberately not
added to work around a single layer. WMS `GetMap` with `FORMAT=image/png`,
by contrast, IS live-verified to return a real styled PNG. The trade-off
that choice buys: what comes back is a STYLED 8-bit image, not the exact
`frequency` float the existing point-query function reads directly off the
data band, so the area path reconstructs an approximate frequency via
colour-ramp matching against `mysummary_wofs_frequency_blue_3`'s own
`legend.png` (sampled live this session, 23 control points, the same
technique `nvisVegetationService.ts`/`nafiFireHistoryService.ts` already use
for their own legend-coded rasters) — always reported `confidence:
'estimated'`, never conflated with the point function's `'published'` figure.
Sanity-checked against two real scenes this session: Lake Argyle (a known
near-permanent reservoir) matched at frequency ≈0.91 at its centre; a Sydney
Harbour-area bbox correctly left 363/400 sampled land pixels unmatched
(transparent) while matching real water pixels near the harbour/river.

**`MobilityGridCell` gained four hydrology fields** (`waterDistanceM`,
`inWaterBody`, `nearestWaterwayKind`, `waterFrequency`), sampled once per grid
build alongside elevation/vegetation/trail — never per-cell network calls.

**`mobilityCost.ts` gained `estimateFordingRequirement`** — the same class of
Tier 0 engineering assumption `estimateStructureFromVegetation` already makes
for vegetation gap width, held to the same honesty rule (always `estimated:
true`, a class-representative figure, never a measured per-crossing depth,
because no source in this app measures actual river depth at a point). OSM
tag class wins when present (a human classification of what the feature IS)
over WOfS frequency (only a symptom of it being wet): body > river/canal >
stream > high-frequency-untagged > moderate-frequency-untagged > nothing.

**`edgeMobilityCost` gates on it** exactly where every other hard constraint
in that function already gates — NO-GO when the assumed depth exceeds the
profile's `fordingDepthM` (finally live), SLOW-GO with a genuine speed penalty
when it's within capability (a passable ford is never as fast as the same
distance on dry ground). **Skipped when both ends of the edge are on the
mapped trail/road network** — the exact same "ground here is already broken"
idiom the vegetation gate already uses for `onTrail`, on the reasoning that a
road crossing a mapped watercourse implies a bridge/causeway/ford the network
already accounts for. `classifyCellTerrain`'s direct terrain-only
classification got the identical gate, so the GO/SLOW-GO/NO-GO overlay agrees
with what the search would actually do arriving into that cell.

**Every call site that builds an edge's `from`/`to` sample now goes through
one new function, `toMobilitySample` (`accumulatedCost.ts`)**, rather than
each hand-writing the object literal — `accumulatedCost.ts` itself,
`corridorField.ts`, `minCutBarrier.ts`, `movementSimulation.ts`. This exists
specifically so a field added to the hydrology (or any future) extension can't
silently go stale at one call site while every other caller picks it up —
exactly the failure mode a hand-audited grep for `vegEstimated:` across the
codebase turned up before this refactor (8 near-identical object literals,
already drifting from each other's exact field lists).

**Map + panel**: the real OSM waterway/water-body geometry now travels through
`MobilityGridResult` → `MobilityAppreciationResult` → the map as its own
reference layer (`mobility-water-line`/`mobility-water-body`) — a bold blue
line/casing for a river/canal/stream, a filled polygon for a standing body —
independent of any hex cell it influenced, so a reviewer sees the actual
mapped river the gate is reacting to, not just scattered red hexes near it.
The map key gained a "Waterways & water bodies" section. The run log reports a
real computed count (`N/M CELLS CARRY A WATER SIGNAL`), not a claim — the
single most direct way to answer "is this actually being considered" without
having to trust the model's word for it.

### Honesty boundary

The water GEOMETRY (OSM tags) is real, human-mapped data — as reliable as the
trail data this mode already leans on, with the identical "OSM completeness
varies in remote areas" caveat. The WOfS frequency is REAL MEASUREMENT
(satellite-observed, not modelled) but reconstructed through a colour-ramp
approximation, `estimated`, not `published`. The DEPTH assumed for the
fording gate is entirely engineering judgement — no source in this app
measures actual crossing depth — held to the identical Tier 0 discipline
`estimateStructureFromVegetation` already established for vegetation
structure: always flagged, a class-representative figure, never silently
upgraded to a measurement.

### Verification

`tsc --noEmit`/`npm run build` clean on both `webapp/` and `api/`;
`npm run test:unit` unaffected (no API-side behaviour changed beyond the
`kind` query param, itself backward-compatible — omitted `kind` defaults to
the existing `highway` behaviour, verified by re-running the full existing
suite green).

A 29-check standalone smoke test over the real modules (disposable vite
lib-mode entry, deleted before commit) covered: `estimateFordingRequirement`'s
severity ordering (body > river > stream, WOfS frequency as a fallback signal,
no false positives on trace-frequency damp ground); `edgeMobilityCost`
genuinely NO-GOing a vehicle at a mapped river beyond its fording limit while
passing a shallow stream as SLOW-GO with a real speed penalty; the `onTrail`
bridge exemption; a foot profile gated identically to a vehicle;
`distanceToNearestWater`'s point-in-polygon correctness for a lake vs a plain
line for a river; and the WOfS colour-ramp matcher against its own live-derived
control points, including correctly REJECTING an unrelated colour rather than
force-matching it.

**The test that matters most**, and the one that directly answers the field
report: a synthetic AOI with a real river band (wide enough to span multiple
hex columns — narrower bands leave gaps a route can weave through between
staggered rows, a property of hex tiling caught and fixed while building this
test) severing an origin from an objective, with one bridge crossing.
Confirmed: (a) a route is found and it genuinely uses the bridge, never
crossing the river off it; (b) remove the bridge, and the SAME river now
**actually severs the AOI** — `extractPath` returns null, no route exists; (c)
as a control, the identical river with its water signal stripped (the
pre-fix state) does NOT block movement — proving the test exercises the fix,
not something else.

Live map rendering is unverifiable in this sandbox (no Mapbox token) —
**confirm the water reference layer and the GO/SLOW-GO/NO-GO overlay's
reaction to a real waterway on the live preview.**

### Still open

- **Road/water CLASS is a single OSM tag with no further nuance** — `waterway=
  river` always assumes 1.2 m regardless of whether it's a wide lowland river
  or a modest highland one; there is no per-crossing measured depth anywhere
  in this stack, and none exists in open Australian data at the resolution
  this mode operates at.
- **Uniform fine-grained elevation resolution remains open** (the second half
  of the owner's question) — this pass fixed the LINEAR-barrier case
  (resolution-independent by construction), not areal micro-terrain
  (gullies, knolls) which genuinely needs either a finer grid within the
  existing compute budget or an adaptive/corridor-focused tiling scheme —
  a materially larger architecture change (hex adjacency, `demDerivatives.ts`'s
  neighbour-based plane fit, and `corridorField.ts`'s smoothing all currently
  assume a UNIFORM hex size) than this pass, deliberately not attempted here.
- GIS export (`mobilityGisExport.ts`) and the AI assistant payload
  (`mobilityAssistantApi.ts`) do not yet carry hydrology-specific attributes —
  the water reference layer and gate are visible on the map/panel/log, but a
  downloaded GIS pack or an AI briefing doesn't yet name which cells were
  water-gated specifically (it inherits the general
  `estimated`/`blockedReason` fields, just not a dedicated hydrology summary).
- Relations (multipolygon lakes, common for larger water bodies in OSM) are
  not fetched — only `way`-tagged features, matching the existing trail
  fetcher's own way-only scope.

### §34 follow-up: end-to-end review fixes (2026-07-27)

A full read-through of the PR (logic, UI wiring, mobile usability) turned up
two real gaps in the hydrology pass above, both fixed in `mobilityGrid.ts`:

- **Lake-edge cells were missing the gate.** `inWaterBody` was computed at the
  hex CENTRE only, while `waterDistanceM`/`nearestWaterwayKind` already used
  centre+corners. A cell whose CORNER (not centre) clipped a lake got
  `waterDistanceM = 0` (correctly detected) but `inWaterBody = false` AND
  `nearestWaterwayKind = null` (the corner search deliberately skips `'water'`-
  kind features, by design — see the fix above), so `estimateFordingRequirement`
  returned `null` and the gate silently never fired for that cell. Fixed:
  `inWaterBody` now checks all sample points (centre + six corners) against
  water-body features, not the centre alone.
- **`usedEstimatedData` didn't know about hydrology.** The top-level honesty
  flag on `MobilityGridResult` only OR'd elevation/vegetation estimation —
  a run entirely shaped by an assumed fording depth (always Tier 0 by design)
  could show no "CAUTION — ESTIMATED DATA" warning at all. Fixed: it now also
  ORs in whether any cell carries a water signal (in a body, near a mapped
  linear watercourse, or above the WOfS frequency threshold) — the same
  predicate `mobilityAppreciation.ts`'s log line already computed for its own
  count, now also driving the honesty flag itself.

Also fixed, mobile usability: on a narrow viewport the run-progress HUD and
the map key were BOTH pinned to `bottom: 12px` and stretched full-width —
directly contradicting the comment above that rule ("must not fight for the
same corner on a phone"). Since the legend can be visible as soon as an area
is painted and the HUD appears the moment a run starts, both can legitimately
be on-screen together; they now split the bottom edge left/right on mobile
instead of overlapping.

UI wiring (`MapboxMapView`/`MobilityPanel` prop interfaces vs. their call
sites in `App.tsx`, the simulation-controller handlers, touch/pinch painting)
was reviewed and found correctly connected — no further gaps found.

---

## 35. The bounding box is the bug — lazy grid, cost budget, corridor-count stop (design, 2026-07-27)

**Status (2026-07-29): points 1, 2, 3, 5 and 6 of "the design" below — lazy
grid materialisation, the α·C* cost budget, the corridor-count stop rule,
tile-ring data fetch, and honest failure — are BUILT** (steps 45+46,
`mobilityLazyGrid.ts` + `accumulatedCost.ts`'s `resumeFrom` +
`corridorField.ts`'s `riskScore`/`mostLikelyCorridorId`/
`mostRiskyCorridorId`; see "Shipped: lazy grid materialisation" and "Shipped:
α·C* budget + corridor-count stop + risk picks" immediately after the design
below for what actually landed and how it differs from the design as
originally specified). **Only point 4 — the two-pass coarse/fine resolution
split — remains DESIGN ONLY** (deferred, not scheduled; the shipped single-
pass approach already keeps hex size uniform for the whole run, which is
what point 4 was protecting against). The design as originally written is
left below UNCHANGED as the historical reference; do not edit it to match
what shipped — the shipped addenda after it are where implementation
reality lives.

### The field report

Owner ran a west→east crossing of Lake George, NSW:

> "It didn't find pathway because the lake was taller than the survey grid. If
> the system had considered an extra bit of space to the north or south it may
> have found a way."

### The mechanism, confirmed in code

`mobilityGrid.ts:101-112` builds the AOI as the union of the two painted
areas, padded by **20% of that same span**:

```js
const padLat = (maxLat - minLat) * 0.2;   // proportional to the span
```

For a due-west→due-east run, `maxLat - minLat` is only the north–south
*thickness of the two painted blobs* — perhaps 2 km, so the north–south pad is
~400 m. Lake George is ~25 km north–south. Every cell in the crossing band is
water → NO-GO → `extractPath` returns null.

**The padding is proportional to the origin↔objective span, so the geometry
that most needs room to detour receives the least.** A straight run across a
long perpendicular obstacle is the worst case for this formula, and it is
exactly the case a user is most likely to draw.

The failure is not the search — it is that the search was walled in and then
reported "no route" with no way to distinguish *"there is no way"* from *"I
was not allowed to look."* That conflation is the real defect; the missing
route is the symptom.

### Why "just pad more" is not the fix

`chooseHexSize` (line 124-131) sizes hexes to fit ~`TARGET_CELL_COUNT` cells
*inside whatever box it is given*, coarsening up to 5× to stay under
`MAX_HEX_CELLS`. Enlarging the box therefore silently **coarsens resolution** —
firing `usedCoarseGrid` and making cells bigger, the opposite of the owner's
standing "cells are very large, small landscape features are lost" feedback
(§34). Padding trades the reported bug for a previously-reported one.

### The design

**1. Lazy grid materialisation — delete the box.**
Today the entire grid is built first (line 125), then Dijkstra runs inside it.
Invert that: materialise a hex only when the A* frontier reaches it. The
explored region then grows organically into whatever shape the terrain
dictates, and its bounds become an emergent property rather than a declared
rectangle. The search algorithm was never the problem; the pre-materialised
grid was.

Owner's framing — *"every cell could spawn off a path finding direction on the
surrounding cells toward the target… analysed cells organically spread out
from the starting point based on what they find"* — is best-first search
(A*). Implemented as a priority queue plus a visited set, not literal
per-cell spawning (which is exponential).

**2. A cost budget replaces the geometric bound.**
Two phases:
- Phase 1: A* to the objective with no geometric limit → best cost `C*`.
- Phase 2: explore and diversify only within `α · C*`.

That budget is a **travel-time ellipse, not a rectangle**, and it self-sizes:
an easy run stays tight and cheap; Lake George forces a large `C*`, so the
budget automatically opens wide enough to admit the north and south ways
around. The right answer emerges *because* the terrain is hard.

`α = 2.0` default, **user-adjustable** (owner: "2x default with a ui option to
expand or contract"). Time-based, not distance-based, so a fast road detour
correctly beats a short cross-country slog.

**3. Stop on corridor count, not path count.**
Owner: *"the intent is, for any given scenario, identify 2-5 possible travel
'corridors' (noting dozens of adjacent paths form a corridor)."*

This is the primary termination rule — search until 2–5 **distinct corridors**
exist, with `α·C*` and a hard cell ceiling as safety bounds behind it. Routes
staying within a corridor-width of each other are one corridor, not several;
`corridorField.ts` already bundles on exactly this basis, so this is reuse
rather than new clustering machinery.

**4. Two passes, uniform hex size within each.**
Owner asked for adaptive resolution (fine near routes, coarse elsewhere).
Mixed hex sizes in a single graph break `demDerivatives.ts`'s neighbour plane
fit, `corridorField.ts`'s smoothing, and `hexGrid.ts`'s adjacency — the
larger architecture change deferred in §34's Still-open list. Two sequential
passes deliver the same effect without that break:

- **Pass 1 — coarse, wide.** Lazy A* on coarse hexes under the cost budget.
  Answers "where can we get through at all?" and finds the corridor bundles.
- **Pass 2 — fine, narrow.** Lazy A* on fine hexes, materialised only within a
  band around pass-1's routes. Refines them.

Each pass is internally uniform, so nothing downstream needs to change.

**5. Eager coarse tiles, lazy fine cells.**
Lazy cells need data on demand, but the search runs **synchronously** inside
`mobilityWorker.ts`; awaiting a fetch per cell would wreck it. Owner's own
point — *"load data in large bounding box cells but conduct the travel
analysis on a much smaller scale"* — resolves this: fetch sample data in
coarse area tiles (all upstream sampling is already area-batched, one request
each regardless of cell count — see `mobilityGrid.ts`'s own comment at lines
33-41) and expand the tile ring outward when the frontier nears an edge. The
search then pauses at **tile** boundaries, not per cell — a handful of awaits
rather than thousands.

**6. Honest failure.**
With no box, an unreachable objective would otherwise expand forever. A hard
ceiling (max cells / max travel time, both user-configurable per owner) must
produce *"no route found within N hours of travel, M cells explored"* — and
paint the explored frontier on the map so the wall that stopped it is
visible. This is the honesty half of the Lake George bug and matters as much
as finding the route.

### Compute

Today: ~2200–2800 cells over a rectangle, sampled up front, most never
usefully touched. Lazy A* materialises far fewer on a straightforward run and
spends its budget where the terrain demands it — so typical runs should get
**higher resolution and less total work simultaneously**. Worst case
(unreachable objective, budget exhausted) is genuinely expensive, hence the
ceiling above.

### Sequencing: roads first, then landscape

Initially scoped the other way (lazy grid first, roads deferred). Owner
corrected it:

> "Roads matter as they need to be identified to protect or deny rapid
> movement. Then landscape as it's harder to engineer barriers."

That is the stronger ordering, for a reason worth stating explicitly:
**road-network routing is inherently box-free.** You traverse OSM ways
wherever they lead — no tessellation, no bounding box, therefore no Lake
George failure mode at all for vehicle movement. It does not need the lazy
hex grid to work.

- **Slice A — road network graph + routing.** Roads are a *network*; hexes are
  a *tessellation*. Today `onTrail` is a single per-cell boolean, which is
  precisely why road class is still discarded (§32's largest remaining
  fidelity gap). Building a real road graph (nodes/edges from the OSM ways
  already fetched, routed with the same A* machinery on a different edge set)
  fixes Lake George for vehicles, closes the road-class gap, and produces the
  actionable counter-mobility output — you *block a road*; engineering a
  barrier across open landscape is far harder and rarer.
- **Slice B — lazy hex grid.** Everything in §35 above. Still required, but
  scoped to what roads can't answer: off-road and foot movement, and the
  off-road half of the Lake George case.

### Data cost: which layers refine for free (verified 2026-07-27)

Owner asked whether finer hex resolution costs upstream API calls or only
local compute. Checked in code, because §35's fine pass depends on the answer.

**Free per sample point** — one area fetch, decoded locally, then any number
of hexes sampled from it at no marginal upstream cost:

| Layer | Mechanism |
|---|---|
| Vegetation (NVIS/NSW) | ≤2 area requests, sampled locally — `routeOptimizer.ts:352` comments "bulk-resolve from locally-held area data (free per point)" |
| Water (DEA WOfS) | One WMS `GetMap` per bbox, colour-ramp decoded (§34) |
| Fire history (NAFI) | 2 WCS requests per AOI (§31) |
| Elevation — Terrain-RGB *fallback* | Tiles cached in `terrainTileCache`, pixels decoded locally |

**NOT free — the one exception:** elevation's PRIMARY path.
`fetchElevationProfile` POSTs the point list to `/api/elevation/profile`,
which builds an ArcGIS `getSamples` URL with **every point in the query
string** (`elevationService.ts:72`). Point-sampling, not raster: cost scales
linearly with point count, with a hard URL-length ceiling on top of ArcGIS's
own `sampleCount` cap. This is the layer slope and cross-slope depend on, so
naive hex refinement would hit this wall first.

Resolved by the two-pass structure above:
- **Coarse-wide pass** → Terrain-RGB tiles (genuinely raster, already cached,
  ~4–8 m/pixel at z15 — finer than any hex size in use). Unlimited extent at
  no marginal cost.
- **Fine-narrow pass** → bare-earth DEM via *chunked* `getSamples`, over the
  few cells inside a discovered corridor, where the accuracy pays for itself.

**2026-08-17 — the wall got hit for real, because the two-pass split was never
built.** The "Shipped" note directly below records that the lazy-grid work
that landed 2026-07-29 deliberately did NOT implement this two-pass split —
every round still asks for the DEM primary path over its WHOLE materialised
set, uniformly, regardless of scale. `'standard'/'fine'` fidelity's own hard
cell ceilings (`mobilityGrid.ts` `FIDELITY_TIERS`) are 12,000/50,000 — both
routinely past the 5,000-point cap this section already predicted, and in
production that showed up exactly as forecast: `POST /api/elevation/profile`
400s, with `sampleElevationsBatch`'s existing "DEM failed → fall back to
per-point Mapbox" path then firing for the ENTIRE oversized batch — a
request-per-point tile fetch/decode loop, which is what was actually behind
reports of the tab freezing and the map never painting during a real run
(not a rendering bug this time — the WP1/WP4 progressive-paint fixes and
the `mobilityHeatmapForMap` memo fix, PR
[#214](https://github.com/richardthorek/fireBreakCalculator/pull/214), were
both real and correct, but starved of any data to paint if a round's own
elevation fetch never returns).

**Interim fix (not the two-pass redesign above — a smaller, immediately
correct fix underneath it):** `sampleElevationsBatch` now chunks any point
set over the cap into multiple ≤5,000-point DEM requests instead of one
oversized request. Every chunk still gets the fast batched-DEM path
independently; per-point Mapbox fallback now only fires for a chunk whose
OWN request genuinely fails, never for the whole set merely because it
didn't fit in one request. This does not reduce DEM call volume the way the
coarse/fine split would (that remains the real fix, still unbuilt, still
WP6-adjacent) — it just makes the current uniform-resolution pipeline
correct and reasonably fast at any scale instead of silently falling off a
cliff past 5,000 cells.

Caveat on "internal cost": these rasters decode in the **browser** (canvas
`getImageData`), not server-side. The ceiling is client CPU/memory — generous,
but real at very fine resolution over very large areas.

### Deliberately NOT in this design

- **Mixed-size cells in one graph** — superseded by the two-pass approach
  above.

---

### Shipped: lazy grid materialisation + resumable search (2026-07-29, step 45)

Builds points 1 ("delete the box"), 5 ("eager coarse tiles, lazy fine
cells") and 6 ("honest failure") of the design above. Deliberately does
**not** attempt points 2–4 (the `α·C*` ellipse, the corridor-count stop
rule, the two-pass coarse/fine split) — those still govern how the search
decides WHEN it has enough; this pass only changed HOW the grid it searches
gets assembled.

**What actually shipped, and one deliberate simplification from the design
as written:**

- **Tiles, not per-cell materialisation.** The design's point 1 frames this
  as per-CELL lazy materialisation under an A* frontier; point 5 separately
  notes cell-by-cell awaiting would "wreck" the worker's synchronous search
  and proposes coarse-tile batching as the resolution. What's built goes
  straight to tile batching as the ONLY unit of materialisation — a tile
  (~10×10 hexes) is fetched, sampled and added to the grid as one atomic
  batch, never a single cell at a time. This is a simplification of the
  design's two-tier framing (per-cell frontier reasoning, tile-batched I/O
  underneath it), not an addition to it: the frontier check that decides
  WHICH tiles to fetch next still runs per-cell (`mobilityLazyGrid.ts` scans
  every reachable cell's hex neighbours each round), so resolution at the
  frontier is exactly as fine as the design calls for — only the atomic unit
  of "fetch this next" is a tile rather than a cell, which is what point 5
  already required regardless.
- **Resumable Dijkstra, not restart-with-a-bigger-box.** The mechanism that
  makes tile-by-tile growth affordable — `accumulatedCost.ts`'s new
  `resumeFrom` option — isn't named explicitly in the original design text,
  but is exactly what "materialise a hex only when the A* frontier reaches
  it... the explored region grows organically" requires in practice: without
  it, every tile added would force a full grid rebuild + full Dijkstra
  restart, which is functionally the OLD `boundsPadFactor` retry this step
  replaces, just with smaller box-growth increments. `resumeFrom` seeds a
  fresh search's heap from a prior partial result's already-settled `best`/
  `prev` maps — correct because Dijkstra with non-negative edges never
  revises a settled distance once popped, so this is equivalent to having
  run one longer, uninterrupted search all along.
- **Fixed hex size for the whole run**, chosen once from an initial footprint
  sized by the SAME `computePaddedBounds` math the old first attempt used —
  this is what keeps `demDerivatives.ts`, `corridorField.ts`, chokepoints and
  min-cut completely untouched: they still receive one ordinary, uniform-hex,
  finished `MobilityGridCell[]`, exactly as before. A typical short-range run
  (the common case) uses the identical hex count/resolution it always did.
- **Growth stop condition is a cell/tile ceiling, not a cost budget.** This is
  the honest gap versus the full design: point 6 ("honest failure") is built
  — a hard ceiling produces a stated "stopped at the search ceiling, not yet
  proven unreachable" outcome, distinguished in the log/result from a genuine
  terrain enclosure ("the reachable frontier ran out of new ground to grow
  into") — but the ceiling itself is `computeCellBudget`'s existing
  fidelity-tier `hardCeiling` × a fixed multiplier, not the self-sizing
  `α·C*` travel-time ellipse point 2 specifies. That remains the "Slice B
  remainder" item in `master_plan.md`.
- **crossSlopeDeg caveat** (honestly documented, not solved): a cell's local
  plane-fit slope is computed from whichever neighbours are materialised at
  the moment ITS round runs and is never retroactively recomputed once the
  cell is settled — a cell settled at a transient tile edge keeps that
  round's value even if a later round completes its neighbourhood. This is
  the same "incomplete-neighbourhood edge effect" the old fixed-box approach
  already had for its outer ring (a real, pre-existing, accepted
  characteristic of a locally-fit derivative on a finite sample), now
  transient rather than permanent. `crossSlopeDeg` was already documented
  elsewhere as a conservative upper-bound proxy, not a precise per-edge
  figure — this doesn't change what any caller may assume about it.

**Files:** `webapp/src/terrain/mobilityLazyGrid.ts` (new — the tile
partition + materialisation loop), `accumulatedCost.ts` (`resumeFrom` on
`runAccumulatedCostSearch`), `mobilityGrid.ts` (`sampleCellsForHexes`/
`applyCrossSlope` extracted from `buildMobilityGrid`, behaviour-preserving —
`buildMobilityGrid` itself, and its other callers `unitSimulation.ts`/
`roadRouteSearch.ts`, are unchanged), `mobilityWorker.ts`/
`mobilityWorkerClient.ts` (`resumeFrom`/`reach` threaded across the worker
boundary — `Map`s structured-clone natively, same precedent as `RoadGraph`),
`mobilityAppreciation.ts` (the `MAX_ATTEMPTS`/`boundsPadFactor` retry loop
replaced by one call into `runLazyMobilitySearch`).

**Tests:** `resumableSearch.test.ts` (resumed search matches a from-scratch
search over the identical final cell set exactly; never revises an
already-settled distance; a synthetic barrier-with-a-gap grid proven
reachable only once a resumed round materialises the gap's tile, not on the
narrower first round) and `lazyTilePartition.test.ts` (the tile partition
never double-materialises or drops a hex) — both at the engine level, no
network, matching this suite's own established precedent for exactly the
same reason `buildMobilityGrid` itself was never given a full-pipeline test
(the orchestration is network-coupled). Full existing Terrain Mobility test
suite (32 files) still green.

---

### Shipped: α·C* budget + corridor-count stop + risk picks (2026-07-29, step 46)

Closes design points 2 and 3, on top of step 45's lazy loop. Owner:
*"proceed with the Slice B remainder item... ensure every analysis result
has 2-5 corridors surfaced... we should be seeing a 'most likely' and 'most
risky' type of option to inform our planning."* The third ask (risk
labelling) is genuinely new relative to the original §35 design text, not a
gap in it — added here as a natural extension once corridor count became a
real, computed loop signal rather than an afterthought.

**Two-phase growth, exactly as designed:**
- **Phase 1 (unconstrained).** `mobilityLazyGrid.ts` grows with no cost
  limit — only the existing cell/tile/round ceilings — until the objective
  is reached at all. The cheapest confirmed cost at that point is `C*`
  (`costStarSeconds` on the result), the design's own notation.
- **Phase 2 (budgeted).** Once `C*` is known, the frontier-tile computation
  that already decided which tiles to fetch next is filtered to cells whose
  arrival time is `≤ α·C*` — a cell beyond that budget doesn't get to pull
  in new tiles. This is deliberately NOT a literal geometric ellipse drawn
  separately: the design calls the budget "self-sizing," and an isochrone
  boundary (arrival time, following however the terrain actually bends) is
  a MORE self-sizing shape than a mathematical ellipse would be — real
  detours rarely trace an ellipse. `α` defaults to 2.0 and is threaded as an
  option (`LazyMobilitySearchOptions.alpha` →
  `MobilityAppreciationOptions.corridorBudgetAlpha`) matching the design's
  "user-adjustable" call, though no UI control is wired to it yet.

**Corridor count is the PRIMARY stop rule, exactly as the design orders it**
(cost budget and cell/tile ceiling are the safety bounds BEHIND it, not the
main rule): once a route exists, `estimateDistinctCorridorCount` derives up
to 5 dissimilar routes (`corridorAnalysis.ts#findKDissimilarPaths`, capped
at the target so deriving more than needed wastes a search with no decision
value) and clusters them with the IDENTICAL avenue-similarity test the final
presentation pass uses (`corridorField.ts#clusterRoutes`, now exported for
this reuse — deliberately not a second, possibly-disagreeing
approximation). Growth continues (budget/ceiling permitting) while fewer
than 2 distinct avenues are confirmed; stops once 2 are found, capped at 5
regardless of remaining budget. A genuinely single-avenue AOI still gets an
honest 1-corridor result once the α·C* budget or ceiling is real — this is
not a fabrication requirement, it's a "look properly before concluding
there's only one way" requirement.

**Cost note, stated plainly:** unlike step 45 (which added zero cost to the
common single-round case), this DOES add real cost to every run — at least
one `estimateDistinctCorridorCount` call (≤5 searches) once a route is
found, since checking for a second avenue is now unconditional rather than
"stop the instant ANY route exists." This is a deliberate, accepted
trade-off for the explicit "ensure every analysis has 2-5 corridors"
requirement, not a regression of step 45's own "a normal run pays nothing
extra" property for the tile-growth mechanism itself — the added cost is a
handful of cheap searches, not more network fetching or grid rebuilding.

**"Most likely" / "most risky":**
- `CorridorField.mostLikelyCorridorId` — simply the rank-1 corridor's own
  id. No new computation: `rank` was already "carries the most weighted
  movement," this just names that corridor explicitly rather than leaving
  the reader to infer it from sort order.
- `CorridorField.mostRiskyCorridorId` — the corridor with the highest new
  `Corridor.riskScore` (0..1), independent of rank (the busiest corridor is
  very often ALSO the easiest — that's usually why it's busiest — so the
  two ids commonly point at different corridors; that divergence is the
  actual planning value of showing both, not noise to resolve). Formula,
  stated plainly rather than left implicit — the identical honesty framing
  `easeClass`'s own thresholds already carry ("this product's own
  engineering choice... deliberately NOT presented as a doctrinal
  classification"):

  ```
  riskScore = 0.4 × (slowGoFraction + noGoFraction)   — terrain hazard
            + 0.3 × waterCrossingFraction              — fording exposure
            + 0.3 × (1 − pinchRatio)                   — single-point-of-failure throat
  ```

  Every input is a real, already-computed per-corridor fraction — no new
  data source. `pinchRatio` and `waterCrossingFraction` are new PER-corridor
  fields (`CorridorField.pinchRatio` only ever tracked the busiest
  corridor's own throat, not every corridor's). `waterCrossingFraction`
  reuses `carriesWaterSignal` — moved from `mobilityAppreciation.ts` to
  `accumulatedCost.ts` (re-exported from its old location for every existing
  caller) specifically so `corridorField.ts`, a module
  `mobilityAppreciation.ts` itself imports, could call it without a
  circular import.

**Surfaced, not just computed:** the assessment log states which corridor
is which and why (e.g. `MOST LIKELY: CORRIDOR 1 · MOST RISKY: CORRIDOR 2
(38% RISK — 40% SLOW/NO-GO, 25% WATER SIGNAL, PINCH RATIO 0.42)`);
`MobilityPanel.tsx`'s corridor cards gained `[MOST LIKELY]`/`[MOST RISKY]`
pill badges (`.corridor-pick--likely`/`.corridor-pick--risky` in
`styles-tactical.css`, styled to match the existing `.corridor-ease` pattern)
plus a risk/water figure line.

**Files:** `mobilityLazyGrid.ts` (two-phase growth, `estimateDistinctCorridorCount`,
`alpha`/`costStarSeconds`/`corridorCountAtStop`), `corridorField.ts`
(`riskScore`/`pinchRatio`/`waterCrossingFraction` per corridor,
`mostLikelyCorridorId`/`mostRiskyCorridorId` on the field, `clusterRoutes`
exported), `accumulatedCost.ts` (`carriesWaterSignal` relocated),
`mobilityAppreciation.ts` (re-export + new log lines + `corridorBudgetAlpha`
option), `MobilityPanel.tsx`/`styles-tactical.css` (badges).

**Tests:** `corridorRiskAndCount.test.ts` (9 checks) — reuses
`corridorClustering.test.ts`'s proven two-gap barrier fixture, makes ONLY
the south gap a real mapped-stream ford (passable but hazardous for a
profile with fording capability), and proves `riskScore`/
`mostRiskyCorridorId` correctly identify the hazardous avenue specifically
— not just confirming a number moved, confirming it moved for the RIGHT
corridor — plus `clusterRoutes` cluster-count checks (two real gaps → two
clusters; one sealed → one cluster, the exact building block
`estimateDistinctCorridorCount` depends on). Full existing suite (34 files)
still green.

---

## Slice A — road network graph: full design

Implementation-ready. Decisions below are settled; an implementer should not
need to re-derive them.

### What already exists (verified 2026-07-27)

Two findings make this much smaller than it first appears:

1. **The OSM highway class is ALREADY fetched.** `buildQuery` uses `out geom;`,
   which returns every tag on the way, and the response mapper already reads
   `el.tags?.highway` (`infrastructureService.ts:275`, and the API twin at
   `:152`) — then collapses it into a single `kind` string that `onTrail`
   reduces to a boolean. **No Overpass query change is needed to get road
   class.** The data has been arriving all along and being discarded.
2. **`surface`, `tracktype` and `smoothness` are also already in the
   response** for the same reason (`out geom` returns all tags). They need
   only to be *extracted* in the mapper — again, no query change.

So Slice A is predominantly a mapping + cost-model change, not a data
acquisition project.

### The gap that would have bitten us

`REUSABLE_HIGHWAYS = 'track|path|service|unclassified|road|tertiary|secondary|residential'`
(`infrastructureService.ts:30`, mirrored in the API).

That set was chosen for the **fire-break** question — "which highway classes
represent reusable broken ground". It **excludes `motorway`, `trunk` and
`primary`**. For fire-break reuse that is defensible. For mobility and denial
it is backwards: a motorway or primary road is the *fastest* route for an
approaching force and therefore the *highest-value* thing to identify and
deny. A Lake George approach could well run on a highway the query never
returned.

**Required change:** a mobility-specific highway set including
`motorway|trunk|primary` and their `_link` variants. Add as a third
`InfrastructureKind` (e.g. `'highway-mobility'`) rather than widening the
fire-break set — the two use cases genuinely want different sets, and
widening would change fire-break optimizer behaviour as a side effect.
Both copies (`webapp/src/utils/infrastructureService.ts` and
`api/src/services/infrastructureService.ts`) must stay in sync — the API
copy's own comment already mandates this.

### The speed model — sourced, then user-tunable

Owner decision: find a real citation, and make it configurable for
fine-grained adjustment. Both, in that order — sourced defaults the user can
override, never invented numbers presented as fact.

**Source: the OSRM car and foot routing profiles** (Project-OSRM/osrm-backend,
`profiles/car.lua` and `profiles/foot.lua`, values read from the repository
2026-07-27). Chosen because they are open, independently verifiable, in
production use worldwide, and — decisively — keyed to the *exact OSM tags this
app already fetches*, so no translation layer is needed.

**Car — speed by `highway` tag (km/h):**

| Tag | km/h | Tag | km/h |
|---|---|---|---|
| motorway | 90 | tertiary | 40 |
| motorway_link | 45 | tertiary_link | 20 |
| trunk | 85 | unclassified | 25 |
| trunk_link | 40 | residential | 25 |
| primary | 65 | living_street | 10 |
| primary_link | 30 | service | 15 |
| secondary | 55 | | |
| secondary_link | 25 | | |

**Car — `surface` cap (km/h):** asphalt/concrete/paved → uncapped;
cement/compacted/fine_gravel → 80; paving_stones/metal/bricks → 60;
grass/wood/sett/gravel/unpaved/ground/dirt/pebblestone → 40;
cobblestone/clay → 30; earth/stone/rocky/sand → 20; laterite → 15; mud → 10;
ice → 20; snow → 30.

**Car — `tracktype` cap (km/h):** grade1 → 60, grade2 → 40, grade3 → 30,
grade4 → 25, grade5 → 20.

**Car — `smoothness` cap (km/h):** intermediate → 80, bad → 40, very_bad → 20,
horrible → 10, very_horrible → 5, **impassable → 0**.

`tracktype` and `surface` matter disproportionately in rural Australia, where
`highway=track` is extremely common and the grade tag is what actually
separates a graded farm road from a wheel-rut.

**Foot — deliberately NOT class-modulated.** OSRM's foot profile is a flat
5 km/h across *every* highway class, with only surface caps (gravel → 3.75,
mud/sand → 2.5). That is a real finding, not an omission: road class barely
affects walking speed. **Therefore foot profiles keep their existing
Irmischer & Clarke (2018) slope-speed model unchanged**, and road-class
modulation applies to `wheeled`/`tracked` movers only. Applying a car speed
table to a foot mover would be a fabrication.

### How it composes with the existing profiles — modulate, don't replace

`moverProfiles.ts` already carries `roadSpeedKmh` (the vehicle's own capability
on a road) and `crossCountryFactor`. The defect is that `roadSpeedKmh` is a
*single* number — a light 4WD is 60 km/h whether it's on a motorway or a
grade-5 track.

Do **not** replace `roadSpeedKmh`. Compose, exactly as OSRM itself does (the
tag speed capped by surface/tracktype/smoothness):

```
roadClassCeiling = min(
  speedByHighwayTag[way.highway],
  surfaceCap[way.surface]        ?? Infinity,
  tracktypeCap[way.tracktype]    ?? Infinity,
  smoothnessCap[way.smoothness]  ?? Infinity
)

effectiveRoadSpeed = min(profile.roadSpeedKmh, roadClassCeiling)
```

This preserves existing semantics and behaves correctly at both ends:

| Mover | Way | Result |
|---|---|---|
| Light 4WD (60) | motorway (90) | 60 — vehicle-limited |
| Light 4WD (60) | track, grade5 (20) | 20 — road-limited |
| Tracked IFV (~40) | motorway (90) | 40 — vehicle-limited |
| Any vehicle | smoothness=impassable (0) | NO-GO |

`smoothness=impassable → 0` gives a genuine, *sourced* NO-GO — the first road
gate in this app that isn't engineering judgement.

### Honesty classification

This matters and must not be glossed. The existing profile comment
(`moverProfiles.ts:177`) already sets the standard: *"crossCountryFactor and
nightFactor are ESTIMATED, not doctrinally sourced… Flagged rather than
presented as published."*

- **`published`** — the road-class ceiling. Real, citable, verifiable values
  from a production open-source routing engine.
- **`estimated`** — `crossCountryFactor` (unchanged, already flagged).
- **Caveat to state plainly in the UI and the briefing:** OSRM's tables encode
  *civilian driving* speeds — legal and practical road speeds, not military
  off-road capability. For the denial use case that is arguably the *right*
  model (you care how an approaching vehicle actually drives, not its spec
  sheet), but it must be labelled as such and never presented as a
  military-mobility figure.
- **NOT implemented, and worth recording why:** the NATO Reference Mobility
  Model (NRMM) is the doctrinal reference for off-road speed prediction, but
  it is a *physics model* requiring vehicle-specific parameters (cone index,
  power-to-weight, track/tyre geometry) this app has no source for. Citing it
  as if we implemented it would be a fabrication. Referenced as prior art for
  the approach only.

### Configurability (owner requirement) — IMPLEMENTED 2026-07-27

Every table above ships as a **documented default the user can override**:

- `RoadSpeedOverrides` (`roadSpeedModel.ts`) — a per-table, per-tag partial
  record. `roadClassCeiling(way, overrides?)` takes the min across whichever
  tags are present, each independently overridable; an edited component
  flips `RoadClassResult.confidence` from `published` to `user-override`.
- **UI**: `RoadSpeedOverridePanel.tsx`, an editable table for all four tables
  (highway/surface/tracktype/smoothness) in the Terrain panel, directly under
  the mover-profile selector — per-row reset, reset-all, and a header badge
  showing how many classes are currently overridden. States plainly that it
  only affects vehicle-gradient profiles.
- **Plumbing**: threaded as a set-once **global**, not a parameter chased
  through nine files (`edgeMobilityCost` → `runAccumulatedCostSearch` →
  `movementSimulation.ts` → ... ) — `setRoadSpeedOverrides()`, same precedent
  as `infrastructureService.ts`'s `setLocalTrailProvider`. The one real
  subtlety: `mobilityWorker.ts` runs in an actual Web Worker, a SEPARATE
  module instance with no shared memory with the main thread, so the global
  must be set on BOTH sides — once on the main thread at the top of
  `runMobilityAppreciation`, and once per request inside the worker, carried
  over as a plain serialisable field on the request message.
- **Persistence**: `localStorage` (`firebreak.terrainMobility.roadSpeedOverrides.v1`),
  loaded lazily on first render so the very first run after a reload already
  sees any saved overrides.
- **Not yet done, tracked separately** (Next-up in master_plan.md): carrying
  `user-override` confidence into GIS export attributes and the AI briefing
  payload — the override mechanism itself works and is visibly flagged in
  the panel and the run log, but export/briefing wiring is real, separate
  work that was not attempted here rather than claimed done.

### Files

| File | Change |
|---|---|
| `webapp/src/utils/infrastructureService.ts` | Extract `surface`/`tracktype`/`smoothness` in the mapper; add `'highway-mobility'` kind with the wider highway set |
| `api/src/services/infrastructureService.ts` | Mirror both changes exactly (comment at `:28` mandates parity) |
| `webapp/src/terrain/roadSpeedModel.ts` *(new)* | The four sourced tables + `roadClassCeiling()`; pure, no I/O, unit-testable |
| `webapp/src/terrain/roadGraph.ts` *(new)* | Build nodes/edges from OSM ways; shared-node topology; `buildRoadGraph(ways)` → `RoadGraph` |
| `webapp/src/terrain/roadRouting.ts` *(new)* | A* over `RoadGraph`; k-alternatives by edge penalty, reusing `corridorField.ts`'s existing diversification idiom |
| `webapp/src/terrain/moverProfiles.ts` | No table changes; document that `roadSpeedKmh` is now a *ceiling*, composed via `min()` |
| `webapp/src/terrain/mobilityCost.ts` | `edgeMobilityCost` accepts an optional road-class ceiling |
| `webapp/src/terrain/roadRouteSearch.ts` *(new, 2026-07-27)* | Live-pipeline wiring — see "Slice A.9" below |
| `webapp/src/components/RoadSpeedOverridePanel.tsx` *(new, 2026-07-27)* | Config UI |
| Config UI + persistence | ✅ Editable speed table, per-row reset, `user-override` flagging, `localStorage` |

### Tests

Framework-free `node:assert`, matching `api/src/test/analysis.test.ts`:

- `roadClassCeiling` returns the min across tag/surface/tracktype/smoothness.
- `smoothness=impassable` → 0 → NO-GO.
- Composition: vehicle-limited and road-limited cases both bind correctly
  (the 4-row table above makes good test cases).
- Untagged `surface`/`tracktype` fall through to the highway-tag speed rather
  than to zero or `NaN`.
- Foot profiles are **unaffected** by road class — a regression guard on the
  deliberate decision above.
- A user override wins over the sourced default and flips confidence.
- The global-override singleton (`setRoadSpeedOverrides`) is picked up with
  NO explicit argument; an explicit argument still wins over it; clearing it
  reverts to the sourced default.
- **The claim that matters:** a synthetic Lake George — origin west, objective
  east, an impassable water body spanning well beyond the direct corridor, and
  a road running around the northern end. The road route must be found. This
  is the whole point of the slice and must fail before the fix.

### Slice A.9 — the road graph existed but nothing ever called it (2026-07-27)

Found while starting the config-UI item above: `roadGraph.ts`/`roadRouting.ts`
were built and proven correct in isolation (the Lake George synthetic test),
but a repo-wide search turned up **zero** references to either module outside
themselves and their own tests. `mobilityWorker.ts` — the ONLY place a real
run actually searches for a route — only ever ran the hex-grid Dijkstra
(`accumulatedCost.ts`), which still has the padded-box defect this whole
section exists to fix. In plain terms: **the live app did not yet fix Lake
George for vehicles.** The design's own claim ("fixes Lake George for
vehicles... does not need the lazy hex grid to work") was true of the module,
not of the running product.

Root cause: the original 8-step checklist built and proved the road graph but
never had an explicit "wire it into the live search" step — an oversight in
the design, not a skipped implementation step.

**Fix**: `roadRouteSearch.ts` (new) — `findVehicleRoadRoute(origin, objective,
roadWays, profile, overrides?)`. Builds a `RoadGraph` from `MobilityGridResult.roadWays`
(a new field, populated from the SAME `highway-mobility` fetch `mobilityGrid.ts`
already made — no second network round-trip), snaps each painted area's
bounding-box centroid onto the graph via a new `nodesWithin()` (all nodes
within 3 km, not just the single nearest — a painted AREA has no one "correct"
access point), and runs `findRoadRoute`. Called from `mobilityAppreciation.ts`
right after the grid resolves, for `vehicle-gradient` profiles only, and
logged/drawn on the map (`road-route-line`, amber dashed) as its own overlay.

**Deliberately additive, not fused**: this result sits ALONGSIDE the hex-grid
search's path/corridors/simulation, which is unchanged and still runs. A
vehicle profile at Lake George now gets a real, correct road route even when
the hex-grid search inside its padded box finds nothing — the actual
field-reported bug is fixed for vehicles — but movement simulation,
chokepoints and min-cut do not yet see road-graph routes. Fusing the two
into one search is real future work, not attempted here.

**Honesty on scope**: the reported route runs road-access-point to
road-access-point — it explicitly does NOT include the off-road leg from a
painted area to the road or from the road back to the painted area. Stated in
both the log line and the map legend, never presented as a door-to-door ETA.

Proven by `roadRouteSearch.test.ts` — the SAME synthetic Lake George geometry
as `lakeGeorgeRoadRouting.test.ts`, but exercised through `findVehicleRoadRoute`
with `PaintedArea` inputs (what the app actually has), not raw graph node IDs
(what the isolated test used) — closing the exact gap this section reports.

---

## Implementation handoff checklist

Ordered. Each step is independently verifiable; do not start the next until
the previous is green.

**Slice A — roads (fixes Lake George for vehicles, box-free by construction)**

1. ✅ Extract `surface`/`tracktype`/`smoothness` in both `infrastructureService`
   copies. Verify parity between the webapp and API sets.
2. ✅ Add the `'highway-mobility'` kind with motorway/trunk/primary included.
   Confirm the fire-break optimizer's behaviour is unchanged.
3. ✅ `roadSpeedModel.ts` with the four sourced tables + tests.
4. ✅ `roadGraph.ts` — build the network; test connectivity on a synthetic set.
5. ✅ `roadRouting.ts` — A*, then k-alternatives by penalty.
6. ✅ Compose into `mobilityCost.ts` via `min()`; regression-test that foot
   profiles are untouched.
7. ✅ Config UI + `user-override` flagging. (Export/briefing carry-through
   still open — tracked separately, not blocking.)
8. ✅ The Lake George synthetic test must pass.
9. ✅ **(A.9, found mid-step-7)** Wire the road graph into the actual LIVE
   search — steps 1–8 built and proved the module correct in isolation but
   nothing in the running app ever called it. See "Slice A.9" above.

**Slice B — lazy grid (off-road; everything in §35 above)**

10. ⏸️ Lazy cell materialisation behind the existing `MobilityGridCell` interface.
11. ⏸️ Tile-ring expansion (async at tile granularity, keeping the worker search
    synchronous).
12. ✅ **(scoped alternative, 2026-07-27 — see below)** A budget that grows
    the search when it fails, rather than a pre-computed cost-budget ellipse.
13. ⏸️ Corridor-count termination (2–5), reusing `corridorField.ts` bundling.
14. ⏸️ Two-pass coarse→fine; Terrain-RGB tiles coarse, chunked DEM fine.
15. ✅ **(scoped)** Honest no-route reporting (attempt count, final padding,
    cell count) — frontier painting NOT done (there is no frontier to paint;
    see below).
16. ❌ **NOT done** — the bounding-box construction in `mobilityGrid.ts` is
    still there; the fix that shipped makes the box ADAPTIVE, not absent.

**Why 10/11/13/14 are marked ⏸️, not done, not attempted as designed above:**
Full lazy materialisation, async tile-ring streaming inside a *synchronous*
worker search, and corridor-count termination are a genuinely large,
interacting rearchitecture — they'd touch `mobilityGrid.ts`, `accumulatedCost.ts`,
`mobilityWorker.ts`, `demDerivatives.ts` (which needs a COMPLETE neighbour set
to fit its per-cell plane, not a partially-materialised one), and every
consumer that currently assumes `cells` is the finished array for the whole
AOI (`corridorField.ts`, `computeChokepoints`, `computeMinCutBarrier`). Given
the honesty principle this whole codebase runs on (CLAUDE.md: "never present
fabricated data as real analysis"), attempting that rewrite at the depth this
pass had room for risked shipping something that LOOKED like Slice B but
subtly broke one of those invariants — worse than shipping a smaller, fully
verified fix. Recorded here as real, still-open work (master_plan.md
Next-up), not silently dropped.

**v1 (12/15 above) — expand-and-retry at escalating `boundsPadFactor`:**
`buildMobilityGrid` took a `boundsPadFactor` parameter (0.2 default);
`mobilityAppreciation.ts` retried the whole build-grid-then-search sequence
at escalating factors `[0.2, 0.6, 1.5, 4.0]`. Proven with a SYNTHETIC grid
built directly from local coordinates (`expandingSearchLakeGeorge.test.ts`)
— which is exactly why the proof missed what was still broken: it validated
"a wide-enough box finds the route" but never validated "does the padding
formula actually PRODUCE a wide-enough box".

**v1 was STILL broken — caught live against the real Lake George
(2026-07-27):** owner tested the exact west→east crossing and got a corridor
of ~227 m before stopping. Root cause: `padLat = (maxLat - minLat) *
boundsPadFactor`. For a due-EAST crossing, origin and objective sit at
nearly the SAME latitude, so `maxLat - minLat` is just the two painted
blobs' own thickness (tens of metres) — multiplying a near-zero number by
any factor from 0.2 to 4.0 stays near-zero. The retry mechanism was scaling
the WRONG base quantity and reproduced the exact original defect it was
built to fix.

**v2 (the actual fix) — square, distance-based box + targeted frontier-edge
growth:** two owner-guided refinements, live, in one session:

1. `computePaddedBounds` (now a standalone, exported, pure function —
   extracted specifically so the FORMULA is unit-testable without going
   through `buildMobilityGrid`'s network calls) targets a SQUARE box: side
   = `spanM * (1 + 2*boundsPadFactor)`, where `spanM` is the REAL haversine
   distance between the origin and objective centroids — not either axis's
   own incidental span. Owner: *"a 'more' square ratio could be a good way
   to start. So that one axis of loaded data is more similar to the linear
   distance so we have a proportionate area of data to work with."* Proven
   against the actual Lake George coordinates (lat -35.15 to -34.90): the
   box clears the full 28 km extent on the FIRST attempt at the default
   `INITIAL_PAD_FACTOR = 0.3` — no retry needed for the reported scenario.
2. `frontierTouchedEdges`/`growBoundsTowardFrontier` (new) — if a search
   still fails, reads back which edge of the box the REACHABLE frontier
   (finite `timeSeconds`, not a NO-GO/unreached cell) actually touched, and
   extends specifically that side for the next attempt, leaving edges the
   frontier never reached untouched. Owner: *"I think we need both, a large
   uniform box... and then the ability to extend out when we hit edges...
   if it still hits the edge then it loads a new [area] from the point of
   where it hit. Repeat until we get there."* Falls back to symmetric
   growth only when NO edge was touched at all (a genuinely terrain-boxed
   attempt, not a box-limited one) — matches `computePaddedBounds`'s own
   symmetric behaviour for that case. Two consecutive fully-terrain-blocked
   attempts stops the retry early (real evidence of enclosure) rather than
   spending the remaining budget on growth that already isn't the limiting
   factor. Capped at `MAX_ATTEMPTS = 6`.

Also fixed in the same pass: `nearestCellKey` — `mobilityGrid.ts`'s "never
an empty seed set" fallback (when a small paint patch clears NO analysis
cell's 15% area-overlap threshold on a coarse grid) used to pick an
arbitrary array-index cell (`cells[0]`/`cells[last]`), not the cell nearest
where the user actually painted.

Proven: `paddedBoundsLakeGeorge.test.ts` (including a test using the exact
real Lake George coordinates, proving first-attempt clearance) and
`frontierEdgeGrowth.test.ts`. `expandingSearchLakeGeorge.test.ts` (the v1
proof) still passes and still has real value — it proves the SEARCH ENGINE
finds a route when given room; the new tests prove the BOX-SIZING actually
gives it that room, closing the exact gap v1's proof missed.

**Throughout:** `npm run build` (webapp) and `npm run test:unit` (api) must
pass; TypeScript strict, no unjustified `any`; every estimated or overridden
value stays flagged end to end.

### Already shipped — not to be rebuilt

- **Bridges/fords.** §34 already exempts the fording gate where an edge sits
  on the mapped trail network, matching owner's "roads or tracks over water
  have bridges or fords." A real road graph would sharpen this from a
  per-hex boolean to an actual road edge crossing water.
- **Corridor clustering.** ~~`corridorField.ts` ranks routes into bands and
  tracks `evidence`; feeding it north/south routes should produce the
  two-corridor picture directly.~~ **Wrong — this was live-tested and
  disproven the same day; see "Movement corridors merging into one" below.**
- **Streaming paint-in.** Frontier expansion is inherently incremental, so the
  owner's requested "hex grid painted in as pathways are identified" becomes
  *easier* than today's staged progress. Worker progress channel (§33) and
  the water reference layer (§34) already exist; roads as a drawn layer are
  new but the data is already fetched.

### Distance-scaled cell budget + analysis-depth selector (2026-07-27)

Owner: *"Work out a sensible scaling of the cell budget for distance noting
big areas should take longer. Let the user select a scale of something like
'quick' to 'fine' for analysis depth. Processing half the country for a few
minutes is perfectly acceptable once we have the data locally. This is
processing on their device still?"*

**Confirmed: yes, entirely client-side.** The whole search this budget
governs — the multi-source Dijkstra (`accumulatedCost.ts`), the
k-dissimilar route search (`corridorAnalysis.ts`), the movement ensemble,
chokepoints, min-cut — runs inside `mobilityWorker.ts`, a Web Worker in the
user's OWN browser tab. Only source DATA (elevation/vegetation/roads/water)
is fetched over the network; the graph search itself never leaves the
device. A heavier 'fine' run at long range costs that one user's own
session — their tab may become less responsive while it runs (the existing
progress channel, §33, is what makes that wait legible) — not shared
backend capacity.

**What changed:** `TARGET_CELL_COUNT`/`MAX_HEX_CELLS` were fixed constants
(2200/2800) regardless of AOI size. `chooseHexSize` would still fit
*whatever* box it was given into that same budget — so a continental-scale
run got identical cell counts to a 2km local one, just silently coarsened
into unusably big hexes, with no user control over the trade-off.

`computeCellBudget(spanM, fidelity)` (new, `mobilityGrid.ts`) replaces the
fixed pair with a formula that scales with the REAL origin↔objective
distance:

```
distanceRatio = max(1, spanM / 10km)
target = tier.base * (1 + (sqrt(distanceRatio) - 1) * tier.growthRate)
target = min(round(target), tier.hardCeiling)
```

Growth is deliberately SUB-LINEAR (`sqrt`, not `distanceRatio` directly) —
a naive linear or area-proportional (~distance²) scaling would demand
millions of cells at continental range, which no browser tab can search in
"a few minutes". Three fidelity tiers (`MobilityFidelity`), each with its
own base, growth rate and hard ceiling:

| Tier | Base (≤10km) | Growth rate | Hard ceiling |
|---|---|---|---|
| `quick` | 900 | 0.6 | 5,000 |
| `standard` (default) | 2,200 (= old fixed value) | 1.0 | 12,000 |
| `fine` | 4,000 | 2.2 | 50,000 |

`standard` at short range (≤10km) reproduces the original fixed budget
almost exactly (2200 target / ~2800 max) — no behaviour change for a
typical local analysis. `fine`'s 50,000-cell ceiling at continental range
is what makes the owner's "a few minutes is acceptable" a deliberate,
bounded choice rather than an unbounded one. The hard ceiling applies
regardless of fidelity ONCE the sqrt-scaled target would exceed it — this
is the actual runtime bound, not a soft target.

**UI:** new "ANALYSIS DEPTH" selector in the Terrain panel (`quick` /
`standard` / `fine`), threaded through `MobilityAppreciationOptions.fidelity`
→ every `buildMobilityGrid` call (initial attempt AND targeted retries —
the retry mechanism's attempt count/growth behaviour is unchanged by
fidelity, only the cell budget is). Re-running at a different tier IS the
owner's requested "user can re-run with more or less cells after an initial
result" — no separate control needed.

Tests: `cellBudgetScaling.test.ts` — short-range parity with the original
constants, sub-linear growth, per-tier hard ceilings holding at continental
distance, tier ordering at both short and long range, 'fine' giving a
genuinely higher baseline (not just steeper scaling) even locally.

### Movement corridors merging into one — the segmentation bug (§28 addendum, 2026-07-27)

Owner, live-testing a real west↔east Lake George crossing with visibly
distinct east-shore and west-shore detour tracks on the map: *"it only
generated 1 corridor, we need two minimum... Consider how corridors and
alternative pathways are explored and identified."* §35's "already shipped"
note above claimed the existing pipeline should already produce this —
disproven the same day.

**Root cause.** Every route between the SAME compact origin and objective
necessarily SHARES cells at both ends — they all start inside the origin AOI
and end inside the objective AOI. `buildCorridorField`'s old segmentation
built ONE global density field from all k routes, then found connected
components over raw hex adjacency. That always finds the west-shore and
east-shore routes connected to EACH OTHER through their shared start/end
cells, collapsing two genuinely distinct avenues of approach into one
component. Not an edge case — the normal shape of the problem whenever
origin/objective are compact areas, which is the usual case.

**Fix — cluster routes before any spatial segmentation, then run
density/smoothing/segmentation PER CLUSTER.** A cluster's shared start/end
cells can then never bridge it to a different cluster's cells, since they
were never part of that cluster's density source to begin with. The
field's overall peak density is still taken across ALL clusters (not each
cluster's own), so a minor corridor still reads dimmer than the primary
one — the cross-corridor relative-importance signal survives the split.

**How routes are clustered — two attempts, one worked:**

1. *Jaccard cell-set overlap* (`|A∩B| / |A∪B|` over each route's full cell
   key set) was tried first — the obvious "do these routes retrace each
   other" measure. Tested against a synthetic two-gap grid
   (`corridorClustering.test.ts`, a barrier strip with a north gap and a
   south gap, forcing any crossing to detour through one or the other):
   same-avenue route pairs scored as low as 0.09–0.20 Jaccard, barely
   distinguishable from genuinely cross-avenue pairs (0.00–0.08). No single
   threshold separated them — on open terrain, routes have huge freedom to
   wiggle through unconstrained ground even while representing the same
   real avenue, which dilutes cell-overlap similarity past usefulness. This
   produced two visible failures: a single real detour over-fragmented into
   6 "corridors", and the top-2 ranked corridors both landing on the same
   side of a two-avenue grid.
2. *Spatial proximity at sampled progress fractions* (the fix that shipped)
   — sample each route's actual lat/lng at three normalised progress
   fractions (25% / 50% / 75% of its own path), and compare GEOGRAPHIC
   distance between corresponding points on two routes. Two routes join the
   same cluster only if EVERY one of the three sampled points is within
   `ROUTE_CLUSTER_DISTANCE_HEX_MULTIPLIER × hexWidthM` (7 hex-widths). A
   single fraction was not tried alone deliberately — a route's start/end
   are always near the shared origin/objective AOIs regardless of which
   avenue it takes, so a majority-vote rule risks being won by two
   agreeing endpoint samples even when the middle (where the real
   divergence is) disagrees; requiring all three closes that gap. Measured
   against the same synthetic fixture: the worst same-avenue pair never
   exceeded ~273 m at any sampled fraction; the best-separated cross-avenue
   pair was never under ~449 m at every fraction simultaneously — a clean,
   non-overlapping margin, unlike Jaccard's. `clusterRoutes` (union-find
   over this pairwise test) is otherwise unchanged in shape from the
   Jaccard attempt — same O(n²) pairwise cost, trivial at
   `DEFAULT_CORRIDOR_ROUTE_COUNT` (14).

**Also fixed — corridor colour collided with the trafficability heatmap.**
Owner: *"the corridors need to be a colour other than red. The red, amber,
green is used for the hex to show pass ability so the corridor in red makes
it look like it's picking the hardest route!"* Confirmed exact, not just
similar: corridor rank-1's colour (`#D8232A`) was IDENTICAL to the
NO-GO heatmap colour, and rank-2's (`#F6A609`) IDENTICAL to SLOW-GO.
Corridors moved to a blue/violet family entirely outside the red/amber/
green trafficability palette (`#3B82F6` / `#8B5CF6` / `#06B6D4` / `#94a3b8`,
`MapboxMapView.tsx`'s `rankColor` and `MobilityLegend.tsx`'s matching
swatches) — chokepoint/barrier/restriction reds were deliberately left
unchanged, since those mean "act here" (denial), a different semantic from
"this is corridor 1".

Tests: `corridorClustering.test.ts` — at least two corridors from a
two-real-detour fixture, the two busiest genuinely spatially distinct (not
the same band counted twice), and a CONTROL (sealing one gap) collapsing
back toward a single corridor.

**Not yet done** (separate, not started this pass): the owner's paired
request that the progress indicator track actual work and the map start
showing pathways as they're found, rather than a long idle gap before the
result appears — tracked in master_plan.md's roadmap, not folded into this
fix.

---

## 36. Painting is now real hex cells, not circles (2026-07-27)

Owner: *"Instead of the currently very large arbitrary circle shapes. Make
the small paint a single 100m hex. Medium is 10 and large is 100. Xl is
1000!"* — followed by *"Ensure the hex grid is the SAME hex grid for
analysis and the target painting."*

### What changed

`paintedArea.ts`'s `PaintDab` used to be a circle (`{lat, lng, radiusM}`),
sized from a fixed ON-SCREEN pixel radius converted to ground metres via the
map's zoom/latitude at paint time — the explicit design from the original
2026-07-26 request ("options for size of brush that remain consistent as I
zoom in and out"). Owner decided that design should be replaced outright,
not layered on.

A dab is now a real cluster of hex cells (`AxialCoord[]`) at a FIXED
`PAINT_HEX_SIZE_M = 100` circumradius, using the exact same hex math
(`hexGrid.ts` — `axialToLocal`, `hexCorners`, `localToAxial`) the mobility
ANALYSIS grid already uses — two new primitives added there:
- `hexRing(center, radius)` — the standard Red Blob Games hex-ring walk.
- `hexSpiral(center, count)` — rings 0, 1, 2, … until exactly `count` cells
  are collected, truncating the last ring deterministically. This is what
  makes a brush "paint N hexes": `BRUSH_HEX_COUNT = { small: 1, medium: 10,
  large: 100, xl: 1000 }`, matching the owner's spec exactly (small really is
  ONE hex; the rest are ×10 jumps).

`dabToTurfPolygon` now unions a dab's hex-cell polygons via ONE
`@turf/union` call over the whole `FeatureCollection` (turf v7 accepts N
polygons in one pass, not just 2) rather than a sequential pairwise loop —
material for an XL dab's 1000 cells. Everything downstream of "a dab is a
turf polygon" — `applyStrokes` (paint = union, erase = difference, replayed
in stroke ORDER so erase-then-repaint behaves like a real eraser),
`resolvePaintedAreaGeometry`, `isInsideResolvedArea` — is **unchanged**; the
hex rework only touches how one dab's polygon is built, not what happens to
it afterward.

### Anchoring: why not one global hex tiling

A single, fixed-origin hex tiling was considered and rejected: `toLocal`'s
metres-per-degree-longitude conversion is only locally accurate near its own
anchor latitude. A grid anchored at, say, -25° (roughly central Australia)
would read the SAME nominal "100m" hex as ~20–25% too narrow east-west by
the time a user is painting near Tasmania or Cape York — real, not
cosmetic, distortion for something the owner specified as a concrete 100m
figure.

Fix: each `PaintedArea` (one continuous origin-or-objective blob) anchors
its OWN local projection at its FIRST dab's raw click point. Every
subsequent dab in that SAME area reuses that anchor — carried explicitly on
every `PaintDab` (`anchor: LatLng`) rather than looked up from sibling
state, so `paintedArea.ts`'s functions stay pure and self-contained, matching
this module's own established design principle. Hexes within one blob tile
consistently against each other and stay locally accurate near where the
user is actually painting; a second, distant blob (e.g. the objective, far
from the origin) gets its own independently-accurate anchor.

### "Same hex grid" — what it means today, and what it doesn't yet

The analysis grid's size is chosen AFTER painting finishes
(`chooseHexSize`, adapted to the painted AOI's extent to stay inside the
~2200–2800 cell compute budget) — a literal single shared SIZE between
painting and analysis is circular until §35 Slice B's lazy grid removes the
need to pre-materialise the whole analysis grid up front. Owner's resolution
when this was raised:

> "Use the newly suggested sizes for the initial paint. Once the system
> determines compute budget for the scale of the area (combination of user
> selection of fidelity and scale of area) rework the painted geography to
> be a consistent hex size with the area. This should be mathematically
> achievable by breaking down the cells or combining them."

So, today: painting uses the fixed 100m hex tiling above; the analysis grid
keeps its own independently-sized `chooseHexSize` tiling; membership between
the two is reconciled by testing each ANALYSIS cell's overlap against the
resolved PAINTED polygon (real area-overlap, not just a centre-point test —
see `mobilityGrid.ts`'s `originKeys`/`objectiveKeys` construction) — this
is the "breaking down or combining cells" the owner described, done via
geometry (the resolved polygon), not by literally resizing hex tiles.
**Not yet built**: a "fidelity" selector the user can set that feeds
`chooseHexSize`'s target cell count (today it's a fixed constant); and,
longer-term once Slice B lands, making the analysis grid's own size
configurable/fixed to genuinely match the painting grid rather than being
independently chosen.

### UI

Cursor ring size is now derived from the brush's fixed ground radius
(`brushApproxRadiusM`, an equivalent-area circle — not a precise hex shape,
just enough for an honest "this much ground" preview) converted to on-screen
pixels at the CURRENT zoom/latitude (`metersPerPixel`) — the inverse of the
old relationship: the cursor now genuinely grows zooming in and shrinks
zooming out, correct for a brush whose real-world size is fixed. Fourth
brush button (`xl`) added to the existing S/M/L row; each button's tooltip
states its real hex count and size.

### Tests

12 checks in `paintedArea.test.ts` (brush hex counts match spec exactly,
anchor-sharing within one area, erase/repaint ordering, a far-south paint
doesn't degrade, `singleDabArea`'s unit-sim replan caller still works), 9 in
`hexRingSpiral.test.ts` (ring cell counts match the standard 6k formula,
spiral truncates to an exact count, determinism). Run via `npm test` in
`webapp/` (OCOKA 1, docs §47 — `scripts/runTests.mjs` runs every
`webapp/tests/*.test.ts` under `tsx` and is now a CI gate; previously these
ran by hand only). A live-network file (`nvis-fidelity.test.ts`) is excluded
from the default run — see that script's own comment.

`paintedOverlapFraction`/`isPaintedAreaMember` (`mobilityGrid.ts`) are
exported for testability, but `mobilityGrid.ts` itself transitively imports
`infrastructureService.ts` → `logger.ts`, which reads `import.meta.env` —
undefined outside Vite, so it cannot be exercised via a bare `tsx` script the
way the other terrain modules are. Verified instead via `tsc --noEmit` and a
full `npm run build`, both clean; a standalone unit test for the pure overlap
math is tracked as follow-up cleanup rather than blocking this change.

---

## 37. Progress-bar dead zones fixed; road graph gets real water awareness (2026-07-28)

Two field reports, both from the same live-testing session as §35's corridor
addendum.

### Progress bar accuracy + early real results on the map

Owner: *"the 'progress' indicator stopped well before the result loaded in
with a long 'nothing' time. Ensure that the progress bar reflects the work
being done and the map starts getting visual results being loaded as it
happens. I'd love to see pathways snaking across the landscape from the get
go rather than waiting for the end."*

Three real, confirmed bugs in `mobilityAppreciation.ts`'s progress reporting,
found by direct inspection (not guessing):

1. **The multi-source Dijkstra search reported NOTHING while it ran.**
   `runMobilitySearchInWorker` had no progress channel at all — the single
   largest silent stretch in the whole run, and exactly the "long nothing
   time" symptom. Fixed by threading a real `onProgress` through
   `runAccumulatedCostSearch` (`accumulatedCost.ts`) — `best.size /
   cells.length`, the genuine fraction of the grid settled so far, throttled
   to whole-percent steps before crossing the Worker boundary (same
   discipline the movement ensemble's own progress already used). The search
   phase's share of the overall bar widened from a token 4% (0.46→0.5) to a
   real 15% (0.40→0.55).
2. **A retry's sampling progress replayed from zero, visibly rewinding the
   bar.** Each `boundsPadFactor`/targeted-growth retry attempt's
   `buildOptions.onProgress` mapped its OWN 0..1 progress back into the same
   overall 0..0.40 (formerly 0..0.45) range every time, with nothing
   preventing a later attempt's early progress from reporting a LOWER
   fraction than an earlier attempt had already reached.
3. **The ensemble/restrictions worker call's own internal progress could
   already exceed a LATER, hard-coded checkpoint.** `planRestrictions` runs
   inside the SAME worker message handler as the ensemble, after it, before
   the response posts back — so by the time `await
   runMovementEnsembleInWorker(...)` resolves, phase `'restrictions'`
   progress may already have reported up to ~0.97. The very next line used
   to call `onProgress(0.7)` for the "corridors" stage — a real, visible
   rewind from ~97% back to 70%.

**Fix, one mechanism for all three:** `runMobilityAppreciation` now wraps the
caller's `onProgress` in a monotonic guard — a value at or below the current
high-water mark is silently dropped, never forwarded. This isn't a numeric
patch over each individual bug; it is the general property the bar must have
("progress" cannot mean "sometimes less work than before"), so no future
stage reordering can reintroduce the same class of defect. The three
call-site bugs above were still worth understanding and fixing at the
source (a bar that only ever HOLDS during a retry, rather than climbing, is
a worse experience than one that climbs correctly) — the guard is the
backstop, not a substitute for getting the numbers right.

**Real results reach the map before the run finishes.** A new
`onPartialResult` callback fires once, right after the search settles — the
real reachability field, GO/SLOW-GO/NO-GO classification, and the single
cheapest route, exactly as they appear in the final result — well before the
movement ensemble, corridors, chokepoints and min-cut barrier (which can add
tens of seconds more on a large or fine-fidelity grid) finish. Every field
those later stages own (`corridorField`, `ensemble`, `restrictionPlan`,
`chokepoints`, `barrier`) is passed through in its honest "nothing yet"
state — not fabricated, just not computed yet — which every consumer of
`MobilityAppreciationResult` already treats as nullable (the "no route
found" case has always produced exactly this shape), so `App.tsx` wiring
this straight into the same `mobilityResult` state needed no new rendering
path. This is the "pathways snaking across the landscape from the get go"
request: the real route and reachability field appear as soon as they
exist, not only once everything else is also done.

Tests: `searchProgress.test.ts` (6 checks — the Dijkstra progress callback
fires repeatedly not once, is monotonic, reaches ~1.0 on fully-reachable
ground, stays in [0,1], and changes nothing about the search's own result).
The orchestration-level fixes (monotonic guard, `onPartialResult`) live in
`mobilityAppreciation.ts`, which — like `mobilityGrid.ts` — transitively
depends on `import.meta.env` and a real Worker, so cannot be exercised via a
bare `tsx` script; verified via `tsc --noEmit` and `npm run build`, both
clean, matching this doc's own established precedent for that class of
module (§36).

### Road graph had zero water awareness — a vehicle route crossed Lake George

Owner, live-testing a run against the real Lake George: *"ran straight
across the lake which should based on data be a hard block due to water. (No
'has boats' option for unit movement)."*

**First hypothesis (ruled out by direct testing):** that Lake George is
mapped as an OSM multipolygon `relation`, and `infrastructureService.ts`'s
Overpass query only requests `way[...]` — a real, already-known gap (master
plan's "OSM water relations" backlog item). Checked directly: Lake George
(OSM way id 8060816) is in fact a single, well-formed closed `way` (349
nodes), fetched live via Overpass for this investigation. This gap is real
for OTHER lakes but was not the cause here.

**Second check (confirmed correct):** whether the HEX-GRID search's own
`estimateFordingRequirement` gate (`mobilityCost.ts`) actually blocks
movement through this exact real polygon. Proven directly — `foot-
individual-unladen` (no fording capability) searched against a grid built
from the real Lake George way correctly found a 96-waypoint route with ZERO
waypoints inside the lake. The hex-grid cost model works correctly on real
data.

**Root cause, confirmed by direct code inspection:** `roadGraph.ts` and
`roadRouting.ts` — the box-free vehicle road-network route (§35 Slice A) —
had **no water or hydrology logic at all**, in contrast to the hex grid.
Lake George is real-world famous for drying out for years at a time, so OSM
legitimately has tracks tagged across its bed with no bridge; a vehicle
profile without fording capability would be routed straight across any such
track with nothing to stop it.

**Fix:** `buildRoadGraph` now accepts the same water-body polygons the hex
grid already fetches (`grid.waterFeatures`, threaded through
`roadRouteSearch.ts`'s `findVehicleRoadRoute`). While building each way's
edges in order, it tracks a CONTIGUOUS run of edges whose midpoint falls
inside a mapped water body; if that run's total length exceeds
`MAX_ASSUMED_BRIDGE_SPAN_M` (250 m — generous, since a real bridge/causeway
span is typically tens to a couple hundred metres and Lake George's own
reported crossing was ~8.5 km), every edge in the run is flagged
`crossesStandingWater`. `roadRouting.ts`'s `edgeTravelTime` blocks any such
edge outright for a profile whose `fordingDepthM` is undefined OR less than
2.5 m — the SAME assumed depth `estimateFordingRequirement` already uses for
a standing water body, so a profile with a real-but-shallow rating (e.g. 0.7
m) is correctly still blocked, not just profiles with no capability stated
at all. A SHORT dip into a small water body (a genuine bridge) is
deliberately left unflagged — the run-length threshold, not point-in-polygon
alone, is what distinguishes "assumed bridge" from "track across dry
ground", preserving the hex-grid's existing "roads imply bridges" assumption
for the case it was actually meant to cover.

Both new fields (`RoadEdge.crossesStandingWater`, `WaterBodyPolygon`) keep
`roadGraph.ts`'s stated "no import dependency" design — a self-contained
ray-casting point-in-polygon check, not `@turf/boolean-point-in-polygon`,
matching `roadSpeedModel.ts`'s precedent for this module family.

Tests: `roadWaterCrossing.test.ts` (4 checks), built against the REAL Lake
George way geometry (same 349-node ring fetched live for the investigation
above, embedded as the fixture): a track across the lake is found and used
WITHOUT water awareness (proving the pre-fix defect is real and reproducible
in a controlled fixture, not just live), the same track is blocked and the
route forced onto a real northern detour WITH water awareness, and a CONTROL
proving a short bridge-like crossing of a small pond is still assumed
passable. Full regression suite green (only the pre-existing, unrelated
live-data `nvis-fidelity.test.ts` fails); `tsc --noEmit` and `npm run build`
clean.

**Not fixed by this pass** (recorded, not silently dropped): the OSM
relation gap identified and ruled out above is still real for other lakes
and remains open in the roadmap. The hex-grid search's own `onTrail`
exemption (mobilityCost.ts: a fording check is skipped when both edge
endpoints are already on a mapped road/trail) was not touched — if a real
OSM track through a lake bed also happens to snap `onTrail=true` on nearby
hex cells, that hex-grid exemption could theoretically still admit a
crossing the way this fix blocks for the road graph specifically. No live
evidence of that combination was found during this investigation, but it is
a different code path from the one fixed here and is noted rather than
assumed clear.

### Corridor route rendering was analysis noise, not presentation (§28 addendum)

Owner, live: *"the individual white lines of the considered paths don't
work as a visualisation. Because of the hex grid they end up being
'triangles' between the grid centres and they don't follow the road
geometry. Roads should allow for a 'hop on' and off type movement. I think
they need to be consolidated to show substantive differences in the
pathways / corridors, not show that every piece of ground has been
considered, even smoothing between hex grid so units moving directly in
straight lines aren't zig zagging to follow the hex. I'd expect to see the
2-5 clear corridors outlined and shaded appropriately over the top of the
ground... We need to reduce the analysis noise and show insights rather
than raw thinking."*

**What was wrong:** `App.tsx`'s `corridorRoutesForMap` drew up to 24 raw
route polylines — a sample of the full k-dissimilar analysed set — each
stepping hex CENTRE to hex CENTRE with no smoothing and no relationship to
mapped road geometry, regardless of how many corridors those routes had
actually clustered into. §28's own original design intent ("the analysis is
done on individual routes... the PRESENTATION is a corridor") was correct in
principle but not honoured in the map layer: the routes were still being
rendered as if they were the presentation.

**Fix — one representative route per corridor, refined the same way the
fire-break optimizer's own routes already are:**

1. `corridorField.ts`'s `Corridor` gains `representativeRoute` — the single
   FASTEST analysed route that actually uses that corridor (derived from the
   same `usingRoutes` list `fastestTravelSeconds` already comes from, so the
   two are guaranteed consistent by construction). One field, computed once,
   where the corridor/route relationship is already known — not re-derived
   in the presentation layer.
2. `App.tsx`'s `corridorRoutesForMap` now maps EACH CORRIDOR (typically 2-5,
   per the owner's own target) to its one `representativeRoute`, refined
   through `pathRefinement.ts`'s `refinePath` — the SAME module the
   fire-break optimizer already uses to turn a coarse hex-centre path into a
   realistic line (docs — path refinement, "coarse hex line → realistic
   line"). This is a straight reuse, not a parallel implementation: snap
   onto a nearby mapped road when the route genuinely runs alongside one
   (`snapPathToTrails`, unchanged), corner-smooth everywhere else.
3. **"Some corridors may be overland"** (owner, live follow-up) — snapping
   alone only ever fixes the ON-ROAD portion of a route; a stretch with no
   nearby trail at all previously kept its raw zig-zag untouched even after
   snapping ran. `pathRefinement.ts` gains `smoothFreeVertices` and a new
   opt-in `RefineOptions.cornerSmoothingIterations` (default 0 — the
   fire-break optimizer's existing behaviour is UNCHANGED unless it opts
   in): a moving-average pass over vertices NOT snapped to a trail, each
   pass pulling a free vertex toward its two neighbours' midpoint. A snapped
   vertex is read as a neighbour (so smoothing blends INTO the road join
   rather than leaving a visible kink) but is never itself moved, and
   endpoints never move. `App.tsx` passes `cornerSmoothingIterations: 2`.
4. `mobilityAppreciation.ts`'s `MobilityAppreciationResult` gains `roadWays`
   (mirrors the already-shipped `waterFeatures` field exactly) — the raw
   road/track geometry `pathRefinement.ts`'s snap step needs, previously
   available to the search's own `onTrail` classification but never
   surfaced past it.

**Not attempted in this pass:** smoothing the corridor BAND's own outline
(`mobility-corridor-edge`, a real `@turf/union` of the corridor's hex cells
— already a genuine dissolved shape, not a drawn approximation, but still
has the hex tessellation's own blocky edge at close zoom). The routes were
the specific, named complaint ("triangles… don't follow the road
geometry"); the outline is a smaller, lower-priority polish item and is not
tracked as fixed here.

Tests: `pathSmoothing.test.ts` (8 checks — corner smoothing measurably
reduces a synthetic zig-zag's total turning angle, never moves either
endpoint or a locked/snapped vertex, the fire-break optimizer's default
`cornerSmoothingIterations: 0` behaviour is unchanged, an overland path with
zero trail data still smooths, and a genuinely road-following stretch still
snaps onto the road rather than being blurred off it even with smoothing
enabled) and two new checks in `corridorClustering.test.ts` (every corridor
carries a non-null `representativeRoute`; it agrees with the corridor's own
`fastestTravelSeconds`). Full regression green (only the pre-existing,
unrelated live-data `nvis-fidelity.test.ts` fails); `tsc --noEmit` and
`npm run build` clean.

### Corridor band outline smoothing (§28, roadmap follow-up)

The route-rendering fix above left one thing explicitly deferred: the
corridor BAND's own outline (`mobility-corridor-edge`, `MapboxMapView.tsx`)
is a real `@turf/union` of the corridor's own hex cells — a genuine
dissolved shape, not a drawn approximation — but the hex tessellation still
leaves it visibly blocky/crenellated at close zoom, since a union of hexagons
still traces hexagon edges. Next item on the roadmap by the master plan's
own smallest-effort-first ordering; picked up as the direct follow-on.

**Fix:** `polygonSmoothing.ts` (new) — Chaikin corner-cutting, applied to
every ring of the dissolved geometry (`chaikinSmoothRing` for one closed
ring, `smoothPolygonGeometry` walking every ring of a `Polygon` or
`MultiPolygon` — `@turf/union` can legitimately produce either depending on
how a corridor's hexes happen to dissolve together). Chaikin is the
standard choice for this: each edge is replaced by two points at 1/4 and
3/4 along it, converging toward a quadratic B-spline as passes increase.
Deliberately a DIFFERENT algorithm from `pathRefinement.ts`'s open-path
corner smoothing (`smoothFreeVertices`, the moving-average pass added for
corridor ROUTE lines above) rather than reused: a closed ring has no
endpoints to preserve and no "locked/snapped-to-trail" concept — every
vertex participates equally and cyclically, which is exactly what Chaikin
gives and a moving-average anchored at fixed endpoints does not. `App.tsx`'s
route smoothing and this outline smoothing both change ONLY presentation —
the corridor's real extent is still exactly what `buildCorridorField`
computed; 2 passes (matching the route lines' own default) is enough to
read as a band rather than a staircase without eroding that real extent.

**A genuine measurement pitfall, caught before it shipped a bad test:** the
obvious "does total turning angle go down" check (the same measure
`pathSmoothing.test.ts` uses for open routes) does NOT work for a closed
polygon — summed unsigned turning across a rectilinear staircase ring is
near-invariant under Chaikin (each 90° corner splits into two ~45°(-ish)
turns rather than the total shrinking), so the sum barely moves. The
MAXIMUM single-vertex turn is what actually captures "still has sharp
staircase corners vs. reads as a smooth curve", and is what the tests check
instead (measured directly: a fixture's 90° corners drop to 63°/34°/18° over
3 passes).

Tests: `polygonSmoothing.test.ts` (9 checks — max-turn reduction is
monotonic across 1/2/3 passes, the ring stays closed, area stays sane
(corner-cutting can only shrink it slightly, never balloon or collapse it),
0 iterations and a too-small ring are both safe no-ops, and both `Polygon`
holes and `MultiPolygon` are walked correctly). Full regression green (only
the pre-existing, unrelated live-data `nvis-fidelity.test.ts` fails);
`tsc --noEmit` and `npm run build` clean.

### OSM water relations — the closed gap, fixed ahead of the 1.0 demo (§34/§35)

Picked up out of Next-up order, ahead of smaller-effort items still queued:
demo-risk assessment (owner: "one more push then we're done for a 1.0
demo... pick the item most critical for that purpose") found this was the
single highest-probability repeat of the exact bug class this whole pass
had been chasing — the Lake George road-crossing fix earlier in this
section, and the original hex-grid padding defect before it, were both
"water that should block movement doesn't." Checked directly whether that
class of failure had any other open instances rather than assuming it was
fully closed: **confirmed live, via Overpass, that Lake Tuggeranong and
Gungahlin Pond — both in the SAME Canberra region this project's own test
scenarios (Lake George, M23, Sutton, Bywong) already live in — are mapped as
OSM `relation`, not `way`.** `fetchCorridorWaterways`'s query only ever
requested `way["natural"="water"]`, so either of those (or any other
multipolygon lake) would have been invisible to the hydrology gate entirely
— a real, high-probability repeat of the just-fixed bug class in front of
the exact geography already being demoed, not a hypothetical edge case.

**Fix, both the client and the server-side proxy (kept in lock-step per
their own existing "MUST match" discipline):**

1. The `water`-kind Overpass query now also requests
   `relation["natural"="water"](bbox)`, alongside the existing `way`
   queries.
2. `extractWaterRelationTrails` (new, duplicated in both
   `webapp/src/utils/infrastructureService.ts` and
   `api/src/services/infrastructureService.ts`, matching how every other
   OSM query constant in these two files is already kept in parallel):
   confirmed live via Overpass that `out geom` on a relation query inlines
   each MEMBER's own node geometry directly (`members[].geometry`) — no
   separate recursion (`>`) query needed. Each `outer`-role member way
   becomes its own standalone water-body `InfrastructureTrail`.
3. **Deliberate, stated scope cut, not a silent gap:** a multi-part outer
   ring split across several way members is not re-stitched into one true
   polygon, and `inner` (island) members are not subtracted as holes. Both
   directions of that cut are safe for a HARD-BLOCK hydrology gate
   specifically: at worst an island cell reads as water (a false NO-GO, the
   safe direction to be wrong in — never a false crossing), and a
   multi-member outer ring still gates correctly member-by-member even
   without being literally one closed polygon. Full relation reassembly
   (proper outer/inner ring topology) remains real, open follow-up work if
   a future case needs it — not assumed done here.

Tests: 4 new checks in the API package's `infrastructure.test.ts` (query
shape, outer-vs-inner member filtering, name/kind/geometry mapping) and a
new `waterRelations.test.ts` in the webapp package (4 checks, through the
PUBLIC `fetchCorridorWaterways` API with `fetch` stubbed — query shape,
outer/inner filtering, and critically that the parsed relation trail
actually gates a point via `distanceToNearestWater`, the SAME function the
hex-grid search's own `inWaterBody` classification calls, closing the loop
from "the query returns it" to "the search actually sees it" — plus a
regression guard that plain `way`-tagged water bodies still work exactly as
before). Full regression green in both packages (webapp: only the
pre-existing, unrelated live-data `nvis-fidelity.test.ts` fails; api: all
green); `tsc --noEmit` and build clean in both.

---

## 38. Cloud offload for large-area analysis — design scoping, telemetry collection first (2026-07-28)

Owner observation, continuing from the perf discussion that opened this
thread: the hex-grid cross-country search (`mobilityWorker.ts`, §8/§35) is
"relatively performant on small areas" but "grinds" on some devices at
larger extents — reported as fast on a Snapdragon X Elite laptop and slow on
an HP EliteBook, i.e. the same AOI at the same fidelity varies by device more
than by any input the app controls. Three follow-on questions, in the order
the owner raised them: (1) is road routing part of this consideration —
answered above, see "Road routing stays out of scope" below; (2) what
infrastructure would support offloading the slow part to the cloud — Static
Web Apps + Functions, Container Apps, or an on-demand Container Apps Job;
(3) start collecting real per-run scale/performance data now, since neither
the owner's own two devices nor any fixed cell-count guess can answer "when"
on their own.

**Status: scoping + telemetry only.** No offload infrastructure exists yet.
What ships with this pass is (a) this design, and (b) `POST
/api/mobility-telemetry` + client-side capture, wired into every completed
`runMobilityAppreciation` call, so a threshold decision has evidence behind
it instead of two data points. See "Telemetry: what's collected and why"
below for the shipped part.

### Road routing stays out of scope — it's already fast and already separate

The earlier part of this conversation proposed an off-the-shelf routing API
(Mapbox Directions or similar) as an instant "Tier 0" road result while the
slow cross-country analysis ran behind it. Checking the codebase: **that
already exists**, just built as a self-hosted OSM-graph router rather than a
third-party API call — Slice A (§35 addendum, `roadRouteSearch.ts` +
`roadGraph.ts` + `roadRouting.ts`, "as-built" §37). For vehicle-gradient
profiles it finds a box-free route over the actual OSM road network,
independent of the hex-grid's padded box and independent of the hex-grid
Dijkstra search entirely — a small-graph search, not an AOI-wide one, so it
was never the slow part.

**One real gap, not previously flagged:** `findVehicleRoadRoute` is called
from `mobilityAppreciation.ts` *after* `buildMobilityGrid`'s retry loop
settles (currently line ~463–476), because it currently reads `grid.roadWays`
— the same `highway-mobility` Overpass fetch the hex-grid sampling pass
already made, awaited together with elevation/vegetation before the grid
returns at all. So today it's cheap once reached, but not actually surfaced
*first* the way the original "instant road result while the area analysis
churns" framing wanted. Fixing this doesn't need cloud offload — it needs
decoupling: fetch `highway-mobility` ways and run `findVehicleRoadRoute`
in parallel with (not after) `buildMobilityGrid`'s elevation/vegetation
sampling, and surface it through a new `onRoadRoute` callback the moment it
resolves, likely before `onPreviewCells` even fires. Small, self-contained,
no new data source, no new infra — flagged here as a concrete near-term
follow-up so it doesn't get lost in the cloud-offload discussion, but it is
NOT the same problem as this section and shouldn't block on it.

### Infrastructure options for the actual slow part (hex-grid search + ensemble)

The candidates, evaluated against what this app already is (Static Web Apps
+ Azure Functions consumption, per CLAUDE.md's stack line) and what it needs
(occasional large/complex jobs, mostly small/fast ones, a field tool that
must degrade gracefully offline):

| Option | Fit | Cost/ops profile | Why / why not |
|---|---|---|---|
| **Stay on SWA + Functions Consumption** (status quo, extended) | Small-to-medium runs, which is most of them | Free/near-free at this traffic; scales to zero | Consumption plan has a hard execution timeout (5 min default, extendable to 10 on the plan this app is likely on) and bursty cold-start latency — fine for the search/ensemble compute itself (seconds, not minutes, even at the ~10k-cell ceiling §8 describes) but wrong for anything that could legitimately run long, and it's the SAME serverless model already ruled out for the *interactive iterate loop* in §14.1 Finding 4 for latency reasons, not throughput reasons — that reasoning doesn't disappear just because this is a different call site |
| **Always-on Azure Container App** | Poor fit | Pay for idle capacity 24/7 for a workload that's bursty and mostly small | No scale-to-zero benefit is being used; this is the wrong shape for "only certain cell counts trigger cloud offload" — most runs would never touch it, so most of the spend would be idle |
| **On-demand Container Apps Job (scale-to-zero, triggered per request)** | **Best fit for the offload case specifically** | Pay only for the seconds a large job actually runs; can be given real CPU/memory instead of a Function's ceiling; no hard 5–10 min wall | Matches the owner's own framing exactly — "a standalone container app able to start on demand for bigger jobs only." Cold-start (several seconds to provision a job execution) is the real cost, which is why this should be the *exception* path, not the default one |

**Recommendation: keep Functions as the default path for everything under
the threshold, add an on-demand Container Apps Job as the *exception* path
for jobs large/complex enough that the client Worker (or a Function's
timeout) genuinely can't do them well.** This is a three-tier model, not a
two-tier "local vs cloud" switch:

1. **Client Worker (today's default, unchanged).** Stays the path for the
   large majority of runs — small-to-medium AOIs, which is most real corridor
   analyses. This is also what keeps the iterate loop (§14.1 Finding 4)
   interactive and what keeps the tool usable with zero network once the
   initial sampling has landed, matching the reframed "offline" property from
   earlier in this conversation: not zero-network overall, but no *further*
   round trips once data is cached.
2. **Azure Function, same algorithm, server CPU.** A run too big for a
   comfortable client Worker experience but well inside a Function's
   timeout — same `accumulatedCost.ts`/`corridorAnalysis.ts`/etc. modules,
   since the API is already Node/TypeScript, run server-side instead of in
   the browser. Removes the device-performance variance entirely for this
   tier: a Function's CPU doesn't care whether the caller has a Snapdragon or
   an ageing EliteBook.
3. **Container Apps Job, on demand, scale-to-zero.** Only for the genuine
   outliers — AOI-wide exhaustive search at the top of §8's 10k–100k cell
   range, or a fine-fidelity ensemble over a large corridor. Started per
   request, torn down after; the cost only exists when this tier is actually
   used.

**Do not build tier 3 speculatively.** Tier 2 (same code, Function-hosted)
is the cheap, mechanical step — no new infrastructure, no new deploy
pipeline, just a new route calling the existing `webapp/src/terrain/*`
modules from `api/src/functions/`. It alone would already remove the
device-variance complaint for anything that fits a Function's timeout, which
based on §8's own numbers (a few seconds of CPU even near the cell ceiling)
is probably most of what currently "grinds" on a slower device. Tier 3 is
real, scoped, and should be built — but only once telemetry shows genuine
demand for it above what tier 2 already covers.

### The trigger can't be a bare cell-count cutoff

The owner's own two devices already disprove a single static threshold: the
Snapdragon laptop handles large areas well, the EliteBook doesn't, at
presumably similar cell counts. Cell count alone is a weak proxy for two
independent reasons already documented elsewhere in this file: (a) §10's
whole premise is that complex vegetation (dense stem spacing, more
GO/SLOW-GO/NO-GO transitions to evaluate per edge) costs more per cell than
open ground — "more complex environments are slower than big open spaces for
path finding" is exactly right and is why §8 calls out CPU, not cell count
alone, as the bottleneck; (b) device CPU varies by more than any workload
does. **The right trigger is a function of (cell count × terrain/veg
difficulty mix) calibrated against what THIS device has actually measured
doing THIS kind of work — not a constant baked into the client.** That
calibration is exactly what the telemetry below exists to build. Until
there's enough of it, no automatic tier-2/tier-3 routing should ship;
tier 1 stays the only path, same as today.

### Result delivery for low/interrupted connectivity (tiers 2–3)

Once a Function/Job tier exists, results need to reach a client whose
connection may drop mid-run — genuine rural/remote conditions, not just
latency. Recommendation: **not** a WebSocket (doesn't degrade through a real
drop) and **not** unbuffered SSE (same problem, plus no native resume).
Instead, a resumable job pattern: the client submits the AOI + profile,
receives a job id, and the server writes results as they complete — chunked
by corridor band or hex-block, not one giant payload — to blob storage. The
client polls job status and pulls whatever chunks are ready, caching each
one locally as it lands (mirrors the existing session retention cache
pattern already used for the client Worker's own progressive results, §35).
A dropped connection resumes from the last chunk received instead of
restarting the job or losing progress. This is a tier-2/3 concern only —
tier 1 (the client Worker) already has this property for free, since nothing
ever leaves the browser.

### Telemetry: what's collected and why (shipped this pass)

`POST /api/mobility-telemetry` (anonymous, rate-limited under a `telemetry`
tag, same `enforceRateLimit` pattern as every other public endpoint) writes
one row to Azure Table Storage per completed `runMobilityAppreciation` call.
Fire-and-forget from the client (`webapp/src/terrain/mobilityTelemetry.ts`) —
every failure mode is swallowed there; this must never affect the analysis
run it's reporting on, and never blocks or delays it (the `fetch` call fires
after the result is already in hand).

**Deliberately excluded: location and identity.** The question this exists
to answer — "how big/hard was this run and how long did it take on this
device" — has nothing to do with where on Earth it ran, so no lat/lng is
sent, only a random per-session id (for grouping a device's own runs
together, discarded on browser close, not tied to any account).

**Captured per run:**
- `cellCount`, `targetCellCount`, `reachableCount`, `noGoCount`,
  `slowGoCount`, `goCount` — size and the GO/SLOW-GO/NO-GO split §8/§10 flags
  as the real cost driver, not just raw cell count.
- `vegetationHistogram` — cell count per vegetation kind (`cell.vegetation`
  off the sampled grid), the direct terrain/veg-difficulty breakdown the
  owner asked for.
- `distanceM` — straight-line origin↔objective, from the same
  `originObjectiveDistanceM` the run itself uses.
- `elapsedMs` (total) and `stageDurationsMs` (per `MobilityStage` key: grid,
  sampling, search, ensemble, corridors, chokepoints, barrier, restrictions,
  done) — enough to see which PHASE dominates on a slow device, not just that
  the run overall was slow. This is what will eventually distinguish "this
  device is slow at network I/O" from "this device is slow at CPU search",
  which matters because only the second one is helped by any of tiers 2–3.
- `fidelity`, `profileId`, `searchAttempts`, `usedExpandedSearch`,
  `routeFound` — run configuration and outcome context.
- `hardwareConcurrency` (`navigator.hardwareConcurrency`) and
  `deviceMemoryGb` (`navigator.deviceMemory`, Chromium-only, silently absent
  elsewhere) — the closest thing to a device-capability signal available
  without fingerprinting; both are coarse and neither is required for the
  payload to be accepted.

**Deliberately NOT built this pass:** any dashboard/query surface over the
collected rows, and any automatic tier-2/3 routing logic. Both are the
natural next step once there's a real sample of demo/testing runs to look
at — premature before that data exists.

### Staging

| Stage | Scope | Gate |
|---|---|---|
| T0 (this pass) | Telemetry capture, this design | None — ships now |
| T1 | Road-route decoupling (surfaced ahead of the hex-grid search) | Independent of the rest of this section; can ship any time |
| T2 | Same-algorithm Function-hosted tier for oversized-for-client, under-Function-timeout runs | Enough telemetry rows to confirm which phase actually dominates on slow devices, so T2 targets the right phase rather than moving the whole pipeline speculatively |
| T3 | On-demand Container Apps Job tier + resumable chunked delivery | Evidence from T2 that a real (not hypothetical) tail of runs exceeds a Function's timeout/memory ceiling |

### 38.1 OCOKA 2 shipped (2026-08-03): `shared/@firebreak/terrain` extracted

Prerequisite for OCOKA 5's server-side execution. This section's own §38 design
above assumed "the API can just call the existing modules" — optimistic: they
lived in `webapp/src/terrain`, a different package with a different
`tsconfig.json`, so a shared package had to be extracted first, or the
algorithm itself becomes a fourth must-match drift surface alongside the
GIS-export/AI-briefing/`MobilityJobRequest` pairs this doc already tracks.

**What moved (extracted, not copied) into `shared/terrain/src/`:** every
module that is a pure function over already-sampled data, no network I/O, no
browser API — `accumulatedCost.ts`, `concealment.ts`, `corridorAnalysis.ts`,
`corridorField.ts`, `counterMeasures.ts`, `delayLedger.ts`, `keyTerrain.ts`,
`minCutBarrier.ts`, `mobilityClass.ts`, `mobilityCost.ts`,
`movementSimulation.ts`, `moverProfiles.ts`, `paintedArea.ts`,
`restrictionPlanner.ts`, `roadGraph.ts`, `roadRouting.ts`,
`roadSpeedModel.ts`, `viewshed.ts`, `dataLayers/demDerivatives.ts`,
`dataLayers/structureTable.ts` — plus the "sampling utils" and shared
vocabulary both modes touch: `utils/chainage.ts`, `utils/hexGrid.ts`,
`config/classification.ts`, and a new `geo.ts` holding just the pure
`calculateDistance`/`calculateSlope` extracted out of
`utils/slopeCalculation.ts` (which keeps its own network/Mapbox-token-coupled
code and now imports the pure pair back).

**What stayed in `webapp/src/terrain`, and why — every one a real capability
difference to record, not hide, same principle as `mapboxTrails.ts` staying
client-only for reading a live GL map:**
- `mobilityGrid.ts`, `mobilityLazyGrid.ts` — orchestrate live network
  sampling (elevation, vegetation, trails, water).
- `mobilityAppreciation.ts` — the top-level orchestrator; calls the above
  plus the Worker client.
- `mobilityWorker.ts` / `mobilityWorkerClient.ts` — Web Worker `self` API /
  Vite's `new Worker(new URL(...), {type:'module'})` asset-URL syntax.
- `mobilityTelemetry.ts` — fire-and-forget network telemetry (§38 above).
- `roadRouteSearch.ts` — fetches live road/waterway data.
- `unitSimulation.ts` — depends on two of the above.
- `oakoc.ts` — a deliberate exception in the OTHER direction: it only
  assembles the OCOKA five-factor view model for `OakocPanel.tsx` from an
  already-computed `MobilityAppreciationResult`. It never computes anything a
  server would independently need to compute, so forcing that large
  orchestrator type to move too would have bought nothing.

**How webapp consumes it — deliberately not an npm workspace.** The original
plan called for a root `package.json` with npm workspaces. Investigating the
actual deploy path changed that: Azure Static Web Apps deploys via
`Azure/static-web-apps-deploy@v1`, which runs an independent Oryx remote
build scoped to `app_location: 'webapp'` / `api_location: 'api'` — it has no
notion of a workspace root and would not know to install or build a sibling
`shared/` package first. A workspace-hoisted `node_modules` risked silently
breaking that live production deploy with no local repro. Instead,
`@firebreak/terrain` is a TypeScript path alias: `webapp/tsconfig.json`'s
`compilerOptions.paths` and `webapp/vite.config.ts`'s `resolve.alias` both
point the specifier straight at `shared/terrain/src/index.ts`. Vite bundles
it like any other local module; there is nothing to install, so there is
nothing for the remote build to miss. `shared/terrain/package.json` still
exists (name, its own `tsconfig.json`, a `build` script) so CI can
type-check the package standalone — catching an accidental
network/browser-coupled import before it reaches webapp's own build — but
nothing consumes that build's output. See `shared/terrain/README.md` for the
full rationale; when OCOKA 5 wires the API to this package, prefer the same
path-alias (or a TS project reference) pattern unless Azure Functions
deployment is separately re-verified to tolerate a workspace install.

**Two small pre-existing snags, found and fixed in the move (not introduced
by it):**
- `SimPathNode` lived in `mobilityWorker.ts` (stays client-side), but
  `corridorAnalysis.ts` and `mobilityAppreciation.ts` (one moving, one
  staying) both needed it purely as a data shape with no Worker dependency.
  Relocated to `accumulatedCost.ts`; `mobilityWorker.ts` re-exports it for
  its own webapp callers.
- `nearestCellKey` lived in `mobilityGrid.ts` (stays client-side, since it
  orchestrates live sampling), but `keyTerrain.ts` (moving) needed it as pure
  geometry over an already-built cell array. Same fix: relocated to
  `accumulatedCost.ts`, re-exported from `mobilityGrid.ts`.
- `ConfidenceTier` was declared in `components/DataConfidenceBadge.tsx` — a
  React component file — and imported as a type-only dependency by
  `counterMeasures.ts` and `dataLayers/structureTable.ts`, both now moving.
  Relocated the type alone to `shared/terrain/src/confidenceTier.ts`;
  `DataConfidenceBadge.tsx` re-exports it for its own webapp callers.

**Ensemble seeding made chunk-invariant.** The OCOKA 2 spec's other
requirement: `movementSimulation.ts`'s mover ensemble used ONE
`mulberry32(seed)` PRNG instance shared across every mover in the loop, so
mover N's random draws depended on exactly how many draws movers 0..N-1 had
already consumed — correct, but inherently un-chunkable (OCOKA 8's fan-out
needs to run mover batches independently, in any order, on any worker). Each
mover now gets its own stream from `hashSeedForMover(seed, moverIndex)` (a
small splitmix32-style avalanche), instantiated inside the mover loop instead
of once outside it. **This changes today's ensemble numbers once** — same
seed, same AOI, a different draw sequence per mover — a flagged, deliberate
one-time change, never silent drift; no test in the suite asserted an exact
draw sequence, so nothing needed updating to match.

**Verification:** `shared/terrain`'s own standalone `tsc --noEmit` is clean
(new CI step, `.github/workflows/deploy.yml`); webapp `npm test` (38/38
files) and `npm run build` both green against the alias; api
`npm run test:unit` green and unaffected (api does not consume this package
yet — that begins at OCOKA 5).

---

## 39. Small-AOI detour padding — profile-scaled, not just proportional (2026-07-28)

Owner-reported defect, live-testing a short-range run: "moving approximately
1-2km from one side of a hill to the other is not considering the very
viable possibility of travelling an additional 1-2km north or south to a
bunch of viable pathways... we need to consider all paths within a
reasonable minimum distance, especially for the vehicle types... so 'foot'
would be quite constrained compared to vehicles."

**Root cause.** `computePaddedBounds` (mobilityGrid.ts, §35) sizes the search
box as `spanM * (1 + 2*boundsPadFactor)` — proportional to the direct
origin↔objective distance. Fine for a long trip; for a short one (1-2 km)
the resulting padding is itself only a few hundred metres, nowhere near
enough to contain an equally short detour around an obstacle. The multi-
source Dijkstra search itself is not the problem — it already finds the
cheapest path across whatever cells it's given — the box just never
contained the better route's cells in the first place. Compounding this: the
retry loop stops widening as soon as ANY route is found (`if (path) break`
in `mobilityAppreciation.ts`), so a mediocre straight-line route through the
obstacle silences the mechanism before a better detour is ever sampled.

**Fix.** `minDetourPadM(profile)` (mobilityGrid.ts) — extra room, metres
each side, derived from the mover profile's own sourced `roadSpeedKmh` over
a fixed 1-hour time budget. Threaded into `computePaddedBounds` as an
additional `Math.max()` term against the existing proportional formula
(default 0, so every pre-existing call site/test is unaffected), and wired
in from `mobilityAppreciation.ts`'s first search attempt, where the profile
is already resolved. A vehicle profile at 60 km/h gets ~60 km of floor
room; a foot profile at 5 km/h gets ~5 km — proportionate to the owner's own
framing, not a flat number applied to both alike.

**Deliberately uncapped (owner decision, weighed against a smaller/bounded
alternative):** the existing distance-scaled cell budget (`computeCellBudget`,
step 25) already coarsens hex resolution as the resulting box grows, so a
fast profile's wider box costs RESOLUTION, not runaway cell count — this
does not reintroduce the large-AOI performance problem from §38. The floor
only binds at all when the direct span is short enough that the
proportional term would otherwise fall short of it; a long-range run is
unaffected (verified in tests below).

**Tests** (`detourPadScaling.test.ts`, 6 checks): foot gets a modest,
real floor; a vehicle gets an order-of-magnitude more room than foot for the
identical trip; the reported hill-crossing scenario gets ≥1.5 km of room on
each side; a long-range trip's box is unchanged (<1% delta); omitting the
new parameter reproduces the old formula exactly. Full existing padded-
bounds/frontier-growth/cell-budget/road-routing suite still green; `tsc`/
build clean.

---

## 40. Mapbox-tile road fallback widened to Terrain Mobility (2026-07-28)

Owner, live-testing near Lake George: a real, clearly-signed highway
running along the shoreline was painted NO-GO end to end by the terrain
overlay, despite being "highly preferred" and visibly present on the very
same map tiles already loaded. Owner's own diagnostic question: "we can
literally see the road network on the underlying map tiles? is that data
present or is it just an image?"

**Answer: the data is real, queryable vector geometry, not a rendered
image.** `mapboxTrails.ts` already adds the `mapbox-streets-v8` vector
source as an invisible, always-queryable layer — zero extra network cost
(the tiles load with the map itself), no CORS problem (Mapbox serves its
own tiles with the app's token), and works offline once an area's tiles are
cached. This has been the FIRST-TRIED source for the fire-break optimizer's
plain `'highway'` kind since it was built. The bug was narrower: this
shortcut was explicitly restricted to that fire-break kind and never applied
to Terrain Mobility's `'highway-mobility'` kind, for two real reasons —
Mapbox's `REUSABLE_CLASSES` filter excluded motorway/trunk (a fire break
doesn't run down a freeway), and the tileset carries no `surface`/
`tracktype`/`smoothness` tags the road-speed model wants.

**Mechanism confirmed by this same session's own evidence.** Earlier
console output from this exact testing session showed the backend Overpass
proxy 502-ing for `kind=highway-mobility`, followed by every direct Overpass
mirror failing on CORS/timeout — "All Overpass endpoints failed for
highway-mobility; continuing without it." With zero road data, `onTrail` is
false for every cell, so the mapped-road exemption the hydrology/vegetation
gates already give a road (§34, §35: "a road crossing a mapped watercourse
implies a bridge/ford already handles it") never fires. The hard slope/
cross-slope gates in `mobilityCost.ts` have NO such exemption at all — they
apply regardless of `onTrail` — so a narrow, engineered lake-edge shelf
between a steep hillside and the water reads as NO-GO from raw DEM alone.

**Fix.** `mapboxTrails.ts`: added `MOBILITY_CLASSES` (motorway/trunk/primary
included, docs §35's `MOBILITY_HIGHWAYS` set in Mapbox Streets v8 naming)
alongside the existing `REUSABLE_CLASSES`; `extractCorridorTrails` now takes
a `kind` parameter selecting which set applies, querying the SAME underlying
layer (filtered to the union of both) rather than maintaining two Mapbox GL
layers. `MAPBOX_CLASS_TO_OSM_HIGHWAY` translates Mapbox's bucketed classes
(`street` → covers OSM residential/unclassified/living_street alike) to a
real OSM `highway` value so the speed-by-class table gets an honest entry
instead of falling through to its generic untagged-track estimate.
`infrastructureService.ts`'s `LocalTrailProvider` type gained a `kind`
parameter; the Mapbox-first shortcut now covers `'highway-mobility'` as well
as `'highway'` (still never `'water'` — Mapbox's schema carries no waterway
geometry at all).

**Honest, stated fidelity cost:** a way sourced this way gets a highway-
class-only speed ceiling — `surface`/`tracktype`/`smoothness` are simply
absent from Mapbox's schema, so no refinement beyond the base class is
possible via this path (`roadSpeedModel.ts` already treats an absent tag as
"no cap from that dimension", so this degrades gracefully rather than
erroring). Strictly better than the failure mode it fixes: zero road data
at all, and a real highway reading as impassable.

**Tests** (`mapboxTrailsMobility.test.ts`, 6 checks, stubbed Mapbox GL map —
no real map/token needed): `'highway'` kind still excludes motorway
(regression guard); `'highway-mobility'` includes it (the reported gap);
the class translation table; surface/tracktype/smoothness left undefined,
not fabricated; default kind is backward-compatible; empty feature sets
still return null, never throw. Full existing road/infrastructure suite
still green; `tsc`/build clean.

---

## 41. Page-hang regression: uncapped detour floor + missing onTrail slope exemption (2026-07-28)

Owner, live-testing after §39/§40 shipped: the page hung around 50% progress
and eventually forced a browser tab-kill dialog. Traced to the ALREADY-
PUSHED §39 detour floor (commit e9ec36b), which at the time used a literal,
uncapped 1-hour time budget: for a fast vehicle profile on a short trip this
inflates the search box to roughly 120 km wide. That box feeds `roadWays`
into `findVehicleRoadRoute` (Slice A), which builds and searches a road
graph SYNCHRONOUSLY on the main thread — correctly documented as "cheap
enough... a handful of OSM ways, not a grid" for a small bbox, but at 120 km
wide that's a whole regional road network, plausibly thousands of ways,
freezing the UI thread exactly as reported.

**Two fixes, both already scoped/approved this same session before the hang
was reported:**

1. **§39's time budget capped at 15 minutes** (was 1 hour, uncapped).
   Revised after the owner's own follow-up report that the uncapped version
   also destroyed fine local resolution ("the whole ridge is red instead...
   these narrow location-specific pathways are the entire point of this
   app") — 15 minutes keeps the floor generous relative to the ORIGINAL
   reported scenario (foot at 5 km/h covers ~1.25 km in 15 min, matching the
   owner's own "1-2 km" framing) while bounding box growth for fast
   profiles. This alone shrinks the road-graph size driving the hang by
   roughly the square of the distance reduction (~16x area for a ~4x
   distance cut).
2. **Cell budget now derives from the actual padded box, not the raw
   origin↔objective distance** (`buildMobilityGrid`, mobilityGrid.ts) — a
   second, independent bug the detour floor exposed: the SAME fixed cell
   budget was being stretched over a much bigger box, ballooning hex size
   everywhere (859m for the reported ridge scenario, even after the 15-min
   cap reduced it from ~121km/859m to ~31km/310m — see tests below for the
   before/after).
3. **Hard climb/cross-slope gates now exempt onTrail cells** (both
   `edgeMobilityCost` in mobilityCost.ts and `classifyCellTerrain` in
   accumulatedCost.ts) — the actual root fix for "the whole ridge is red
   instead of the legitimate gap" and, on inspection, the IDENTICAL root
   cause as §40's Lake George highway case. Vegetation and hydrology already
   exempt a mapped road ("already broken/bridged"); the hard slope gates
   never did, so a hex blending an engineered road bed with the steep
   ground it cuts through still hard-blocked regardless of hex size. A road
   is specifically engineered (cut/fill) to manage its own grade — trusting
   the mapped road is a better estimate of driveability than a hex-averaged
   raw DEM slope. Exemption requires BOTH edge endpoints onTrail (matching
   the existing vegetation/hydrology exemption's own rule); off-trail
   terrain is completely unaffected — confirmed by explicit CONTROL tests.

**Tests:** `slopeGateOnTrailExemption.test.ts` (6 checks — the reported
climb/cross-slope scenarios exempted onTrail, both with off-trail and
single-ended-trail controls proving the gate still applies everywhere it
should); `cellBudgetVsDetourPad.test.ts` and `detourPadScaling.test.ts`
updated for the 15-minute constant. Full existing road/infrastructure/
padded-bounds/cell-budget suite (18 files) still green; `tsc`/build clean
in both packages.

---

## 42. Road-graph route fused into chokepoint/corridor analysis (2026-07-28)

Owner, challenging their own idea after §40/§41: proposed a hex grid aligned
to the road network at a fine width (~50m), coarser elsewhere for
cross-country terrain/vegetation, so "we would literally see passable paths
aligned to the roads and the cross-country corridors can be filled in as the
focus of the broader analysis... roads are known good, why not just complete
the grid over the top of them."

**Challenged and redirected, not built as proposed.** A hex grid, even a
fine one aligned to roads, is still a quantized approximation of the road —
subject to the identical slope-averaging failure mode §41 just fixed (a hex
straddling a curve or a cutting still blends road-bed with verge). The
box-free road-graph search (`roadRouteSearch.ts`, Slice A, already built)
already solves this better: it routes over the road's EXACT OSM/Mapbox
vertex geometry, zero quantization, with the road-class speed model applied
per real way segment. The owner's underlying instinct — "roads are known
good, treat them specially, let cross-country fill in around them" — is
exactly Slice A's own philosophy (docs §35: *"Roads are a network; hexes are
a tessellation"*), just already implemented as a graph rather than a grid.

**The real gap, confirmed and fixed instead:** the road-graph route was
*additive* — a separate, correctly-labelled display alongside the hex-grid
search — never counted by chokepoint ranking or corridor-band clustering,
which only ever saw the hex-optimiser's own k routes or the movement
ensemble's tracks. This was already the tracked "Fuse road-graph routes into
movement simulation / chokepoints / min-cut" roadmap item (master_plan.md,
sized M).

**What's fused this pass:** `roadRouteToDissimilarRoute` (roadRouteSearch.ts,
new) converts a `RoadRouteSearchResult` into the SAME `DissimilarRoute` shape
(`{ keys, path, totalSeconds }`) the hex-optimiser's k-cheapest routes and
the ensemble's tracks already use — resampling the route to 64 evenly-
spaced-by-distance points first (real road waypoint spacing is very uneven;
`corridorField.ts`'s `sampleRoutePoint` samples by INDEX fraction, assuming
roughly even spacing the way a hex-stepped search path naturally has), then
snapping each point onto the caller's own hex grid via `nearestCellKey`
(exported from mobilityGrid.ts for this). `mobilityAppreciation.ts` now
folds this converted route into BOTH corridor-building calls (the
ensemble-driven one via `routesOverride`, and the optimiser-driven one via a
second, cheap re-cluster pass once the road route is known) — so `dissimilarRoutes`
(what chokepoints are computed from) and the presented corridor bands both
include the real road route as a genuine avenue, either forming its own
distinct corridor or merging into an existing one if it's genuinely the same
ground.

**Stated, NOT fused this pass** (see `roadRouteSearch.ts`'s own updated
header comment): the movement ensemble's per-STEP decision logic
(`movementSimulation.ts`) still walks hex-to-hex with a road-affinity
preference — a simulated mover "on" a road is still hex-quantized, just
biased to stay there, not literally walking the road graph's exact edges.
Min-cut (`minCutBarrier.ts`) is completely unchanged — its max-flow graph is
the hex adjacency graph only, so a counter-mobility cut still targets a
whole hex rather than an exact road choke point. Both remain real, larger
follow-up work (would need the core search primitives across several files
to accept a genuinely mixed hex+road-graph adjacency, not just a route-list
injection) — not attempted here, and not silently claimed as done.

**Tests** (`roadRouteFusion.test.ts`, 6 checks): the conversion produces a
real route with monotonic cumulative time ending at the input's total;
consecutive duplicate hex keys are deduplicated; degenerate inputs (too few
waypoints, empty cell array) return null, not a crash; and the fusion itself
— injecting the converted route into `computeChokepoints` genuinely makes
its cells count toward chokepoint ranking, verified against the route's own
key set (not coincidental overlap). Full existing road/corridor/chokepoint
suite still green; `tsc`/build clean.

---

### 42a. Road-graph fusion extended: ensemble tie-break + min-cut class-tiered capacity (2026-07-28)

Direct continuation of §42, picked as the next roadmap item (master_plan.md,
"Fuse road-graph routes into movement simulation / min-cut"). §42 explicitly
left two things unfused: the movement ensemble's per-step logic still walks
hex-to-hex with a generic road-affinity bias, and min-cut's max-flow graph
treated every mapped trail as identical (`TRAIL_CAPACITY_MULTIPLIER = 3`
regardless of a two-lane highway vs. a single-track fire trail). The roadmap
framed the FULL fix as "a genuinely mixed hex+road-graph adjacency across
these core search primitives" — real, larger work this project's own
discipline (avoid a confidently-wrong shortcut on a core algorithm) has twice
now flagged as too risky to attempt in one pass. This entry ships two
bounded, honest, real improvements instead — not the full rewrite, and not
silently presented as though it were.

**1. Ensemble known-route tie-break** (`movementSimulation.ts`). At a genuine
hex-grid FORK — a junction where two or more `onTrail` neighbours are
candidates — the existing road-affinity term (module note 0) can't tell them
apart: every onTrail step looks equally "on the network". The box-free
road-graph search already knows, by exact-geometry A*, which fork is
actually part of the fastest route. New option `preferredRouteKeys` (hex keys
of the resolved road route, already computed and snapped onto the grid by
`roadRouteToDissimilarRoute`) adds a small, fixed
`KNOWN_ROAD_ROUTE_BONUS_SECONDS` (60s) pull toward those cells — small
enough on purpose to sit below the smallest `ROAD_AFFINITY_BASE_SECONDS`
base (150s), so it sharpens a fork decision without overriding the
ensemble's own stochastic spread (τ still governs how decisive it is per
mover). Threaded through the full call chain that already exists for
`blockedEdges`/`edgeCache`: `mobilityAppreciation.ts` (converts the road
route once, up front, reusing it for both this and the existing
corridor/chokepoint fusion — previously two independent conversions) →
`mobilityWorkerClient.ts` → `mobilityWorker.ts`'s request shape → both the
baseline ensemble call and `restrictionPlanner.ts`'s re-runs (kept IDENTICAL
between baseline and every candidate/scenario evaluation, so a restriction's
measured effect is never confounded by the bias changing between runs).

**2. Min-cut road-class-tiered capacity** (`minCutBarrier.ts`). Replaces the
flat `TRAIL_CAPACITY_MULTIPLIER = 3` with `HIGHWAY_CAPACITY_TIER`, keyed off
the SAME real, sourced `nearestTrailTags.highway` classification the
road-class speed model already uses (motorway/trunk 7-8×, primary/secondary
5-6×, tertiary 4×, unclassified/residential/service/untagged 3× — matching
the old flat default exactly, so nothing regresses for an untagged trail).
The exact multiplier VALUES remain an engineering judgement (no source gives
a real vehicle-capacity-per-road-class figure — the original flat 3× already
held this same honesty position); what's new is that they now vary by real
classification instead of collapsing every trail into one bucket, so a
genuine highway chokepoint and a farm-track chokepoint no longer tie on cut
value for no real reason.

**Stated, NOT done, same as §42**: neither change makes the ensemble walk
the road graph's own edges, nor makes min-cut's graph road-graph-aware — a
mover still steps hex-to-hex, and a cut still severs whole hexes, never an
exact point narrower than one. Both remain the same real, larger follow-up
work §42 already named.

**Tests** (`roadGraphEnsembleMinCutFusion.test.ts`, 6 checks): a synthetic
two-fork hex grid (built from real `axialToLocal` geometry, not a hand-rolled
approximation, so both forks are genuinely equal-cost) proves the baseline
fork balance sits near parity, and that biasing toward EITHER fork shifts the
balance decisively in that direction (not a one-directional artefact); a
preferred-route key set with no matching cells in the grid is silently
ignored, not a crash. Separately, a motorway-tagged trail chain is proven to
carry strictly more min-cut capacity than an identically-shaped untagged
track, while an off-trail chain is proven UNCHANGED at unit (1×) capacity.
Full existing road/ensemble/restriction/min-cut-adjacent suite still green;
`tsc`/build clean.

---

### 42b. The genuinely mixed hex+road-graph adjacency — road usage complete (2026-07-28)

Owner: "Finish the bigger slice of work so the road usage is fully complete."
§42/§42a both deferred the actual mixed-adjacency rewrite as real, larger,
riskier work — this entry does it, in two bounded pieces that together close
the roadmap item without rewriting either core search primitive from
scratch.

**1. Ensemble mixed-mode movement** (`movementSimulation.ts`). A mover's
recorded POSITION stays a hex cell always — every downstream consumer
(`TransitCell`'s polygon, `MoverTrack.keys`, corridor/chokepoint hex-band
clustering) still gets exactly the shape it already expects, so none of that
machinery needed to change. What changed is the CANDIDATE SET a mover chooses
from at each step: when it is on a hex cell linked to a road-graph node
(within `HEX_ROAD_LINK_SNAP_M`, 150m — onTrail cells and the road graph's own
nodes come from the same OSM/Mapbox geometry, so a real link sits far closer
than that in the common case), a bounded forward walk (`roadLandingCandidates`,
`MAX_ROAD_HOP_CHAIN` = 40 real edges) follows the road graph's OWN exact
edges — real per-edge distance, real class-based speed via
`edgeTravelTime`, never a hex-approximated straight line — until it reaches a
road node whose nearest onTrail hex genuinely differs from the mover's
current one, then offers THAT hex as a candidate with the exact cumulative
time to reach it. A long straight highway segment is no longer forced
through artificial hex-sized steps, and a real junction offers its actual
branches, not just "any onTrail hex neighbour" the tessellation happens to
present. Every branch at a fork right at the start node is walked
independently (a junction is not silently collapsed to its first-found arm),
and both the linked-node map (per onTrail cell, eager, cheap) and the
per-node "nearest hex" / per-walk landing results are memoised across the
whole ensemble run — most movers revisit the same handful of real road nodes.

**SAFETY-MOTIVATED SCOPE CUT, load-bearing, not incidental**: mixed-mode is
wired in ONLY for the unrestricted baseline ensemble. `blockedEdges` is keyed
by hex edges; a road-graph shortcut can legitimately skip past several
intermediate hexes in one step, and there is no cheap way to prove such a
skip never crosses a blocked hex edge along the way. Rather than risk a
recommended road block being silently bypassed by the very mechanism meant to
make movement more realistic, `restrictionPlanner.ts` continues to build its
own plain hex-only `EdgeCostCache` (no road graph passed in) for every
candidate evaluation AND the final restricted re-run — enforced structurally
(the road graph is simply never threaded to that call site), not by a runtime
flag that could be forgotten. The restricted picture always falls back to the
same hex-only movement this mode already used before this change.

**2. Road-network-exact min-cut** (`minCutBarrier.ts`,
`computeRoadNetworkMinCut`). A SEPARATE max-flow problem, run directly over
the road graph's own nodes/edges — deliberately not a rewrite of
`computeMinCutBarrier` to accept a mixed adjacency (`ResidualGraph`/
`bfsAugmentingPath` are reused completely unchanged; both were already
generic over string node IDs, nothing hex-specific in either). Where the hex
cut answers "the cheapest set of HEXES that severs all movement, on- or
off-road", this answers "the cheapest set of REAL road segments that severs
the road network specifically" — at the road graph's own resolution, a
single OSM vertex-to-vertex edge, very often narrower than one hex. Capacity
reuses the identical `HIGHWAY_CAPACITY_TIER` table §42a introduced (one real
classification, not a second independently-tuned hierarchy); edges are
excluded via the SAME `edgeTravelTime` blocked-check `roadRouteSearch.ts`
already uses (impassable smoothness, unfordable standing water). Wired in
`mobilityAppreciation.ts` as `roadNetworkBarrier` — vehicle profiles only,
alongside (not replacing) the existing hex `barrier`, since the two answer
genuinely different questions for the same profile (all ground vs.
road-network specifically).

**Stated scope, not silently expanded**: `roadNetworkBarrier` is computed and
logged (`ROAD-NETWORK MIN-CUT — N EXACT ROAD SEGMENT(S)...`) and carried on
`MobilityAppreciationResult`, but this pass did NOT add new Mapbox map layers,
legend entries, GIS export attributes, or AI-briefing text for it — the
existing hex `barrier` still owns the on-map counter-mobility answer. Surfacing
the road-network-exact result visually is real, smaller follow-up work,
explicitly not claimed as done here.

**Tests** (`roadGraphMixedAdjacency.test.ts`, 10 checks). Ensemble: a
deliberately extreme two-hex fixture with NO hex adjacency between them and
NO intermediate hex cells at all proves the baseline (no road graph) leaves
100% of movers stuck, while supplying the road graph lets 100% cross — via
the road graph's real chained edges (proven by an intermediate pass-through
node deliberately placed beyond the hex-link snap distance of EITHER hex, so
a single-hop shortcut could not explain the result) — at the EXACT
independently-computed travel time (not a hex approximation, since there is
no hex edge to approximate from at all); the safety gate is proven directly
(a defined-but-empty `blockedEdges` set disables the bridge entirely); an
off-trail current cell never receives road candidates even when a road graph
is supplied. Min-cut: a single-path chain cuts to exactly one segment, and
BFS over the post-cut graph confirms origin and objective are genuinely
disconnected (not just a plausible-looking answer); a motorway chain
out-capacities an identical residential chain; two parallel equal-capacity
branches require severing both, cut value summing correctly; an
impassable-tagged edge is excluded from the flow graph entirely (returns
null — already disconnected, nothing to cut); an empty graph returns null,
not a crash. Full existing test suite still green (only the pre-existing,
unrelated live-data `nvis-fidelity.test.ts` fails); `tsc`/build clean.

---

## 43. Corridor legibility pass — the route line becomes the star (2026-07-28)

Owner, reviewing a screenshot of a live run with 2 corridors present:
challenged Claude to "pull out the corridors and different options in the
screenshot without excellent prior knowledge." Honestly attempted: only one
hazy shape was findable for two labelled corridors, and one label ("Corridor
2") floated over ground with no visible feature near it at all.

**Root causes, found in the actual paint properties, not just the image:**
1. The corridor's own representative route — a real drawn line, the single
   least-ambiguous shape a corridor has — rendered at 0.8px width, `#e2e8f0`
   (near-white), 40% opacity. Effectively invisible at any normal zoom.
2. The corridor outline (`mobility-corridor-edge`) had `line-blur: 0.4` on a
   2px line — reads as a smudge, not a boundary.
3. **A real, live bug**, found while checking colours: the corridor MAP
   LABEL text (`styles-tactical.css`) was still on the OLD rank-colour
   palette (`#D8232A` red, `#F6A609` amber) from before the corridor SHAPE
   colours were moved to blue/violet/cyan specifically to stop colliding
   with the trafficability heatmap's NO-GO/SLOW-GO colours (§28-era fix) —
   the label was never updated to match, so rank 1's text was the exact same
   red as a NO-GO hex while its own shape on the map was blue.
4. The trafficability heatmap (50-55% fill-opacity) and every corridor layer
   share ONE global opacity slider (`MobilityLegend`) — raising either
   raises both, so corridors can't out-contrast the layer they're competing
   against without the user also boosting it further.

**Fixed (owner selected 3 of 4 offered options; the global-slider split was
declined as more structural than needed right now):**
- **Route line, casing + core** (`mobility-corridor-routes-casing` +
  `mobility-corridor-routes`, same pattern already used for recommended-
  restriction lines): a 6px dark casing under a 3px rank-coloured core,
  full opacity. Reads crisply against any hex colour underneath. This
  needed `corridorRoutesForMap` (App.tsx) to start carrying each route's
  `rank`/`id` — previously stripped down to bare `{ path }`, so the map had
  no way to colour-match a route to its owning corridor; a naive index
  correlation would have desynced as soon as any corridor lacked a
  representative route (the array is filtered before mapping).
- **Crisp outline**: `line-blur` removed, width 2→3, opacity 0.7→0.85.
- **Numbered rank badge in the map label** (`corridor-map-label__badge`,
  new): a small solid circle, rank-coloured fill, dark numeral, prepended to
  the existing text label — AND the label's own colour palette fixed to
  match the shape's `rankColor()` exactly (blue/violet/cyan/slate), closing
  the red/amber collision bug above.

**Deliberately not done this pass**: splitting corridors and trafficability
onto independent opacity controls (owner's 4th offered option) — a real,
larger UI change to the shared overlay-opacity mechanism, left for if the
above isn't enough on its own.

**Verification limits, stated plainly**: this is presentation-layer paint
property and DOM/CSS work — `tsc`/build are clean and the untouched corridor-
logic tests (clustering, path/polygon smoothing) still pass, but actual
rendered legibility needs the live preview to confirm, the same limitation
every other visual-only change in this doc's history has carried.

---

## 44. Road-route decoupling — the instant road-network preview (2026-07-28)

Owner, choosing the next priority: "pick an item that improves the
confidence or accuracy of the system and that will visually 'sell' it...
make sure the core is rock solid and reliable before we start adding
controls and adjustments." This closes the stated remainder flagged back in
§38's cloud-offload scoping: the box-free vehicle road route
(`findVehicleRoadRoute`, Slice A) never actually depended on the hex-grid
retry loop — it only needs the road-network fetch, one of several already-
parallel fetches inside `buildMobilityGrid` — but was computed AFTER the
whole grid/search pipeline settled purely because of where the code
happened to sit. On a large or fine-fidelity AOI that pipeline can take
tens of seconds; the road route itself resolves in a couple.

**Fixed**: `findEarlyVehicleRoadRoutePreview` (new, `roadRouteSearch.ts`)
fetches road/water data for the road route INDEPENDENTLY of
`mobilityAppreciation.ts`'s retry loop, using the exact same
`computePaddedBounds` call with the exact same first-attempt inputs
(`INITIAL_PAD_FACTOR`, `minDetourPadM(profile)`) the grid pipeline's own
attempt 0 uses — not a coincidence, a hard requirement: `infrastructureService.ts`'s
existing bbox result/in-flight cache only collapses two requests into one
real network round trip when they round to the IDENTICAL bbox key. Get the
inputs even slightly out of sync and this becomes a genuine duplicate
fetch instead of a free one — the two call sites are commented accordingly,
pointing at each other. A new `onRoadRoute` callback
(`MobilityAppreciationOptions`) fires the moment this resolves, wired into
`App.tsx` as `mobilityEarlyRoadRoute` — a fresh piece of state feeding the
map's existing `roadRoute` prop ahead of the authoritative
`mobilityResult.roadRoute`, which always supersedes it outright the instant
it lands (including correctly clearing to null if a retry-widened box moved
the route out of range — no stale preview can survive the real answer
arriving).

**Deliberately a preview, not a second source of truth**: this is
best-effort only — any fetch/compute failure resolves to nothing shown, and
`onRoadRoute` never fires; the authoritative pipeline never depends on it
succeeding, and its own log line is clearly labelled "EARLY... PREVIEW...
WHILE THE FULL AREA ANALYSIS IS STILL RUNNING" so a user watching the
assessment log never mistakes it for the final figure.

**Tests** (`roadRouteDecoupling.test.ts`, 6 checks, global `fetch` stubbed —
no real network): a foot profile triggers zero fetches (road class never
modulates foot movement, so there's nothing to preview); a vehicle profile
finds the same real route the live pipeline finds via a synthetic network
matching `roadRouteSearch.test.ts`'s own fixture; the bbox actually SENT in
the query is parsed back out of the stubbed request and checked against an
INDEPENDENTLY-computed `computePaddedBounds` call for the same inputs —
proving the cache-collapse claim by construction, not just asserting it;
a without-the-connector control still correctly finds no route; no road
data and a simulated network failure both resolve to `null` cleanly, never
a throw. Full existing suite still green (only the pre-existing, unrelated
live-data `nvis-fidelity.test.ts` fails); `tsc`/build clean.

---

## 45. Full OSM water-relation topology — multipolygon reassembly (2026-07-28)

Owner, picking the second of two priorities alongside step 40 (road-route
decoupling): "improves the confidence or accuracy of the system... make
sure the core is rock solid and reliable." Step 31 ("OSM water relations")
shipped the common case — a relation's `outer`-role members each became
their own standalone water-body trail — and stated a deliberate scope cut:
a multi-part outer ring split across several way members was never
re-stitched into one true ring, and `inner` (island) members were excluded
entirely rather than subtracted as holes. That doc entry framed both
directions as safe ("at worst an island cell is conservatively treated as
water").

**A sharper finding than the stated cut, found by reading the actual
consumer code, not just the extraction code**: `distanceToNearestWater`'s
point-in-polygon interior test already had a defensive `if (!closed)
continue` guard — meaning an UNCLOSED fragment (exactly what one piece of a
multi-member outer ring usually is on its own) was skipped entirely, not
"gated member-by-member" as the old doc comment claimed. A point deep in
the middle of a large multi-fragment lake, far from any single fragment's
own edge, was therefore not reliably detected as water at all — a real
UNDER-detection risk for a hard-block hydrology gate, the opposite of the
documented safe direction. This made the fix a correctness gap, not just a
"nice to have" completeness item.

**Fixed, in both `webapp/src/utils/infrastructureService.ts` and
`api/src/services/infrastructureService.ts` (kept in explicit lock-step,
matching the existing "MUST match" discipline)**:

- `stitchRings` reassembles a relation's same-role way-member fragments into
  closed ring(s) by matching endpoint coordinates in EITHER orientation (a
  member way's own direction is arbitrary), chaining until each ring closes.
  Nothing is ever fabricated into a false closure — an unstitchable fragment
  (a genuine data-quality edge case) still surfaces as a plain edge feature,
  the exact same degraded-but-safe behaviour every fragment got before this
  fix, not a regression for the cases the old code already handled.
- `inner`-role fragments are stitched the same way and assigned as HOLES to
  whichever stitched OUTER ring actually contains them (`pointInRing`, a
  self-contained ray-casting test — a relation can have multiple disjoint
  outer rings, each with its own islands, so this must be a real containment
  check, not "first ring wins").
- `InfrastructureTrail` gained an optional `holes?: LatLng[][]` field,
  populated only for `kind === 'water'` features stitched from a relation
  with usable inner members.
- `distanceToNearestWater` (webapp) builds a proper multi-ring GeoJSON
  `Polygon` — `[outer, hole1, hole2, ...]` — when holes are present;
  `@turf/boolean-point-in-polygon` already implements "outer minus holes"
  correctly per the GeoJSON spec, so no new point-in-polygon logic was
  needed there. `distanceToNearestTrail` (the edge-proximity half) now also
  scans hole boundaries — a real island's own shoreline is a genuine
  water/land edge too, exactly as much as the lake's own outer shore.
- `roadGraph.ts`'s self-contained `isInAnyWaterBody` (used by
  `buildRoadGraph`'s water-crossing detection, docs §37) gained the same
  hole check: inside the outer ring AND NOT inside any hole. A road entirely
  on a real island is correctly NOT flagged as an in-water crossing, closing
  the same failure mode §37's Lake George fix targeted, for the island case
  specifically.

**Tests**: `waterRelationTopology.test.ts` (webapp, 4 checks, global `fetch`
stubbed): a three-fragment outer ring stitches into one closed ring and a
point at its CENTRE (far from every individual fragment's own edge, so only
a genuinely closed ring's interior test can find it) reads as water — the
core regression this fix closes; a real island is subtracted as a hole
(island centre reads as NOT water, the surrounding lake still does); two
disjoint outer rings in one relation each get only their OWN island
(structurally verified, not just "some hole exists"); an unstitchable
fragment degrades safely, no crash, no fabricated closure. Mirrored in the
API's `infrastructure.test.ts` (4 new checks, same fixtures, "MUST match"
webapp behaviour). `roadWaterCrossing.test.ts` (webapp, 2 new checks): a
long track running the length of a real island is NOT blocked as an
in-water crossing; the SAME lake, without the island road, still correctly
blocks a track through genuine open water (a control proving the fix didn't
just turn the whole gate off). Full existing suite green in both packages
(only the pre-existing, unrelated live-data `nvis-fidelity.test.ts` fails);
`tsc`/build clean in both.

---

## 46. Hydrology attributes in GIS export / AI briefing (2026-07-28)

Owner: "on to the next priority, again focus on functional improvements and
quality — don't add 'nice to haves'." The water-gate fields (§34) have been
computed by the hard-block hydrology gate since Pass 6 — `inWaterBody`,
`nearestWaterwayKind`, `waterFrequency`, `hydrologyAvailable` — but never
reached the exported GeoJSON/KML attributes or the AI briefing payload. A
user reading either had no way to see WHY a route avoided (or crossed)
water, even though the system had already worked it out — the exact same
"real, computed data, invisible outside the live map" gap step 44 closed for
the road route, applied here to hydrology.

**Single shared predicate, not three independently-tuned copies**:
`carriesWaterSignal` (new, exported from `mobilityAppreciation.ts`) is the
literal water-signal query the run's own assessment log already computed
inline (`inWaterBody || nearestWaterwayKind !== null || waterFrequency >=
0.15`), extracted so the log, the GIS export, and the AI briefing payload all
call the SAME function — none of them can quietly drift onto a different
threshold.

**GIS export** (`mobilityGisExport.ts`): `ExportMobilityInput` gained
`hydrologyAvailable`; `missionProperties()` reports `hydrology_available` +
mission-wide `water_affected_cell_count`/`water_body_cell_count`.
`corridorProperties()` now takes a `cellsByKey` map (hoisted once per export
call, previously only built inside the placement-export branch) so each
CORRIDOR feature can report `crosses_water`/`water_cell_count` scoped to
**its own cells only** — proven by a test with a dry corridor and a wet
corridor in the same export where the wet corridor's count is neither zero
nor the grid-wide total. KML mission/corridor descriptions gained matching
plain-language notes.

**AI briefing** (`mobilityAssistantApi.ts` + `api/src/types/mobilityAssistant.ts`
+ `mobilityBriefingTemplate.ts`, kept in lock-step): payload gained
`hydrologyAvailable`/`waterAffectedCellCount`/`waterBodyCellCount` as
REQUIRED fields (not optional — these are computed on every run, same
treatment as `estimatedData`, unlike the movement/restriction blocks which
are optional because they arrived after other clients existed).
`flattenPayloadNumbers` (aiGrounding.ts) already walks the payload
generically, so the new counts are automatically available for the model to
cite without any grounding-layer change. Template briefing gains a caution
line when hydrology data was unavailable, or a plain-language water-signal
summary when real water was found — deliberately silent when data WAS
available and genuinely found none, so a clean AOI's briefing doesn't gain
noise.

**Tests**: 14 new checks split across `mobilityHydrologyExport.test.ts`
(webapp, 6 — mission-level counts, per-corridor scoping proven with a
dry/wet corridor pair, KML mission and per-corridor notes), 3 more in
`mobilityHydrologyBriefing.test.ts` (webapp — `buildMobilityAssistantPayload`
computes the fields correctly, including a genuine below-threshold
`waterFrequency` cell correctly NOT counted), plus 5 in the API's
`mobilityAssistant.test.ts` (validator rejects a payload missing either new
required field; template narrates the no-data caution, the water-found
summary, and stays silent on a clean AOI). Full existing suite green in both
packages; `tsc`/build clean in both.

---

## 47. OCOKA / IPB restructure + backend offload (2026-08-02, design)

Owner direction, two parts: (a) reframe Terrain Mobility's analysis and presentation
around the military terrain framework the mode had partly implemented by accident, and
(b) move the compute to a parallel backend holding a first-paint / update latency
contract. Roadmap rows: `master_plan.md` "Next up" → OCOKA 1–9. **Fire-break mode is out
of scope** and keeps its SMEACS/LACES fire-service framing.

### 47.0 Terminology — corrected same day (audience, not vintage)

The direction arrived using **OCOKA**. Initial research (US Army ATP 2-01.3) concluded
this was superseded by the reordered **OAKOC**, with the parent process renamed IPB →
IPOE — and the doc briefly stated that. That was wrong for this product: it checked only
US doctrine and never confirmed what the ADF — `PITCH_TERRAIN_DENIAL.md`'s actual named
audience (NORFORCE, RFSU, 1CER, Pilbara Regiment) — currently teaches. Corroborated
across multiple searches against The Cove (the Australian Army's own
professional-military-education platform): **the Australian Army currently uses OCOKA
and IPB**, in the ordering below. This is two different armies' current terminology, not
an old-vs-new supersession, and this product follows the ADF's, since that is its
audience:

| Term | ADF current (this product uses) | US Army current (for reference — not used here) |
|---|---|---|
| Five factors | **OCOKA** — Observation and fields of fire · Cover and concealment · Obstacles · Key terrain · Avenues of approach | OAKOC — same five factors, reordered (USMC retains KOCOA) |
| Parent process | **IPB** — Intelligence Preparation of the *Battlespace* | IPOE — …of the *Operational Environment* (ATP 2-01.3 Change 2, Jan 2024; Change 3, May 2025) |
| Mobility classes (MCOO) | GO / SLOW-GO / NO-GO — **unverified against ADF-specific doctrine**; see the residual-uncertainty note below | UNRESTRICTED / RESTRICTED / SEVERELY RESTRICTED |
| METT-TC | METT-TC | METT-TC **(I)** (FM 3-0, Oct 2022) |

**Residual uncertainty, stated plainly.** This is corroborated via search-snippet
summaries of one source family, not a document read in full —
`cove.army.gov.au` returned HTTP 503 on every direct fetch attempted, and no specific
current LWP-G/LWD publication was located confirming OCOKA/IPB as still doctrinally
*mandated* rather than merely commonly taught. A firmer primary source or SME review is
still worth doing before this goes in front of a serving audience, per
`PITCH_TERRAIN_DENIAL.md`'s own closing note. The MCOO mobility-class vocabulary
(UNRESTRICTED/RESTRICTED/SEVERELY RESTRICTED) was sourced the same US-doctrine way as the
original, incorrect OAKOC/IPOE call and has **not yet been separately checked** against
ADF terminology — treat it as provisional pending the same check, not as confirmed.

This engine was carrying **two vintages simultaneously** — `mobilityCost.ts` on
`GO/SLOW-GO/NO-GO`, `corridorField.ts` on `open/restricted/severely-restricted`. §47a
collapses both onto one union in `terrain/mobilityClass.ts`.

Definitions the implementation is held to:
- **Key terrain** — "any locality, or area, the seizure or retention of which affords a
  marked advantage to either combatant" (ATP 2-01.3). The definition is about *advantage
  conferred by control*, not difficulty — which is why chokepoint betweenness alone is
  **not** key terrain, and why the `compareCorridorFields` delta is the right basis.
- **Decisive terrain** — designated by the commander, **not derived from the map**. We
  compute the predicate and present a *candidate*; we never assert it.
- **Mobility corridor vs avenue of approach** — `Corridor` is a mobility corridor; an
  avenue *groups* mutually supporting corridors. `Corridor` is deliberately **not**
  renamed (20+ call sites, tests, GIS `kind`, layer ids); a thin `AvenueOfApproach`
  grouping layer sits above it.
- **Obstacles** split **existing** (natural + cultural) vs **reinforcing** (emplaced).
  Both halves are already computed; only the naming was missing.
- **Cover ≠ concealment.** Cover is protection from fire; concealment is protection from
  observation. Never blended into one score.

### 47.1 Audit against the five factors

| Factor | State at 2026-08-02 | Where |
|---|---|---|
| Obstacles | Largely built, unnamed | `minCutBarrier.ts`, `counterMeasures.ts` (already uses the correct ATP 3-90.8 effects disrupt/turn/fix/block), `delayLedger.ts`, `restrictionPlanner.ts` |
| Avenues of approach | Largely built, unnamed | `corridorField.ts`, `corridorAnalysis.ts` |
| Key terrain | Not built, ~90% computable | `computeChokepoints`, `computeMinCutBarrier`, `computeRoadNetworkMinCut`, `compareCorridorFields` |
| Observation & fields of fire | Not built | New `viewshed.ts` — already named in §8's architecture delta |
| Cover & concealment | Not built | `dataLayers/structureTable.ts` + fractional cover + dead ground |

The two genuine gaps are **§9's existing M5**, not new scope. M5 is therefore split:
**M5a** OCOKA framing + vocabulary · **M5b** viewshed/observation · **M5c** key terrain ·
**M5d** cover/concealment · **M5e** named scenarios + consensus corridors (**deferred**).

### 47.2 Honesty constraints specific to the new factors

1. **Elevation is a bare-earth DEM** (`elevationService.ts`; recorded in
   `config/provenance.ts`), sampled **one value per hex centre** — there is no raster in
   hand, which is what decides the viewshed algorithm. A bare-earth viewshed is
   **systematically optimistic**, and it errs in the unsafe direction: ground looks
   observed when it is not. Per `PITCH_TERRAIN_DENIAL.md` §4's own commitment to bias
   estimates in the direction of the question, the **screened (pessimistic) surface is the
   default**; bare-earth is a toggle; both export. If elevation came from the Terrain-RGB
   fallback (`usedMockElevation`), Observation drops to `generic-fallback`.
2. **Fields of fire** is computed only where the user states an effective range. Default
   is `fieldsOfFireAssessed: false`. The tool never infers a weapon or sensor.
3. **Cover is not computed.** `coverAssessed: false` ships as a machine-readable property
   in the GIS export, the assistant payload and the briefing — not merely UI prose — so the
   guard survives leaving the app.
4. **`not-assessed` is a first-class state**, distinct from "computed, found nothing".
5. **Semantic drift, and it cuts against us.** `'NO-GO'` is a *hard gate* here (edge
   excluded, `blockedReason` set). Doctrinally *severely restricted* does not imply
   impassability. `SEVERELY_RESTRICTED_MEANING` in `mobilityClass.ts` is the single
   exported qualification legend/export/briefing must all use, so they cannot drift.
6. **Tier-3 boundary restated.** `ObserverPost` has no name and no person field. The tool
   models terrain, not people.

### 47.3 Backend architecture (extends §38)

**Blocking infra finding.** The API is **SWA managed functions on the Free plan**
(`infra/main.bicep` has no `Microsoft.Web/sites`; `swaSku = 'Free'`). Managed functions are
**HTTP-trigger-only, Consumption-only, and cannot run Durable Functions**; bring-your-own
backends **require SWA Standard**; and **every request through `/api` is capped at 45 s**
regardless of backend. The contract cannot be met by extending the current API.

- **Topology:** separate Functions app on **Flex Consumption**, linked as the `/api`
  backend, orchestrated with **Durable fan-out/fan-in**, behind
  `deployMobilityBackend bool = false` (mirroring the existing `deployAiAssistant` flag) so
  the repo keeps deploying on Free throughout.
- **Protocol:** `POST /api/mobility/jobs` → `202 {jobId, statusUrl, resultsBaseUrl, sas}`;
  status polling returns **pointers, never data** (Durable custom status is capped at 16 KB
  UTF-16 — it is Table-Storage-backed); artefacts are append-only blobs at
  `mobilityjobs/{jobId}/{seq}-{kind}.json` with a 24-hour lifecycle rule, read **direct
  from Blob** with a job-scoped read-only SAS. Resumability falls out: a client tracks the
  highest `seq` and re-fetches only what it lacks. This is the §38 tier-3 row's "resumable
  chunked result-delivery protocol", and it is the *same* protocol for tiers 2 and 3.
- **Do not rely on Durable's default polling cadence** — `defaultAsyncRequestSleepTimeMilliseconds`
  is 30 s, three times slower than the contract. The client drives its own interval.
- **Rejected:** SignalR/Web PubSub (SWA `/api` is HTTP-only, needs its own resource and auth
  path, and degrades worse through a real connection drop); SSE/chunked over `/api` (the
  45 s cap forces reconnection logic anyway, with no native resume).
- **Code sharing:** §38's "no rewrite, just call the existing modules" was optimistic —
  they live in a different package with a different tsconfig. **Extract**
  `shared/@firebreak/terrain`, do not copy; copying would make the algorithm itself a drift
  surface. Feasible: the only React coupling is two *type-only* `ConfidenceTier` imports,
  and `logger.ts` already guards `import.meta.env` specifically so these modules run outside
  Vite. `mapboxTrails.ts` stays client-only (it reads a live GL map) — a real capability
  difference, recorded rather than hidden.
- **Security gap to close:** `rateLimit.ts` uses **in-memory per-instance buckets**, so it
  under-enforces on a scaled-out plan. The job endpoint needs a Table-Storage-backed limiter,
  plus a concurrent-job cap that refuses `429` rather than queueing.

### 47.4 What parallelises, honestly

| Stage | Parallel | Note |
|---|---|---|
| Tile sampling | Yes, by tile | **Except Overpass** — it rate-limits and this repo already fought that (2026-07-12). Cap at 2–3 concurrent. |
| Viewshed | Yes — best candidate | By observer and sector; merge is an integer add. Pass a **blob URI**, never the cell array (Durable serialises activity inputs). |
| Key-terrain candidates | Yes | Each is a pure function of `(cells, penalties)`. |
| Mover ensemble | Yes | Requires `hash(seed, moverIndex)` seeding for chunk-invariance — **this changes today's numbers once**, and must be flagged as deliberate, never silent drift. |
| Hex vs road min-cut | 2-way, free | Independent of each other. |
| Multi-source Dijkstra | **No** | Sequential frontier expansion. Δ-stepping is a real correctness risk and this repo has refused that trade before (`minCutBarrier.ts` chose textbook max-flow over the planar-dual construction for the same reason). Get the win from multi-resolution coarse-first instead. |
| k-dissimilar routes | **No** | Iteration *i+1*'s penalties come from iteration *i*'s route. |
| Restriction planner | **No across restrictions** | Each is chosen against the world the previous made. **The long pole.** Only the ensemble *inside* each evaluation parallelises. |

### 47.5 Latency contract and where it is genuinely at risk

Contract: first paint ~10 s, a meaningful update at least every ~10 s thereafter. Owner
chose **scale-to-zero**, so this is a **warm-run** contract — a cold run misses it and must
show an explicit "starting up" state, never a spinner implying progress.

Named risks, stated rather than asserted away: cold NVIS/Overpass upstreams over new ground
can take 5–20 s and we control neither (fallback: paint the coarse **DEM-only**
classification first, flagged, and upgrade it when vegetation lands); Flex cold start with
always-ready 0; the fine Dijkstra on very large AOIs, where the ~10 s update is **real
progress, not new map content** — and the UI must say which it is; the restriction planner's
sequential loop (mitigated by surfacing its existing `onProgress`/`onLog` per-candidate
stream); and mobile links, which are latency-bound *fetching*, which is why artefacts are
chunked small and individually useful rather than one large blob.

**Partial-result rules (the highest-risk part of the change).** Every artefact carries
`provisional` and `supersededBy`. **Export is disabled while provisional**; if forced
through an explicit confirm it carries `provisional: true` + `incomplete_stages`. The **AI
briefing is blocked server-side**, not just in the UI — the endpoint is public, and
narrating a converging result as final is fabrication by omission. An abandoned run stays
**permanently provisional and never upgradeable**. Promotion to final happens only when the
run completes *and* every expected artefact kind is present.

### 47.6 Contract risks in the vocabulary migration

- **GIS export** — external consumers key saved symbology off attribute names, and a
  rename fails silently. **Dual-emit for one release** (`mobility_class` +
  `unrestricted_fraction`/… alongside the legacy four), plus `schema_version: 2`. Removing
  the legacy keys is its own roadmap row, not a quiet cleanup. See `GIS_INTEROP.md`.
- **`MobilityAssistantPayload`** — the known must-match pair with two prior confirmed hits.
  The realistic skew is a cached SPA posting to a fresh API, so the validator accepts either
  vocabulary. `MobilityJobRequest` becomes the **third** such pair.
- **`mobilityTelemetry.ts` wire names are frozen** (`goCount`/`slowGoCount`/`noGoCount`) —
  they are an analytics time series in Table Storage that §47.3's tier-routing threshold
  depends on, and renaming splits the series.
- **Saved plans carry no risk** — mobility results are never persisted
  (`setMobilityResult(null)` on any AOI change).
- **Dated as-built sections §§16–46 keep their original wording** as historical record;
  correcting them would falsify history. Only forward-looking sections are migrated.

### 47.7 OCOKA 3 shipped (2026-08-03) — five-factor framing

`terrain/oakoc.ts` + `OakocPanel.tsx`, per the §47.1 audit: assembly only, no new
computation.

- **Obstacles** — `buildOcokaAppreciation` names the existing-vs-reinforcing split the
  code already computed. EXISTING (natural + cultural, i.e. derived from the terrain
  itself) is `barrier` (hex min-cut) and `roadNetworkBarrier` (road-network-exact
  min-cut), plus the chokepoint cells both are sited against. REINFORCING (deliberately
  emplaced) is `restrictionPlan` — the already-computed recommended-measure set.
  User-*placed* measures stay `CounterMobilityPanel.tsx`'s job; duplicating them here
  would be a second, divergent obstacle list.
- **Avenues of approach** — presented directly from `corridorField`/
  `restrictedCorridorField`. The `AvenueOfApproach` grouping layer described in §47.0
  (an avenue groups mutually supporting corridors) is **deliberately not built** —
  grouping honestly needs a real adjacency/support test, which is new computation this
  stage doesn't do. Each corridor is shown as its own avenue-equivalent band in the
  meantime; `OakocPanel.tsx` states this scope boundary in the UI, not just here.
- **`'not-assessed'` gate** — Obstacles/Avenues read `result.path` (null = the objective
  was unreachable, so `mobilityAppreciation.ts` never ran the corridor/chokepoint/
  min-cut block at all) as the assessed/not-assessed test. This is a different claim
  from "ran, found nothing" (e.g. `barrier: null` with a real path — a genuine "no
  separating cut needed" finding), and the two are rendered with deliberately different
  UI treatment (`OakocPanel.tsx`'s own header comment) so a reader can never conflate
  them.
- **Key terrain / Observation & fields of fire / Cover & concealment** ship now as
  explicit `'not-assessed'` placeholders (OCOKA 4/6/7 respectively) rather than being
  omitted — `fieldsOfFireAssessed: false` and `coverAssessed: false` are the exact
  machine-readable flags §47.2 requires once those factors exist, shipped early at zero
  cost so OCOKA 6/7 have nothing left to retrofit into export/briefing payloads.
- **`roadNetworkBarrier`'s first map layer + export feature** — was computed on every
  vehicle run and discarded until now. `MapboxMapView.tsx` renders it as its own layer
  (`mobility-road-barrier`, dashed purple `#7C3AED`, distinct from the hex cut's solid
  red) with a `MobilityLegend.tsx` entry; `mobilityGisExport.ts` exports it to both
  GeoJSON and KML (carrying the real OSM way name per segment where known — the hex
  barrier has no equivalent since it cuts hex-cell edges, not named road geometry).
- **`Corridor.bottleneckCellKeys` added** — names the exact cells in a corridor's own
  narrowest iso-arrival-time slice (previously only counted), for OCOKA 4's future
  key-terrain candidate scoring.
- Not touched: `MobilityAssistantPayload`/GIS export attribute names for the AI
  briefing — `roadNetworkBarrier` reaching the assistant payload is left for whichever
  future stage actually narrates Obstacles, to avoid adding fields the briefing
  template doesn't yet read.

### 47.8 OCOKA 4 shipped (2026-08-03) — key terrain

`terrain/keyTerrain.ts`, per the §47.1 audit's "~90% computable from existing
chokepoint/min-cut machinery" claim — now real, no invented signal.

- **Candidate nomination (`generateKeyTerrainCandidates`)** — cheap, main-thread, no
  search runs. Pulls from four already-computed products: the top-6 chokepoints by pass
  count, every hex min-cut segment, every road-network min-cut segment, and the
  narrowest-slice `bottleneckCellKeys` of the top-3 ranked corridors (§47.7's
  `Corridor.bottleneckCellKeys` addition, put to its intended use). Identical-ground
  candidates are deduplicated, chokepoint provenance winning the tie since it carries
  the richest real figure (an actual route-pass count).
- **Scoring (`scoreKeyTerrainCandidates`) — MUST run in the worker.** Up to 10
  candidates, each re-scored by a real re-run of `buildCorridorField` with that ground
  denied (reduced to 6 routes per re-run, `restrictionPlanner.ts`'s identical
  evaluation-vs-headline reduction), diffed against the baseline via the existing
  `compareCorridorFields`. This is the same CPU-bound, no-network-I/O shape the
  'movement' worker request already exists for; running it on the main thread
  reproduces step 41's page-hang regression exactly. New `mobilityWorker.ts` /
  `mobilityWorkerClient.ts` `'keyTerrain'` request/response kind, same
  `requestId`-correlated promise pattern as 'search'/'movement'.
- **Scored against the optimiser field, deliberately.** `optimiserCorridorField` (the
  k-cheapest-routes field, always computed regardless of which one heads the UI) is the
  baseline every candidate is diffed against — never the possibly-absent,
  possibly-expensive-to-reproduce simulated-mover `corridorField`. A stated methodology
  choice: "how much would denying this change the cheapest-route picture", not "...the
  modelled-behaviour picture."
- **`Infinity`, not a finite multiplier, for denial.** Every other `edgePenalties` user
  in this mode (`counterMeasures.ts`) stays deliberately finite — "no entry here is
  rated `block`", because a real physical obstacle in that catalogue is always
  breachable given time. Key terrain asks a genuinely different, more absolute
  question: "if this ground were fully controlled, what happens". A finite multiplier
  can never make `decisiveCandidate` mean anything — Dijkstra with any finite edge cost
  will always still find a route if one is topologically possible, however costly
  (proven while writing `keyTerrain.test.ts`: even a 1e6 multiplier over the sole gap
  in a hard-blocked water barrier still returned a route). `DENIAL_PENALTY_MULTIPLIER =
  Infinity` is the same "excluded from the graph" treatment `travel.blocked` already
  gets elsewhere (`minCutBarrier.ts`, `roadRouting.ts`), expressed through the penalty
  map instead of a second mechanism.
- **Decisive terrain stays a candidate, never an assertion.** Doctrine (ATP 2-01.3)
  reserves decisive terrain for ground a commander *designates*, never derives from a
  map. `decisiveCandidate: boolean` is a real computed predicate (`afterField === null`
  — denying this candidate made the objective fully unreachable by every analysed
  route) but is exposed, scored, and rendered (`OakocPanel.tsx`) only as a flag
  requiring confirmation. `KEY_TERRAIN_MISSION_CAVEAT` — key terrain is doctrinally
  relative to a mission this tool is not given, so it can only measure "how much does
  denying this ground change the movement picture," a real but strictly narrower
  question than "confers advantage" — is carried verbatim on every `KeyTerrainResult`
  and always rendered, not summarised or dropped, whenever a real result is on screen.
- **`mobilityAppreciation.ts` orchestration** — runs after chokepoints/barrier/
  roadNetworkBarrier compute (same `if (path)` block), skips the worker call entirely
  when candidate generation nominates zero candidates rather than round-tripping an
  empty request. New `MobilityStage` key `'keyTerrain'` for progress UI.
- **The two-reason-for-null distinction (`OcokaKeyTerrainFactor`, `oakoc.ts`)** — unique
  among the five factors, `result` can be `null` for two different honest reasons:
  `state === 'not-assessed'` (objective unreachable, same as Obstacles/Avenues) vs.
  `state === 'assessed'` with `result === null` (a real, reachable run that genuinely
  nominated zero candidates — open terrain with no chokepoint, min-cut or corridor
  bottleneck worth naming). `OakocPanel.tsx` disambiguates explicitly rather than
  assuming one implies the other; distinct wording for each ("OBJECTIVE UNREACHABLE" vs
  "KEY TERRAIN SCORING NOT AVAILABLE FOR THIS RUN" — the latter now genuinely rare
  rather than the OCOKA 3-era permanent placeholder it replaced).
- Not touched: `MobilityAssistantPayload`/GIS export — key terrain candidates reaching
  the AI briefing or GIS attributes is left for a future stage, same boundary OCOKA 3
  drew around `roadNetworkBarrier`.

### 47.9 OCOKA 6 shipped (2026-08-03) — real observation, third paint role

`terrain/viewshed.ts`, per the §47.1 audit's own naming of Observation as one of the
two genuine gaps — now real, not a permanent placeholder.

- **Algorithm — a real per-target front-to-back trace, not a shared-horizon sweep.**
  `computeViewshedForObserver` walks a new `hexLine()` (`hexGrid.ts`, standard
  cube-coordinate line draw) from observer to every in-range target, tracking the
  running max obstruction angle and comparing the target's own angle against it. This
  is simpler and cheaper-to-verify than the amortised "R3"-family sweep some viewshed
  literature uses — stated honestly rather than borrowed as a label for a variant that
  isn't the literature's actual optimisation. Earth curvature + atmospheric refraction
  (`k = 0.13`, the standard surveying combined coefficient) are applied to every
  distant point, on top of the already-known bare-earth-DEM optimism — proven by
  `viewshed.test.ts` to genuinely limit range over flat, open ground (not a no-op).
- **Screened vs bare-earth, both always computed.** A new `SCREENING_HEIGHT_M` table
  (`dataLayers/structureTable.ts`) gives each `VegetationType` a representative
  canopy-screening height, derived from Specht (1970)/Muir (1977) NVIS structural
  height-class bands (the primary DCCEEW PDF returned HTTP 503 from this sandbox, same
  limitation already recorded against that host in this file's LIGHTSHRUB row — cited
  via secondary confirmation instead). The screened (pessimistic) surface is the
  headline; bare-earth (optimistic) is always computed alongside it, never the
  default — §47.2's rule 1, restated in code.
- **Third paint role, not a MapboxDraw role** — exactly the correction §8 already made
  for this table: `mobilityBoxRole` gains `'observe'` alongside `'origin'`/
  `'objective'`, a pink (`#EC4899`) fill/outline/brush-cursor distinct from every
  existing swatch. Each painted hex becomes its own candidate observation post —
  `MobilityGridResult.observerKeys`, resolved the SAME real area-overlap way
  origin/objective already are (not a coarser point-snap). No nearest-cell fallback:
  empty is the ordinary "no observers this run" state, not an error.
- **Accuracy fix caught before shipping:** `mobilityLazyGrid.ts`'s observer resolution
  only ever runs once, at round 1, and later rounds grow toward the search's own
  reachable frontier — never toward a painted observer. An observer sited off to one
  side of the direct route could silently never be materialised. Fixed by unioning the
  observer paint's own bounds into the round-1 footprint unconditionally.
- **`state` gate is its OWN, deliberately different from every other factor.**
  `OcokaObservationFactor.state` is keyed on whether an observer was painted at all,
  not `result.path` — a viewshed never depended on origin reaching objective, so it
  runs (or doesn't) independent of whether the search found a route.
  `fieldsOfFireAssessed` stays `false` regardless: fields of fire needs a user-stated
  effective range, a real, separate, still-deferred gap (`DEFAULT_MAX_RANGE_M` is a
  compute-bound cap, never a stated range).
- Capped at `MAX_OBSERVERS_EVALUATED` (8) — each observer is a full grid-wide trace,
  same "protect the run from an unbounded input" discipline `keyTerrain.ts`'s own cap
  uses.

### 47.10 OCOKA 7 shipped (2026-08-03) — concealment from dead ground + vegetation

`terrain/concealment.ts` — the remaining letter, split into a real half and a
permanent gap, never blended into one score (§47.1's own instruction).

- **Concealment is now real, built almost entirely from OCOKA 6's own output.** Dead
  ground (defilade) is a set complement over `ObservationResult.screenedUnionKeys` —
  doctrine is explicit that defilade only means something relative to a specified
  position, and the painted observers ARE that position, so no second trace is
  needed. Vegetation-structure concealment reuses the SAME `SCREENING_HEIGHT_M` table
  at Muir (1977)'s own "tall shrubland" threshold (>2 m) — a stand at or above it
  reliably breaks a standing person's silhouette, independent of any observer.
- **Cover stays permanently, honestly not computed.** `coverAssessed: false` is now
  explicitly independent of concealment's own state (previously the whole factor was
  one flat `'not-assessed'` placeholder) — neither a bare-earth DEM nor a 4-class
  vegetation taxonomy can see a rock, bund or building, full stop. This is a build
  limitation, not a per-run gate, unlike `concealmentState` below.
- **Same gate as Observation, not `path`.** `concealmentState` is real/not-assessed on
  the identical condition Observation uses (an observer was painted) — concealment is
  only ever computed once `observation` already exists.
- `OakocPanel.tsx`'s Cover and concealment section now shows real dead-ground/
  vegetation/combined counts alongside the permanent "cover not computed" card, never
  merged into one number.

---

## 48. Fixed: `onTrail` detection was centre-point-only (2026-08-03, live bug report)

**Reported:** a road painted straight through an analysed area came out NO-GO/
severely-restricted on both sides of the real, unbroken road, blocking a much more
direct route the road should have enabled. Screenshot showed a real "Collector Rd"
threading through a broad, mostly-red (severely-restricted) painted area — the road
itself never rendered as a distinct override, and the hexes it visibly crossed stayed
red exactly as if no road were there.

**Root cause.** `mobilityGrid.ts`'s `onTrail` scan (feeding the road-class speed model
AND every onTrail-exempted hard gate in `mobilityCost.ts` — hard slope, fording,
vegetation gap-width) tested only a hex's CENTRE point against `TRAIL_SNAP_M` (30 m).
`waterDistanceM`'s equivalent scan was already upgraded to centre + six hex corners
(§35 addendum) for exactly this reason; `onTrail` was the one scan left behind. Hex
size scales with AOI span (`computeCellBudget`) — on a wide-area run it easily exceeds
30 m, so a road threading diagonally across a hex can pass nowhere near its centroid
while still visibly crossing a large fraction of its area. A centre-only test read
that ground as off-trail; `mobilityCost.ts`'s hard gates then applied full vegetation/
slope severity to ground that a real, mapped road actually crosses.

**Why this wasn't already caught by the existing onTrail-exemption tests.**
`slopeGateOnTrailExemption.test.ts` and `roadClassOnTrailSpeed.test.ts` both prove the
EXEMPTION logic in `mobilityCost.ts` is correct once `onTrail` is already `true` — they
construct fixtures where the road already snaps cleanly to a hex centre. Neither tests
DETECTION itself under the specific geometry that breaks it (a road that only clips a
hex's edge/corner). The bug lived one layer upstream of everything those tests cover.

**Fix.** Extracted the scan into a small, pure, newly-exported `sampleOnTrail()`
(`mobilityGrid.ts`) — same centre + six hex corners, minimum-distance-across-all-points
pattern the water scan already uses, returning both `onTrail` and the winning feature's
tags in one pass. `sampleCellsForHexes`'s inline block now just calls it. Both
`buildMobilityGrid` (whole-AOI runs) and `mobilityLazyGrid.ts` (incremental tile rounds)
share this one function — `mobilityLazyGrid.ts` never had its own copy of this logic, so
neither path needed a second fix.

**Tests.** New `onTrailHexCorners.test.ts`, four assertions: centre-only sampling (the
pre-fix behaviour) misses a road placed exactly at one hex corner and nowhere near the
centre or other corners; centre+corners (the fix) finds the identical road and reports
its tags correctly; a genuinely distant road is still correctly off-trail (false-positive
control); no trails at all resolves cleanly, not a crash. Full suite green: `npm test`
(37/37 files), `npm run build`.

**Addendum (2026-08-03, same-day live report) — performance regression, fixed.** "Stuck
at 20% on any reasonable sized run; very small areas still work" — the exact symptom of
an O(size²)-ish blow-up confined to the sampling phase, where this scan runs. Root cause:
the fix above called `distanceToNearestTrail` once per **(sample point × trail feature)
pair** — 7× the original centre-only scan's already-existing per-feature loop, because it
needed to know WHICH feature matched (for `nearestTrailTags`, which feeds the road-class
speed model) at every one of the 7 points, not just the minimum distance. A small AOI has
few enough cells/features that 7× is invisible; a "reasonable sized" one has enough of
both that it becomes the dominant cost. Fixed without touching the correctness guarantee
at all: `distanceToNearestTrail` already scans a WHOLE `trails` array internally in one
call (the same pattern the water scan's own corner-point loop already uses, immediately
above this function's call site) — `sampleOnTrail` now calls it that way ONCE PER POINT
(7 cheap calls, whichever point achieves the true minimum wins) and only THEN runs the
per-feature identification loop once, for that single winning point, to resolve
`nearestTrailTags`. Same global minimum-distance-wins semantics, same test suite green
(37/37 unchanged), without the 7× multiplier on the dominant cost.

---

## 49. OCOKA 5 shipped — tier-2 backend job protocol (2026-08-03)

`api-mobility/` (new standalone package) + `webapp/src/terrain/mobilityJobClient.ts` +
`webapp/src/utils/mobilityJobApi.ts` + `webapp/src/components/MobilityBackendJobPanel.tsx`
+ `infra/main.bicep` additions, all gated behind `deployMobilityBackend bool = false`
(default, unchanged from §47.3's design). Per the roadmap's own framing — "Ships
before parallelism deliberately: a wrong partial-result rule is a safety bug, a slow
correct run is only slow" — this pass is scoped to getting the JOB PROTOCOL right
(submit → Durable status polling carrying blob pointers → client reads artefacts
direct from Blob with a per-artefact SAS), sequentially, no fan-out. Fan-out is
OCOKA 8, built once tier-2 has real usage evidence.

### Why a separate `api-mobility/` package, not `/api` directly

Researched against current Microsoft Learn docs before writing any bicep: Azure
Static Web Apps allows exactly **one backend type per environment** — managed
functions (what `/api` is today) OR a linked custom backend, never both. Linking
a custom Function App as the SWA `/api` backend is therefore an all-or-nothing
cutover: every existing `/api/*` route has to move onto the SAME custom Function
App, not just the new mobility routes. That is a real, coordinated migration
(bicep + the deploy workflow's `api_location`/deployment step + the existing
managed-functions code all moving together) that cannot be safely scripted or
verified without a live Azure subscription to deploy against — genuinely
different from every other gated-flag feature this repo has shipped so far
(`deployAiAssistant` is purely additive; this is not).

Given that, this pass builds the new protocol as a **standalone, independently
buildable/testable package** (`api-mobility/`, own `package.json`/`tsconfig.json`/
`host.json`) rather than inside `/api`:
- Zero risk to `/api`'s existing, live, SWA-managed deployment — nothing in this
  package is imported by or affects `/api`'s own build.
- Real CI coverage from day one (`npm install && npm run test:unit`, wired into
  `deploy.yml`'s `build_and_test` job) instead of "trust me, it'll work once
  deployed" — every commit is independently verified in this sandbox: build,
  full test suite, and the bicep template all pass.
- At the actual cutover (`deployMobilityBackend: true` + `swaSku: Standard` +
  the existing `/api` code physically merged onto the new Function App — see
  runbook below), this package's functions move into `/api`, since post-cutover
  both sets of endpoints deploy through the same custom Function App anyway and
  the temporary duplication (`elevationService.ts`, `infrastructureService.ts` —
  see `api-mobility/README.md`) stops being necessary.

### What's real vs. what's a documented v1 scope cut

**Real, tested, working end to end (verified in this pass — `npm test` green in
`api-mobility/`, webapp's 38/38 test files still green, both `npm run build`s
clean, the bicep template compiles with the standalone Bicep CLI and every new
resource confirmed gated on `deployMobilityBackend` in the emitted ARM JSON):**
- `MobilityJobRequest`/`MobilityJobStatusResponse` — the **third** webapp/api
  must-match pair (`api-mobility/src/types/mobilityJob.ts` ↔
  `webapp/src/utils/mobilityJobApi.ts`), with the same validate-at-the-boundary
  discipline as `MobilityAssistantPayload`.
- A real Durable orchestrator (`mobilityJobOrchestrator.ts`) running five
  sequential activities — sample the grid, cost field + cheapest route,
  corridor field, chokepoints + hex min-cut, unscored key-terrain candidates —
  each writing its own client-facing artefact blob and an internal
  continuation blob for the next stage, `context.df.setCustomStatus` updated
  after every stage. Heavy data (the sampled grid, the corridor field) is
  threaded via BLOB POINTERS between activities, never through Durable's own
  activity input/output serialisation — generalised from §47.4's viewshed row
  ("pass a blob URI, never the cell array") to every stage boundary.
- `POST /mobility/jobs` (202, `{jobId, statusUrl}` — deliberately not
  `client.createCheckStatusResponse`'s own management URLs, which would leak
  Durable internals to a public caller) and `GET /mobility/jobs/{jobId}`
  (pointers + a **freshly-minted, read-only, single-blob SAS per artefact, on
  every poll** — see the refinement below).
- Table-Storage-backed rate limiting (fixed window + a concurrent-job cap that
  refuses `429` rather than queueing) — closes §47.3's own named gap in
  `rateLimit.ts`'s in-memory buckets.
- `webapp/src/terrain/mobilityJobClient.ts` — its own polling interval (not
  Durable's 30s default), tracks the highest artefact `seq` delivered so a
  dropped connection resumes rather than re-fetching or losing progress.
- `MobilityBackendJobPanel.tsx` — a **manual** trigger in `MobilityPanel.tsx`,
  gated on `VITE_MOBILITY_API_BASE_URL` being set (unset in every deployment
  until a real cutover, so there's no dead button). Manual, not automatic
  threshold routing — §38's own gate ("no automatic tier-2/tier-3 routing
  should ship" until telemetry justifies a threshold) still applies; a manual
  button needs no such calibration and is what generates the usage evidence
  that gate is waiting on.

**Deliberate v1 scope cuts (each flagged in code/docs, not silent):**
- **Vegetation is an estimated placeholder** (`vegetation: 'grassland'`,
  `vegEstimated: true` on every cell) — the client's NVIS path needs PNG
  decoding, the NSW SVTM path needs polygon classification; neither is ported
  server-side yet. Every tier-2 run therefore reports `usedEstimatedData: true`
  today, honestly.
- **DEA surface-water frequency is not sampled** server-side (OSM waterway/
  water-body geometry still drives the real hydrology gate).
- **No painted-area membership test.** `MobilityJobRequest` carries
  already-resolved origin/objective BOUNDING BOXES, not painted dab strokes;
  origin/objective seed keys are always the nearest-cell-to-bounds-centroid
  fallback `buildMobilityGrid` itself already falls back to when a painted
  area resolves to zero member cells.
- **Algorithmic coverage is a real subset of tier 1's**, not full parity: the
  optimiser's cheapest route + corridors (`optimiser-routes` evidence, not the
  simulated-mover ensemble), hex chokepoints/min-cut (not the road-network-
  exact cut), UNSCORED key-terrain candidates (scoring needs a corridor-
  comparison re-run per candidate — real work, deferred rather than rushed).
  Not yet wired into tier 2 at all: the movement ensemble, the restriction
  planner, observation/viewshed, concealment. The client Worker (tier 1)
  remains the only path for all of those today.
- **Export/AI-briefing gating on `provisional` is not wired into the existing
  export/briefing endpoints** — those currently operate on client-computed
  (tier-1) payloads; threading tier-2 artefacts into the same pipeline is
  follow-up work, tracked here rather than silently skipped.

### A real SAS refinement over the design text

§47.3 describes one job-scoped SAS issued at submit time. This storage account
is not ADLS Gen2 (no hierarchical namespace), so a true prefix-scoped SAS isn't
available — the only container-level SAS Azure would offer instead also grants
read access to every OTHER job's artefacts, a real cross-job leak. Shipped
instead: a fresh, read-only, single-blob SAS minted per artefact on every
status poll (`mobilityJobStore.ts`). Slightly more server work per poll,
genuinely job-scoped — tighter than the design text even asked for, not a
weaker substitute.

### Infra: additive-only until a deliberate cutover

`infra/main.bicep` additions, all `if (deployMobilityBackend)`: the
`mobilityjobs` blob container (24h-equivalent lifecycle rule — Azure blob
lifecycle policy only expresses whole days, so `daysAfterModificationGreaterThan: 1`
is the closest native approximation), a `mobilityjobratelimit` table, a Flex
Consumption Function App + plan, and a `Microsoft.Web/staticSites/linkedBackends`
resource linking it as the SWA's `/api` backend. **Unverified by a live
deployment** — reviewed against current Microsoft Learn documentation and
compiled cleanly with the standalone Bicep CLI (0 errors; the one new warning
matches an existing, already-accepted pattern elsewhere in this file), but
Flex Consumption's exact schema and the linked-backend cutover behaviour
should be reviewed against Azure once more before the owner's first real use.

**Manual cutover runbook** (not automated by this template or by `deploy.yml`
— a deliberate one-way infra switch, not a flag flip):
1. Deploy `api-mobility/` to the new Function App resource once (`az
   functionapp` deploy or equivalent) with `deployMobilityBackend: false`
   still set, so the SWA linked-backend resource doesn't exist yet — this
   step just gets code onto the Function App, `deployMobilityBackend` only
   controls whether the Function App/plan/linked-backend RESOURCES exist.
2. Set the GitHub Actions workflow's SWA deploy step's `api_location` to `''`
   (per Microsoft's own "remove managed functions before linking" requirement)
   — a `deploy.yml` change, not a bicep parameter.
3. Physically merge `/api`'s existing functions into `api-mobility/` (or vice
   versa) — post-cutover there is exactly one Function App serving `/api/*`.
4. Redeploy with `deployMobilityBackend: true` AND `swaSku: Standard` set
   together.
5. Verify every existing `/api/*` endpoint still resolves through the new
   linked backend before considering the cutover complete.

## 50. Movement-analysis performance + progressive-painting programme (2026-08-16, in progress)

Owner report: the tab hangs during a Terrain Mobility run and the browser
sometimes offers to kill it; only a text run-log visibly updates; the request
was also to see real analysis "painted in" as it computes (grids drawn in
first, colouring as each hex is analysed, corridors appearing/changing as
they're found), and for the run itself to be materially faster — including
whether backend offload or more parallelism could help.

**Diagnosis, from a direct profiling audit rather than guesswork:**
`mobilityAppreciation.ts` ran its post-search phases — ensemble summary,
corridor-field construction (up to 4 calls), chokepoints, hex min-cut,
road-network min-cut, key-terrain nomination — as one unbroken synchronous
block with no `await` anywhere in it; Edmonds-Karp min-cut alone runs a
`for (guard < 200000)` augmenting-path loop with no yield inside it. A
standard run performs on the order of 120 full-grid Dijkstra passes (≈18 for
corridor fields, ≈70 for key-terrain scoring, ≈33 for restriction planning),
each re-deriving hex neighbours, `hexKey` strings, `toMobilitySample`
objects and haversine distances from scratch. Separately, every Terrain
Mobility Mapbox layer's effect had a `setData` fast path that was dead code
— cleanup ran before the effect's own re-run (React's own ordering), so
`getSource(id)` was always undefined and every update took the
`addSource`/`addLayer` branch, re-tessellating the map on every change,
including on every single paint dab.

**Design decisions (owner-directed, recorded here since they shape every
stage below):**
- Numeric drift from constant-factor optimisation is acceptable if
  documented and tested, not required to be bit-identical — but see WP2
  below: the actual win turned out to be losslessly achievable anyway.
- Compute placement: **hybrid, client-first.** A cold Azure Function cannot
  hit a sub-few-second first paint, so the early, visible part of a run must
  stay client-side regardless of backend decisions; build the client-side
  parallel/incremental path now, keep the chunk-decomposition compatible
  with OCOKA 8's eventual backend fan-out, but do not deploy the backend as
  part of this program.
- Search shape: **multi-resolution coarse-to-fine**, not narrowing the
  search to plausible agent paths — the latter risks silently missing a real
  avenue of approach away from the direct line, which is precisely what this
  mode exists to find.
- Delivery: **one programme, staged as independently-shippable, independently-tested
  commits** on `claude/movement-analysis-perf-u1yhy5`, each gated on the
  full `npm test` suite + strict `tsc -b`, rather than one large PR.

### WP0 — SWA deploy pipeline fix (unblocking, unrelated root cause found in passing)

While investigating this work, found `main` had not deployed since
2026-08-03 — three consecutive pushes failed `Provision & Deploy` silently
(`Build & Test` stayed green throughout, which is why it went unnoticed).
Root cause: OCOKA 2 extracted `shared/@firebreak/terrain` as its own package
consumed via a TS path alias; `build_and_test` got a matching install step,
but `provision_and_deploy` is a separate job with its own checkout and had
none, so Oryx's remote build (scoped to `app_location: webapp`, no
workspace awareness) couldn't resolve `shared/terrain`'s own dependencies
(`@turf/*`, `geojson`). Fixed by building the webapp on the runner — where
`shared/terrain` can be installed exactly as `build_and_test` already does
— and handing the SWA action the prebuilt output via `skip_app_build: true`.
Shipped as its own PR ([#211](https://github.com/richardthorek/fireBreakCalculator/pull/211),
merged), off `main`, independent of this programme.

### WP1 — Map layers update incrementally instead of rebuilding (shipped)

Separated lifecycle from data for every Terrain Mobility Mapbox source: each
is created once and updated via `setData`/`GeoJSONSource#updateData`
thereafter; removal happens only when the layer genuinely goes away (empty
data, or unmount), with a `mobilityReattachRef` registry re-running each
group's `apply()` after a style reload (Mapbox destroys all sources on
`setStyle`). Added `promoteId` + a `feature-state`-driven colour path
(`upsertMobilityCells`/`setMobilityCellStates`, `MapboxMapView.tsx`) so a
cell can be recoloured without re-uploading geometry — the same idiom
already proven by fire-break's own slope-reveal animation. This is the
enabling prerequisite for progressive painting: more frequent updates on
top of the OLD rendering path would have made the hang worse, not better.
Purely a change to HOW data reaches the map — zero visible change to a
completed run's own output.

### WP2 — Search-core constant factors (shipped)

New `shared/terrain/src/cellIndex.ts`: precomputes, ONCE per grid (cached by
array identity), the four things every one of the ~120 passes was
re-deriving — a numeric neighbour table (`Int32Array`), per-edge haversine
distances, `MobilitySample` projections, and `crossSlopeDeg` — and
`runAccumulatedCostSearch`/`runCostToGoSearch` now search over integer
indices and `Float64Array` state instead of `Map<string, ...>`. Required to
be a **pure mechanical speedup, bit-identical output** — proven by
`searchCoreEquivalence.test.ts`, which keeps an independent frozen copy of
the pre-refactor implementation as a reference oracle and asserts every key,
value AND Map iteration order matches exactly. Benchmark
(`tests/bench/searchCoreBench.ts`): ≈2.2–2.5× on the search core alone over
120 passes at N≈2200.

Two real correctness defects were found and fixed during review, both
proven with mutation tests (deliberately reintroducing each bug and
confirming the specific test fails, then restoring and confirming green) —
neither was caught by the first "tests pass" claim:
- **Output order silently changed.** `best`'s Map was rebuilt in ascending
  cell-index order instead of first-insertion order. `resumeFrom` seeds the
  heap by iterating a prior `best`, so this fed different tie-break-by-
  insertion-order results into the MinHeap on resume, changing `prev`
  pointers and the reconstructed route on ties — common on uniform-cost
  terrain. The original equivalence test compared every key's value but
  never compared key order, so it passed anyway; fixed by tracking
  first-insertion order explicitly and strengthening the test to assert
  order too, plus a deliberately tie-heavy fixture.
- **A presence check collided with a legitimate sentinel value.**
  "Already settled" was checked as `bestTime[i] !== Infinity` — but
  `keyTerrain.ts`'s own candidate-denial mechanism applies an `Infinity`
  edge penalty on purpose ("deliberately unlike every other penalty", that
  module's own header), which can legitimately settle a cell's cost at
  `Infinity`. That collided with the "never visited" sentinel, so a denied
  cell was re-discovered and re-pushed to the output-order array on every
  relaxation into it from every direction — the live `RangeError: Invalid
  array length` crash inside `keyTerrain.test.ts`. Fixed with an explicit
  `settled: Uint8Array` presence flag, independent of the cost value,
  matching the original `Map`'s undefined-vs-present semantics.

### WP3 — Corridor field + min-cut moved off the main thread (shipped)

The actual fix for the reported hang. Extends the existing `mobilityWorker.ts`
protocol with `'corridors'`, `'chokepoints'` and `'minCut'` request kinds
(chokepoints stays main-thread — genuinely O(K·N) cheap per
`corridorAnalysis.ts`'s own header, not worth a full `grid.cells`
structured-clone) and wires `mobilityAppreciation.ts`'s orchestrator to use
them: all four `buildCorridorField` call sites and both min-cut solves (hex
+ road-network, now one combined worker round trip rather than two — the
two are independent per §47.4's own parallelism table) now run in the
worker. A new `yieldToMain()` (`asyncUtils.ts`, prefers `scheduler.yield()`,
falls back to a `MessageChannel` macrotask) sits before the remaining
genuinely-cheap main-thread work (chokepoints, key-terrain candidate
nomination) so the browser gets a paint opportunity between phases. No
unbroken main-thread stretch capable of reproducing the hang survives in
this function. Verified via strict `tsc -b` + the full suite + a manual
trace of every altered call site against the original control flow and log
order — `mobilityAppreciation.ts` itself has no unit-test harness
(transitively depends on `import.meta.env` and a real Worker, same
established limitation as `mobilityGrid.ts`).

### WP4 — Streaming partial results + key-terrain fan-out (shipped, first half of "painted in as we go")

**Streaming.** `simulateMovementEnsemble` (`movementSimulation.ts`) gains an
optional `onPartialTracks(cells, moversDone)` callback, throttled by real
wall-clock time (250ms) rather than a mover-count stride — a fixed stride
either floods a fast device or starves a slow one, a time interval adapts to
both. `buildTransitCells` (the transit-count → `TransitCell[]` projection)
is factored out of the final-result path so streamed snapshots and the
final result share one implementation. A new `'movementPartial'` worker
response kind carries these out; the client's message dispatcher needed a
matching special case (routed like `'progress'`, never resolving/deleting
the pending entry) — without it, a `'movementPartial'` message would have
fallen through to the generic resolve-and-delete path, prematurely
resolving the promise with a malformed partial and dropping the real
terminal response, caught in review before landing. Threaded through as
`onEnsembleProgress` into a new `mobilityEnsembleProgressCells` state in
`App.tsx`, which `transitCellsForMap` prefers until the run's own final
ensemble lands (always supersedes, matching the existing `onPartialResult`
precedent) — no new map-layer code needed, since `mobility-transit` already
updates via `setData` (WP1).

Proven correct with two mutation tests on the "pure observer" guarantee
(supplying the callback must never change the ensemble's own RNG draws or
final result): a first sabotage that consumed an extra RNG draw turned out
to be genuinely inert (each mover's stream is independently seeded per
`hashSeedForMover`, so a dead mover's exhausted RNG being drawn once more
affects nothing downstream) — a useful negative result, discarded once
understood. A second sabotage that duplicated a `transitCounts` increment
inside the throttled branch WAS caught, but only after raising the test's
own mover count enough to guarantee the throttle actually fires during the
comparison — the original test's mover count was too small to reliably
exercise the callback at all, which would have made the comparison pass
vacuously regardless of correctness.

**Key-terrain fan-out.** New `webapp/src/terrain/mobilityWorkerPool.ts`:
key-terrain candidate scoring — ≈70 of a standard run's ≈120 Dijkstra
passes, the single largest chunk, and already proven independent per
candidate (`keyTerrain.ts`'s own header, §47.4's parallelism table) — now
fans out across up to 4 worker instances instead of the single shared
worker, reusing the EXISTING `'keyTerrain'` request/response protocol
unchanged. Pool size capped well below `navigator.hardwareConcurrency`
since each worker gets its own structured-clone copy of the full cell
array. Two correctness traps, both designed around explicitly rather than
found after the fact: (1) `scoreKeyTerrainCandidates` ranks internally, so
a chunk-local rank 1 is only correct within that chunk — every pool
response's own rank is discarded and reassigned globally on the main
thread after every chunk returns; (2) `scoreKeyTerrainCandidates` also
independently re-applies `MAX_CANDIDATES_EVALUATED` per call, so chunking
the FULL candidate list without pre-slicing first would let each of N
workers apply the cap again, evaluating up to N× the intended bound — the
pre-slice happens once, before chunking. The merge/re-rank logic is
extracted into pure, Worker-free functions (`chunkCandidates`,
`mergeKeyTerrainChunks`) specifically so this risk surface is directly
unit-testable without spawning a real Worker.

### WP5 — Tier B redundant-pass elimination (shipped)

Four independent, mechanical fixes, each landed and independently
re-verified (not just accepted on the implementer's own test claim) before
committing:

- **`computeCellFacts` skips its own redundant search when arrival times are
  already known.** New opt-in `arrivalSecondsOverride` option
  (`corridorField.ts`) lets a caller that already ran an identical search
  elsewhere in the run (the lazy grid's own settling search) reuse that
  `Map` instead of paying a second full `runAccumulatedCostSearch` purely to
  re-derive arrival times. Defaults to unset for any caller whose
  `edgePenalties` might differ from the prior search (`keyTerrain.ts`'s
  per-candidate denial evaluation), where reuse would be silently wrong.
  Wired from `mobilityAppreciation.ts`'s baseline search into the three
  `buildCorridorField` call sites that pass `routesOverride`. Review found
  the override map is structurally different from what the internal search
  produces (every cell present with `timeSeconds: Infinity` for unreachable
  ones, vs. unreachable cells simply absent from the map) — traced both
  actual read sites and confirmed both filter via `isFinite()`, never Map
  presence, so the difference is behaviourally inert today; a test now
  exercises that exact production-shaped override, not only the
  reached-only shape the original test used.
- **Min-cut stops computing every edge's cost twice.**
  `computeMinCutBarrier`/`computeRoadNetworkMinCut` each called
  `edgeMobilityCost`/`edgeTravelTime` once at graph-build time and again at
  boundary-extraction time, from scratch, for the same edge. Both now cache
  the build-time passability verdict in a dedicated map (not read from the
  residual graph's own capacity, which the max-flow solve mutates, making a
  later `0` ambiguous between "never existed" and "fully saturated"). The
  hex cache is safely string-keyed (exactly six distinct neighbour
  directions per cell); the road cache is keyed by `RoadEdge` OBJECT
  IDENTITY, not a string — the road graph is a real OSM-derived multigraph
  where two different mapped ways can produce two separate `RoadEdge`s
  between the same node pair, each with its own independent `blocked`
  verdict, and a string key would let one silently overwrite the other's
  cached answer. Proven with a test that builds two parallel edges with
  opposite passability in both array orderings.
- **`applyCrossSlope` recomputes only new cells plus their halo**, not the
  whole accumulated grid every lazy-grid round. The per-cell plane-fit logic
  is extracted verbatim out of `computeDemDerivatives` (`demDerivatives.ts`)
  into a shared `fitCellPlane`, so the new incremental
  `computeCrossSlopeForCells` and the existing full-recompute path can never
  independently drift. New `applyCrossSlopeIncremental` recomputes exactly
  `newCells` ∪ every already-materialised cell hex-adjacent to at least one
  of them — the only cells whose plane fit could possibly have changed,
  since a cell's `elevation`/`center` are set once at sampling time and
  never mutated afterward (verified directly by grepping the whole terrain
  codebase for any such mutation, not just asserted). Deliberately does NOT
  attempt incremental TWI — that is a global multi-hop flow-accumulation
  pass, not a pure per-cell computation, so it stays a full-grid-only
  concern. A test proves the halo boundary exactly (adjacent cells update,
  near-but-not-adjacent cells don't) and that a multi-round incremental run
  is bit-identical, cell-for-cell, to one full recompute of the final grid.
- **`estimateDistinctCorridorCount` is throttled by real growth**, not
  unconditional every round. A pure `shouldCheckCorridorCount` predicate
  (checks on the very first opportunity, once accumulated growth reaches
  20% of the current total, or unconditionally within one round of
  `MAX_LAZY_ROUNDS` as a growth-independent safety net) is exported and
  called directly by the loop, so the test exercises the literal production
  predicate rather than a second implementation. The risk this fix's own
  brief called out — "must not leave genuine avenues undiscovered" — is
  tested directly: a realistic slow-growth tail stops within a bounded
  number of rounds of the true count becoming sufficient, and the
  adversarial case (a pathological zero-growth plateau, where no
  growth-based check can ever fire) still stops via the round-cap safety
  net at exactly its own trigger round, never silently forever.

Gates: 45/45 test files, strict `tsc -b`, `shared/terrain`'s own build,
all clean.

### Code-review pass over WP1–WP5 (2026-08-17) — three correctness bugs found and fixed

An 8-angle review of the whole diff (line-by-line, removed-behaviour audit,
cross-file trace, reuse, simplification, efficiency, altitude, conventions)
surfaced three real bugs, each verified against the actual code before
fixing (not accepted on the reviewing pass's own claim) and fixed with a
proof — mutation-tested wherever the fix could regress silently:

- **Restricted corridor field reused unrestricted arrival times.**
  `mobilityAppreciation.ts`'s restricted-corridor call passed
  `baselineArrivalSeconds` (the unrestricted search's own result) into a
  corridor field whose routes came from an ensemble re-run with
  `blockedEdges` applied — violating `computeCellFacts`'s own documented
  contract ("must be a search over the exact same `edgePenalties`") in the
  one place it actually mattered, corrupting the restricted corridor's
  bottleneck/width figures with fabricated-looking facts. Root cause: the
  `'corridors'` worker request deliberately excluded `edgePenalties` on the
  (wrong) assumption no run-time call needed it. Fixed by adding
  `edgePenalties` to that request end to end and building an
  `Infinity`-penalty map from `RestrictionPlan.blockedEdges` at the
  restricted call site, instead of reusing the wrong override.
- **Pooled key-terrain scoring under-reported `candidatesConsidered` on
  single-core devices.** The pool's `poolSize<=1` fallback (hit whenever
  `navigator.hardwareConcurrency===1`) pre-sliced candidates before sending
  them, so the returned count reflected the cap, not the true nominated
  total. Fixed by having that fallback reuse the existing shared singleton
  worker with the ORIGINAL, un-sliced candidate list — exactly what a
  non-pooled call always did — which also put a previously-dead function
  back into use and stopped a redundant permanent second Worker from being
  spun up for a case that gains nothing from pooling.
- **The lazy-grid corridor-count throttle's safety nets didn't cover all
  three of the loop's exit paths.** `shouldCheckCorridorCount` forced a
  fresh check on the first opportunity and near `MAX_LAZY_ROUNDS`, but the
  loop's third exit (`nextNeeded.size === 0`, frontier exhausted) was
  covered by neither — a round throttled by growth that also happened to
  be the frontier-exhausted exit could report a stale
  `corridorCountAtStop` right when the run's own log asserts, with specific
  confidence, that the budget genuinely ran out. Fixed by moving the
  `nextNeeded` computation before the throttle check and adding
  `frontierExhausted` as a third unconditional trigger to the predicate
  itself, with the same mutation-tested rigor the other two nets already
  had.

Also corrected a doc comment on `cellIndex.ts` that overstated its own
adoption — it read as if `corridorField.ts`/`minCutBarrier.ts`/
`movementSimulation.ts`/`keyTerrain.ts` consumed the cache directly; they
only benefit from it indirectly, through the two search functions that do,
and each still runs its own separate `byKey`/`hexNeighbors`/
`toMobilitySample` hot loops — a real, undone follow-up, not something
already covered.

Five lower-severity findings from the same pass were reported but
deliberately left unfixed in this pass — real, but each is either a
pre-existing pattern this PR only amplified (no cancellation/teardown for
the key-terrain worker pool, mirroring the single shared worker's
pre-existing lack of abort wiring), a latent gap with no current caller
that triggers it (`onPartialTracks` streaming can't actually be opted out,
since a function can't cross `postMessage`), a low-probability exact-tie
edge case (pooled key-terrain ranking can reorder two candidates with
identical `impactScore`), an architectural duplication trade-off already
reasoned about in the code's own comments (`mobilityWorkerPool.ts`
reimplements `mobilityWorkerClient.ts`'s request-correlation machinery
rather than generalising it), or a missed opportunity rather than a
regression (the new ensemble-streaming path drives `mobility-transit`
through a full `setData` replace every ~250ms instead of the incremental
`updateData`/`promoteId` path WP1 built in the same PR for exactly this
purpose). See the PR's own review-finding thread for the full detail on
each.

Gates: shared/terrain build clean, webapp strict `tsc -b` clean, full suite
45/45 test files green, including the extended and mutation-verified
`lazyCorridorCheckThrottle.test.ts` (11 checks, up from 9).

### WP6 — Multi-resolution coarse-to-fine search (design, not yet implemented)

**Goal, restated precisely.** A fast first paint over the WHOLE area of
interest, with full-fidelity analysis spent only where a real avenue of
approach might actually be — without narrowing the search to a single
plausible corridor first, which is the shape the owner explicitly rejected
(§50 top, design decisions) because it risks silently missing a genuine
avenue away from the direct line. Multi-resolution coarse-to-fine is the
version of "don't do full work everywhere" that keeps full-area breadth: it
changes RESOLUTION, not COVERAGE.

**Mechanism — two passes over the SAME existing pipeline, not a new
algorithm.** The lazy-grid search (`mobilityLazyGrid.ts`), the corridor
field (`corridorField.ts`), and the whole rest of the analysis chain are
already parameterised by `hexSize` — nothing about them assumes a
particular resolution. WP6 is therefore "run the existing pipeline twice,
at two resolutions, with the second pass's materialisation region derived
from the first's own candidate corridors" rather than a new search
algorithm:

1. **Coarse pass.** Run `runLazyMobilitySearch` + `buildCorridorField` at a
   COARSENED `hexSize` — a multiple of the fine `hexSize`
   `computeCellBudget`/`chooseHexSize` would otherwise pick for the
   requested fidelity (candidate starting point: 4×, which drops cell count
   by roughly 16× since cell count scales with `1/hexSize²` — an exact
   multiplier needs calibrating against real device telemetry, the same way
   the OCOKA 8/9 tier-routing threshold is deferred to
   `mobility-telemetry`'s real-run data rather than guessed). This produces
   a real (not synthetic) coarse reachability field, a coarse cheapest
   route, AND — critically — a coarse `CorridorField` with MULTIPLE
   candidate corridors from `findKDissimilarPaths`, not just the single
   cheapest route. Multiple distinct avenues are therefore already
   represented before any resolution decision is made about where to
   refine — this is what keeps the two-pass design honest against the
   "don't narrow to one path" constraint.
2. **Refine pass.** Build the fine-resolution materialisation region as the
   UNION of every coarse corridor's own member cells, expanded by a fixed
   padding margin (e.g. 2 coarse-hex-widths, converted to the equivalent
   set of fine-resolution tiles) — not just a tube around the single
   cheapest coarse route. The padding exists because a coarse-resolution
   cost estimate is only approximate; a genuinely better fine-resolution
   alternative can sit just outside a coarse band's own boundary purely
   from quantisation, and the margin is what catches it. Run the EXISTING
   fine-resolution pipeline unchanged, except the lazy grid's tile-growth
   frontier gets ONE more constraint alongside its existing `alpha × C*`
   budget: only grow into tiles that fall within this coarse-derived
   region. Everything downstream (ensemble, restrictions, chokepoints,
   min-cut, key terrain) then runs exactly as it does today, just over a
   pre-narrowed — but honestly, corridor-derived, not path-derived —
   fine-resolution grid.

**Progressive painting falls out of this almost for free.** The coarse
pass's own results (reachability, route, corridor bands) are real, already-
computed data the moment the coarse pass finishes — well before the fine
pass even starts materialising tiles. This is a natural extension of the
provisional-painting discipline WP1/WP4 already ship: the coarse layer
paints immediately in the SAME provisional visual treatment
`onPartialResult`/the streamed ensemble cells already use, and is
explicitly superseded (not merely overwritten) the moment the fine pass's
own results land, mirroring the existing `mobilityEnsembleProgressCells` →
`mobilityResult.ensemble` precedence in `App.tsx`.

**The honesty constraint this design must not compromise, stated plainly.**
Per §47.5's existing rule, everything painted mid-run is `provisional`, and
export/AI-briefing stay gated on the run being genuinely finished — the
coarse pass's own numbers (arrival times, bottleneck widths) are exactly as
provisional as any other in-progress figure and must carry that flag
through the same mechanism, not a new one.

**The residual risk, stated rather than engineered away.** Coarsening
resolution is a real information loss, not just a speed trick: a genuinely
narrow real avenue could in principle be too thin for the COARSE pass to
distinguish at all, in which case no amount of fine-resolution padding
around a coarse corridor helps, because the coarse corridor was never
identified as a candidate in the first place. This is a probabilistic
argument (a coarse hex several multiples wider than a real corridor is very
unlikely to fully miss it, but not proven impossible), not a guarantee, and
must be documented as a stated limitation of this mode wherever the
coarse-to-fine path ships — the same "not assessed ≠ found nothing"
discipline already applied to cover/concealment (§47.2) applies here too.

**Gating — not always worth the two-pass overhead.** A `quick`-fidelity run
(900 target cells, `computeCellBudget`) is unlikely to benefit at all; the
coarse pass's own fixed overhead could net-lose against just running the
fine pass directly on a small grid. WP6 should therefore gate on the
FINE-resolution target cell count exceeding some threshold before engaging
the coarse pre-pass at all — falling back to today's single-resolution path
below it. The exact threshold, like the coarsening multiplier itself,
should be calibrated against real-device timing data rather than guessed,
consistent with this codebase's existing practice for scale-dependent
tuning constants.

**Not yet started** — this section is the design brief for a future
implementation pass, not a record of shipped work.

### Also not yet built

Frontier-streaming from the Dijkstra search itself (visible reachability
"flooding outward" during the search phase, as distinct from the
ensemble-transit streaming WP4 already ships) has not been built.

---

## Update policy
Update this doc when the optimizer cost model, sampling strategy, insight rules, or data sources change.
