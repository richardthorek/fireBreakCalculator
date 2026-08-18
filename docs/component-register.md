# Component Register

**Last Updated**: August 3, 2026
**Purpose**: Machine-readable catalog of all React components
**Update Policy**: MUST update when components are added, modified, or removed

This is a **living document** that should be kept synchronized with the codebase. It enables quick navigation and understanding of the component architecture.

---

## Core Application Components

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| App | `webapp/src/App.tsx` | None | Root application component, main layout orchestrator, fire-break/Terrain Mobility mode switch | MapboxMapView, AnalysisPanel, MobilityPanel, IntegratedConfigPanel |
| MapboxMapView | `webapp/src/components/MapboxMapView.tsx` | `{ onDistanceUpdate, onAnalysisComplete, ... }` | Map container, drawing controls, geospatial calculations | mapbox-gl, @mapbox/mapbox-gl-draw |
| AnalysisPanel | `webapp/src/components/AnalysisPanel.tsx` | `{ distance, terrainData, vegetationData, ... }` | Fire-break results display panel, equipment recommendations | DistributionBar, HelpContent, LiveFeedsControl, OverlapMatrix |
| IntegratedConfigPanel | `webapp/src/components/IntegratedConfigPanel.tsx` | `{ isOpen, onClose, ... }` | Configuration sidebar with tabbed interface | EquipmentConfigPanel, VegetationConfigPanel |
| AccountControl | `webapp/src/components/AccountControl.tsx` | `{ onSessionChange, onLoadPlan, plansVersion }` | Header suite account control: Station Manager sign-in/out, saved-plan list (load/delete); hidden unless `VITE_SUITE_AUTH_URL` set | suiteAuth util, savedPlansApi util, lucide-react |
| MapEmptyState | `webapp/src/components/MapEmptyState.tsx` | `{ initialLocationSettled, distance, tacticalMode?, mobilityStarted? }` | Sidebar call-to-action guiding a new user to the right tool, mode-aware (fire-break: draw a line; Terrain: paint an area); auto-hides once the user has started or dismisses it | None |

## Configuration Components

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| EquipmentConfigPanel | `webapp/src/components/EquipmentConfigPanel.tsx` | `{ onEquipmentUpdate, ... }` | Equipment CRUD operations, inline editing | SearchControl |
| VegetationConfigPanel | `webapp/src/components/VegetationConfigPanel.tsx` | `{ onVegetationUpdate, ... }` | Vegetation mapping configuration, hierarchy management | None |
| SearchControl | `webapp/src/components/SearchControl.tsx` | `{ onSearch, searchMode, ... }` | Equipment search with three modes | None |

## Display Components

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| OverlapMatrix | `webapp/src/components/OverlapMatrix.tsx` | `{ terrainData, vegetationData, ... }` | Terrain/vegetation distribution matrix | None |
| DistributionBar | `webapp/src/components/DistributionBar.tsx` | `{ data: DistributionDatum[], ... }` | Horizontal stacked-share bar (vegetation/slope distribution) shared across result tables | None |
| HelpContent | `webapp/src/components/HelpContent.tsx` | None | Static instructions for drawing a fire-break line and using map navigation, shown before a line exists | None |
| LiveFeedsControl | `webapp/src/components/LiveFeedsControl.tsx` | `{ viewBounds, onData }` | Toggles for national/jurisdictional live incident feeds (hotspots, fire boundaries), per-source status and "as of" attribution | liveFeeds util |

## Route Intelligence Components (July 2026 UI overhaul)

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| ElevationProfile | `webapp/src/components/ElevationProfile.tsx` | `{ trackAnalysis, vegetationAnalysis, onHoverChainage }` | Interactive SVG elevation/slope/fuel profile with map-synced hover | chainage util, categories |
| SegmentBreakdown | `webapp/src/components/SegmentBreakdown.tsx` | `{ trackAnalysis, vegetationAnalysis, onLocate, activeRange }` | Joined per-segment chainage table with map locate | chainage util |
| AdvisorPanel | `webapp/src/components/AdvisorPanel.tsx` | `{ assessment, optimizerStatus/result, onOptimize/Apply/Dismiss, onLocate }` | Plan Assistant: ranked insight cards + route optimizer compare/apply | planInsights, routeOptimizer |
| ExportImportControls | `webapp/src/components/ExportImportControls.tsx` | `{ exportInput, onImportAsPlan, onAddOverlay, overlayCount, onClearOverlays }` | GIS export menu (GeoJSON/KML/KMZ/SHP/GPX) + file import dialog | gisExport, gisImport, fflate, @mapbox/shp-write |
| AiAssistantCard | `webapp/src/components/AiAssistantCard.tsx` | `{ payload: AssistantPayload \| null }` | AI briefing generator + grounded chat, source-badged (ai/template/unavailable), citation chips | assistantApi |
| IncidentBoxPanel | `webapp/src/components/IncidentBoxPanel.tsx` | `{ active, onActiveChange, drawingActive, onDrawingActiveChange, drawnPerimeter, onBoxRingChange, mapCenter }` | Incident box tool: get a fire perimeter (draw or import) → wind + rate-of-spread inputs → conservative standoff box → pathfound corridor + build-time estimate | windService, incidentBoxPlanner, incidentBoundaryImport |

## Terrain Mobility Components

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| MobilityPanel | `webapp/src/components/MobilityPanel.tsx` | `{ profileId, onProfileChange, nightMode, roadSpeedOverrides, fidelity, boxRole, originPaint, objectivePaint, brushSize, ... }` (fully controlled — App.tsx owns all state) | Terrain Mobility mode's main panel: paint origin/objective areas, pick a mover profile, run the multi-source movement search, show results | AssessmentLog, DataConfidenceBadge, RoadSpeedOverridePanel, TacticalCoordinateReadout |
| CounterMobilityPanel | `webapp/src/components/CounterMobilityPanel.tsx` | `{ measures?, barrierSegments, pendingSegmentIndex, placements, ... }` (controlled, mirrors MobilityPanel's convention) | Counter-mobility planner: candidate barrier placements sited off the min-cut hint (`MinCutResult.segments`), scored against the delay ledger | DataConfidenceBadge |
| AssessmentLog | `webapp/src/components/AssessmentLog.tsx` | `{ lines: string[], running?, title? }` | Scrolling append-only run log for Terrain Mobility's tactical skin, auto-scrolls, optional blinking cursor while running | None |
| DataConfidenceBadge | `webapp/src/components/DataConfidenceBadge.tsx` | `{ tier: ConfidenceTier, label? }` | Small pill communicating a displayed number's trust tier (measured/published/estimated/generic-fallback) | None |
| RoadSpeedOverridePanel | `webapp/src/components/RoadSpeedOverridePanel.tsx` | `{ overrides, onOverridesChange }` | Editable table for the four OSRM-sourced road-speed tables (highway/surface/tracktype/smoothness); editing a row flips it to `user-override` confidence | roadSpeedModel util, localStorage |
| TacticalCoordinateReadout | `webapp/src/components/TacticalCoordinateReadout.tsx` | `{ lat, lng }` | Cursor/point location readout as decimal degrees, DMS, and a UTM-derived grid reference (explicitly labelled UTM, not full NATO MGRS) | UTMLatLng |
| MobilityLegend | `webapp/src/components/MobilityLegend.tsx` | `{ present, overlayOpacity, onOverlayOpacityChange }` | Terrain-mode map key — lists only the layers currently drawn, marks modelled-behaviour vs ground-property entries, single overlay-opacity slider | None |
| MobilityAssistantCard | `webapp/src/components/MobilityAssistantCard.tsx` | `{ payload: MobilityAssistantPayload \| null }` | One-shot AI appreciation briefing for Terrain Mobility results, source-badged, briefing-only (no chat) | mobilityAssistantApi |
| MobilityExportControls | `webapp/src/components/MobilityExportControls.tsx` | `{ exportInput: ExportMobilityInput \| null }` | GIS export menu (GeoJSON/KML/KMZ) for a Terrain Mobility appreciation — corridors, chokepoints, min-cut barrier, counter-measure placements | mobilityGisExport, gisExport (downloadBlob), planSharing (downloadFile) |
| MobilityBackendJobPanel | `webapp/src/components/MobilityBackendJobPanel.tsx` | `{ originPaint, objectivePaint, profileId, nightMode, fidelity }` | Manual tier-2 backend job trigger (OCOKA 5) — submits + polls a mobility job on the separate `api-mobility` Function App; renders nothing unless `VITE_MOBILITY_API_BASE_URL` is set (unset in every deployment pre-cutover) | mobilityJobApi, mobilityJobClient |

Supporting logic: `shared/terrain/src/chainage.ts` (chainage ↔ coordinate), `webapp/src/utils/segmentJoin.ts` (shared slope×fuel join), `webapp/src/utils/planInsights.ts` (rule-based assessment), `shared/terrain/src/hexGrid.ts` (pointy-top axial hex math), `webapp/src/utils/routeOptimizer.ts` (hexagonal 3-pass least-cost pathfinding over DEM + NVIS/NSW samples + OSM trails), `webapp/src/utils/infrastructureService.ts` (Overpass corridor query), `webapp/src/utils/gisExport.ts` / `gisImport.ts` (GIS interop), `webapp/src/utils/xmlScan.ts` (bounded XML scanner for KML/GPX import — not DOMParser), `webapp/src/utils/assistantApi.ts` (AI assistant client, payload builder, graceful degrade), `shared/terrain/src/movementSimulation.ts` (probabilistic movement ensemble — road-preferring, boundedly-rational movers; ASSUMED behaviour parameters, flagged `behaviourModelled`; per-mover seeded RNG since OCOKA 2, `docs/ROUTE_INTELLIGENCE.md` §38.1), `shared/terrain/src/restrictionPlanner.ts` (recommended restrictions, ranked by re-simulating with each candidate emplaced), `webapp/src/terrain/dataLayers/deaWaterObservationsService.ts` (DEA Water Observations — point query + a colour-ramp-reconstructed WMS area raster for the hydrology gate), `shared/terrain/src/mobilityCost.ts`'s `estimateFordingRequirement` (Tier 0 fording-depth gate, water's counterpart to `estimateStructureFromVegetation`), `webapp/src/terrain/mobilityTelemetry.ts` (fire-and-forget scale/performance telemetry per completed mobility run — no location/identity — feeding the cloud-offload threshold design, `docs/ROUTE_INTELLIGENCE.md` §38). Most pure terrain/mobility algorithm modules now live in `shared/terrain/src` (`@firebreak/terrain`, OCOKA 2, `docs/ROUTE_INTELLIGENCE.md` §38.1) rather than `webapp/src/terrain` — see that section for the full move/stay list.

## Planned Components (from Roadmap)

| Component | Purpose | Status | Target | Related Issue |
|-----------|---------|--------|--------|---------------|
| ConfirmDialog | Confirmation dialogs for destructive actions — `webapp/src/components/ConfirmDialog.tsx` exists (WCAG 2.1 AA: ARIA roles, focus trap, Enter/Escape) but is not imported anywhere yet | 🔧 Built, not wired in | Q2 2026 | Issue 1.1 |
| Button | Standardized button component with variants | 📋 Planned | Q2 2026 | Issue 2.2 |
| Skeleton | Loading skeleton placeholders | 📋 Planned | Q2 2026 | Issue 2.3 |
| Toast | Toast notification component | 📋 Planned | Q2 2026 | Issue 3.1 |
| ToastContainer | Toast notification manager | 📋 Planned | Q2 2026 | Issue 3.1 |
| DrawingHelpOverlay | Drawing gesture help overlay | 📋 Planned | Q2 2026 | Issue 3.2 |
| PresetManager | Equipment preset management | 📋 Planned | Q3 2026 | Issue 3.4 |
| KeyboardShortcuts | Keyboard shortcuts modal | 📋 Planned | Q3 2026 | Issue 4.2 |
| ThemeToggle | Dark/light mode toggle | 📋 Planned | Q3 2026 | Issue 4.3 |

---

## Update Instructions

When adding/modifying a component:
1. Add/update row in appropriate table above
2. Include accurate path, props interface summary, and purpose
3. List key dependencies (other components or libraries)
4. Commit changes with component changes

When removing a component:
1. Remove row from table
2. Note removal in master_plan.md Recent Updates section
3. Commit changes with component removal

---

**Maintained By**: All contributors
**Format**: Markdown tables (easily parseable by tools)
