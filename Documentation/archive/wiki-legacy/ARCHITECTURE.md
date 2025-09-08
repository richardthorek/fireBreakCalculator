> ARCHIVED (2025-09-08). Source page previously at wiki root. Consolidated content now lives in `TECHNICAL_REFERENCE` (Architecture & Data Flow sections). Kept verbatim for historical reference.

# 🏗️ Architecture Overview (Archived)

**System design and technical implementation details for the Fire Break Calculator**

---

## 📋 Quick Navigation
- [🧩 Current Architecture](#-current-architecture) - Core technologies and structure
- [📊 Component Responsibilities](#-component-responsibilities) - Detailed component breakdown
- [🔄 Data Flow](#-data-flow) - Information processing pipeline
- [🔧 Extensibility Points](#-extensibility-points) - Adding new features

**🔗 Related Documentation:**
- User Guide (see `OVERVIEW` now)
- Vegetation Analysis (merged)
- Slope Analysis (merged)
- UI Design (merged)

---
This Fire Break Calculator application is built on a foundation of modern web technologies with a focus on geospatial analysis and resource planning for rural firefighting operations.

## 🧩 Current Architecture

### Core Technologies
- **React 18** with functional components and hooks for state management
- **TypeScript** for type safety and improved developer experience  
- **Vite** for fast development builds and hot module replacement
- **Leaflet** with Mapbox tiles for interactive mapping
- **Leaflet Draw** plugin for line drawing and editing capabilities

### Component Structure
- **App**: Root component managing shared state between map and analysis
- **MapView**: Encapsulates map lifecycle, drawing tools, and distance calculations
- **AnalysisPanel**: Resource selection interface and calculation display
- **Configuration System**: Type-safe resource specifications and calculation rules

### State Management
- Local component state using React hooks (useState)
- Props-based communication between Map and Analysis components
- Configuration data imported from static files (easily editable)

## Design Principles
1. Separation of Concerns
2. Type Safety
3. Configurability
4. Progressive Enhancement
5. Performance
6. Accessibility

## Planned Expansion (Optional)
| Potential Feature | Suggested Approach |
|-------------------|--------------------|
| Basemap switcher | Maintain array of style configs, update tile layer |
| User location | `navigator.geolocation` -> Leaflet marker & accuracy circle |
| Drawing tools | Integrate `leaflet-draw` plugin lazily |
| Search/geocode | Mapbox Geocoding API (fetch wrapper + debounced input) |
| State management | Introduce Zustand for ephemeral UI state |
| Theming | CSS variables / Tailwind optional integration |

## 📊 Component Responsibilities
... (content unchanged from original) ...

## 🔄 Data Flow
1. User draws line → MapView calculates distance → Updates shared state
2. Distance change → Triggers AnalysisPanel re-calculation
3. Resource selection → AnalysisPanel applies calculation formulas
4. Condition changes → Recalculates with terrain/vegetation factors
5. Results display → Shows time estimates and optional costs
6. Drop preview selection → AnalysisPanel notifies App → MapView updates drop markers
7. Map visualization → Drop markers positioned along polyline

## Calculation Algorithms
```
Adjusted Rate = Base Clearing Rate / (Terrain Factor × Vegetation Factor)
Time (hours) = Distance (meters) / Adjusted Rate
```
... (remaining algorithm, performance, security, testing, deployment sections retained) ...

---
*Archive copy — do not edit. Update `TECHNICAL_REFERENCE` instead.*
