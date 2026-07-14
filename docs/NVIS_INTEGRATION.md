# Vegetation Data — Sources, Structure & As-Built

**Status:** As-built + confirmed strategy (single source of truth for vegetation data)
**Last confirmed:** 2026-07-11 (live endpoint testing from a CI-class network)
**Decision:** Standardise on **NVIS national** as the vegetation spine, with the
existing **NSW SVTM overlay** kept where it adds real fidelity. Do **not** build
a per-state service hierarchy — see [Why not per-state services](#why-not-per-state-services).

> This document supersedes the earlier state-expansion planning docs
> (`STATE_VEGETATION_DATA_SOURCES.md`, `STATE_VEGETATION_IMPLEMENTATION.md`,
> `STATE_VEGETATION_IMPLEMENTATION_STATUS.md`) and the fidelity concerns in
> `NVIS_FIDELITY_REPORT.md`. Those remain for history only.

---

## Why vegetation data matters here

Every estimate is integrated per segment along the planned line. Each segment
needs a **fuel class** — one of `grassland`, `lightshrub`, `mediumscrub`,
`heavyforest` — because a hand crew slows dramatically in heavy forest, a dozer
less so, and aircraft coverage scales with fuel. Wrong or missing fuel data
means wrong or missing estimates. A planning tool must never silently invent
fuel data, so the sourcing chain is explicit and every value is flagged with a
confidence and whether it was estimated.

## Data sources, in priority order

Vegetation for each sample point is resolved in this order by
`stateVegetationRouter.fetchStateVegetation()`, called from
`webapp/src/utils/vegetationAnalysis.ts`:

1. **NSW SVTM PCT** (`nswVegetationService.ts`) — high-fidelity Plant Community
   Type polygons, ~25 m, **NSW only**. Used where a point falls in NSW.
2. **NVIS Major Vegetation Groups** (`nvisVegetationService.ts`) — the
   Australia-wide authoritative raster (~100 m). The national spine; used
   everywhere else and wherever NSW has a gap.
3. **Mapbox Terrain v2 landcover** — coarse global landcover, last resort.
4. **Deterministic mock** — only when everything else fails; always flagged
   `estimated: true` so the UI warns the value is not real analysis.

NVIS is what turns "NSW-only real data + guesses everywhere else" into real fuel
classes across almost the whole continent.

---

## Confirmed endpoint structures

These were verified with live queries on 2026-07-11. Field names and response
shapes below are what the code parses.

### NVIS Extant MVG (national spine)

- **Service:** `https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer`
  (env-overridable via `VITE_NVIS_MVG_URL`).
- **Layer 0** is a single **Raster Layer** (`type: "Raster Layer"`), capabilities
  `Map,Query,Data`. The correct point operation is **`identify`** (not `query`);
  the service map name is *"Australia's present (extant) native vegetation"*.
- **`identify` response:** `results[0].attributes` with these keys:

  | Attribute | Meaning | Example |
  | --- | --- | --- |
  | `UniqueValue.Pixel Value` | **MVG code** as a string (1–32), or the literal `"NoData"` | `"25"` / `"NoData"` |
  | `Raster.MVG_NAME` | MVG group name | `"Cleared, non-native vegetation, buildings"` |
  | `Raster.MVG_COMMON_DESC` | plain-language description | `"cleared vegetation"` |
  | `Raster.OBJECTID` | mirrors the pixel value | `"25"` |
  | `Raster.COUNT` | pixel count for that class | `"105452596"` |
  | `Raster.SORT_ORDER` | display order | `"28"` |

- **Structural behaviours the code must account for** (confirmed by test):
  - **Ocean / data gaps** return `UniqueValue.Pixel Value = "NoData"`. This is a
    **string, not a number** — `parseInt` yields `NaN`, so it must fall through
    to the next source, never resolve to a class. `extractMVGCode` now guards the
    `NoData` sentinel *and* trusts only the explicit code/pixel-value field when
    one is present; it no longer scans incidental numeric fields (`Raster.SORT_ORDER`,
    `Raster.COUNT`), which for a `NoData` pixel would otherwise resolve to a bogus
    MVG (`SORT_ORDER "28"` → "Sea and estuaries" → grassland). The broad scan is
    kept only as a last resort for older releases that expose no code field.
  - **Outside Australia** (e.g. NZ) returns an **empty `results` array**. The
    `AUS_BBOX` short-circuit in the service handles this before the network call.
  - `extractMVGCode()` prefers pixel-value/MVG-code fields, which is why
    `"Pixel Value"` resolves ahead of the incidental `Raster.OBJECTID` mirror.

- **Classes:** 32 Major Vegetation Groups + `99` (unknown). The full authoritative
  table and per-class fuel mapping/confidence live in `MVG_CLASSES` in
  `nvisVegetationService.ts` — that is the one place to tune calibration.

- **Area sampling via `export` + `legend` (2026-07-14, not yet live-verified):**
  the corridor optimizer / area recon need fuel at hundreds–thousands of hex
  cells; per-point `identify` scales requests linearly with search area and
  would overwhelm this free service at any real corridor size (field-confirmed).
  `fetchNVISAreaRaster()` instead renders the WHOLE bbox in one request —
  `export?f=image&format=png&transparent=true&bbox=…&bboxSR=4326&imageSR=4326&size=W,H&layers=show:0`
  at the raster's native ~100 m/px (capped at 1000 px/side; coarser beyond,
  flagged) — and decodes pixel colours app-side against the service's **own
  legend** (`legend?f=json` → per-class swatch `imageData`, decoded once per
  session; labels resolved to MVG codes by leading number then name). Every
  subsequent sample is a free local pixel lookup. Safeguards: colours match
  within a small anti-aliasing tolerance or resolve to *unknown* (falls back to
  point-identify, never guesses); transparent pixels are **NoData** (honest gap,
  no wasted point query); an export whose opaque pixels match NOTHING in the
  legend is treated as contract drift and discarded, falling back to the proven
  per-point path. **Both endpoints are probed daily by the canary**
  (`scripts/canary/upstreamCanary.mjs`: legend swatch count + labels, export
  PNG signature) because this session's sandbox could not reach the live
  service — confirm the first green canary run before relying on it.
  Per-point `identify` remains the fallback chain, unchanged.

**Validation sweep (2026-07-11), one point per biome:**

| Point | MVG | Result |
| --- | --- | --- |
| Far-North QLD rainforest | 1 | Rainforests and Vine Thickets → heavyforest |
| VIC Central Highlands | 3 | Eucalypt Open Forests → heavyforest |
| NT Top End | 12 | Tropical Eucalypt Woodlands/Grasslands → grassland |
| Central Australia | 13 | Acacia Open Woodlands → lightshrub |
| Genuine VIC Mallee (Murray-Sunset/Hattah) | 14 | Mallee Woodlands and Shrublands → mediumscrub |
| WA Jarrah | 3 | Eucalypt Open Forests → heavyforest |
| WA wheatbelt / Sydney urban | 25 | Cleared, non-native → grassland |
| Tasman Sea | NoData | falls through (no fabricated class) |

The results are biome-appropriate and varied nationwide. **The earlier
"Victoria Mallee failure" in `NVIS_FIDELITY_REPORT.md` was a bad test point**
(`-36.0, 141.0` is cleared Wimmera cropland, where MVG 25 "cleared" is
*correct*); genuine Mallee returns MVG 14 as expected. NVIS national fidelity is
adequate for this tool.

### NSW SVTM PCT (NSW overlay)

- **Service:** `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer`
- **Layer 3** is a **Feature Layer** (polygon). Queried fields:
  `vegClass`, `vegForm`, `PCTName` (also present: `form_PCT`, `PCT_form`, `PCTID`, `labels`).
- **`query` response:** `features[0].attributes`. Example (Blue Mountains):
  `vegForm = "Dry Sclerophyll Forests (Shrubby sub-formation)"`,
  `vegClass = "Sydney Montane Dry Sclerophyll Forests"`,
  `PCTName = "Upper Blue Mountains Moist Forest"`.
- ~25 m fidelity, 50+ formation classes. Maps to fuel via the dynamic DB mapping
  (`vegetationMappingHelper.ts`) with a hardcoded regex fallback (`mapNSWToInternal`).
- **Area sampling via envelope `query` (2026-07-14, not yet live-verified):**
  same motivation as the NVIS export above — `fetchNSWVegetationArea()` pulls
  every PCT polygon intersecting a corridor bbox in ONE query
  (`geometryType=esriGeometryEnvelope`, `returnGeometry=true`,
  `maxAllowableOffset=0.0002` ≈ 20 m generalisation, `geometryPrecision=5`),
  classifies each feature once (same dynamic-then-heuristic chain as the point
  path), and resolves points app-side by even-odd point-in-polygon
  (`pointInRings`). If the server reports `exceededTransferLimit` the whole
  area result is discarded (sampling from a PARTIAL polygon set would
  misclassify everything the missing features covered) and the per-point path
  takes over.

---

## Using the data appropriately (the important part)

NVIS is *extant* vegetation, so it includes non-vegetation and modified classes.
Handling these honestly is what keeps estimates trustworthy:

- **Cleared / modified classes are real, not errors.** MVG 25 (cleared /
  non-native / buildings) legitimately appears over cropland, pasture and towns.
  For fire-break building this is low fuel, so mapping it to `grassland` is a
  reasonable *structural* proxy — but confidence stays modest (≤ 0.5) and these
  segments should be **visibly flagged** so a planner knows it is modified land,
  not native fuel, and can apply a local override.
- **Ambiguous/low-signal classes** — 24 (aquatic), 26 (unclassified native),
  27 (bare), 28 (sea), 99 (unknown) — carry low confidence already. Treat them as
  candidates for the override workflow rather than firm analysis.
- **`NoData` must never become a class.** Over water/gaps NVIS returns the string
  `"NoData"`; the resolver must fall through to Mapbox/mock (flagged `estimated`).
- **Confidence semantics differ by source and that's fine.** NVIS confidence =
  how cleanly an MVG maps to a fuel structure; NSW confidence = how specific the
  formation match is. Both are 0–1 and both feed the panel's overall-confidence
  and "estimated data in use" warning. Keep them on the same scale.
- **Resolution vs sampling.** NVIS is ~100 m; the analysis samples every ~200 m,
  so per-segment lookups are well matched. No oversampling benefit below ~100 m.

## Decision: web service, not self-hosted raster

We consume the DCCEEW ArcGIS REST service rather than hosting the NVIS raster.
The national product is a multi-gigabyte continental grid; self-hosting it for
per-point lookups needs either a raster/COG sampling server or a
vectorise-to-PMTiles pipeline — heavy infrastructure to run and re-do each NVIS
release, for a lightweight planning tool. DCCEEW already runs a maintained
service that answers point lookups directly, giving authoritative, always-current
data with no storage or GIS server on our side. The endpoint is a single env var
(`VITE_NVIS_MVG_URL`), so it can be repointed to a self-hosted mirror or a thin
backend proxy that speaks the same `identify`/`query` contract without a code
change. **Revisit self-hosting only if** the public endpoint's latency/availability
becomes unacceptable for interactive use, browser CORS proves unreliable across
users (add a backend proxy first — see below), or we need MVG Subgroups or offline
operation (a packaged PMTiles extract of the operating area would fit better).

## Why not per-state services

The earlier plan was to add a VIC/QLD/WA/SA/TAS/NT/ACT service hierarchy. Live
discovery on 2026-07-11 showed this buys little and costs a lot:

- **NVIS is already good and, crucially, uniform.** One contract, one mapping
  table, consistent national coverage. Per-state services each have their own
  schema, classification, projection quirks and outages to normalise and maintain.
- **The states with easy public endpoints don't give consistent national cover.**
  Confirmed reachable: QLD `Biota/RegionalEcosystemMapping` (RE + Broad Vegetation
  Groups), VIC GeoServer WFS `open-data-platform:nv2005_evcbcs` (Ecological
  Vegetation Classes), TAS `Public/NaturalEnvironmentV2` (TASVEG 5.0 + Groups).
  **Not** anonymously reachable: WA SLIP (auth-gated, 401), SA and NT (hosts did
  not resolve / no open ArcGIS path), ACT (small area). So a state hierarchy would
  *still* be NVIS across roughly half the country — the exact inconsistency it was
  meant to remove.
- **NSW is the one worthwhile overlay** and it already exists and works.

These state services are recorded here as **viable future overlays** if a specific
region ever needs sub-NVIS fidelity, but they are **explicitly out of scope** now.

| State | Best public dataset | Endpoint | Status |
| --- | --- | --- | --- |
| NSW | SVTM Extant PCT (layer 3) | `mapprod3.environment.nsw.gov.au/.../SVTM_NSW_Extant_PCT/MapServer` | **In use (overlay)** |
| QLD | Regional Ecosystems / Broad Veg Groups | `spatial-gis.information.qld.gov.au/.../Biota/RegionalEcosystemMapping/MapServer` | Deferred (reachable) |
| VIC | Ecological Vegetation Classes (EVC 2005) | `opendata.maps.vic.gov.au/geoserver/wfs` → `open-data-platform:nv2005_evcbcs` | Deferred (reachable, WFS) |
| TAS | TASVEG 5.0 / Groups | `services.thelist.tas.gov.au/.../Public/NaturalEnvironmentV2/MapServer` | Deferred (reachable) |
| WA | (Beard / pre-European via SLIP) | `services.slip.wa.gov.au` | Deferred — **auth-gated** → NVIS |
| SA | (DEW native vegetation) | no open ArcGIS path found | Deferred → NVIS |
| NT | (NR Maps vegetation) | no open ArcGIS path found | Deferred → NVIS |
| ACT | (small area) | — | NVIS is sufficient |

---

## Implementation handoff (NVIS-first)

Design is complete; the following is a small, self-contained implementation task.
None of it changes the public API or the user-facing model — it makes NVIS usage
explicit and honest.

1. ~~**Make `NoData` handling explicit and tested.**~~ ✅ **Done (2026-07-13).**
   `extractMVGCode` now guards the `"NoData"` sentinel and trusts only the explicit
   code/pixel-value field when present, so ocean/data-gap points fall through
   instead of resolving to a bogus MVG via `Raster.SORT_ORDER`/`COUNT`. Empty
   `results` arrays already fall through. Validated with a standalone Node repro
   of the extractor (the webapp package has no unit-test runner configured yet).
2. **Surface "modified/low-fidelity" segments.** Carry a boolean flag (e.g.
   `modified` / `lowFidelity`) on `StateVegetationResult` → `VegetationSegment`
   for MVG 24/25/26/27/28/99, and show it in the analysis panel ("Cleared/modified
   land — verify locally"), wired to the existing vegetation-override workflow
   (`VEGETATION_OVERRIDES.md`). This is the main "account for structure" item.
3. **Keep the NSW overlay; freeze state expansion.** Leave `stateDetection.ts`
   and `stateVegetationRouter.ts` as the NSW-overlay + NVIS mechanism. Remove the
   `// VIC/QLD/... Phase 3` TODO scaffolding so contributors don't resume it.
4. **Correct the fidelity test.** `scripts/test-nvis-fidelity.mjs` uses
   `-36.0, 141.0` for "Victoria Mallee" — that is cleared cropland. Use a genuine
   Mallee point (e.g. `-34.70, 141.20`) or replace the diversity heuristic with a
   known-truth spot check. The test currently reports a false failure.

**Acceptance criteria**

- `NoData`, ocean and out-of-Australia points never yield a non-`estimated`
  vegetation class; unit-tested.
- Cleared/modified segments are visibly flagged and eligible for override.
- No new per-state services; NVIS is the national spine; NSW overlay retained.
- Fidelity test no longer reports the false Victoria failure.

## Verifying it works

```bash
# NVIS identify at a point (lng,lat)
curl "https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/NVIS_ext_mvg/MapServer/identify?f=json&geometry=149.13,-35.28&geometryType=esriGeometryPoint&sr=4326&layers=all:0&tolerance=1&mapExtent=149.12,-35.29,149.14,-35.27&imageDisplay=400,400,96&returnGeometry=false"

# NSW SVTM PCT query at a point (lng,lat)
curl "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer/3/query?f=json&geometry=150.30,-33.70&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=vegClass,vegForm,PCTName&returnGeometry=false"
```

Look for an MVG code (`1..32`) in `UniqueValue.Pixel Value` / an MVG name in the
NVIS attributes; look for `vegForm`/`vegClass`/`PCTName` in the NSW attributes.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_NVIS_MVG_URL` | NVIS MVG ArcGIS MapServer base URL. Repoint to a mirror/proxy if needed. | DCCEEW public NVIS Extant MVG MapServer |

## Possible next step: backend proxy (not yet built)

If direct browser calls to the government hosts prove flaky (CORS, throttling),
add a thin Azure Functions endpoint (`GET /api/vegetation?lat=&lng=`) that runs
the NSW → NVIS lookup server-side and caches results in Table Storage. The
frontend would call our own origin (no CORS) and we would gain a shared cache and
a single place to swap in a self-hosted raster later. It is the recommended first
escalation before self-hosting the raster.
