# Machinery Compatibility and Assignment System

## Overview

The RFS Fire Break Calculator features an intelligent machinery compatibility system that evaluates equipment suitability based on terrain conditions, vegetation types, and slope requirements from dynamic analysis. This system ensures realistic equipment recommendations and assignment for fire break construction projects.

## Compatibility Factors

### Vegetation Type Compatibility

The system uses a hierarchical vegetation compatibility model where machinery capable of handling heavier vegetation can also handle lighter vegetation types:

#### Vegetation Hierarchy (Light → Heavy)
1. **Grassland**: Open areas with grass and minimal woody vegetation
2. **Light Shrub**: Scattered small shrubs and bushes under 10cm diameter
3. **Medium Scrub**: Dense shrubs and small trees 10-50cm diameter  
4. **Heavy Forest**: Large trees and dense undergrowth over 50cm diameter

#### Equipment Vegetation Capabilities
- **D4/D6/D7/D8 Bulldozers**: Can handle all vegetation types (grassland through heavy forest)
- **Motor Grader**: Limited to grassland and light shrub vegetation only

#### Performance Impact
Vegetation type affects clearing rates through multiplier factors:
- **Grassland**: 1.0× (baseline)
- **Light Shrub**: 1.1× slower
- **Medium Scrub**: 1.5× slower
- **Heavy Forest**: 2.0× slower

### Terrain Compatibility

All machinery types are evaluated against terrain difficulty:

#### Terrain Categories
- **Easy**: Flat, accessible terrain (1.0× baseline rate)
- **Moderate**: Rolling hills, some obstacles (1.3× slower)
- **Difficult**: Steep slopes, rocky terrain (1.7× slower)
- **Extreme**: Very steep, inaccessible areas (2.2× slower)

### Slope Compatibility

Each machine has maximum slope capabilities:

- **Motor Grader**: 15° maximum slope
- **D4 Bulldozer**: 20° maximum slope
- **D6 Bulldozer**: 25° maximum slope
- **D7 Bulldozer**: 30° maximum slope
- **D8 Bulldozer**: 35° maximum slope

**Critical Rule**: If ANY segment of the fire break exceeds a machine's slope limit, that machine is marked as incompatible for the entire project.

## Dynamic Analysis Integration

### Vegetation Analysis Integration

The system integrates with the automatic vegetation detection feature:

1. **Auto-Detection**: Mapbox Terrain v2 API analyzes vegetation along the fire break route
2. **Predominant Type**: System determines the most common vegetation type
3. **Manual Override**: Users can override auto-detected vegetation if needed
4. **Compatibility Check**: Equipment compatibility is evaluated against the effective vegetation type

### Slope Analysis Integration

Real-time slope analysis affects machinery recommendations:

1. **Segment Analysis**: System analyzes slope every 100m along the route
2. **Maximum Slope**: Determines the steepest segment across the entire route
3. **Compatibility Filter**: Machinery exceeding slope limits is marked incompatible
4. **Visual Feedback**: Color-coded slope segments help users understand terrain challenges

## Equipment Selection Logic

### Recommendation Algorithm

The system uses the following logic to recommend equipment:

1. **Compatibility Filter**: Remove equipment that can't handle the terrain, vegetation, or slope requirements
2. **Performance Calculation**: Calculate time and cost for compatible equipment
3. **Efficiency Ranking**: Sort by completion time (fastest first), then by cost
4. **Quick Options**: Present best option from each category (machinery, aircraft, hand crews)

### Performance Calculations

Time calculations incorporate all compatibility factors:

```
Adjusted Rate = Base Rate / (Terrain Factor × Vegetation Factor)
Completion Time = Distance / Adjusted Rate
Total Cost = Completion Time × Hourly Rate
```

### Example Scenarios

#### Scenario 1: Grassland Fire Break
- **Vegetation**: Grassland (1.0× factor)
- **Compatible Machinery**: All equipment types
- **Best Option**: Motor Grader (highest clearing rate for light vegetation)

#### Scenario 2: Heavy Forest Fire Break  
- **Vegetation**: Heavy Forest (2.0× factor)
- **Compatible Machinery**: D4/D6/D7/D8 only (Motor Grader incompatible)
- **Best Option**: D8 Bulldozer (highest power for heavy vegetation)

#### Scenario 3: Steep Terrain (35° slope)
- **Slope Limit**: Exceeds all equipment except D8
- **Compatible Machinery**: D8 Bulldozer only
- **Result**: Only one machinery option available

## CSV Data Configuration

### Data Format

Equipment specifications are loaded from `clearingrates.csv`:

```
Equipment_ID    Category    Max_Slope    Vegetation_Type    Rate_m/h    Cost_$/h
D8              machinery   10           heavyforest        850         2000
D8              machinery   20           heavyforest        750         2000
D8              machinery   30           heavyforest        650         2000
```

### Hierarchical Parsing

The system automatically derives vegetation compatibility:

1. **Analyze CSV entries**: Determine the heaviest vegetation type each machine can handle
2. **Generate hierarchy**: Include all lighter vegetation types in compatibility list
3. **Example**: If a machine has "heavyforest" entries, it's compatible with grassland, lightshrub, mediumscrub, and heavyforest

## User Interface Features

### Visual Compatibility Indicators

- **✓ Compatible**: Green checkmark with time and cost estimates
- **✗ Incompatible**: Red X with "N/A" for time and cost
- **Incompatible Reason**: Hover text explains why (slope limit, vegetation type, etc.)

### Quick Options Summary

Displays the best option from each equipment category:
- **Machinery**: Fastest compatible machinery option
- **Aircraft**: Most efficient aircraft for the route length
- **Hand Crew**: Most suitable crew for the vegetation and terrain

### Detailed Equipment Table

Shows all equipment with:
- **Equipment Name and Type**
- **Estimated Completion Time** (or N/A if incompatible)
- **Total Cost Estimate** (or "-" if incompatible or no cost data)
- **Compatibility Status** (Compatible/Incompatible)

## Technical Implementation

### Key Functions

- `isCompatible()`: Checks terrain and vegetation compatibility
- `isSlopeCompatible()`: Validates slope requirements
- `calculateMachineryTime()`: Computes time with all factors
- `mapRowsToMachinery()`: Parses CSV with hierarchical compatibility

### Data Flow

1. User draws fire break line
2. System performs slope and vegetation analysis
3. Compatibility is evaluated for each equipment item
4. Performance calculations are computed for compatible equipment
5. Results are sorted and displayed with best options highlighted

## Configuration and Customization

### Adding New Equipment

To add new machinery:

1. **Update CSV**: Add entries for all slope/vegetation combinations
2. **Specify Capabilities**: Include appropriate slope limits and vegetation types
3. **Set Performance**: Define clearing rates and costs for different conditions

### Modifying Compatibility Rules

Compatibility logic can be customized by:

- **Vegetation Factors**: Adjust multipliers in `defaultConfig.ts`
- **Terrain Factors**: Modify terrain difficulty multipliers
- **Slope Limits**: Update maximum slope capabilities for each machine type
- **Hierarchical Rules**: Customize vegetation hierarchy in parsing logic

---

*This documentation follows the conventions established in the PacePublicShare repository for technical feature documentation.*

*Last updated: December 2024*
*Version: 1.1*