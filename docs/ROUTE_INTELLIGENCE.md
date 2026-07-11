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

## Infrastructure-aware cost surface

**Trails + anchors are ✅ built** (July 2026, PR #163):

1. **Existing trails/roads as discounted edges** (`infrastructureService.ts`): one Overpass query per corridor bbox (`highway ~ track|path|service|unclassified|road|tertiary|secondary|residential`, `out geom`, 12 s server / 15 s client timeout, bbox-cached). Lattice nodes within **30 m** of a mapped way count as on-trail; edges with both ends on-trail get **×0.35 on the fuel factor** (the ground is already broken; slope still applies). `RouteComparisonStats.existingTrailDistance` reports metres reused; the AdvisorPanel shows an "Existing trail used" before/after row.
2. **Honesty:** Overpass failure returns `available:false` (never cached) → the result carries `infrastructureAvailable:false` and the UI says trail data was unavailable rather than implying no trails exist. Reused trails are labelled "OSM-mapped — verify trafficability".
3. **Anchor insights** (`planInsights.ts`): when either end of a >400 m line terminates in medium scrub or heavy forest, a chainage-located warning explains the outflanking risk and suggests tying into a road, waterway or cleared ground.

**Still designed (📋):** water fill points and cadastre boundaries as advisory overlays (NSW DCS Spatial Services — **licensing/attribution check required before shipping**), and waterway/cleared-land anchor *detection* (current anchor rule is fuel-based only; OSM waterways would let the assistant name the feature to tie into).

---

## Update policy
Update this doc when the optimizer cost model, sampling strategy, insight rules, or data sources change.
