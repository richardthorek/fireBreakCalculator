# Slope Analysis Feature Documentation

## Overview

The RFS Fire Break Calculator now includes comprehensive slope analysis functionality that calculates and visualizes terrain slope along fire break tracks. This feature helps evaluate whether machinery can handle the terrain conditions for a given route.

## Features

### Slope Calculation
- Calculates elevation every 100m along drawn fire break lines
- Computes slope angle in degrees between consecutive segments
- Uses mock elevation data (in production, this would integrate with real elevation APIs)

### Slope Categorization
- **Flat (0-10°)**: Green visualization, suitable for most equipment
- **Medium (10-20°)**: Yellow visualization, moderate challenge
- **Steep (20-30°)**: Orange visualization, challenging for some equipment
- **Very Steep (30°+)**: Red visualization, only specialized equipment can handle

### Equipment Compatibility
Each machinery specification now includes a `maxSlope` property defining the maximum slope angle the equipment can safely operate on:
- **Motor Grader**: 10° maximum (light terrain work only)
- **D4 Dozer**: 20° maximum (medium terrain capability)
- **D6 Dozer**: 25° maximum (good terrain capability)
- **D8 Dozer**: 35° maximum (heavy terrain specialist)

### Visual Feedback
- **Map Visualization**: Fire break lines are color-coded by slope segments
- **Analysis Panel**: Shows slope statistics and distribution
- **Equipment Status**: Indicates if equipment is slope-compatible
- **Detailed Popups**: Slope information for individual segments

## User Interface

### Map View
1. Draw a fire break line using the drawing tools
2. The system automatically calculates slopes every 100m
3. Line segments are colored based on slope steepness:
   - Green: Flat terrain (0-10°)
   - Yellow: Medium slope (10-20°)
   - Orange: Steep terrain (20-30°)
   - Red: Very steep terrain (30°+)
4. Click on individual segments to see detailed slope information

### Analysis Panel
- **Header Display**: Shows maximum slope encountered
- **Slope Analysis Section**: Detailed statistics when expanded
  - Maximum and average slope
  - Number of segments analyzed
  - Distribution by slope category
- **Equipment Compatibility**: Clear indication if equipment can handle the terrain

### Equipment Configuration
- Equipment specifications now include slope limits
- Configuration panel shows these limits for reference
- Can be customized through the equipment configuration interface

## Technical Implementation

### Data Flow
1. User draws fire break line on map
2. System interpolates points every 100m along the route
3. Mock elevation service provides elevation data for each point
4. Slope calculation computes angle between consecutive points
5. Results are categorized and visualized
6. Equipment compatibility is evaluated against slope requirements

### Performance Considerations
- Slope analysis runs asynchronously to avoid blocking the UI
- Visual feedback shows "Analyzing slopes..." during processing
- Results are cached until the line is modified

### Elevation Data
Currently uses mock elevation data that creates realistic terrain variation for demonstration. In production deployment, this would integrate with:
- Digital Elevation Models (DEM)
- Web elevation services (e.g., Google Elevation API)
- Local topographic databases

## Usage Examples

### Example 1: Planning in Flat Terrain
- Draw a line across relatively flat terrain
- All segments show green (flat) categorization
- All machinery types are compatible
- Analysis shows low average slope (< 5°)

### Example 2: Challenging Terrain
- Draw a line across varied terrain with some steep sections
- Mixed color segments: green, yellow, orange, red
- Only heavy dozers (D6, D8) are compatible if max slope > 20°
- Motor grader is marked incompatible if any segment > 10°

### Example 3: Extreme Terrain
- Draw a line across very steep terrain
- Predominantly red segments (very steep)
- Only D8 dozer is compatible (if max slope < 35°)
- Clear warning messages about slope limits exceeded

## Configuration

### Equipment Slope Limits
Slope limits can be configured in the equipment specifications:

```typescript
{
  id: 'dozer-d8',
  name: 'Caterpillar D8 Dozer',
  maxSlope: 35, // Maximum slope in degrees
  // ... other properties
}
```

### Slope Categories
Slope categories are defined in the slope calculation utilities:
- Flat: 0-10°
- Medium: 10-20°
- Steep: 20-30°
- Very Steep: 30°+

### Analysis Parameters
- **Segment Interval**: 100m (configurable in `generateInterpolatedPoints`)
- **Elevation Variation**: Mock data provides ±50m variation
- **Distance Calculation**: Uses Haversine formula for accuracy

## API Integration Notes

### Future Elevation Services
For production deployment, replace the mock elevation service with:

```typescript
// Example integration with real elevation API
export const getElevation = async (lat: number, lng: number): Promise<number> => {
  const response = await fetch(`https://api.elevation-service.com/v1/lookup?lat=${lat}&lng=${lng}`);
  const data = await response.json();
  return data.elevation;
};
```

### Performance Optimization
- Consider caching elevation data for previously analyzed routes
- Implement batch elevation requests to reduce API calls
- Use terrain tile services for improved performance

## Error Handling

### Common Issues
- **Analysis Failed**: Network issues with elevation service
- **No Elevation Data**: Missing elevation data for remote areas
- **Calculation Errors**: Invalid coordinates or mathematical edge cases

### Error Recovery
- Graceful fallback to basic distance calculation
- User notification of analysis limitations
- Retry mechanisms for temporary service failures

## Accessibility

### Visual Indicators
- Color-coded slope visualization with clear legends
- Text-based slope information in popups and analysis panel
- High contrast colors for different slope categories

### Screen Reader Support
- Comprehensive alt text for slope visualizations
- Structured data presentation in analysis panel
- Keyboard navigation support for all slope-related features

## Future Enhancements

### Planned Features
- **Real-time Analysis**: Update slopes as user drags line endpoints
- **Elevation Profiles**: Show elevation chart alongside slope analysis
- **Advanced Terrain Factors**: Consider soil type, weather conditions
- **Route Optimization**: Suggest alternative routes with better slope characteristics
- **Historical Data**: Track slope analysis results for comparison

### Integration Opportunities
- **GPS Import**: Analyze pre-recorded GPS tracks
- **Weather Services**: Factor weather impact on slope traversability
- **Soil Data**: Consider ground conditions in capability assessment
- **Machinery Performance**: Real-world performance data integration