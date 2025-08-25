# Fire Break Calculator User Guide

## Overview

The RFS Fire Break Calculator is a web-based tool designed to help rural firefighters and emergency response teams plan fire breaks and trails by estimating the time and resources required for construction using various types of machinery, aircraft, and hand crews.

## Getting Started

### Accessing the Application
1. Open your web browser and navigate to the Fire Break Calculator URL
2. The application loads with a map centered on New South Wales, Australia
3. You'll see a map interface with drawing tools and a collapsible analysis panel

### Initial Setup Requirements
- **Mapbox Token**: Contact your system administrator if you see a "Mapbox access token not configured" message
- **Modern Browser**: Chrome, Firefox, Safari, or Edge with JavaScript enabled
- **Internet Connection**: Required for map tiles and initial loading

## Planning a Fire Break

### Step 1: Draw Your Fire Break Route
1. Locate the **drawing tools** in the top-right corner of the map (pencil icon)
2. Click the **polyline tool** to start drawing
3. Click on the map to place points along your proposed fire break route
4. Double-click or click the first point again to finish the line
5. The system automatically calculates and displays the total distance

### Step 2: Set Environmental Conditions
1. **Expand the analysis panel** by clicking the header or arrow button
2. **Select terrain difficulty:**
   - **Easy**: Flat, accessible terrain with minimal obstacles
   - **Moderate**: Rolling hills with some rocks and obstacles  
   - **Difficult**: Steep slopes, rocky terrain, limited access
   - **Extreme**: Very steep, heavily obstructed, or inaccessible areas

3. **Select vegetation density:**
   - **Light**: Grass, light shrubs, minimal tree cover
   - **Moderate**: Mixed vegetation, scattered small trees
   - **Heavy**: Dense forest, thick undergrowth, numerous trees
   - **Extreme**: Very dense vegetation, large trees, impenetrable areas

### Step 3: Choose Resources
Select the types of equipment and crews you want to include in your analysis:

#### Machinery Options
- **Caterpillar D4 Dozer**: Light dozer for sensitive areas and narrow breaks
- **Caterpillar D6 Dozer**: Medium dozer suitable for most terrain types
- **Caterpillar D8 Dozer**: Heavy dozer for difficult terrain and heavy vegetation
- **Motor Grader 140M**: For maintaining existing trails and light clearing

#### Aircraft Options  
- **Light Helicopter (AS350)**: 100m drop length, good for smaller breaks
- **Medium Helicopter (Bell 212)**: 150m drop length, higher capacity
- **Air Tractor AT-802F**: 300m drop length, fixed-wing for large coverage

#### Hand Crew Options
- **Standard Hand Crew**: 6-person crew with mixed hand tools and chainsaws
- **Rapid Response Crew**: 4-person crew for quick initial attack
- **Heavy Clearing Crew**: 10-person crew with power tools for heavy vegetation

### Step 4: Review Results
For each selected resource, the system displays:
- **Estimated completion time** (in hours)
- **Number of aircraft drops** (for aircraft resources)  
- **Estimated operational cost** (when cost data is available)

## Understanding the Calculations

### Time Estimates
The system calculates time requirements based on:
- **Base clearing rates** for each equipment type
- **Terrain difficulty multipliers** (1.0× to 2.2×)
- **Vegetation density multipliers** (1.0× to 2.5×)
- **Distance of the fire break** in meters

### Cost Estimates
Operating costs include:
- Fuel and maintenance for machinery
- Flight time for aircraft operations
- Crew wages and equipment costs
- Costs are displayed in local currency (default: AUD)

## Advanced Features

### Editing Your Fire Break
- **Modify the route**: Select the edit tool (square icon) to move points
- **Delete sections**: Use the delete tool (trash icon) to remove the line
- **Start over**: Delete the current line and draw a new one

### Map Navigation
- **Zoom**: Use mouse wheel or +/- buttons
- **Pan**: Click and drag to move around the map
- **Mobile**: Use standard touch gestures (pinch, swipe)

## Tips for Effective Planning

### Route Selection
- Consider accessibility for equipment transport
- Plan for natural firebreaks (streams, roads, ridges)
- Account for wind patterns and fire behavior
- Ensure adequate width for intended fire intensity

### Resource Selection
- **Machinery**: Most efficient for long, straight sections
- **Aircraft**: Effective for inaccessible areas or rapid deployment
- **Hand Crews**: Flexible for sensitive areas and detailed work
- **Combinations**: Often most effective to use multiple resource types

### Environmental Factors
- **Terrain**: Slope affects all equipment types significantly
- **Vegetation**: Dense areas may require pre-treatment or different approaches
- **Weather**: Consider seasonal conditions (not currently factored in calculations)
- **Soil**: Wet conditions may limit machinery effectiveness

## Troubleshooting

### Common Issues
- **Map not loading**: Check internet connection and Mapbox token configuration
- **Drawing tools not working**: Ensure the drawing tool is selected and try clicking directly on the map
- **No distance showing**: Complete the line by double-clicking or connecting back to start
- **Analysis panel empty**: Draw a fire break line first

### Performance Tips
- Clear old fire break lines before drawing new ones
- Close analysis panel when not needed on smaller screens
- Use standard zoom levels for better performance

### Browser Compatibility
- Update to the latest browser version if experiencing issues
- Enable JavaScript if tools are not responding
- Clear browser cache if the application fails to load properly

## Configuration and Customization

Resource specifications and calculation rules can be modified by system administrators in the configuration files. Contact your IT department for:
- Adding new equipment types
- Modifying clearing rates or costs
- Adjusting terrain and vegetation factors
- Regional customizations

## Support and Feedback

For technical support, training, or feature requests, contact your local Rural Fire Service IT support team or the application administrators.

---

*Last updated: December 2024*
*Version: 1.0*