# Hand Crew Fuel Model Reference

## Overview

The Fire Break Calculator includes fuel model-based productivity calculations for hand crews based on standardized fire behavior fuel models. This feature allows for more accurate time estimates by considering specific vegetation types and crew capabilities.

## Fuel Models

The system includes 7 standardized fuel models with productivity rates for different crew types and attack methods:

| Fuel Model | Description | Type I Direct | Type I Indirect | Type II Direct | Type II Indirect |
|------------|-------------|---------------|-----------------|----------------|------------------|
| 1 Short Grass | Short grass fuels with minimal ground cover | 17.1 m/hr | 9.6 m/hr | 9.6 m/hr | 4.3 m/hr |
| 2 Open Timber Grass | Open timber with grass understory | 16.6 m/hr | 9.6 m/hr | 9.5 m/hr | 4.5 m/hr |
| 4 Chaparral | Dense shrubland with woody vegetation | 6.7 m/hr | 5.0 m/hr | 6.9 m/hr | 4.0 m/hr |
| 5 Brush | Mixed brush and shrubland | 16.6 m/hr | 4.9 m/hr | 7.1 m/hr | 4.2 m/hr |
| 6 Dormant Brush/Hardwood Slash | Dormant brush and hardwood slash areas | 16.6 m/hr | 4.9 m/hr | 7.1 m/hr | 4.2 m/hr |
| 8 Closed Timber Litter | Closed timber with forest litter | 10.6 m/hr | 6.9 m/hr | 7.1 m/hr | 5.7 m/hr |
| 9 Hardwood Litter | Hardwood forest with leaf litter | 10.6 m/hr | 6.9 m/hr | 6.5 m/hr | 5.5 m/hr |

*All rates shown are per person in meters per hour*

## Crew Types

### Type I Crews (Interagency Hotshots - IHC)
- **Training**: Extensive advanced training and qualifications
- **Physical Standards**: Arduous physical fitness requirements
- **Skills**: Highly skilled firefighters with specialized capabilities
- **Productivity**: Generally higher production rates
- **Use Case**: Complex fires, difficult terrain, extended operations

### Type II Crews (Initial Attack)
- **Training**: Standard firefighter training
- **Capability**: Some crews can form 3-4 separate squads of 4-6 people
- **Leadership**: Qualified incident commanders for each squad
- **Productivity**: Standard production rates
- **Use Case**: Initial attack, standard firefighting operations

## Attack Methods

### Direct Attack
- **Definition**: Attacking the fire directly at its edge
- **Characteristics**: 
  - Work close to active fire line
  - Higher productivity in suitable conditions
  - Requires good access and favorable conditions
  - More aggressive approach

### Indirect Attack
- **Definition**: Creating firebreaks away from the fire edge
- **Characteristics**:
  - Work at a safe distance from active fire
  - Lower productivity due to wider clearing requirements
  - Used in dangerous or inaccessible conditions
  - More conservative approach

## Data Source and Conversion

The productivity rates are based on Table 3 from fire behavior research, converted as follows:

1. **Original Data**: Feet per hour for 20-person crews
2. **Conversion Formula**: `(feet/hour ÷ 3.281) ÷ 20 = meters/hour per person`
3. **Example**: Short Grass Type I Direct = `1,122 ft/hr ÷ 3.281 ÷ 20 = 17.1 m/hr per person`

## Environmental Factors

Fuel model rates are further adjusted by:

### Terrain Factors
- **Easy (1.0x)**: Flat, accessible terrain
- **Moderate (1.3x)**: Rolling hills, some obstacles  
- **Difficult (1.7x)**: Steep slopes, rocky terrain
- **Extreme (2.2x)**: Very steep, inaccessible areas

### Vegetation Factors  
- **Light (1.0x)**: Grass, light shrubs
- **Moderate (1.4x)**: Mixed vegetation, small trees
- **Heavy (1.8x)**: Dense forest, thick undergrowth
- **Extreme (2.5x)**: Very dense vegetation, large trees

## Calculation Logic

```
Final Rate = (Fuel Model Rate ÷ Terrain Factor ÷ Vegetation Factor) × Crew Size
Time Required = Distance ÷ Final Rate
```

## Usage Guidelines

1. **Select Appropriate Fuel Model**: Choose based on dominant vegetation type
2. **Consider Crew Type**: Use Type I for complex operations, Type II for standard work
3. **Choose Attack Method**: Direct for favorable conditions, indirect for safety
4. **Adjust Crew Size**: Scale linearly (10 people = 2x rate of 5 people)
5. **Account for Conditions**: Steep terrain and dense vegetation significantly reduce productivity

## References

- Fire Behavior Fuel Models (Scott & Burgan, 2005)
- Interagency Hotshot Crew Standards
- NWCG Initial Attack Standards
- Fireline Construction Productivity Studies