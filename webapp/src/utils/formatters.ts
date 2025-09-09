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
    flat: 'Flat',
    medium: 'Medium',
    steep: 'Steep',
    very_steep: 'Very Steep'
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
    flat: '0–10° — flat or gentle slopes (paddock, grass)',
    medium: '10–25° — rolling hills, light obstacles',
    steep: '25–45° — steep slopes, rocky or dense scrub',
    very_steep: '45°+ — very steep / technical terrain'
  };
  return examples[level] || '';
};
