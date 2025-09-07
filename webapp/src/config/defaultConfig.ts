/**
 * Default configuration for Fire Break Calculator resources and calculations.
 * This file defines the calculation rules used by Rural Fire Service operations.
 * All equipment data is sourced dynamically via API from the backend.
 */

import { FireBreakConfig } from '../types/config';
// Equipment is sourced dynamically via API & Table Storage.

export const defaultConfig: FireBreakConfig = {
  // Empty arrays for machinery, aircraft, and hand crews
  // All equipment data will be loaded from the API
  machinery: [],
  aircraft: [],
  handCrews: [],

  calculationRules: {
    terrainFactors: {
      easy: 1.0,     // Flat, accessible terrain
      moderate: 1.3,  // Rolling hills, some obstacles
      difficult: 1.7, // Steep slopes, rocky terrain
      extreme: 2.2    // Very steep, inaccessible areas
    },
    // Vegetation taxonomy updated: grassland, lightshrub, mediumscrub, heavyforest
    vegetationFactors: {
      grassland: 1.0,     // very light
      lightshrub: 1.1,    // <10cm diameter
      mediumscrub: 1.5,   // 10-50cm
      heavyforest: 2.0    // 50cm+
    },
    // Note: machinery drivers will path-find between individual large objects.
    // The `minClearDiameter` on machinery entries is a heuristic specifying the
    // minimum diameter of objects the machine can clear; configuration and
    // performance selection should use this to decide whether a machine can
    // operate in a given vegetation class based on the presence of large objects.
    slopeTimeFactor: 0.02 // Additional 2% time per degree of slope
  }
};