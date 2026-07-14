# GIS Interoperability & Live Context

**Status:** §1 export pack and §4 file import are ✅ **built** (July 2026, PR #163: `webapp/src/utils/gisExport.ts`, `gisImport.ts`, `components/ExportImportControls.tsx`). §4 live situational feeds — national (DEA Hotspots, Digital Atlas boundaries) + jurisdictional incidents (NSW/VIC/SA/WA/ACT) — are ✅ **built** (2026-07-12: `liveFeedsService.ts`, `liveFeedLayers.ts`, `LiveFeedsControl.tsx`). QLD/TAS/NT incidents remain unavailable (no CORS-clean feed found); documented below for follow-up. Avenza GeoPDF and ArcGIS Online push remain 📋 designed. AFDRS fire-danger integration is **blocked on a sourcing decision** (the official rating is access-gated, not just unbuilt) — see the assessment in §4.
**Owner doc for:** export formats, agency GIS integration (ArcGIS Online, FireMapper, Avenza), live data feeds in (AFDRS, hotspots, perimeters).

**Principle:** meet crews where they already work. A plan that can't leave the app dies in the app.

---

## 1. Universal export pack (client-side, offline-capable) — ✅ built

| Format | Consumers | As built |
|--------|-----------|----------|
| GeoJSON | FireMapper, QGIS, most agency GIS | Route feature + per-segment features (chainage, grade, slope category, fuel, confidence, `estimated_data`) + plan metadata (`gisExport.ts#toGeoJSON`) |
| KML/KMZ | Google Earth, Avenza, FireMapper | Slope-category line styles; briefing summary + per-segment detail in placemark descriptions; visible ⚠️ block when estimated data present; KMZ zipped via `fflate` |
| Shapefile (.zip) | Legacy agency workflows | `@mapbox/shp-write`, lazy-loaded; booleans coerced to 0/1 for DBF |
| GPX | Vehicle/handheld GPS | Pre-existing (`planSharing.ts`), surfaced in the same Export menu |

All exports carry data-provenance fields (`estimated_elevation_data`, `estimated_vegetation_data`, per-segment `estimated_data`) — honesty flags survive the round-trip. Exported segments come from the same `segmentJoin.ts` join the panel table renders, so files match the screen exactly.

**FireMapper compatibility** = GeoJSON/KML import (no API needed). Still to do: verify styling in FireMapper Pro on a real device and document the brigade import flow.

## 2. Avenza-ready georeferenced PDF
Geospatial PDF (ISO 32000 georegistration) of the plan map + briefing panel so any phone with the free Avenza app can navigate the line offline with GPS.
> Distinct from the **plain SMEACS briefing PDF** planned in [AI_ASSISTANT.md](AI_ASSISTANT.md) §5.4 (client-side, static map image, no georegistration) — that one is a hand-off document, this one is a navigation product. Access-line features (`role: access`, [ROUTE_INTELLIGENCE.md](ROUTE_INTELLIGENCE.md)) will be carried by all §1 export formats when built.
- Approach: server-side Azure Function (`/api/export/geopdf`) rendering a static map (Mapbox Static Images API) + geo-registration dictionary via `pdf-lib`; **spike required** to validate Avenza accepts our registration before committing.
- Fallback if spike fails: KMZ + Avenza's native KMZ import (already covered by pack above).

## 3. ArcGIS Online push
Publish a plan as a **hosted feature layer** so it appears live in agency dashboards / ArcGIS Field Maps.
- OAuth 2.0 PKCE (user signs into their own AGOL org; we store no credentials).
- REST: create feature service (or reuse a configured one) → `addFeatures` (line + segment features + plan attributes) → item metadata links back to the share-link URL.
- Scope guard: this is *push a plan*, not a sync engine. One-way, explicit user action.

## 4. Imports & live context feeds

**File import is ✅ built** (`gisImport.ts` + `ExportImportControls.tsx`): GeoJSON/KML/KMZ/GPX → user chooses "use as plan line" (replaces the drawn line, full re-analysis) or "add as map overlay" (translucent red reference layer, auto-zoom). 50k-vertex cap; unreadable files fail visibly.

**National-first (mirrors the NVIS-first decision), ✅ built 2026-07-12.** Two *official, single-contract national* feeds are the spine — **DEA Hotspots** (thermal detections) and the **Digital Atlas near-real-time bushfire boundaries** (extents/perimeters). Both are Geoscience Australia products, CC BY 4.0, and browser-CORS-clean, so the frontend calls them directly behind an env var exactly like NVIS (`liveFeedsService.ts`). We did **not** build a per-state incident-feed hierarchy as the primary source. Per-jurisdiction *incident/warning* feeds are a secondary overlay, symbolised with Australian Warning System–style triangle icons (`liveFeedLayers.ts`) — built for the CORS-clean jurisdictions (NSW, VIC, SA, WA, ACT); QLD/TAS/NT are documented but not wired in (see the per-jurisdiction table below). `LiveFeedsControl.tsx` is the toggle/status panel (per-source ✓/✗, "as of" timestamps, attribution, explicit "no feed yet" list for uncovered states).

| Feed | Use | Source | Coverage | Status |
|------|-----|--------|----------|--------|
| Fire perimeters / existing lines | Draw context; import a line as a plan | KML/KMZ/GeoJSON/GPX file import — covers FireMapper exports | — | ✅ built |
| **Hotspots** | Situational-awareness layer: recent satellite thermal detections | DEA Sentinel Hotspots WFS (Geoscience Australia) | **National** | ✅ built |
| **NRT bushfire boundaries** | Situational-awareness layer: current fire & prescribed-burn extents | Digital Atlas of Australia — NBIC near-real-time boundaries (Geoscience Australia) | **National** (excl. NT) | ✅ built |
| Incidents / warnings | AWS-symbolised overlay: agency alert level per incident | Per-jurisdiction feeds (NSW RFS, VIC EMV, SA CFS, WA DFES, ACT ESA) — no single national feed | 5/8 jurisdictions | ✅ built |
| Incidents / warnings — QLD, TAS, NT | Same, once a usable feed is found | See per-jurisdiction table below | 3/8 jurisdictions | 📋 not covered — endpoint drifted/blocked/ToS-restricted |
| **AFDRS fire danger** | OFFICIAL rating + fire behaviour index for the plan's district/date | AFDRS/BOM published feeds. **We display the official product — we do not rebuild spread prediction** (Spark/Phoenix exist) | National | 📋 **separate next task — see assessment below** |

All feeds: attribution displayed, timestamps shown ("as of …"), hard fail-visible when stale/unavailable — a missing value is shown as missing, never defaulted. These are **advisory situational layers, not safety-of-life products**; the Digital Atlas metadata says so explicitly and we surface that in the panel caveat.

> **AFDRS is deliberately out of this step**, per explicit direction: don't rebuild fire-behaviour prediction, AFDRS already owns that. See the standalone assessment at the end of this section for what a "display the official product" integration actually requires, and the one open question that needs a decision before building it.

### Confirmed endpoint structures (endpoint testing 2026-07-11)

Verified with live queries from a CI-class network. Field names and shapes below are what a client parses.

#### DEA Hotspots — national thermal detections

- **Service (WFS 2.0, GeoServer):** `https://hotspots.dea.ga.gov.au/geoserver/wfs`
  — `GetCapabilities`/`DescribeFeatureType` fast; **CORS-enabled** (reflects `Origin`). Licence **CC BY 4.0**, fees NONE, attribution *"© Commonwealth of Australia (Geoscience Australia)"*.
- **Layers:** use **`public:hotspots_three_days`** (pre-filtered to the last 3 days; **93,549 features nationally** on the test day, fast). `public:hotspots` is the full archive and **cannot be scanned unfiltered — an unbounded `GetFeature` times out**; always constrain by `bbox` (and/or a `datetime` `CQL_FILTER`). The plan-area query pattern
  `…&request=GetFeature&typeNames=public:hotspots_three_days&outputFormat=application/json&count=N&srsName=EPSG:4326&bbox=minLat,minLon,maxLat,maxLon,urn:ogc:def:crs:EPSG::4326`
  returns in ~60 ms. `outputFormat=application/json` yields GeoJSON with `numberReturned`/`numberMatched`.
- **Key attributes** (`hotspots_three_days`): `datetime` (ISO-8601 Z), `satellite` (`HIMAWARI-9`, `SUOMI NPP`, MODIS platforms, …), `sensor` (`AHI`, `VIIRS`, …), `temp_kelvin`, `power` (MW; **`-1` is a no-value sentinel** on geostationary AHI, not a real reading), `confidence` (number, e.g. `50`), `accuracy` (**string** describing sensor footprint, e.g. `"± 0.375km"` VIIRS vs `"± 2km"` Himawari), `hours_since_hotspot` (float), `australian_state` (**nullable**), `fire_category_name` (nullable), `product`/`process_algorithm`.
- **Structural behaviours a client must account for:**
  - A hotspot is a **detection, not a fire** — geostationary Himawari gives frequent coarse (± 2 km) points; polar VIIRS/MODIS give sparse fine (± 0.375 km) points. Style/label by `sensor`+`accuracy`; never present a hotspot as a confirmed active fire.
  - `power = -1` and null `australian_state`/`fire_category_name` are normal — treat as "unknown", do not coerce to 0/default.
  - Recency: filter/sort on `datetime`; show "as of" per the most recent detection in view.

#### Digital Atlas NRT bushfire boundaries — national extents

- **Service (ArcGIS FeatureServer):** `https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Near_Real_Time_Bushfire_Boundaries_view/FeatureServer`
  (Digital Atlas of Australia item `8b28109ce26b43b8968a3c9baa608f43`, owner `aus_digitalatlas`). Capabilities `Query,Extract`; `maxRecordCount` 1000; **`f=geojson` supported**; **CORS `*`**. Licence **CC BY 4.0**, access **Open**, classification **OFFICIAL**.
- **Layers:** **layer `3` "Extents"** (polygon) is the one to use — **467 features nationally** on the test day. Layer `4` "Location Points" (point) was effectively empty (1 feature) — ignore. Layer ids are **3 and 4, not 0/1**.
- **Fields** (layer 3): `fire_id`, `fire_name`, `fire_type` (`"Current Burnt Area"` \| `"Prescribed Burn"` \| null), `ignition_date`, `capt_date`, `capt_method`, `area_ha`, `perim_km`, `state`, `agency`, `date_retrieved`. **All date fields are epoch-milliseconds** (e.g. `capt_date = 1783755300000`), not ISO — convert on read.
- **Structural behaviours:**
  - **Coverage is national but jurisdiction-dependent** — the product contains every state/territory **except NT** (per metadata), and the mix is seasonal: the test-day set was VIC-heavy (winter prescribed burns), which is expected, not a gap. Do not infer "no fires elsewhere" from a light day.
  - Provenance is per-feature (`agency`, `state`, `capt_date`, `capt_method`) — surface it; a boundary captured days ago must show its `capt_date`.
  - Scientific product, **not for safety-of-life** — display that caveat.

#### Incidents / warnings (jurisdictional — no national feed) — ✅ 5/8 built

There is **no single national incidents/warnings GeoJSON**. The national layer is the **Australian Warning System (AWS)** — a *shared vocabulary* (Advice / Watch and Act / Emergency Warning + standard icons), **not a feed**. Each agency publishes its own incident feed, in varying formats and with varying CORS. Confirmed 2026-07-11, re-verified 2026-07-12 (WA's status corrected — a working CORS-clean API exists, superseding the earlier "needs proxy" note):

| Jurisdiction | Feed | Format | CORS | Status |
|---|---|---|---|---|
| NSW (RFS) | `rfs.nsw.gov.au/feeds/majorIncidents.json` | GeoJSON | `*` | ✅ built |
| VIC (EMV) | `emergency.vic.gov.au/public/osom-geojson.json` (gzip-compressed response) | GeoJSON | `*` | ✅ built |
| SA (CFS) | `data.eso.sa.gov.au/prod/cfs/criimson/cfs_current_incidents.json` | JSON array | `*` | ✅ built |
| WA (DFES) | `api.emergency.wa.gov.au/v1/incidents` + `/v1/warnings` | JSON | `*` | ✅ built |
| ACT (ESA) | `esa.act.gov.au/feeds/currentincidents.xml` | GeoRSS | `*` | ✅ built |
| QLD (QFD) | S3-hosted `publiccontent-gis-psba-qld-gov-au.s3.amazonaws.com/.../bushfireAlert.json` reachable, CORS `*`, but coordinates are **EPSG:3857** (Web Mercator), not WGS84 — needs a projection step our other parsers don't | GeoJSON (EPSG:3857) | `*` | 📋 not covered — reprojection needed, see below |
| TAS (TFS) | No working public endpoint found (`alert.tas.gov.au` 404s on guessed paths, `fire.tas.gov.au` 403s) | — | — | 📋 not covered — no reachable endpoint found |
| NT (PFES) | `pfes.nt.gov.au/incidentmap/json/warnings.json` reachable, CORS `*`, but is **BOM fire-danger-rating area warnings, not incident points** (no lat/lng per record — `area_code`/`area_name` only) and its own `note` field says *"do not use, scrape or re-publish this file"* | JSON (non-standard, ToS-restricted) | `*` | 📋 not covered — wrong data shape + explicit no-republish notice |

- **NSW RFS shape:** GeoJSON `FeatureCollection`; geometries are `Point` **or** `GeometryCollection` (point + perimeter polygon). Properties: `title`, `category` (e.g. `"Planned Burn"`), `pubDate` (`dd/mm/yyyy h:mm:ss AM`), `guid`, `link`, plus a **`description` HTML blob** carrying the structured fields (`ALERT LEVEL`, `LOCATION`, `COUNCIL AREA`, `STATUS`, `TYPE`, `FIRE`, `SIZE`, `RESPONSIBLE AGENCY`) — parsed out of the HTML with a regex (no HTML is ever rendered as HTML — see security note below).
- **VIC EMV shape:** GeoJSON; the response is **gzip-compressed regardless of `Accept-Encoding`** — a plain `fetch().json()` handles this transparently in a browser, but a raw `curl` needs `--compressed`. `feedType` splits into `incident` / `warning` / `burn-area` (skip `burn-area` — it duplicates the national NRT boundaries layer). Properties: `sourceOrg`, `category1`/`category2`, `status`, `name`, `sizeFmt`, `created`/`updated` (ISO), `action`. Warning level lives in `category1` for `feedType:"warning"` rows (values seen: `"Advice"`).
- **SA CFS shape:** plain JSON **array** (not GeoJSON) of incidents; `Location` is a `"lat,lng"` string that must be split and parsed (empty string for some records — skip). `Date`/`Time` are separate DD/MM/YYYY + HH:mm fields. `Level` is CFS's internal response level, not an AWS warning level — mapped to plain `'incident'` rather than guessed at an AWS category.
- **WA DFES shape:** two endpoints — `/v1/incidents` (`incidents[]`, `incident-status`, `incident-type`) and `/v1/warnings` (`warnings[]`, AWS level encoded in `entitySubType`, e.g. `"warnings_bushfire--advice"` → `advice`). Coordinates are usually `location.{latitude,longitude}`, with a `geo-source.features[0].geometry` fallback for some records. Both fetched in parallel per refresh; one endpoint failing doesn't block the other (`Promise.allSettled`).
- **ACT ESA shape:** GeoRSS (`<item><georss:point>lat lng</georss:point>...`), not GeoJSON — parsed with the existing bounded, namespace-blind `xmlScan.ts` (never `DOMParser`, per the CodeQL fix in `gisImport.ts`; untrusted feed XML gets the same treatment as untrusted import files). Structured fields live in a `description` text blob (`Status: …`, not HTML-escaped like NSW's).
- **Security note:** every jurisdiction's free-text fields (titles, descriptions, statuses) are rendered into map popups using `textContent`/`createTextNode` only (`liveFeedLayers.ts`) — never `innerHTML` — since these are untrusted third-party strings.
- **Why QLD/TAS/NT are out:** each has a *specific, documented* blocker rather than "didn't get to it" — QLD needs an EPSG:3857→4326 reprojection the other five parsers don't (small effort, but a different code path — do it as its own follow-up rather than bolting a one-off transform into the shared parser); TAS has no reachable public endpoint from two guessed URL families (a documented `alert.tas.gov.au` API may exist behind auth or an undocumented path — needs a human to find TFS's actual public feed, if one exists); NT's only reachable JSON is danger-rating-area warnings (not incidents) carrying an explicit "do not scrape or re-publish" notice — respecting that, not routing around it.
- **Design outcome:** 5 of 8 jurisdictions built directly from the frontend (all are CORS `*`, so no backend aggregator was needed after all — the originally-designed `GET /api/incidents?bbox=` proxy turned out to be unnecessary for every reachable feed). `LiveFeedsControl.tsx` lists NSW/VIC/SA/WA/ACT with live status and explicitly names QLD/TAS/NT as **not covered** in its panel, so a quiet gap in one part of the country is never mistaken for "no incidents there."

### AFDRS fire-danger assessment (2026-07-12) — **stopped, needs a sourcing decision**

Explicit brief for this item was: display the *official* AFDRS rating/behaviour-index product only, no spread-model rebuild — and if that official product turns out to need "a full prediction API," stop and flag it rather than build a workaround. That is exactly what happened, one step earlier than expected: **the official rating itself isn't openly available, before spread prediction even enters the picture.**

What was checked, live, the same way the other feeds in this section were verified:

1. **The public-facing AFDRS site (`afdrs.com.au`) is a rendered webpage only.** Fetched and read directly — no mention of an API, developer docs, data feed, or web service anywhere on it; it points the public to TV/radio/apps/state-agency websites, not to machine-readable data.
2. **BOM does publish machine-readable FDR products** — 1-day, 4-day, 7-day Fire Danger Rating, and the Forest Fire Danger Index (ADFD) — listed in BOM's data catalogue. But every one of them is **gated behind BOM's Registered User program** (`reg.bom.gov.au`), described as a **cost-recovered service** typically granted to **Emergency Management agencies** — not a self-serve public API/key. This is a licensing/access-control barrier, not a documentation gap.
3. **Checked whether any state agency republishes FDR as open data**, the way NSW/VIC/SA/WA/ACT do for incidents (which all turned out CORS-clean with no agreement needed). Nothing found: NSW's public `sixmaps/RFS` ArcGIS service (the one plausible lead a search surfaced) turned out to be topographic/cadastral layers, not fire-danger data, when queried live. No other state exposed an equivalent.
4. **This is a materially different situation from hotspots/boundaries/incidents above.** Those are genuinely open data (CC BY, `access: Open`, no registration) that just needed discovering and testing. AFDRS's official rating product is licensed/access-controlled at the source — more endpoint-hunting won't change that.

**Nothing was built for Step 3a.** No scraping, no reverse-engineering an internal Fire Danger Viewer API, no rebuilding a rating model from raw weather+fuel inputs — all of that would either violate the access control this gate represents or contradict "display the official product, don't rebuild it." Per your instruction, this is the point to stop and hand back the decision, not push through with a workaround.

**Options, not a recommendation you're locked into:**

| Option | What it takes | Result |
|---|---|---|
| **(a) Apply for BOM Registered User access** | An org-level application to BOM (likely a cost-recovery agreement; eligibility criteria unconfirmed for a non-agency applicant) | Turns this into a normal "display the official product" build, same shape as hotspots/boundaries above |
| **(b) Deeper per-state search** | This session did one targeted pass per state, not exhaustive — a state RFS/CFA/QFES/etc. portal could still have an open FDR layer that didn't surface via search | Possible free path if one exists; unconfirmed |
| **(c) Third-party redistributor** | Find a commercial or partner feed that already holds BOM registered-user access and redistributes it | Needs its own licence/cost check; not investigated |
| **(d) Descope to heuristics without a live rating** | Not recommended — contradicts the "display the official product" brief; would mean inventing a substitute rating, the exact thing this task exists to avoid |

Recommend (a) as the standard path — it's how other AFDRS-consuming apps get this data — but who applies, under what name, and what it costs is an organisational call, not something resolvable from inside this session.

## 5. Sequencing
1. Export pack (GeoJSON/KML/KMZ/SHP) — highest reach per effort, all client-side. ✅
2. File import (perimeters/lines). ✅
3. **National situational layers** — DEA Hotspots + Digital Atlas NRT bushfire boundaries, direct-from-frontend (env-var URLs, CORS-clean), attribution + "as of" + advisory caveat. ✅
4. Incident/warning overlay, AWS-symbolised — NSW/VIC/SA/WA/ACT direct from the frontend (all turned out CORS-clean; no backend aggregator needed). ✅ (5/8; QLD/TAS/NT tracked as follow-ups with specific blockers, see above)
5. AFDRS fire-danger rating + behaviour index. **Blocked on a sourcing decision, not effort** — the official rating is access-gated (BOM Registered User program), not just undocumented; see the assessment above. Nothing to build until that's resolved.
6. Avenza GeoPDF spike → ship or fall back to KMZ guidance.
7. ArcGIS Online push (OAuth + REST).

## 6. Export provenance, datum & disclaimer — ✅ built (Step 8)
Every export and briefing now carries three things so a plan can't be misread once it leaves the app (single source: `webapp/src/config/provenance.ts`):
- **Reproducibility stamp** — `estimate_engine_version` (`ENGINE_VERSION`), `app_version`, `generated_utc`, `data_sources`, and `cost_basis`. The estimate model is tuned over time, so the same line produces different numbers across releases; the stamp ties an output to a specific engine. Bump `ENGINE_VERSION`/`ENGINE_UPDATED` (and the API mirror in `api/src/services/provenance.ts`) whenever the production model changes.
- **Datum** — `coordinate_reference_system: WGS84 (EPSG:4326)` in GeoJSON/KML/GPX properties. Shapefile relies on `@mapbox/shp-write`'s default WGS84 `.prj`. This pre-empts the GDA94↔GDA2020 question from agency GIS teams (the offsets are ~1.8 m — noise for break widths, but declare it).
- **Standing disclaimer** — `DISCLAIMER_LONG` ("planning aid, not an operational tasking; verify on the ground") in GeoJSON/KML/GPX/print/SMEACS. Present unconditionally, not just when data is estimated. DBF text fields cap at 254 chars, so the Shapefile path truncates the long strings (they survive in full in GeoJSON/KML).

Where it's surfaced: `gisExport.ts` (`planProperties` spreads `provenanceProperties()`; KML description), `planSharing.ts` (GPX `<desc>`, print-briefing footer), `smeacsBriefingBuilder.ts` + `smeacsTextRenderer.ts` + `smeacsPdfBuilder.ts` (briefing `disclaimer`/`provenance` fields), and the analysis panel (`plan-disclaimer` line).

## Update policy
Update when a format, endpoint, or feed is added/changed; record confirmed endpoint structures here (as done in `NVIS_INTEGRATION.md`). When the estimate model changes, bump `ENGINE_VERSION` in both provenance files (§6).
