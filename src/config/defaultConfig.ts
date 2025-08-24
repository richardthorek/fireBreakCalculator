/**
 * Default configuration for Fire Break Calculator resources and capabilities.
 * This file defines the standard equipment and calculation rules used by
 * Rural Fire Service operations. Values can be adjusted for different regions.
 */

import { FireBreakConfig } from '../types/config';

export const defaultConfig: FireBreakConfig = {
  machinery: [
    {
      id: 'dozer-d6',
      name: 'Caterpillar D6 Dozer',
      type: 'dozer',
      clearingRate: 1200, // meters per hour
      costPerHour: 180,
      description: 'Medium dozer suitable for most terrain types'
    },
    {
      id: 'dozer-d8',
      name: 'Caterpillar D8 Dozer',
      type: 'dozer',
      clearingRate: 1800, // meters per hour
      costPerHour: 250,
      description: 'Heavy dozer for difficult terrain and heavy vegetation'
    },
    {
      id: 'grader-140m',
      name: 'Motor Grader 140M',
      type: 'grader',
      clearingRate: 2500, // meters per hour
      costPerHour: 120,
      description: 'Motor grader for maintaining existing trails and light clearing'
    },
    {
      id: 'dozer-d4',
      name: 'Caterpillar D4 Dozer',
      type: 'dozer',
      clearingRate: 800, // meters per hour
      costPerHour: 140,
      description: 'Light dozer for sensitive areas and narrow fire breaks'
    }
  ],

  aircraft: [
    {
      id: 'helicopter-light',
      name: 'Light Helicopter (AS350)',
      type: 'helicopter',
      dropLength: 100, // meters
      speed: 180, // km/h
      turnaroundTime: 15, // minutes
      costPerHour: 3500,
      description: 'Light helicopter for water/retardant drops on smaller fire breaks'
    },
    {
      id: 'helicopter-medium',
      name: 'Medium Helicopter (Bell 212)',
      type: 'helicopter',
      dropLength: 150, // meters
      speed: 200, // km/h
      turnaroundTime: 20, // minutes
      costPerHour: 5000,
      description: 'Medium helicopter with larger capacity for longer fire breaks'
    },
    {
      id: 'fixed-wing-light',
      name: 'Air Tractor AT-802F',
      type: 'fixed_wing',
      dropLength: 300, // meters
      speed: 300, // km/h
      turnaroundTime: 25, // minutes
      costPerHour: 4200,
      description: 'Fixed-wing aircraft for large area coverage'
    }
  ],

  handCrews: [
    {
      id: 'standard-crew',
      name: 'Standard Hand Crew',
      crewSize: 6,
      clearingRatePerPerson: 50, // meters per hour per person
      tools: ['Hand tools', 'Chainsaws', 'Rakes'],
      costPerHour: 420, // for entire crew
      description: 'Standard 6-person crew with mixed hand tools and chainsaws'
    },
    {
      id: 'rapid-response',
      name: 'Rapid Response Crew',
      crewSize: 4,
      clearingRatePerPerson: 60, // meters per hour per person
      tools: ['Specialized hand tools', 'Portable equipment'],
      costPerHour: 320, // for entire crew
      description: 'Smaller, faster crew for quick initial attack'
    },
    {
      id: 'heavy-crew',
      name: 'Heavy Clearing Crew',
      crewSize: 10,
      clearingRatePerPerson: 45, // meters per hour per person
      tools: ['Chainsaws', 'Brush cutters', 'Hand tools'],
      costPerHour: 650, // for entire crew
      description: 'Large crew with power tools for heavy vegetation clearing'
    }
  ],

  calculationRules: {
    terrainFactors: {
      easy: 1.0,     // Flat, accessible terrain
      moderate: 1.3,  // Rolling hills, some obstacles
      difficult: 1.7, // Steep slopes, rocky terrain
      extreme: 2.2    // Very steep, inaccessible areas
    },
    vegetationFactors: {
      light: 1.0,     // Grass, light shrubs
      moderate: 1.4,  // Mixed vegetation, small trees
      heavy: 1.8,     // Dense forest, thick undergrowth
      extreme: 2.5    // Very dense vegetation, large trees
    },
    slopeTimeFactor: 0.02 // Additional 2% time per degree of slope
  }
};