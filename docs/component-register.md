# Component Register

**Last Updated**: July 11, 2026
**Purpose**: Machine-readable catalog of all React components
**Update Policy**: MUST update when components are added, modified, or removed

This is a **living document** that should be kept synchronized with the codebase. It enables quick navigation and understanding of the component architecture.

---

## Core Application Components

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| App | `webapp/src/App.tsx` | None | Root application component, main layout orchestrator | MapboxMapView, AnalysisPanel, IntegratedConfigPanel |
| MapboxMapView | `webapp/src/components/MapboxMapView.tsx` | `{ onDistanceUpdate, onAnalysisComplete, ... }` | Map container, drawing controls, geospatial calculations | mapbox-gl, @mapbox/mapbox-gl-draw |
| AnalysisPanel | `webapp/src/components/AnalysisPanel.tsx` | `{ distance, terrainData, vegetationData, ... }` | Results display panel, equipment recommendations | EquipmentResults, OverlapMatrix, GuidancePanel |
| IntegratedConfigPanel | `webapp/src/components/IntegratedConfigPanel.tsx` | `{ isOpen, onClose, ... }` | Configuration sidebar with tabbed interface | EquipmentConfigPanel, VegetationConfigPanel |

## Configuration Components

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| EquipmentConfigPanel | `webapp/src/components/EquipmentConfigPanel.tsx` | `{ onEquipmentUpdate, ... }` | Equipment CRUD operations, inline editing | SearchControl |
| VegetationConfigPanel | `webapp/src/components/VegetationConfigPanel.tsx` | `{ onVegetationUpdate, ... }` | Vegetation mapping configuration, hierarchy management | None |
| SearchControl | `webapp/src/components/SearchControl.tsx` | `{ onSearch, searchMode, ... }` | Equipment search with three modes | None |

## Display Components

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| EquipmentResults | `webapp/src/components/EquipmentResults.tsx` | `{ results, ... }` | Equipment analysis results table | None |
| OverlapMatrix | `webapp/src/components/OverlapMatrix.tsx` | `{ terrainData, vegetationData, ... }` | Terrain/vegetation distribution matrix | None |
| GuidancePanel | `webapp/src/components/GuidancePanel.tsx` | `{ showHelp, ... }` | Help and instructions content | None |

## Route Intelligence Components (July 2026 UI overhaul)

| Component | Path | Props Interface | Purpose | Key Dependencies |
|-----------|------|-----------------|---------|------------------|
| ElevationProfile | `webapp/src/components/ElevationProfile.tsx` | `{ trackAnalysis, vegetationAnalysis, onHoverChainage }` | Interactive SVG elevation/slope/fuel profile with map-synced hover | chainage util, categories |
| SegmentBreakdown | `webapp/src/components/SegmentBreakdown.tsx` | `{ trackAnalysis, vegetationAnalysis, onLocate, activeRange }` | Joined per-segment chainage table with map locate | chainage util |
| AdvisorPanel | `webapp/src/components/AdvisorPanel.tsx` | `{ assessment, optimizerStatus/result, onOptimize/Apply/Dismiss, onLocate }` | Plan Assistant: ranked insight cards + route optimizer compare/apply | planInsights, routeOptimizer |
| ExportImportControls | `webapp/src/components/ExportImportControls.tsx` | `{ exportInput, onImportAsPlan, onAddOverlay, overlayCount, onClearOverlays }` | GIS export menu (GeoJSON/KML/KMZ/SHP/GPX) + file import dialog | gisExport, gisImport, fflate, @mapbox/shp-write |

Supporting logic: `webapp/src/utils/chainage.ts` (chainage ↔ coordinate), `webapp/src/utils/segmentJoin.ts` (shared slope×fuel join), `webapp/src/utils/planInsights.ts` (rule-based assessment), `webapp/src/utils/routeOptimizer.ts` (corridor least-cost pathfinding over DEM + NVIS/NSW samples + OSM trails), `webapp/src/utils/infrastructureService.ts` (Overpass corridor query), `webapp/src/utils/gisExport.ts` / `gisImport.ts` (GIS interop).

## Planned Components (from Roadmap)

| Component | Purpose | Status | Target | Related Issue |
|-----------|---------|--------|--------|---------------|
| ConfirmDialog | Confirmation dialogs for destructive actions | 📋 Planned | Q2 2026 | Issue 1.1 |
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
