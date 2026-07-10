# Fire Break Calculator — Deep Review of Core Calculation, Architecture & UX

*Scope: how the app estimates the way equipment builds fire breaks, whether the method and data sources are sound, and how the architecture/technology/UX support (or undermine) that. UI/branding/layout deliberately excluded per request.*

---

## Implementation status (July 2026)

The **P0 calculation-accuracy items below have been implemented** (see PR for this branch):

- **F1 — Per-segment integration:** new `webapp/src/utils/routeProfile.ts` joins the slope and vegetation sampling passes onto a common chainage and sends a `RouteSegment[]` profile to the backend, which now sums production **segment by segment** instead of collapsing the route to one slope bucket + one predominant fuel. (`api/src/services/equipmentAnalysis.ts`)
- **F2 — Real slope gating:** machinery slope limits are enforced again via `resolveMaxSlopeDegrees()`, derived from each item's `allowedTerrain` (and explicit `maxSlope` when present). Over-limit ground is measured as a *fraction* of the line → full / partial (with penalty) / incompatible.
- **F3 / F7 — Grounded, tunable model:** new `api/src/services/productionModel.ts` replaces the two hand-picked factors with resource-specific, documented **speed multipliers** for fuel and slope (machinery vs hand crew vs aircraft), grounded in the structure of the NWCG / Report 56 tables and the project's own `add_machines.js` factors. All constants are named and calibratable.
- **F5 — Aircraft model:** load/coverage model — heavier fuel raises coverage → fewer effective metres per drop; cost prefers `costPerDrop`.
- **A1 — De-duplication:** the accurate model now lives **only** in the backend; the frontend delegates to it (the frontend fallback remains solely as a degraded offline path).
- **A5 — Tests:** `api/src/test/analysis.test.ts` covers the model and per-segment behaviour (11 checks).

**Now also implemented (July 2026, second wave):**

- **A2/F4 — Server-side elevation profile:** `api/src/services/elevationService.ts` + `POST /api/elevation/profile` sample a bare-earth DEM (ArcGIS `getSamples`, configurable `DEM_IMAGESERVER_URL`) in **one request per line**; `slopeCalculation.ts` batches through it and falls back to Terrain-RGB. Removes the per-point tile-decode chattiness when a DEM is configured.
- **F8 — National vegetation:** `webapp/src/utils/nvisVegetationService.ts` adds the Australia-wide **NVIS Major Vegetation Groups** layer as an authoritative fallback (NSW SVTM → NVIS → coarse landcover → mock), so most of the continent gets a real fuel class instead of a fabricated one.
- **A4/U5 — Provenance:** slope/vegetation analyses flag `usedMockElevation` / `usedFallbackData`; the panel shows an "estimated data in use" banner.
- **Break width:** machinery multi-pass + hand-crew effort scaling with a target break-width selector.
- **Infrastructure as code:** `infra/main.bicep` + a single build→test→provision→deploy workflow (`.github/workflows/deploy.yml`) with dynamic SWA token retrieval.

Still open (P2): richer cost model with mobilisation/float (F6), per-segment vegetation override UI (U5 partial), and swapping the DEM default endpoint once the exact GA ImageServer URL is verified in the target tenant.

---

## 1. TL;DR

The app is a well-organised, cheap-to-run geospatial tool with a sensible stack, but the **core estimation model is an invented heuristic, not grounded in the established fireline-production literature**, and it **discards most of the spatial data it goes to the trouble of collecting**. The three highest-impact problems:

1. **It collapses a whole route to one vegetation type and one slope number**, then multiplies a base rate by two arbitrary factors — even though it already samples slope every 10 m and vegetation every 200 m. The fix (segment-wise integration) needs no new data.
2. **Machinery slope limits are dead code** — `isSlopeCompatible()` always returns `true`, and each machine's `maxSlope` is ignored. A small dozer will be recommended for terrain it cannot safely work. This is a safety issue, not just accuracy.
3. **The rate model has no empirical basis.** Published production-rate tables (NWCG; Victorian DELWP Report 56) key rates to *equipment class × fuel type × slope class*. The app should adopt that structure instead of `rate ÷ (terrainFactor × vegetationFactor)`.

Everything else (dual frontend/backend calc, coarse veg taxonomy, mock-data fallbacks, client-side tile decoding) is secondary but compounds the credibility problem.

---

## 2. How the calculation works today

### 2.1 Data collection (good bones)
- **Slope** (`webapp/src/utils/slopeCalculation.ts`): interpolates the drawn line to 100 m nodes, then sub-samples every 10 m, reads elevation from **Mapbox Terrain-RGB** tiles (zoom 15) decoded pixel-by-pixel in a canvas, computes per-sub-segment slope, and produces a `TrackAnalysis` with `maxSlope`, `averageSlope`, and a `slopeDistribution` (metres per category: flat/medium/steep/very_steep).
- **Vegetation** (`nswVegetationService.ts`, `vegetationAnalysis.ts`): samples every 200 m, queries the **NSW SVTM PCT ArcGIS layer** at each point, maps the returned formation/class to a 4-class taxonomy, and produces a `VegetationAnalysis` with a `vegetationDistribution` and a `predominantVegetation`.

So the app **already computes per-category distributions along the line.** That is exactly the data a good model needs.

### 2.2 The estimate (where it goes wrong)
In `api/src/services/equipmentAnalysis.ts` (and duplicated in `AnalysisPanel.tsx`):

```
effectiveTerrain    = deriveTerrainFromSlope(maxSlope)        // ONE bucket for the whole line
effectiveVegetation = predominantVegetation                   // ONE class for the whole line
terrainFactor       = {flat:1.0, medium:1.3, steep:1.7, very_steep:2.2}[effectiveTerrain]
vegetationFactor    = {grassland:1.0, lightshrub:1.1, mediumscrub:1.5, heavyforest:2.0}[effectiveVegetation]
adjustedRate        = clearingRate / (terrainFactor × vegetationFactor)
time                = distance / adjustedRate
cost                = time × costPerHour
```

The `slopeDistribution` and `vegetationDistribution` are collected, displayed, and then **thrown away** for the actual time/cost math.

---

## 3. Core-model findings

### F1 — Whole-route reduction discards the spatial data (highest impact, cheap to fix)
A 5 km line that is 95 % flat grassland but clips one 46° gully is scored **very_steep for its entire length** (2.2× time everywhere) and a machine may be marked incompatible outright. A line that is 60 % forest / 40 % grass is billed as 100 % forest. This is both inaccurate and erodes trust the first time a user notices it.

**Fix:** integrate per segment. For each segment *i* with length *Lᵢ*, slope class *sᵢ*, fuel class *fᵢ*: `timeᵢ = Lᵢ / rate(equipment, fᵢ, sᵢ)`, then `total = Σ timeᵢ`. The `slopeDistribution` × `vegetationDistribution` data already exists; you need a per-segment fuel+slope pair (join the two sampling passes onto a common chainage) rather than two separate marginal distributions.

### F2 — Machinery slope limits are non-functional (safety)
`isSlopeCompatible()` unconditionally returns `{ compatible: true }` (a comment even says "REMOVED"). Seed data carries `maxSlope: 20/25/30` for D4/D6/D9; it is never read. Compatibility is gated only by the coarse 4-bucket `allowedTerrain` hierarchy. Real dozer guidance (NWCG): don't work **sidehill > ~45 %**, **uphill > ~55 %**, with downhill and operator/ground condition caveats — i.e. roughly 25–30° depending on aspect. A tool that recommends a D4 for a 40° pitch is unsafe.

**Fix:** reinstate a real slope gate driven by `maxSlope` (or better, per-equipment sidehill/uphill limits), evaluated against the **fraction of the line** above the limit, not a single number — tie it to F1's segment model. Keep "partial with penalty" for small over-limit fractions, but make the thresholds explicit/configurable.

### F3 — The multiplicative factor model is unsourced
`terrainFactor × vegetationFactor` with values `{1.0,1.3,1.7,2.2}` and `{1.0,1.1,1.5,2.0}` is a plausible-looking guess. The domain has published, field-derived rates:
- **NWCG Fireline Production Rate Tables (2021)** — sustained line-production rates for crews, dozers and tractor-plows across the 13 Anderson fuel models, in chains/hr, with size classes.
- **Victorian DELWP "Prediction of firefighting resources for suppression operations" (Report 56)** — explicit D4 / D6 / large-dozer and hand-crew line-construction rate models for Australian eucalypt fuels, which is the directly relevant jurisdiction.

**Fix:** replace the base-rate-÷-factors approach with a **lookup/interpolation over a rate table** keyed to `(equipment class, fuel type, slope class)`, seeded from Report 56 (AU) and/or NWCG, and store the table as data (Azure Table) so it can be tuned without code changes. Keep the current factors only as a labelled fallback for equipment not in the table.

### F4 — Slope statistic is noisy and mis-specified
`maxSlope` is the maximum *segment-average* slope, but the category shown is derived from `maxSubSlope` (max 10 m sub-slope) — two different statistics driving different outputs. Worse, Terrain-RGB at zoom 15 is ~4–8 m/pixel; sampling every 10 m from ~5 m pixels makes slope dominated by DEM quantisation noise, so a single spiky pixel can flip the whole-line classification. Absolute *max* is the worst possible choice of aggregate for a noisy signal.

**Fix:** (a) use a high percentile (e.g. P90) plus the over-limit *fraction* rather than absolute max; (b) compute slope over a horizontal run matched to DEM resolution (smoothing); (c) prefer **Geoscience Australia's 5 m LiDAR DEM / 1-second DEM via ELVIS** (CC-BY, LiDAR-derived) over Terrain-RGB for AU work, or at least sample Terrain-RGB at a fixed zoom with interpolation and light smoothing.

### F5 — Aircraft model is conceptually thin
`drops = ceil(distance / dropLength)`, `time = drops × turnaround`, `cost = time × costPerHour`. It ignores: sorties/reload cycles at base, **coverage level vs fuel** (heavier fuel needs higher coverage → less effective line per load), drop overlap, and it leaves `capacityLitres` / `costPerDrop` defined-but-unused. Cost captures only turnaround-hours, badly undercounting aircraft (which are dominated by standby/positioning cost). Aircraft also don't "build line" like a dozer — they lay retardant/water to slow spread or hold a control line (see Plucinski's aerial-suppression effectiveness work). At minimum, model load cycles and per-drop/retardant cost, and label aircraft output as "containment support," not equivalent "line built."

### F6 — Cost model is incomplete for cross-type comparison
`cost = time × costPerHour` omits mobilisation/float/transport for machinery, crew travel/standby, and retardant consumables for aircraft. Because the tool's *purpose* is to compare resource types head-to-head, these omissions systematically bias the comparison (aircraft look cheap, floats for dozers are free). Add fixed + variable cost components per resource.

### F7 — Magic numbers throughout
`PARTIAL_THRESHOLD = 0.15`, penalty `1 + overLimitPercent × 2`, `maxAcceptableTime = fastest × 2`, `slopeTimeFactor = 0.02` (defined but unused), the terrain/veg factors — all undocumented, none configurable, some dead. Move to a documented config block with provenance comments.

### F8 — Vegetation taxonomy is coarse, NSW-only, and fabricated outside NSW
- The 4-class taxonomy collapses fire-relevant distinctions; the NSW regex mapping even maps "woodland"/"grassy woodland" → `heavyforest` with a comment admitting it's questionable, and wetlands → `lightshrub`.
- **Outside NSW there is no authoritative source.** It falls back to Mapbox Terrain v2 landcover (coarse global), then to `getMockLandcoverClass()` — a **deterministic pseudo-random class from the coordinates**. That is invented vegetation presented as analysis.

**Fix:** adopt a fuel-type classification with national coverage — **CSIRO National Bushfire Fuel Classification (BFC, ~90 m)** or state fuel-type layers — and map to fuel models rather than a bespoke 4-class scheme. Crucially, **expose confidence and allow per-segment user override**; never silently substitute mock data.

---

## 4. Architecture & technology

**Sound choices:** React + Vite + Mapbox GL front end; Azure Functions + Table Storage back end; Azure Static Web Apps hosting. Lightweight, cheap, appropriate to the scale. Optimistic-concurrency CRUD on equipment is a nice touch.

**Issues:**

- **A1 — Split-brain calculation.** The *same* logic lives in `equipmentAnalysis.ts` (backend, "source of truth") **and** `AnalysisPanel.tsx` (frontend fallback). They have **already diverged** — the frontend still calls `isSlopeCompatible(machine, maxSlope)` against `machine.maxSlope`; the backend stubbed it out. Two implementations of safety-relevant math guarantees drift. Pick one (backend), delete the other, and have the frontend render only.
- **A2 — Elevation sampling is client-side and chatty.** Fetching Terrain-RGB PNG tiles and decoding pixels in a canvas works, but it's many requests, relies on anonymous cross-origin image decode, isn't batched, and processes segments sequentially. For a long line this is slow and hammers Mapbox. Move elevation to a **server-side profile call** (one request per line) against a proper DEM/elevation service, and cache.
- **A3 — Vegetation queries are sequential point hits.** One ArcGIS query per 200 m sample inside an `await` loop. ArcGIS supports multipoint / polyline-intersect queries; batch them or move server-side. Same for the overlay grid, which is O(rows × cols) point queries.
- **A4 — Silent mock fallbacks.** `getMockElevation`, `getMockLandcoverClass`, and the pseudo-random veg fallback all produce plausible-looking fake output with no signal to the user. For a planning tool this is the most dangerous single behaviour — a token misconfiguration silently yields fiction. Fail loudly or badge results as "estimated / demo data."
- **A5 — Tests.** Essentially none on the calculation core (one e2e stub). This is the code most in need of unit tests (rate tables, segment integration, slope gating, edge cases like zero-length/duplicate points).
- **A6 — Stale docs.** README still says "Current: Mock elevation service" though Terrain-RGB is wired; `master_plan.md` says React 18 in the stack section but the app is on React 19; several roadmap items ("real elevation") are already partially done. Docs drift undermines the "single source of truth" claim.
- **A7 — Mapbox token** ships in the frontend (normal) but should be URL-restricted in the Mapbox dashboard to prevent quota theft.

---

## 5. UX (non-visual)

- **U1 — No uncertainty surfaced.** A headline "4.2 hrs / $920" hides that it rests on coarse veg + noisy slope + guessed rates. Show ranges/confidence, not false precision.
- **U2 — The number is unexplained.** Per-segment slope and veg are computed but the breakdown that *justifies* the estimate isn't surfaced. Let users expand "why."
- **U3 — "Predominant vegetation" misleads** users into thinking the line is homogeneous; pair it with the distribution and a mixed-fuel indicator.
- **U4 — One pixel flips everything.** Because of F1+F4, a single noisy DEM spike can move every recommendation to "incompatible," which reads as a bug and erodes trust.
- **U5 — Overrides.** The README implies the user "selects terrain/vegetation," but the code derives them automatically. When auto-detection is wrong (and outside NSW it's fabricated), the user needs an explicit per-segment or whole-line override. Make the auto-derived values editable.

---

## 6. Recommended roadmap (prioritised)

**P0 — Correctness & safety (do first, mostly cheap)**
1. Segment-wise time integration over the existing slope/veg samples (F1). Biggest accuracy win, no new data.
2. Reinstate real machinery slope limits from `maxSlope`/sidehill limits, gated on over-limit fraction (F2).
3. Collapse the dual frontend/backend calculation to one backend implementation (A1).
4. Stop silent mock fallbacks; badge or fail (A4).

**P1 — Grounding & data quality**
5. Replace factor multipliers with a rate table keyed to (equipment × fuel × slope), seeded from Report 56 / NWCG, stored as tunable data (F3, F7).
6. Move elevation to a server-side DEM profile (ELVIS 5 m / 1-s for AU); use P90 + smoothing (F4, A2).
7. Adopt a fuel-type classification with national coverage + per-segment user override + confidence (F8, U1, U3, U5).

**P2 — Depth**
8. Rework the aircraft model (load cycles, coverage-vs-fuel, per-drop cost) and cost model (fixed + variable, float/mobilisation) (F5, F6).
9. Unit tests over the calculation core; refresh docs (A5, A6).

---

## 7. Key references
- NWCG Fire Line Production Rate Tables (2021): https://www.frames.gov/documents/behaveplus/publications/NWCG_2021_FireLineProductionRates.pdf
- NWCG Dozer/Plow Operations (slope limits): https://www.nwcg.gov/6mfs/vehicles-roads/dozerplow-operations
- Victorian DELWP Report 56 — Prediction of firefighting resources for suppression operations: https://www.ffm.vic.gov.au/__data/assets/pdf_file/0016/21067/Report-56-Prediction-of-firefighting-resources-for-suppression-operations-in-Victorias-Parks-and-Forests.pdf
- Geoscience Australia ELVIS elevation platform (5 m / 1-s DEM, CC-BY): https://elevation.fsdf.org.au/
- CSIRO National Bushfire Intelligence Capability — vegetation & fuel data: https://research.csiro.au/nbic/home/data/veg-fuel/
- Plucinski & Pastor — Criteria and methodology for evaluating aerial wildfire suppression: https://nrfirescience.org/resource/12414
