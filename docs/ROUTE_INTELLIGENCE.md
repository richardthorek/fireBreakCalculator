# Route Intelligence — As-Built & Design

**Status:** Corridor optimizer + Plan Assistant shipped (PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163), July 2026). Infrastructure-aware cost surface is designed, not yet built.
**Owner doc for:** pathfinding, chainage model, insight engine, terrain UI, and their planned extensions.

---

## As-built (July 2026)

### Chainage model (`webapp/src/utils/chainage.ts`)
Every along-line location is addressed by **chainage** (metres from line start). One index (`buildChainageIndex`) converts chainage ↔ coordinates; the elevation profile, segment table, insights, and map highlights all reference the same chainage so every surface points at the same ground.

### Corridor optimizer (`webapp/src/utils/routeOptimizer.ts`)
- **Lattice:** between each pair of user waypoints: stations every 60–150 m (≤26/leg) × 9 lateral lanes (offset up to min(400 m, 30% of leg)). Waypoints are fixed — the optimizer refines *between* them, never replaces the user's intent.
- **Sampling:** elevations via ONE batched `POST /api/elevation/profile` (falls back to Terrain-RGB tiles); vegetation via `fetchStateVegetation` (NSW SVTM → NVIS), deduped on a ~100 m cache grid (matches NVIS raster), concurrency 6.
- **Cost:** metres × traversal-slope factor (quadratic ramp, ×1.6 ≥25°, ×3 ≥45°) × fuel factor (grass 1.0 / light 1.2 / medium 1.7 / heavy 2.6).
- **Search:** dynamic program station-by-station, lane shift ≤2/step (keeps the line sweeping/buildable). Douglas-Peucker simplify (12 m) on output.
- **Honesty:** any estimated elevation or vegetation sample → `usedEstimatedData: true`, surfaced in the UI. Missing vegetation data is assumed `mediumscrub` **and flagged estimated** — never silently optimistic.
- **Lifecycle:** result is a dashed map preview + original-vs-optimized stats (length, max slope, steep metres, heavy-timber metres, effort score). Apply = replace drawn line and re-run the full analysis pipeline; Dismiss = discard.

### Plan Assistant (`webapp/src/utils/planInsights.ts`)
Deterministic rules over the existing analyses (never new data): steep/very-steep runs and heavy-timber pockets located by chainage; estimated-data and low-confidence caveats; crewing strategy from equipment results; optimize nudge; 0–100 difficulty score. Rendered as severity-ranked cards (`AdvisorPanel.tsx`) with locate/optimize actions.

### Terrain UI
`ElevationProfile.tsx` (SVG, slope-colored, vegetation band, hover → map marker via chainage) and `SegmentBreakdown.tsx` (joined slope×vegetation slices with chainage, grade, fuel, confidence, estimated flags, locate). `analyzeTrackSlopes` emits a ≤600-point `elevationProfile` for the chart.

### Verification
22-check Node smoke test (rolldown-bundled, stubbed DEM/vegetation with a synthetic ridge + timber pocket) proves the optimizer reduces steep ground and heavy timber, keeps endpoints fixed, and preserves honesty flags. Re-run pattern documented in PR #163.

---

## Designed: infrastructure-aware cost surface (next)

**Goal:** the best fire break often half-exists. The optimizer should know about it.

1. **Existing trails/roads as discounted edges.** Source: OSM (Overpass API or Mapbox vector tiles `road` layer) — `highway=track|service|unclassified|path`, plus `man_made=firebreak` where mapped. Lattice nodes within ~30 m of such a feature get a cost discount (×0.35 on the vegetation factor — the fuel is already broken) and the assistant reports "uses 1.8 km of existing trail".
2. **Anchor features.** Waterways (`waterway=river|stream` with width), water bodies, and cleared land (NVIS MVG 25) near line endpoints → assistant insight when an end does NOT terminate at an anchor ("western end terminates in continuous fuel — extend 220 m to Back Creek").
3. **Advisory overlays (no cost effect):** water fill points (OSM `waterway=*`+`water_point`, NSW spatial services), cadastre boundaries (NSW DCS Spatial Services — check licensing/attribution before shipping).
4. **Honesty:** OSM completeness varies; discounted segments are labelled "mapped trail — verify trafficability".

**Integration points:** cost function already isolates slope/fuel factors (add an `infrastructureFactor`); assistant already supports chainage-anchored insights; map already supports advisory overlays.

---

## Update policy
Update this doc when the optimizer cost model, sampling strategy, insight rules, or data sources change.
