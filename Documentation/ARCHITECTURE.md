# Architecture Overview

This Fire Break Calculator application is built on a foundation of modern web technologies with a focus on geospatial analysis and resource planning for rural firefighting operations.

## Current Architecture

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

1. **Separation of Concerns**: Clear boundaries between mapping logic, calculations, and UI
2. **Type Safety**: Comprehensive TypeScript interfaces for all data structures
3. **Configurability**: All resource specifications and rules externalized to config files
4. **Progressive Enhancement**: Core functionality works without advanced features
5. **Performance**: Minimal re-renders and efficient distance calculations
6. **Accessibility**: Proper ARIA labels and keyboard navigation support

## Planned Expansion (Optional)

| Potential Feature | Suggested Approach |
|-------------------|--------------------|
| Basemap switcher | Maintain array of style configs, update tile layer |
| User location | `navigator.geolocation` -> Leaflet marker & accuracy circle |
| Drawing tools | Integrate `leaflet-draw` plugin lazily |
| Search/geocode | Mapbox Geocoding API (fetch wrapper + debounced input) |
| State management | Introduce Zustand for ephemeral UI state |
| Theming | CSS variables / Tailwind optional integration |

## Component Responsibilities

### MapView Component
- Leaflet map initialization and lifecycle management
- Mapbox tile layer configuration with environment-based tokens
- Drawing tool integration using Leaflet Draw plugin
- Real-time distance calculation for drawn polylines
- Event handling for create, edit, and delete operations
- Error state management for missing configuration

### AnalysisPanel Component  
- Resource selection interface with checkboxes for each category
- Terrain and vegetation condition selectors
- Calculation engine for time and cost estimates
- **NEW: Enhanced preview pane design with:**
  - Compact collapsed state featuring icons/emojis for visual clarity
  - Improved space utilization with streamlined layout
  - Categorized expanded view with equipment type icons
  - Better visual hierarchy and equipment type distinction
- Expandable/collapsible UI for space efficiency
- Real-time updates based on distance changes and selections

### Configuration System
- **config/defaultConfig.ts**: Resource specifications and calculation rules
- **types/config.ts**: TypeScript interfaces ensuring type safety
- Machinery specifications: clearing rates, costs, descriptions
- Aircraft capabilities: drop patterns, speeds, turnaround times
- Hand crew profiles: sizes, efficiency rates, tool types
- Calculation factors: terrain and vegetation difficulty multipliers

## Data Flow

1. **User draws line** → MapView calculates distance → Updates shared state
2. **Distance change** → Triggers AnalysisPanel re-calculation
3. **Resource selection** → AnalysisPanel applies calculation formulas
4. **Condition changes** → Recalculates with terrain/vegetation factors
5. **Results display** → Shows time estimates and optional costs
6. **Drop preview selection** → AnalysisPanel notifies App → MapView updates drop markers
7. **Map visualization** → Drop markers positioned at calculated intervals along polyline

## Calculation Algorithms

### Machinery Time Calculation
```
Adjusted Rate = Base Clearing Rate / (Terrain Factor × Vegetation Factor)  
Time (hours) = Distance (meters) / Adjusted Rate
```

### Aircraft Drop Calculation
```
Number of Drops = Ceiling(Distance / Drop Length)
Total Time (hours) = (Number of Drops × Turnaround Time) / 60 minutes
Drop Marker Positions = Calculated at each Drop Length interval along polyline
```

### Hand Crew Time Calculation  
```
Total Crew Rate = Crew Size × Clearing Rate Per Person
Adjusted Rate = Total Crew Rate / (Terrain Factor × Vegetation Factor)
Time (hours) = Distance / Adjusted Rate
```

## Environment & Build

**Vite Configuration:**
- Fast HMR development server with TypeScript support
- Production builds with code splitting and optimization
- Environment variable injection for configuration
- CSS processing with PostCSS

**TypeScript Setup:**
- Strict type checking enabled for enhanced reliability
- Custom type definitions for Vite environment variables
- Comprehensive interfaces for all configuration structures
- Import path resolution for clean module organization

**Dependencies:**
- **Runtime**: React 18, Leaflet 1.9+, Leaflet Draw
- **Development**: TypeScript 5.5+, Vite 5.4+, React types
- **Styling**: CSS3 with CSS Variables and Flexbox layout

## Performance Considerations

### Map Performance
- Map container isolated to prevent unnecessary React re-renders  
- Drawing layers managed imperatively via Leaflet APIs
- Distance calculations optimized with incremental updates
- Event debouncing for rapid user interactions

### Memory Management
- Proper cleanup of Leaflet resources on component unmount
- Event listener removal to prevent memory leaks
- Efficient re-rendering strategies for analysis updates

### Bundle Optimization
- Dynamic imports for large dependencies (future enhancement)
- Tree shaking of unused Leaflet modules
- CSS extraction and minification in production builds

## Security Considerations

### Token Management
- Mapbox tokens stored in environment variables only
- No privileged scopes exposed in public client tokens
- Production tokens should be restricted to specific domains
- Environment files excluded from version control

### Data Privacy
- All calculations performed client-side (no external API calls)
- No user location data stored or transmitted
- Map tiles cached according to Mapbox terms of service

## Extensibility Points

### Adding New Resource Types
1. Extend configuration interfaces in `types/config.ts`
2. Add resource specifications to `defaultConfig.ts`
3. Implement calculation logic in `AnalysisPanel.tsx`
4. Update UI sections for new resource category

### Custom Calculation Rules
1. Modify `CalculationRules` interface for new factors
2. Update calculation functions to incorporate new variables
3. Add UI controls for user input of new parameters
4. Maintain backward compatibility with existing configurations

### Map Enhancements
1. Additional drawing tools via Leaflet Draw configuration
2. Custom map layers through Leaflet layer system
3. Elevation data integration via third-party APIs
4. GPS coordinate import/export functionality

## Testing Strategy (Future Implementation)

### Unit Testing
- Calculation function validation with known inputs/outputs
- Configuration parsing and validation
- Component prop handling and state management
- TypeScript type checking as compile-time testing

### Integration Testing  
- Map drawing workflows with simulated user interactions
- Analysis panel updates in response to distance changes
- Resource selection and calculation accuracy
- Error handling for invalid configurations

### End-to-End Testing
- Complete fire break planning workflow
- Cross-browser compatibility testing
- Mobile device responsiveness validation
- Accessibility compliance verification

## Deployment Considerations

### Static Hosting
- Application builds to static files suitable for CDN deployment
- No server-side requirements beyond static file serving
- Environment variable injection at build time

### Domain Configuration
- Mapbox token restrictions should match deployment domains
- HTTPS required for geolocation features (future enhancement)
- CSP headers recommended for additional security

---

This architecture provides a solid foundation for rural fire service operations while maintaining flexibility for future enhancements and regional customizations.
