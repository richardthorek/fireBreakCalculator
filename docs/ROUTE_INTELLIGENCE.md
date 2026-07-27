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
| `hexGrid.ts`, `sampleElevationsCached`, `sampleVegetation` + retention, NVIS/SVTM services, `infrastructureService.ts`, `mapboxTrails.ts`, `normalizeHeatmap`, heatmap layers, `gisExport/gisImport`, provenance/honesty plumbing, rate limiting, auth, AI grounding gate | `moverProfiles.ts` (catalogue), `mobilityCost.ts` (directional, profile-parameterised), `accumulatedCost.ts` (multi-source Dijkstra → cost field + isochrones), `corridorAnalysis.ts` (route-preference surface, band extraction, k-dissimilar routes, betweenness), `barrierPlanner.ts` (dual-graph min-cut, measure siting), `counterMeasures.ts` (catalogue + breach/delay matrix), `viewshed.ts`, `denialLedger.ts` | `edgeCost` → injectable cost strategy; `optimizeRoute` → multi-source/multi-target; MapboxDraw `role` gains `origin`/`objective`/`deny`/`observe`/`measure`; `areaScan.ts` generalised from box to polygon AOI |

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
| M5 | Intent & observation — viewshed/concealment weighting, named scenarios, consensus corridors, sensor/OP siting | Tier-2 framing must ship with it |

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

**Status: DESIGN ONLY. Not built.** Recorded here before implementation per
CLAUDE.md's roadmap-first rule.

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

Caveat on "internal cost": these rasters decode in the **browser** (canvas
`getImageData`), not server-side. The ceiling is client CPU/memory — generous,
but real at very fine resolution over very large areas.

### Deliberately NOT in this design

- **Mixed-size cells in one graph** — superseded by the two-pass approach
  above.

### Already shipped — not to be rebuilt

- **Bridges/fords.** §34 already exempts the fording gate where an edge sits
  on the mapped trail network, matching owner's "roads or tracks over water
  have bridges or fords." A real road graph would sharpen this from a
  per-hex boolean to an actual road edge crossing water.
- **Corridor clustering.** `corridorField.ts` ranks routes into bands and
  tracks `evidence`; feeding it north/south routes should produce the
  two-corridor picture directly.
- **Streaming paint-in.** Frontier expansion is inherently incremental, so the
  owner's requested "hex grid painted in as pathways are identified" becomes
  *easier* than today's staged progress. Worker progress channel (§33) and
  the water reference layer (§34) already exist; roads as a drawn layer are
  new but the data is already fetched.

---

## Update policy
Update this doc when the optimizer cost model, sampling strategy, insight rules, or data sources change.
