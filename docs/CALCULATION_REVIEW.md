# Fire Break Calculator — Deep Review of Core Calculation, Architecture & UX

*Scope: how the app estimates the way equipment builds fire breaks, whether the method and data sources are sound, and how the architecture/technology/UX support (or undermine) that. UI/branding/layout deliberately excluded per request.*

---

## Col persona review (2026-08-18)

Owner-run role-play exercise: a sceptical "crusty old heavy plant operator"
persona ("Col", forty years on plant) critiqued the app's applicability,
accuracy and relevance; a second persona listened and proposed concrete
adjustments. Six recommendations came out of it. Status:

| # | Recommendation | Status |
|---|---|---|
| 1 | Surface the ground-varies-by-segment caveat next to the headline number, not two clicks deep | ✅ Done — `AnalysisPanel.tsx` hero readout |
| 2 | A "field-verified" vs "planning-grade" distinction, separate from sourcing | 📋 Deferred — see `master_plan.md` Next up |
| 3 | Let a crew log a real job's actual outcome against the estimate | 📋 Deferred — see `master_plan.md` Next up (job-actuals log) |
| 4 | Mobilisation/float cost as a real line item, not folded into `costPerHour` | 📋 Honestly caveated (hero readout, `mobilisationCostIncluded: false` in the reality-check payload), not yet modelled — see `master_plan.md` Next up |
| 5 | A ground-condition (dry/normal/wet) modifier | 📋 Deferred, the sharpest unsolved point — see `master_plan.md` Next up |
| 6 | Region-aware vegetation language, not four fixed buckets | ✅ Done — see "Vegetation granularity" below |

**Follow-up ask (same session): bake the Col perspective into the app
itself**, so a field veteran's reality check doesn't need to be personally
present for every desk-planning decision — the app should surface that
scrutiny automatically, with the actual field check still happening where it
belongs (on the ground, once the rough estimate is done). Built as a new AI
persona/endpoint under the SAME grounding contract as the existing narration
assistant — see `docs/AI_ASSISTANT.md` §4b for the full design, and
`master_plan.md` step 59 for the shipped detail.

### Vegetation granularity (recommendation 6)

The underlying datasets already carry much finer classes than the 4-bucket
costing type (`grassland`/`lightshrub`/`mediumscrub`/`heavyforest`) the
production model uses — NVIS's Major Vegetation Group name (~32 classes) or
NSW SVTM's PCT/formation name (hundreds, region-specific) — and this was
already being fetched into `VegetationSegment.displayLabel`
(`vegetationAnalysis.ts`). It was silently discarded by two merge steps that
only ever compared the coarse costing bucket: the segment-merge inside
`vegetationAnalysis.ts` itself, and `segmentJoin.ts`'s own slope×vegetation
join (shared by the segment breakdown table AND every GIS export). Two
adjacent stretches sharing a coarse bucket (e.g. both `mediumscrub`) but
genuinely different vegetation communities on the ground were blended into
one row, keeping only the first sub-segment's granular name. Fixed by
requiring the granular label to also match before merging in both places —
**no new data source, no change to the coarse costing bucket the production
model reads**, purely stopping information that was already being fetched
from being thrown away. `SegmentBreakdown.tsx` now shows the granular class
as visible text under each row (previously title-attribute-only, so it only
ever reached a mouse hover); `gisExport.ts`'s existing `vegetation_label`
export field gets the same fix for free, since it reads the same joined
segments.

**What this does NOT change:** NVIS nationally still only exposes Major
Vegetation Group (~32 classes) via the layer this app queries — Major
Vegetation Subgroup (~100+) is a separate, not-yet-integrated ArcGIS layer
(`docs/NVIS_INTEGRATION.md`). NSW SVTM's PCT-level names were already the
finest tier available and needed no new fetch — only the merge fix.

---

## Standard catalogue accuracy review (2026-08-18)

Owner request: review, test and document the accuracy of the 15 pre-loaded
standard machinery/aircraft/hand-crew items (`api/src/data/standardEquipment.ts`,
mirrored in `webapp/src/config/standardEquipment.ts`), and make that sourcing
visible and adjustable in the app — see the "Machinery defaults: visibility,
customisation, accuracy" entry in `master_plan.md`.

**What this pass did:** every one of the 15 items now carries a `sourceNote`
field (`EquipmentBase.sourceNote`) — a one-line citation/rationale for its
figures, surfaced in the equipment panel's "Std" badge tooltip so a user can
judge a default's credibility before relying on it or overriding it (see
`EquipmentConfigPanel.tsx`). Every item was checked for:
- **Internal consistency** — rates increase monotonically with dozer/aircraft
  class (GRADER < DOZER-LIGHT... < DOZER-HEAVY; HELI-LIGHT < HELI-MED <
  HELI-HEAVY by both capacity and cost), `maxSlope` widens with machine class,
  and `allowedTerrain`/`allowedVegetation` gating is coherent with each
  item's stated capability (e.g. GRADER excluded from `heavyforest`,
  DOZER-HEAVY admitted to `very_steep`).
- **Structural grounding** — cross-checked against the three sources already
  cited in the file header: NWCG Fireline Handbook / 2021 Fire Line
  Production Rate Tables (dozer + 20-person-crew rates by fuel model), DELWP
  Report 56 "Prediction of firefighting resources for suppression
  operations" (McCarthy, Tolhurst & Wouters — real Victorian fireground data:
  D6/D7/D9 bulldozers modelled together, 33 cases; 6-person hand crews
  average 90–120 m/crew/hour across mixed conditions), and NAFC standard
  aircraft categories/tank capacities.

**What this pass could NOT do:** re-derive every figure line-by-line from
the primary tables. Both PDFs (NWCG production tables, DELWP Report 56)
returned 403/binary-only responses to the tools available in this review
environment, so verification stopped at corroborating order-of-magnitude and
structural claims via secondary sources, not reading the exact table cells.
This is stated per-item in each `sourceNote`, not glossed over — the same
honesty convention the OCOKA programme uses for its own unverified MCOO
vocabulary (`CLAUDE.md`).

**Findings, by confidence tier:**
- **Best-grounded:** the four dozer classes (GRADER, DOZER-LIGHT/MED/HEAVY)
  and all five aircraft — structural match to NAFC categories/tank sizes is
  strong (e.g. SEAT's 3,000 L matches the AT-802 Fire Boss's published tank;
  LAT's 15,000 L sits inside the published RJ85/B737-class LAT range).
- **Plausible but not independently verified:** CREW-STD's 30 m/person/hour —
  higher than Report 56's 90–120 m/crew/hour mixed-conditions average
  (~15–20 m/person/hour for a 6-person crew), which is expected since this
  catalogue's reference rate is FLAT GRASSLAND easiest-case (the production
  model derates every other condition from it — see file header), but the
  grassland-only subset of Report 56 wasn't isolated to confirm the gap is
  exactly right. CREW-CHAINSAW and CREW-STRIKE are the same tier.
- **No literature table found — the project's own calibrated estimate:**
  EXCAVATOR, POSITRACK (machinery) and CREW-RAFT (hand crew). Each
  `sourceNote` says so explicitly rather than implying a citation that
  doesn't exist.

**Customisation & persistence architecture (same pass):** previously,
`equipmentUpdate`/`equipmentDelete` were fully anonymous and mutated the
*shared* Table Storage row directly — any visitor editing a standard item
changed what every other user (and every anonymous visitor) saw, with no
session/account distinction at all. Fixed by splitting the two concerns:
- The platform default rows (`standard: true`) are now **read-only** via the
  direct CRUD endpoints — `equipmentUpdate`/`equipmentDelete` reject a
  standard item with `409 { standard: true }`, pointing the caller at the
  override API instead. Custom (non-standard) equipment is unaffected.
- A new per-user **override** layer (`api/src/models/equipmentOverride.ts`,
  `equipmentOverridesStore.ts`, `equipmentOverrideList/Set/Delete.ts`) stores
  only the whitelisted fields a user actually changed (cost/rate/limits/etc.,
  never identity fields), keyed by `(userId, equipmentId)`. Deleting an
  override exactly reverts to the platform default, since the base row was
  never touched.
- **Not signed in:** the same customisation lives in `sessionStorage` only
  (`webapp/src/utils/equipmentOverrides.ts`) — never reaches the backend,
  gone when the tab closes. **Signed in** (Station Manager, `fireBreakEnabled`
  — the same entitlement saved plans already use): persisted per-account via
  `equipmentOverridesApi.ts`, restored on every visit/device, with a
  one-time migration of any pre-sign-in session overrides on first sign-in.
  This mirrors `savedPlansApi.ts`'s own session-vs-account precedent and is
  the intended incentive to sign up for Station Manager.
- UI: `EquipmentConfigPanel.tsx` shows a "Modified" badge + "Reset" (revert
  to default) action on any customised standard item, disables direct delete
  for standard items (409 otherwise), and a small banner states whether the
  current edit session-only or account-persisted.

**Follow-up recommended (not done in this pass):** a domain SME (RFS/DELWP
plant/crew supervisor) spot-check the "plausible but not independently
verified" and "no literature table" tiers against real local experience —
exactly the calibration path the file header already recommends. This is a
credibility/trust item, not a defect; nothing here contradicts the
segment-wise production *model* (F1–F3 above), which was already reviewed
and is unaffected.

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

**2026-07-27 — two more gaps closed, both ported over from lessons learned building Terrain Mobility's own trafficability model:**

- **Water as a natural fire break, not fabricated grassland.** NVIS/Mapbox landcover both mislabelled open water as low-confidence `grassland`, so a line crossing a river or lake got costed as ordinary buildable ground — the same root cause Terrain Mobility's hydrology gate (§34) fixed for its own cost model, not yet fixed here. `vegetationAnalysis.ts` now fetches the real OSM waterway/water-body geometry once per line (`infrastructureService.ts`) and flags crossing segments (`VegetationSegment.isWater` → `RouteSegment.crossesWater`). Damp ground doesn't carry fire, so these segments are excluded from every resource's time/cost (nothing to build) rather than priced as fuel to clear — `AnalysisResponse.metadata.analysisParameters.waterCrossingLength` reports the total so it's never silently folded into any other number. `AnalysisPanel.tsx` shows a positive-toned note (not a warning) when it applies.
- **F2 finished — sidehill is now a real, distinct gate.** The along-line slope gate reused NWCG's ~45% *sidehill* figure to justify its own ~25° default, conflating two different constraints (sidehill vs straight uphill/downhill have different NWCG limits, ~45%/~24° vs ~55%/~29°). `slopeCalculation.ts` now samples the DEM either side of the line (perpendicular to its bearing, batched into the same one-request elevation profile call) to compute real per-segment cross-slope; `productionModel.ts` gained `resolveMaxSideSlopeDegrees`/`DEFAULT_MAX_SIDE_SLOPE_DEGREES`, gated independently in `equipmentAnalysis.ts` alongside (not instead of) the existing along-line check, each exposed separately (`slopeCompatible` vs `sideSlopeCompatible`) so a UI or export can tell which constraint actually bound.

**2026-07-27 — fire history (NAFI) added as informational context, DELIBERATELY not wired into the cost model:** the already-live-verified `nafiFireHistoryService.ts` (built for Terrain Mobility §31) is now also queried per vegetation segment (`vegetationAnalysis.ts`; short-circuits with zero network calls outside NAFI's northern-Australia/rangelands technical extent, so it's a no-op for most NSW/VIC/southern-SA lines). `VegetationSegment` carries `yearsSinceFire`/`fireHistoryConfidence`; `AnalysisPanel.tsx` shows the most-recently-burnt figure found along the line as a note. **What this is NOT**: a fuel-age adjustment to time/cost. Unlike the fuel-CLASS factors (grounded in NWCG/Report 56), there is no sourced fuel-accumulation-vs-clearing-rate curve to apply here — inventing one would repeat exactly the "plausible-looking guess" problem F3 replaced. This stays a fact surfaced for the user's own judgement until a genuine sourced relationship is found. DEA fractional-cover (`deaFractionalCoverService.ts`) has the identical live-verified-but-uncalibrated status and was not wired in this pass for the same reason.

**2026-07-28 — existing-trail reuse was computed and then silently discarded before costing; now surfaced (informational, like fire history above).** Found while checking a stale "Road class modelling" roadmap item against the live code: `routeOptimizer.ts` already samples which parts of a candidate route follow a mapped trail/track/road (`TRAIL_SNAP_M = 30m`) and applies a `×0.35` fuel discount to PREFER trail-following routes during pathfinding — but that fact was never carried into `RouteSegment[]`, the exact shape `BackendAnalysisRequest.segments` POSTs to `/api/analysis/calculate`. A route that reuses a real formed track — including the auto-OPTIMIZED route the app itself suggests specifically because it favours trails — was costed **identically to virgin bush of the same vegetation class**, with nothing anywhere in the final estimate to say otherwise; the optimizer's own before/after "existing trail used" stat (`AdvisorPanel.tsx`) is a distance figure with no connection to the $ / hours shown next to it. This is a confidently-wrong-answer defect, not a missing nice-to-have.

The `×0.35` pathfinding discount is itself an uncited constant, so extending it into the authoritative cost model would repeat exactly the "invented factor" problem F3 replaced — there is no sourced existing-track-vs-virgin clearing-rate figure (an existing track's usable width for a break is unknown, unlike water's structural "already broken" certainty). Fixed the same way NAFI fire history was: `vegetationAnalysis.ts` now ALSO fetches the reusable-trail set (`fetchCorridorInfrastructure`, the same default `highway` kind `routeOptimizer.ts` already queries) once per line, alongside the existing waterway fetch, and flags each segment (`VegetationSegment.onExistingTrail` → `RouteSegment.onExistingTrail`) — a real merge boundary (never blended across, mirrors `isWater`), but **not** wired into any time/cost number. `AnalysisPanel.tsx` shows a note stating the total reused length AND that the estimate does not already discount for it, so a user never mistakes the headline figure for one that already accounts for the track.

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
