# 🔥 Fire Break Calculator User Guide

**Version 1.0** | *Complete operational guide for planning fire breaks and trails*

---

## 📋 Quick Navigation
- [🚀 Getting Started](#-getting-started) - First-time setup and access
- [📏 Planning a Fire Break](#-planning-a-fire-break) - Step-by-step planning process
- [🧮 Understanding Results](#-understanding-the-calculations) - Interpreting time, cost, and compatibility
- [🛠️ Advanced Features](#-advanced-features) - Route editing and optimization
- [💡 Tips & Best Practices](#-tips-for-effective-planning) - Expert planning guidance
- [🆘 Troubleshooting](#-troubleshooting) - Common issues and solutions

---

## 🎯 Overview

The **RFS Fire Break Calculator** is a modern web-based planning tool designed to help rural firefighters and emergency response teams efficiently plan fire breaks and trails. Get instant analysis of time, cost, and resource requirements using various machinery, aircraft, and hand crews.

### Key Capabilities
- 📏 **Interactive Route Planning**: Draw fire break routes directly on the map
- ⛰️ **Automated Analysis**: Real-time slope and vegetation assessment  
- 🚜 **Equipment Comparison**: Machinery, aircraft, and hand crew options
- 💰 **Cost Estimation**: Time and financial planning with terrain factors
- 📱 **Mobile Optimized**: Works on tablets and smartphones for field use

**🔗 Related Documentation:**
- [📊 Technical Architecture](ARCHITECTURE.md) - System design details
- [🌱 Vegetation Mapping](../../Documentation/VEGETATION_MAPPING.md) - Classification system
- [📈 Data Sources](../../Documentation/DATA_SOURCES.md) - External APIs and attribution

## 🚀 Getting Started
1. Open your web browser and navigate to the Fire Break Calculator URL
2. The application loads with a map centered on New South Wales, Australia
3. You'll see a map interface with drawing tools and a collapsible analysis panel

### ⚙️ Initial Setup Requirements
- **Mapbox Token**: Contact your system administrator if you see a "Mapbox access token not configured" message
- **Modern Browser**: Chrome, Firefox, Safari, or Edge with JavaScript enabled
- **Internet Connection**: Required for map tiles and initial loading

## 📏 Planning a Fire Break

### 🎯 Step 1: Draw Your Fire Break Route
1. Locate the **drawing tools** in the top-right corner of the map (pencil icon)
2. Click the **polyline tool** to start drawing
3. Click on the map to place points along your proposed fire break route
4. Double-click or click the first point again to finish the line
5. The system automatically calculates and displays the total distance

#### 📱 Mobile / Touch Devices
On phones and tablets a single quick tap after the first point may immediately finish the line due to touch event handling in the drawing library. To add additional intermediate points:

* **Press and hold (~1 second) at the location** where you want to insert the next point – this adds a vertex without finishing the line.
* **Single quick tap** ends (finishes) the current line.
* A dismissible on‑screen hint appears the first time you start drawing on a touch device to remind you of this behavior.
* You can still edit the line afterwards using the edit (✎) control to adjust or add points.

### 🌍 Step 2: Set Environmental Conditions
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

### 🚜 Step 3: Choose Resources
Select the types of equipment and crews you want to include in your analysis:

#### 🚜 Machinery Options
- **Caterpillar D4 Dozer**: Light dozer for sensitive areas and narrow breaks
- **Caterpillar D6 Dozer**: Medium dozer suitable for most terrain types
- **Caterpillar D8 Dozer**: Heavy dozer for difficult terrain and heavy vegetation
- **Motor Grader 140M**: For maintaining existing trails and light clearing

#### 🚁 Aircraft Options  
- **Light Helicopter (AS350)**: 100m drop length, good for smaller breaks
- **Medium Helicopter (Bell 212)**: 150m drop length, higher capacity
- **Air Tractor AT-802F**: 300m drop length, fixed-wing for large coverage

#### 👥 Hand Crew Options
- **Standard Hand Crew**: 6-person crew with mixed hand tools and chainsaws
- **Rapid Response Crew**: 4-person crew for quick initial attack
- **Heavy Clearing Crew**: 10-person crew with power tools for heavy vegetation

### 📊 Step 4: Review Results and Slope Analysis
For each selected resource, the system displays:
- **Estimated completion time** (in hours for all resource types)
- **Number of aircraft drops** (shown alongside completion time for aircraft)  
- **Estimated operational cost** (when cost data is available)
- **Slope compatibility** (for machinery resources)

#### ⛰️ Understanding Slope Analysis
When you draw a fire break line, the system automatically:
- Calculates slope every 100m along the route
- Color-codes segments based on steepness:
  - **Green**: Flat terrain (0-10°) - suitable for all equipment
  - **Yellow**: Medium slope (10-20°) - challenging for some equipment
  - **Orange**: Steep terrain (20-30°) - only heavy machinery
  - **Red**: Very steep (30°+) - specialized equipment only

#### 🔧 Equipment Slope Limits
- **Motor Grader**: Maximum 10° slope
- **D4 Dozer**: Maximum 20° slope  
- **D6 Dozer**: Maximum 25° slope
- **D8 Dozer**: Maximum 35° slope

**Important**: If ANY segment of your fire break exceeds an equipment's slope limit, that equipment will be marked as incompatible for the entire job.

### 🚁 Step 5: Drop Preview for Aircraft (New Feature)
When you have drawn a fire break line, you can visualize aircraft drop patterns:

1. **Access Drop Preview**: Look for the "Drop Preview" section in the analysis panel
2. **Select Aircraft**: Check the boxes next to aircraft you want to preview
3. **View Drop Information**: Each aircraft shows:
   - Number of drops required
   - Drop interval distance (e.g., 100m, 150m, 300m)
   - Total completion time including turnaround time
4. **Visual Markers**: Selected aircraft will show colored markers on the map at each drop interval
   - Different colors for each aircraft type
   - Tooltips show aircraft name and drop number
5. **Multiple Aircraft**: Select multiple aircraft to compare different drop patterns

#### ✈️ Aircraft Drop Calculations
- **Drop intervals** based on each aircraft's effective drop length
- **Total completion time** = (Number of drops) × (Turnaround time)
- **Turnaround time** includes flight time between drops and reloading

## 🧮 Understanding the Calculations

### ⏱️ Time Estimates
The system calculates time requirements based on:
- **Base clearing rates** for each equipment type
- **Terrain difficulty multipliers** (1.0× to 2.2×)
- **Vegetation density multipliers** (1.0× to 2.5×)
- **Distance of the fire break** in meters

### 💰 Cost Estimates
Operating costs include:
- Fuel and maintenance for machinery
- Flight time for aircraft operations
- Crew wages and equipment costs
- Costs are displayed in local currency (default: AUD)

## 🛠️ Advanced Features

### ✏️ Editing Your Fire Break
- **Modify the route**: Select the edit tool (square icon) to move points
- **Delete sections**: Use the delete tool (trash icon) to remove the line
- **Start over**: Delete the current line and draw a new one

### 🗺️ Map Navigation
- **Zoom**: Use mouse wheel or +/- buttons
- **Pan**: Click and drag to move around the map
- **Mobile**: Use standard touch gestures (pinch, swipe)

## 💡 Tips for Effective Planning

### 🎯 Route Selection
- Consider accessibility for equipment transport
- Plan for natural firebreaks (streams, roads, ridges)
- Account for wind patterns and fire behavior
- Ensure adequate width for intended fire intensity

### 🚜 Resource Selection
- **Machinery**: Most efficient for long, straight sections
- **Aircraft**: Effective for inaccessible areas or rapid deployment
- **Hand Crews**: Flexible for sensitive areas and detailed work
- **Combinations**: Often most effective to use multiple resource types

### 🌍 Environmental Factors
- **Terrain**: Slope affects all equipment types significantly
- **Vegetation**: Dense areas may require pre-treatment or different approaches
- **Weather**: Consider seasonal conditions (not currently factored in calculations)
- **Soil**: Wet conditions may limit machinery effectiveness

## 🆘 Troubleshooting

### ❗ Common Issues
- **Map not loading**: Check internet connection and Mapbox token configuration
- **Drawing tools not working**: Ensure the drawing tool is selected and try clicking directly on the map
- **No distance showing**: Complete the line by double-clicking or connecting back to start
- **Analysis panel empty**: Draw a fire break line first
- **Slope analysis not appearing**: Wait for "Analyzing slopes..." message to complete
- **Equipment marked incompatible**: Check if any slope segment exceeds equipment limits

### ⚡ Performance Tips
- Clear old fire break lines before drawing new ones
- Close analysis panel when not needed on smaller screens
- Use standard zoom levels for better performance

### 🌐 Browser Compatibility
- Update to the latest browser version if experiencing issues
- Enable JavaScript if tools are not responding
- Clear browser cache if the application fails to load properly

## ⚙️ Configuration and Customization

Resource specifications and calculation rules can be modified by system administrators in the configuration files. Contact your IT department for:
- Adding new equipment types
- Modifying clearing rates or costs
- Adjusting terrain and vegetation factors
- Regional customizations

## 📞 Support and Feedback

For technical support or feature requests, contact Richard the application administrator through this repo or submit an issue.

---

## 🔧 Equipment Management (API)

**🔗 For detailed API information, see [Data Sources & APIs](../../Documentation/DATA_SOURCES.md)**

Administrators (or authorized users) can manage the equipment catalogue via the backing Azure Functions API.

### Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/equipment` | List all equipment |
| GET | `/api/equipment?type=Machinery` | Filter list by type (`Machinery|Aircraft|HandCrew`) |
| POST | `/api/equipment` | Create a new item |
| PUT/PATCH | `/api/equipment/{type}/{id}` | Update existing item (optimistic version check) |
| DELETE | `/api/equipment/{type}/{id}` | Remove an item |

### Create Payload Examples
Machinery:
```json
{
   "type": "Machinery",
   "name": "Caterpillar D6",
   "allowedTerrain": ["easy","moderate","difficult"],
   "allowedVegetation": ["grassland","lightshrub","mediumscrub"],
   "clearingRate": 180,
   "costPerHour": 450,
   "maxSlope": 25,
   "cutWidthMeters": 4
}
```
Aircraft:
```json
{
   "type": "Aircraft",
   "name": "Air Tractor AT-802F",
   "dropLength": 300,
   "turnaroundMinutes": 12,
   "capacityLitres": 3000,
   "costPerDrop": 950
}
```
Hand Crew:
```json
{
   "type": "HandCrew",
   "name": "Heavy Clearing Crew",
   "crewSize": 10,
   "clearingRatePerPerson": 18,
   "equipmentList": ["chainsaws","brushcutters"],
   "costPerHour": 1200
}
```

### Versioning / Concurrency
Every update increments an integer `version`. Supply the current `version` in your update payload; if it has changed on the server a `409` is returned so clients can re-fetch and reconcile.

### Permissions
---

**📚 Related Documentation:**
- [🏗️ Architecture Overview](ARCHITECTURE.md) - Technical system design
- [🌱 Vegetation Classification](../../Documentation/VEGETATION_MAPPING.md) - Configurable vegetation system  
- [📊 Data Sources & APIs](../../Documentation/DATA_SOURCES.md) - External services and attribution
- [🔧 Local Development](../../README-local-dev.md) - Setup for developers

*Last updated: January 2025* | *Version: 1.0*
