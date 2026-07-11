# GIS Interoperability & Live Context — Design

**Status:** 📋 Designed, not built (GPX export + share-link + print briefing exist today).
**Owner doc for:** export formats, agency GIS integration (ArcGIS Online, FireMapper, Avenza), live data feeds in (AFDRS, hotspots, perimeters).

**Principle:** meet crews where they already work. A plan that can't leave the app dies in the app.

---

## 1. Universal export pack (client-side, offline-capable)

| Format | Consumers | Approach |
|--------|-----------|----------|
| GeoJSON | FireMapper, QGIS, most agency GIS | Native — serialize line + per-segment properties (chainage, grade, fuel, flags) + plan metadata |
| KML/KMZ | Google Earth, Avenza, FireMapper | Styled per slope/fuel category; briefing summary + per-segment detail in placemark descriptions; KMZ bundles a legend |
| Shapefile | Legacy agency workflows | `shp-write` (or equivalent small lib) in a lazy-loaded chunk; line + segments as features |
| GPX | Vehicle/handheld GPS | ✅ exists (`planSharing.ts`) — keep |

All exports carry data-provenance fields (`usedMockElevation`, `usedFallbackData`, per-segment `estimated`) — honesty flags must survive the round-trip.

**FireMapper compatibility** = GeoJSON/KML import (no API needed). Verify styling renders sensibly in FireMapper Pro; document the recommended import flow for brigades.

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

| Feed | Use | Source |
|------|-----|--------|
| Fire perimeters / existing lines | Draw context; import a line as a plan | KML/GeoJSON file import (drag-drop) — covers FireMapper exports |
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
