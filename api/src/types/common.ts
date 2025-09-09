/**
 * Common type definitions shared between frontend and backend
 */

// Terrain levels in ascending difficulty order
export const TERRAIN_LEVELS = ['easy','moderate','difficult','extreme'] as const;
export type TerrainLevel = typeof TERRAIN_LEVELS[number];

// Vegetation taxonomy
export const VEGETATION_TYPES = ['grassland','lightshrub','mediumscrub','heavyforest'] as const;
export type VegetationType = typeof VEGETATION_TYPES[number];

// Equipment core types
export type EquipmentCoreType = 'Machinery' | 'Aircraft' | 'HandCrew';
