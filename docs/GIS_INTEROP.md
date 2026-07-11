# GIS Interoperability & Live Context

**Status:** §1 export pack and §4 file import are ✅ **built** (July 2026, PR #163: `webapp/src/utils/gisExport.ts`, `gisImport.ts`, `components/ExportImportControls.tsx`). Avenza GeoPDF, ArcGIS Online push and live feeds remain 📋 designed.
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

**File import is ✅ built** (`gisImport.ts` + `ExportImportControls.tsx`): GeoJSON/KML/KMZ/GPX → user chooses "use as plan line" (replaces the drawn line, full re-analysis) or "add as map overlay" (translucent red reference layer, auto-zoom). 50k-vertex cap; unreadable files fail visibly. Live feeds below remain designed:

| Feed | Use | Source |
|------|-----|--------|
| Fire perimeters / existing lines | ✅ Draw context; import a line as a plan | KML/KMZ/GeoJSON/GPX file import — covers FireMapper exports |
| **AFDRS fire danger** | Show the OFFICIAL rating + fire behaviour index for the plan's district/date | AFDRS/BOM published feeds. **We display the official product — we do not rebuild spread prediction** (Spark/Phoenix exist). Break-width adequacy heuristics may reference the AFDRS fuel-type behaviour indices, doctrine-cited |
| Hotspots | Situational awareness layer | DEA Hotspots API (Geoscience Australia) |
| Incidents | Situational awareness layer | NSW RFS "Fires Near Me" GeoJSON feed (public, attribution required) |

All feeds: attribution displayed, timestamps shown ("ratings as of …"), hard fail-visible when stale/unavailable — a missing rating is shown as missing, never defaulted.

## 5. Sequencing
1. Export pack (GeoJSON/KML/KMZ/SHP) — highest reach per effort, all client-side.
2. File import (perimeters/lines) + AFDRS rating display.
3. Avenza GeoPDF spike → ship or fall back to KMZ guidance.
4. ArcGIS Online push (OAuth + REST).
5. Hotspots / Fires Near Me layers.

## Update policy
Update when a format, endpoint, or feed is added/changed; record confirmed endpoint structures here (as done in `NVIS_INTEGRATION.md`).
