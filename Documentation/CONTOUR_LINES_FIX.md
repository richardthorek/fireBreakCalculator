# Contour Lines Implementation Fix

## Issue Description
Contour lines on the map, previously implemented with the Mapbox Terrain API, were no longer visible. This fix restores the contour line functionality as a toggleable overlay layer.

## Root Cause Analysis
The MapView component was missing a contour lines overlay layer. While the application had Mapbox integration for satellite and street base layers, and used Mapbox Terrain-RGB API for elevation data in slope calculations, there was no visible contour line layer for users to reference topographical features.

## Solution Implemented

### 1. Added Contour Lines Overlay Layer
- **File**: `webapp/src/components/MapView.tsx`
- **Implementation**: Added a new contour lines layer using Mapbox Outdoors style (`mapbox/outdoors-v12`)
- **Layer Configuration**:
  - Uses Mapbox tile URL with outdoors style which includes contour lines
  - Opacity: 0.6 for appropriate overlay visibility
  - zIndex: 50 (above base layers, below vegetation layer)
  - CSS class: `contour-overlay` for custom styling

### 2. Layer Control Integration
- Added "Contour Lines" as a toggleable overlay option in the Leaflet layers control
- Positioned alongside existing "NSW Vegetation" overlay
- Users can now enable/disable contour lines independently

### 3. CSS Styling Enhancement
- **File**: `webapp/src/styles.css`
- **Purpose**: Enhanced contour line visibility through CSS filters
- **Techniques**:
  - Mix blend modes for better integration with base layers
  - Contrast and brightness adjustments to emphasize contour lines
  - Saturation reduction to make contours more subtle

## Code Changes

### MapView.tsx Changes
```typescript
// Create contour lines overlay using Mapbox outdoors style as transparent overlay
// The outdoors style includes contour lines which can be used as an overlay
const contourLayer = L.tileLayer(tileUrl, {
  id: 'mapbox/outdoors-v12',
  tileSize: 512,
  zoomOffset: -1,
  maxZoom: 18,
  attribution: '<a href="https://www.mapbox.com/" target="_blank" rel="noreferrer">Mapbox</a>',
  opacity: 0.6,
  zIndex: 50, // Ensure contours appear above base layers but below vegetation
  className: 'contour-overlay'
});

// Add to layers control
L.control.layers(
  { Satellite: satellite, Streets: streets }, 
  { 
    'NSW Vegetation': nswVegetationLayer,
    'Contour Lines': contourLayer  // <-- New contour overlay
  }, 
  { position: 'topleft' }
).addTo(map);
```

### CSS Styling
```css
/* Contour overlay styles */
.contour-overlay {
  mix-blend-mode: multiply;
  filter: contrast(1.5) brightness(0.8) saturate(0);
}

.leaflet-tile-pane .contour-overlay img {
  filter: contrast(2) brightness(0.7) saturate(0) hue-rotate(180deg);
  mix-blend-mode: overlay;
}
```

## Technical Details

### Mapbox Integration
- Uses Mapbox Outdoors style which includes rendered contour lines
- Requires valid `VITE_MAPBOX_ACCESS_TOKEN` environment variable
- Fallback behavior: When token is invalid, layer appears in control but tiles fail to load

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
5. ✅ Verify layer loads (with valid Mapbox token)

### Build Verification
- ✅ TypeScript compilation passes
- ✅ Vite build succeeds
- ✅ No runtime errors introduced

## Future Enhancements

### Performance Optimizations
- Consider caching contour tiles for frequently viewed areas
- Implement progressive loading for better user experience

### Alternative Data Sources
- Evaluate additional contour data providers for redundancy
- Consider local/regional contour services for specific deployments

### User Experience
- Add contour line density controls (major/minor contours)
- Implement contour line labeling for elevation values
- Add contour interval configuration options

## Compatibility

### Browser Support
- Compatible with all browsers that support Leaflet and CSS blend modes
- Graceful fallback on older browsers (contours appear but without blend effects)

### PacePublicShare Compliance
- Follows established code structure and naming conventions
- Maintains consistent layer management patterns
- Preserves existing functionality while adding new features

## Dependencies
- No new dependencies added
- Uses existing Leaflet and Mapbox infrastructure
- Leverages current CSS framework

---

**Author**: GitHub Copilot  
**Date**: 2024-12-19  
**Issue**: #30 - Contour lines hidden again – diagnose and fix Mapbox Terrain API visibility