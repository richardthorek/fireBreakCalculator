/**
 * Utilities for formatting and displaying vegetation and terrain types consistently across the application
 */

import { VegetationType, TerrainLevel } from '../config/classification';

/**
 * Get human-readable display name for vegetation type
 */
export const getVegetationTypeDisplayName = (type: VegetationType): string => {
  const displayNames: Record<VegetationType, string> = {
    grassland: 'Grassland',
    lightshrub: 'Light Shrub',
    mediumscrub: 'Medium Scrub',
    heavyforest: 'Heavy Forest'
  };
  return displayNames[type] || type;
};

/**
 * Get human-readable display name for terrain level
 */
export const getTerrainLevelDisplayName = (level: TerrainLevel): string => {
  const displayNames: Record<TerrainLevel, string> = {
    easy: 'Easy',
    moderate: 'Moderate',
    difficult: 'Difficult',
    extreme: 'Extreme'
  };
  return displayNames[level] || level;
};

/**
 * Get example descriptions for vegetation types
 */
export const getVegetationTypeExample = (type: VegetationType): string => {
  const examples: Record<VegetationType, string> = {
    grassland: 'Grassland — open grass, low fuel loads',
    lightshrub: 'Light shrub / scrub — low bushes, scattered shrubs',
    mediumscrub: 'Medium scrub — dense shrub, mixed groundcover',
    heavyforest: 'Heavy timber / forest — tall trees, closed canopy'
  };
  return examples[type] || '';
};

/**
 * Get example descriptions for terrain levels
 */
export const getTerrainLevelExample = (level: TerrainLevel): string => {
  const examples: Record<TerrainLevel, string> = {
    easy: '0–10° — flat or gentle slopes (paddock, grass)',
    moderate: '10–20° — rolling hills, light obstacles',
    difficult: '20–30° — steep slopes, rocky or dense scrub',
    extreme: '30°+ — very steep / technical terrain'
  };
  return examples[level] || '';
};
