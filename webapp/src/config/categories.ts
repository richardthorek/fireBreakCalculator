// Central category configuration for slope and vegetation distributions
// Ensures single source of truth for labels, colors, and value keys

export interface CategoryDef {
  key: string;
  label: string;
  color: string;
  range?: string; // slope range or other descriptor
}

export const SLOPE_CATEGORIES: CategoryDef[] = [
  { key: 'flat', label: 'Flat', color: '#00aa00', range: '0-10°' },
  { key: 'medium', label: 'Medium', color: '#c8c800', range: '10-25°' },
  { key: 'steep', label: 'Steep', color: '#ff8800', range: '25-45°' },
  { key: 'very_steep', label: 'Very Steep', color: '#ff0000', range: '45°+' }
];

export const VEGETATION_CATEGORIES: CategoryDef[] = [
  { key: 'grassland', label: 'Grass', color: 'rgba(242, 255, 0, 1)' },
  { key: 'lightshrub', label: 'Light', color: 'rgba(179, 185, 4, 1)' },
  { key: 'mediumscrub', label: 'Medium', color: 'rgba(122, 222, 0, 1)' },
  { key: 'heavyforest', label: 'Heavy', color: '#006400' }
];
