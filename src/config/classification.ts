/**
 * Centralized classification & taxonomy definitions for terrain, vegetation, and slope.
 * Update arrays below to introduce new categories (e.g. expand slope to 10 buckets)
 * and the rest of the application (analysis, visualization, compatibility) will adapt.
 */

export interface SlopeCategoryDefinition {
  key: string;          // internal id (used as TrackAnalysis key)
  label: string;        // human readable
  min: number;          // inclusive lower bound (degrees)
  max?: number;         // exclusive upper bound (degrees), undefined means open ended
  color: string;        // visualization color
}

// Default slope categories (can be replaced or extended)
export const SLOPE_CATEGORIES: SlopeCategoryDefinition[] = [
  { key: 'flat',       label: 'Flat',        min: 0,  max: 10, color: '#00ff00' },
  { key: 'medium',     label: 'Medium',      min: 10, max: 20, color: '#ffff00' },
  { key: 'steep',      label: 'Steep',       min: 20, max: 30, color: '#ff8800' },
  { key: 'very_steep', label: 'Very Steep',  min: 30,          color: '#ff0000' }
];

// Terrain levels in ascending difficulty order
export const TERRAIN_LEVELS = ['easy','moderate','difficult','extreme'] as const;
export type TerrainLevel = typeof TERRAIN_LEVELS[number];

// Vegetation taxonomy
export const VEGETATION_TYPES = ['grassland','lightshrub','mediumscrub','heavyforest'] as const;
export type VegetationType = typeof VEGETATION_TYPES[number];

/** Map slope degrees to category key using configured definitions */
export function classifySlope(angleDeg: number, defs: SlopeCategoryDefinition[] = SLOPE_CATEGORIES): string {
  for (const def of defs) {
    if (angleDeg >= def.min && (def.max === undefined || angleDeg < def.max)) return def.key;
  }
  return defs[defs.length - 1].key; // fallback last
}

/** Derive minimum terrain requirement from maximum slope */
export function deriveTerrainFromSlope(maxSlope: number): TerrainLevel {
  if (maxSlope <= 10) return 'easy';
  if (maxSlope <= 20) return 'moderate';
  if (maxSlope <= 30) return 'difficult';
  return 'extreme';
}

/** Retrieve color for a slope category */
export const slopeCategoryColor = (key: string): string => {
  return SLOPE_CATEGORIES.find(c => c.key === key)?.color || '#888888';
};
