# Fire Break Calculator — Master Plan

**Last Updated**: August 2, 2026 — the owner-directed **OAKOC programme** (stages 1–9) is added at the top of "Next up"; the two mobility-offload rows it supersedes are struck through in place. See Recent Updates for the dated history.
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
4. Field-ready: touch-first, low data, and offline-capable — **with one stated exception**. From the OAKOC programme onward, Terrain Mobility mode runs its analysis on the backend and therefore **requires connectivity to produce a new result**; previously completed analyses stay readable offline. Fire-break mode is unchanged and remains fully offline-capable. This was an explicit owner decision (2026-08-02), traded for parallel compute and the warm-run latency contract — recorded here rather than left as a claim the code no longer honours.

## Current state

- **Estimates:** per-segment production model in the API is the sole engine ([docs/CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md)).
- **Vegetation:** NVIS national spine + NSW SVTM overlay; state expansion frozen ([docs/NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md)).
- **Route intelligence:** corridor pathfinding, chainage-addressed segment detail, elevation profile, rule-based Plan Assistant, tabbed analysis UI — shipped in PR [#163](https://github.com/richardthorek/fireBreakCalculator/pull/163) ([docs/ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md)). Infrastructure trail lookup (OSM/Overpass) is now multi-endpoint resilient after a live-tested rate-limiting bug was found and fixed 2026-07-12.
- **Live context:** national hotspots + fire/burn-area boundaries, plus incident/warning overlays for 5 of 8 states, are live on the map ([docs/GIS_INTEROP.md](docs/GIS_INTEROP.md) §4). AFDRS official fire-danger rating is **blocked on access** (BOM Registered User program), not effort — see the assessment in that doc.
- **Terrain Mobility:** M1–M4 shipped (mobility core, corridors/chokepoints, trafficability uplift, counter-mobility planner). Being restructured around **OAKOC/IPOE** with its compute moved to a parallel Azure backend — see the OAKOC programme at the top of "Next up". The mode had already implemented two of the five doctrinal factors (Obstacles, Avenues of approach) without naming them.

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
| 18 | Slice A — road network graph + routing (core) | Real road graph (nodes/edges from OSM ways, A\* on a road edge set) — box-free by construction, fixes the Lake George "no route" defect for vehicle movement, closes the road-class gap. Speeds from the OSRM car/foot profiles, composed as a ceiling via `min()` with each mover profile's own `roadSpeedKmh`. Wired into BOTH the new road graph and the existing hex-grid onTrail bonus. Proven with a synthetic Lake-George-scale test (route found, genuine detour, control with the connector removed correctly fails) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 19 | Painting is real hex cells, not circles | Brush dabs are now actual hex-cell clusters (100m circumradius, `hexRing`/`hexSpiral` — the same hex math the analysis grid uses) instead of zoom-relative circles; small/medium/large/xl = 1/10/100/1000 hexes. Per-area local anchor avoids whole-country distortion a single global tiling would cause | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §36 |
| 20 | Paint↔analysis grid reconciliation | `mobilityGrid.ts`'s `originKeys`/`objectiveKeys` now test real geodesic area overlap (`@turf/intersect`/`@turf/area`) between each analysis hex and the resolved painted polygon, not just the cell centre — a coarse analysis hex only seeds as origin/objective when a real (≥15%) share of it is actually painted, faithful regardless of the fixed 100m paint-hex size vs. the analysis grid's own `chooseHexSize` result | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §36 |
| 21 | Slice A — road-speed config UI + user-override plumbing | `RoadSpeedOverridePanel.tsx` (editable table, per-row/global reset, `localStorage`), threaded as a set-once global (`setRoadSpeedOverrides`) rather than a parameter chased through 9 files, set on BOTH sides of the `mobilityWorker.ts` Worker boundary since a Worker shares no memory with the main thread | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 22 | Slice A.9 — road-network routing wired into the LIVE app (found + fixed) | Discovered mid-step-21: `roadGraph.ts`/`roadRouting.ts` were correct in isolation (Lake George synthetic test) but never called by the running app — only the hex-grid search ever ran, so Lake George was still genuinely unfixed for vehicles in the product. `roadRouteSearch.ts` (new) wires a box-free road route into `mobilityAppreciation.ts` for vehicle profiles, additive alongside the hex-grid search, drawn on the map as its own amber line. Re-proven end to end with `PaintedArea` inputs (what the app actually has), not raw graph node IDs | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 23 | Slice B (scoped) — expand-and-retry, v1 (SUPERSEDED by step 24 — see below, the base quantity it scaled was still broken) | First attempt at the off-road fix: `boundsPadFactor` retry at escalating factors. Proven against a SYNTHETIC grid built directly from local coordinates, which is exactly why it missed that the real padding formula was still broken — see step 24 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 24 | Slice B (scoped) — square distance-based box + targeted frontier-edge growth (the actual fix) | Live-tested by the owner against the real Lake George, step 23 still failed. `computePaddedBounds` now targets a SQUARE box sized off the real origin↔objective distance (haversine), proven to clear the real 28km lake on attempt 1; `frontierTouchedEdges`/`growBoundsTowardFrontier` extend specifically the box edge the reachable frontier actually hit on any further retry, not a fresh uniform box. Also fixed the `nearestCellKey` seed-set fallback (was an arbitrary array index) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 25 | Distance-scaled cell budget + quick/standard/fine analysis-depth selector | `TARGET_CELL_COUNT`/`MAX_HEX_CELLS` were fixed constants regardless of AOI size — a continental run got the same budget as a 2km local one, just coarsened into huge hexes, with no user control. `computeCellBudget(spanM, fidelity)` scales the target sub-linearly (sqrt) with the real origin↔objective distance, per a `quick`/`standard`/`fine` tier each with its own base, growth rate and hard ceiling ('fine' allows up to 50,000 cells at continental range — a deliberate, bounded "few minutes is fine" choice, not an accident). New `ANALYSIS DEPTH` selector in the Terrain panel; re-running at a different tier IS the "more/fewer cells" control | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 26 | Movement corridors collapsing into one — route-clustering fix + corridor colour collision fix | Live-tested: a two-shore Lake George crossing with visibly distinct east/west detour tracks still reported only 1 corridor — every route sharing a compact origin/objective always shares cells at both ends, so old adjacency-based segmentation always found them "connected". Fixed by clustering routes BEFORE spatial segmentation (Jaccard cell-overlap tried first, proven inadequate on open terrain; replaced with spatial proximity at 3 sampled progress fractions, unanimous across all three, calibrated to a clean synthetic-fixture margin), then running density/smoothing/segmentation per cluster. Also fixed: corridor rank-1/2 colours were byte-identical to the NO-GO/SLOW-GO trafficability colours — moved corridors to a blue/violet palette | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 27 | Progress-bar dead zones + real results reach the map early | The Dijkstra search reported nothing while it ran (the single largest silent stretch); a retry's sampling progress replayed from zero (visible rewind); the ensemble worker call's internal 'restrictions' progress could already exceed a later hard-coded checkpoint (another visible rewind). Fixed: real incremental search progress (`runAccumulatedCostSearch`'s new `onProgress`), a monotonic guard around the whole run's `onProgress` (a value at/below the high-water mark is dropped, never forwarded — the general fix, not per-bug patches), and a new `onPartialResult` callback that surfaces the real reachability field + cheapest route as soon as the search settles, well before the ensemble/corridors/chokepoints/min-cut that follow | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §37 |
| 28 | Road graph had zero water awareness — vehicle route crossed Lake George | Live-tested: a vehicle route ran straight across the real lake. Ruled out the OSM-relation hypothesis by direct testing (Lake George is a real, well-formed `way`, not a `relation`) and confirmed the hex-grid's own fording gate already works correctly against the real polygon. Root cause: `roadGraph.ts`/`roadRouting.ts` (the box-free vehicle road route, §35 Slice A) had NO water logic at all. Fixed: `buildRoadGraph` flags a CONTIGUOUS run of a way's edges through a mapped water body's interior longer than a plausible bridge span (250 m) as `crossesStandingWater`; `edgeTravelTime` blocks it for any profile whose fording capability is under the same assumed-depth (2.5 m) the hex grid already uses. A short bridge-like dip stays passable | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §37 |
| 29 | Corridor route rendering was analysis noise, not presentation — consolidated to 1 refined route per corridor | Owner: *"the individual white lines of the considered paths don't work as a visualisation... they end up being 'triangles' between the grid centres and they don't follow the road geometry... consolidate to show substantive differences... reduce the analysis noise and show insights rather than raw thinking."* Was drawing up to 24 raw, un-refined hex-centre route polylines regardless of corridor count. Fixed: `Corridor.representativeRoute` (new, `corridorField.ts`) — the single fastest analysed route actually using that corridor; `App.tsx` draws exactly one per corridor (2-5, matching the target), refined through the fire-break optimizer's own `pathRefinement.ts` (snap onto a nearby real road, unchanged). Owner follow-up — *"some corridors may be overland"* — meant snapping alone wasn't enough: added `smoothFreeVertices`/`cornerSmoothingIterations` (opt-in, fire-break optimizer's default behaviour unchanged) so a stretch with no nearby road is corner-smoothed instead of staying a raw zig-zag | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §28 |
| 30 | Smooth the corridor band's own outline | Direct roadmap follow-on to step 29: `mobility-corridor-edge` is a real `@turf/union` of the corridor's hex cells — genuine, not approximated — but still traced the hex tessellation's own blocky edge. `polygonSmoothing.ts` (new) applies Chaikin corner-cutting to every ring of the dissolved geometry (`Polygon` or `MultiPolygon` — union can produce either), a deliberately different algorithm from the route lines' moving-average (a closed ring has no endpoints/locked vertices to preserve; Chaikin treats every vertex cyclically). Caught a real test-methodology trap before shipping: summed turning angle is near-invariant under Chaikin for a closed ring (unlike an open path) — the maximum single-corner turn is the measure that actually captures "no more staircase corners" | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §28 |
| 31 | OSM water relations — picked ahead of queue order for 1.0 demo risk | Owner: "one more push then we're done for a 1.0 demo... pick the item most critical." Assessed demo risk rather than following size-first order: confirmed LIVE that Lake Tuggeranong and Gungahlin Pond — both in the same Canberra region this project's own test scenarios already live in — are OSM `relation`, not `way`, so either would have repeated the exact "water doesn't block movement" bug class just fixed twice already, live, in front of the demoed geography. Fixed in both `webapp` and `api` (kept in lock-step, matching their existing "MUST match" query-constant discipline): the water query now also requests `relation["natural"="water"]`; `out geom` inlines each member's geometry directly (confirmed live, no recursion needed); each `outer`-role member becomes its own water-body trail. Stated scope cut: multi-part outer rings aren't re-stitched and `inner`/island members aren't subtracted as holes — both safe directions to be wrong in for a hard-block gate (worst case: an island cell over-blocks, never under-blocks) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §34/§35 |
| 32 | Cloud-offload scoping + mobility run telemetry | Owner asked to scope cloud infrastructure for large-area Terrain Mobility runs (Static Web Apps + Functions vs. Container Apps vs. an on-demand Container Apps Job for big jobs only) and to start collecting real per-run scale/performance data now, since device variance (owner's own two machines) makes a guessed cell-count threshold unreliable. Design: a three-tier model (client Worker default → same-algorithm Function-hosted tier → on-demand Container Apps Job for genuine outliers), explicitly NOT building tiers 2–3 until telemetry shows real demand. `POST /api/mobility-telemetry` (new, rate-limited, Table Storage-backed) + `webapp/src/terrain/mobilityTelemetry.ts` now record cell counts, GO/SLOW-GO/NO-GO + vegetation-difficulty histograms, distance, per-stage elapsed time, and coarse device hints for every completed run — no location, no identity, fire-and-forget. Also confirmed the road-routing piece from the same conversation was NOT missing (Slice A's `roadRouteSearch.ts` already gives a fast, box-free vehicle route independent of the slow hex-grid search) and flagged the one real gap: it currently waits on the same grid-sampling pass instead of being surfaced first | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| 33 | Small-AOI detour padding, profile-scaled (revised — see step 35) | Owner-reported defect: a short (~1-2km) hill crossing never considered an equally short detour 1-2km north/south, because the search box is sized proportionally to the direct span — short trips got proportionately short padding regardless of whether a much better route sat just outside it. `minDetourPadM(profile)` (mobilityGrid.ts) adds a floor derived from the mover profile's own sourced road speed over a time budget, so a vehicle gets proportionately more search room than foot for the identical trip. Originally shipped uncapped (1 hour); revised to a 15-minute cap same day — see step 35 for why | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §39/§41 |
| 34 | Mapbox-tile road fallback widened to Terrain Mobility | Owner, live-testing near Lake George: a real, signed highway along the shoreline was painted NO-GO end to end, and asked whether the road network visible on the map tiles is real queryable data or just an image. Answer: real vector geometry, already loaded zero-network/CORS-free/offline-capable (`mapboxTrails.ts`) — but that fast-path was restricted to the fire-break `'highway'` kind and never applied to Terrain Mobility's `'highway-mobility'` kind. Root cause confirmed by this same session's own console evidence: Overpass unreachable for that area left `onTrail` false everywhere, and the hard slope gates in `mobilityCost.ts` (unlike the vegetation/hydrology gates) carry no mapped-road exemption at all, so a narrow lake-edge shelf read NO-GO from raw DEM alone. Fixed: `extractCorridorTrails` now takes a `kind`, widening to `MOBILITY_CLASSES` (motorway/trunk/primary included) with a Mapbox-class → OSM-highway translation table; honest stated cost is a highway-class-only speed ceiling (Mapbox carries no surface/tracktype/smoothness) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §40 |
| 35 | Page-hang regression fixed: detour floor capped, cell budget fixed, onTrail slope exemption added | Owner reported the page hanging around 50% progress until the browser offered to kill the tab. Traced to step 33's uncapped 1-hour detour floor: for a fast vehicle profile on a short trip it inflated the search box to ~120km wide, which fed the box-free road-graph route search (`findVehicleRoadRoute`, runs synchronously on the main thread, only ever "cheap" for a small bbox) — at 120km wide that's a whole regional road network, freezing the UI. Three fixes: (1) detour floor capped to a 15-minute budget (was 1hr uncapped) — still profile-scaled, but bounded; (2) cell budget (`buildMobilityGrid`) now derives from the ACTUAL padded box, not the raw origin↔objective distance — a second bug the detour floor exposed, where a fixed budget stretched over a much bigger box ballooned hex size everywhere; (3) the hard climb/cross-slope gates now exempt onTrail cells (both `edgeMobilityCost` and `classifyCellTerrain`) — the actual root cause of "the whole ridge is red instead of the legitimate gap", and on inspection the IDENTICAL root cause as step 34's Lake George case: vegetation/hydrology already exempt a mapped road, the slope gates never did | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §41 |
| 36 | Road-graph route fused into chokepoint/corridor analysis | Owner proposed a hex grid aligned to roads at fine width, cross-country filling in around it — challenged instead: a hex grid, even fine, still quantizes the road (the identical failure step 35 just fixed), while the box-free road-graph search already routes over the road's EXACT geometry with zero quantization. Owner's real instinct ("roads are known good, treat them specially") is already Slice A's own philosophy; the actual gap was that the road route sat only as an ADDITIVE display, never counted by chokepoint/corridor analysis. `roadRouteToDissimilarRoute` (new) converts the road route into the same shape the hex-optimiser's/ensemble's own routes use, resampled to even spacing and snapped onto the hex grid, then folded into both corridor-building calls in `mobilityAppreciation.ts` — so chokepoints and corridor bands now count the real road route as a genuine avenue. Stated, not fused: the ensemble's own per-step movement (still hex-quantized with a road-affinity bias) and min-cut (still hex-adjacency-only) — both real, larger follow-up work | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42 |
| 37 | Corridor legibility pass — route line becomes the star, real label/shape colour bug fixed | Owner challenged Claude to identify corridors from a live screenshot with no prior context; only one hazy shape was findable for two labelled corridors. Root causes in the actual paint properties: the representative route line rendered at 0.8px/near-white/40% opacity (effectively invisible); the corridor outline was blurred; a REAL bug — the map label text colour (`styles-tactical.css`) was still on the pre-fix red/amber rank palette, identical to the trafficability heatmap's own NO-GO/SLOW-GO colours, never updated when the corridor SHAPE colours moved to blue/violet/cyan for exactly that collision. Fixed (3 of 4 offered options, owner declined the 4th as more structural than needed): route line now casing+core (dark 6px under rank-coloured 3px, full opacity, same pattern as restriction lines); outline de-blurred and widened; map label gained a numbered rank-coloured badge and its text colour now matches the shape palette exactly. `corridorRoutesForMap` (App.tsx) had to start carrying each route's rank/id so the map could colour-match it to its owning corridor. Not done: splitting corridors and trafficability onto independent opacity sliders | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §43 |
| 38 | Road-graph fusion extended: ensemble tie-break + min-cut class-tiered capacity (still not full mixed adjacency) | Direct continuation of step 36's stated remainder. Ensemble: new `preferredRouteKeys` option gives movers a small, fixed pull toward the resolved road-graph route's own hex cells — sharpens which fork a mover picks at a genuine junction (where the old generic road-affinity term can't tell two onTrail forks apart) without overriding the ensemble's own stochastic spread. Min-cut: flat 3× trail capacity replaced with `HIGHWAY_CAPACITY_TIER`, keyed off the same real OSM highway classification the road-class speed model already uses, so a highway chokepoint no longer ties with a farm-track chokepoint on cut value. Neither change makes the ensemble walk the road graph's exact edges or makes min-cut road-graph-aware — both real, larger follow-up work, stated not attempted | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42a |
| 39 | Fuse road-graph routes into movement simulation / min-cut — genuinely mixed hex+road-graph adjacency, CLOSED | Owner: "finish the bigger slice of work so the road usage is fully complete." Ensemble: a mover's recorded position stays a hex cell (no downstream rendering/clustering code needed to change), but its CANDIDATE SET now includes real road-graph "next landing" options — a bounded walk of the road graph's own exact edges (real distance, real class speed) until it reaches a road node whose nearest onTrail hex genuinely differs from the mover's own, so a long straight road is no longer hex-quantized and a real junction offers its actual branches. Safety-motivated scope cut, structural not a flag: mixed-mode is wired ONLY into the unrestricted baseline (`restrictionPlanner.ts` never receives a road graph), so a recommended block can never be silently bypassed by the shortcut. Min-cut: a SEPARATE `computeRoadNetworkMinCut`, reusing the identical max-flow machinery over the road graph's own nodes/edges directly — targets a real road segment, often narrower than a hex, alongside (not replacing) the existing hex-based cut. Not done this pass: new map layers/GIS export/briefing text for the road-network-exact cut — computed, logged, and carried on the result type, not yet visualised | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42b |
| 40 | Road-route decoupling — the instant road-network preview | Owner, picking the next priority explicitly for confidence/accuracy AND visual impact over "nice to have" controls. The box-free vehicle road route never actually depended on the hex-grid retry loop, only on the road-network fetch — but ran after the whole grid/search pipeline settled purely because of where the code sat, so a real result that could appear in seconds instead waited tens of seconds. `findEarlyVehicleRoadRoutePreview` (new) fetches independently, using the EXACT same first-attempt bounds the grid pipeline's own attempt 0 computes, so the existing bbox cache collapses the two into one real network round trip, not a duplicate. New `onRoadRoute` callback wired into `App.tsx` — the map shows the real road route seconds in, always superseded outright by the authoritative result the instant it lands (never a stale preview surviving the real answer) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §44 |
| 41 | Full OSM water-relation topology — multipolygon reassembly | Owner's second confidence/accuracy pick alongside step 40. Step 31's scope cut was framed as "safe either direction", but reading `distanceToNearestWater`'s actual code found a sharper gap: an unclosed fragment (exactly what one piece of a multi-member outer ring usually is) was skipped entirely by the interior point-in-polygon test, so a point deep in a large multi-fragment lake could go UNDETECTED as water — a real under-block risk for a hard-block gate, not just the documented "island over-blocks" direction. `stitchRings` (new, kept in lock-step between webapp and API) reassembles same-role way fragments into closed rings by endpoint-matching; `inner` fragments become real holes assigned to whichever stitched outer ring actually contains them. `distanceToNearestWater`/`roadGraph.ts`'s `isInAnyWaterBody` both now correctly treat a point on a real island as dry ground, not water | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §45 |
| 42 | Hydrology attributes in GIS export / AI briefing | Water-gate fields have been computed by the hard-block hydrology gate since Pass 6, but never reached the exported GeoJSON/KML attributes or the AI briefing payload — a user reading either had no way to see WHY a route avoided or crossed water. `carriesWaterSignal` (new, exported from `mobilityAppreciation.ts`) is now the single predicate the run's own assessment log, the GIS export, and the AI briefing payload all share. GIS export: mission-level water counts plus PER-CORRIDOR `crosses_water`/`water_cell_count` scoped to each corridor's own cells (proven distinct from the grid-wide total). AI briefing: `hydrologyAvailable`/`waterAffectedCellCount`/`waterBodyCellCount` added as required payload fields (kept in lock-step, webapp+API), with a template caution when data is unavailable or a plain-language summary when water is found — silent when data was available and genuinely found none. Also corrected a stale roadmap item found along the way: "Vegetation NVIS-first uplift" (both stated criteria were already shipped in PR #178, 2026-07-16 — only `NVIS_INTEGRATION.md`'s checklist and this table weren't updated) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §46 |
| 43 | Existing-trail reuse: computed then silently discarded before costing, now surfaced | Found while checking a second stale roadmap item ("Road class modelling") against the live code. Real defect, not a doc issue this time: `routeOptimizer.ts` already computes which parts of a route follow a mapped trail and uses it to PREFER trail-following routes during pathfinding (`×0.35` fuel discount) — but that fact never reached `RouteSegment[]`, the exact shape POSTed to `/api/analysis/calculate`, the sole authoritative cost engine. A route reusing a real formed track — including the app's own auto-optimized suggestion — was costed identically to virgin bush, with the AdvisorPanel's own "existing trail used" stat left disconnected from the $/hours shown next to it. Fixed the same way NAFI fire history was handled: `vegetationAnalysis.ts` now also fetches the reusable-trail set once per line and flags each segment (`VegetationSegment.onExistingTrail` → `RouteSegment.onExistingTrail`, a real merge boundary) — surfaced in `AnalysisPanel.tsx` with an explicit note that the estimate does NOT already discount for it, since (unlike the optimizer's own uncited `×0.35`) there is no sourced existing-track-vs-virgin clearing-rate figure to apply | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md), [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) "Infrastructure-aware cost surface" |
| 44 | `api-register.md`/`component-register.md` corrected against the live codebase | An audit of every "MUST match" webapp/api duplicated-logic pair (a bug class with two prior confirmed hits this session) came back clean — but checking the two doc registers themselves against the live code turned up real staleness in both, despite each doc's own "MUST update" policy and a same-day "Last Updated" date. `api-register.md`: the whole `/api/assistant/smeacs` endpoint was undocumented, and `MobilityAssistantPayload`'s documented shape was missing the 3 hydrology fields (step 42) plus the entire probabilistic-movement optional block (step 12) — both live and required/validated in `api/src/types/mobilityAssistant.ts`. `component-register.md`: `EquipmentResults`/`GuidancePanel` were documented but no longer exist in the codebase; ~10 live, in-use components were entirely absent, most strikingly `MobilityPanel.tsx` itself — the main Terrain Mobility screen, shipped and iterated on since step 10 — plus `CounterMobilityPanel`, `DataConfidenceBadge`, `RoadSpeedOverridePanel`, `TacticalCoordinateReadout`, `AssessmentLog`, `MapEmptyState`, `DistributionBar`, `HelpContent`, `LiveFeedsControl`; `ConfirmDialog` was listed as "📋 Planned" though the file already exists (built, WCAG-complete, just never wired into the app — corrected to say so precisely rather than either extreme) | [api-register.md](docs/api-register.md), [component-register.md](docs/component-register.md) |
| 45 | Slice B — lazy grid materialisation + resumable search (the architectural half, remainder closed by step 46) | §35's "the design" points 1 ("delete the box") and 5 ("eager coarse tiles, lazy fine cells"), deliberately deferred at step 24 as a "genuine rearchitecture" too risky to rush. Replaces `mobilityAppreciation.ts`'s escalating-`boundsPadFactor` retry (which rebuilt the ENTIRE grid from scratch — re-sampling every cell, re-running Dijkstra from zero — at a bigger guessed box each time it found no route) with `mobilityLazyGrid.ts`: hex size and the local projection are fixed ONCE from an initial footprint, tiles (~10×10 hexes, one batched fetch each) materialise only when the reachable frontier actually runs off the edge of what's fetched so far, and `accumulatedCost.ts`'s `runAccumulatedCostSearch` gained a `resumeFrom` option so a grown cell set CONTINUES the prior search (seeding the heap from its already-settled `best`/`prev`) instead of restarting Dijkstra from the origin AOI at cost 0. A normal run (initial footprint already contains a route) costs exactly what the old fixed-box first attempt did; only a genuinely Lake-George-shaped run pays for more, and only for the newly-materialised ground. Zero downstream risk to `demDerivatives.ts`/`corridorField.ts`/chokepoints/min-cut — every one of them still receives one ordinary, uniform-hex, FINISHED `MobilityGridCell[]` once the loop concludes; only the process of assembling it changed. `buildMobilityGrid`'s sampling logic was extracted into `sampleCellsForHexes`/`applyCrossSlope` (used by both the unchanged single-shot callers — `unitSimulation.ts`, `buildMobilityGrid` itself — and the new per-tile loop) rather than duplicated. Honestly documented open caveat: a cell's `crossSlopeDeg` is recomputed from whichever neighbours are materialised when its OWN round runs, so a cell settled at a transient tile edge keeps that round's value even if a later round completes its neighbourhood — the same "incomplete edge neighbourhood" effect the old fixed-box approach already had for its outer ring, now transient rather than final; `crossSlopeDeg` was already documented as a conservative upper-bound proxy, not a precise figure. Not attempted this step (closed by step 46): the `α·C*` cost-budget ellipse and the "2–5 corridors" stop rule — the lazy loop then stopped on a cell/tile ceiling (a safety bound) rather than a considered travel-time budget | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 46 | Slice B remainder — `α·C*` cost-budget + 2–5 corridor stop rule, and "most likely"/"most risky" corridor picks | Owner: "proceed with the Slice B remainder item... ensure every analysis result has 2-5 corridors surfaced... we should be seeing a 'most likely' and 'most risky' type of option to inform our planning." Two-phase growth in `mobilityLazyGrid.ts`: Phase 1 grows unconstrained until a route exists at all (`costStarSeconds`, C* in the design's own notation); Phase 2 restricts further tile growth to frontier cells within `α·C*` travel-time of the origin (α defaults to 2.0, threaded as an option though no UI slider is wired yet) — a genuine isochrone-shaped budget that falls straight out of filtering the existing frontier computation, not separate geometry. The PRIMARY stop rule (design's own framing) is corridor count: once a route exists, a cheap interim check (`findKDissimilarPaths` capped at 5 + `corridorField.ts`'s own `clusterRoutes` avenue-similarity test, now exported for reuse) counts genuinely distinct avenues; growth continues within budget until 2 are confirmed, capped at 5, with the α·C*/ceiling safety bounds still behind it for genuinely single-avenue terrain. "Most likely"/"most risky": `CorridorField.mostLikelyCorridorId` is simply rank 1 (already the busiest); `mostRiskyCorridorId` is driven by a new per-corridor `riskScore` — a documented composite (`0.4×(slowGoFraction+noGoFraction) + 0.3×waterCrossingFraction + 0.3×(1−pinchRatio)`, weights stated as engineering judgement exactly like `easeClass`'s own thresholds) built entirely from real, already-computed per-corridor fractions, no new source. `carriesWaterSignal` moved from `mobilityAppreciation.ts` to `accumulatedCost.ts` (re-exported for backward compat) so `corridorField.ts` could use it without a circular import. Surfaced in the assessment log (which corridor is which, and why) and as MOST LIKELY/MOST RISKY badges + a risk/water figure line on each corridor card in `MobilityPanel.tsx`. Verified: `npm run build` clean; new `corridorRiskAndCount.test.ts` (9 checks — a synthetic two-gap grid where only the south gap fords a mapped stream proves `riskScore`/`mostRiskyCorridorId` correctly point at the hazardous avenue, not just the busy one, plus `clusterRoutes` count-matching checks); full existing suite (34 files) still green, same one pre-existing unrelated `nvis-fidelity.test.ts` failure | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| 47 | Mobile UI — quick mover-class selector + coordinate readout repositioned | Owner: "the coordinates panel isn't super useful and shouldn't be the 'top' of the control bar. Consider a four icon/button selector for quick and broad vehicle/movement classes instead of having to scroll down to the dropdown and then scroll the list. Buttons could be foot, 4x4 (car), medium and heavy for example. Then it's an easy few taps to get started." Four icon buttons (Foot / 4×4 / Medium / Heavy) placed at the top of `MobilityPanel.tsx` via Lucide icons, each wired to an existing catalogued profile — no new profile added (just a fast path into the full dropdown below). `TacticalCoordinateReadout` moved from the panel's most-prominent top slot to just above the AREAS OF INTEREST section, where cursor coordinates are contextually relevant during origin/objective painting. CSS for `.mobility-quick-profile-row` / `.mobility-quick-profile-btn` (4-column grid, dark ghost buttons with cyan active state) added to `styles-tactical.css`. Build and typecheck clean | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 (UI surface) |

### Next up

Sorted **smallest effort first**, ready-to-start items ahead of blocked ones. Size is rough shirt-sizing (S/M/L), not a time estimate. "Depends on" names a real prerequisite, not just a related area. **Exception: a defect that produces a confidently-wrong answer jumps the queue regardless of size** — see the first row.

**Owner-directed programme (2026-08-02), takes priority over the general queue below.** Terrain Mobility mode is being restructured around **OAKOC** — the current doctrinal *military aspects of terrain* (Observation and fields of fire, Avenues of approach, Key terrain, Obstacles, Cover and concealment) within **IPOE** (*Intelligence Preparation of the Operational Environment*, ATP 2-01.3 Change 2, Jan 2024) — and its compute moved to a parallel Azure backend with a warm-run latency contract. The mode already implements Obstacles and Avenues without naming them; this finishes the set. Fire-break mode is out of scope and does not change. Stages are ordered and each is independently shippable.

| Item | Scope | Size | Depends on | Detail |
|------|-------|------|------------|--------|
| **OAKOC 1 — mobility-class vocabulary migration** | The engine currently carries two doctrinal generations at once: `mobilityCost.ts` classifies edges `GO/SLOW-GO/NO-GO` (FM 34-130, 1994) while `corridorField.ts` classifies corridors `open/restricted/severely-restricted` (current MCOO). Collapse both onto one `MobilityClass` union via a new `terrain/mobilityClass.ts`. No behaviour change | S/M | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §4 |
| **OAKOC 2 — extract `shared/@firebreak/terrain` workspace package** | Prerequisite for any server-side execution. §38's "just call the existing modules" is optimistic — they live in a different package with a different tsconfig. Extract rather than copy; copying would make the algorithm itself a drift surface | M | OAKOC 1 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| **OAKOC 3 — five-factor framing over existing products** | New `terrain/oakoc.ts` + `OakocPanel.tsx`. Avenues and Obstacles populated by re-presenting products that already exist; names the existing-vs-reinforcing obstacle split the code already computes; gives `roadNetworkBarrier` its first map layer and export feature. No new computation | M | OAKOC 1 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §8, §47 |
| **OAKOC 4 — key terrain** | The one missing factor that is nearly free: candidates from chokepoints + hex/road min-cut, scored by re-running the corridor field with each denied and measuring the delta via the existing `compareCorridorFields`. Makes `PITCH_TERRAIN_DENIAL.md`'s existing "key terrain" claim true | M | OAKOC 3 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47 |
| **OAKOC 5 — backend protocol + tier-2 execution (no fan-out yet)** | Job submit → Durable status polling carrying blob pointers → client reads artefacts direct from Blob with a job-scoped SAS. Ships **before** parallelism deliberately: a wrong partial-result rule is a safety bug, a slow correct run is only slow | L | OAKOC 2 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| **OAKOC 6 — `viewshed.ts` + Observation & fields of fire** | R3 line-of-sight over the hex grid (one elevation per hex centre, no raster in hand). Observers via a third paint role. Fields of fire computed **only** for user-stated ranges — never inferred | M/L | OAKOC 3 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §8 |
| **OAKOC 7 — cover & concealment** | Concealment from vegetation structure + dead ground. **Cover is not computed** — a bare-earth DEM cannot see a rock, bund or building — and `coverAssessed: false` ships as a machine-readable property in export and payload, not just UI prose | S/M | OAKOC 6 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §47 |
| **OAKOC 8 — backend fan-out** | Parallelise what genuinely parallelises: tile sampling (capped at 2–3 concurrent on Overpass), viewshed by observer, mover ensemble by chunk, key-terrain candidates. Dijkstra and the k-dissimilar loop are sequential by construction and stay that way | M | OAKOC 5, 6 | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| **OAKOC 9 — Container Apps Job tier (still gated)** | Unchanged gate: build only on tier-2 evidence of a real tail of oversized runs. Same protocol as OAKOC 5, so it becomes a compute swap rather than new plumbing | L | tier-2 evidence | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| Road-speed `user-override` confidence into GIS export + AI briefing | The override mechanism itself is shipped (step 21) and visibly flagged in the panel/run log; carrying the flag into export attributes and the briefing payload — matching how vegetation overrides are documented to behave — is the one piece not yet done | S | Slice A config UI (✅) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §35 |
| End-user guide | Never existed; decide whether it lives here or in Station Manager's in-app wiki, then write it | S | — | docs/README.md |
| Restrictions costed against `delayLedger.ts` | Both pieces exist; wire the recommended-restriction set through the existing delay-cost model | S/M | restrictionPlanner.ts, delayLedger.ts (✅ both) | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| A real fuel-age → clearing-rate relationship | Genuinely blocked on **finding a sourced curve**, not on plumbing — NAFI fire-age and DEA fractional-cover are both fetched and surfaced as context (steps 10, 17) but nothing grounds how they should move the production rate; do not invent a coefficient | M+ | a citable source (research literature / agency guidance) | [CALCULATION_REVIEW.md](docs/CALCULATION_REVIEW.md), [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §31 |
| UI/UX uplift, moves 4–5 | Shared type/confidence discipline across both modes; extend Terrain mode's mobile floating-overlay pattern to fire-break mode | M | moves 1–3 (✅) | master_plan Recent Updates, 2026-07-26 |
| ~~Function-hosted (tier 2) mobility search~~ | **Superseded — now OAKOC 2 + 5 above.** The telemetry gate (step 32) was for deciding *when to switch*, not *whether to build*; owner direction on 2026-08-02 superseded the build gate. Telemetry is still the right evidence for the routing threshold, so tier 2 ships with an explicit user choice plus a conservative automatic threshold that telemetry tunes later | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| ~~On-demand Container Apps Job (tier 3)~~ | **Superseded — now OAKOC 9 above.** Scope and gate are unchanged (still built only on tier-2 evidence of a real tail); it moves into the programme so it shares OAKOC 5's protocol instead of defining its own | — | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38 |
| Vector RAG via Azure AI Search | Keyword KB works; RAG needs an Azure AI Search resource provisioned | M | Azure AI Search resource | [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) |
| Restriction siting at a surveyed point | Currently hex-cell resolution, not a specific point — an architecture change to the placement model | L | — | [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §32 |
| Field hardening | Offline-first PWA (cached tiles + analyses), WCAG 2.1 AA completion | L | — | [NVIS_INTEGRATION.md](docs/NVIS_INTEGRATION.md) |
| Agency hand-off | ArcGIS Online hosted-feature-layer push (OAuth PKCE); Avenza geospatial-PDF spike | L | — | [GIS_INTEROP.md](docs/GIS_INTEROP.md) §2, §3 |

#### Next up — outcome, changes required, difficulty

##### OAKOC programme

- **OAKOC 1 — mobility-class vocabulary migration** (Difficulty: S/M)
  - Outcome: one mobility vocabulary instead of two, in the current doctrinal form, so nothing the product shows or exports reads as twenty-year-old terminology to a serving audience.
  - Changes: new `terrain/mobilityClass.ts` (canonical union, labels, `fromLegacy()`) · `TrafficabilityClass` and `CorridorEaseClass` both collapse onto it · `goFraction`/`slowGoFraction`/`noGoFraction` renamed · map paint expressions, CSS modifiers, legend and panel labels · GIS export **dual-emits** old and new keys for one release with `schema_version: 2` · assistant validator accepts either vocabulary.
  - Note: three things must NOT be renamed — `mobilityTelemetry.ts`'s wire field names (an analytics time series the tier-routing threshold depends on; renaming splits it), and the `--tac-go`/`--tac-slowgo`/`--tac-nogo` CSS colour tokens (tokens, not vocabulary). Saved plans carry no risk: mobility results are never persisted.
  - Honesty catch worth shipping with it: `NO-GO` is a **hard gate** in this engine, but *severely restricted* doctrinally does not mean impassable. The rename must carry an explicit "impassable for THIS mover profile in this model" qualification or the model reads weaker than it is.

- **OAKOC 2 — extract `shared/@firebreak/terrain`** (Difficulty: M)
  - Outcome: the same terrain code runs on the client and the server, so a server-side result cannot silently diverge from a client-side one.
  - Changes: move `terrain/*`, the sampling utils, `config/classification` into a workspace package · break the two type-only `ConfidenceTier` imports · make the seeded mover ensemble chunk-invariant (`hash(seed, moverIndex)`).
  - Note: the ensemble seeding fix **changes today's numbers once**. Flag it as a deliberate one-time change, never silent drift. `mapboxTrails.ts` stays client-only (it reads a live GL map) — a real capability difference to record, not hide.

- **OAKOC 3 — five-factor framing** (Difficulty: M)
  - Outcome: the analysis reads as a recognised terrain appreciation product — five named factors, each with its own findings, confidence and caveats — instead of a list of bespoke analytics.
  - Changes: `terrain/oakoc.ts` (assembly only, computes almost nothing) · new `OakocPanel.tsx` extracted rather than growing `MobilityPanel.tsx` further · `roadNetworkBarrier` gets its first map layer and export feature after being computed-and-discarded on every vehicle run · `Corridor.bottleneckCellKeys` added.
  - Note: `'not-assessed'` is a first-class state. A factor with no observers is *not assessed*, which is a different claim from "nothing found" — conflating them is the fabrication this repo exists to prevent.

- **OAKOC 4 — key terrain** (Difficulty: M)
  - Outcome: the tool names the ground whose denial actually changes the picture, and shows the delta that earned the label plus the cost of bypassing it.
  - Changes: `terrain/keyTerrain.ts` · candidates from chokepoints + hex min-cut + road min-cut + corridor bottlenecks · each scored by a real re-run compared with `compareCorridorFields` · new worker request kind (must not run on the main thread — that reproduces step 41's page-hang exactly).
  - Note: doctrine defines key terrain relative to a *mission*, and this tool has no mission. Ship that caveat. Decisive terrain is computed as a predicate but presented as a **candidate** requiring confirmation — the commander designates it, not the map.

- **OAKOC 5 — backend protocol + tier-2 execution** (Difficulty: L)
  - Outcome: analysis runs on the server with results streaming back progressively, and a dropped connection resumes instead of recomputing.
  - Changes: SWA Free→Standard + a Flex Consumption Function App behind `deployMobilityBackend bool = false` · Durable orchestration · append-only artefact blobs with a 24-hour lifecycle rule · job-scoped read-only SAS · `MobilityJobRequest` becomes the **third** must-match webapp/api pair · Table-Storage-backed rate limiting for the job endpoint (`rateLimit.ts`'s in-memory buckets under-enforce on a scaled-out plan).
  - Note: export and the AI briefing are **blocked while a run is provisional**, and the briefing block is enforced server-side, not just in the UI.

- **OAKOC 6 — viewshed + Observation & fields of fire** (Difficulty: M/L)
  - Outcome: the plan says what ground is observed, from where, and what sits in dead ground — and suggests where an observation post would actually see the corridor.
  - Changes: `terrain/viewshed.ts` (front-to-back R3 over the hex grid, written as a pure partitionable function from day one) · `hexLine()` added to `hexGrid.ts` · third paint role for observers · a `SCREENING_HEIGHT_M` table in `structureTable.ts` with per-row confidence · curvature + refraction.
  - Note: elevation is a **bare-earth DEM**, so sight lines are systematically optimistic — the error that leaves an approach unwatched. The screened (more pessimistic) surface is the default; bare-earth is a toggle; both export.

- **OAKOC 7 — cover & concealment** (Difficulty: S/M)
  - Outcome: concealment is reported honestly and cover is explicitly *not* claimed.
  - Changes: concealment index from vegetation structure + dead ground · defilade only relative to specified positions · `coverAssessed: false` as a machine-readable property in the GIS export, the assistant payload and the briefing.
  - Note: cover and concealment are doctrinally different things and must never be blended into one score.

- **OAKOC 8 — backend fan-out** (Difficulty: M)
  - Outcome: large runs get materially faster without changing any number they produce.
  - Changes: fan out tile sampling (Overpass capped at 2–3 concurrent — it rate-limits, and this repo has already fought that), viewshed by observer, ensemble by chunk, key-terrain by candidate · pass a blob URI to activities, never the cell array.
  - Note: the multi-source Dijkstra and the k-dissimilar route loop are **sequential by construction** and are deliberately not parallelised. The restriction planner is the long pole; only the ensemble inside each evaluation parallelises.

- **OAKOC 9 — Container Apps Job tier** (Difficulty: L, gated)
  - Outcome: genuine outlier runs complete instead of timing out.
  - Changes: same artefact layout and status document as OAKOC 5, so this is a compute swap.
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

- **Function-hosted (tier 2) mobility search** — superseded, see **OAKOC 2 + 5**. One correction worth carrying forward: the old note claimed "no rewrite" because the API is already Node/TS. That was optimistic — `webapp/src/terrain/*` lives in a different package with a different tsconfig, so a shared workspace package has to be extracted first (OAKOC 2). Copying instead would make the algorithm itself a fourth must-match drift surface.

- **On-demand Container Apps Job (tier 3)** — superseded, see **OAKOC 9**. Gate unchanged.

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
Gates: `npm run build` (webapp, strict TS), `npm run test:unit` (api) — both in CI.

## Recent Updates

- **2026-08-02 — OAKOC programme added to the roadmap (stages 1–9), plus a
  doctrinal terminology correction**: owner asked how the mode's "inadvertently
  implemented" military terrain framework could be used to redefine analysis and
  presentation, and separately directed the compute onto a parallel backend with
  a ~10 s first-paint / ~10 s update contract. Research finding worth recording:
  the acronym the work started from, **OCOKA**, is the superseded form (FM 34-130,
  1994). Current doctrine is **OAKOC**, and the parent process was renamed from
  IPB to **IPOE** in ATP 2-01.3 Change 2 (Jan 2024, Change 3 May 2025); the MCOO
  mobility classes are UNRESTRICTED / RESTRICTED / SEVERELY RESTRICTED. The
  codebase was found carrying **both vintages at once** — `mobilityCost.ts` on
  `GO/SLOW-GO/NO-GO`, `corridorField.ts` on `open/restricted/severely-restricted`
  — which stage 1 fixes. Audit against the five factors: **Obstacles** and
  **Avenues of approach** are largely built and simply unnamed; **Key terrain**
  is ~90% computable from existing chokepoint/min-cut/`compareCorridorFields`
  machinery; **Observation** and **Cover & concealment** are the genuine gaps and
  correspond to ROUTE_INTELLIGENCE §9's existing M5. Two owner decisions recorded
  with their consequences: **scale-to-zero** (so the latency contract is a
  warm-run contract and a cold run must show a "starting up" state), and
  **backend-only execution** (retiring the client Worker path, which removes the
  mode's offline capability — Vision principle 4 amended accordingly rather than
  left claiming a property the code will not have). Blocking infra finding: the
  API runs on **SWA Free with managed functions**, which are HTTP-trigger-only
  and cannot run Durable Functions, and every request through `/api` is capped at
  45 s regardless of backend — so the contract needs SWA Standard plus a separate
  Flex Consumption Function App, behind a `deployMobilityBackend` flag. Scope
  deliberately excludes fire-break mode, which keeps its SMEACS/LACES fire-service
  framing. Deferred with reasons: named scenarios, consensus corridors, per-cell
  DEA fractional-cover sampling, doctrinal echelon labels.

- **2026-08-02 — Mobile UI: quick mover-class selector + coordinate readout
  repositioned (step 47)**: owner: "the coordinates panel isn't super useful
  and shouldn't be the 'top' of the control bar. Consider a four icon/button
  selector for quick and broad vehicle/movement classes instead of having to
  scroll down to the dropdown." Four buttons (Foot / 4×4 / Medium / Heavy) now
  sit at the top of MobilityPanel.tsx, each wiring to an existing catalogued
  profile — no new profile added, just a fast path. `TacticalCoordinateReadout`
  moved to just above the AREAS OF INTEREST section where cursor coordinates are
  contextually relevant (painting origin/objective). CSS added for
  `.mobility-quick-profile-row` / `.mobility-quick-profile-btn` in
  `styles-tactical.css`. Build and typecheck clean. PR #200.

- **2026-07-29 — Slice B remainder (step 46): α·C* cost-budget + 2-5
  corridor stop rule, "most likely"/"most risky" corridor picks**: owner,
  immediately following step 45: "proceed with the Slice B remainder
  item... ensure every analysis result has 2-5 corridors surfaced...
  we should be seeing a 'most likely' and 'most risky' type of option to
  inform our planning." Closes the two design points step 45 deliberately
  left open.

  `mobilityLazyGrid.ts` now runs in two phases, matching §35's own design
  exactly: Phase 1 grows unconstrained until a route exists at all
  (`costStarSeconds`, C* in the design's notation); Phase 2 restricts
  further tile growth to frontier cells within `α·C*` travel-time of the
  origin (α defaults to 2.0) — the self-sizing cost-budget "ellipse" falls
  straight out of filtering the existing frontier-tile computation by
  arrival time, not a literal geometric shape drawn separately. The PRIMARY
  stop rule, per the design's own priority, is corridor count, not the
  budget: once a route exists, a cheap interim check derives up to 5
  dissimilar routes (`findKDissimilarPaths`) and clusters them by the SAME
  avenue-similarity test the final presentation uses (`corridorField.ts`'s
  `clusterRoutes`, now exported for this reuse) — growth continues within
  budget until 2 distinct avenues are confirmed, capped at 5 regardless
  (diminishing returns for a commander reading the panel, not diminishing
  accuracy — the separate, larger final `buildCorridorField` pass can still
  find more). The α·C*/cell/tile ceilings remain the safety bounds BEHIND
  corridor count, exactly as designed — genuinely single-avenue terrain
  still gets an honest 1-corridor result once the budget is real.

  "Most likely" is simply rank 1 (already the busiest corridor by
  construction — no new computation needed, just a named pointer,
  `CorridorField.mostLikelyCorridorId`). "Most risky"
  (`mostRiskyCorridorId`) is new: each `Corridor` now carries a `riskScore`
  (0..1), a DOCUMENTED composite of real, already-computed per-corridor
  fractions — `0.4×(slowGoFraction+noGoFraction) + 0.3×waterCrossingFraction
  + 0.3×(1−pinchRatio)` — with the weights stated plainly as this product's
  own engineering judgement, the identical honesty framing `easeClass`'s
  thresholds already carry. `pinchRatio` and `waterCrossingFraction` are new
  PER-corridor fields too (the field-level `CorridorField.pinchRatio` only
  ever tracked the busiest corridor). `carriesWaterSignal` — the single
  hydrology predicate the assessment log/GIS export/AI briefing already
  shared — moved from `mobilityAppreciation.ts` to `accumulatedCost.ts` (re-
  exported for every existing import site) so `corridorField.ts`, a module
  `mobilityAppreciation.ts` itself imports, could reuse it without a
  circular import.

  Surfaced, not just computed: the assessment log now states which corridor
  is which and why (risk breakdown: hazard fraction, water-crossing
  fraction, pinch ratio); `MobilityPanel.tsx`'s corridor cards gained MOST
  LIKELY / MOST RISKY pill badges plus a risk/water figure line, styled to
  match the existing ease-class badge pattern.

  Verified: `npm run build` (webapp, strict TS) clean; new
  `corridorRiskAndCount.test.ts` (9 checks) — a synthetic two-gap grid where
  ONLY the south gap fords a real mapped stream (`au-light-4wd`, fording
  capability 0.7 m > the stream's assumed 0.4 m, so it's hazardous but
  passable, not a hard block) proves `riskScore`/`mostRiskyCorridorId`
  correctly identify the hazardous avenue specifically, not just the
  busiest one, plus `clusterRoutes` cluster-count checks (two real gaps →
  two clusters; one sealed → one cluster). Full existing suite (34 test
  files) still green, same one pre-existing unrelated `nvis-fidelity.test.ts`
  failure noted since step 23.

- **2026-07-29 — Slice B (step 45): lazy grid materialisation + resumable
  search shipped**: the architectural half of §35's Slice B design, carried
  forward from step 24's "deliberately not attempted in one pass — a rushed
  version risked shipping something that looked like Slice B but subtly
  broke an invariant" decision. `mobilityAppreciation.ts`'s
  escalating-`boundsPadFactor` retry (rebuild the WHOLE grid from scratch —
  re-sample every cell, re-run Dijkstra from zero — at a bigger guessed box
  whenever a search found no route) is replaced by `mobilityLazyGrid.ts`:
  hex size and the local projection are fixed once from an initial
  footprint (identical sizing math to the old first attempt, so a typical
  short-range run is unchanged), tiles (~10×10 hexes, one batched
  elevation/vegetation/road/water fetch each) materialise only when the
  reachable frontier actually runs off the edge of what's fetched so far,
  and `accumulatedCost.ts#runAccumulatedCostSearch` gained a `resumeFrom`
  option so a grown cell set CONTINUES the prior search (seeding the heap
  from its already-settled `best`/`prev` — correct because Dijkstra with
  non-negative edges never revises a settled distance) instead of
  restarting from the origin AOI at cost 0. A normal run costs exactly what
  the old fixed-box first attempt did; only a genuinely Lake-George-shaped
  run pays for more, and only for the newly-materialised ground.

  What made this safe to attempt: the lazy loop still hands
  `demDerivatives.ts`, `corridorField.ts`, chokepoints and min-cut one
  ordinary, uniform-hex, FINISHED `MobilityGridCell[]` once it concludes —
  none of them needed to change, because only the PROCESS of assembling
  that array changed, not its shape. `buildMobilityGrid`'s sampling block
  was extracted into `sampleCellsForHexes`/`applyCrossSlope` (pure
  refactor, behaviour-preserving) so both the unchanged single-shot callers
  (`unitSimulation.ts`, `buildMobilityGrid` itself) and the new per-tile
  loop share one sampling implementation rather than two copies that could
  drift.

  Honestly documented, not engineered away: a cell's `crossSlopeDeg` is
  recomputed from whichever neighbours are materialised when ITS round
  runs, so a cell settled at a transient tile edge keeps that round's value
  even if a later round completes its neighbourhood — the same
  "incomplete-neighbourhood edge effect" the old fixed-box approach already
  had for its outer ring, now transient rather than permanent;
  `crossSlopeDeg` was already documented as a conservative upper-bound
  proxy, not a precise per-edge figure, so this doesn't change what callers
  may assume about it.

  Not attempted this pass (moved to the narrower "Slice B remainder" Next-up
  item): the `α·C*` cost-budget ellipse and the "2–5 distinct corridors"
  stop rule — the lazy loop currently stops growing on a cell/tile ceiling
  (a safety bound) rather than a considered travel-time budget.

  Verified: `npm run build` (webapp, strict TS) clean; two new engine-level
  test files (`resumableSearch.test.ts` — proves a resumed search matches a
  from-scratch search over the same final cell set exactly, never revises
  an already-settled distance, and a synthetic Lake-George-style barrier
  proven reachable only after a resumed tile-ring growth, not on the
  narrower first round; `lazyTilePartition.test.ts` — proves the tile
  partition never double-materialises or drops a hex); full existing
  Terrain Mobility test suite still green (32 files), including the
  `expandingSearchLakeGeorge`/`frontierEdgeGrowth`/`paddedBoundsLakeGeorge`
  suite this change's own predecessor shipped — same one pre-existing,
  unrelated `nvis-fidelity.test.ts` failure noted at step 23 remains,
  untouched.

- **2026-07-29 — Every "Next up"/"Blocked" roadmap row expanded with
  outcome, required changes, and difficulty**: owner asked for each open
  roadmap item to carry a 1-line outcome, 2–3 concrete change bullets, and a
  difficulty rating, added into the plan rather than just reported back.
  Added `#### Next up — outcome, changes required, difficulty` and
  `#### Blocked — outcome, changes required, difficulty` subsections
  directly under the existing summary tables (tables stay as the compact
  index; the new subsections give depth per item). Grounded each entry in
  the actual linked doc section rather than re-summarising from the table's
  own one-line Scope text — e.g. pulled the exact `restrictionPlanner.ts`
  "still open" list from `ROUTE_INTELLIGENCE.md` §32 for the restriction
  siting/costing rows, the real VCI₁/VCI₅₀ worked example for the min-cut
  capacity row, and the RAG swap-point contract (`retrieveDoctrine`'s
  signature is already the designed extension point) from `AI_ASSISTANT.md`.
  Surfaced one thing along the way worth flagging rather than silently
  fixing: the "Field hardening" row's linked doc (`NVIS_INTEGRATION.md`)
  doesn't actually contain any offline/WCAG content — the row has never had
  a real design behind it, only a two-clause scope description; noted
  in-place rather than treated as another stale-doc fix, since inventing
  the missing design isn't a documentation-accuracy task.

- **2026-07-28 — `api-register.md`/`component-register.md` corrected against
  the live codebase (step 44)**: owner: "move into the next priority
  roadmap item," continuing the same investigation-first pattern that found
  the last few real defects. This round's investigation came back clean —
  spawned an audit of every place the codebase comments as needing to stay
  "in lock-step" between `webapp` and `api` (a bug class with two confirmed
  prior hits this session: the multi-fragment water topology gap and an
  earlier Overpass query drift). Checked Overpass query constants,
  ring-stitching logic, vegetation tile constants, both AI assistant payload
  validators, provenance strings, and the equipment catalogue — all
  genuinely in sync. No fix needed there.

  Turned the same "compare the doc's claim against the live code" lens on
  the two doc registers themselves, since CLAUDE.md names them as
  "machine-readable catalogs; update when endpoints/components change" and
  both carry an explicit same-day "Last Updated" stamp that turned out not
  to be earned. `api-register.md`: `/api/assistant/smeacs`
  (`assistantSmeacsBriefing.ts`, live since the SMEACS briefing pack
  shipped) was entirely undocumented; the `MobilityAssistantPayload`
  TypeScript block was missing the 3 hydrology fields this session's own
  step 42 added as REQUIRED, and the whole probabilistic-movement optional
  block from step 12 (`corridorEvidence`/`movement`/`restrictions`/
  `restrictionEffect`). Added the endpoint row, `SmeacsBriefing` type, the
  `AssistantPayload` SMEACS optional fields, and both missing
  `MobilityAssistantPayload` blocks — copied field-for-field from the
  actual validator (`api/src/types/mobilityAssistant.ts`), not
  re-summarised from memory.

  `component-register.md` was in worse shape: `EquipmentResults` and
  `GuidancePanel` are documented rows for components that no longer exist
  anywhere in `webapp/src` — confirmed by grep, not just a missing file.
  More seriously, `MobilityPanel.tsx` — the actual Terrain Mobility screen,
  the single most-worked-on UI surface across this session's steps 10
  through 43 — was never in the register at all, alongside 9 other real,
  imported, live components (`CounterMobilityPanel`, `DataConfidenceBadge`,
  `RoadSpeedOverridePanel`, `TacticalCoordinateReadout`, `AssessmentLog`,
  `MapEmptyState`, `DistributionBar`, `HelpContent`, `LiveFeedsControl`).
  Added a new "Terrain Mobility Components" table for them, verified each
  one's actual import site first (not assumed from the filename) so the
  "Key Dependencies" column is real. Along the way, confirmed
  `ConfirmDialog.tsx`, `ConfigPanelComponents.tsx`, `ConfigTest.tsx`, and
  `VegetationOverridePanel.tsx` are built but imported nowhere — left out
  of the live tables rather than added, since documenting orphaned code as
  active architecture would just be a different kind of inaccurate;
  `ConfirmDialog`'s "📋 Planned" row was corrected to say "built, not wired
  in" rather than leave the stronger, also-wrong claim that it doesn't
  exist yet. No `webapp`/`api` runtime code changed this pass — pure
  documentation-accuracy correction, but a live one: an agent (or a person)
  trusting either register at face value this morning would have missed a
  real endpoint and the app's flagship Terrain Mobility panel entirely.

- **2026-07-28 — Hydrology attributes in GIS export / AI briefing (step
  42)**: owner: "on to the next priority, again focus on functional
  improvements and quality — don't add 'nice to haves'." CLAUDE.md's own
  "next step" pointer named "Vegetation NVIS-first uplift" — investigated
  first, and found it stale: both stated acceptance criteria (explicit
  `NoData` handling, flagging modified/low-fidelity segments) were already
  fully shipped in PR #178 (2026-07-16), just never checked off in
  `NVIS_INTEGRATION.md` or removed from this roadmap. Corrected both docs
  (no code change needed there) and moved to the next real, unshipped item:
  the water-gate fields computed by the hydrology hard-block gate since Pass
  6 were never carried into the GIS export or the AI briefing — a user
  reading either had no way to see WHY a route avoided or crossed water,
  even though the system had already worked it out.

  `carriesWaterSignal` (new, exported from `mobilityAppreciation.ts`) lifts
  the exact water-signal query the run's own assessment log already computed
  inline into a shared function — the log, the GIS export, and the AI
  briefing payload now all call the SAME predicate, so none of the three can
  quietly drift onto a different threshold.

  GIS export (`mobilityGisExport.ts`): mission-level `hydrology_available` +
  `water_affected_cell_count`/`water_body_cell_count`; each CORRIDOR feature
  gained `crosses_water`/`water_cell_count` scoped to ONLY its own cells
  (`corridorProperties()` now takes a hoisted `cellsByKey` map) — proven with
  a dry/wet corridor pair where the wet corridor's count is neither zero nor
  the grid-wide total. KML mission/corridor descriptions gained matching
  plain-language notes.

  AI briefing (`mobilityAssistantApi.ts` + `api/src/types/mobilityAssistant.ts`
  + `mobilityBriefingTemplate.ts`, kept in lock-step): payload gained the same
  three fields as REQUIRED (matching `estimatedData`'s always-computed
  treatment, not the optional movement/restriction blocks that arrived after
  other clients existed). `aiGrounding.ts`'s `flattenPayloadNumbers` already
  walks the payload generically, so the new counts needed no grounding-layer
  change to be citable. Template narrates a caution when hydrology data was
  unavailable, or a summary when real water was found — silent when data WAS
  available and genuinely found none, so a clean AOI's briefing stays clean.

- **2026-07-28 — Existing-trail reuse: computed then silently discarded
  before costing, now surfaced (step 43)**: owner: "move into the next
  priority roadmap item." The Next-up queue's own "Road class modelling" row
  was checked against the live code first and turned out to be a second
  stale entry — its language ("a highway and a farm track are identical to a
  mover") is Terrain Mobility terminology describing a gap Slice A
  (`roadSpeedModel.ts`) already closed months earlier; its cited section
  (§32, "Probabilistic movement") doesn't discuss road class at all. Removed
  the stale row — but the investigation surfaced a real, more serious defect
  in the OTHER route-planning subsystem: the fire-break optimizer.

  `routeOptimizer.ts` already computes which parts of a candidate route
  follow a mapped trail/track/road (`TRAIL_SNAP_M = 30m`) and applies a
  `×0.35` fuel discount to PREFER trail-following routes during pathfinding
  — but that fact was never carried into `RouteSegment[]`, the exact shape
  `BackendAnalysisRequest.segments` POSTs to `/api/analysis/calculate`, the
  SOLE authoritative cost engine (CLAUDE.md). A route that reused a real
  formed track — including the app's own auto-optimized suggestion, chosen
  specifically because it favours trails — was costed identically to virgin
  bush of the same vegetation class, with nothing anywhere in the final
  estimate to say otherwise; the optimizer's own before/after "existing
  trail used" stat (`AdvisorPanel.tsx`) is a distance figure disconnected
  from the $/hours shown next to it. A confidently-wrong-answer defect, not
  a missing nice-to-have.

  Fixed the same way NAFI fire history was: `vegetationAnalysis.ts` now
  also fetches the reusable-trail set (`fetchCorridorInfrastructure`, the
  same default `highway` kind `routeOptimizer.ts` already queries) once per
  line, alongside the existing waterway fetch, and flags each segment
  (`VegetationSegment.onExistingTrail` → `RouteSegment.onExistingTrail`) —
  a real merge boundary, mirroring `isWater`, never blended across. The
  `×0.35` pathfinding discount is itself an uncited constant, so extending
  it into the authoritative cost model would repeat exactly the
  "invented factor" problem F3 replaced (`CALCULATION_REVIEW.md`) — there
  is no sourced existing-track-vs-virgin clearing-rate figure, unlike
  water's structural "already broken" certainty. So the flag is
  deliberately NOT wired into any time/cost number: `AnalysisPanel.tsx`
  shows a note stating the total reused length AND that the estimate does
  not already discount for it, so a user never mistakes the headline figure
  for one that already accounts for the track. Proven with
  `routeProfileExistingTrail.test.ts` (4 tests): boundary correctness,
  no cross-boundary merge, zero effect on length/slope/vegetation, and a
  safe `false` default for older inputs with no trail data at all.

  14 new tests: `mobilityHydrologyExport.test.ts` (webapp, 6),
  `mobilityHydrologyBriefing.test.ts` (webapp, 3 — including a genuine
  below-threshold `waterFrequency` cell correctly NOT counted), 5 more in the
  API's `mobilityAssistant.test.ts` (validator + template), plus the 2 doc
  corrections above. Full existing suite green in both packages; `tsc`/build
  clean in both. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §46.

- **2026-07-28 — Full OSM water-relation topology: multipolygon reassembly
  (step 41)**: owner's second confidence/accuracy pick alongside step 40.
  Step 31 ("OSM water relations") shipped the common case and stated a
  scope cut — multi-part outer rings weren't re-stitched, islands weren't
  subtracted as holes — framed as safe in both directions.

  Reading the actual consumer code (not just the extraction code) found a
  sharper problem: `distanceToNearestWater`'s interior point-in-polygon
  test already had a defensive `if (!closed) continue` guard, so an
  UNCLOSED fragment — exactly what one piece of a multi-member outer ring
  usually is on its own — was skipped entirely, not "gated member-by-member"
  as the old comment claimed. A point deep in a large multi-fragment lake,
  far from any single fragment's own edge, could go completely undetected
  as water. That's a real UNDER-block risk for a hard-block hydrology gate —
  the opposite of the documented safe direction — which made this a
  correctness fix, not just a completeness item.

  Fixed, kept in explicit lock-step between `webapp` and `api` (matching
  the existing "MUST match" discipline): `stitchRings` reassembles a
  relation's same-role way fragments into closed ring(s) by matching
  endpoints in either orientation, chaining until each ring closes — an
  unstitchable fragment still surfaces as a plain edge feature, never a
  fabricated closure. `inner` fragments are stitched the same way and
  assigned as holes to whichever stitched OUTER ring actually contains them
  (a relation can have multiple disjoint lakes, each with its own islands).
  `InfrastructureTrail` gained `holes?: LatLng[][]`; `distanceToNearestWater`
  builds a proper multi-ring GeoJSON `Polygon` (Turf already implements
  "outer minus holes" correctly, no new logic needed there);
  `distanceToNearestTrail` now also scans hole boundaries for edge-proximity
  (a real island's shoreline is a genuine water/land edge too);
  `roadGraph.ts`'s self-contained `isInAnyWaterBody` gained the matching
  hole check, so a road entirely on a real island is correctly not flagged
  as an in-water crossing.

  8 new tests total: `waterRelationTopology.test.ts` (webapp, 4 checks) —
  a three-fragment ring correctly detects water at its centre (the core
  regression), an island reads as dry with the surrounding lake still wet,
  two disjoint lakes each get only their own island, an unstitchable
  fragment degrades safely; mirrored in the API's `infrastructure.test.ts`
  (4 checks, same fixtures); `roadWaterCrossing.test.ts` gained 2 more — a
  road on a real island is not blocked, the same lake without the island
  road still correctly blocks a crossing through genuine open water. Full
  existing suite green in both packages; `tsc`/build clean in both. Full
  detail: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §45.

- **2026-07-28 — Road-route decoupling: the instant road-network preview
  (step 40)**: owner, picking the next priority after step 39 shipped:
  "improves the confidence or accuracy of the system and... visually
  'sell[s]' it... make sure the core is rock solid and reliable before we
  start adding controls and adjustments" — explicitly deprioritising a
  road-speed-override-confidence export item in favour of this and the
  water-relation topology fix below.

  The box-free vehicle road route (`findVehicleRoadRoute`, Slice A) never
  actually depended on the hex-grid retry loop below it in
  `mobilityAppreciation.ts` — it only ever needed the road-network fetch, one
  of several fetches already running in parallel inside `buildMobilityGrid`
  — but sat, uncalled, until the ENTIRE grid/search pipeline finished, purely
  because of where the code happened to live. On a large or fine-fidelity
  AOI that's tens of seconds; the road route itself resolves in a couple.

  Fixed: `findEarlyVehicleRoadRoutePreview` (new, `roadRouteSearch.ts`)
  fetches road/water data INDEPENDENTLY of the retry loop, using the exact
  same `computePaddedBounds` inputs (`INITIAL_PAD_FACTOR`,
  `minDetourPadM(profile)`) the grid pipeline's own first attempt uses — not
  a coincidence, a hard requirement: the existing bbox result/in-flight
  cache (`infrastructureService.ts`) only collapses two requests into ONE
  real network round trip when they land on the identical rounded bbox key.
  A new `onRoadRoute` callback fires the moment this resolves; `App.tsx`
  wires it into a fresh `mobilityEarlyRoadRoute` state feeding the map's
  existing `roadRoute` prop ahead of the authoritative
  `mobilityResult.roadRoute` — which always supersedes it outright the
  instant it lands, including correctly clearing to null if a retry-widened
  box moved the route out of range. Best-effort only: any failure resolves
  to nothing shown, never throws, never blocks the real pipeline.

  6 new tests (`roadRouteDecoupling.test.ts`, global `fetch` stubbed): a foot
  profile triggers zero fetches; a vehicle profile finds the same route the
  live pipeline finds; the bbox actually sent is parsed back out of the
  stubbed request and checked against an independently-computed
  `computePaddedBounds` call — proving the cache-collapse claim by
  construction; a without-the-connector control still correctly finds
  nothing; no road data and a simulated network failure both resolve
  cleanly to null. Full existing suite still green; `tsc`/build clean. Full
  detail: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §44.

- **2026-07-28 — The genuinely mixed hex+road-graph adjacency, road usage now
  fully complete (step 39)**: owner, after step 38 shipped: "finish the
  bigger slice of work so the road usage is fully complete." §42/§42a both
  deferred this exact rewrite as real, larger, riskier work — done here in
  two bounded pieces, together closing the "fuse road-graph routes into
  movement simulation / min-cut" roadmap item completely.

  **Ensemble** (`movementSimulation.ts`): a mover's recorded position stays a
  hex cell always, so every downstream consumer (`TransitCell` polygons,
  `MoverTrack.keys`, corridor/chokepoint hex-band clustering) needed zero
  changes. What's new is the CANDIDATE SET offered at each step: on a hex
  linked to a road-graph node, a bounded forward walk follows the road
  graph's own real edges — exact distance, exact class speed — until it
  reaches a node whose nearest onTrail hex genuinely differs from the
  mover's own, offering that hex with the real cumulative time. A long
  straight road is no longer forced through hex-sized steps, and a real fork
  offers its actual branches rather than "any onTrail neighbour hex" the
  tessellation happens to present.

  **Load-bearing safety cut**: mixed-mode is wired ONLY into the unrestricted
  baseline ensemble — `restrictionPlanner.ts` always builds its own plain
  hex-only cache (no road graph passed in), enforced structurally rather than
  by a runtime flag, because `blockedEdges` is keyed by hex edges and a
  road-graph shortcut could otherwise skip past a blocked one undetected. A
  recommended road block can never be silently bypassed by the very mechanism
  meant to make movement more realistic.

  **Min-cut** (`minCutBarrier.ts`, `computeRoadNetworkMinCut`): a SEPARATE
  max-flow problem run directly over the road graph's own nodes/edges,
  reusing the identical, already-proven `ResidualGraph`/`bfsAugmentingPath`
  machinery unchanged. Targets a real road segment — often narrower than a
  hex — rather than a whole hex boundary, using the same
  `HIGHWAY_CAPACITY_TIER` table step 38 introduced. Wired in as
  `roadNetworkBarrier`, alongside (not replacing) the existing hex `barrier`,
  since the two answer genuinely different questions (all ground vs.
  road-network specifically) for the same profile.

  **Not done this pass, stated**: no new Mapbox map layers, GIS export
  attributes, or AI-briefing text for `roadNetworkBarrier` — it's computed,
  logged, and carried on the result type, real smaller follow-up work to
  surface it visually.

  10 new tests (`roadGraphMixedAdjacency.test.ts`): a deliberately extreme
  two-hex fixture with zero hex adjacency and no intermediate hex cells
  proves movement is impossible without the road graph and 100% successful
  with it, at the exact independently-computed travel time; the safety gate
  is proven directly; min-cut correctness is checked by BFS over the
  post-cut graph (not just a plausible-looking cut value), plus capacity
  tiering, parallel-path summing, and impassable-edge exclusion. Full
  existing suite still green; `tsc`/build clean. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42b.

- **2026-07-28 — Road-graph fusion extended: ensemble tie-break + min-cut
  class-tiered capacity (step 38)**: continuation of step 36's stated
  remainder, picked as the next roadmap item after PR #198 merged. Two
  bounded, honest fixes — NOT the full "genuinely mixed hex+road-graph
  adjacency" rewrite the roadmap item calls for, which this project's own
  discipline (avoid a confidently-wrong shortcut on a core algorithm) has now
  twice flagged as too risky to attempt in one pass.

  (1) The movement ensemble's per-step logic still walks hex-to-hex, but at a
  genuine junction where two or more `onTrail` hex neighbours are candidates,
  the old generic road-affinity term can't tell them apart — every onTrail
  step looked equally "on the network". The box-free road-graph route already
  knows, via exact-geometry A*, which fork is fastest. New
  `preferredRouteKeys` option (`movementSimulation.ts`) gives a small, fixed
  60s pull toward those cells — small enough to sit below the smallest
  road-affinity base (150s), sharpening a fork decision without overriding
  the ensemble's own stochastic spread. Threaded through the existing
  worker-boundary plumbing into both the baseline ensemble and
  `restrictionPlanner.ts`'s re-runs (kept identical across all of them, so a
  restriction's measured effect is never confounded by the bias changing
  between runs).

  (2) Min-cut's flat `TRAIL_CAPACITY_MULTIPLIER = 3` (every mapped trail
  treated as identical capacity) replaced with `HIGHWAY_CAPACITY_TIER`, keyed
  off the same real, sourced `nearestTrailTags.highway` classification the
  road-class speed model already uses — a two-lane highway and a
  single-track fire trail no longer tie on cut value. Untagged trails keep
  the exact old default (3×), so nothing regresses for the common case.

  Stated, not done: neither change makes the ensemble walk the road graph's
  own edges or makes min-cut's graph road-graph-aware — both remain the same
  real, larger follow-up work step 36 already named. 6 new tests
  (`roadGraphEnsembleMinCutFusion.test.ts`) — a synthetic two-fork hex grid
  (built from real hex geometry) proves the bias shifts movement balance
  toward whichever fork is designated, in either direction; a motorway trail
  chain is proven to carry strictly more min-cut capacity than an identical
  untagged one, with an off-trail control unchanged at unit capacity. Full
  existing road/ensemble/restriction/corridor suite still green; `tsc`/build
  clean. Full detail: [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42a.

- **2026-07-28 — Corridor legibility pass: route line becomes the star, a
  real label/shape colour bug fixed (step 37)**: owner, reviewing a
  screenshot of a live run with 2 corridors present, challenged Claude to
  "pull out the corridors and different options in the screenshot without
  excellent prior knowledge." Honest attempt found only one hazy shape for
  two labelled corridors, and one label floating over ground with no
  visible feature nearby at all.

  Root causes traced in the actual paint properties, not just the image:
  (1) the corridor's own representative route — the single least-ambiguous
  shape a corridor has, a real drawn line — rendered at 0.8px width,
  near-white, 40% opacity: effectively invisible at any normal zoom.
  (2) The outline had `line-blur: 0.4` on a 2px line — a smudge, not a
  boundary. (3) **A real, live bug**: the corridor map label's text colour
  (`styles-tactical.css`) was still on the OLD red/amber rank palette from
  before the corridor SHAPE colours were moved to blue/violet/cyan
  specifically to stop colliding with the trafficability heatmap's own
  NO-GO/SLOW-GO colours — the label was simply never updated when that fix
  shipped, so rank 1's text was the exact same red as a NO-GO hex while its
  shape on the map was blue. (4) Trafficability and every corridor layer
  share one global opacity slider, so raising either raises both.

  Offered 4 concrete fixes; owner selected 3 (declined splitting the shared
  opacity slider as more structural than needed right now). Shipped: route
  line now casing+core (dark 6px under a rank-coloured 3px core, full
  opacity — same pattern already used for recommended-restriction lines);
  outline de-blurred and widened 2px→3px; map label gained a numbered,
  rank-coloured badge and its text colour now matches the shape palette
  exactly, closing the collision bug. `corridorRoutesForMap` (App.tsx) had
  to start carrying each route's own `rank`/`id` — previously stripped to
  bare `{ path }`, so the map had no way to colour-match a route line to its
  owning corridor, and a naive index correlation would have silently
  desynced the moment any corridor lacked a representative route (the array
  is filtered before mapping).

  Presentation-only: `tsc`/build clean, untouched corridor-logic tests
  (clustering, path/polygon smoothing) still pass, but actual rendered
  legibility needs the live preview to confirm — stated, not claimed
  verified in this sandbox, same limitation every prior visual-only change
  in this doc has carried. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §43.

- **2026-07-28 — Road-graph route fused into chokepoint/corridor analysis
  (step 36)**: owner proposed a hex grid aligned to the road network at a
  fine width (~50m), coarser elsewhere for cross-country, so passable roads
  would show up cleanly and cross-country corridors could fill in around
  them — "roads are known good... why not just complete the grid over the
  top of them", asked to be challenged if wrong.

  Challenged and redirected: a hex grid, even a fine one aligned to roads,
  is still a quantized approximation subject to the exact slope-averaging
  failure step 35 just fixed. The box-free road-graph search (Slice A,
  already shipped) already solves this better — it routes over the road's
  EXACT OSM/Mapbox vertex geometry, zero quantization. The owner's real
  instinct ("treat roads specially, let cross-country fill in around them")
  is already that module's own philosophy (docs §35: "roads are a network;
  hexes are a tessellation"), just implemented as a graph, not a grid.

  The genuine gap: that road-graph route was ADDITIVE — a separate display
  alongside the hex search — never counted by chokepoint ranking or
  corridor-band clustering, which only ever saw hex-grid routes. This was
  already the tracked "fuse road-graph routes" roadmap item. Fixed (the
  chokepoint/corridor half of it): `roadRouteToDissimilarRoute` (new,
  `roadRouteSearch.ts`) converts the road route into the same shape the
  hex-optimiser's k routes and the ensemble's tracks already use — resampled
  to 64 evenly-spaced points first (real road waypoint spacing is very
  uneven, and the corridor code samples by index fraction assuming roughly
  even spacing), then snapped onto the caller's own hex grid. Folded into
  both corridor-building calls in `mobilityAppreciation.ts`, so chokepoints
  and corridor bands now count the real road route as a genuine avenue.

  Stated, not attempted this pass: the movement ensemble's own per-step
  logic still walks hex-to-hex with a road-affinity bias, not the road
  graph's literal edges; min-cut is still hex-adjacency-only. Both need a
  genuinely mixed hex+road-graph adjacency across several core search
  primitives — real, larger follow-up work, not silently claimed as done.
  6 new tests (`roadRouteFusion.test.ts`); full existing road/corridor/
  chokepoint suite still green; `tsc`/build clean. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §42.

- **2026-07-28 — Mapbox-tile road fallback widened to Terrain Mobility
  (step 34)**: live-testing near Lake George, owner reported a real, signed
  highway along the shoreline painted NO-GO end to end by the terrain
  overlay, then asked the sharper diagnostic question directly: "we can
  literally see the road network on the underlying map tiles? is that data
  present or is it just an image?" Answer: real, queryable vector geometry —
  `mapboxTrails.ts` already adds the Mapbox Streets v8 source as an
  invisible, always-queryable layer (zero extra network, no CORS, works
  offline once cached) and has been the first-tried source for the
  fire-break optimizer for a while. The gap was narrower than "no data at
  all": this shortcut was restricted to the fire-break `'highway'` kind and
  never applied to Terrain Mobility's `'highway-mobility'` kind, for two
  real reasons — the class filter excluded motorway/trunk, and the tileset
  carries no surface/tracktype/smoothness tags.

  Root-caused with this same session's own evidence: earlier console output
  (this exact testing session) showed the backend Overpass proxy 502-ing for
  `kind=highway-mobility`, then every direct Overpass mirror failing
  CORS/timeout. With zero road data, `onTrail` is false for every cell, so
  the mapped-road exemption the hydrology/vegetation gates already give a
  road never fires — and the hard slope/cross-slope gates in
  `mobilityCost.ts` have NO such exemption at all, applying regardless of
  `onTrail`. A narrow, engineered lake-edge shelf between a steep hillside
  and the water reads as NO-GO from raw DEM alone, exactly matching the
  screenshot.

  Fixed: `mapboxTrails.ts` gained `MOBILITY_CLASSES` (motorway/trunk/primary
  included) alongside the existing `REUSABLE_CLASSES`, queried from the SAME
  underlying layer and filtered per call rather than maintaining two Mapbox
  GL layers; a `MAPBOX_CLASS_TO_OSM_HIGHWAY` table translates Mapbox's
  bucketed classes (`street` covers OSM residential/unclassified/
  living_street alike) to a real OSM tag so the speed-by-class table gets an
  honest entry instead of its generic untagged-track fallback.
  `infrastructureService.ts`'s `LocalTrailProvider` gained a `kind`
  parameter; the Mapbox-first shortcut now covers `'highway-mobility'` too
  (never `'water'` — no waterway geometry in Mapbox's schema). Stated cost:
  a way sourced this way gets a highway-class-only speed ceiling, no
  surface/tracktype/smoothness refinement — strictly better than the
  failure mode it fixes. 6 new tests (`mapboxTrailsMobility.test.ts`) against
  a stubbed Mapbox GL map; full existing road/infrastructure suite still
  green; `tsc`/build clean. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §40.

- **2026-07-28 — Small-AOI detour padding, profile-scaled (step 33)**: owner
  reported that a short (~1-2km) hill crossing never considered an equally
  short, genuinely viable detour 1-2km north or south — the search box
  (`computePaddedBounds`, §35) is sized proportionally to the direct
  origin↔objective span, so a short trip gets proportionately short padding
  regardless of whether a much better route sits just outside it. Confirmed
  with the owner before implementing: a literal "1-2 hours of travel"
  padding floor, uncapped, since the existing distance-scaled cell budget
  (step 25) already coarsens hex resolution rather than exploding cell count
  as the resulting box grows — this doesn't reintroduce the large-AOI
  performance problem from step 32.

  `minDetourPadM(profile)` (mobilityGrid.ts) derives extra room, metres each
  side, from the mover profile's own sourced `roadSpeedKmh` over a 1-hour
  budget — a vehicle at 60 km/h gets ~60km of floor room, foot at 5 km/h
  gets ~5km, matching the owner's own framing ("foot would be quite
  constrained compared to vehicles"). Threaded through `computePaddedBounds`
  as an additional `Math.max()` term (default 0, fully backward compatible)
  and wired in from `mobilityAppreciation.ts`'s first search attempt where
  the profile is already resolved; only binds when the direct span is short
  enough that the existing proportional term would otherwise fall short —
  long-range runs are unaffected. 6 new tests (`detourPadScaling.test.ts`);
  full existing padded-bounds/frontier-growth/cell-budget/road-routing suite
  still green; `tsc`/build clean. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §39.

- **2026-07-28 — Cloud-offload design scoping + mobility run telemetry
  (step 32)**: continuing a conversation about why Terrain Mobility runs feel
  slow on some devices and fast on others (owner: "my snapdragon ultra does
  quite well on large areas, my hp elitebook grinds... hard to give a
  definitive answer myself"). Owner asked for three things: whether the
  offline-first premise still buys much given elevation/veg already need
  network; what infrastructure would support cloud offload for the slow
  cross-country search (Static Web Apps + Functions vs. Container Apps vs.
  an on-demand container for big jobs only); and to start logging real
  per-run metadata now rather than guess a threshold.

  Scoped, not built speculatively: a three-tier model — client Worker stays
  the default (interactive iterate loop, §14.1's latency reasoning still
  holds), a same-algorithm Function-hosted tier is the cheap next step for
  runs too big for a comfortable client experience but inside a Function's
  timeout, and an on-demand Container Apps Job is reserved for genuine
  outliers only, gated on tier-2 evidence. Explicitly did NOT build tiers
  2–3 this pass — a fixed cell-count cutoff can't account for the device
  variance that started this conversation, so telemetry has to exist first.

  What DID ship: `POST /api/mobility-telemetry` (new, `telemetry`-tagged
  rate limit, Azure Table Storage) and `webapp/src/terrain/mobilityTelemetry.ts`,
  wired into every completed `runMobilityAppreciation` call in `App.tsx`.
  Records cell counts, the GO/SLOW-GO/NO-GO split, a per-vegetation-kind
  histogram (the actual terrain/veg difficulty breakdown), origin↔objective
  distance, elapsed time per run stage (grid/sampling/search/ensemble/
  corridors/chokepoints/barrier), and coarse device hints
  (`hardwareConcurrency`/`deviceMemory`) — deliberately no location, no
  identity, fire-and-forget so it can never affect the run it's reporting on.

  Mid-scoping, owner asked directly whether the road-routing idea from
  earlier in the conversation had been dropped. It hadn't been designed away
  — checking the code found Slice A's `roadRouteSearch.ts` already gives a
  fast, box-free vehicle route independent of the slow hex-grid search, so
  it was never the bottleneck this section is about. Did find one real,
  previously unflagged gap: that road route currently waits on the same
  grid-sampling pass instead of being computed in parallel and surfaced
  first, which is the genuine remainder of the original "instant road result
  while the area analysis runs" ask — tracked as its own small Next-up item,
  independent of the cloud-offload work. Full detail:
  [ROUTE_INTELLIGENCE.md](docs/ROUTE_INTELLIGENCE.md) §38.

- **2026-07-28 — OSM water relations, picked ahead of queue order for 1.0
  demo risk (step 31)**: owner: *"one more push then we're done for a 1.0
  demo. Pick the item that is the most critical for that purpose."* Rather
  than defaulting to the roadmap's own smallest-effort-first item, assessed
  which open item was most likely to bite LIVE in the demo — and confirmed,
  via a direct Overpass query (not assumption), that **Lake Tuggeranong and
  Gungahlin Pond, both in the same Canberra region this project's own test
  scenarios (Lake George, M23, Sutton, Bywong) already live in, are mapped
  as OSM `relation`, not `way`.** `fetchCorridorWaterways`'s query only ever
  requested `way["natural"="water"]`, so either lake — or any other
  multipolygon water body — would have repeated the exact "water doesn't
  block movement" bug class this whole pass had been chasing (the Lake
  George road-crossing fix, and the original padding defect before it),
  live, in front of the exact geography likely to be demoed.

  Fixed in BOTH `webapp` and `api` (the two packages' Overpass query
  constants are already kept in explicit lock-step via "MUST match"
  comments — this followed the same discipline): the water query now also
  requests `relation["natural"="water"]`; confirmed live that Overpass's
  `out geom` inlines each member way's own geometry directly on the
  relation element, no separate recursion query needed; each `outer`-role
  member becomes its own water-body trail. Stated, deliberate scope cut:
  multi-part outer rings aren't re-stitched into one polygon and `inner`
  (island) members aren't subtracted as holes — both are safe directions to
  be wrong in for a hard-block gate (worst case an island cell is
  over-conservatively treated as water; never a false crossing).

  8 new tests (4 in the API package's `infrastructure.test.ts`, 4 in the
  webapp's new `waterRelations.test.ts` — the latter proves the parsed
  relation trail actually gates a point via `distanceToNearestWater`, the
  same function the hex-grid search's own water classification calls, not
  just that the query/parsing shape looks right). Full regression green in
  both packages; tsc/build clean in both.

- **2026-07-28 — Corridor band outline smoothing (step 30)**: direct
  roadmap follow-on to step 29 (smallest-effort-first ordering). The band's
  own outline (`mobility-corridor-edge`) is a real `@turf/union` of the
  corridor's hex cells — genuine, not approximated — but still traced the
  hex tessellation's own blocky edge at close zoom. `polygonSmoothing.ts`
  (new) applies Chaikin corner-cutting to every ring of the dissolved
  geometry, correctly handling both `Polygon` (incl. holes) and
  `MultiPolygon` shapes a union can produce. Deliberately a different
  algorithm from step 29's route-line smoothing (moving-average, anchored at
  fixed endpoints) — a closed ring has neither endpoints nor a
  locked/snapped-to-trail concept, so every vertex is treated cyclically.

  Caught a real test-methodology trap before it shipped a false-negative
  test: summed turning angle (the measure that worked for open routes in
  step 29) is near-invariant under Chaikin on a closed rectilinear ring —
  each 90° corner splits into two ~45°(-ish) turns rather than the total
  shrinking. Switched to the MAXIMUM single-corner turn, which does capture
  it correctly (measured: 90° → 63° → 34° → 18° over 3 passes on a test
  fixture).

  9 new tests (`polygonSmoothing.test.ts`); full regression green (only the
  pre-existing, unrelated live-data `nvis-fidelity.test.ts` fails);
  tsc/build clean.

- **2026-07-28 — Corridor route rendering consolidated to one refined line
  per corridor (step 29)**: owner: *"the individual white lines of the
  considered paths don't work as a visualisation. Because of the hex grid
  they end up being 'triangles' between the grid centres and they don't
  follow the road geometry... consolidated to show substantive differences
  in the pathways / corridors, not show that every piece of ground has been
  considered... I'd expect to see the 2-5 clear corridors outlined and
  shaded appropriately over the top of the ground... reduce the analysis
  noise and show insights rather than raw thinking."*

  Was drawing up to 24 raw, un-refined route polylines (a sample of the full
  k-dissimilar analysed set) regardless of how many corridors they'd
  actually clustered into. `Corridor` (`corridorField.ts`) gains
  `representativeRoute` — the single fastest analysed route that actually
  uses that corridor, derived from the same list `fastestTravelSeconds`
  already comes from (guaranteed consistent by construction, not
  re-derived). `App.tsx` now draws exactly ONE line per corridor — 2-5,
  matching the owner's own target — refined through `pathRefinement.ts`,
  reused unchanged from the fire-break optimizer rather than reimplemented:
  snap onto a nearby mapped road where the route genuinely follows one.

  Owner's live follow-up — *"there may not always be a road to snap to,
  noting some corridors may be overland"* — caught a real gap before it
  shipped: snapping alone only ever fixes the ON-ROAD portion, leaving an
  overland stretch's raw hex-centre zig-zag untouched. Added
  `smoothFreeVertices` and an opt-in `cornerSmoothingIterations` option to
  `pathRefinement.ts` (default 0 — the fire-break optimizer's own existing
  behaviour is unchanged unless it opts in): a moving-average pass over
  vertices NOT snapped to a road, so an overland stretch reads as a smooth
  line too, while a genuinely road-following stretch still snaps onto the
  road exactly rather than being blurred off it.

  9 new tests (`pathSmoothing.test.ts` ×8, plus 2 in
  `corridorClustering.test.ts`); full regression green (only the
  pre-existing, unrelated live-data `nvis-fidelity.test.ts` fails);
  tsc/build clean. Not attempted: smoothing the corridor BAND's own outline
  (a real hex-union, not the reported complaint) — tracked separately in
  Next up.

- **2026-07-28 — Progress-bar dead zones fixed + road graph gets real water
  awareness (steps 27, 28)**: two live field reports.

  (1) Owner: *"the 'progress' indicator stopped well before the result
  loaded in with a long 'nothing' time... the map [should start] getting
  visual results being loaded as it happens. I'd love to see pathways
  snaking across the landscape from the get go."* Three real bugs found by
  direct inspection: the Dijkstra search reported NOTHING while it ran (now
  fixed — real `best.size/cells.length` progress, throttled, threaded
  through the Worker); a retry's sampling progress replayed from zero
  (visible rewind); the ensemble worker call's internal 'restrictions'
  phase could already report past a LATER hard-coded checkpoint (another
  visible rewind, since `planRestrictions` runs inside the same worker
  message handler as the ensemble, before either resolves). Fixed
  generally with a monotonic guard around the whole run's `onProgress`
  (a value at/below the high-water mark is dropped) rather than chasing
  each numeric handoff by hand. A new `onPartialResult` callback surfaces
  the real reachability field + cheapest route the moment the search
  settles — well before the ensemble/corridors/chokepoints/min-cut that
  follow — wired straight into `App.tsx`'s existing `mobilityResult` state
  (every consumer already treats corridors/ensemble/chokepoints/barrier as
  nullable, so no new rendering path was needed).

  (2) Owner: *"ran straight across the lake which should based on data be a
  hard block due to water. (No 'has boats' option for unit movement)."*
  Investigated properly rather than guessed: fetched the REAL Lake George
  OSM way live, confirmed it's a well-formed `way` (not the suspected
  `relation` gap), and proved the hex-grid search already routes around it
  correctly. Root cause was specific to the box-free VEHICLE road route
  (§35 Slice A): `roadGraph.ts`/`roadRouting.ts` had zero water logic at
  all. Fixed: a contiguous run of a road way's edges through a mapped water
  body's interior longer than a plausible bridge span (250 m) is flagged
  and blocked for any profile without enough fording capability (same 2.5 m
  assumed depth the hex grid already uses) — a short genuine bridge stays
  passable.

  10 new tests (`searchProgress.test.ts` ×6, `roadWaterCrossing.test.ts` ×4
  — the latter built against the real, live-fetched Lake George geometry).
  Full regression green (only the pre-existing, unrelated live-data
  `nvis-fidelity.test.ts` fails); tsc/build clean.

- **2026-07-27 — Movement corridors collapsing into one + corridor colour
  collision (step 26)**: owner, live-testing a west↔east Lake George
  crossing with two visibly distinct east-shore/west-shore detour tracks on
  the map: *"it only generated 1 corridor, we need two minimum...
  Consider how corridors and alternative pathways are explored and
  identified."* Root cause: every route between the same compact
  origin/objective necessarily shares cells at both ends, so the old
  single-pass adjacency segmentation always found the two shores'
  routes "connected" through those shared endpoints and merged them.

  Fix: cluster routes BEFORE spatial segmentation, then run
  density/smoothing/segmentation per cluster. First attempt (Jaccard
  cell-set overlap) proved inadequate on a synthetic two-gap test fixture —
  same-avenue route pairs scored as low as 0.09-0.20 Jaccard, barely
  separable from genuinely cross-avenue pairs (0.00-0.08). Replaced with
  spatial proximity: sample each route's lat/lng at three progress
  fractions (25/50/75%), require ALL THREE within `7 × hexWidthM` of the
  corresponding sample on another route to cluster them together —
  calibrated against the fixture to a clean, non-overlapping margin (worst
  same-avenue pair ~273m, best-separated cross-avenue pair ~449m).

  Also fixed: owner separately flagged *"the corridors need to be a colour
  other than red. The red, amber, green is used for the hex to show pass
  ability so the corridor in red makes it look like it's picking the
  hardest route!"* — confirmed corridor rank-1/2 colours were byte-identical
  to the NO-GO/SLOW-GO trafficability heatmap colours; moved corridors to a
  blue/violet palette in `MapboxMapView.tsx` and `MobilityLegend.tsx`,
  leaving chokepoint/barrier/restriction reds (a different semantic —
  denial, not corridor identity) untouched.

  4 new tests (`corridorClustering.test.ts`); full regression green (only
  the pre-existing, unrelated live-data `nvis-fidelity.test.ts` fails);
  tsc/build clean. Not done this pass: the owner's separate progress-bar/
  streaming-visualization request — tracked in Next up.

- **2026-07-27 — Distance-scaled cell budget + analysis-depth selector
  (step 25)**: owner, after confirming the Lake George fix: *"Work out a
  sensible scaling of the cell budget for distance noting big areas should
  take longer. Let the user select a scale of something like 'quick' to
  'fine' for analysis depth. Processing half the country for a few minutes
  is perfectly acceptable once we have the data locally. This is processing
  on their device still?"* — confirmed yes: the whole search
  (`mobilityWorker.ts` — Dijkstra, k-dissimilar routes, movement ensemble,
  chokepoints, min-cut) runs in a Web Worker in the user's OWN browser tab;
  only source data (elevation/vegetation/roads/water) crosses the network.

  `TARGET_CELL_COUNT`/`MAX_HEX_CELLS` were fixed constants (2200/2800)
  regardless of AOI size — a continental run got the identical budget as a
  2km local one, silently coarsened into huge hexes, no user control over
  the trade-off. `computeCellBudget(spanM, fidelity)` (new) scales the
  target SUB-LINEARLY (sqrt of the distance ratio, not linear/area-
  proportional — that would demand millions of cells at continental range)
  with the real origin↔objective distance, per a `quick`/`standard`/`fine`
  tier — each with its own base count, growth rate, AND hard ceiling
  (quick 5,000 / standard 12,000 / fine 50,000 cells), so a country-scale
  'fine' run is a deliberate, bounded choice matching the owner's own "a
  few minutes is acceptable", not an unbounded accident. 'standard' at
  short range (<=10km) reproduces the original fixed budget almost exactly
  — no behaviour change for a typical local analysis. New "ANALYSIS DEPTH"
  selector in the Terrain panel; re-running at a different tier IS the
  "user can re-run with more or less cells" control the owner asked for —
  no separate mechanism needed.

  7 new tests (`cellBudgetScaling.test.ts`); full regression green;
  tsc/build clean.

- **2026-07-27 — Slice B (scoped) was STILL broken; found and fixed live
  against the real Lake George (step 24)**: owner live-tested step 23's
  expand-and-retry fix against the actual Lake George and got a ~227 m
  corridor that stopped short. Root cause: the retry only scaled the
  MULTIPLIER (0.2→4.0), but the base quantity it multiplied — `(axis span)
  * factor` — was still broken exactly like the original defect. For a
  due-EAST crossing, origin and objective sit at nearly the same latitude,
  so `maxLat - minLat` is just the two painted blobs' own thickness (tens of
  metres); multiplying a near-zero number by any factor stays near-zero. The
  retry mechanism never actually gave the search real north–south room.

  Fixed properly this time, via three owner-guided iterations in one
  session: (1) `computePaddedBounds` now targets a SQUARE box whose side is
  a multiple of the REAL distance between origin and objective centroids
  (haversine), not either axis's own incidental span — proven against the
  actual Lake George coordinates to clear the full 28 km extent on the
  FIRST attempt, no retry needed. (2) `frontierTouchedEdges`/
  `growBoundsTowardFrontier` (new) — if a search still fails, the retry now
  reads back WHICH edge of the box the reachable frontier actually touched
  and extends specifically that side, rather than a fresh uniform box each
  time ("if it still hits the edge then it loads a new tile from the point
  of where it hit. Repeat until we get there" — owner). (3) Confirmed via
  code trace (not assumed) that the primary path already blends road and
  cross-country by actual cost (every vehicle profile has a nonzero
  `crossCountryFactor`), a separate road-only route exists for vehicles
  (step 22), and up to 14 distinct routes get bundled into ranked corridor
  bands via the existing iterative-penalty k-dissimilar search.

  Also fixed: `mobilityGrid.ts`'s "never an empty seed set" fallback used to
  pick an arbitrary array-index cell when a small paint patch failed the
  15% area-overlap threshold on a coarse grid — now picks the cell nearest
  the painted area's own centroid. Also patched `import.meta.env` crashing
  outside Vite in 9 more modules (same guard pattern as before) so the new
  tests can actually run standalone.

  13 new tests (`paddedBoundsLakeGeorge.test.ts` including the exact real
  Lake George coordinates, `frontierEdgeGrowth.test.ts`); full regression
  green; `tsc`/`npm run build` clean.

- **2026-07-27 — Slice B (scoped) shipped: the Lake George defect fixed for
  off-road/foot movement too (step 23)**: owner: "Keep going with slice a
  and b." §35's Slice B design is a genuinely large rearchitecture (lazy
  per-cell materialisation under an A* frontier, async tile-ring data
  fetching inside what has to stay a synchronous worker search, a proper
  `α·C*` cost-budget ellipse, corridor-count termination) — several existing
  modules (`demDerivatives.ts`'s neighbour plane fit, `corridorField.ts`,
  chokepoints, min-cut) currently assume `cells` is a complete, finished
  array for the whole AOI, so a rushed version of that architecture risked
  shipping something that looked like Slice B but subtly broke one of those
  invariants — worse than a smaller, fully-verified fix, given this whole
  codebase's "never present fabricated data as real analysis" principle.

  Shipped instead — the actual behavioural defect fix, decoupled from the
  architecture: `buildMobilityGrid` takes a `boundsPadFactor` (still 0.2 by
  default); `mobilityAppreciation.ts` retries the full grid-build-then-search
  sequence at escalating factors (`0.2 → 0.6 → 1.5 → 4.0`) whenever a search
  finds no route, stopping the instant one is found. A normal run pays
  nothing extra; only a genuinely Lake-George-shaped run pays for the wider
  resample, and the log says so explicitly at each step, plus an honest
  final "no route after N attempts" if even the widest one fails — directly
  answering the owner's own framing of the original bug ("there is no way"
  vs "I wasn't allowed to look far enough"). Reuses 100% of the existing,
  already-proven search engine — zero new invariant risk.

  Proven at the engine level, matching `lakeGeorgeRoadRouting.test.ts`'s own
  precedent (the retry orchestration itself is network-coupled and not
  unit-testable without mocking every upstream fetch): a synthetic water
  barrier that completely blocks a narrow box but has a real gap only
  visible once widened, for a foot profile (the case Slice A's road graph
  can't answer), plus a control proving a wider box doesn't just manufacture
  routes. Along the way, fixed `import.meta.env` crashing outside Vite in
  three more modules (`logger.ts`, `elevationApi.ts`, `suiteAuth.ts` — same
  guard `infrastructureService.ts` already established) since the test
  engine's own dependency chain needed them; a fourth, unrelated pre-existing
  failure (`nvis-fidelity.test.ts`, from PR #157) remains, untouched.

  Full lazy-grid architecture recorded as genuinely open (Next-up), not
  claimed done — the DEFECT is fixed both ways now (roads via step 22,
  off-road/foot via this step); what's left is the architectural upgrade.

- **2026-07-27 — Slice A road-speed config UI shipped, AND a genuine gap
  found + fixed: road routing wasn't actually live (steps 21–22)**: owner:
  "Keep going with slice a and b." Two things happened investigating the
  config-UI item (step 21, the last item Slice A's original checklist
  named).

  First, the UI itself: `RoadSpeedOverridePanel.tsx` — an editable table for
  all four OSRM-sourced tables, per-row/global reset, a header badge showing
  how many classes are overridden, `localStorage`-persisted. The overrides
  reach the cost model as a set-once GLOBAL (`setRoadSpeedOverrides`) rather
  than a parameter threaded through the nine files between `edgeMobilityCost`
  and here — same precedent as `infrastructureService.ts`'s
  `setLocalTrailProvider`. The one real subtlety: `mobilityWorker.ts` is an
  actual Web Worker, a separate module instance with no shared memory with
  the main thread, so the global has to be set on BOTH sides — main thread
  once per run, worker once per request off a new message field.

  Second, and more consequential: while wiring this in, a repo-wide search
  for `roadGraph`/`roadRouting` usage turned up **zero** references outside
  the modules' own tests. `mobilityWorker.ts` — the only place a real run
  ever searches for a route — was still exclusively running the hex-grid
  Dijkstra, which still has the padded-box defect this whole section (§35)
  exists to fix. Put plainly: despite step 18 shipping "Slice A — road
  network graph + routing (core)" as ✅, **the live app had not actually
  fixed Lake George for vehicles** — the module was correct and proven in
  isolation, but nothing in the running product ever called it. This was a
  gap in the original design's checklist (no "wire into the live search"
  step was ever written), not a skipped implementation step.

  Fixed via `roadRouteSearch.ts` (new): builds a road graph from data
  `mobilityGrid.ts` already fetches (`roadWays`, a new field — no second
  network round-trip), snaps each painted area onto it via a new
  `nodesWithin()` (every node within 3 km, not just the nearest — a painted
  AREA has no one "correct" road-access point), and runs the existing A*.
  Wired into `mobilityAppreciation.ts` for vehicle profiles, additive
  alongside the unchanged hex-grid search, drawn on the map as its own
  amber dashed line with an honest "road access to road access, excludes
  the off-road legs" caveat in both the log and the legend. Re-proven with
  the SAME synthetic Lake George geometry `lakeGeorgeRoadRouting.test.ts`
  uses, but through `findVehicleRoadRoute` with `PaintedArea` inputs — the
  shape the app actually has — closing the exact gap this update reports,
  not just re-testing what was already proven.

  17 new/extended tests (global-override singleton behaviour, the
  live-pipeline wiring, its own Lake George + control cases). Full
  regression (60 tests across 8 files) green; `tsc`/`npm run build` clean.
  Not fused into movement simulation/corridors/chokepoints/min-cut yet
  (still hex-grid-only) — tracked as its own Next-up item rather than
  implied by this one. GIS export/AI briefing carry-through for
  `user-override` confidence also tracked separately, not done here.

- **2026-07-27 — Paint↔analysis grid reconciliation shipped (step 20)**: the
  Next-up item spawned by the painting rework above is now built.
  `mobilityGrid.ts`'s `originKeys`/`objectiveKeys` used to test each analysis
  hex's CENTRE point against the resolved painted polygon — coarse near a
  boundary, since the fixed 100m paint-hex tiling essentially never lines up
  with the analysis grid's own independently-chosen `chooseHexSize` result.
  Replaced with a real geodesic area-overlap test (`paintedOverlapFraction`/
  `isPaintedAreaMember`, using `@turf/intersect`+`@turf/area` on the actual
  lng/lat rings, no local projection needed): an analysis cell only counts as
  origin/objective once ≥15% of its own area is actually covered by the
  painted shape — the "breaking down or combining cells" reconciliation the
  owner asked for, done geometrically rather than by literally re-tiling
  either grid. `tsc --noEmit` and `npm run build` both clean.

- **2026-07-27 — Slice A shipped (step 18) and painting reworked to real hex
  cells (step 19)**: the design recorded in §35 earlier the same day is now
  built. Road graph (`roadGraph.ts`), A* routing with k-dissimilar
  alternatives reusing `corridorAnalysis.ts`'s exact iterative-penalty idiom
  (`roadRouting.ts`), and a sourced road-class speed model from the OSRM
  car/foot profiles (`roadSpeedModel.ts`) — composed via `min()` with each
  mover profile's own capability, wired into both the new road graph AND the
  existing hex-grid `onTrail` bonus (which previously gave every road the
  identical flat speed regardless of whether it was a motorway or a barely-
  passable track). `mobilityGrid.ts` now fetches the wider `highway-mobility`
  set (motorway/trunk/primary included) instead of the fire-break optimizer's
  set, which excludes them. Proven with a synthetic Lake-George-scale test:
  a road network with NO direct route, only a detour around the north end,
  correctly finds it — plus a control proving the test would fail without
  the connector, the same discipline the hydrology smoke test (§34)
  established. 42 tests across 5 files, all executed via `tsx`, all passing;
  webapp build and API suite both clean. Config UI for user-overridable
  speeds (originally scoped as part of Slice A) is tracked separately in
  Next-up — the correctness claim doesn't depend on it.

  Mid-session, owner redirected the origin/objective painting brush: "make
  the small paint a single 100m hex. Medium is 10 and large is 100. Xl is
  1000!" — replacing the zoom-relative circular dabs from the 2026-07-26
  design outright, not layering on top. `hexGrid.ts` gained `hexRing`/
  `hexSpiral` (the same hex math the analysis grid uses, per owner: "ensure
  the hex grid is the SAME hex grid for analysis and the target painting");
  `paintedArea.ts` was reworked so a dab is a real cluster of hex cells, not
  a circle, each `PaintedArea` anchoring its own local projection at its
  first dab (a single global anchor would distort ~20–25% by the time you're
  painting near Tasmania — real, not cosmetic). A literal single SIZE shared
  between painting and the analysis grid stays circular until Slice B's lazy
  grid removes the need to pre-materialise the whole analysis grid — owner's
  resolution: paint at the fixed sizes now, reconcile onto the analysis
  grid's own size by area overlap once it's chosen ("breaking down or
  combining cells"), tracked as its own Next-up item. 21 more tests (hex
  ring/spiral math, hex-cell painting incl. erase/repaint ordering and a
  far-south distortion check), all passing.

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
