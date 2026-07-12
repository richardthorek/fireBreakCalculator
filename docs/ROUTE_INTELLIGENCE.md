# Route Intelligence — As-Built & Design

**Status:** Corridor optimizer + Plan Assistant shipped (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163), July 2026), since upgraded from a rectangular lattice to a hexagonal multi-pass search + on-map scan visualization. Infrastructure-aware cost surface is built (trails), hardened 2026-07-12 with multi-endpoint Overpass resilience after live testing showed the single public instance rate-limits and intermittently fails; water/cadastre overlays remain designed.
**Owner doc for:** pathfinding, chainage model, insight engine, terrain UI, and their planned extensions.

---

## As-built (July 2026)

### Chainage model (`webapp/src/utils/chainage.ts`)
Every along-line location is addressed by **chainage** (metres from line start). One index (`buildChainageIndex`) converts chainage ↔ coordinates; the elevation profile, segment table, insights, and map highlights all reference the same chainage so every surface points at the same ground.

### Corridor optimizer (`webapp/src/utils/routeOptimizer.ts`, `hexGrid.ts`)
**Hexagonal multi-pass search** (superseded the original rectangular lattice+DP in July 2026, same PR). Waypoints are fixed — the optimizer refines *between* consecutive pairs, never replaces the user's intent.

- **Grid:** each leg's corridor is tiled in pointy-top axial hexagons (`hexGrid.ts` — Red Blob Games reference formulas; the same tiling style Uber's H3 uses for spatial routing). Every cell has 6 equidistant neighbours, so the search can bend in any direction at every step rather than only nudging sideways off a straight line, which a 9-lane lattice could not do.
- **Three passes per leg, automatic:** *wide* (half-width up to min(900 m, 45% of leg length), ~650 cells) → *refine* (32% of the wide width, ~480 cells, corridor re-centred on the wide pass's own path) → *polish* (14% of the wide width, ~320 cells, centred on the refine pass's path). The cheapest of the three always wins — later passes can only match or beat the wide pass, never lose ground to it. This intentionally spreads further than a cautious single pass would, and bakes into one click what used to take a couple of manual re-runs to stumble into.
- **Search:** Dijkstra over the hex adjacency graph; start/end connect to every hex within reach (not just the nearest) so the search picks whichever entry/exit is genuinely cheapest. **No direct start→end shortcut edge** — an earlier version had one as a connectivity fallback and it silently "tunnelled" through terrain by comparing only the two endpoint elevations (caught by the smoke test: two waypoints at equal elevation either side of a ridge produced a zero-slope "path" that was actually just the raw straight line). A pass that can't connect is treated as failed, not patched over.
- **Sampling:** elevations via ONE batched `POST /api/elevation/profile` per pass (falls back to Terrain-RGB tiles); vegetation via `fetchStateVegetation` (NSW SVTM → NVIS), deduped on a ~100 m cache grid; the infrastructure (trail) fetch runs once per leg and is reused across all three passes.
- **Cost:** metres × traversal-slope factor (quadratic ramp, ×1.6 ≥25°, ×3 ≥45°) × fuel factor (grass 1.0 / light 1.2 / medium 1.7 / heavy 2.6), discounted on mapped trail (see below). Douglas-Peucker simplify (15 m) on the final output.
- **Honesty:** any estimated elevation or vegetation sample → `usedEstimatedData: true`, surfaced in the UI. Missing vegetation data is assumed `mediumscrub` **and flagged estimated** — never silently optimistic.
- **Lifecycle:** result is a dashed map preview + original-vs-optimized stats (length, max slope, steep metres, heavy-timber metres, trail reused, effort score). Apply = replace drawn line and re-run the full analysis pipeline; Dismiss = discard.

### Corridor scan visualization ("UI theatre")
The wide (pass-1) hex cells double as an on-map heatmap: each cell's cost is the average cost-per-metre over its incident edges (a genuine terrain+vegetation difficulty metric, not a proxy), normalised 0–1 across the whole route and rendered with a Mapbox `interpolate` expression (smooth green→amber→red gradient, not discrete buckets) — `MapboxMapView.tsx`'s `hex-heatmap` layer, fading in over ~900 ms. While the optimizer is running, a translucent sweep band + bright leading edge animate across the drawn line's bounding envelope (`optimizerScanning` prop, plain `requestAnimationFrame`, no library) to signal "the system is reading terrain and fuel here" before the real result lands. Both are purely decorative/non-interactive; the sweep is skipped outright under `prefers-reduced-motion` (the heatmap still appears, just without the animated fade-in).

### Plan Assistant (`webapp/src/utils/planInsights.ts`)
Deterministic rules over the existing analyses (never new data): steep/very-steep runs and heavy-timber pockets located by chainage; estimated-data and low-confidence caveats; crewing strategy from equipment results; optimize nudge; 0–100 difficulty score. Rendered as severity-ranked cards (`AdvisorPanel.tsx`) with locate/optimize actions.

### Terrain UI
`ElevationProfile.tsx` (SVG, slope-colored, vegetation band, hover → map marker via chainage) and `SegmentBreakdown.tsx` (joined slope×vegetation slices with chainage, grade, fuel, confidence, estimated flags, locate). `analyzeTrackSlopes` emits a ≤600-point `elevationProfile` for the chart.

### Verification
Two Node smoke scripts (rolldown-bundled, stubbed DEM/vegetation/infrastructure): a 12-check hex-math sanity pass (axial↔local round-trips, 6-neighbour adjacency, corridor coverage) run in isolation before wiring the grid into the optimizer, plus a 58-check main suite covering the optimizer against a synthetic ridge + timber pocket (reduces steep ground and heavy timber, keeps endpoints fixed, preserves honesty flags, heatmap cells are valid normalised/closed polygons with a real gradient, a wide multi-pass search matches-or-beats a narrow single-pass corridor), OSM trail detection/reuse/economics, GIS export/import round-trips, and Plan Assistant insights. Re-run pattern documented in PR #163.

---

## Infrastructure-aware cost surface

**Trails + anchors are ✅ built** (July 2026, PR #163):

1. **Existing trails/roads as discounted edges** (`infrastructureService.ts`): one Overpass query per leg's widest corridor bbox (`highway ~ track|path|service|unclassified|road|tertiary|secondary|residential`, `out geom`, 12 s server timeout, bbox-cached), reused across all three passes. Hex cells within **30 m** of a mapped way count as on-trail; edges with both ends on-trail get **×0.35 on the fuel factor** (the ground is already broken; slope still applies). `RouteComparisonStats.existingTrailDistance` reports metres reused; the AdvisorPanel shows an "Existing trail used" before/after row.
2. **Multi-endpoint resilience (2026-07-12):** the public `overpass-api.de` instance enforces a strict 2-concurrent-slot-per-IP quota and is intermittently flaky under load (confirmed live: transient `406`s with no rate-limit signal, plus `429 rate_limited` after a handful of requests — a real-world failure mode, not a hypothetical). A single bad response used to sink trail lookups for the rest of that optimize run. The service now tries a short list of endpoints in order (`overpass-api.de` → `maps.mail.ru`'s Overpass mirror → `overpass.kumi.systems`, overridable via `VITE_OVERPASS_URLS`), 10 s per-attempt timeout, moving to the next endpoint immediately on any non-2xx/network/timeout failure rather than retrying a struggling one. Whichever endpoint last succeeded is remembered for the rest of the session, so a multi-leg route doesn't re-pay the primary's rate limit on every leg. Verified live (2026-07-12): a 3-leg sequential run where the primary failed on leg 1 fell over to the mirror and stayed on it for legs 2–3 with no dropped trail data.
3. **Honesty:** failure across every endpoint returns `available:false` (never cached) → the result carries `infrastructureAvailable:false` and the UI says trail data was unavailable rather than implying no trails exist. Reused trails are labelled "OSM-mapped — verify trafficability".
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

## Update policy
Update this doc when the optimizer cost model, sampling strategy, insight rules, or data sources change.
