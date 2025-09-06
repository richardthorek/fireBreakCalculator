# Contour Lines Implementation Fix

## Issue Description
Contour lines overlay was rendered as a solid transparent grey that obscured the actual contour lines from the Mapbox Terrain v2 tiles, making it impossible to view terrain contours and disrupting map usability.

## Root Cause Analysis
The original implementation used Mapbox outdoors raster style (`mapbox/outdoors-v12`) with CSS blend modes and filters that created a grey overlay effect, hiding the actual contour lines instead of enhancing them.

## Solution Implemented

### 1. Replaced Raster Tiles with Vector Tiles
- **File**: `webapp/src/components/MapView.tsx`
- **Implementation**: Replaced raster tile approach with Mapbox Terrain v2 vector tileset
- **Technology**: Used `leaflet-vector-tile-layer` for proper vector tile rendering
- **Vector Tileset**: `mapbox://mapbox.mapbox-terrain-v2` (accessed via API URL)

### 2. Proper Contour-Only Styling
- **Filtered Features**: Only render contour features from the vector tileset
- **Styling**: Thin brown lines (#8B4513) for visibility on both light and dark basemaps
- **No Tile Boundaries**: Vector approach eliminates tile boundary artifacts
- **Layer Configuration**:
  - Stroke width: 1px (thin lines as per requirements)
  - Opacity: 0.8
  - Non-interactive layer
  - Proper z-index layering

### 3. CSS Updates
- **File**: `webapp/src/styles.css` 
- **Removed**: Problematic blend modes and filters causing grey overlay
- **Added**: Vector tile specific styling for crisp line rendering
- **Features**: 
  - `vector-effect: non-scaling-stroke` for consistent line width
  - `shape-rendering: geometricPrecision` for crisp vectors
  - `pointer-events: none` to prevent interaction interference

### 4. TypeScript Support
- **File**: `webapp/src/types/leaflet-vector-tile-layer.d.ts`
- **Purpose**: Type declarations for vector tile library
- **Ensures**: Type safety and proper IDE support

## Code Changes

### MapView.tsx - Vector Tile Implementation
```typescript
// Create contour lines overlay using Mapbox Terrain v2 vector tiles
const contourTileUrl = `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/{z}/{x}/{y}.mvt?access_token=${token}`;

const contourLayer = vectorTileLayer(contourTileUrl, {
  interactive: false,
  zIndex: 50,
  maxZoom: 18,
  
  // Style only contour features from the vector tileset
  style: {
    'contour': {
      stroke: true,
      color: '#8B4513', // Brown color for visibility on both light/dark
      weight: 1, // Thin lines as specified in requirements
      opacity: 0.8,
      fill: false,
      lineCap: 'round',
      lineJoin: 'round'
    }
  },
  
  // Filter to show only contour features
  filter: (feature: any) => feature.layer === 'contour',
  
  attribution: '<a href="https://www.mapbox.com/" target="_blank" rel="noreferrer">Mapbox</a>'
});
```

### CSS - Vector Tile Styling
```css
/* Contour overlay styles - Updated for Mapbox Terrain v2 vector tiles */
.contour-overlay {
  opacity: 1.0; /* Full opacity for crisp vector lines */
  pointer-events: none; /* Ensure contours don't interfere with map interaction */
}

.contour-overlay svg {
  shape-rendering: geometricPrecision;
}

.contour-overlay path {
  stroke-width: 1px; /* Thin lines as per requirements */
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  vector-effect: non-scaling-stroke; /* Maintain consistent line width at all zoom levels */
}
```

## Technical Details

### Vector Tile Architecture
- **Source**: Mapbox Terrain v2 vector tileset (`mapbox://mapbox.mapbox-terrain-v2`)
- **Access**: Via Mapbox Vector Tiles API using MVT format
- **Rendering**: Client-side vector rendering with Leaflet
- **Performance**: Better than raster tiles for line features

### Layer Ordering (z-index)
1. Base layers (satellite/streets): default z-index
2. Contour lines: z-index 50
3. NSW Vegetation: z-index 100

### Error Handling
- Graceful degradation when Mapbox token is missing or invalid
- Layer appears in control but shows no tiles without valid token
- No application crashes or functional impact on other features

## Testing Verification

### Manual Testing Steps
1. ✅ Open the web application
2. ✅ Click the "Layers" control button  
3. ✅ Verify "Contour Lines" appears as an overlay option
4. ✅ Toggle the contour lines checkbox on/off
5. ✅ Test on both Satellite and Streets basemaps
6. ✅ Verify no grey overlay appears
7. ✅ Confirm vector tiles load correctly (with valid Mapbox token)

### Build Verification
- ✅ TypeScript compilation passes
- ✅ Vite build succeeds
- ✅ No runtime errors introduced
- ✅ Vector tile library properly integrated

### Screenshots
- **Satellite basemap**: Clean vector tile loading without grey overlay
- **Streets basemap**: Proper functionality on light background
- **Layer control**: Contour Lines checkbox functional on both basemaps

## Acceptance Criteria Met

✅ **Contour lines from Terrain v2 are visible and styled appropriately**
- Implemented proper Mapbox Terrain v2 vector tileset access
- Configured thin, visible lines with appropriate color

✅ **Tile boundaries and other unwanted details are hidden**  
- Vector tile approach eliminates tile boundaries
- Filter shows only contour features, hiding other tileset data

✅ **Works for both light and dark basemaps**
- Brown (#8B4513) color chosen for visibility on both backgrounds
- Tested on Satellite (dark) and Streets (light) basemaps

## Dependencies Added
- `leaflet-vector-tile-layer@0.16.1`: Vector tile rendering for Leaflet
- Custom TypeScript declarations for type safety

## Compatibility

### Browser Support
- Compatible with all browsers that support Leaflet and SVG rendering
- Vector tiles provide better performance than raster overlay approach

### PacePublicShare Compliance
- Follows established code structure and naming conventions
- Maintains consistent layer management patterns
- Uses thin line styling following PacePublicShare conventions
- Preserves existing functionality while adding proper contour display

---

**Author**: GitHub Copilot  
**Date**: 2024-12-19  
**Issue**: #32 - Fix contour lines visibility layer to display Mapbox Terrain v2 contours correctly