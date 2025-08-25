# Vegetation Analysis Feature Documentation

## Overview

The RFS Fire Break Calculator now includes automated vegetation analysis using Mapbox Terrain v2 vector tiles. This feature automatically detects vegetation type and density along fire break routes, replacing manual vegetation selection with intelligent analysis while maintaining the option for manual override.

## Features

### Automatic Vegetation Detection
- Integrates with Mapbox Terrain v2 vector tileset (`mapbox://mapbox.mapbox-terrain-v2`)
- Extracts landcover data from the `class` field to classify vegetation
- Samples vegetation every 200m along the fire break route
- Provides confidence scoring for detected vegetation types

### Vegetation Classification Mapping
The system maps Mapbox landcover classes to the application's vegetation taxonomy:

- **'wood'** (forest/wooded) → **'heavyforest'** (90% confidence)
- **'scrub'** (bushy/mixed) → **'mediumscrub'** (85% confidence)
- **'grass'** (grassy) → **'grassland'** (90% confidence)
- **'crop'** (agricultural) → **'lightshrub'** (70% confidence)
- **'snow'** (permanent snow/ice) → **'grassland'** (30% confidence, fallback)

### User Interface Enhancements
- **Auto-detected vegetation display**: Shows the predominant vegetation type and confidence level
- **Manual override option**: Users can choose to use auto-detected vegetation or manually select
- **Visual feedback**: Clear indication of which vegetation type is being used in calculations
- **Confidence indicators**: Percentage confidence scores help users understand reliability

### Integration with Analysis Pipeline
- **Seamless integration**: Works alongside existing slope analysis
- **Resource compatibility**: Auto-detected vegetation affects equipment compatibility calculations
- **Factor calculations**: Vegetation multipliers are automatically applied based on detected type
- **Popup information**: Map popups include both slope and vegetation analysis results

## Technical Implementation

### Data Flow
1. User draws fire break line on map
2. System generates sample points every 200m along the route
3. Vegetation analysis runs in parallel with slope analysis
4. Mapbox Terrain v2 API provides landcover data for each sample point
5. Landcover classes are mapped to application vegetation types
6. Results are merged into contiguous segments by vegetation type
7. Predominant vegetation type is calculated based on distance-weighted analysis

### API Integration
- **Vector Tiles API**: `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/{z}/{x}/{y}.mvt?access_token=...`
- **Zoom Level**: Uses zoom level 14 for optimal balance of detail vs API calls
- **Fallback Support**: Provides mock data when Mapbox token is unavailable
- **Error Handling**: Gracefully falls back to manual selection if API fails

### Performance Considerations
- Vegetation analysis runs asynchronously to avoid blocking the UI
- Results are cached until the fire break line is modified
- Efficient sampling strategy minimizes API calls while maintaining accuracy
- Parallel execution with slope analysis optimizes response time

## Usage Examples

### Example 1: Automatic Detection
1. Draw a fire break line across varied terrain
2. System automatically detects vegetation along the route
3. Analysis panel shows: "Auto-detected: mediumscrub (85% confidence)"
4. Checkbox allows switching to "Use auto-detected vegetation"
5. Equipment recommendations adjust based on detected vegetation

### Example 2: Manual Override
1. System detects "grassland" but user knows area has dense undergrowth
2. User unchecks "Use auto-detected vegetation"
3. Manual selector becomes available
4. User selects "mediumscrub" for more accurate analysis
5. System uses manual selection in all calculations

### Example 3: Mixed Vegetation
1. Long fire break crosses multiple vegetation zones
2. System detects segments: 40% grassland, 35% mediumscrub, 25% lightshrub
3. Predominant type is "grassland" but with moderate confidence
4. User can review detailed breakdown in map popup
5. Override to "mediumscrub" if planning for worst-case scenario

## Configuration

### Environment Variables
The system reuses the existing Mapbox configuration:
- `VITE_MAPBOX_ACCESS_TOKEN`: Required for accessing Mapbox Terrain v2 API

### Customization Options
- **Sampling interval**: Default 200m, configurable in `generateVegetationSamplePoints()`
- **Confidence thresholds**: Adjustable in `mapLandcoverToVegetation()`
- **Vegetation mapping**: Customizable class-to-type mappings
- **Fallback behavior**: Configurable mock data patterns

## Error Handling

### Graceful Degradation
- **Missing API token**: Falls back to mock vegetation data
- **API failures**: Continues with slope analysis only
- **Network issues**: Provides sensible defaults
- **Invalid responses**: Logs warnings and uses fallback classification

### User Feedback
- **Loading indicators**: Shows "Analyzing vegetation..." during processing
- **Confidence display**: Visual indicators help users assess reliability
- **Error messages**: Clear notifications if vegetation analysis fails
- **Fallback notification**: Informs users when using mock data

## Future Enhancements

### Planned Improvements
- **Enhanced vector tile parsing**: Full MVT format support for detailed analysis
- **Seasonal adjustments**: Factor in seasonal vegetation changes
- **Species-specific data**: More granular vegetation classification
- **Historical analysis**: Track vegetation changes over time
- **User feedback loop**: Allow users to correct misclassifications

### Integration Opportunities
- **Weather data**: Combine with fire weather indices
- **Satellite imagery**: Cross-reference with current satellite data
- **Local knowledge**: Integration with fire service databases
- **Field validation**: Tools for ground-truthing automated analysis

---

*This documentation follows the conventions established in the PacePublicShare repository for technical feature documentation.*