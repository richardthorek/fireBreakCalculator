# GIS Interoperability & Live Context

**Status:** §1 export pack and §4 file import are ✅ **built** (July 2026, PR #163: `webapp/src/utils/gisExport.ts`, `gisImport.ts`, `components/ExportImportControls.tsx`). §4 live situational feeds are 📋 **designed with endpoints confirmed** (national DEA Hotspots + Digital Atlas boundaries, tested 2026-07-11). Avenza GeoPDF and ArcGIS Online push remain 📋 designed. AFDRS fire-danger integration is a **separate upcoming task**.
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
- Approach: server-side Azure Function (`/api/export/geopdf`) rendering a static map (Mapbox Static Images API) + geo-registration dictionary via `pdf-lib`; **spike required** to validate Avenza accepts our registration before committing.
- Fallback if spike fails: KMZ + Avenza's native KMZ import (already covered by pack above).

## 3. ArcGIS Online push
Publish a plan as a **hosted feature layer** so it appears live in agency dashboards / ArcGIS Field Maps.
- OAuth 2.0 PKCE (user signs into their own AGOL org; we store no credentials).
- REST: create feature service (or reuse a configured one) → `addFeatures` (line + segment features + plan attributes) → item metadata links back to the share-link URL.
- Scope guard: this is *push a plan*, not a sync engine. One-way, explicit user action.

## 4. Imports & live context feeds

**File import is ✅ built** (`gisImport.ts` + `ExportImportControls.tsx`): GeoJSON/KML/KMZ/GPX → user chooses "use as plan line" (replaces the drawn line, full re-analysis) or "add as map overlay" (translucent red reference layer, auto-zoom). 50k-vertex cap; unreadable files fail visibly. Live feeds below are **designed with confirmed endpoints** (endpoint testing 2026-07-11); implementation is Step 3.

**National-first (mirrors the NVIS-first decision).** Two *official, single-contract national* feeds are the spine — **DEA Hotspots** (thermal detections) and the **Digital Atlas near-real-time bushfire boundaries** (extents/perimeters). Both are Geoscience Australia products, CC BY 4.0, and browser-CORS-clean, so the frontend can call them directly behind an env var exactly like NVIS. We do **not** build a per-state incident-feed hierarchy as the primary source. Per-jurisdiction *incident warning* feeds (alert levels) are a secondary, optional overlay — see below.

| Feed | Use | Source | Coverage | Status |
|------|-----|--------|----------|--------|
| Fire perimeters / existing lines | Draw context; import a line as a plan | KML/KMZ/GeoJSON/GPX file import — covers FireMapper exports | — | ✅ built |
| **Hotspots** | Situational-awareness layer: recent satellite thermal detections | DEA Sentinel Hotspots WFS (Geoscience Australia) | **National** | 📋 endpoint confirmed |
| **NRT bushfire boundaries** | Situational-awareness layer: current fire & prescribed-burn extents | Digital Atlas of Australia — NBIC near-real-time boundaries (Geoscience Australia) | **National** (excl. NT) | 📋 endpoint confirmed |
| Incidents / warnings | Optional overlay: agency alert level per incident (AWS vocabulary) | Per-jurisdiction feeds (NSW RFS, VIC, SA CFS, …) — no single national feed | Jurisdictional aggregate | 📋 designed, phased |
| **AFDRS fire danger** | OFFICIAL rating + fire behaviour index for the plan's district/date | AFDRS/BOM published feeds. **We display the official product — we do not rebuild spread prediction** (Spark/Phoenix exist) | National | 📋 **separate next task** |

All feeds: attribution displayed, timestamps shown ("as of …"), hard fail-visible when stale/unavailable — a missing value is shown as missing, never defaulted. These are **advisory situational layers, not safety-of-life products**; the Digital Atlas metadata says so explicitly and we surface that.

> **AFDRS is deliberately out of this step.** The fire-danger rating + behaviour-index integration (and the break-adequacy heuristics keyed to it) is its own upcoming task; only the two national situational feeds + the incident-overlay design are covered here.

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

#### Incidents / warnings (jurisdictional — no national feed)

There is **no single national incidents/warnings GeoJSON**. The national layer is the **Australian Warning System (AWS)** — a *shared vocabulary* (Advice / Watch and Act / Emergency Warning + standard icons), **not a feed**. Each agency publishes its own incident feed, in varying formats and with varying CORS. Confirmed on 2026-07-11:

| Jurisdiction | Feed | Format | CORS | Status |
|---|---|---|---|---|
| NSW (RFS) | `rfs.nsw.gov.au/feeds/majorIncidents.json` | GeoJSON | `*` | ✅ reachable |
| VIC (EMV) | `emergency.vic.gov.au/public/osom-geojson.json` | GeoJSON | `*` | ✅ reachable |
| SA (CFS) | `data.eso.sa.gov.au/prod/cfs/criimson/cfs_current_incidents.json` | JSON | `*` | ✅ reachable |
| QLD (QFD) | moved to `fire.qld.gov.au` (RSS / CAP-AU) | RSS/CAP | — | endpoint drifted |
| WA (DFES) | Emergency WA (`emergency.wa.gov.au`) | JSON/other | none | needs proxy |
| TAS (TFS) | TasALERT (`alert.tas.gov.au`) | — | none | needs proxy |
| ACT (ESA) | community GeoJSON mirror (`beyondtracks/act-esa-incidents-geojson`) | GeoJSON | — | mirror |
| NT (PFES) | NT fire incident map | — | — | limited |

- **NSW RFS shape (confirmed):** GeoJSON `FeatureCollection`; geometries are `Point` **or** `GeometryCollection` (point + perimeter polygon). Properties: `title`, `category` (e.g. `"Planned Burn"`), `pubDate` (`dd/mm/yyyy h:mm:ss AM`), `guid`, `link`, plus a **`description` HTML blob** carrying the structured fields (`ALERT LEVEL`, `LOCATION`, `COUNCIL AREA`, `STATUS`, `TYPE`, `FIRE`, `SIZE`, `RESPONSIBLE AGENCY`) — must be parsed out of the HTML.
- **Design conclusion:** treat incident/warning points as a **secondary optional overlay**, phased. Start with the CORS-clean GeoJSON feeds (NSW, VIC, SA) callable direct; route the CORS-none / non-GeoJSON jurisdictions (QLD, WA, TAS, ACT, NT) through a **thin backend aggregator** (`GET /api/incidents?bbox=`) that normalises each into a common shape keyed to **AWS alert levels** and caches briefly. The two national feeds above already deliver situational awareness for v1 **without** this layer — it is an uplift, not a blocker.

## 5. Sequencing
1. Export pack (GeoJSON/KML/KMZ/SHP) — highest reach per effort, all client-side. ✅
2. File import (perimeters/lines). ✅
3. **National situational layers** — DEA Hotspots + Digital Atlas NRT bushfire boundaries, direct-from-frontend (env-var URLs, CORS-clean), attribution + "as of" + advisory caveat. *(this step)*
4. Incident/warning overlay — CORS-clean jurisdictions (NSW/VIC/SA) direct; backend aggregator for the rest, normalised to AWS levels. *(uplift, after 3)*
5. AFDRS fire-danger rating + behaviour index. **Separate task** — display official product only.
6. Avenza GeoPDF spike → ship or fall back to KMZ guidance.
7. ArcGIS Online push (OAuth + REST).

## Update policy
Update when a format, endpoint, or feed is added/changed; record confirmed endpoint structures here (as done in `NVIS_INTEGRATION.md`).
