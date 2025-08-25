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
  { key: 'medium', label: 'Medium', color: '#c8c800', range: '10-20°' },
  { key: 'steep', label: 'Steep', color: '#ff8800', range: '20-30°' },
  { key: 'very_steep', label: 'Very Steep', color: '#ff0000', range: '30°+' }
];

export const VEGETATION_CATEGORIES: CategoryDef[] = [
  { key: 'grassland', label: 'Grass', color: '#00aa00' },
  { key: 'lightshrub', label: 'Light', color: '#c8c800' },
  { key: 'mediumscrub', label: 'Medium', color: '#ff8800' },
  { key: 'heavyforest', label: 'Heavy', color: '#006400' }
];
